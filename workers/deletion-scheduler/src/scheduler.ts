const MAX_RESPONSE_BYTES = 8 * 1024
const STALE_SUCCESS_MS = 3 * 60 * 1000
const MAX_CONSECUTIVE_FAILURES = 2
const READINESS_SUCCESSES = 3

interface RuntimeConfigStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}
type StaticSchedulerEnvironment = Pick<
  Env,
  | 'DELETION_ENVIRONMENT'
  | 'DELETION_TARGET_ORIGIN'
  | 'RUNTIME_CONFIG_KEY'
  | 'SCHEDULER_HEALTH_KEY'
  | 'REQUEST_TIMEOUT_MS'
  | 'DELETION_MAINTENANCE_SECRET'
> & {
  CF_ACCESS_CLIENT_ID?: string
  CF_ACCESS_CLIENT_SECRET?: string
}

export type SchedulerEnvironment<TStore extends RuntimeConfigStore = KVNamespace> =
  StaticSchedulerEnvironment & { BURILLAB_RUNTIME_CONFIG: TStore }

export interface MaintenanceSummary {
  claimed: number
  completed: number
  pending: number
  failed: number
}

interface RuntimeConfig {
  voice_disposal_mode: 'redirect' | 'guided'
  kosha_content_mode: 'full' | 'link_only'
  account_deletion_enabled: boolean
  maintenance_worker_enabled: boolean
  storage_backup_enabled: boolean
}

interface SchedulerHealth {
  schema_version: 1
  first_observed_at: number
  last_attempt_at: number | null
  last_success_at: number | null
  consecutive_failures: number
  consecutive_successes: number
  enablement_eligible: boolean
}

export interface SchedulerResult {
  outcome: 'success' | 'skipped_disabled' | 'skipped_fail_closed' | 'disabled'
  reason:
    | 'completed'
    | 'runtime_disabled'
    | 'runtime_config_unavailable'
    | 'health_unavailable'
    | 'success_record_stale'
    | 'maintenance_request_failed'
    | 'health_write_failed'
  summary?: MaintenanceSummary
  enablementEligible?: boolean
  failureCategory?: MaintenanceFailureCategory
}

export type MaintenanceFailureCategory =
  | 'configuration_error'
  | 'request_timeout'
  | 'network_error'
  | 'http_401'
  | 'http_403'
  | 'http_429'
  | 'http_503_disabled'
  | 'http_503_unavailable'
  | 'http_503_internal'
  | 'http_503'
  | 'http_5xx'
  | 'http_207'
  | 'http_other'
  | 'invalid_content_type'
  | 'response_too_large'
  | 'invalid_summary'
  | 'reported_failure'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonRecord(raw: string | null, maxBytes = 16 * 1024): Record<string, unknown> | null {
  if (raw === null || new TextEncoder().encode(raw).byteLength > maxBytes) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function parseRuntimeConfig(raw: string | null): RuntimeConfig | null {
  const value = parseJsonRecord(raw)
  if (!value || (value.voice_disposal_mode !== 'redirect' && value.voice_disposal_mode !== 'guided')
    || (value.kosha_content_mode !== 'full' && value.kosha_content_mode !== 'link_only')
    || typeof value.account_deletion_enabled !== 'boolean'
    || typeof value.maintenance_worker_enabled !== 'boolean'
    || typeof value.storage_backup_enabled !== 'boolean') return null
  return {
    voice_disposal_mode: value.voice_disposal_mode,
    kosha_content_mode: value.kosha_content_mode,
    account_deletion_enabled: value.account_deletion_enabled,
    maintenance_worker_enabled: value.maintenance_worker_enabled,
    storage_backup_enabled: value.storage_backup_enabled,
  }
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseHealth(raw: string | null): SchedulerHealth | null {
  if (raw === null) return null
  const value = parseJsonRecord(raw)
  const firstObserved = parseFiniteNumber(value?.first_observed_at)
  const lastAttempt = value?.last_attempt_at === null ? null : parseFiniteNumber(value?.last_attempt_at)
  const lastSuccess = value?.last_success_at === null ? null : parseFiniteNumber(value?.last_success_at)
  if (!value || value.schema_version !== 1 || firstObserved === null || lastAttempt === undefined
    || lastSuccess === undefined || (value.last_attempt_at !== null && lastAttempt === null)
    || (value.last_success_at !== null && lastSuccess === null)
    || !Number.isInteger(value.consecutive_failures) || Number(value.consecutive_failures) < 0
    || !Number.isInteger(value.consecutive_successes) || Number(value.consecutive_successes) < 0
    || typeof value.enablement_eligible !== 'boolean') throw new Error('invalid_health')
  return {
    schema_version: 1,
    first_observed_at: firstObserved,
    last_attempt_at: lastAttempt,
    last_success_at: lastSuccess,
    consecutive_failures: Number(value.consecutive_failures),
    consecutive_successes: Number(value.consecutive_successes),
    enablement_eligible: value.enablement_eligible,
  }
}

function initialHealth(now: number): SchedulerHealth {
  return {
    schema_version: 1,
    first_observed_at: now,
    last_attempt_at: null,
    last_success_at: null,
    consecutive_failures: 0,
    consecutive_successes: 0,
    enablement_eligible: false,
  }
}

function logOutcome(env: Pick<Env, 'DELETION_ENVIRONMENT'>, scheduledAt: number, result: SchedulerResult): void {
  console.log(JSON.stringify({
    event: 'deletion_scheduler',
    environment: env.DELETION_ENVIRONMENT,
    scheduled_at: new Date(scheduledAt).toISOString(),
    outcome: result.outcome,
    reason: result.reason,
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.enablementEligible === true ? { enablement_eligible: true } : {}),
    ...(result.failureCategory ? { failure_category: result.failureCategory } : {}),
  }))
}

class MaintenanceRequestError extends Error {
  constructor(readonly category: MaintenanceFailureCategory) {
    super(category)
    this.name = 'MaintenanceRequestError'
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error('response_too_large')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new Error('response_too_large')
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
  return new TextDecoder().decode(bytes)
}

function nonNegativeInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error('invalid_summary')
  return Number(value)
}

async function validateMaintenanceResponse(response: Response): Promise<MaintenanceSummary> {
  if (response.status !== 200) {
    let responseCode: string | null = null
    if ((response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      const record = parseJsonRecord(await readBoundedBody(response), MAX_RESPONSE_BYTES)
      responseCode = typeof record?.code === 'string' ? record.code : null
    } else {
      await response.body?.cancel().catch(() => undefined)
    }
    if (response.status === 401) throw new MaintenanceRequestError('http_401')
    if (response.status === 403) throw new MaintenanceRequestError('http_403')
    if (response.status === 429) throw new MaintenanceRequestError('http_429')
    if (response.status === 503 && responseCode === 'DELETION_MAINTENANCE_DISABLED') {
      throw new MaintenanceRequestError('http_503_disabled')
    }
    if (response.status === 503 && responseCode === 'DELETION_MAINTENANCE_UNAVAILABLE') {
      throw new MaintenanceRequestError('http_503_unavailable')
    }
    if (response.status === 503 && responseCode === 'INTERNAL_ERROR') {
      throw new MaintenanceRequestError('http_503_internal')
    }
    if (response.status === 503) throw new MaintenanceRequestError('http_503')
    if (response.status === 207) throw new MaintenanceRequestError('http_207')
    if (response.status >= 500) throw new MaintenanceRequestError('http_5xx')
    throw new MaintenanceRequestError('http_other')
  }
  if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    throw new MaintenanceRequestError('invalid_content_type')
  }
  const record = parseJsonRecord(await readBoundedBody(response), MAX_RESPONSE_BYTES)
  if (!record || Object.keys(record).sort().join('|') !== 'claimed|completed|failed|pending') {
    throw new MaintenanceRequestError('invalid_summary')
  }
  const summary = {
    claimed: nonNegativeInteger(record, 'claimed'),
    completed: nonNegativeInteger(record, 'completed'),
    pending: nonNegativeInteger(record, 'pending'),
    failed: nonNegativeInteger(record, 'failed'),
  }
  if (summary.completed + summary.pending + summary.failed !== summary.claimed || summary.failed > 0) {
    throw new MaintenanceRequestError('reported_failure')
  }
  return summary
}

function classifyMaintenanceFailure(error: unknown): MaintenanceFailureCategory {
  if (error instanceof MaintenanceRequestError) return error.category
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'request_timeout'
  }
  if (error instanceof Error) {
    if (error.message === 'response_too_large') return 'response_too_large'
    if (error.message === 'invalid_summary') return 'invalid_summary'
    if (error.message === 'reported_failure') return 'reported_failure'
    if (['missing_secret', 'invalid_target', 'invalid_access_credentials', 'missing_access_credentials',
      'unexpected_access_credentials', 'invalid_timeout'].includes(error.message)) return 'configuration_error'
  }
  return 'network_error'
}

function endpoint(origin: string, environment: string): URL {
  const parsed = new URL(origin)
  const expectedOrigin = environment === 'production'
    ? 'https://burillab.com'
    : 'https://staging.burillab.com'
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.origin !== expectedOrigin) {
    throw new Error('invalid_target')
  }
  return new URL('/api/internal/deletions/process', parsed.origin)
}

function accessHeaders(
  env: Pick<SchedulerEnvironment, 'CF_ACCESS_CLIENT_ID' | 'CF_ACCESS_CLIENT_SECRET'>,
  target: URL,
): Record<string, string> {
  const clientId = env.CF_ACCESS_CLIENT_ID?.trim()
  const clientSecret = env.CF_ACCESS_CLIENT_SECRET?.trim()
  if (Boolean(clientId) !== Boolean(clientSecret)) throw new Error('invalid_access_credentials')
  if (target.hostname === 'staging.burillab.com') {
    if (!clientId || !clientSecret) throw new Error('missing_access_credentials')
    return { 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret }
  }
  if (clientId || clientSecret) throw new Error('unexpected_access_credentials')
  return {}
}

function timeoutMs(raw: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1_000 || value > 50_000) throw new Error('invalid_timeout')
  return value
}

async function writeHealth<TStore extends RuntimeConfigStore>(
  env: SchedulerEnvironment<TStore>,
  health: SchedulerHealth,
): Promise<void> {
  await env.BURILLAB_RUNTIME_CONFIG.put(env.SCHEDULER_HEALTH_KEY, JSON.stringify(health))
}

async function disableDeletion<TStore extends RuntimeConfigStore>(
  env: SchedulerEnvironment<TStore>,
  observed: RuntimeConfig,
): Promise<void> {
  let latest = observed
  try {
    latest = parseRuntimeConfig(await env.BURILLAB_RUNTIME_CONFIG.get(env.RUNTIME_CONFIG_KEY)) ?? {
      voice_disposal_mode: 'redirect', kosha_content_mode: 'link_only',
      account_deletion_enabled: false, maintenance_worker_enabled: false,
      storage_backup_enabled: false,
    }
  } catch {
    latest = {
      voice_disposal_mode: 'redirect', kosha_content_mode: 'link_only',
      account_deletion_enabled: false, maintenance_worker_enabled: false,
      storage_backup_enabled: false,
    }
  }
  await env.BURILLAB_RUNTIME_CONFIG.put(env.RUNTIME_CONFIG_KEY, JSON.stringify({
    voice_disposal_mode: 'redirect',
    kosha_content_mode: latest.kosha_content_mode === 'full' ? 'full' : 'link_only',
    account_deletion_enabled: false,
    maintenance_worker_enabled: false,
    storage_backup_enabled: latest.storage_backup_enabled === true,
  } satisfies RuntimeConfig))
}

async function failClosed<TStore extends RuntimeConfigStore>(
  env: SchedulerEnvironment<TStore>,
  config: RuntimeConfig,
  reason: SchedulerResult['reason'],
): Promise<SchedulerResult> {
  try {
    await disableDeletion(env, config)
    return { outcome: 'disabled', reason }
  } catch {
    return { outcome: 'skipped_fail_closed', reason }
  }
}

export async function runDeletionScheduler<TStore extends RuntimeConfigStore>(
  env: SchedulerEnvironment<TStore>,
  scheduledAt = Date.now(),
  fetcher: Fetcher = fetch,
): Promise<SchedulerResult> {
  let runtimeRaw: string | null
  let healthRaw: string | null
  try {
    ;[runtimeRaw, healthRaw] = await Promise.all([
      env.BURILLAB_RUNTIME_CONFIG.get(env.RUNTIME_CONFIG_KEY),
      env.BURILLAB_RUNTIME_CONFIG.get(env.SCHEDULER_HEALTH_KEY),
    ])
  } catch {
    const result: SchedulerResult = { outcome: 'skipped_fail_closed', reason: 'runtime_config_unavailable' }
    logOutcome(env, scheduledAt, result)
    return result
  }
  const config = parseRuntimeConfig(runtimeRaw)
  if (!config) {
    const result: SchedulerResult = { outcome: 'skipped_fail_closed', reason: 'runtime_config_unavailable' }
    logOutcome(env, scheduledAt, result)
    return result
  }
  if (!config.maintenance_worker_enabled) {
    const result: SchedulerResult = { outcome: 'skipped_disabled', reason: 'runtime_disabled' }
    logOutcome(env, scheduledAt, result)
    return result
  }

  let health: SchedulerHealth
  try {
    health = parseHealth(healthRaw) ?? initialHealth(scheduledAt)
    if (healthRaw === null) await writeHealth(env, health)
  } catch {
    const result = await failClosed(env, config, 'health_unavailable')
    logOutcome(env, scheduledAt, result)
    return result
  }
  const lastKnownSuccess = health.last_success_at ?? health.first_observed_at
  if (scheduledAt - lastKnownSuccess >= STALE_SUCCESS_MS) {
    const result = await failClosed(env, config, 'success_record_stale')
    logOutcome(env, scheduledAt, result)
    return result
  }

  let summary: MaintenanceSummary | undefined
  let succeeded = false
  let failureCategory: MaintenanceFailureCategory | undefined
  try {
    const secret = env.DELETION_MAINTENANCE_SECRET.trim()
    if (secret.length < 32) throw new Error('missing_secret')
    const target = endpoint(env.DELETION_TARGET_ORIGIN, env.DELETION_ENVIRONMENT)
    const requestId = crypto.randomUUID()
    const response = await fetcher(target, {
      method: 'POST', body: null, cache: 'no-store', redirect: 'error',
      headers: {
        Accept: 'application/json', Authorization: `Bearer ${secret}`,
        'X-Request-ID': requestId, ...accessHeaders(env, target),
      },
      signal: AbortSignal.timeout(timeoutMs(env.REQUEST_TIMEOUT_MS)),
    })
    summary = await validateMaintenanceResponse(response)
    succeeded = true
  } catch (error) {
    succeeded = false
    failureCategory = classifyMaintenanceFailure(error)
  }

  const nextHealth: SchedulerHealth = succeeded
    ? {
        ...health, last_attempt_at: scheduledAt, last_success_at: scheduledAt,
        consecutive_failures: 0,
        consecutive_successes: health.consecutive_successes + 1,
        enablement_eligible: health.enablement_eligible
          || health.consecutive_successes + 1 >= READINESS_SUCCESSES,
      }
    : {
        ...health, last_attempt_at: scheduledAt,
        consecutive_failures: health.consecutive_failures + 1,
        consecutive_successes: 0, enablement_eligible: false,
      }
  try {
    await writeHealth(env, nextHealth)
  } catch {
    const result = await failClosed(env, config, 'health_write_failed')
    logOutcome(env, scheduledAt, result)
    return result
  }
  if (succeeded) {
    const result: SchedulerResult = {
      outcome: 'success', reason: 'completed', summary,
      enablementEligible: nextHealth.enablement_eligible,
    }
    logOutcome(env, scheduledAt, result)
    return result
  }
  if (nextHealth.consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
    const result = await failClosed(env, config, 'maintenance_request_failed')
    const diagnosed = { ...result, failureCategory }
    logOutcome(env, scheduledAt, diagnosed)
    return diagnosed
  }
  const result: SchedulerResult = {
    outcome: 'skipped_fail_closed', reason: 'maintenance_request_failed', failureCategory,
  }
  logOutcome(env, scheduledAt, result)
  return result
}

export function handleHttpRequest(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
