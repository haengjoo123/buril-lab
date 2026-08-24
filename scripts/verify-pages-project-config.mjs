import { pathToFileURL } from 'node:url'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'

const MAX_PROJECT_RESPONSE_BYTES = 1024 * 1024
const KOSHA_CONTENT_MODES = Object.freeze(['full', 'link_only'])
const REQUIRED_SERVER_SECRETS = Object.freeze([
  'FEEDBACK_ADMIN_EMAILS',
  'GEMINI_API_KEY',
  'GOOGLE_VISION_API_KEY',
  'KOSHA_API_KEY',
  'OPENAI_API_KEY',
  'OPS_ADMIN_EMAILS',
  'OPS_ANALYTICS_EXPORT_EMAILS',
  'SUPABASE_ANON_KEY',
  'SUPABASE_JWT_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
])
const FORBIDDEN_CLIENT_SECRET_NAMES = Object.freeze([
  'VITE_GEMINI_API_KEY',
  'VITE_GOOGLE_VISION_API_KEY',
  'VITE_KOSHA_API_KEY',
  'VITE_OPENAI_API_KEY',
  'VITE_SUPABASE_JWT_SECRET',
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
  'VITE_UPSTASH_REDIS_REST_TOKEN',
])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function deploymentConfig(project) {
  const config = project?.deployment_configs?.production
  if (!isRecord(config)) throw new Error(`${project?.name || 'Pages project'} lacks a production configuration.`)
  return config
}

function environmentVariables(config) {
  return isRecord(config?.env_vars) ? config.env_vars : {}
}

function runtimeConfigNamespace(project) {
  const namespaces = deploymentConfig(project).kv_namespaces
  const binding = isRecord(namespaces) ? namespaces.BURILLAB_RUNTIME_CONFIG : null
  return isRecord(binding) && typeof binding.namespace_id === 'string'
    ? binding.namespace_id
    : null
}

function verifyProjectIdentity(project, environment, stagingKoshaContentMode) {
  const expected = RELEASE_ENVIRONMENTS[environment]
  if (!isRecord(project) || project.name !== expected.project) {
    throw new Error(`${environment} Pages project identity does not match.`)
  }
  if (project.production_branch !== 'main') {
    throw new Error(`${expected.project} production branch must be main.`)
  }

  const expectedHostname = new URL(expected.origin).hostname
  if (!Array.isArray(project.domains) || !project.domains.includes(expectedHostname)) {
    throw new Error(`${expected.project} custom domain is missing.`)
  }
  if (environment === 'production' && !project.domains.includes('www.burillab.com')) {
    throw new Error('Production Pages www redirect domain is missing.')
  }
  const expectedPagesSubdomain = `${expected.project}.pages.dev`
  if (project.subdomain !== expectedPagesSubdomain && !project.domains.includes(expectedPagesSubdomain)) {
    throw new Error(`${expected.project} Pages subdomain identity does not match.`)
  }

  if (isRecord(project.source)) {
    const sourceConfig = project.source.config
    if (
      !isRecord(sourceConfig)
      || sourceConfig.production_deployments_enabled !== false
      || sourceConfig.preview_deployment_setting !== 'none'
    ) {
      throw new Error(`${expected.project} automatic Cloudflare Git deployments are not fully disabled.`)
    }
  }

  const production = deploymentConfig(project)
  if (production.fail_open === true) {
    throw new Error(`${expected.project} Pages Functions must not fail open.`)
  }

  const productionVars = environmentVariables(production)
  const previewVars = environmentVariables(project?.deployment_configs?.preview)
  const requiredServerSecrets = environment === 'staging' && stagingKoshaContentMode === 'link_only'
    ? REQUIRED_SERVER_SECRETS.filter((name) => name !== 'KOSHA_API_KEY')
    : REQUIRED_SERVER_SECRETS
  const missingSecrets = requiredServerSecrets.filter((name) => productionVars[name]?.type !== 'secret_text')
  if (missingSecrets.length > 0) {
    throw new Error(`${expected.project} lacks encrypted server secrets: ${missingSecrets.join(', ')}`)
  }
  const leakedClientNames = FORBIDDEN_CLIENT_SECRET_NAMES.filter(
    (name) => name in productionVars || name in previewVars,
  )
  if (leakedClientNames.length > 0) {
    throw new Error(`${expected.project} contains forbidden client-prefixed secrets: ${leakedClientNames.join(', ')}`)
  }
}

export function verifyPagesProjectPair({
  staging,
  production,
  selectedEnvironment,
  selectedRuntimeConfigKvId,
  requireCurrentBinding = false,
  stagingKoshaContentMode = 'full',
}) {
  if (!['staging', 'production'].includes(selectedEnvironment)) {
    throw new Error('Selected environment must be staging or production.')
  }
  if (!KOSHA_CONTENT_MODES.includes(stagingKoshaContentMode)) {
    throw new Error('STAGING_KOSHA_CONTENT_MODE must be full or link_only.')
  }
  verifyProjectIdentity(staging, 'staging', stagingKoshaContentMode)
  verifyProjectIdentity(production, 'production', stagingKoshaContentMode)

  const selected = selectedEnvironment === 'staging' ? staging : production
  const peer = selectedEnvironment === 'staging' ? production : staging

  const selectedBinding = runtimeConfigNamespace(selected)
  const peerBinding = runtimeConfigNamespace(peer)
  if (requireCurrentBinding && selectedBinding !== selectedRuntimeConfigKvId) {
    throw new Error('Selected Pages project does not use the expected runtime-config KV namespace.')
  }
  if (peerBinding && peerBinding === selectedRuntimeConfigKvId) {
    throw new Error('Staging and production must not share the runtime-config KV namespace.')
  }
  if (selectedEnvironment === 'production' && !peerBinding) {
    throw new Error('Production deployment requires a configured Staging runtime-config KV binding.')
  }
  if (selectedBinding && peerBinding && selectedBinding === peerBinding) {
    throw new Error('Staging and production Pages projects share a runtime-config KV namespace.')
  }

  return {
    selectedProject: selected.name,
    currentBindingVerified: requireCurrentBinding,
    peerBindingPresent: Boolean(peerBinding),
    stagingKoshaContentMode,
  }
}

async function readBoundedJson(response) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_PROJECT_RESPONSE_BYTES) {
    throw new Error('Cloudflare Pages project response is too large.')
  }
  if (!response.body) throw new Error('Cloudflare Pages project response is empty.')

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_PROJECT_RESPONSE_BYTES) {
        throw new Error('Cloudflare Pages project response is too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('Cloudflare Pages project response is not JSON.')
  }
}

async function fetchProject({ accountId, apiToken, project }) {
  const endpoint = new URL(
    `/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(project)}`,
    'https://api.cloudflare.com',
  )
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Cloudflare Pages project lookup failed with HTTP ${response.status}.`)
  const payload = await readBoundedJson(response)
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.result)) {
    throw new Error('Cloudflare Pages project response is invalid.')
  }
  return payload.result
}

export async function fetchAndVerifyPagesProjectPair(environment = process.env) {
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID?.trim()
  const apiToken = environment.CLOUDFLARE_API_TOKEN?.trim()
  const selectedEnvironment = environment.DEPLOY_ENVIRONMENT?.trim()
  const selectedRuntimeConfigKvId = environment.BURILLAB_RUNTIME_CONFIG_KV_ID?.trim()
  if (!accountId || !apiToken || !selectedEnvironment || !selectedRuntimeConfigKvId) {
    throw new Error('Cloudflare Pages project verification inputs are missing.')
  }

  const [staging, production] = await Promise.all([
    fetchProject({ accountId, apiToken, project: RELEASE_ENVIRONMENTS.staging.project }),
    fetchProject({ accountId, apiToken, project: RELEASE_ENVIRONMENTS.production.project }),
  ])
  return verifyPagesProjectPair({
    staging,
    production,
    selectedEnvironment,
    selectedRuntimeConfigKvId,
    requireCurrentBinding: environment.VERIFY_CURRENT_RUNTIME_BINDING === 'true',
    stagingKoshaContentMode: environment.STAGING_KOSHA_CONTENT_MODE?.trim() || 'full',
  })
}

async function main() {
  const result = await fetchAndVerifyPagesProjectPair()
  console.log(
    `Cloudflare Pages isolation passed for ${result.selectedProject} (current binding verified: ${result.currentBindingVerified}).`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Cloudflare Pages project verification failed.')
    process.exitCode = 1
  })
}
