import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const RELEASE_SCHEMA_VERSION = 1
export const RELEASE_ENVIRONMENTS = Object.freeze({
  staging: Object.freeze({
    project: 'buril-lab-staging',
    origin: 'https://staging.burillab.com',
    supabaseProjectRef: 'qpgnomuqdcucjmxrunnw',
  }),
  production: Object.freeze({
    project: 'buril-lab',
    origin: 'https://burillab.com',
    supabaseProjectRef: 'zafxzidbtbryiksemlwc',
  }),
})

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name.startsWith('--')) throw new Error(`Unexpected argument: ${name}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
    values.set(name.slice(2), value)
    index += 1
  }
  return values
}

function normalizeTimestamp(value) {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.valueOf())) throw new Error('built-at must be an ISO-8601 timestamp.')
  return timestamp.toISOString()
}

export function createReleaseManifest({ commitSha, environment, builtAt }) {
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('commit must be a lowercase, full 40-character Git SHA.')
  }

  if (!Object.hasOwn(RELEASE_ENVIRONMENTS, environment)) {
    throw new Error('environment must be staging or production.')
  }
  const releaseEnvironment = RELEASE_ENVIRONMENTS[environment]

  return {
    schema_version: RELEASE_SCHEMA_VERSION,
    commit_sha: commitSha,
    environment,
    project: releaseEnvironment.project,
    built_at: normalizeTimestamp(builtAt),
  }
}

export async function writeReleaseManifest({ output, ...manifestInput }) {
  const manifest = createReleaseManifest(manifestInput)
  const outputPath = resolve(output)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const output = args.get('output')
  const commitSha = args.get('commit')
  const environment = args.get('environment')
  const builtAt = args.get('built-at') || new Date().toISOString()

  if (!output || !commitSha || !environment) {
    throw new Error(
      'Usage: node scripts/write-release-manifest.mjs --output <path> --commit <sha> --environment <staging|production> [--built-at <ISO>]',
    )
  }

  const manifest = await writeReleaseManifest({ output, commitSha, environment, builtAt })
  console.log(`Release manifest written for ${manifest.environment} at ${manifest.commit_sha}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Release manifest generation failed.')
    process.exitCode = 1
  })
}
