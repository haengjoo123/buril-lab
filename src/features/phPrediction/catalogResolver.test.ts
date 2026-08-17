import { describe, expect, it } from 'vitest'
import { DEFAULT_PH_CATALOG } from './catalog'
import { resolvePhCatalogIdentity } from './catalogResolver'

describe('resolvePhCatalogIdentity', () => {
  it('matches sodium acetate by exact InChIKey before CAS or CID', () => {
    expect(resolvePhCatalogIdentity({
      standardInchiKey: 'VMHLLURERBWHNL-UHFFFAOYSA-M',
      casNumber: '127-09-3',
      pubchemCid: 31372,
      equivalentPubchemCids: [31372, 517045],
    })).toMatchObject({
      status: 'matched',
      id: 'sodium-acetate',
      matchedBy: 'inchi_key',
      selection: 'automatic',
      catalogVersion: DEFAULT_PH_CATALOG.version,
    })
  })

  it('returns formula matches as candidates without automatic confirmation', () => {
    const result = resolvePhCatalogIdentity({ molecularFormula: 'C2H3NaO2' })
    expect(result.status).toBe('ambiguous')
    expect(result.id).toBeUndefined()
    expect(result.candidateIds).toContain('sodium-acetate')
    expect(result.matchedBy).toBeUndefined()
  })
})
