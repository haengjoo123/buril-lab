import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { importJWK, jwtVerify } from 'jose'
// @ts-expect-error The remotely usable CLI is JavaScript.
import { prepare, runRemote, requestCase, evaluationTarget } from './decisions-remote.mjs'
let directory: string | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  if (!directory) return
  await Promise.allSettled(['private.json', 'grant.json', 'report.json'].map(name => unlink(join(directory!, name))))
  await rmdir(directory)
  directory = undefined
})
const credentials = { clientId: 'test-access-id', clientSecret: 'test-access-secret' }
describe('remote evaluation report retention', () => {
  it('runs and retains paired v1/v2 results without mixing guard cases into the comparison set', async () => {
    directory = await mkdtemp(join(tmpdir(), 'buril-decisions-eval-'))
    await prepare(directory, ['classification-3-0', 'guard-classification-2-clear'], 'production')
    const state = JSON.parse(await readFile(join(directory, 'private.json'), 'utf8'))
    const output = join(directory, 'report.json')
    const calls: string[] = []
    await runRemote(state, output, {}, async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      calls.push(body.backend)
      return Response.json({ id: body.caseId, backend: body.backend, feature: 'classification', expected: 'NEUTRAL', choice: 'NEUTRAL',
        policyVersion: body.backend === 'decisionsV1' ? 'classification:v1' : 'classification:v2', error: false, elapsedMs: 1 })
    }, { compareV1: true })
    const report = JSON.parse(await readFile(output, 'utf8'))
    expect(calls).toEqual(['legacy', 'decisionsV1', 'decisions', 'legacy', 'decisionsV1', 'decisions'])
    expect(report.rows[0].decisionsV1.policyVersion).toBe('classification:v1')
    expect(report.summary.classification.legacy.total).toBe(1)
    expect(report.guardSummary.classification.legacy.total).toBe(1)
    await expect(runRemote(state, output, {}, undefined, { resume: true })).rejects.toThrow('does not match')
  })
  it('uses one exact fifteen-second lifetime and tolerates a verifier clock one second behind', async () => {
    directory = await mkdtemp(join(tmpdir(), 'buril-decisions-eval-'))
    await prepare(directory, ['classification-3-0'], 'production')
    const state = JSON.parse(await readFile(join(directory, 'private.json'), 'utf8'))
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_999)
    await requestCase(state, 'classification-3-0', 'probe', {}, async (_url: string, init: RequestInit) => {
      const token = (init.headers as Record<string, string>).Authorization.slice(7)
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
      expect(claims.iat).toBe(0)
      expect(claims.exp).toBe(15)
      expect(now).toHaveBeenCalledTimes(1)
      await expect(jwtVerify(token, await importJWK(state.grant.publicKey, 'EdDSA'), {
        algorithms: ['EdDSA'], maxTokenAge: '15s', currentDate: new Date(1_000),
      })).resolves.toMatchObject({ payload: { iat: 0, exp: 15 } })
      return Response.json({ id: 'classification-3-0', backend: 'probe', error: false })
    })
  })
  it('checkpoints a completed backend and resumes explicitly without repeating it', async () => {
    directory = await mkdtemp(join(tmpdir(), 'buril-decisions-eval-'))
    await prepare(directory, ['classification-3-0'], 'production')
    const state = JSON.parse(await readFile(join(directory, 'private.json'), 'utf8'))
    const output = join(directory, 'report.json')
    const called: string[] = []
    const transport = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      called.push(body.backend)
      if (called.length === 2) return Response.json({ code: 'GRANT_DENIED' }, { status: 403 })
      return Response.json({ id: body.caseId, backend: body.backend, feature: 'classification', expected: null, choice: null, error: false, elapsedMs: 1 })
    }
    await expect(runRemote(state, output, {}, transport)).rejects.toThrow('REMOTE_403_REJECTED')
    expect(JSON.parse(await readFile(output, 'utf8')).partialRow.legacy.error).toBe(false)
    const rows = await runRemote(state, output, {}, transport, { resume: true })
    expect(called).toEqual(['legacy', 'decisions', 'decisions'])
    expect(rows).toHaveLength(1)
    expect(JSON.parse(await readFile(output, 'utf8')).partialRow).toBeUndefined()
    await expect(runRemote({ ...state, grant: { ...state.grant, id: 'another-grant' } }, output, {}, transport, { resume: true })).rejects.toThrow('does not match')
  })
  it('explicitly binds production grants, endpoint, audience and report without forwarding staging credentials', async () => {
    directory = await mkdtemp(join(tmpdir(), 'buril-decisions-eval-'))
    await prepare(directory, ['classification-3-0'], 'production')
    const state = JSON.parse(await readFile(join(directory, 'private.json'), 'utf8'))
    const output = join(directory, 'report.json')
    expect(state.grant.environment).toBe('production')
    await runRemote(state, output, credentials, async (url: string, init: RequestInit) => {
      expect(url).toBe('https://burillab.com/api/internal/decisions/evaluate')
      expect(JSON.stringify(init)).not.toContain('test-access')
      const token = (init.headers as Record<string, string>).Authorization.slice(7)
      expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).aud).toBe('burillab:production:decisions-evaluation:v1')
      const body = JSON.parse(init.body as string)
      return Response.json({ id: body.caseId, backend: body.backend, feature: 'classification', expected: null, choice: null, error: false, elapsedMs: 1 })
    })
    expect(JSON.parse(await readFile(output, 'utf8')).execution).toBe('cloudflare-production')
    expect(() => evaluationTarget('preview')).toThrow()
    await expect(requestCase({ ...state, grant: { ...state.grant, environment: 'staging' } }, 'classification-3-0', 'probe', {})).rejects.toThrow('Missing Staging Access')
  })
  it('retains a safe partial report when an edge 502 replaces the typed server result', async () => {
    directory = await mkdtemp(join(tmpdir(), 'buril-decisions-eval-'))
    await prepare(directory, ['classification-3-0'])
    const state = JSON.parse(await readFile(join(directory, 'private.json'), 'utf8'))
    const output = join(directory, 'report.json')
    await expect(runRemote(state, output, credentials, async () => Response.json({ code: 'BAD_GATEWAY' }, { status: 502 }))).rejects.toThrow('REMOTE_502_INVALID_RESULT')
    const text = await readFile(output, 'utf8')
    expect(JSON.parse(text)).toMatchObject({ rows: [], incompleteCase: { id: 'classification-3-0', backend: 'legacy', diagnostic: 'REMOTE_502_INVALID_RESULT' } })
    expect(text).not.toContain(credentials.clientSecret)
    expect(text).not.toContain(state.privateKey.d)
  })
  it('records both completed provider failures without falsely accepting a result', async () => {
    directory = await mkdtemp(join(tmpdir(), 'buril-decisions-eval-'))
    await prepare(directory, ['classification-3-0'])
    const state = JSON.parse(await readFile(join(directory, 'private.json'), 'utf8'))
    const output = join(directory, 'report.json')
    const rows = await runRemote(state, output, credentials, async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      return Response.json({ id: body.caseId, backend: body.backend, feature: 'classification', expected: 'ORGANIC_NON_HALOGEN',
        choice: null, error: true, providerStatus: 401, elapsedMs: 1 })
    })
    expect(rows[0]).toMatchObject({ legacy: { error: true, providerStatus: 401 }, decisions: { error: true, providerStatus: 401 } })
    const report = JSON.parse(await readFile(output, 'utf8'))
    expect(report.summary.classification.comparisonPassed).toBe(false)
    expect(report.summary.classification.decisions.errors).toBe(1)
  })
})
