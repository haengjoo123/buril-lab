import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())

vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

import { onRequestPost, publicCleanupWarnings } from './delete'

function request() {
  return new Request('https://example.test/api/account/delete', {
    method: 'POST',
    headers: { Authorization: 'Bearer session-token' },
  })
}

function fullRuntimeConfig(accountDeletionEnabled: boolean) {
  return {
    get: vi.fn().mockResolvedValue({
      voice_disposal_mode: 'redirect',
      kosha_content_mode: 'full',
      account_deletion_enabled: accountDeletionEnabled,
      maintenance_worker_enabled: false,
      storage_backup_enabled: false,
    }),
  }
}

describe('account deletion runtime kill switch', () => {
  beforeEach(() => createClientMock.mockReset())

  it.each([
    ['missing binding', undefined],
    ['disabled value', fullRuntimeConfig(false)],
    ['partial value', { get: vi.fn().mockResolvedValue({ account_deletion_enabled: true }) }],
    ['KV failure', { get: vi.fn().mockRejectedValue(new Error('KV unavailable')) }],
  ])('returns 503 before creating a DB client when %s', async (_label, namespace) => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await onRequestPost({
      request: request(),
      env: { BURILLAB_RUNTIME_CONFIG: namespace },
    })

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(createClientMock).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe('public account cleanup warnings', () => {
  it('preserves an empty warning list', () => {
    expect(publicCleanupWarnings([])).toEqual([])
  })

  it('does not disclose provider messages, identifiers, or internal table names', () => {
    const internal = [{ step: 'Delete private_table', error: 'DATABASE_SENSITIVE_DO_NOT_EXPOSE' }]
    const result = publicCleanupWarnings(internal)

    expect(result).toEqual([{
      step: 'Account cleanup',
      error: 'Some account data could not be fully removed. Please contact support.',
    }])
    expect(JSON.stringify(result)).not.toContain('private_table')
    expect(JSON.stringify(result)).not.toContain('DATABASE_SENSITIVE_DO_NOT_EXPOSE')
    expect(internal[0].error).toBe('DATABASE_SENSITIVE_DO_NOT_EXPOSE')
  })
})
