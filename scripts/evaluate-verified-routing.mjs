import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { blindReviewFixtures } from './decisions-review-fixtures.mjs'
import { pairedSuite, ruleEligibleIds } from './evaluate-paired-decisions.mjs'
import { analyzeExpanded, runExpanded } from './decisions-expanded.mjs'
import { prepare } from './decisions-remote.mjs'
import identities from './fixtures/decisions-review-identities.json' with { type: 'json' }

export const evaluationArms = {
  voiceCandidate: ['legacy', 'voiceVerifiedResponses', 'voiceVerifiedDecisions85'],
  classification: ['legacy', 'decisions', 'classificationRouted'],
}
const categories = [
  'ACID',
  'ALKALI',
  'NEUTRAL',
  'ORGANIC_HALOGEN',
  'ORGANIC_NON_HALOGEN',
  'HEAVY_METAL',
  'CYANIDE',
  'REACTIVE',
  'SOLID_WASTE',
]
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const read = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
const save = (path, value, flag = 'wx') => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag })

export function makeBlindPack() {
  const cases = blindReviewFixtures()
    .map(({ id, feature, input }) => ({ id, feature, input }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  return { version: 1, inputDigest: hash(cases), referencesDigest: hash(identities), cases }
}
function assertChoice(fixture, choice) {
  if (choice === null) return
  const valid =
    fixture.feature === 'classification'
      ? categories.includes(choice)
      : fixture.input.matches.some((m) => m.source + ':' + m.id === choice)
  if (!valid) throw Error('Invalid human choice for ' + fixture.id)
}
export function sealReview(pack, feature, review) {
  if (
    !Object.hasOwn(evaluationArms, feature) ||
    review.version !== 1 ||
    review.inputDigest !== pack.inputDigest ||
    review.referencesDigest !== pack.referencesDigest ||
    review.attested !== true ||
    typeof review.reviewer !== 'string' ||
    !review.reviewer.trim() ||
    review.reviewer.length > 100 ||
    !review.labels ||
    typeof review.labels !== 'object' ||
    Array.isArray(review.labels)
  )
    throw Error('An attested review for this frozen pack is required')
  const registry = new Set(pack.cases.map((c) => c.id))
  if (Object.keys(review.labels).some((id) => !registry.has(id))) throw Error('Review contains an unknown case')
  const labels = pack.cases
    .filter((f) => f.feature === feature)
    .map((f) => {
      const entry = review.labels[f.id]
      if (!entry || !Object.hasOwn(entry, 'choice')) throw Error('Unreviewed case ' + f.id)
      assertChoice(f, entry.choice)
      return [f.id, entry.choice]
    })
  const payload = {
    version: 1,
    feature,
    inputDigest: pack.inputDigest,
    referencesDigest: pack.referencesDigest,
    reviewer: review.reviewer.trim(),
    attested: true,
    labels,
  }
  return { ...payload, reviewDigest: hash(payload) }
}

function armsFor(feature, manifest) {
  if (feature === 'classification' && manifest.policies[2] === 'classification:identity-routed:v2') {
    return ['legacy', 'decisions', 'classificationRoutedV2']
  }
  return evaluationArms[feature]
}
async function suiteFor(feature, corpus, file, classV2 = false) {
  if (classV2 && feature !== 'classification') throw Error('--class-v2 requires classification')
  if (!Object.hasOwn(evaluationArms, feature)) throw Error('Select voiceCandidate or classification')
  let fixtures, manifest, eligibleIds
  if (corpus === 'regression') {
    const existing = await pairedSuite('v8')
    fixtures = existing.fixtures.filter((f) => f.feature === feature)
    manifest = {
      version: 'verified-selection:v1',
      corpus,
      feature,
      inputDigest: existing.manifest.sha256,
      referencesDigest: existing.manifest.referencesSha256,
      humanReviewed: false,
    }
    eligibleIds = existing.eligibleIds
  } else if (corpus === 'reviewed' && file) {
    const pack = makeBlindPack(),
      sealed = await read(file)
    if (sealed.feature !== feature || !Array.isArray(sealed.labels) || sealed.labels.length !== 1000)
      throw Error('Wrong sealed feature or size')
    const rebuilt = sealReview(pack, feature, {
      ...sealed,
      labels: Object.fromEntries(sealed.labels.map(([id, choice]) => [id, { choice }])),
    })
    if (rebuilt.reviewDigest !== sealed.reviewDigest || rebuilt.referencesDigest !== sealed.referencesDigest)
      throw Error('Sealed review changed')
    const expected = new Map(rebuilt.labels)
    fixtures = blindReviewFixtures()
      .filter((f) => f.feature === feature)
      .map((f) => ({ ...f, expected: expected.get(f.id) }))
    manifest = {
      version: 'verified-selection:v1',
      corpus,
      feature,
      inputDigest: pack.inputDigest,
      referencesDigest: pack.referencesDigest,
      reviewDigest: rebuilt.reviewDigest,
      humanReviewed: true,
    }
    eligibleIds = new Set(await ruleEligibleIds(fixtures))
  } else throw Error('Select regression, or reviewed with an independently sealed --labels file')
  return {
    fixtures,
    eligibleIds,
    manifest: {
      ...manifest,
      cases: fixtures.length,
      eligibleDigest: hash(fixtures.filter((f) => eligibleIds.has(f.id)).map((f) => f.id)),
      model: 'gpt-6-luna',
      policies:
        feature === 'voiceCandidate'
          ? ['legacy', 'voice:verified-responses:v1', 'voice:verified-decisions85:v1']
          : ['legacy', 'classification:v6', classV2 ? 'classification:identity-routed:v2' : 'classification:identity-routed:v1'],
    },
  }
}

export function metrics(report, suite, feature) {
  const arms = armsFor(feature, suite.manifest),
    ids = suite.fixtures.map((f) => f.id)
  if (
    report.execution !== 'cloudflare-production' ||
    hash(report.manifest) !== hash(suite.manifest) ||
    !analyzeExpanded(report.records, ids, arms, suite).complete ||
    !report.complete
  )
    throw Error('Incomplete evaluation or manifest mismatch')
  const rows = report.records,
    key = new Map(rows.map((r) => [r.id + '/' + r.backend, r]))
  for (const row of rows.filter((r) => !r.error)) {
    if (
      row.cacheHit !== false ||
      row.model !== suite.manifest.model ||
      !Number.isFinite(row.elapsedMs) ||
      row.elapsedMs < 0
    )
      throw Error('Unexpected response model, app cache or latency')
    if (row.backend === 'decisions' && row.policyVersion !== 'classification:v6')
      throw Error('Unexpected classification baseline')
    if (
      row.backend === 'voiceVerifiedResponses' ||
      row.backend === 'voiceVerifiedDecisions85' ||
      row.backend === 'classificationRouted' || row.backend === 'classificationRoutedV2'
    ) {
      if (
        !/^[a-f0-9]{64}$/.test(row.inputDigest) ||
        row.policyVersion !== suite.manifest.policies[arms.indexOf(row.backend)] ||
        !['responses', 'decisions'].includes(row.provider) ||
        (row.backend === 'voiceVerifiedResponses' && row.provider !== 'responses') ||
        (row.backend === 'voiceVerifiedDecisions85' && row.provider !== 'decisions')
      )
        throw Error('Unexpected candidate evidence or provider')
    }
  }
  if (feature === 'voiceCandidate') {
    for (const id of ids) {
      const a = key.get(id + '/' + arms[1]),
        b = key.get(id + '/' + arms[2])
      if (!a.error && !b.error && a.inputDigest !== b.inputDigest) throw Error('Unequal voice evidence ' + id)
    }
  }
  const summarize = (rows) => {
    const sorted = rows
        .filter((r) => !r.error)
        .map((r) => r.elapsedMs)
        .sort((a, b) => a - b),
      q = (p) => sorted[Math.ceil(p * sorted.length) - 1] ?? null
    const accepted = rows.filter((r) => !r.error && r.choice !== null),
      correct = accepted.filter((r) => r.choice === r.expected).length
    const answerable = rows.filter((r) => r.expected !== null).length
    const usage = rows.reduce(
      (sum, { usage: u }) => ({
        inputTokens: sum.inputTokens + (u?.input_tokens ?? u?.inputTokens ?? 0),
        cachedTokens: sum.cachedTokens + (u?.input_tokens_details?.cached_tokens ?? 0),
        outputTokens: sum.outputTokens + (u?.output_tokens ?? u?.outputTokens ?? 0),
      }),
      { inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
    )
    return {
      cases: rows.length,
      answerable,
      accepted: accepted.length,
      correct,
      wrong: accepted.length - correct,
      acceptanceRate: rows.length ? accepted.length / rows.length : null,
      precision: accepted.length ? correct / accepted.length : null,
      correctCoverage: answerable ? correct / answerable : null,
      usage,
      held: sorted.length - accepted.length,
      errors: rows.length - sorted.length,
      p50Ms: q(0.5),
      p95Ms: q(0.95),
      wrongCaseIds: accepted.filter((r) => r.choice !== r.expected).map((r) => r.id),
    }
  }
  const group = (selected) =>
    Object.fromEntries(arms.map((arm) => [arm, summarize(selected.map((id) => key.get(id + '/' + arm)))]))
  const primary = feature === 'classification' ? ids.filter((id) => suite.eligibleIds.has(id)) : ids
  return {
    manifest: suite.manifest,
    records: rows.length,
    all: group(ids),
    primary: group(primary),
    commonSuccess: group(primary.filter((id) => arms.every((arm) => !key.get(id + '/' + arm).error))),
    selectedProviders:
      feature === 'classification'
        ? Object.fromEntries(
            ['responses', 'decisions'].map((p) => [
              p,
              summarize(primary.map((id) => key.get(id + '/' + arms[2])).filter((r) => r.provider === p)),
            ]),
          )
        : undefined,
    independentHumanReview: suite.manifest.humanReviewed,
    productionReady: false,
  }
}

async function main() {
  const args = process.argv.slice(2),
    arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
  const feature = arg('--feature')
  if (args.includes('--pack')) {
    const dir = arg('--pack'),
      pack = makeBlindPack()
    await mkdir(dir, { recursive: true })
    const template = await readFile(new URL('./fixtures/decisions-review.html', import.meta.url), 'utf8')
    await writeFile(
      join(dir, 'review.html'),
      template.replace('__BLIND_PACK__', () => JSON.stringify(pack).replaceAll('<', '\\u003c')),
      { flag: 'wx' },
    )
    const eligible = await ruleEligibleIds(pack.cases)
    await save(join(dir, 'manifest.json'), {
      version: pack.version,
      inputDigest: pack.inputDigest,
      referencesDigest: pack.referencesDigest,
      cases: pack.cases.length,
      classificationEligible: eligible.length,
      eligibleDigest: hash(eligible),
      humanLabels: 'pending',
    })
    console.log(
      JSON.stringify({
        cases: pack.cases.length,
        classificationEligible: eligible.length,
        inputDigest: pack.inputDigest,
      }),
    )
    return
  }
  if (args.includes('--seal')) {
    const sealed = sealReview(makeBlindPack(), feature, await read(arg('--seal')))
    await save(arg('--output'), sealed)
    console.log(JSON.stringify({ feature, cases: sealed.labels.length, reviewDigest: sealed.reviewDigest }))
    return
  }
  const suite = await suiteFor(feature, arg('--corpus'), arg('--labels'), args.includes('--class-v2')),
    ids = suite.fixtures.map((f) => f.id)
  if (args.includes('--prepare')) {
    const grant = await prepare(arg('--prepare'), ids, 'production', suite.manifest.reviewDigest)
    console.log(JSON.stringify({ id: grant.id, expiresAt: grant.expiresAt, cases: ids.length }))
    return
  }
  if (args.includes('--score')) {
    const result = metrics(await read(arg('--score')), suite, feature)
    await save(arg('--output'), result)
    console.log(JSON.stringify(result.primary))
    return
  }
  const state = await read(arg('--state')),
    out = arg('--output')
  if (
    state.grant.environment !== 'production' ||
    state.grant.reviewDigest !== suite.manifest.reviewDigest ||
    hash(state.grant.caseIds) !== hash(ids)
  )
    throw Error('Grant scope does not match evaluation')
  const report = await runExpanded(state, out, {
    suite,
    backends: armsFor(feature, suite.manifest),
    resume: args.includes('--resume'),
  })
  const result = metrics(report, suite, feature)
  await save(out + '.metrics.json', result)
  console.log(JSON.stringify({ complete: true, calls: result.records, primary: result.primary }))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
