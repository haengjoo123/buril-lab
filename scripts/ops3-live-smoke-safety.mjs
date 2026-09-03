import { createHash } from 'node:crypto'
import { GATE0_STAGING_ORIGIN, GATE0_RESERVED_LAB_ID, GATE0_RESERVED_INVENTORY_ID } from './gate0-seed-safety.mjs'

export const SMOKE_ORIGIN = 'https://staging.burillab.com'
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA = /^[0-9a-f]{40}$/
export const MAX_API_REQUESTS = 28
export const MAX_PAID_REQUESTS = 9
export const VOICE_LOCATION_INPUT = 'Gate0 Synthetic Powder 위치를 알려줘'
export const SMOKE_API_PATHS = Object.freeze([
  '/api/ai/scan-label', '/api/ai/classify', '/api/ai/disposal-guide',
  '/api/gemini/scan-label', '/api/gemini/classify', '/api/gemini/disposal-guide',
  '/api/voice/query', '/api/voice/speak', '/api/voice/transcribe',
  '/api/ops3-smoke-not-a-route',
])

export class SmokeError extends Error {
  constructor(code) {
    super(/^[A-Z0-9_]{1,80}$/.test(code) ? code : 'INVALID_DIAGNOSTIC')
    this.name = 'SmokeError'
  }
}
export function check(value, code) { if (!value) throw new SmokeError(code) }
export function safeFailure(error) { return error instanceof SmokeError ? error.message : 'UNEXPECTED_FAILURE_REDACTED' }
export function hash(value) { return createHash('sha256').update(value).digest('hex') }

export function resolveSmokeTarget(env) {
  const sha = env.OPS3_TARGET_COMMIT_SHA
  const deploymentId = env.OPS3_TARGET_DEPLOYMENT_ID
  const runId = env.OPS3_STAGING_RUN_ID
  check(SHA.test(sha || '') && UUID.test(deploymentId || '') && /^[1-9][0-9]{0,19}$/.test(runId || ''), 'INVALID_TARGET')
  check(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REPOSITORY === 'haengjoo123/buril-lab'
    && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_RUN_ATTEMPT === '1'
    && SHA.test(env.GITHUB_SHA || '') && /^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID || ''), 'UNTRUSTED_RUN')
  check(env.OPS3_CONFIRMATION === `VERIFY OPS3 STAGING ${deploymentId} ${sha} ${runId}`, 'CONFIRMATION_MISMATCH')
  check(env.SUPABASE_URL === GATE0_STAGING_ORIGIN, 'NOT_EXACT_STAGING_DATABASE')
  return { sha, deploymentId, runId, sourceSha: env.GITHUB_SHA, verificationRunId: env.GITHUB_RUN_ID,
    immutableOrigin: `https://${deploymentId.slice(0, 8)}.buril-lab-staging.pages.dev` }
}

export function smokeApiUrl(path) {
  check(SMOKE_API_PATHS.includes(path), 'UNAPPROVED_API_TARGET')
  return `${SMOKE_ORIGIN}${path}`
}
export function requestBudget() {
  let requests = 0
  let paidRequests = 0
  return {
    take(paid = false) {
      check(requests < MAX_API_REQUESTS && (!paid || paidRequests < MAX_PAID_REQUESTS), 'REQUEST_BUDGET_EXHAUSTED')
      requests += 1
      if (paid) paidRequests += 1
    },
    counts: () => ({ requests, paidRequests }),
  }
}

export function verifyApiHeaders(headers) {
  check(headers.get('cache-control') === 'no-store' && headers.get('x-content-type-options') === 'nosniff'
    && headers.get('referrer-policy') === 'no-referrer' && UUID.test(headers.get('x-request-id') || ''), 'API_SECURITY_HEADERS')
}

export function verifyCabinet(cabinet, state) {
  check(cabinet && UUID.test(cabinet.id) && cabinet.lab_id === GATE0_RESERVED_LAB_ID
    && cabinet.user_id === state.ownerId && cabinet.name === state.cabinetName
    && Date.parse(cabinet.created_at) >= Date.parse(state.startedAt)
    && (!state.cabinetId || cabinet.id === state.cabinetId), 'CABINET_OWNERSHIP_MISMATCH')
  return cabinet.id
}

export function verifyPhotoPath(path, cabinetId) {
  check(UUID.test(cabinetId || '') && typeof path === 'string'
    && path.startsWith(`${cabinetId}-`) && path.endsWith('.webp')
    && UUID.test(path.slice(37, -5)), 'PHOTO_OWNERSHIP_MISMATCH')
  return path
}

export function photoPathFromUrl(url, cabinetId) {
  let parsed
  try { parsed = new URL(url) } catch { throw new SmokeError('PHOTO_URL_INVALID') }
  const prefix = '/storage/v1/object/public/cabinets/'
  check(parsed.origin === GATE0_STAGING_ORIGIN && !parsed.search && !parsed.hash
    && !parsed.username && !parsed.password && parsed.pathname.startsWith(prefix), 'PHOTO_URL_INVALID')
  return verifyPhotoPath(parsed.pathname.slice(prefix.length), cabinetId)
}

export function newOwnedRowIds(before, after, { ownerId, kind, startedAt }) {
  check(Array.isArray(before) && before.length <= 1000 && new Set(before).size === before.length
    && before.every((id) => UUID.test(id)) && Array.isArray(after) && after.length <= 1000, 'ROW_SNAPSHOT_INVALID')
  const known = new Set(before)
  const ids = new Set(after.map((row) => row.id))
  check(ids.size === after.length && before.every((id) => ids.has(id)), 'PRIOR_ROWS_CHANGED')
  return after.filter((row) => !known.has(row.id)).map((row) => {
    check(UUID.test(row.id) && row.user_id === ownerId && row.lab_id === GATE0_RESERVED_LAB_ID
      && Date.parse(row.created_at) >= Date.parse(startedAt), 'ROW_OWNERSHIP_MISMATCH')
    if (kind === 'aliases') {
      check(row.source_item_type === 'inventory' && row.source_item_id === GATE0_RESERVED_INVENTORY_ID, 'ALIAS_SCOPE_MISMATCH')
    } else {
      check(kind === 'feedback' && row.raw_input === VOICE_LOCATION_INPUT, 'FEEDBACK_SCOPE_MISMATCH')
    }
    return row.id
  })
}

export function verifySmokeCacheRow(row, state) {
  check(UUID.test(row.id) && Date.parse(row.created_at) >= Date.parse(state.startedAt)
    && typeof row.cache_key === 'string' && row.cache_key.length <= 16384, 'CACHE_OWNERSHIP_MISMATCH')
  check(row.cache_key.startsWith(row.api_type === 'classify' ? 'classify:v3:{' : 'disposal_guide:v4:{'), 'CACHE_KEY_INVALID')
  const separator = row.cache_key.indexOf(':{')
  let data
  try { data = JSON.parse(row.cache_key.slice(separator + 1)) } catch { throw new SmokeError('CACHE_KEY_INVALID') }
  const variant = ['new', 'legacy'].find((value) => (
    row.api_type === 'classify'
      ? data.name === `Water ${state.marker} ${value}` && data.casNumber === '7732-18-5' && data.molecularFormula === 'H2O'
      : data.batch?.batchId === `${state.marker}-${value}`
        && data.chemicals?.length === 1 && data.chemicals[0].casNumber === '7732-18-5'
        && data.decision?.decisionStatus === 'needs_input'
  ))
  check(['classify', 'disposal_guide'].includes(row.api_type) && separator > 0 && variant, 'CACHE_SCOPE_MISMATCH')
  return row.id
}

export function validateSmokeJournal(state, target) {
  check(state?.schemaVersion === 1 && state.verificationRunId === target.verificationRunId
    && state.targetSha === target.sha && state.deploymentId === target.deploymentId
    && UUID.test(state.ownerId || '') && /^[0-9a-f]{32}$/.test(state.nonce || '')
    && state.marker === `ops3-${target.verificationRunId}-${state.nonce}`
    && state.cabinetName === `Ops3 synthetic ${state.marker}`
    && Number.isFinite(Date.parse(state.startedAt)) && Date.parse(state.startedAt) <= Date.now()
    && Date.now() - Date.parse(state.startedAt) < 24 * 60 * 60 * 1000
    && (state.cabinetId === null || UUID.test(state.cabinetId)), 'JOURNAL_SCOPE_MISMATCH')
  for (const ids of [state.aliasIds, state.feedbackIds]) {
    check(Array.isArray(ids) && ids.length <= 1000 && ids.every((id) => UUID.test(id)) && new Set(ids).size === ids.length, 'JOURNAL_SNAPSHOT_INVALID')
  }
  return state
}
