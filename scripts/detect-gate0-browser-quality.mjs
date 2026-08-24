import { access, appendFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const GATE0_BROWSER_CONTRACT = 'e2e/gate0/ci-quality.json'

export function validateGate0BrowserContract(contract) {
  const keys = Object.keys(contract || {}).sort()
  const expectedKeys = ['browser', 'config', 'enabled', 'schema_version', 'spec']
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error('Gate 0 browser quality contract fields are invalid.')
  }
  if (
    contract.schema_version !== 1
    || contract.enabled !== true
    || contract.browser !== 'chromium'
    || contract.config !== 'playwright.gate0.config.ts'
    || contract.spec !== 'e2e/gate0/gate0.spec.ts'
  ) {
    throw new Error('Gate 0 browser quality contract must select the reviewed Chromium config and spec.')
  }
  return contract
}

export async function detectGate0BrowserQuality({
  path = GATE0_BROWSER_CONTRACT,
  outputPath = process.env.GITHUB_OUTPUT,
  verifyFiles = true,
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
    throw new Error('Gate 0 browser quality contract is not valid JSON.')
  }
  validateGate0BrowserContract(parsed)
  if (verifyFiles) {
    await Promise.all([access(parsed.config), access(parsed.spec)])
  }
  if (outputPath) await appendFile(outputPath, 'enabled=true\n', 'utf8')
  return { enabled: true, path }
}

async function main() {
  const result = await detectGate0BrowserQuality()
  if (result.enabled) {
    console.log(`Gate 0 browser quality gate enabled by ${result.path}.`)
  } else {
    console.log(`Gate 0 browser quality gate remains deferred until ${result.path} is added.`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Gate 0 browser quality-gate detection failed.')
    process.exitCode = 1
  })
}
