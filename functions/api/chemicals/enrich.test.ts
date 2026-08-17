import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChemicalEnrichmentResult } from '../../../src/types'

const mocks = vi.hoisted(() => ({
  enrichChemicalItem: vi.fn(),
  readChemicalEnrichmentCache: vi.fn(),
  writeChemicalEnrichmentCache: vi.fn(),
  verifyLabMembership: vi.fn(),
  projectLegacyGhsCache: vi.fn(),
}))

vi.mock('./_pipeline', () => ({
  enrichChemicalItem: mocks.enrichChemicalItem,
}))

vi.mock('./_cache', () => ({
  readChemicalEnrichmentCache: mocks.readChemicalEnrichmentCache,
  writeChemicalEnrichmentCache: mocks.writeChemicalEnrichmentCache,
  verifyLabMembership: mocks.verifyLabMembership,
  projectLegacyGhsCache: mocks.projectLegacyGhsCache,
}))

import { onRequestPost } from './enrich'

const completeResult: ChemicalEnrichmentResult = {
  requestId: 'one',
  overallStatus: 'complete',
  identity: { status: 'verified', casNumber: '127-09-3', pubchemCid: 31372, equivalentPubchemCids: [31372, 517045], evidence: [] },
  hazard: { status: 'not_classified', hCodes: [], hazardStatements: [], pictograms: [], hazardFlags: [], sources: [], fetchedAt: '2026-08-17T00:00:00.000Z' },
  phCatalog: { status: 'matched', id: 'sodium-acetate', candidateIds: ['sodium-acetate'], catalogVersion: 'test' },
  enrichmentVersion: 1,
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
    mocks.verifyLabMembership.mockResolvedValue(true)
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
    await expect(response.json()).resolves.toEqual({ results: [completeResult] })
    expect(mocks.verifyLabMembership).toHaveBeenCalledOnce()
    expect(request.background).toHaveLength(1)
    await Promise.all(request.background)
    expect(mocks.writeChemicalEnrichmentCache).toHaveBeenCalledOnce()
    expect(mocks.projectLegacyGhsCache).toHaveBeenCalledOnce()
  })
})
