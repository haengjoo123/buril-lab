import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  resolveSmokeTarget, smokeApiUrl, requestBudget, verifyApiHeaders, verifyCabinet,
  verifyPhotoPath, photoPathFromUrl, newOwnedRowIds, validateSmokeJournal, verifySmokeCacheRow,
  safeFailure, SmokeError, MAX_API_REQUESTS, MAX_PAID_REQUESTS, VOICE_LOCATION_INPUT,
} from './ops3-live-smoke-safety.mjs'
import { generateClassificationCacheKey } from '../functions/api/ai/classify'
import { generateDisposalGuideCacheKey } from '../functions/api/ai/disposal-guide'

const ownerId = '20000000-0000-4000-8000-000000000003'
const cabinetId = '20000000-0000-4000-8000-000000000004'
const labId = '10000000-0000-4000-8000-000000000010'
const rowId = '20000000-0000-4000-8000-000000000005'
const priorId = '20000000-0000-4000-8000-000000000006'
const inventoryId = '20000000-0000-4000-8000-000000000010'
const supabase = 'https://qpgnomuqdcucjmxrunnw.supabase.co'
const sha = 'a'.repeat(40)
const targetId = '7237c27b-e24f-4e74-8889-f1aeb1da4f74'
const environment = {
  OPS3_TARGET_COMMIT_SHA: sha, OPS3_TARGET_DEPLOYMENT_ID: targetId, OPS3_STAGING_RUN_ID: '123',
  OPS3_CONFIRMATION: `VERIFY OPS3 STAGING ${targetId} ${sha} 123`,
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'haengjoo123/buril-lab',
  GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'b'.repeat(40), GITHUB_RUN_ID: '456', SUPABASE_URL: supabase,
}
const target = resolveSmokeTarget(environment)
const nonce = 'c'.repeat(32)
const marker = `ops3-456-${nonce}`
const startedAt = new Date(Date.now() - 3000).toISOString()
const createdAt = new Date(Date.now() - 1000).toISOString()
const state = { schemaVersion: 1, targetSha: sha, verificationRunId: '456', deploymentId: targetId,
  nonce, marker, cabinetName: `Ops3 synthetic ${marker}`, startedAt, ownerId, cabinetId: null, aliasIds: [], feedbackIds: [] }

describe('Ops3 live Staging verification safety', () => {
  it('pins a successful target without requiring the runtime to equal the newer verification source', () => {
    expect(target).toMatchObject({ sha, sourceSha: 'b'.repeat(40), immutableOrigin: 'https://7237c27b.buril-lab-staging.pages.dev' })
    expect(validateSmokeJournal(state, target)).toBe(state)
  })
  it.each([
    ['SUPABASE_URL', 'https://zafxzidbtbryiksemlwc.supabase.co'],
    ['SUPABASE_URL', `${supabase}/`], ['GITHUB_REF', 'refs/heads/test'], ['GITHUB_EVENT_NAME', 'pull_request'],
    ['GITHUB_REPOSITORY', 'fork/buril-lab'], ['GITHUB_RUN_ATTEMPT', '2'],
    ['OPS3_TARGET_COMMIT_SHA', 'abc'], ['OPS3_TARGET_DEPLOYMENT_ID', '../other'],
    ['OPS3_STAGING_RUN_ID', '1;true'], ['OPS3_CONFIRMATION', 'approved'],
  ])('refuses a changed protected boundary: %s', (key, value) => {
    expect(() => resolveSmokeTarget({ ...environment, [key]: value })).toThrow()
  })
  it.each(['/api/account/delete', '/api/admin/analytics/export', 'https://burillab.com/api/ai/classify', '//other/api/ai/classify', '/api/ai/../ai/classify'])('never sends credentials to %s', (value) => {
    expect(() => smokeApiUrl(value)).toThrow('UNAPPROVED_API_TARGET')
  })
  it('bounds both the successful paid path and the total diagnostic request count', () => {
    const paid = requestBudget()
    for (let i = 0; i < MAX_PAID_REQUESTS; i++) paid.take(true)
    expect(() => paid.take(true)).toThrow('REQUEST_BUDGET_EXHAUSTED')
    expect(paid.counts().paidRequests).toBe(9)
    const all = requestBudget()
    for (let i = 0; i < MAX_API_REQUESTS; i++) all.take()
    expect(() => all.take()).toThrow('REQUEST_BUDGET_EXHAUSTED')
  })
  it('requires actual security headers, including errors', () => {
    const headers = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-request-id': rowId })
    expect(() => verifyApiHeaders(headers)).not.toThrow()
    headers.set('cache-control', 'public')
    expect(() => verifyApiHeaders(headers)).toThrow('API_SECURITY_HEADERS')
  })
  const cabinet = { id: cabinetId, lab_id: labId, user_id: ownerId, name: state.cabinetName, created_at: createdAt }
  it('only selects the fresh exact run cabinet and exact flat WebP key', () => {
    expect(verifyCabinet(cabinet, state)).toBe(cabinetId)
    const key = `${cabinetId}-${rowId}.webp`
    expect(verifyPhotoPath(key, cabinetId)).toBe(key)
    expect(photoPathFromUrl(`${supabase}/storage/v1/object/public/cabinets/${key}`, cabinetId)).toBe(key)
  })
  it.each([{ user_id: priorId }, { lab_id: priorId }, { name: 'someone else' }, { created_at: '2020-01-01T00:00:00Z' }])('refuses different cabinet ownership %j', (change) => {
    expect(() => verifyCabinet({ ...cabinet, ...change }, state)).toThrow('CABINET_OWNERSHIP_MISMATCH')
  })
  it.each([`${cabinetId}-${rowId}.png`, `${cabinetId}/../${rowId}.webp`, `${priorId}-${rowId}.webp`, `${cabinetId}-${rowId}.webp/other`])('refuses a non-exact photo path %s', (key) => {
    expect(() => verifyPhotoPath(key, cabinetId)).toThrow()
  })
  it('preserves old voice rows and deletes only new exact-owner source rows', () => {
    const row = { id: rowId, user_id: ownerId, lab_id: labId, created_at: createdAt, source_item_type: 'inventory', source_item_id: inventoryId }
    expect(newOwnedRowIds([priorId], [{ id: priorId }, row], { ownerId, kind: 'aliases', startedAt })).toEqual([rowId])
    expect(newOwnedRowIds([priorId], [{ id: priorId }], { ownerId, kind: 'aliases', startedAt })).toEqual([])
    for (const change of [{ user_id: priorId }, { lab_id: priorId }, { source_item_id: priorId }, { created_at: '2020-01-01T00:00:00Z' }]) {
      expect(() => newOwnedRowIds([], [{ ...row, ...change }], { ownerId, kind: 'aliases', startedAt })).toThrow()
    }
    expect(() => newOwnedRowIds([priorId], [row], { ownerId, kind: 'aliases', startedAt })).toThrow('PRIOR_ROWS_CHANGED')
    expect(() => newOwnedRowIds([], [{ ...row, raw_input: 'other request' }], { ownerId, kind: 'feedback', startedAt })).toThrow('FEEDBACK_SCOPE_MISMATCH')
    expect(newOwnedRowIds([], [{ ...row, raw_input: VOICE_LOCATION_INPUT }], { ownerId, kind: 'feedback', startedAt })).toEqual([rowId])
  })
  it('recognizes cache keys produced by the real handlers, not a cleanup-only replica', () => {
    for (const variant of ['new', 'legacy']) {
      const classify = generateClassificationCacheKey({ name: `Water ${marker} ${variant}`, casNumber: '7732-18-5', molecularFormula: 'H2O' })
      const guide = generateDisposalGuideCacheKey({ chemicals: [{ name: 'Water', casNumber: '7732-18-5' }], batch: { batchId: `${marker}-${variant}` }, decision: { decisionStatus: 'needs_input' } })
      expect(verifySmokeCacheRow({ id: rowId, api_type: 'classify', cache_key: classify, created_at: createdAt }, state)).toBe(rowId)
      expect(verifySmokeCacheRow({ id: rowId, api_type: 'disposal_guide', cache_key: guide, created_at: createdAt }, state)).toBe(rowId)
      expect(() => verifySmokeCacheRow({ id: rowId, api_type: 'classify', cache_key: classify.replace(marker, 'another-run'), created_at: createdAt }, state)).toThrow()
    }
  })
  it('does not trust a journal for another run, owner type or stale interval', () => {
    for (const change of [{ verificationRunId: '789' }, { targetSha: 'b'.repeat(40) }, { marker: 'arbitrary' }, { ownerId: 'bad' }, { cabinetId: '../bad' }, { startedAt: '2020-01-01T00:00:00Z' }, { aliasIds: ['bad'] }]) {
      expect(() => validateSmokeJournal({ ...state, ...change }, target)).toThrow()
    }
  })
  it('never publishes provider error text or arbitrary assertion messages', () => {
    expect(safeFailure(new Error('sensitive database text'))).toBe('UNEXPECTED_FAILURE_REDACTED')
    expect(safeFailure(new SmokeError('PHOTO_HASH_MISMATCH'))).toBe('PHOTO_HASH_MISMATCH')
    expect(safeFailure(new SmokeError('untrusted secret'))).toBe('INVALID_DIAGNOSTIC')
  })
  it('uses only the existing Staging credentials and an always-cleanup manual main workflow', () => {
    const workflow = readFileSync('.github/workflows/verify-ops3-staging-live.yml', 'utf8')
    const runner = readFileSync('scripts/verify-ops3-staging-live.mjs', 'utf8')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('group: cloudflare-staging')
    expect(workflow).toContain('verify-github-staging-run.mjs')
    expect(workflow).toContain('verify-github-quality-run.mjs')
    expect(workflow).toContain("if: always() && steps.live.outcome != 'skipped'")
    expect(workflow).not.toMatch(/EPHEMERAL_TOKEN|SUPABASE_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN|wrangler |secret set|pull_request_target|upload-artifact/)
    expect(runner).not.toMatch(/extraHTTPHeaders|storageState:|recordVideo:|\.screenshot\(|tracing\.start|console\.(?:error|log)\(error/)
    expect(runner).toContain('uploadSha256 === hash(bytes)')
    expect(runner).toContain("scope: 'global'")
    expect(runner).not.toContain("from('audit_logs').delete")
  })
})
