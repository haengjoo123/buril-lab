import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose'
import { decisionFixtures } from './decisions-fixtures.mjs'
import { summarize } from './evaluate-decisions.mjs'

export const AUDIENCE = 'burillab:staging:decisions-evaluation:v1'
export const ENDPOINT = 'https://staging.burillab.com/api/internal/decisions/evaluate'

export async function prepare(directory, ids = decisionFixtures().map(item => item.id)) {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })
  const grant = { id: randomUUID(), publicKey: await exportJWK(publicKey), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), caseIds: ids }
  // Only the three public JWK fields are admitted by the server schema.
  grant.publicKey = { kty: grant.publicKey.kty, crv: grant.publicKey.crv, x: grant.publicKey.x }
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'private.json'), JSON.stringify({ grant, privateKey: await exportJWK(privateKey) }), { mode: 0o600, flag: 'wx' })
  await writeFile(resolve(directory, 'grant.json'), JSON.stringify(grant), { mode: 0o600 })
  return grant
}
export async function requestCase(state, caseId, backend, credentials, fetchImpl = fetch) {
  if (!credentials.clientId || !credentials.clientSecret) throw new Error('Missing Staging Access credentials')
  const key = await importJWK(state.privateKey, 'EdDSA')
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA' }).setIssuer(state.grant.id)
    .setAudience(AUDIENCE).setSubject(`${caseId}:${backend}`).setIssuedAt().setExpirationTime('15s').sign(key)
  const response = await fetchImpl(ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      'CF-Access-Client-Id': credentials.clientId, 'CF-Access-Client-Secret': credentials.clientSecret },
    body: JSON.stringify({ caseId, backend }) })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`REMOTE_${response.status}_NON_JSON`)
  const result = await response.json()
  if (response.status !== 200 && response.status !== 502) throw new Error(`REMOTE_${response.status}_REJECTED`)
  if (result.id !== caseId || result.backend !== backend || typeof result.error !== 'boolean') throw new Error(`REMOTE_${response.status}_INVALID_RESULT`)
  return result
}
export async function runRemote(state, output, credentials, fetchImpl = fetch) {
  const rows = []
  await mkdir(dirname(resolve(output)), { recursive: true })
  for (const id of state.grant.caseIds) {
    const row = { id, cacheHit: false }
    for (const backend of ['legacy', 'decisions']) {
      let result
      try { result = await requestCase(state, id, backend, credentials, fetchImpl) }
      catch (error) {
        const diagnostic = error instanceof Error && /^REMOTE_\d{3}_[A-Z_]+$/.test(error.message) ? error.message : 'REMOTE_TRANSPORT_FAILED'
        await writeFile(output, JSON.stringify({ execution: 'cloudflare-staging', grantId: state.grant.id,
          summary: summarize(rows), rows, incompleteCase: { id, backend, diagnostic } }, null, 2))
        throw new Error(diagnostic)
      }
      row.feature = result.feature; row.expected = result.expected
      const u = result.usage || {}
      row[backend] = { choice: result.choice, elapsedMs: result.elapsedMs, error: result.error, providerStatus: result.providerStatus ?? null, model: result.model,
        usage: { inputTokens: u.input_tokens ?? u.inputTokens ?? 0, outputTokens: u.output_tokens ?? u.outputTokens ?? 0,
          cachedTokens: u.input_tokens_details?.cached_tokens ?? 0, cacheWriteTokens: u.input_tokens_details?.cache_write_tokens ?? 0 },
        costUsd: null }
    }
    rows.push(row)
    await writeFile(output, JSON.stringify({ evaluatedAt: new Date().toISOString(), execution: 'cloudflare-staging',
      grantId: state.grant.id, summary: summarize(rows), rows }, null, 2))
  }
  return rows
}
async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  if (args.includes('--prepare')) {
    const directory = resolve(value('--prepare'))
    const ids = args.includes('--smoke') ? ['voice-3-0', 'classification-3-0'] : undefined
    const grant = await prepare(directory, ids)
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
  const rows = await runRemote(state, value('--output'), credentials)
  if (rows.some(row => row.legacy.error || row.decisions.error)) throw new Error('Provider execution failed; report retained')
  console.log('Remote evaluation completed. Review the report; production remains unchanged.')
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/decisions-remote.mjs')) main().catch(error => {
  const diagnostic = error instanceof Error && /^REMOTE_\d{3}_[A-Z_]+$/.test(error.message) ? error.message : 'REMOTE_EXECUTION_FAILED'
  console.error(`Remote evaluation failed (${diagnostic}). Check the retained report. Secrets are not printed.`); process.exitCode = 1
})
