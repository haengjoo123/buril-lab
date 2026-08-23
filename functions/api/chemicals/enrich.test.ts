import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChemicalEnrichmentResult } from '../../../src/types'

const mocks = vi.hoisted(() => ({
  enrichChemicalItem: vi.fn(),
  readChemicalEnrichmentCache: vi.fn(),
  writeChemicalEnrichmentCache: vi.fn(),
  verifyLabMembership: vi.fn(),
  projectLegacyGhsCache: vi.fn(),
  createChemicalCacheAdminClient: vi.fn(),
  resolveKoshaIdentityByCas: vi.fn(),
  resolveKoshaReferencePh: vi.fn(),
}))

vi.mock('./_pipeline', () => ({
  enrichChemicalItem: mocks.enrichChemicalItem,
}))

vi.mock('./_cache', () => ({
  getChemicalLookupKeys: (item: { casNumber?: string; name?: string }) => [item.casNumber || item.name || 'unknown'],
  readChemicalEnrichmentCache: mocks.readChemicalEnrichmentCache,
  writeChemicalEnrichmentCache: mocks.writeChemicalEnrichmentCache,
  verifyLabMembership: mocks.verifyLabMembership,
  projectLegacyGhsCache: mocks.projectLegacyGhsCache,
  createChemicalCacheAdminClient: mocks.createChemicalCacheAdminClient,
}))

vi.mock('./_kosha', () => ({
  resolveKoshaIdentityByCas: mocks.resolveKoshaIdentityByCas,
  resolveKoshaReferencePh: mocks.resolveKoshaReferencePh,
}))

import { hydrateKoshaSupplement, onRequestPost } from './enrich'

const completeResult: ChemicalEnrichmentResult = {
  requestId: 'one',
  overallStatus: 'complete',
  identity: { status: 'verified', casNumber: '127-09-3', pubchemCid: 31372, equivalentPubchemCids: [31372, 517045], evidence: [] },
  hazard: { status: 'not_classified', hCodes: [], hazardStatements: [], pictograms: [], hazardFlags: [], sources: [], fetchedAt: '2026-08-17T00:00:00.000Z' },
  referencePh: { status: 'source_absent', source: 'kosha' },
  phCatalog: { status: 'matched', id: 'sodium-acetate', candidateIds: ['sodium-acetate'], catalogVersion: 'test' },
  enrichmentVersion: 3,
}

function context(body: unknown, data: Record<string, unknown> = {}) {
  const background: Promise<unknown>[] = []
  return {
    background,
    value: {
      request: new Request('https://example.test/api/chemicals/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env: {},
      data,
      waitUntil: (promise: Promise<unknown>) => background.push(promise),
    },
  }
}

describe('POST /api/chemicals/enrich', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readChemicalEnrichmentCache.mockResolvedValue(null)
    mocks.enrichChemicalItem.mockResolvedValue(completeResult)
    mocks.writeChemicalEnrichmentCache.mockResolvedValue(undefined)
    mocks.projectLegacyGhsCache.mockResolvedValue(undefined)
    mocks.createChemicalCacheAdminClient.mockReturnValue(null)
    mocks.verifyLabMembership.mockResolvedValue(true)
    mocks.resolveKoshaIdentityByCas.mockResolvedValue({ kind: 'not_found' })
    mocks.resolveKoshaReferencePh.mockResolvedValue({ status: 'source_absent', source: 'kosha' })
  })

  it('validates batch size and CAS checksum before upstream calls', async () => {
    const oversized = context({ items: Array.from({ length: 26 }, (_, index) => ({ requestId: String(index), name: 'Water' })) })
    expect((await onRequestPost(oversized.value)).status).toBe(400)

    const invalidCas = context({ items: [{ requestId: 'bad', casNumber: '67-64-2' }] })
    expect((await onRequestPost(invalidCas.value)).status).toBe(400)
    expect(mocks.enrichChemicalItem).not.toHaveBeenCalled()
  })

  it('rejects a lab scope for a guest before enrichment', async () => {
    const request = context({
      items: [{ requestId: 'one', name: 'Sodium acetate' }],
      scope: { labId: '11111111-1111-4111-8111-111111111111' },
    })
    expect((await onRequestPost(request.value)).status).toBe(403)
    expect(mocks.enrichChemicalItem).not.toHaveBeenCalled()
  })

  it('returns normalized results and schedules server-only cache writes', async () => {
    const request = context({
      items: [{ requestId: 'one', name: 'Sodium acetate' }],
      scope: { labId: '11111111-1111-4111-8111-111111111111' },
    }, { userId: '22222222-2222-4222-8222-222222222222' })
    const response = await onRequestPost(request.value)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      results: [{
        ...completeResult,
        delivery: { freshness: 'fresh', source: 'upstream' },
      }],
    })
    expect(mocks.verifyLabMembership).toHaveBeenCalledOnce()
    expect(request.background).toHaveLength(1)
    await Promise.all(request.background)
    expect(mocks.writeChemicalEnrichmentCache).toHaveBeenCalledOnce()
    expect(mocks.projectLegacyGhsCache).toHaveBeenCalledOnce()
  })

  it('coalesces duplicate identities while preserving each request id', async () => {
    const request = context({
      items: [
        { requestId: 'first', name: 'Sodium acetate' },
        { requestId: 'second', name: 'Sodium acetate' },
      ],
    })
    const response = await onRequestPost(request.value)
    const payload = await response.json() as { results: ChemicalEnrichmentResult[] }
    expect(mocks.enrichChemicalItem).toHaveBeenCalledOnce()
    expect(payload.results.map((result) => result.requestId)).toEqual(['first', 'second'])
    await Promise.all(request.background)
  })

  it('resolves only an approved server-managed alias before enrichment', async () => {
    const aliasQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
    }
    aliasQuery.select.mockReturnValue(aliasQuery)
    aliasQuery.eq.mockReturnValue(aliasQuery)
    aliasQuery.in.mockResolvedValue({
      data: [{ normalized_alias: '빙초산', canonical_name: 'Acetic acid', cas_number: '64-19-7' }],
      error: null,
    })
    mocks.createChemicalCacheAdminClient.mockReturnValue({
      from: vi.fn(() => aliasQuery),
    })
    const request = context({ items: [{ requestId: 'one', name: '빙초산' }] })
    expect((await onRequestPost(request.value)).status).toBe(200)
    expect(mocks.enrichChemicalItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acetic acid', casNumber: '64-19-7' }),
      expect.anything(),
    )
  })

  it('returns a fresh server cache hit without repeating upstream enrichment', async () => {
    mocks.readChemicalEnrichmentCache.mockResolvedValue({
      result: completeResult,
      freshness: 'fresh',
      resultVersion: 3,
    })
    const request = context({
      profile: 'inventory_hazard',
      items: [{ requestId: 'cached', casNumber: '127-09-3' }],
    })
    const response = await onRequestPost(request.value)
    const payload = await response.json() as { results: ChemicalEnrichmentResult[] }
    expect(payload.results[0]).toMatchObject({
      referencePh: { status: 'not_requested' },
      delivery: { freshness: 'fresh', source: 'server_cache' },
    })
    expect(mocks.enrichChemicalItem).not.toHaveBeenCalled()
    expect(mocks.resolveKoshaIdentityByCas).not.toHaveBeenCalled()
    await Promise.all(request.background)
  })

  it('returns stale inventory evidence immediately and revalidates it in waitUntil', async () => {
    const stale = {
      ...completeResult,
      enrichmentVersion: 2,
      hazard: {
        ...completeResult.hazard,
        fetchedAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2026-08-08T00:00:00.000Z',
      },
    }
    mocks.readChemicalEnrichmentCache.mockResolvedValue({
      result: stale,
      freshness: 'stale',
      resultVersion: 2,
    })
    mocks.enrichChemicalItem.mockResolvedValue(completeResult)
    const request = context({
      profile: 'inventory_hazard',
      items: [{ requestId: 'stale', casNumber: '127-09-3' }],
    })
    const response = await onRequestPost(request.value)
    const payload = await response.json() as { results: ChemicalEnrichmentResult[] }
    expect(payload.results[0]).toMatchObject({
      enrichmentVersion: 2,
      referencePh: { status: 'not_requested' },
      delivery: {
        freshness: 'stale',
        source: 'server_cache',
        revalidationScheduled: true,
      },
    })
    expect(mocks.enrichChemicalItem).toHaveBeenCalledOnce()
    await Promise.all(request.background)
    expect(mocks.writeChemicalEnrichmentCache).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestId: 'stale' }),
      expect.objectContaining({ enrichmentVersion: 3 }),
    )
  })

  it('does not hydrate KOSHA reference pH for the inventory hazard profile', async () => {
    const pending = {
      ...completeResult,
      referencePh: { status: 'pending' as const, source: 'kosha' as const, retryAfterMs: 2_000 },
      retryAfterMs: 2_000,
    }
    mocks.enrichChemicalItem.mockResolvedValue(pending)
    const request = context({
      profile: 'inventory_hazard',
      items: [{ requestId: 'hazard-only', casNumber: '127-09-3' }],
    })
    const response = await onRequestPost(request.value)
    const payload = await response.json() as { results: ChemicalEnrichmentResult[] }
    expect(payload.results[0].referencePh).toEqual({ status: 'not_requested' })
    expect(payload.results[0]).not.toHaveProperty('retryAfterMs')
    expect(mocks.resolveKoshaIdentityByCas).not.toHaveBeenCalled()
    expect(mocks.resolveKoshaReferencePh).not.toHaveBeenCalled()
    await Promise.all(request.background)
  })

  it('hydrates a pending reference pH without changing completed GHS', async () => {
    mocks.resolveKoshaIdentityByCas.mockResolvedValue({
      kind: 'found',
      identity: { casNumber: '127-09-3', chemId: '003232', localizedName: '아세트산 나트륨, 무수' },
    })
    mocks.resolveKoshaReferencePh.mockResolvedValue({
      status: 'available', value: 7.5, source: 'kosha', sourceId: '003232',
    })
    const result = await hydrateKoshaSupplement({
      ...completeResult,
      referencePh: { status: 'pending', source: 'kosha', retryAfterMs: 2_000 },
      retryAfterMs: 2_000,
    }, {})
    expect(result).toMatchObject({
      overallStatus: 'complete',
      hazard: { status: 'not_classified' },
      identity: { koshaChemId: 3232, localizedName: '아세트산 나트륨, 무수' },
      referencePh: { status: 'available', value: 7.5 },
    })
    expect(result).not.toHaveProperty('retryAfterMs')
  })
})
