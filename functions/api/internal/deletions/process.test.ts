import { describe, expect, it, vi } from 'vitest'
import {
  runDeletionProcessor,
  type ClaimedDeletionJob,
  type DeletionProcessorGateway,
} from './_processor'
import { handleDeletionProcessorRequest, type DeletionProcessorEnv } from './process'

const ACCOUNT: ClaimedDeletionJob = {
  jobId: '11111111-1111-4111-8111-111111111111',
  kind: 'account',
  subjectUserId: '22222222-2222-4222-8222-222222222222',
  labId: null,
  stage: 'queued',
  attemptCount: 1,
  leaseToken: '33333333-3333-4333-8333-333333333333',
}

function gateway(overrides: Partial<DeletionProcessorGateway> = {}): DeletionProcessorGateway {
  return {
    acquireRun: vi.fn().mockResolvedValue(true),
    releaseRun: vi.fn().mockResolvedValue(undefined),
    claimJobs: vi.fn().mockResolvedValue([ACCOUNT]),
    prepareDatabase: vi.fn().mockResolvedValue('storage'),
    listFileTargets: vi.fn().mockResolvedValue([{ bucket: 'cabinets', path: 'users/u/cabinets/c/file.webp' }]),
    deleteFiles: vi.fn().mockResolvedValue(undefined),
    markStorageComplete: vi.fn().mockResolvedValue('auth'),
    deleteAuthUser: vi.fn().mockResolvedValue(undefined),
    markAuthComplete: vi.fn().mockResolvedValue('finalize'),
    finalizeJob: vi.fn().mockResolvedValue(undefined),
    scheduleRetry: vi.fn().mockResolvedValue('retry_wait'),
    ...overrides,
  }
}

function runtimeConfig(maintenance = true) {
  return {
    voice_disposal_mode: 'redirect', kosha_content_mode: 'full',
    account_deletion_enabled: false, maintenance_worker_enabled: maintenance,
    storage_backup_enabled: true,
  }
}

function env(maintenance = true): DeletionProcessorEnv {
  return {
    DELETION_MAINTENANCE_SECRET: 'purpose-specific-secret-at-least-32-characters',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
    BURILLAB_RUNTIME_CONFIG: {
      get: vi.fn().mockResolvedValue(runtimeConfig(maintenance)),
    },
  }
}

function request(secret = 'purpose-specific-secret-at-least-32-characters'): Request {
  return new Request('https://example.test/api/internal/deletions/process', {
    method: 'POST', headers: { Authorization: `Bearer ${secret}` },
  })
}

describe('Ops11 deletion processor', () => {
  it('runs database, Storage, Auth, and finalize in order for one account job', async () => {
    const testGateway = gateway()
    await expect(runDeletionProcessor(testGateway)).resolves.toEqual({
      claimed: 1, completed: 1, pending: 0, failed: 0,
    })
    expect(testGateway.prepareDatabase).toHaveBeenCalledWith(ACCOUNT)
    expect(testGateway.deleteFiles).toHaveBeenCalledOnce()
    expect(testGateway.deleteAuthUser).toHaveBeenCalledWith(ACCOUNT.subjectUserId)
    expect(testGateway.finalizeJob).toHaveBeenCalledWith(ACCOUNT)
    expect(testGateway.releaseRun).toHaveBeenCalledOnce()
  })

  it('resumes a lab job at Storage and never deletes an Auth user', async () => {
    const lab = { ...ACCOUNT, kind: 'lab' as const, subjectUserId: null,
      labId: '44444444-4444-4444-8444-444444444444', stage: 'storage' as const }
    const testGateway = gateway({ claimJobs: vi.fn().mockResolvedValue([lab]) })
    await expect(runDeletionProcessor(testGateway)).resolves.toMatchObject({ completed: 1 })
    expect(testGateway.prepareDatabase).not.toHaveBeenCalled()
    expect(testGateway.deleteAuthUser).not.toHaveBeenCalled()
  })

  it('records an intermediate failure for retry and keeps the run successful', async () => {
    const testGateway = gateway({ deleteFiles: vi.fn().mockRejectedValue(new Error('private detail')) })
    await expect(runDeletionProcessor(testGateway)).resolves.toEqual({
      claimed: 1, completed: 0, pending: 1, failed: 0,
    })
    expect(testGateway.scheduleRetry).toHaveBeenCalledWith(ACCOUNT, 'STORAGE_STAGE_FAILED')
  })

  it('reports a terminal twelfth-attempt failure without leaking the provider error', async () => {
    const testGateway = gateway({
      prepareDatabase: vi.fn().mockRejectedValue(new Error('raw database response')),
      scheduleRetry: vi.fn().mockResolvedValue('failed'),
    })
    await expect(runDeletionProcessor(testGateway)).resolves.toEqual({
      claimed: 1, completed: 0, pending: 0, failed: 1,
    })
    expect(testGateway.scheduleRetry).toHaveBeenCalledWith(ACCOUNT, 'DATABASE_STAGE_FAILED')
  })

  it('does not claim work when another run holds the database lease', async () => {
    const testGateway = gateway({ acquireRun: vi.fn().mockResolvedValue(false) })
    await expect(runDeletionProcessor(testGateway)).resolves.toEqual({
      claimed: 0, completed: 0, pending: 0, failed: 0,
    })
    expect(testGateway.claimJobs).not.toHaveBeenCalled()
    expect(testGateway.releaseRun).not.toHaveBeenCalled()
  })

  it('always releases the database run lease after a claimed-run failure', async () => {
    const testGateway = gateway({ claimJobs: vi.fn().mockRejectedValue(new Error('offline')) })
    await expect(runDeletionProcessor(testGateway)).rejects.toThrow('offline')
    expect(testGateway.releaseRun).toHaveBeenCalledOnce()
  })

  it('requires its purpose-specific secret and the fail-closed runtime switch', async () => {
    const missing = await handleDeletionProcessorRequest({ request: request(), env: {} })
    expect(missing.status).toBe(503)
    const wrong = await handleDeletionProcessorRequest({ request: request('wrong'), env: env() })
    expect(wrong.status).toBe(401)
    const disabled = await handleDeletionProcessorRequest({ request: request(), env: env(false) })
    expect(disabled.status).toBe(503)
    expect(disabled.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns only bounded summary fields and 207 when a worker failure remains', async () => {
    const response = await handleDeletionProcessorRequest(
      { request: request(), env: env() },
      vi.fn().mockResolvedValue({ claimed: 1, completed: 0, pending: 0, failed: 1 }),
    )
    expect(response.status).toBe(207)
    await expect(response.json()).resolves.toEqual({ claimed: 1, completed: 0, pending: 0, failed: 1 })
  })

  it('generalizes unexpected processor errors', async () => {
    const response = await handleDeletionProcessorRequest(
      { request: request(), env: env() },
      vi.fn().mockRejectedValue(new Error('secret raw database message')),
    )
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('secret raw database message')
  })
})
