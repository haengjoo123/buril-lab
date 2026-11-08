import { describe, expect, it } from 'vitest'
// @ts-expect-error The evaluator is a standalone JavaScript CLI.
import { analyzePolicyComparison } from './compare-decision-policies.mjs'
const result = (choice: string | null, error = false) => ({ choice, error, elapsedMs: 100 })
const row = (id = 'voice-0-0', expected: string | null = 'inventory:a') => ({
  id, feature: 'voiceCandidate', expected, legacy: result('inventory:a'), decisionsV1: result(null), decisions: result('inventory:a'),
})
describe('paired policy comparison integrity', () => {
  it('measures correct gains and never certifies an incomplete experiment', () => {
    const analysis = analyzePolicyComparison({ rows: [row()] })
    expect(analysis.suites.comparison.voiceCandidate).toMatchObject({ correctAcceptanceGain: 1, accuracyMaintained: true })
    expect(analysis.complete).toBe(false)
    expect(analysis.productionReady).toBe(false)
  })
  it('does not confuse a provider failure with a successful abstention', () => {
    const data = row()
    data.decisions = result(null, true)
    const metrics = analyzePolicyComparison({ rows: [data] }).suites.comparison.voiceCandidate
    expect(metrics.decisions).toMatchObject({ errors: 1, abstained: 0, accepted: 0, accuracy: null })
    expect(metrics.accuracyMaintained).toBe(false)
  })
  it('exposes the impossible gate when legacy accepts an intentionally ambiguous case', () => {
    const data = row('voice-0-10', null)
    data.decisions = result(null)
    const metrics = analyzePolicyComparison({ rows: [data] }).suites.comparison.voiceCandidate
    expect(metrics.answerableCases).toBe(0)
    expect(metrics.originalAcceptanceGateFeasibleAtPerfectAccuracy).toBe(false)
    expect(metrics.originalRolloutChecks.acceptance).toBe(false)
  })
  it('rejects duplicate identifiers, changed labels and missing v1 measurements', () => {
    expect(() => analyzePolicyComparison({ rows: [row(), row()] })).toThrow()
    expect(() => analyzePolicyComparison({ rows: [row('voice-0-0', null)] })).toThrow('fixed contract')
    expect(() => analyzePolicyComparison({ rows: [{ ...row(), decisionsV1: undefined }] })).toThrow('paired backend')
  })
})
