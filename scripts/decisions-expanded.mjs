import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { expandedDecisionFixtures, expandedMaterials } from './decisions-expanded-fixtures.mjs'
import { prepare, requestCase } from './decisions-remote.mjs'

export const expandedManifest = () => {
  const cases = expandedDecisionFixtures()
  return { version: 'expanded-contract:v1', sha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    cases: cases.length, materials: expandedMaterials.length, humanReviewed: false,
    counts: Object.fromEntries(['tuning', 'validation'].map(split => [split, Object.fromEntries(['voiceCandidate', 'classification'].map(feature =>
      [feature, cases.filter(item => item.feature === feature && item.split === split).length]))])) }
}
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] ?? null

export function analyzeExpanded(records, ids = expandedDecisionFixtures().map(item => item.id), backends = ['legacy', 'decisionsV2', 'decisions']) {
  const registry = new Map(expandedDecisionFixtures().map(item => [item.id, item]))
  if (new Set(ids).size !== ids.length || ids.some(id => !registry.has(id))) throw new Error('Unknown or duplicate expected cases')
  const seen = new Set()
  for (const result of records) {
    const fixture = registry.get(result.id), key = `${result.id}:${result.backend}`
    if (!fixture || !ids.includes(result.id) || fixture.feature !== result.feature || fixture.expected !== result.expected
      || !backends.includes(result.backend) || seen.has(key) || typeof result.error !== 'boolean'
      || !(result.choice === null || typeof result.choice === 'string')) throw new Error('Invalid, changed or duplicate result')
    seen.add(key)
  }
  const metrics = (cases, backend) => {
    const results = records.filter(item => item.backend === backend && cases.some(f => f.id === item.id))
    const successful = results.filter(item => !item.error), accepted = successful.filter(item => item.choice !== null)
    const correct = accepted.filter(item => item.choice === item.expected)
    const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }
    for (const item of results) {
      const u = item.usage ?? {}
      usage.inputTokens += u.input_tokens ?? 0; usage.outputTokens += u.output_tokens ?? 0
      usage.cachedTokens += u.input_tokens_details?.cached_tokens ?? 0; usage.cacheWriteTokens += u.input_tokens_details?.cache_write_tokens ?? 0
    }
    const answerable = cases.filter(item => item.expected !== null).length
    return { cases: cases.length, recorded: results.length, errors: results.length - successful.length, accepted: accepted.length,
      correct: correct.length, wrong: accepted.length - correct.length, precision: accepted.length ? correct.length / accepted.length : null,
      acceptanceRate: cases.length ? accepted.length / cases.length : null, answerable,
      correctCoverage: answerable ? correct.length / answerable : null, abstained: successful.length - accepted.length,
      p50Ms: percentile(successful.map(item => item.elapsedMs), 0.5), p95Ms: percentile(successful.map(item => item.elapsedMs), 0.95), usage,
      wrongCaseIds: accepted.filter(item => item.choice !== item.expected).map(item => item.id),
      missedCaseIds: results.filter(item => item.expected !== null && (item.error || item.choice !== item.expected)).map(item => item.id) }
  }
  const groups = Object.fromEntries(['all', 'tuning', 'validation'].map(split => [split, Object.fromEntries(['voiceCandidate', 'classification'].map(feature => {
    const cases = ids.map(id => registry.get(id)).filter(item => item.feature === feature && (split === 'all' || item.split === split))
    const stats = Object.fromEntries(backends.map(backend => [backend, metrics(cases, backend)]))
    const current = stats.decisions, legacy = stats.legacy
    return [feature, { ...stats, targetPassed: cases.length > 0 && current?.recorded === cases.length && legacy?.recorded === cases.length
      && current.errors === 0 && legacy.errors === 0 && current.accepted > 0 && current.wrong === 0 && current.accepted > legacy.accepted,
      correctGainOverResponses: (current?.correct ?? 0) - (legacy?.correct ?? 0),
      rawAdoptionUpperBound: cases.filter(item => item.expected !== null).length,
      higherRawAdoptionFeasibleAtZeroWrong: legacy?.recorded === cases.length ? cases.filter(item => item.expected !== null).length > legacy.accepted : null,
    }]
  }))]))
  return { manifest: expandedManifest(), cases: ids.length, backends, results: records.length,
    complete: records.length === ids.length * backends.length, groups, productionReady: false,
    limitations: ['Synthetic contract labels, not independently human-reviewed disposal decisions.',
      'Zero observed wrong acceptances does not guarantee zero real-world errors.', 'Real-user shadow and sequential activation gates remain separate.'] }
}

// A journal persists each completed call, including provider errors. No automatic
// retry. Explicit resume skips every recorded call and preserves transport failures.
export async function runExpanded(state, output, { split = 'all', concurrency = 4, resume = false,
  backends = ['legacy', 'decisionsV2', 'decisions'], fetchImpl = fetch, intervalMs = 250 } = {}) {
  if (!['all', 'tuning', 'validation'].includes(split) || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Invalid execution options')
  const cases = expandedDecisionFixtures().filter(item => state.grant.caseIds.includes(item.id) && (split === 'all' || item.split === split))
  if (!cases.length) throw new Error('No granted cases')
  const ids = cases.map(item => item.id), journal = `${output}.ndjson`, metadata = `${output}.manifest.json`
  const expected = { grantId: state.grant.id, manifest: expandedManifest(), split, backends, ids }
  await mkdir(dirname(resolve(output)), { recursive: true })
  let records = []
  if (resume) {
    if (JSON.stringify(JSON.parse(await readFile(metadata, 'utf8'))) !== JSON.stringify(expected)) throw new Error('Resume manifest mismatch')
    records = (await readFile(journal, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    analyzeExpanded(records, ids, backends)
  } else {
    await writeFile(metadata, JSON.stringify(expected), { flag: 'wx' })
    await writeFile(journal, '', { flag: 'wx' })
  }
  const done = new Set(records.map(item => `${item.id}:${item.backend}`))
  // Counterbalance backend order, including under bounded concurrency.
  const jobs = cases.flatMap((fixture, n) => [...backends.slice(n % backends.length), ...backends.slice(0, n % backends.length)]
    .map(backend => ({ id: fixture.id, backend }))).filter(job => !done.has(`${job.id}:${job.backend}`))
  let cursor = 0, failed = false, nextStart = Date.now(), writes = Promise.resolve()
  const persist = result => { records.push(result); writes = writes.then(() => appendFile(journal, JSON.stringify(result) + '\n')); return writes }
  const worker = async () => {
    while (!failed && cursor < jobs.length) {
      const job = jobs[cursor++], start = Math.max(nextStart, Date.now()); nextStart = start + intervalMs
      await new Promise(resolveWait => setTimeout(resolveWait, Math.max(0, start - Date.now())))
      if (failed) break
      try {
        const result = await requestCase(state, job.id, job.backend, {}, fetchImpl)
        await persist(result)
        if (records.length % 100 === 0) console.log(JSON.stringify({ completedCalls: records.length, targetCalls: ids.length * backends.length }))
      } catch (error) {
        failed = true
        const diagnostic = { ...job, at: new Date().toISOString(), message: /^REMOTE_\d{3}_[A-Z_]+$/.test(error.message) ? error.message : 'REMOTE_TRANSPORT_FAILED',
          serverCode: error.serverCode ?? null, tokenAgeSeconds: error.tokenAgeSeconds ?? null }
        writes = writes.then(() => appendFile(`${output}.transport.ndjson`, JSON.stringify(diagnostic) + '\n'))
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker)); await writes
  const report = { evaluatedAt: new Date().toISOString(), execution: 'cloudflare-production', grantId: state.grant.id,
    ...analyzeExpanded(records, ids, backends), records }
  await writeFile(`${output}.tmp`, JSON.stringify(report, null, 2)); await rename(`${output}.tmp`, output)
  if (failed) throw new Error('Transport failure; journal retained. Explicit resume required.')
  return report
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  if (args.includes('--manifest')) { console.log(JSON.stringify(expandedManifest(), null, 2)); return }
  if (args.includes('--prepare')) {
    const grant = await prepare(resolve(value('--prepare')), expandedDecisionFixtures().map(item => item.id), 'production')
    console.log(JSON.stringify({ id: grant.id, expiresAt: grant.expiresAt, cases: grant.caseIds.length })); return
  }
  const state = JSON.parse(await readFile(value('--state'), 'utf8'))
  const report = await runExpanded(state, value('--output'), { split: args.includes('--split') ? value('--split') : 'all', resume: args.includes('--resume') })
  console.log(JSON.stringify({ complete: report.complete, cases: report.cases, results: report.results, groups: report.groups }))
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/decisions-expanded.mjs')) main().catch(() => {
  console.error('Expanded evaluation stopped. Check retained report/journal; no credentials printed.'); process.exitCode = 1
})
