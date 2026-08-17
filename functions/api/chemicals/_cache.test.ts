import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChemicalEnrichmentResult } from '../../../src/types'
import {
  getChemicalCacheExpiry,
  getChemicalLookupKeys,
  getChemicalResultAliasKeys,
} from './_cache'

const result = (overrides: Partial<ChemicalEnrichmentResult> = {}): ChemicalEnrichmentResult => ({
  requestId: 'cache-test',
  overallStatus: 'complete',
  identity: {
    status: 'verified',
    casNumber: '127-09-3',
    pubchemCid: 31372,
    equivalentPubchemCids: [31372, 517045],
    standardInchiKey: 'VMHLLURERBWHNL-UHFFFAOYSA-M',
    evidence: [],
  },
  hazard: {
    status: 'not_classified',
    hCodes: [],
    hazardStatements: [],
    pictograms: [],
    hazardFlags: [],
    sources: [{ source: 'pubchem', sourceId: '517045' }],
    fetchedAt: '2026-08-17T00:00:00.000Z',
  },
  phCatalog: {
    status: 'matched',
    id: 'sodium-acetate',
    candidateIds: ['sodium-acetate'],
    matchedBy: 'inchi_key',
    catalogVersion: 'test',
  },
  enrichmentVersion: 1,
  ...overrides,
})

describe('chemical enrichment cache policy', () => {
  afterEach(() => vi.useRealTimers())

  it('writes and reads aliases for CAS, InChIKey, and all equivalent CIDs', () => {
    expect(getChemicalLookupKeys({
      requestId: 'one',
      name: ' Sodium   Acetate ',
      molecularFormula: 'C2H3NaO2',
      casNumber: '127-09-3',
    })).toEqual([
      'cas:127-09-3',
      'name:sodium acetate|formula:C2H3NaO2',
    ])
    expect(getChemicalResultAliasKeys(result())).toEqual([
      'cas:127-09-3',
      'inchikey:VMHLLURERBWHNL-UHFFFAOYSA-M',
      'cid:31372',
      'cid:517045',
    ])
  })

  it('applies status-specific TTLs and never caches transient errors', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T00:00:00.000Z'))
    expect(getChemicalCacheExpiry(result())?.toISOString()).toBe('2026-08-24T00:00:00.000Z')
    expect(getChemicalCacheExpiry(result({ overallStatus: 'needs_review', hazard: {
      ...result().hazard,
      status: 'source_absent',
    } }))?.toISOString()).toBe('2026-08-17T01:00:00.000Z')
    expect(getChemicalCacheExpiry(result({ overallStatus: 'needs_review', identity: {
      status: 'not_found', equivalentPubchemCids: [], evidence: [],
    } }))?.toISOString()).toBe('2026-08-17T00:05:00.000Z')
    expect(getChemicalCacheExpiry(result({ overallStatus: 'retryable', hazard: {
      ...result().hazard,
      status: 'transient_error',
    } }))).toBeNull()
  })

  it('locks the new public cache table to the server role in the migration', () => {
    const sql = readFileSync(resolve(
      'supabase/migrations/20260817010927_chemical_enrichment_cache.sql',
    ), 'utf8').toLowerCase()
    expect(sql).toContain('alter table public.chemical_enrichment_cache enable row level security')
    expect(sql).toContain('revoke all on table public.chemical_enrichment_cache from public, anon, authenticated')
    expect(sql).toContain('grant select, insert, update, delete on table public.chemical_enrichment_cache to service_role')
  })
})
