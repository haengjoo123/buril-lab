import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose'
import { decisionFixtures, decisionGuardFixtures, allDecisionFixtures } from './decisions-fixtures.mjs'
import { summarize } from './evaluate-decisions.mjs'

export const AUDIENCE = 'burillab:staging:decisions-evaluation:v1'
export const ENDPOINT = 'https://staging.burillab.com/api/internal/decisions/evaluate'
export function evaluationTarget(environment = 'staging') {
  if (environment === 'staging') return { audience: AUDIENCE, endpoint: ENDPOINT, execution: 'cloudflare-staging' }
  if (environment === 'production') return { audience: 'burillab:production:decisions-evaluation:v1',
    endpoint: 'https://burillab.com/api/internal/decisions/evaluate', execution: 'cloudflare-production' }
  throw new Error('Unknown evaluation environment')
}

export async function prepare(directory, ids = decisionFixtures().map(item => item.id), environment = 'staging') {
  evaluationTarget(environment)
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })
  const grant = { id: randomUUID(), environment, publicKey: await exportJWK(publicKey), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), caseIds: ids }
  // Only the three public JWK fields are admitted by the server schema.
  grant.publicKey = { kty: grant.publicKey.kty, crv: grant.publicKey.crv, x: grant.publicKey.x }
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'private.json'), JSON.stringify({ grant, privateKey: await exportJWK(privateKey) }), { mode: 0o600, flag: 'wx' })
  await writeFile(resolve(directory, 'grant.json'), JSON.stringify(grant), { mode: 0o600 })
  return grant
}
export async function requestCase(state, caseId, backend, credentials, fetchImpl = fetch) {
  const target = evaluationTarget(state.grant.environment)
  const staging = target.execution === 'cloudflare-staging'
  if (staging && (!credentials.clientId || !credentials.clientSecret)) throw new Error('Missing Staging Access credentials')
  const key = await importJWK(state.privateKey, 'EdDSA')
  // Backdate slightly so a subsecond clock difference cannot put iat in the
  // verifier's future. Lifetime remains exactly 15s, leaving 13s for transit.
  const issuedAt = Math.floor(Date.now() / 1000) - 2
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA' }).setIssuer(state.grant.id)
    .setAudience(target.audience).setSubject(`${caseId}:${backend}`).setIssuedAt(issuedAt).setExpirationTime(issuedAt + 15).sign(key)
  const response = await fetchImpl(target.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      ...(staging ? { 'CF-Access-Client-Id': credentials.clientId, 'CF-Access-Client-Secret': credentials.clientSecret } : {}) },
    body: JSON.stringify({ caseId, backend }) })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`REMOTE_${response.status}_NON_JSON`)
  const result = await response.json()
  if (response.status !== 200 && response.status !== 502) throw Object.assign(new Error(`REMOTE_${response.status}_REJECTED`), {
    serverCode: typeof result.code === 'string' && /^[A-Z_]{1,64}$/.test(result.code) ? result.code : null,
    tokenLifetimeSeconds: 15, tokenAgeSeconds: Math.floor(Date.now() / 1000) - issuedAt,
  })
  if (result.id !== caseId || result.backend !== backend || typeof result.error !== 'boolean') throw new Error(`REMOTE_${response.status}_INVALID_RESULT`)
  return result
}
export async function runRemote(state, output, credentials, fetchImpl = fetch, { resume = false, compareV1 = false } = {}) {
  const { execution } = evaluationTarget(state.grant.environment)
  const backends = ['legacy', ...(compareV1 ? ['decisionsV1'] : []), 'decisions']
  let rows = [], partialRow
  if (resume) {
    const previous = JSON.parse(await readFile(output, 'utf8'))
    if (previous.grantId !== state.grant.id || previous.execution !== execution || !Array.isArray(previous.rows)
      || JSON.stringify(previous.backends ?? ['legacy', 'decisions']) !== JSON.stringify(backends)
      || previous.rows.some(row => !state.grant.caseIds.includes(row.id) || !row.legacy || !row.decisions || (compareV1 && !row.decisionsV1))
      || new Set(previous.rows.map(row => row.id)).size !== previous.rows.length) throw new Error('Resume report does not match this grant')
    rows = previous.rows
    partialRow = previous.partialRow
  }
  await mkdir(dirname(resolve(output)), { recursive: true })
  const progress = () => ({ evaluatedAt: new Date().toISOString(), execution, grantId: state.grant.id, backends,
    summary: summarize(rows.filter(row => !row.id.startsWith('guard-'))),
    guardSummary: summarize(rows.filter(row => row.id.startsWith('guard-'))), rows })
  for (const id of state.grant.caseIds) {
    if (rows.some(row => row.id === id)) continue
    const row = partialRow?.id === id ? partialRow : { id, cacheHit: false }
    for (const backend of backends) {
      if (row[backend]) continue // Explicit resume never repeats a recorded provider call.
      let result
      try { result = await requestCase(state, id, backend, credentials, fetchImpl) }
      catch (error) {
        const diagnostic = error instanceof Error && /^REMOTE_\d{3}_[A-Z_]+$/.test(error.message) ? error.message : 'REMOTE_TRANSPORT_FAILED'
        await writeFile(output, JSON.stringify({ ...progress(), partialRow: row, incompleteCase: { id, backend, diagnostic,
            serverCode: error?.serverCode ?? null, tokenLifetimeSeconds: error?.tokenLifetimeSeconds ?? null, tokenAgeSeconds: error?.tokenAgeSeconds ?? null } }, null, 2))
        throw new Error(diagnostic)
      }
      row.feature = result.feature; row.expected = result.expected
      row.suite = id.startsWith('guard-') ? 'guards' : 'comparison'
      const u = result.usage || {}
      row[backend] = { choice: result.choice, elapsedMs: result.elapsedMs, error: result.error, providerStatus: result.providerStatus ?? null,
        providerCode: result.providerCode ?? null, errorKind: result.errorKind ?? null, model: result.model,
        policyVersion: result.policyVersion ?? null, proposedChoice: result.proposedChoice ?? null,
        outcome: result.outcome ?? null, abstentionReason: result.abstentionReason ?? null, decision: result.decision ?? null,
        usage: { inputTokens: u.input_tokens ?? u.inputTokens ?? 0, outputTokens: u.output_tokens ?? u.outputTokens ?? 0,
          cachedTokens: u.input_tokens_details?.cached_tokens ?? 0, cacheWriteTokens: u.input_tokens_details?.cache_write_tokens ?? 0 },
        costUsd: null }
      // Persist each backend immediately, even if the next signed request is rejected.
      await writeFile(output, JSON.stringify({ ...progress(), partialRow: row }, null, 2))
    }
    rows.push(row)
    await writeFile(output, JSON.stringify(progress(), null, 2))
  }
  return rows
}
async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  if (args.includes('--prepare')) {
    const directory = resolve(value('--prepare'))
    const ids = args.includes('--all') ? allDecisionFixtures().map(item => item.id)
      : args.includes('--guards') ? decisionGuardFixtures().map(item => item.id)
      : args.includes('--smoke') ? ['voice-3-0', 'classification-3-0'] : undefined
    const grant = await prepare(directory, ids, args.includes('--environment') ? value('--environment') : 'staging')
    console.log(JSON.stringify({ publicGrant: resolve(directory, 'grant.json'), expiresAt: grant.expiresAt, cases: grant.caseIds.length }))
    return
  }
  if (!args.includes('--state') || !args.includes('--output')) throw new Error('Provide --prepare directory or --state private.json --output report.json')
  const state = JSON.parse(await readFile(value('--state'), 'utf8'))
  const credentials = { clientId: process.env.STAGING_ACCESS_CLIENT_ID, clientSecret: process.env.STAGING_ACCESS_CLIENT_SECRET }
  if (args.includes('--wait-grant')) {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      try { await requestCase(state, state.grant.caseIds[0], 'probe', credentials); ready = true; break }
      catch { await new Promise(resolve => setTimeout(resolve, 5000)) }
    }
    if (!ready) throw new Error('Grant not installed in time')
  }
  const rows = await runRemote(state, value('--output'), credentials, fetch, { resume: args.includes('--resume'), compareV1: args.includes('--compare-v1') })
  if (rows.some(row => row.legacy.error || row.decisions.error || row.decisionsV1?.error)) throw new Error('Provider execution failed; report retained')
  console.log('Remote evaluation completed. Review the report; production remains unchanged.')
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/decisions-remote.mjs')) main().catch(error => {
  const diagnostic = error instanceof Error && /^REMOTE_\d{3}_[A-Z_]+$/.test(error.message) ? error.message : 'REMOTE_EXECUTION_FAILED'
  console.error(`Remote evaluation failed (${diagnostic}). Check the retained report. Secrets are not printed.`); process.exitCode = 1
})
