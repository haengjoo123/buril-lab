import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { GATE0_STAGING_CONFIRMATION } from './gate0-seed-safety.mjs'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'
import { verifyCloudflareTokenTtl } from './verify-cloudflare-token-ttl.mjs'
import { verifyEphemeralLeaseGrant } from './verify-ephemeral-lease-grant.mjs'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const CLOUDFLARE_ID_PATTERN = /^[0-9a-f]{32}$/
const KOSHA_CONTENT_MODES = new Set(['full', 'link_only'])
const LEGACY_CLOUDFLARE_TOKEN_NAMES = [
  'CLOUDFLARE_API_TOKEN',
  'STAGING_CLOUDFLARE_API_TOKEN',
  'PRODUCTION_CLOUDFLARE_API_TOKEN',
]
const CLIENT_FEATURE_FLAGS = [
  'VITE_ENABLE_WASTE_V2',
  'VITE_ENABLE_PH_PREDICTION',
  'VITE_ENABLE_CHEMICAL_ENRICHMENT',
  'VITE_ENABLE_SEARCH_ANALYTICS',
]
const GATE0_FEATURE_PROFILE = Object.freeze({
  VITE_ENABLE_WASTE_V2: 'true',
  VITE_ENABLE_PH_PREDICTION: 'true',
  VITE_ENABLE_CHEMICAL_ENRICHMENT: 'true',
  VITE_ENABLE_SEARCH_ANALYTICS: 'false',
})

function requireValue(environment, name, minimumLength = 1) {
  const value = environment[name]?.trim()
  if (!value || value.length < minimumLength) throw new Error(`${name} is missing or too short.`)
  if (/[\r\n\0]/.test(value)) throw new Error(`${name} contains forbidden characters.`)
  return value
}

function requireBooleanLiteral(environment, name) {
  const value = environment[name]
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be exactly true or false.`)
  }
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

function rejectLegacyCloudflareTokens(environment) {
  for (const name of LEGACY_CLOUDFLARE_TOKEN_NAMES) {
    if (environment[name]?.trim()) {
      throw new Error(`${name} is a forbidden legacy long-lived deployment input.`)
    }
  }
}

function verifyCommonCloudflareTarget(environment, expectedEnvironment) {
  rejectLegacyCloudflareTokens(environment)
  const deploymentEnvironment = requireValue(environment, 'DEPLOY_ENVIRONMENT')
  if (deploymentEnvironment !== expectedEnvironment) {
    throw new Error(`DEPLOY_ENVIRONMENT must be exactly ${expectedEnvironment} for this token scope.`)
  }
  const expected = RELEASE_ENVIRONMENTS[deploymentEnvironment]
  const accountId = requireValue(environment, 'CLOUDFLARE_ACCOUNT_ID')
  if (!CLOUDFLARE_ID_PATTERN.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID is malformed.')
  const runtimeConfigKvId = requireValue(environment, 'BURILLAB_RUNTIME_CONFIG_KV_ID')
  if (!CLOUDFLARE_ID_PATTERN.test(runtimeConfigKvId)) {
    throw new Error('BURILLAB_RUNTIME_CONFIG_KV_ID is malformed.')
  }
  if (runtimeConfigKvId !== expected.runtimeConfigKvId) {
    throw new Error('BURILLAB_RUNTIME_CONFIG_KV_ID is not the approved namespace for this environment.')
  }
  const commitSha = requireValue(environment, 'DEPLOY_COMMIT_SHA')
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('DEPLOY_COMMIT_SHA must be a lowercase, full 40-character Git SHA.')
  }
  return { deploymentEnvironment, expected, accountId, runtimeConfigKvId, commitSha }
}

export function verifyCloudflareDeployInputs(environment) {
  rejectLegacyCloudflareTokens(environment)
  const deploymentEnvironment = requireValue(environment, 'DEPLOY_ENVIRONMENT')
  if (!Object.hasOwn(RELEASE_ENVIRONMENTS, deploymentEnvironment)) {
    throw new Error('DEPLOY_ENVIRONMENT must be staging or production.')
  }
  const expected = RELEASE_ENVIRONMENTS[deploymentEnvironment]

  const stagingKoshaContentMode = requireValue(environment, 'STAGING_KOSHA_CONTENT_MODE')
  if (!KOSHA_CONTENT_MODES.has(stagingKoshaContentMode)) {
    throw new Error('STAGING_KOSHA_CONTENT_MODE must be full or link_only.')
  }

  if (requireValue(environment, 'CLOUDFLARE_PAGES_PROJECT') !== expected.project) {
    throw new Error('CLOUDFLARE_PAGES_PROJECT does not match DEPLOY_ENVIRONMENT.')
  }
  const accountId = requireValue(environment, 'CLOUDFLARE_ACCOUNT_ID')
  if (!CLOUDFLARE_ID_PATTERN.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID is malformed.')
  requireValue(environment, 'PAGES_EPHEMERAL_TOKEN', 20)
  if (environment.WORKER_EPHEMERAL_TOKEN?.trim()) {
    throw new Error('WORKER_EPHEMERAL_TOKEN must not be exposed to the Pages deployment preflight.')
  }
  requireBooleanLiteral(environment, 'DEPLOY_STORAGE_BACKUP')

  const runtimeConfigKvId = requireValue(environment, 'BURILLAB_RUNTIME_CONFIG_KV_ID')
  if (!CLOUDFLARE_ID_PATTERN.test(runtimeConfigKvId)) {
    throw new Error('BURILLAB_RUNTIME_CONFIG_KV_ID is malformed.')
  }
  if (runtimeConfigKvId !== expected.runtimeConfigKvId) {
    throw new Error('BURILLAB_RUNTIME_CONFIG_KV_ID is not the approved namespace for this environment.')
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
  const supabaseAnonKey = requireValue(environment, 'VITE_SUPABASE_ANON_KEY', 20)

  for (const name of CLIENT_FEATURE_FLAGS) {
    const value = requireBooleanLiteral(environment, name)
    if (value !== GATE0_FEATURE_PROFILE[name]) {
      throw new Error(`${name} does not match the approved Gate0 feature profile.`)
    }
  }

  const accessClientId = requireValue(environment, 'STAGING_ACCESS_CLIENT_ID', 10)
  const accessClientSecret = requireValue(environment, 'STAGING_ACCESS_CLIENT_SECRET', 20)
  if (accessClientId === accessClientSecret) {
    throw new Error('Cloudflare Access client ID and secret must not be identical.')
  }

  if (deploymentEnvironment === 'staging') {
    const serviceRoleKey = requireValue(environment, 'SUPABASE_SERVICE_ROLE_KEY', 20)
    if (serviceRoleKey === supabaseAnonKey) {
      throw new Error('Staging service-role and anonymous Supabase keys must not be identical.')
    }
    const fixtureEmail = requireValue(environment, 'GATE0_E2E_EMAIL', 6)
    if (
      fixtureEmail.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fixtureEmail)
    ) {
      throw new Error('GATE0_E2E_EMAIL is malformed.')
    }
    requireValue(environment, 'GATE0_E2E_PASSWORD', 20)
    if (environment.GATE0_STAGING_SEED_CONFIRMATION !== GATE0_STAGING_CONFIRMATION) {
      throw new Error('GATE0_STAGING_SEED_CONFIRMATION does not match the exact Staging target.')
    }
  }

  return {
    environment: deploymentEnvironment,
    project: expected.project,
    origin: expected.origin,
    commitSha,
    runtimeConfigKvId,
    stagingKoshaContentMode,
  }
}

export function verifyCloudflareWorkerDeployInputs(environment) {
  const {
    accountId,
    runtimeConfigKvId,
    commitSha,
  } = verifyCommonCloudflareTarget(environment, 'staging')
  if (requireBooleanLiteral(environment, 'DEPLOY_STORAGE_BACKUP') !== 'true') {
    throw new Error('The Worker token may be exposed only for an explicit storage-backup deployment request.')
  }
  if (environment.PAGES_EPHEMERAL_TOKEN?.trim()) {
    throw new Error('PAGES_EPHEMERAL_TOKEN must not be exposed to the Worker deployment preflight.')
  }
  requireValue(environment, 'WORKER_EPHEMERAL_TOKEN', 20)
  return {
    environment: 'staging',
    accountId,
    runtimeConfigKvId,
    commitSha,
    tokenScope: 'worker',
  }
}

async function main() {
  const scope = process.env.VERIFY_CLOUDFLARE_DEPLOY_INPUT_SCOPE?.trim() || 'pages'
  const publicKey = await readFile('config/ephemeral-release-public-key.pem', 'utf8')
  const grant = verifyEphemeralLeaseGrant(process.env, publicKey)
  if (scope === 'pages') {
    const result = verifyCloudflareDeployInputs(process.env)
    const pagesToken = await verifyCloudflareTokenTtl({
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_EPHEMERAL_TOKEN: process.env.PAGES_EPHEMERAL_TOKEN,
    })
    if (pagesToken.tokenIdHash !== grant.cloudflareTokenIdHashes[0]) {
      throw new Error('Cloudflare Pages token does not match the signed ephemeral lease.')
    }
    console.log(`Cloudflare ${result.environment} Pages deployment inputs passed for ${result.project}.`)
    return
  }
  if (scope === 'worker') {
    const result = verifyCloudflareWorkerDeployInputs(process.env)
    const workerToken = await verifyCloudflareTokenTtl({
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_EPHEMERAL_TOKEN: process.env.WORKER_EPHEMERAL_TOKEN,
    })
    if (workerToken.tokenIdHash !== grant.cloudflareTokenIdHashes[1]) {
      throw new Error('Cloudflare Worker token does not match the signed ephemeral lease.')
    }
    console.log(`Cloudflare ${result.environment} Worker deployment inputs passed for ${result.commitSha}.`)
    return
  }
  throw new Error('VERIFY_CLOUDFLARE_DEPLOY_INPUT_SCOPE must be pages or worker.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Cloudflare deployment input verification failed.')
    process.exitCode = 1
  })
}
