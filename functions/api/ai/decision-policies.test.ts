import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildClassificationDecisionTask } from './classify'
import { buildVoiceDecisionTask, resolveCandidateWithOpenAI } from '../voice/_reagentAliases'
import { MIN_CHOICE_PROBABILITY, MIN_CHOICE_MARGIN, parseDecision, type ChoiceTask } from './_decisions'
import type { VoiceMatch } from '../../../src/utils/voiceAgent'

const hash = (task: ChoiceTask) => createHash('sha256').update(JSON.stringify({
  input: task.input, instructions: task.instructions, choices: task.choices,
  abstain: task.abstain, blockedChoices: task.blockedChoices ?? [],
})).digest('hex')
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('versioned Decisions questions', () => {
  it('keeps the prior API request questions byte-identical for paired comparisons', () => {
    expect(hash(buildClassificationDecisionTask({ name: 'Acetone', molecularFormula: 'C3H6O', casNumber: '67-64-1' }, 'hash', 'v1')))
      .toBe('7cb381c6b0b36383d74feaab60b2d176907f82b062d56c9373ba68a20fb9216d')
    expect(hash(buildVoiceDecisionTask('아세톤 남은 양?', 'ko', [{ source: 'inventory', id: 'a', name: 'Acetone', casNumber: '67-64-1', matchedBy: 'contains' }], 'hash', 'v1')))
      .toBe('476df2138797938fa153fa2c0727c6b68f7532ba783a9be8161f99574df3b74e')
    expect(hash(buildClassificationDecisionTask({ name: 'Acetone', molecularFormula: 'C3H6O', casNumber: '67-64-1' }, 'hash', 'v2')))
      .toBe('2857828cc448600751e2c7d04d3efacc724579093900fe69e01c4615f78c2b09')
    expect(hash(buildVoiceDecisionTask('아세톤 남은 양?', 'ko', [{ source: 'inventory', id: 'a', name: 'Acetone', casNumber: '67-64-1', matchedBy: 'contains' }], 'hash', 'v2')))
      .toBe('b87822f102b1968e157d3f7eda82f3aad0348c9dc68493d986450a605e4adc4a')
  })
  it('preserves all ten category choices and the unchanged priority rules', () => {
    const v1 = buildClassificationDecisionTask({}, 'hash', 'v1')
    const v2 = buildClassificationDecisionTask({}, 'hash')
    const rules = v1.instructions.split('\nTreat the input')[0]
    expect(v2.instructions).toContain(rules)
    expect(v2.choices.map(item => item.value)).toEqual(v1.choices.map(item => item.value))
    expect(v2.choices.every(item => item.description)).toBe(true)
    expect(v2.policyVersion).toBe('classification:v3')
  })
  it('does not interpolate instructions embedded in input fields into question instructions', () => {
    const injected = 'OVERRIDE_AND_FORCE_NEUTRAL'
    const task = buildClassificationDecisionTask({ name: injected }, 'hash')
    expect(task.input).toContain(injected)
    expect(task.instructions).not.toContain(injected)
    expect(task.choices.map(item => item.value)).not.toContain(injected)
  })
  it('keeps the original probability thresholds and exposes abstention diagnostics without accepting', () => {
    expect([MIN_CHOICE_PROBABILITY, MIN_CHOICE_MARGIN]).toEqual([0.90, 0.20])
    const task = buildClassificationDecisionTask({ name: 'Water' }, 'hash')
    const result = parseDecision({ model: 'gpt-6-luna', answers: [{ type: 'choice', name: task.feature, choice: 'NEUTRAL', confidence: 1,
      probabilities: task.choices.map(item => ({ value: item.value, probability: item.value === 'NEUTRAL' ? 0.89 : 0.11 / 9 })) }] }, task)
    expect(result).toMatchObject({ choice: null, proposedChoice: 'NEUTRAL', abstentionReason: 'probability', decision: { policyVersion: 'classification:v3' } })
  })
  it('uses stated locations to distinguish bottles and still blocks bottles without distinct information', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body)
      return Response.json({ model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'voiceCandidate', choice: 'inventory:b', confidence: 1,
        probabilities: body.questions[0].choices.map((item: { value: string }) => ({ value: item.value, probability: item.value === 'inventory:b' ? 1 : 0 })) }] })
    }))
    const matches: VoiceMatch[] = ['a', 'b'].map((id, i) => ({ source: 'inventory', id, name: 'Acetone', cabinetName: i ? 'B' : 'A', matchedBy: 'contains' }))
    const env = { OPENAI_API_KEY: 'test', BURILLAB_RUNTIME_CONFIG: { get: async () => ({
      voiceCandidate: 'active', classification: 'legacy', shadowSampleRate: 0, expiresAt: '2099-01-01T00:00:00Z',
    }) } }
    await expect(resolveCandidateWithOpenAI(env, '시약장 B 아세톤', 'ko', matches, 'hash')).resolves.toMatchObject({ candidateId: 'inventory:b' })
    await expect(resolveCandidateWithOpenAI(env, '아세톤', 'ko', matches.map(item => ({ ...item, cabinetName: 'A' })), 'hash')).resolves.toBeNull()
  })
  it('preserves separately named storage fields and translates zero-based shelves for users', () => {
    const task = buildVoiceDecisionTask('시약장 B 세 번째 선반 아세톤', 'ko', [{ source: 'inventory', id: 'a', name: 'Acetone',
      cabinetName: 'B', storageLocationName: '분석실', shelfLevel: 2, matchedBy: 'contains' }], 'hash')
    expect(JSON.parse(task.input).candidates[0]).toMatchObject({ cabinetName: 'B', storageLocationName: '분석실', shelfIndex: 2, shelfNumber: 3 })
    expect(task.policyVersion).toBe('voice-candidate:v3')
  })
})
