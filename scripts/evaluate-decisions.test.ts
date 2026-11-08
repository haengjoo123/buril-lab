import { describe, expect, it } from 'vitest'
// @ts-expect-error JavaScript evaluation tool is intentionally usable without TS compilation.
import { summarize } from './evaluate-decisions.mjs'
// @ts-expect-error Synthetic fixtures are authored as JavaScript for the CLI.
import { decisionFixtures } from './decisions-fixtures.mjs'

describe('Decisions evaluation integrity', () => {
  it('contains 200 explicitly synthetic cases for each feature with unique ids', () => {
    const fixtures = decisionFixtures()
    expect(new Set(fixtures.map((item: { id: string }) => item.id)).size).toBe(400)
    for (const feature of ['voiceCandidate', 'classification']) {
      expect(fixtures.filter((item: { feature: string }) => item.feature === feature)).toHaveLength(200)
    }
    expect(fixtures.every((item: { humanReviewed: boolean }) => !item.humanReviewed)).toBe(true)
  })
  it('cannot pass empty data or certify production from an offline comparison', () => {
    const empty = summarize([])
    expect(empty.classification.comparisonPassed).toBe(false)
    const rows = Array.from({ length: 200 }, () => ({ feature: 'classification', expected: 'ACID',
      legacy: { choice: 'ACID', elapsedMs: 100 }, decisions: { choice: 'ACID', elapsedMs: 50 } }))
    const report = summarize(rows)
    expect(report.classification.comparisonPassed).toBe(true)
    expect(report.classification.productionReady).toBe(false)
    expect(report.classification.decisions.costIncomplete).toBe(true)
  })
  it('does not count abstentions as accurate accepted results', () => {
    const rows = Array.from({ length: 200 }, () => ({ feature: 'classification', expected: 'ACID',
      legacy: { choice: 'ACID', elapsedMs: 100 }, decisions: { choice: null, elapsedMs: 50 } }))
    expect(summarize(rows).classification.comparisonPassed).toBe(false)
  })
})
