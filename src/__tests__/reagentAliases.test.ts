import { describe, expect, it } from 'vitest'
import {
  buildSeedAliasTerms,
  dedupeAliasTerms,
  normalizeAliasText,
} from '../utils/reagentAliases'

describe('reagent alias utilities', () => {
  it('normalizes alias text for stable lookup keys', () => {
    expect(normalizeAliasText('  Glucose (ACS)  ')).toBe('glucose acs')
    expect(normalizeAliasText('포도당')).toBe('포도당')
  })

  it('deduplicates aliases by normalized value', () => {
    expect(dedupeAliasTerms(['Glucose', ' glucose ', 'GLUCOSE'])).toEqual(['Glucose'])
  })

  it('builds seed aliases from common reagent fields', () => {
    const aliases = buildSeedAliasTerms({
      name: 'Glucose (ACS reagent)',
      casNumber: '50-99-7',
      productNumber: 'G7021',
      brand: 'Sigma',
    })

    expect(aliases).toContain('Glucose (ACS reagent)')
    expect(aliases).toContain('Glucose')
    expect(aliases).toContain('50-99-7')
    expect(aliases).toContain('G7021')
    expect(aliases).toContain('Sigma Glucose (ACS reagent)')
  })
})
