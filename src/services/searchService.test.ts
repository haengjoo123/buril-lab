import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../locales/i18n'
import type { ChemicalEnrichmentResult } from '../types'

const mocks = vi.hoisted(() => ({
  enrichChemical: vi.fn(),
}))

vi.mock('./chemicalEnrichmentService', async (importOriginal) => {
  const original = await importOriginal<typeof import('./chemicalEnrichmentService')>()
  return { ...original, enrichChemical: mocks.enrichChemical }
})

import { searchChemical } from './searchService'

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
