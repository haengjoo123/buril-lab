import { describe, expect, it } from 'vitest'
import { csvCell } from './export'

describe('analytics CSV export cells', () => {
  it.each(['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '  =HYPERLINK("x")', '\t=cmd']) (
    'escapes spreadsheet formula input %s',
    (input) => {
      expect(csvCell(input)).toMatch(/^"'/)
    },
  )

  it('quotes commas and double quotes without altering safe content', () => {
    expect(csvCell('acetone, "HPLC"')).toBe('"acetone, ""HPLC"""')
  })

  it('renders null as an empty quoted cell', () => {
    expect(csvCell(null)).toBe('""')
  })
})
