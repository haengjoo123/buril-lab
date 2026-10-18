import { describe, expect, it } from 'vitest'
import { normalizeReagentBrand } from './reagentBrands'

describe('normalizeReagentBrand', () => {
  it.each([
    ['Duksan', 'duksan'],
    ['DUKSAN', 'duksan'],
    ['DUKSAN REAGENTS', 'duksan'],
    ['DKSAN REAGENTS', 'duksan'],
    ['덕산약품', 'duksan'],
    ['(주)덕산약품', 'duksan'],
    ['Daejung', 'daejung'],
    ['DAEJUNG', 'daejung'],
    ['주식회사 대정화금', 'daejung'],
    ['Samchun Chemical', 'samchun'],
    ['Sigma', 'sigma_aldrich'],
    ['sigma', 'sigma_aldrich'],
    ['Sigma-Aldrich', 'sigma_aldrich'],
    ['Aldrich', 'sigma_aldrich'],
    ['Fluka', 'sigma_aldrich'],
    ['Calbiochem', 'sigma_aldrich'],
    ['Thermo', 'thermo_fisher'],
    ['Fisher Scientific', 'thermo_fisher'],
    ['gibco', 'thermo_fisher'],
    ['TCI', 'tci'],
    ['Kanto Chemical', 'kanto'],
    ['MP Biomedicals', 'mp_biomedicals'],
    ['Ｓｉｇｍａ', 'sigma_aldrich'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeReagentBrand(raw)?.id).toBe(expected)
  })

  it.each([null, undefined, '', '   ', 'cmos', 'Difco', 'SHINYO PURE CHEMICALS CO., LTD.'])(
    'returns null for an unknown or empty brand: %s',
    (raw) => {
      expect(normalizeReagentBrand(raw)).toBeNull()
    },
  )

  it('returns the canonical display name', () => {
    expect(normalizeReagentBrand('DUKSAN REAGENTS')).toEqual({ id: 'duksan', displayName: '덕산약품' })
  })
})
