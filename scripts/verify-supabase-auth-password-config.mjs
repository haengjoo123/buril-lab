import { pathToFileURL } from 'node:url'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'

const PROJECT_REF = /^[a-z0-9]{20}$/
const MAX_RESPONSE_BYTES = 256 * 1024

export class SupabaseAuthPasswordConfigError extends Error {
  constructor(message) {
    super(`[ops8-auth-config] ${message}`)
    this.name = 'SupabaseAuthPasswordConfigError'
  }
}

function fail(message) { throw new SupabaseAuthPasswordConfigError(message) }

export function assertOps8AuthConfigEnvironment(environment, env = process.env) {
  if (!['staging', 'production'].includes(environment)) fail('environment must be staging or production')
  const accessToken = env.SUPABASE_ACCESS_TOKEN
  const projectRef = env.SUPABASE_PROJECT_REF
  if (typeof accessToken !== 'string' || accessToken.trim().length < 20) {
    fail('an environment-scoped Supabase access token is required')
  }
  if (typeof projectRef !== 'string' || !PROJECT_REF.test(projectRef)) {
    fail('a valid environment-scoped Supabase project ref is required')
  }
  if (projectRef !== RELEASE_ENVIRONMENTS[environment].supabaseProjectRef) {
    fail('the Supabase project ref does not match the selected environment')
  }
  return { accessToken, projectRef }
}

function parseJson(text) {
  if (!text || Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    fail('Supabase returned an empty or oversized auth configuration')
  }
  try { return JSON.parse(text) }
  catch { fail('Supabase returned invalid auth configuration JSON') }
}

export async function verifySupabaseAuthPasswordConfig(
  environment,
  env = process.env,
  fetchImpl = fetch,
) {
  const { accessToken, projectRef } = assertOps8AuthConfigEnvironment(environment, env)
  let response
  try {
    response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    fail('Supabase auth configuration could not be read')
  }
  if (response.status !== 200) fail(`Supabase auth configuration returned HTTP ${response.status}`)
  const config = parseJson(await response.text())
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    fail('Supabase auth configuration is not an object')
  }
  if (config.password_hibp_enabled !== true) {
    fail('leaked account-password protection is not enabled')
  }
  return Object.freeze({
    result: 'supabase-auth-password-config-ok',
    environment,
    projectRef,
    passwordHibpEnabled: true,
    checkedEndpoint: '/v1/projects/{ref}/config/auth',
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const environment = args[0] === '--environment' && args.length === 2 ? args[1] : null
  if (!environment) {
    console.error('[ops8-auth-config] usage: verify-supabase-auth-password-config.mjs --environment staging|production')
    process.exitCode = 1
  } else {
    try { console.log(JSON.stringify(await verifySupabaseAuthPasswordConfig(environment))) }
    catch (error) {
      console.error(error instanceof Error ? error.message : '[ops8-auth-config] verification failed')
      process.exitCode = 1
    }
  }
}
