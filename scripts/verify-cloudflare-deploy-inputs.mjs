import { pathToFileURL } from 'node:url'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const CLOUDFLARE_ID_PATTERN = /^[0-9a-f]{32}$/

function requireValue(environment, name, minimumLength = 1) {
  const value = environment[name]?.trim()
  if (!value || value.length < minimumLength) throw new Error(`${name} is missing or too short.`)
  if (/[\r\n\0]/.test(value)) throw new Error(`${name} contains forbidden characters.`)
  return value
}

function exactUrl(raw, name, expectedUrl) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`${name} is not a valid URL.`)
  }
  if (parsed.username || parsed.password || parsed.href !== expectedUrl) {
    throw new Error(`${name} does not belong to the selected deployment environment.`)
  }
  return parsed
}

export function verifyCloudflareDeployInputs(environment) {
  const deploymentEnvironment = requireValue(environment, 'DEPLOY_ENVIRONMENT')
  if (!Object.hasOwn(RELEASE_ENVIRONMENTS, deploymentEnvironment)) {
    throw new Error('DEPLOY_ENVIRONMENT must be staging or production.')
  }
  const expected = RELEASE_ENVIRONMENTS[deploymentEnvironment]

  if (requireValue(environment, 'CLOUDFLARE_PAGES_PROJECT') !== expected.project) {
    throw new Error('CLOUDFLARE_PAGES_PROJECT does not match DEPLOY_ENVIRONMENT.')
  }
  const accountId = requireValue(environment, 'CLOUDFLARE_ACCOUNT_ID')
  if (!CLOUDFLARE_ID_PATTERN.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID is malformed.')
  requireValue(environment, 'CLOUDFLARE_API_TOKEN', 20)

  const runtimeConfigKvId = requireValue(environment, 'BURILLAB_RUNTIME_CONFIG_KV_ID')
  if (!CLOUDFLARE_ID_PATTERN.test(runtimeConfigKvId)) {
    throw new Error('BURILLAB_RUNTIME_CONFIG_KV_ID is malformed.')
  }

  const commitSha = requireValue(environment, 'DEPLOY_COMMIT_SHA')
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('DEPLOY_COMMIT_SHA must be a lowercase, full 40-character Git SHA.')
  }

  exactUrl(
    requireValue(environment, 'VITE_PUBLIC_APP_URL'),
    'VITE_PUBLIC_APP_URL',
    `${expected.origin}/`,
  )
  exactUrl(
    requireValue(environment, 'VITE_INTERNAL_API_BASE_URL'),
    'VITE_INTERNAL_API_BASE_URL',
    `${expected.origin}/`,
  )
  exactUrl(
    requireValue(environment, 'VITE_AUTH_REDIRECT_URL'),
    'VITE_AUTH_REDIRECT_URL',
    `${expected.origin}/auth/callback`,
  )

  const projectRef = requireValue(environment, 'SUPABASE_PROJECT_REF')
  if (projectRef !== expected.supabaseProjectRef) {
    throw new Error('SUPABASE_PROJECT_REF does not match the selected release environment.')
  }
  exactUrl(
    requireValue(environment, 'VITE_SUPABASE_URL'),
    'VITE_SUPABASE_URL',
    `https://${expected.supabaseProjectRef}.supabase.co/`,
  )
  requireValue(environment, 'VITE_SUPABASE_ANON_KEY', 20)

  const accessClientId = requireValue(environment, 'STAGING_ACCESS_CLIENT_ID', 10)
  const accessClientSecret = requireValue(environment, 'STAGING_ACCESS_CLIENT_SECRET', 20)
  if (accessClientId === accessClientSecret) {
    throw new Error('Cloudflare Access client ID and secret must not be identical.')
  }

  return {
    environment: deploymentEnvironment,
    project: expected.project,
    origin: expected.origin,
    commitSha,
    runtimeConfigKvId,
  }
}

async function main() {
  const result = verifyCloudflareDeployInputs(process.env)
  console.log(`Cloudflare ${result.environment} deployment inputs passed for ${result.project}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Cloudflare deployment input verification failed.')
    process.exitCode = 1
  })
}
