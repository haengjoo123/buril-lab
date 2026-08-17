import { describe, expect, it } from 'vitest'
import { enrichChemicalItem } from './_pipeline'

const liveDescribe = process.env.RUN_CHEMICAL_LIVE_SMOKE === 'true' ? describe : describe.skip

liveDescribe('live PubChem chemical enrichment smoke', () => {
  const cases = [
    { name: 'Sodium acetate', cas: '127-09-3', phCatalogId: 'sodium-acetate' },
    { name: 'Potassium acetate', cas: '127-08-2', phCatalogId: 'potassium-acetate' },
    { name: 'Acetone', cas: '67-64-1' },
    { name: 'Sodium chloride', cas: '7647-14-5', phCatalogId: 'sodium-chloride' },
  ] as const

  for (const sample of cases) {
    it(`enriches ${sample.name}`, async () => {
      const result = await enrichChemicalItem({ requestId: sample.name, name: sample.name }, {})
      if (sample.name === 'Sodium chloride') {
        // PubChem currently publishes several valid CAS identifiers in the
        // exact-structure record. The conservative rule keeps identity under
        // review, while the exact InChIKey can still select the pH form.
        expect(result.identity.status).toBe('ambiguous')
        expect(result.hazard.status).toBe('identity_ambiguous')
      } else {
        expect(result.identity.status).toBe('verified')
        expect(result.identity.casNumber).toBe(sample.cas)
        expect(result.hazard.status).not.toBe('transient_error')
      }
      if ('phCatalogId' in sample) {
        expect(result.phCatalog).toMatchObject({ status: 'matched', id: sample.phCatalogId })
      }
    }, 60_000)
  }
})
