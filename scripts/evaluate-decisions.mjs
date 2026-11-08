import { writeFile, readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { decisionFixtures } from './decisions-fixtures.mjs'

export function summarize(rows) {
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? null
  return Object.fromEntries(['voiceCandidate', 'classification'].map(feature => {
    const cases = rows.filter(row => row.feature === feature)
    const metrics = backend => {
      const selected = cases.filter(row => row[backend].choice !== null)
      const correct = selected.filter(row => row[backend].choice === row.expected).length
      return { total: cases.length, accepted: selected.length, accuracy: selected.length ? correct / selected.length : null,
        acceptanceRate: cases.length ? selected.length / cases.length : 0, abstentionRate: cases.length ? 1 - selected.length / cases.length : 0,
        p50: percentile(cases.map(row => row[backend].elapsedMs), 0.5), p95: percentile(cases.map(row => row[backend].elapsedMs), 0.95),
        errors: cases.filter(row => row[backend].error).length,
        usage: cases.reduce((sum, row) => { for (const [key, value] of Object.entries(row[backend].usage || {})) if (typeof value === 'number') sum[key] = (sum[key] || 0) + value; return sum }, {}),
        costIncomplete: cases.some(row => row[backend].costUsd == null),
        costUsd: cases.reduce((sum, row) => sum + (row[backend].costUsd ?? 0), 0),
      }
    }
    const legacy = metrics('legacy'), decisions = metrics('decisions')
    return [feature, { legacy, decisions,
      // This corpus alone cannot certify chemical safety or production traffic.
      comparisonPassed: cases.length >= 200 && decisions.accuracy >= 0.99 && decisions.accuracy >= legacy.accuracy
        && decisions.acceptanceRate >= legacy.acceptanceRate * 0.9 && decisions.p95 <= legacy.p95 * 0.8 && decisions.errors === 0,
      productionReady: false, remainingGates: ['independent target-domain labels', 'safety regression', '24h/100 production shadow cases', 'sequential activation observation'],
    }]
  }))
}

async function main() {
  const args = process.argv.slice(2)
  const value = flag => args[args.indexOf(flag) + 1]
  const output = args.includes('--output') ? value('--output') : 'tmp/decisions-evaluation.json'
  if (args.includes('--report')) {
    const rows = JSON.parse(await readFile(value('--report'), 'utf8')).rows
    await writeFile(output, JSON.stringify({ summary: summarize(rows), rows }, null, 2))
    return
  }
  const fixtures = args.includes('--fixtures') ? JSON.parse(await readFile(value('--fixtures'), 'utf8')) : decisionFixtures()
  if (!args.includes('--live')) {
    console.log(JSON.stringify({ live: false, counts: Object.fromEntries(['voiceCandidate', 'classification'].map(feature => [feature, fixtures.filter(row => row.feature === feature).length])),
      families: 10, warning: 'Synthetic wording/format variants; not 400 independent safety examples. Live evaluation not run.' }, null, 2))
    return
  }
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_SAFETY_HMAC_SECRET) throw new Error('Server OPENAI_API_KEY and OPENAI_SAFETY_HMAC_SECRET are required; no secret is printed.')
  const rates = ['--responses-input-per-million', '--responses-output-per-million', '--responses-cached-input-per-million'].map(flag => Number(args.includes(flag) ? value(flag) : NaN))
  if (!rates.every(rate => Number.isFinite(rate) && rate >= 0)) throw new Error('Supply verified Responses input/output/cached-input rates for cost accounting.')
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  const rows = []
  try {
    const classification = await server.ssrLoadModule('/functions/api/ai/classify.ts')
    const voice = await server.ssrLoadModule('/functions/api/voice/_reagentAliases.ts')
    const { createSafetyIdentifier } = await server.ssrLoadModule('/functions/api/ai/_openai.ts')
    const baseEnv = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_SAFETY_HMAC_SECRET: process.env.OPENAI_SAFETY_HMAC_SECRET }
    const safety = await createSafetyIdentifier(baseEnv, 'decisions-evaluation-synthetic')
    for (const fixture of fixtures) {
      const row = { id: fixture.id, feature: fixture.feature, expected: fixture.expected, cacheHit: false }
      for (const backend of ['legacy', 'decisions']) {
        const env = { ...baseEnv, BURILLAB_RUNTIME_CONFIG: { get: async () => ({ voiceCandidate: backend === 'legacy' ? 'legacy' : 'active', classification: backend === 'legacy' ? 'legacy' : 'active', shadowSampleRate: 0, expiresAt: '2099-01-01T00:00:00Z' }) } }
        const originalFetch = globalThis.fetch
        let usage = {}, technicalError = false
        globalThis.fetch = async (...request) => {
          if (backend === 'decisions' && String(request[0]).includes('/responses')) { technicalError = true; throw new Error('Fallback excluded from Decisions benchmark') }
          const response = await originalFetch(...request)
          if (!response.ok) technicalError = true
          try {
            const body = await response.clone().json()
            const u = body.usage || {}
            const cached = u.input_tokens_details?.cached_tokens || 0
            usage = { inputTokens: (usage.inputTokens || 0) + (u.input_tokens || 0), outputTokens: (usage.outputTokens || 0) + (u.output_tokens || 0), cachedTokens: (usage.cachedTokens || 0) + cached, cacheWriteTokens: (usage.cacheWriteTokens || 0) + (u.input_tokens_details?.cache_write_tokens || 0) }
          } catch { /* caller validates actual response */ }
          return response
        }
        const started = Date.now()
        try {
          let choice
          if (fixture.feature === 'classification') {
            const response = await classification.onRequestPost({ env, data: { userId: 'decisions-evaluation-synthetic' }, request: new Request('https://example.com/api/ai/classify', { method: 'POST', body: JSON.stringify({ chemical: fixture.input }) }) })
            const result = await response.json(); choice = result.category === 'UNKNOWN' ? null : result.category
          } else {
            const result = await voice.resolveCandidateWithOpenAI(env, fixture.input.text, fixture.input.language, fixture.input.matches, safety)
            choice = result && (result.decisionAccepted || result.confidence >= 0.72) ? result.candidateId : null
          }
          const costUsd = backend === 'decisions' ? (usage.cachedTokens || usage.cacheWriteTokens ? null : (usage.inputTokens || 0) * 0.10 / 1e6)
            : (((usage.inputTokens || 0) - (usage.cachedTokens || 0)) * rates[0] + (usage.outputTokens || 0) * rates[1] + (usage.cachedTokens || 0) * rates[2]) / 1e6
          row[backend] = { choice, elapsedMs: Date.now() - started, usage, costUsd, error: technicalError }
        } catch { row[backend] = { choice: null, elapsedMs: Date.now() - started, error: true, usage } }
        finally { globalThis.fetch = originalFetch }
      }
      rows.push(row)
      await writeFile(output, JSON.stringify({ evaluatedAt: new Date().toISOString(), summary: summarize(rows), rows }, null, 2))
    }
  } finally { await server.close() }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/evaluate-decisions.mjs')) main().catch(() => { console.error('Evaluation failed; verify arguments, credentials and output directory. No secrets logged.'); process.exitCode = 1 })
