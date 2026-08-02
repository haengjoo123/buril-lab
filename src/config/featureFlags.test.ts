import { describe, expect, it } from 'vitest'
import { isExplicitlyDisabled, isExplicitlyEnabled } from './featureFlags'

describe('isExplicitlyEnabled', () => {
  it('fails closed when the flag is missing or not the literal true value', () => {
    expect(isExplicitlyEnabled(undefined)).toBe(false)
    expect(isExplicitlyEnabled('')).toBe(false)
    expect(isExplicitlyEnabled('false')).toBe(false)
    expect(isExplicitlyEnabled('1')).toBe(false)
    expect(isExplicitlyEnabled('yes')).toBe(false)
  })

  it('accepts only an explicit case-insensitive true value', () => {
    expect(isExplicitlyEnabled('true')).toBe(true)
    expect(isExplicitlyEnabled(' TRUE ')).toBe(true)
  })

  it('keeps Waste V2 enabled unless the rollback flag is explicitly false', () => {
    expect(isExplicitlyDisabled(undefined)).toBe(false)
    expect(isExplicitlyDisabled('')).toBe(false)
    expect(isExplicitlyDisabled('true')).toBe(false)
    expect(isExplicitlyDisabled(' FALSE ')).toBe(true)
  })
})
