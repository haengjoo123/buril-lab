import { describe, expect, it } from 'vitest'
import { buildVoiceDecisionTask } from '../functions/api/voice/_reagentAliases'
import { buildClassificationDecisionTask } from '../functions/api/ai/classify'
import { fixedIdentityEvidence } from '../functions/api/internal/decisions/_pairedControl'
import type { VoiceMatch } from '../src/utils/voiceAgent'
// @ts-expect-error The same fixed cases are read by the CLI and the signed evaluation handler.
import { pairedFixtureById } from './decisions-paired-fixtures.mjs'
// @ts-expect-error The standalone evaluation CLI is JavaScript.
import { pairedSuite, replayVoice85 } from './evaluate-paired-decisions.mjs'

describe('prospective Decisions comparison', () => {
  it('binds the labels, public evidence and actual AI gate before the paid run', async () => {
    const suite = await pairedSuite()
    expect(suite.fixtures.length).toBe(2000)
    expect(suite.eligibleIds.size).toBe(523)
    expect(suite.fixtures.filter((f: { id: string; expected: string | null }) => suite.eligibleIds.has(f.id) && f.expected !== null)).toHaveLength(393)
    expect(pairedFixtureById('paired-1-voice-00-1')).toBeNull()
    expect(pairedFixtureById('paired-1-class-1-20')).toBeNull()
  })
  it('retains every original bottle, selector and duplicate block without coalescing different labels on the same CAS', () => {
    const original = pairedFixtureById('paired-1-voice-1-12').input
    const target = original.matches.at(0)
    const matches: VoiceMatch[] = [target, { ...target, id: 'unresolvable-copy' }, { ...target, id: 'different', name: 'Different label' }, ...original.matches.slice(1)]
    const flat = buildVoiceDecisionTask(original.text, 'ko', matches, 'test', 'v4')
    const grouped = buildVoiceDecisionTask(original.text, 'ko', matches, 'test', 'v5')
    type Group = { name: string; casNumber: string; bottles: { candidateId: string }[] }
    const groups: Group[] = JSON.parse(grouped.input).groups
    const flattened = groups.flatMap(({ name, casNumber, bottles }) => bottles.map(b => ({ ...b, name, casNumber })))
    const byId = (a: { candidateId: string }, b: { candidateId: string }) => a.candidateId.localeCompare(b.candidateId)
    expect(flattened.sort(byId)).toEqual(JSON.parse(flat.input).candidates.sort(byId))
    expect(grouped.blockedChoices).toEqual(flat.blockedChoices)
    expect(grouped.blockedChoices).toContain('inventory:unresolvable-copy')
    expect(groups.find(g => g.bottles.some(b => b.candidateId === 'inventory:different'))?.bottles).toHaveLength(1)
    expect(grouped.choices.map(c => c.value)).toEqual(flat.choices.map(c => c.value))
  })
  it('applies the same priority to the question and solid choice while retaining the other category rules', () => {
    const chemical = { name: '보조 분류 입력' }
    const v6 = buildClassificationDecisionTask(chemical, 'test', 'v6', fixedIdentityEvidence())
    const v7 = buildClassificationDecisionTask(chemical, 'test', 'v7', fixedIdentityEvidence())
    const solid = v7.choices.find(choice => choice.value === 'SOLID_WASTE')!.description!
    expect(v7.instructions).toContain(solid)
    for (const rule of v6.instructions.split('\n').filter(line => /^[1-59]\.|^10\./.test(line))) expect(v7.instructions).toContain(rule)
    expect(v7.choices.map(choice => choice.value)).toEqual(v6.choices.map(choice => choice.value))
    expect(v7.input).toBe(v6.input)
  })
  it('replays only eligible probability holds and keeps explicit review, wrong margins and duplicate blocks closed', () => {
    const row = { backend: 'decisionsTrial', feature: 'voiceCandidate', error: false, choice: null, proposedChoice: 'inventory:a',
      abstentionReason: 'probability', decision: { probabilities: [{ value: 'inventory:a', probability: .85 }, { value: '__review__', probability: .15 }] } }
    expect(replayVoice85(row).choice).toBe('inventory:a')
    for (const reason of ['duplicate_identity', 'explicit_review', 'refusal', 'margin']) expect(replayVoice85({ ...row, abstentionReason: reason }).choice).toBeNull()
    expect(replayVoice85({ ...row, error: true }).choice).toBeNull()
    expect(replayVoice85({ ...row, feature: 'classification' }).choice).toBeNull()
  })
})
