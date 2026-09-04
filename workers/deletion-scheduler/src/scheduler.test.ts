import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleHttpRequest, runDeletionScheduler, type SchedulerEnvironment } from './scheduler'

const RUNTIME_KEY = 'runtime_config'
const HEALTH_KEY = 'scheduler:deletion-maintenance:health:v1'
const NOW = Date.parse('2026-09-04T01:00:00Z')

class FakeKv {
  readonly values = new Map<string, string>()
  failGet = false
  failPut = false
  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error('unavailable')
    return this.values.get(key) ?? null
  }
  async put(key: string, value: string): Promise<void> {
    if (this.failPut) throw new Error('unavailable')
    this.values.set(key, value)
  }
}

function config(enabled = true) {
  return {
    voice_disposal_mode: 'redirect', kosha_content_mode: 'full',
    account_deletion_enabled: false, maintenance_worker_enabled: enabled,
    storage_backup_enabled: true,
  }
}

function environment(kv = new FakeKv(), name = 'staging'): SchedulerEnvironment<FakeKv> {
  kv.values.set(RUNTIME_KEY, JSON.stringify(config()))
  return {
    BURILLAB_RUNTIME_CONFIG: kv,
    DELETION_ENVIRONMENT: name,
    DELETION_TARGET_ORIGIN: name === 'production' ? 'https://burillab.com' : 'https://staging.burillab.com',
    RUNTIME_CONFIG_KEY: RUNTIME_KEY,
    SCHEDULER_HEALTH_KEY: HEALTH_KEY,
    REQUEST_TIMEOUT_MS: '45000',
    DELETION_MAINTENANCE_SECRET: 'purpose-specific-secret-at-least-32-characters',
    ...(name === 'staging' ? {
      CF_ACCESS_CLIENT_ID: 'staging-access-id',
      CF_ACCESS_CLIENT_SECRET: 'staging-access-secret',
    } : {}),
  }
}

function ok(summary = { claimed: 1, completed: 1, pending: 0, failed: 0 }): Response {
  return new Response(JSON.stringify(summary), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('Ops11 deletion Scheduler', () => {
  it('calls only the fixed internal endpoint with Staging Access and purpose secret', async () => {
    const kv = new FakeKv()
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new URL(String(input)).href).toBe('https://staging.burillab.com/api/internal/deletions/process')
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer purpose-specific-secret-at-least-32-characters')
      expect(headers.get('CF-Access-Client-Id')).toBe('staging-access-id')
      expect(headers.get('CF-Access-Client-Secret')).toBe('staging-access-secret')
      return ok()
    })
    await expect(runDeletionScheduler(environment(kv), NOW, fetcher)).resolves.toMatchObject({
      outcome: 'success', reason: 'completed',
    })
  })

  it('never sends Staging Access credentials to production', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.has('CF-Access-Client-Id')).toBe(false)
      expect(headers.has('CF-Access-Client-Secret')).toBe(false)
      return ok({ claimed: 0, completed: 0, pending: 0, failed: 0 })
    })
    await expect(runDeletionScheduler(environment(new FakeKv(), 'production'), NOW, fetcher))
      .resolves.toMatchObject({ outcome: 'success' })
  })

  it('fails closed when runtime config or health storage is unavailable', async () => {
    const missing = new FakeKv()
    missing.values.clear()
    const missingEnv = environment(missing)
    missing.values.clear()
    await expect(runDeletionScheduler(missingEnv, NOW, vi.fn())).resolves.toMatchObject({
      outcome: 'skipped_fail_closed', reason: 'runtime_config_unavailable',
    })
    const broken = new FakeKv()
    const brokenEnv = environment(broken)
    broken.failGet = true
    await expect(runDeletionScheduler(brokenEnv, NOW, vi.fn())).resolves.toMatchObject({
      outcome: 'skipped_fail_closed', reason: 'runtime_config_unavailable',
    })
  })

  it.each([
    ['401', () => new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } })],
    ['503', () => new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })],
    ['207', () => new Response('{}', { status: 207, headers: { 'Content-Type': 'application/json' } })],
    ['invalid JSON', () => new Response('{broken', { status: 200, headers: { 'Content-Type': 'application/json' } })],
    ['reported failure', () => ok({ claimed: 1, completed: 0, pending: 0, failed: 1 })],
  ])('turns both deletion switches OFF after two consecutive %s responses', async (_label, makeResponse) => {
    const kv = new FakeKv()
    const schedulerEnv = environment(kv)
    const fetcher = vi.fn(async () => makeResponse())
    await expect(runDeletionScheduler(schedulerEnv, NOW, fetcher)).resolves.toMatchObject({
      outcome: 'skipped_fail_closed', reason: 'maintenance_request_failed',
    })
    await expect(runDeletionScheduler(schedulerEnv, NOW + 60_000, fetcher)).resolves.toMatchObject({
      outcome: 'disabled', reason: 'maintenance_request_failed',
    })
    expect(JSON.parse(kv.values.get(RUNTIME_KEY) ?? '{}')).toEqual({
      voice_disposal_mode: 'redirect', kosha_content_mode: 'full',
      account_deletion_enabled: false, maintenance_worker_enabled: false,
      storage_backup_enabled: true,
    })
  })

  it('turns both switches OFF when no success was recorded for three minutes', async () => {
    const kv = new FakeKv()
    const schedulerEnv = environment(kv)
    await runDeletionScheduler(schedulerEnv, NOW, vi.fn(async () => ok()))
    await expect(runDeletionScheduler(schedulerEnv, NOW + 3 * 60_000, vi.fn()))
      .resolves.toMatchObject({ outcome: 'disabled', reason: 'success_record_stale' })
  })

  it('records three successes as eligible but never turns intake ON itself', async () => {
    const kv = new FakeKv()
    const schedulerEnv = environment(kv)
    const fetcher = vi.fn(async () => ok({ claimed: 0, completed: 0, pending: 0, failed: 0 }))
    await runDeletionScheduler(schedulerEnv, NOW, fetcher)
    await runDeletionScheduler(schedulerEnv, NOW + 60_000, fetcher)
    const third = await runDeletionScheduler(schedulerEnv, NOW + 120_000, fetcher)
    expect(third.enablementEligible).toBe(true)
    expect(JSON.parse(kv.values.get(HEALTH_KEY) ?? '{}')).toMatchObject({
      consecutive_successes: 3, enablement_eligible: true,
    })
    expect(JSON.parse(kv.values.get(RUNTIME_KEY) ?? '{}').account_deletion_enabled).toBe(false)
  })

  it('exposes no HTTP trigger', () => {
    const response = handleHttpRequest()
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
