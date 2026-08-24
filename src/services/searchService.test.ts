import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../locales/i18n'
import type { ChemicalEnrichmentResult } from '../types'

const mocks = vi.hoisted(() => ({
  enrichChemical: vi.fn(),
  chemicalFromEnrichment: vi.fn(),
  fetchChemicalInfoLegacy: vi.fn(),
}))

vi.mock('./chemicalEnrichmentService', () => ({
  enrichChemical: mocks.enrichChemical,
  chemicalFromEnrichment: mocks.chemicalFromEnrichment,
}))

vi.mock('./pubchemApi', () => ({ fetchChemicalInfoLegacy: mocks.fetchChemicalInfoLegacy }))

import { ChemicalSearchError, searchChemical } from './searchService'

function enrichment(overrides: Partial<ChemicalEnrichmentResult> = {}): ChemicalEnrichmentResult {
  return {
    requestId: 'search:test',
    overallStatus: 'complete',
    identity: {
      status: 'verified',
      canonicalName: 'Beef extract',
      localizedName: '소고기 추출물',
      casNumber: '68990-09-0',
      koshaChemId: 456,
      pubchemCid: 123,
      equivalentPubchemCids: [123],
      molecularFormula: 'C',
      evidence: [],
    },
    hazard: {
      status: 'not_classified',
      hCodes: [],
      hazardStatements: [],
      pictograms: [],
      hazardFlags: [],
      sources: [],
      fetchedAt: '2026-08-17T00:00:00.000Z',
    },
    referencePh: { status: 'source_absent', source: 'kosha', sourceId: '000456' },
    phCatalog: { status: 'unmatched', candidateIds: [], catalogVersion: 'test' },
    enrichmentVersion: 2,
    ...overrides,
  }
}

describe('searchChemical unified lookup', () => {
  beforeEach(async () => {
    mocks.enrichChemical.mockReset()
    mocks.chemicalFromEnrichment.mockReset()
    mocks.chemicalFromEnrichment.mockImplementation((result: ChemicalEnrichmentResult) => {
      if (
        result.identity.status === 'not_found'
        || !result.identity.pubchemCid
        || !result.identity.canonicalName
        || !result.identity.molecularFormula
      ) return null
      const referencePh = result.referencePh.status === 'available'
        ? result.referencePh.value
        : undefined
      return {
        id: String(result.identity.pubchemCid),
        name: result.identity.canonicalName,
        casNumber: result.identity.casNumber || '',
        molecularFormula: result.identity.molecularFormula,
        koshaId: result.identity.koshaChemId,
        properties: {
          isOrganic: result.identity.molecularFormula.includes('C'),
          isHalogenated: false,
          ...(referencePh !== undefined ? { referencePh, phSource: 'kosha_reference' } : {}),
        },
        hazardLookup: result.hazard,
        referencePhLookup: result.referencePh,
      }
    })
    mocks.fetchChemicalInfoLegacy.mockReset()
    await i18n.changeLanguage('en')
  })

  it('uses the canonical English name in English mode', async () => {
    mocks.enrichChemical.mockResolvedValue(enrichment())

    await expect(searchChemical('68990-09-0')).resolves.toMatchObject({
      name: 'Beef extract',
      casNumber: '68990-09-0',
      koshaId: 456,
    })
    expect(mocks.enrichChemical).toHaveBeenCalledOnce()
  })

  it('keeps the KOSHA source name alongside the canonical name in Korean mode', async () => {
    await i18n.changeLanguage('ko')
    mocks.enrichChemical.mockResolvedValue(enrichment())

    await expect(searchChemical('68990-09-0')).resolves.toMatchObject({
      name: '소고기 추출물 (Beef extract)',
    })
  })

  it('rejects an invalid CAS checksum before the unified API', async () => {
    await expect(searchChemical('67-64-2')).resolves.toBeNull()
    expect(mocks.enrichChemical).not.toHaveBeenCalled()
  })

  it('returns null only for a confirmed not-found identity', async () => {
    mocks.enrichChemical.mockResolvedValue(enrichment({
      overallStatus: 'needs_review',
      identity: { status: 'not_found', equivalentPubchemCids: [], evidence: [] },
    }))

    await expect(searchChemical('definitely-not-real')).resolves.toBeNull()
  })

  it('surfaces a transport failure instead of reporting no result', async () => {
    mocks.enrichChemical.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(searchChemical('Acetone')).rejects.toMatchObject({
      name: 'ChemicalSearchError',
      code: 'temporary_unavailable',
      retryable: true,
    })
  })

  it('surfaces retryable and incomplete responses as service errors', async () => {
    mocks.enrichChemical.mockResolvedValueOnce(enrichment({
      overallStatus: 'retryable',
      identity: { status: 'ambiguous', equivalentPubchemCids: [], evidence: [] },
    }))
    await expect(searchChemical('Acetone')).rejects.toBeInstanceOf(ChemicalSearchError)

    mocks.enrichChemical.mockResolvedValueOnce(enrichment({
      overallStatus: 'needs_review',
      identity: {
        status: 'ambiguous',
        canonicalName: 'Ambiguous material',
        equivalentPubchemCids: [],
        evidence: [],
      },
    }))
    await expect(searchChemical('Ambiguous material')).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    })
  })

  it('uses the actual legacy lookup when unified enrichment is disabled', async () => {
    vi.stubEnv('VITE_ENABLE_CHEMICAL_ENRICHMENT', 'false')
    vi.resetModules()
    try {
      mocks.fetchChemicalInfoLegacy.mockResolvedValue({
        id: '180',
        name: 'Acetone',
        casNumber: '67-64-1',
        properties: { isOrganic: true, isHalogenated: false },
      })
      const freshService = await import('./searchService')
      await expect(freshService.searchChemical('Acetone')).resolves.toMatchObject({
        name: 'Acetone',
        casNumber: '67-64-1',
      })
      expect(mocks.fetchChemicalInfoLegacy).toHaveBeenCalledWith('Acetone', { throwOnUnavailable: true })
      expect(mocks.enrichChemical).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('does not turn a legacy transport failure into not found', async () => {
    vi.stubEnv('VITE_ENABLE_CHEMICAL_ENRICHMENT', 'false')
    vi.resetModules()
    try {
      mocks.fetchChemicalInfoLegacy.mockRejectedValue(new TypeError('Failed to fetch'))
      const freshService = await import('./searchService')
      await expect(freshService.searchChemical('Acetone')).rejects.toMatchObject({
        code: 'temporary_unavailable',
      })
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('stores KOSHA pH only as external reference metadata', async () => {
    mocks.enrichChemical.mockResolvedValue(enrichment({
      identity: {
        ...enrichment().identity,
        canonicalName: 'Water',
        localizedName: '물',
        casNumber: '7732-18-5',
        koshaChemId: 123,
        pubchemCid: 962,
        equivalentPubchemCids: [962],
        molecularFormula: 'H2O',
      },
      referencePh: {
        status: 'available',
        value: 6.5,
        source: 'kosha',
        sourceId: '000123',
      },
    }))

    const result = await searchChemical('7732-18-5')
    expect(result?.properties).toMatchObject({ referencePh: 6.5, phSource: 'kosha_reference' })
    expect(result?.properties).not.toHaveProperty('ph')
    expect(result?.referencePhLookup).toMatchObject({ status: 'available', value: 6.5 })
  })
})
