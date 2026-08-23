import { describe, expect, it } from 'vitest'
import { getPictogramCode } from '../../../src/data/ghsCodes'
import { enrichChemicalItem } from './_pipeline'

const liveDescribe = process.env.RUN_CHEMICAL_LIVE_SMOKE === 'true' ? describe : describe.skip

liveDescribe('live PubChem chemical enrichment smoke', () => {
  const cases = [
    { name: 'Sodium acetate', cas: '127-09-3', phCatalogId: 'sodium-acetate' },
    { name: 'Potassium acetate', cas: '127-08-2', phCatalogId: 'potassium-acetate', pictograms: ['GHS07'], exactCas: true },
    { name: 'ABTS', cas: '30931-67-0', pictograms: ['GHS07'], exactCas: true, allowAmbiguous: true },
    { name: '2,4,6-Tri(2-pyridyl)-s-triazine', cas: '3682-35-7', pictograms: ['GHS07'], exactCas: true },
    { name: 'Acetone', cas: '67-64-1', pictograms: ['GHS02', 'GHS07', 'GHS08'], exactCas: true },
    { name: 'Acetic acid', cas: '64-19-7', pictograms: ['GHS02', 'GHS05', 'GHS07', 'GHS08'], exactCas: true },
    { name: 'Sodium chloride', cas: '7647-14-5', phCatalogId: 'sodium-chloride' },
  ] as const

  for (const sample of cases) {
    it(`enriches ${sample.name}`, async () => {
      const result = await enrichChemicalItem({
        requestId: sample.name,
        ...('exactCas' in sample && sample.exactCas ? { casNumber: sample.cas } : { name: sample.name }),
      }, {})
      if (sample.name === 'Sodium chloride') {
        // PubChem currently publishes several valid CAS identifiers in the
        // exact-structure record. The conservative rule keeps identity under
        // review, while the exact InChIKey can still select the pH form.
        expect(result.identity.status).toBe('ambiguous')
        expect(result.hazard.status).toBe('identity_ambiguous')
      } else if ('allowAmbiguous' in sample && sample.allowAmbiguous) {
        expect(['verified', 'ambiguous']).toContain(result.identity.status)
        expect(result.hazard.status).not.toBe('transient_error')
      } else {
        expect(result.identity.status).toBe('verified')
        expect(result.identity.casNumber).toBe(sample.cas)
        expect(result.hazard.status).not.toBe('transient_error')
      }
      if ('phCatalogId' in sample) {
        expect(result.phCatalog).toMatchObject({ status: 'matched', id: sample.phCatalogId })
      }
      if ('pictograms' in sample) {
        const pictogramCodes = new Set(result.hazard.pictograms.map(getPictogramCode).filter(Boolean))
        expect(pictogramCodes).toEqual(new Set(sample.pictograms))
      }
    }, 60_000)
  }
})
