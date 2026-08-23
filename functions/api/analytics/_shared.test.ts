import { describe, expect, it } from 'vitest'
import {
  classifySearchQuery,
  normalizeSearchQuery,
  sanitizeActionMetadata,
  sanitizeSearchQuery,
} from './_shared'

describe('submitted-search analytics sanitization', () => {
  it('normalizes NFKC, removes controls, collapses whitespace, and limits Unicode characters', () => {
    const query = `Ａｃｅｔｏｎｅ\u0000\n   ${'가'.repeat(250)}`
    const result = sanitizeSearchQuery(query)

    expect(result.startsWith('Acetone 가')).toBe(true)
    expect(Array.from(result)).toHaveLength(200)
    expect(result).not.toContain('\u0000')
    expect(result).not.toContain('\n')
  })

  it('masks common direct identifiers and secrets', () => {
    const result = sanitizeSearchQuery(
      'acetone jane@example.com https://example.com/a +82 10-1234-5678 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
    )

    expect(result).toContain('[EMAIL]')
    expect(result).toContain('[URL]')
    expect(result).toContain('[PHONE]')
    expect(result).toContain('[TOKEN]')
    expect(result).not.toContain('jane@example.com')
  })

  it('preserves checksum-valid CAS numbers before phone masking', () => {
    expect(sanitizeSearchQuery('아세톤 67-64-1')).toBe('아세톤 67-64-1')
    expect(classifySearchQuery('67-64-1')).toBe('cas')
    expect(classifySearchQuery('H2SO4')).toBe('formula')
    expect(classifySearchQuery('Acetone')).toBe('name')
    expect(classifySearchQuery('67-64-2')).toBe('name')
  })

  it('normalizes demand keys and keeps only allowlisted action metadata', () => {
    expect(normalizeSearchQuery('  ＡＣＥＴＯＮＥ   시약 ')).toBe('acetone 시약')
    expect(sanitizeActionMetadata({
      source: ' scanner ',
      corrected: true,
      secret: 'do-not-store',
      nested: { value: 1 },
    })).toEqual({ source: 'scanner', corrected: true })
  })
})
