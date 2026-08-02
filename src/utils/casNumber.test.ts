import { describe, expect, it } from 'vitest'
import {
  extractValidCasNumber,
  hasCasNumberFormat,
  isValidCasNumber,
  normalizeCasNumber,
  passesCasChecksum,
} from './casNumber'

describe('CAS number validation', () => {
  it.each(['67-64-1', '50-00-0', '7732-18-5', '26628-22-8'])(
    'accepts a valid CAS number: %s',
    (casNumber) => {
      expect(hasCasNumberFormat(casNumber)).toBe(true)
      expect(passesCasChecksum(casNumber)).toBe(true)
      expect(isValidCasNumber(casNumber)).toBe(true)
    },
  )

  it('rejects a CAS-shaped value with an invalid checksum', () => {
    expect(hasCasNumberFormat('67-64-2')).toBe(true)
    expect(passesCasChecksum('67-64-2')).toBe(false)
    expect(normalizeCasNumber('67-64-2')).toBeNull()
  })

  it('normalizes whitespace and full-width digits before validation', () => {
    expect(normalizeCasNumber(' ６７ - ６４ - １ ')).toBe('67-64-1')
  })

  it('never treats a chemical name as a CAS number', () => {
    expect(normalizeCasNumber('Acetone')).toBeNull()
    expect(normalizeCasNumber('아세톤')).toBeNull()
  })

  it('rejects a CAS-shaped number with a leading zero', () => {
    expect(hasCasNumberFormat('00-00-0')).toBe(true)
    expect(normalizeCasNumber('00-00-0')).toBeNull()
  })

  it('skips invalid candidates when extracting a CAS number from text', () => {
    expect(extractValidCasNumber('invalid 67-64-2, valid 67-64-1')).toBe('67-64-1')
  })
})
