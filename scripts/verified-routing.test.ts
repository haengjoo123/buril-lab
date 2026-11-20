import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error Node CLI shared with the release operator.
import { makeBlindPack, sealReview } from './evaluate-verified-routing.mjs'
// @ts-expect-error Node CLI.
import { prepare } from './decisions-remote.mjs'
// @ts-expect-error Node CLI.
import { runExpanded } from './decisions-expanded.mjs'
import identities from './fixtures/decisions-review-identities.json'
import prior from './fixtures/decisions-paired-pubchem.json'

let directory: string | undefined
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})
type BlindCase = { id: string; feature: string; input: { matches?: { source: string; id: string }[] } }
const pack = makeBlindPack(),
  cases: BlindCase[] = pack.cases
const voice = cases.filter((f) => f.feature === 'voiceCandidate')
const review = () => ({
  version: 1,
  inputDigest: pack.inputDigest,
  referencesDigest: pack.referencesDigest,
  reviewer: 'fixture reviewer',
  attested: true,
  labels: Object.fromEntries(voice.map((f) => [f.id, { choice: null as string | null }])),
})

describe('prospective human review', () => {
  it('separates new materials, distinct input records, offered bottles and the blind input view', () => {
    expect(new Set(identities.materials.map((m) => m.casNumber)).size).toBe(50)
    expect(identities.materials.some((m) => Object.hasOwn(prior, m.casNumber))).toBe(false)
    expect(new Set(cases.map((c) => c.id)).size).toBe(2000)
    for (const subset of [voice, cases.filter((c) => c.feature === 'classification')]) {
      expect(subset).toHaveLength(1000)
      expect(new Set(subset.map((c) => JSON.stringify(c.input))).size).toBe(1000)
    }
    expect(cases.every((c) => Object.keys(c).sort().join(',') === 'feature,id,input')).toBe(true)
    expect(Math.max(...voice.map((c) => c.input.matches!.length))).toBe(120)
    expect(
      voice.every((c) => new Set(c.input.matches!.map((m) => m.source + ':' + m.id)).size === c.input.matches!.length),
    ).toBe(true)
  })
  it('distinguishes explicit review from a missing label and seals both input and reference facts', () => {
    const submitted = review(),
      id = voice[0].id
    const { source, id: bottleId } = voice[0].input.matches![0]
    submitted.labels[id] = { choice: source + ':' + bottleId }
    const sealed = sealReview(pack, 'voiceCandidate', submitted)
    expect(sealed.labels).toHaveLength(1000)
    expect(sealReview(pack, 'voiceCandidate', submitted).reviewDigest).toBe(sealed.reviewDigest)
    expect(() => sealReview(pack, 'classification', submitted)).toThrow('Unreviewed')
    expect(() => sealReview(pack, 'voiceCandidate', { ...submitted, referencesDigest: 'changed' })).toThrow('attested')
    expect(() => sealReview(pack, 'voiceCandidate', { ...submitted, attested: false })).toThrow('attested')
    const other = voice[1].input.matches![0]
    submitted.labels[id] = { choice: other.source + ':' + other.id }
    expect(() => sealReview(pack, 'voiceCandidate', submitted)).toThrow('Invalid human choice')
    delete submitted.labels[id]
    expect(() => sealReview(pack, 'voiceCandidate', submitted)).toThrow('Unreviewed')
  })
  it('keeps reviewed labels local during a signed comparison and binds resumption to the same review', async () => {
    directory = await mkdtemp(join(tmpdir(), 'buril-blind-label-test-'))
    const id = voice[0].id,
      digest = 'b'.repeat(64),
      out = join(directory, 'result.json')
    await prepare(directory, [id], 'production', digest)
    const state = JSON.parse(await readFile(join(directory, 'private.json'), 'utf8'))
    const suite = {
      manifest: { reviewDigest: digest },
      fixtures: [{ ...voice[0], expected: null, split: 'validation' }],
    }
    const options = {
      suite,
      backends: ['legacy'],
      intervalMs: 0,
      fetchImpl: async (_url: string, init: RequestInit) => {
        expect(JSON.parse(init.body as string)).toEqual({ caseId: id, backend: 'legacy' })
        return Response.json({
          id,
          feature: 'voiceCandidate',
          backend: 'legacy',
          choice: null,
          error: false,
          elapsedMs: 1,
        })
      },
    }
    const report = await runExpanded(state, out, options)
    expect(report.complete).toBe(true)
    expect(report.records[0].expected).toBeNull()
    await expect(
      runExpanded(state, out, {
        ...options,
        resume: true,
        suite: { ...suite, manifest: { reviewDigest: 'c'.repeat(64) } },
      }),
    ).rejects.toThrow('sealed human review')
  })
})
