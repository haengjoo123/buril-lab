import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error Shared corpus is JavaScript.
import { expandedDecisionFixtures, identityBoundaryFixtures } from './decisions-expanded-fixtures.mjs'
// @ts-expect-error Standalone evaluator is JavaScript.
import { analyzeExpanded, expandedManifest, runExpanded } from './decisions-expanded.mjs'
// @ts-expect-error Standalone grant tool is JavaScript.
import { prepare } from './decisions-remote.mjs'
type Fixture = { id: string; feature: string; expected: string | null; split: string; family: string; humanReviewed: boolean; scenario: string; input: unknown }
const fixtures: Fixture[] = expandedDecisionFixtures()
let directory: string | undefined
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined })

describe('expanded evaluation validity and execution', () => {
  it('has exactly 1000 unique inputs per feature and target-family-separated 200/800 splits', () => {
    expect(expandedManifest()).toMatchObject({ cases: 2000, materials: 50, humanReviewed: false })
    expect(new Set(fixtures.map(item => item.id)).size).toBe(2000)
    for (const feature of ['voiceCandidate', 'classification']) {
      const cases = fixtures.filter(item => item.feature === feature)
      expect(cases).toHaveLength(1000)
      expect(new Set(cases.map(item => JSON.stringify(item.input))).size).toBe(1000)
      expect(cases.filter(item => item.split === 'tuning')).toHaveLength(200)
      const training = new Set(cases.filter(item => item.split === 'tuning').map(item => item.family))
      expect(cases.filter(item => item.split === 'validation').every(item => !training.has(item.family))).toBe(true)
      expect(cases.filter(item => item.expected !== null)).toHaveLength(750)
      expect(new Set(cases.map(item => item.scenario)).size).toBe(20)
    }
    expect(fixtures.every(item => item.humanReviewed === false)).toBe(true)
  })
  it('keeps same-formula identity conflicts separate from the frozen comparison denominator', () => {
    const guards = identityBoundaryFixtures()
    expect(guards).toHaveLength(4)
    expect(guards.every((item: Fixture) => item.expected === null && !fixtures.some(f => f.id === item.id))).toBe(true)
    expect(expandedManifest().sha256).toBe('c0d3cb5e939235006b673d9e851f4f3f82fad56ce11eaf4dffe31374dfce844e')
  })
  it('fixes the corpus before live results; ignores no failures and rejects changed labels', () => {
    const fixture = fixtures[0], ids = [fixture.id]
    const rows = ['legacy', 'decisionsV2', 'decisions'].map(backend => ({ ...fixture, backend, choice: fixture.expected, error: false, elapsedMs: 1,
      usage: backend === 'legacy' ? { inputTokens: 123, outputTokens: 45 } : { input_tokens: 456, output_tokens: 0 } }))
    const report = analyzeExpanded(rows, ids)
    expect(report.complete).toBe(true)
    expect(report.groups.all.voiceCandidate.legacy.usage).toMatchObject({ inputTokens: 123, outputTokens: 45 })
    expect(report.groups.all.voiceCandidate.decisions.usage).toMatchObject({ inputTokens: 456, outputTokens: 0 })
    expect(report.groups.all.voiceCandidate.targetPassed).toBe(false) // equal adoption is not a win
    rows[2].error = true; rows[2].choice = null
    expect(analyzeExpanded(rows, ids).groups.all.voiceCandidate.decisions).toMatchObject({ errors: 1, abstained: 0, correct: 0 })
    expect(() => analyzeExpanded([...rows, rows[0]], ids)).toThrow()
    expect(() => analyzeExpanded([{ ...rows[0], expected: null }], ids)).toThrow()
    expect(analyzeExpanded(rows, ids).productionReady).toBe(false)
  })
  it('bounds concurrency, persists each completed call and resumes without repeating calls', async () => {
    directory = await mkdtemp(join(tmpdir(), 'buril-expanded-test-'))
    const ids = fixtures.slice(0, 2).map(item => item.id)
    await prepare(directory, ids, 'production')
    const state = JSON.parse(await readFile(join(directory, 'private.json'), 'utf8'))
    const output = join(directory, 'report.json')
    let active = 0, maximum = 0, calls = 0
    const fetchImpl = async (_url: string, init: RequestInit) => {
      active++; maximum = Math.max(maximum, active); calls++
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      const { caseId, backend } = JSON.parse(init.body as string), fixture = fixtures.find(item => item.id === caseId)!
      return Response.json({ id: caseId, feature: fixture.feature, backend, expected: fixture.expected, choice: fixture.expected, error: false, elapsedMs: 1 })
    }
    const report = await runExpanded(state, output, { fetchImpl, concurrency: 2, intervalMs: 0 })
    expect(report.complete).toBe(true); expect(maximum).toBe(2); expect(calls).toBe(6)
    await runExpanded(state, output, { fetchImpl, concurrency: 2, intervalMs: 0, resume: true })
    expect(calls).toBe(6)
    expect((await readFile(output + '.ndjson', 'utf8')).trim().split('\n')).toHaveLength(6)
    expect(await readFile(output, 'utf8')).not.toContain(state.privateKey.d)
  })
})
