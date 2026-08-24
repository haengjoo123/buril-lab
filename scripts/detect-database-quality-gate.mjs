import { appendFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const DATABASE_QUALITY_CONTRACT = 'supabase/ci-quality.json'

export function validateDatabaseQualityContract(contract) {
  const keys = Object.keys(contract || {}).sort()
  const expectedKeys = ['enabled', 'permission_tests', 'reset_count', 'schema_version']
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error('Database quality contract fields are invalid.')
  }
  if (
    contract.schema_version !== 1
    || contract.enabled !== true
    || contract.reset_count !== 2
    || contract.permission_tests !== true
  ) {
    throw new Error('Database quality contract must enable two resets and SQL permission tests.')
  }
  return contract
}

export async function detectDatabaseQualityGate({
  path = DATABASE_QUALITY_CONTRACT,
  outputPath = process.env.GITHUB_OUTPUT,
} = {}) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    if (outputPath) await appendFile(outputPath, 'enabled=false\n', 'utf8')
    return { enabled: false, path }
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Database quality contract is not valid JSON.')
  }
  validateDatabaseQualityContract(parsed)
  if (outputPath) await appendFile(outputPath, 'enabled=true\n', 'utf8')
  return { enabled: true, path }
}

async function main() {
  const result = await detectDatabaseQualityGate()
  if (result.enabled) {
    console.log(`Database quality gate enabled by ${result.path}.`)
  } else {
    console.log(`Database quality gate remains deferred until ${result.path} is added by Prep 1.`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Database quality-gate detection failed.')
    process.exitCode = 1
  })
}
