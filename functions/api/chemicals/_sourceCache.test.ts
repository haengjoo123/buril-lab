import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}))

vi.mock('./_cache', () => ({
  CHEMICAL_ENRICHMENT_RESULT_VERSION: 3,
  createChemicalCacheAdminClient: mocks.createAdminClient,
}))

import {
  readChemicalSourceCache,
  releaseChemicalLease,
  tryAcquireChemicalLease,
  writeChemicalSourceCache,
} from './_sourceCache'

describe('chemical source cache and distributed lease adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('reads only a fresh version-3 KOSHA source row', async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {}
    query.select = vi.fn(() => query)
    query.eq = vi.fn(() => query)
    query.gt = vi.fn(() => query)
    query.maybeSingle = vi.fn(async () => ({
      data: {
        cache_status: 'complete',
        result: { status: 'available', value: 7.5 },
        fetched_at: '2026-08-17T00:00:00.000Z',
        expires_at: '2026-09-16T00:00:00.000Z',
      },
      error: null,
    }))
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => query) })

    await expect(readChemicalSourceCache({}, 'reference_ph', 'cas:127-09-3')).resolves.toMatchObject({
      status: 'complete',
      result: { status: 'available', value: 7.5 },
    })
    expect(query.eq).toHaveBeenCalledWith('result_version', 3)
    expect(query.gt).toHaveBeenCalledWith('expires_at', expect.any(String))
  })

  it('writes every alias with the same result version and expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T00:00:00.000Z'))
    const upsert = vi.fn(async () => ({ error: null }))
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => ({ upsert })) })

    await writeChemicalSourceCache(
      {},
      'reference_ph',
      ['chem_id:003232', 'cas:127-09-3'],
      'complete',
      { status: 'available', value: 7.5 },
      60_000,
    )
    const rows = upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows.map((row) => row.lookup_key)).toEqual(['chem_id:003232', 'cas:127-09-3'])
    expect(rows.every((row) => row.result_version === 3 && row.expires_at === '2026-08-17T00:01:00.000Z')).toBe(true)
  })

  it('acquires and releases a lease with owner-matched RPCs', async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name.startsWith('try_'), error: null }))
    mocks.createAdminClient.mockReturnValue({ rpc })

    await expect(tryAcquireChemicalLease({}, 'kosha:reference_ph:003232', '11111111-1111-4111-8111-111111111111')).resolves.toBe(true)
    await releaseChemicalLease({}, 'kosha:reference_ph:003232', '11111111-1111-4111-8111-111111111111')
    expect(rpc).toHaveBeenNthCalledWith(1, 'try_acquire_chemical_enrichment_lease', expect.objectContaining({
      p_result_version: 3,
      p_lease_seconds: 30,
    }))
    expect(rpc).toHaveBeenNthCalledWith(2, 'release_chemical_enrichment_lease', expect.objectContaining({
      p_result_version: 3,
    }))
  })
})
