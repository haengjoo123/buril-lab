import { readFile, writeFile } from 'node:fs/promises'
import { allDecisionFixtures } from './decisions-fixtures.mjs'

const backends = ['legacy', 'decisionsV1', 'decisions']
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] ?? null
export function analyzePolicyComparison(report) {
  const fixtures = new Map(allDecisionFixtures().map(row => [row.id, row]))
  const rows = report.rows
  if (!Array.isArray(rows) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Invalid or duplicate case ids')
  for (const row of rows) {
    const fixture = fixtures.get(row.id)
    if (!fixture || fixture.feature !== row.feature || fixture.expected !== row.expected) throw new Error('Case does not match the fixed contract')
    if (backends.some(backend => !row[backend] || typeof row[backend].error !== 'boolean')) throw new Error('Missing paired backend result')
  }
  const metrics = (cases, backend) => {
    const successful = cases.filter(row => !row[backend].error)
    const accepted = successful.filter(row => row[backend].choice !== null)
    const correct = accepted.filter(row => row[backend].choice === row.expected)
    const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }
    for (const row of cases) for (const key of Object.keys(usage)) usage[key] += row[backend].usage?.[key] ?? 0
    return { cases: cases.length, successful: successful.length, errors: cases.length - successful.length,
      accepted: accepted.length, correct: correct.length, wrong: accepted.length - correct.length,
      accuracy: accepted.length ? correct.length / accepted.length : null,
      acceptanceRate: cases.length ? accepted.length / cases.length : 0,
      abstained: successful.length - accepted.length,
      p50Ms: percentile(successful.map(row => row[backend].elapsedMs), 0.5),
      p95Ms: percentile(successful.map(row => row[backend].elapsedMs), 0.95), usage }
  }
  const suites = Object.fromEntries(['comparison', 'guards'].map(suite => [suite,
    Object.fromEntries(['voiceCandidate', 'classification'].map(feature => {
      const cases = rows.filter(row => row.feature === feature && row.id.startsWith('guard-') === (suite === 'guards'))
      const stats = Object.fromEntries(backends.map(backend => [backend, metrics(cases, backend)]))
      const answerable = cases.filter(row => row.expected !== null).length
      const v1 = stats.decisionsV1, v2 = stats.decisions, legacy = stats.legacy
      const improved = cases.filter(row => row.decisions.choice === row.expected && row.expected !== null
        && !row.decisions.error && (row.decisionsV1.error || row.decisionsV1.choice !== row.expected)).map(row => row.id)
      const newlyWrong = cases.filter(row => !row.decisions.error && row.decisions.choice !== null
        && row.decisions.choice !== row.expected && (row.decisionsV1.error || row.decisionsV1.choice !== row.decisions.choice)).map(row => row.id)
      return [feature, { ...stats, answerableCases: answerable,
        v2CorrectCoverage: answerable ? v2.correct / answerable : null,
        v2AcceptedRelativeToV1: v1.accepted ? v2.accepted / v1.accepted : null,
        v2AcceptedRelativeToLegacy: legacy.accepted ? v2.accepted / legacy.accepted : null,
        correctAcceptanceGain: v2.correct - v1.correct, improvedCaseIds: improved, newlyWrongCaseIds: newlyWrong,
        accuracyMaintained: v2.accepted > 0 && v2.wrong === 0 && v2.errors === 0 && v2.accuracy >= (v1.accuracy ?? 0),
        originalRolloutChecks: {
          sufficientComparisonCases: suite === 'comparison' && cases.length >= 200,
          acceptedAccuracy: v2.accepted > 0 && v2.accuracy >= 0.99 && v2.accuracy >= (legacy.accuracy ?? 0),
          acceptance: cases.length > 0 && v2.accepted >= legacy.accepted * 0.9,
          latency: cases.length > 0 && v2.p95Ms != null && legacy.p95Ms != null && v2.p95Ms <= legacy.p95Ms * 0.8,
          providerErrors: cases.length > 0 && v2.errors === 0,
        },
        originalAcceptanceGateFeasibleAtPerfectAccuracy: cases.length > 0 && answerable >= Math.ceil(legacy.accepted * 0.9),
      }]
    }))]))
  return { evaluatedAt: report.evaluatedAt, execution: report.execution, cases: rows.length,
    complete: rows.length === fixtures.size && !report.incompleteCase && !report.partialRow,
    suites, productionReady: false,
    limitations: ['Synthetic contract variants and guards, not independent human safety labels.',
      'Real-user shadow duration/volume and sequential activation observations are not certified.',
      'Token usage is recorded; no billing total is inferred without verified pricing.'] }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/compare-decision-policies.mjs')) {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  try {
    if (!args.includes('--report') || !args.includes('--output')) throw new Error('Missing arguments')
    const analysis = analyzePolicyComparison(JSON.parse(await readFile(value('--report'), 'utf8')))
    await writeFile(value('--output'), JSON.stringify(analysis, null, 2))
    console.log(JSON.stringify({ cases: analysis.cases, complete: analysis.complete, productionReady: false }))
  } catch { console.error('Policy comparison failed: check the fixed-case report and output path. No credentials are printed.'); process.exitCode = 1 }
}
