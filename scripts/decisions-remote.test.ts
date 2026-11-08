import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error The remotely usable CLI is JavaScript.
import { prepare, runRemote } from './decisions-remote.mjs'
let directory: string | undefined
afterEach(async () => {
  if (!directory) return
  await Promise.allSettled(['private.json', 'grant.json', 'report.json'].map(name => unlink(join(directory!, name))))
  await rmdir(directory)
  directory = undefined
})
const credentials = { clientId: 'test-access-id', clientSecret: 'test-access-secret' }
describe('remote evaluation report retention', () => {
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
