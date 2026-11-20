import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { pairedDecisionFixtures } from './decisions-paired-fixtures.mjs'
import { analyzeExpanded, runExpanded } from './decisions-expanded.mjs'
import { prepare } from './decisions-remote.mjs'

const arms = ['legacy', 'decisions', 'responsesMatched', 'decisionsTrial']
const classificationV8Arms = ['legacy', 'decisions', 'responsesMatchedV8', 'decisionsTrialV8']
const featureArms = (feature, manifest) => feature === 'classification' && manifest.classificationPolicy === 'classification:v8'
  ? classificationV8Arms : arms
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const read = async path => JSON.parse(await readFile(path, 'utf8'))

export async function ruleEligibleIds(fixtures) {
  const rules = await build({ entryPoints: [fileURLToPath(new URL('../src/utils/chemicalAnalyzer.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false })
  const { analyzeChemical, needsAiClassification } = await import('data:text/javascript;base64,' + Buffer.from(rules.outputFiles[0].contents).toString('base64'))
  return fixtures.filter(fixture => fixture.feature === 'classification' &&
    needsAiClassification(analyzeChemical({ id: fixture.id, ...fixture.input }))).map(fixture => fixture.id)
}

export async function pairedSuite(classRevision = 'v7') {
  if (!['v7', 'v8'].includes(classRevision)) throw new Error('Unknown classification comparison')
  const fixtures = pairedDecisionFixtures()
  const references = await read(new URL('./fixtures/decisions-paired-pubchem.json', import.meta.url))
  const eligibleIds = await ruleEligibleIds(fixtures)
  const manifest = { version: 'paired-contract:v1', sha256: digest(fixtures), referencesSha256: digest(references),
    eligibleSha256: digest(eligibleIds), cases: fixtures.length, classificationEligible: eligibleIds.length,
    humanReviewed: false, model: 'gpt-6-luna', voicePolicy: 'voice-candidate:v5', classificationPolicy: 'classification:' + classRevision,
    probability: .90, secondaryVoiceProbability: .85, margin: .20 }
  if (manifest.sha256 !== 'd9d4f41caf1f17e0c31345981534a01b6d98c48f2b7488798db629bf6c9f35a1' ||
      manifest.referencesSha256 !== 'b75c71cdd76c18aa1b1014a5c8b5538ba8a0090bbd3068a93d08438ea383201f' ||
      manifest.eligibleSha256 !== '91a4f0665c518ef42a39030e7ec37334e9eaebadf5caa6ab0c8bb0509334b371') {
    throw new Error('Frozen inputs, references or eligibility changed')
  }
  return { fixtures, manifest, eligibleIds: new Set(eligibleIds) }
}

// Only a probability hold can be reopened in the predeclared sensitivity analysis.
// Explicit review, rejected IDs, evidence conflicts, refusal and provider errors stay closed.
export function replayVoice85(row) {
  if (row.feature !== 'voiceCandidate' || row.backend !== 'decisionsTrial' || row.error ||
      row.choice !== null || row.abstentionReason !== 'probability' || !row.decision) return row
  const proposed = row.decision.probabilities.find(item => item.value === row.proposedChoice)
  if (!proposed || proposed.value === '__review__' || proposed.probability < .85) return row
  const runnerUp = Math.max(0, ...row.decision.probabilities.filter(item => item !== proposed).map(item => item.probability))
  return proposed.probability - runnerUp + 1e-12 >= .20 ? { ...row, choice: proposed.value } : row
}

function summarizeRows(rows) {
  const accepted = rows.filter(row => !row.error && row.choice !== null)
  const correct = accepted.filter(row => row.choice === row.expected).length
  const successful = rows.filter(row => !row.error)
  const latency = successful.map(row => row.elapsedMs).sort((a, b) => a - b)
  const q = fraction => latency[Math.ceil(fraction * latency.length) - 1] ?? null
  return { cases: rows.length, answerable: rows.filter(row => row.expected !== null).length, accepted: accepted.length, correct,
    wrong: accepted.length - correct, wrongCases: accepted.filter(row => row.choice !== row.expected).map(row => row.id),
    held: successful.length - accepted.length, errors: rows.length - successful.length, p50Ms: q(.5), p95Ms: q(.95) }
}

export function summarizePaired(suite, rawRecords) {
  const ids = suite.fixtures.map(f => f.id)
  // The archived voice phase and the new classification phase use different signed backend names.
  const records = rawRecords.map(row => {
    const index = featureArms(row.feature, suite.manifest).indexOf(row.backend)
    if (index < 0) throw new Error('Unexpected backend for feature and policy: ' + row.backend)
    return { ...row, backend: arms[index] }
  })
  const complete = analyzeExpanded(records, ids, arms, suite)
  if (!complete.complete) throw new Error('Paired matrix incomplete')
  const byId = new Map(records.map(row => [row.id + '/' + row.backend, row]))
  for (const f of suite.fixtures) {
    const control = byId.get(f.id + '/responsesMatched'), trial = byId.get(f.id + '/decisionsTrial')
    for (const row of [control, trial].filter(row => !row.error)) {
      if (!/^[a-f0-9]{64}$/.test(row.inputDigest) || row.model !== suite.manifest.model || row.cacheHit !== false ||
          row.policyVersion !== (f.feature === 'voiceCandidate' ? suite.manifest.voicePolicy : suite.manifest.classificationPolicy)) {
        throw new Error('Unexpected evidence, model, cache or policy: ' + f.id)
      }
    }
    if (!control.error && !trial.error && control.inputDigest !== trial.inputDigest) throw new Error('Unequal comparison evidence: ' + f.id)
  }
  const table = selected => {
    const selectedIds = new Set(selected.map(f => f.id))
    const relevant = records.filter(row => selectedIds.has(row.id))
    const stats = Object.fromEntries(arms.map(arm => [arm, summarizeRows(relevant.filter(r => r.backend === arm))]))
    if (selected.every(f => f.feature === 'voiceCandidate')) {
      stats.decisionsTrial85 = summarizeRows(relevant.filter(r => r.backend === 'decisionsTrial').map(replayVoice85))
    }
    return stats
  }
  const voice = suite.fixtures.filter(f => f.feature === 'voiceCandidate')
  const classification = suite.fixtures.filter(f => f.feature === 'classification')
  const eligible = classification.filter(f => suite.eligibleIds.has(f.id))
  const groups = { voice: table(voice), classificationEligible: table(eligible), classificationAll: table(classification) }
  const commonSuccess = subset => table(subset.filter(f => arms.every(arm => !byId.get(f.id + '/' + arm).error)))
  const passed = (group, trial) => group[trial].wrong === 0 && group[trial].errors === 0 &&
    arms.every(arm => group[arm].errors === 0) && group[trial].correct > Math.max(group.legacy.correct, group.responsesMatched.correct) &&
    group[trial].correct >= group.decisions.correct
  return { recorded: records.length, manifest: suite.manifest, groups,
    signedBackends: Object.fromEntries(['voiceCandidate', 'classification'].map(f => [f, featureArms(f, suite.manifest)])),
    pairedSuccess: { voice: commonSuccess(voice), classificationEligible: commonSuccess(eligible) },
    byScenario: Object.fromEntries([...new Set(suite.fixtures.map(f => f.feature + '/' + f.scenario))].map(key =>
      [key, table(suite.fixtures.filter(f => f.feature + '/' + f.scenario === key))])),
    passed: { voice90: passed(groups.voice, 'decisionsTrial'), voice85: passed(groups.voice, 'decisionsTrial85'),
      classification: passed(groups.classificationEligible, 'decisionsTrial') },
    objective: 'Zero wrong and more correct than both Responses controls, no decline against current Decisions. Complete error-free comparisons required.',
    reference: 'Pinned public identities; measured classification latency excludes external identity lookup.',
    humanReviewed: false, productionReady: false }
}

async function main() {
  const args = process.argv.slice(2)
  const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
  const suite = await pairedSuite(args.includes('--class-v8') ? 'v8' : 'v7')
  if (args.includes('--manifest')) { console.log(JSON.stringify(suite.manifest)); return }
  if (args.includes('--summarize')) {
    const phases = await Promise.all([read(arg('--voice')), read(arg('--classification'))])
    for (const [index, feature] of ['voiceCandidate', 'classification'].entries()) {
      const phase = phases[index]
      const policy = feature === 'classification' ? 'classificationPolicy' : 'voicePolicy'
      if (!phase.complete || phase.execution !== 'cloudflare-production' || phase.records.some(r => r.feature !== feature) ||
          ['sha256', 'referencesSha256', 'eligibleSha256', 'model', 'probability', 'margin', 'secondaryVoiceProbability', policy]
            .some(key => phase.manifest[key] !== suite.manifest[key]) ||
          JSON.stringify(phase.backends) !== JSON.stringify(featureArms(feature, suite.manifest))) throw new Error('Invalid phase: ' + feature)
    }
    const final = summarizePaired(suite, phases.flatMap(p => p.records))
    await writeFile(arg('--output'), JSON.stringify(final, null, 2))
    console.log(JSON.stringify({ recorded: final.recorded, passed: final.passed })); return
  }
  const feature = arg('--feature')
  if (!['voiceCandidate', 'classification'].includes(feature)) throw new Error('Select a feature')
  const ids = suite.fixtures.filter(f => f.feature === feature).map(f => f.id)
  if (arg('--prepare')) {
    const grant = await prepare(arg('--prepare'), ids, 'production')
    console.log(JSON.stringify({ id: grant.id, expiresAt: grant.expiresAt, cases: ids.length })); return
  }
  if (!arg('--state') || !arg('--output')) throw new Error('Supply state and output')
  const state = await read(arg('--state'))
  if (state.grant.environment !== 'production' || JSON.stringify(state.grant.caseIds) !== JSON.stringify(ids)) throw new Error('Grant does not match the feature')
  const report = await runExpanded(state, arg('--output'), { suite, backends: featureArms(feature, suite.manifest), resume: args.includes('--resume') })
  console.log(JSON.stringify({ complete: report.complete, calls: report.results }))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message); process.exitCode = 1
})
