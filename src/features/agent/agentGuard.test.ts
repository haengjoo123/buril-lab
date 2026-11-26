import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isDisposalSafetyQuery } from '../../../functions/api/voice/query'
import {
  classifyAgentInput,
  hasDisposalWording,
  parseWasteIntent,
  routeAgentInputLocally,
  shouldSuggestAgentMode,
} from './agentGuard'

const DISPOSAL_SENTENCES = [
  '아세톤 폐기 방법 알려줘',
  '이거 버리려면 어떻게 해',
  '산과 염기를 혼합해도 돼?',
  '물을 넣어서 희석할까?',
  '중화한 뒤 처리해도 되나요',
  '배수구로 흘려보내도 돼?',
  '싱크대에 버려 줘',
  '폐액통에 부어도 될까',
  '이 용기에 넣어 줘',
  'How should I dispose of acetone?',
  'Can I throw this away?',
  'Mix these two reagents',
  'Should I dilute this with water?',
  'Can I neutralize the acid?',
  'Pour it down the drain',
  'Put this into the waste bottle',
  '폐액통 수거 요청해줘',
  '지난달 폐기 기록 요약해줘',
  '아세톤 200mL랑 메탄올 100mL 섞은 폐액',
  'WASTE log for last month',
  '폐시약 목록',
]

const OTHER_SENTENCES = [
  '아세톤 어디 있어?',
  '에탄올 얼마나 남았어',
  '유효기한 지난 시약 알려줘',
  '재고 화면 열어줘',
  '일상점검 빠진 날 있어?',
  'where is acetone',
  'show expired reagents',
  'sodium chloride',
  '67-64-1',
  '염화 나트륨',
  '구매 요청 현황',
]

describe('disposal wording guard', () => {
  // The agent endpoint relies on this guard alone, so every pattern of the voice rule
  // must be present here character for character. A change there fails this test.
  it('contains every pattern of the voice endpoint rule verbatim', () => {
    const voiceSource = readFileSync(new URL('../../../functions/api/voice/query.ts', import.meta.url), 'utf8')
    const guardSource = readFileSync(new URL('./agentGuard.ts', import.meta.url), 'utf8')
    const block = /const DISPOSAL_SAFETY_PATTERNS = \[\r?\n([\s\S]*?)\r?\n\]/.exec(voiceSource)?.[1]
    const voicePatterns = (block ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

    expect(voicePatterns.length).toBeGreaterThanOrEqual(6)
    for (const pattern of voicePatterns) {
      expect(pattern.startsWith('/')).toBe(true)
      expect(guardSource).toContain(pattern)
    }
  })

  it.each(DISPOSAL_SENTENCES)('keeps waste wording away from the model: %s', (text) => {
    expect(hasDisposalWording(text)).toBe(true)
  })

  it.each(OTHER_SENTENCES)('lets an ordinary request through: %s', (text) => {
    expect(hasDisposalWording(text)).toBe(false)
  })

  // The voice endpoint owns the rule. This copy lets the app decide without a network
  // call, and the two must give the same answer.
  it.each([...DISPOSAL_SENTENCES, ...OTHER_SENTENCES, '', '   ', 'ＷＡＳＴＥ', '처리하다', 'mixing bowl', 'PCR master mix'])(
    'agrees with the voice endpoint rule for: %s',
    (text) => {
      expect(hasDisposalWording(text)).toBe(isDisposalSafetyQuery(text))
    },
  )

  // Inflected forms, which the rule did not catch at first.
  it.each([
    '아세톤 어떻게 버려?',
    '이거 그냥 버릴까',
    '다 쓴 건 버렸어',
    '그냥 부어도 돼?',
    '바닥에 쏟아졌어',
    '폐수로 흘려도 돼?',
    '폐유 어디에 모아?',
    'Was it discarded?',
    'I am disposing of the acid',
    'Can it be poured out?',
    'throw it out',
  ])('catches the inflected form: %s', (text) => {
    expect(hasDisposalWording(text)).toBe(true)
    expect(isDisposalSafetyQuery(text)).toBe(true)
  })
})

describe('input classification', () => {
  it.each([
    ['67-64-1', 'identifier'],
    ['7732-18-5', 'identifier'],
    ['Acetone', 'identifier'],
    ['아세톤', 'identifier'],
    ['A1234-500ML', 'identifier'],
    // Multi-word names carry no cue, so they are not mistaken for a sentence.
    ['sodium chloride', 'unclear'],
    ['염화 나트륨', 'unclear'],
    ['2-(N-morpholino)ethanesulfonic acid hydrate', 'unclear'],
    ['N,N-dimethylformamide anhydrous 99.8%', 'unclear'],
    ['아세톤 어디 있어?', 'sentence'],
    ['에탄올 잔량', 'sentence'],
    ['유효기한 지난 시약', 'sentence'],
    ['만료', 'sentence'],
    ['재고 화면 열어줘', 'sentence'],
    ['where is acetone', 'sentence'],
    ['list expired reagents', 'sentence'],
    ['how much ethanol is left', 'sentence'],
    ['', 'empty'],
    ['   ', 'empty'],
  ])('classifies %s as %s', (text, kind) => {
    expect(classifyAgentInput(text)).toBe(kind)
  })

  it('offers agent mode from normal search only for clear sentences', () => {
    expect(shouldSuggestAgentMode('아세톤 어디 있어?')).toBe(true)
    expect(shouldSuggestAgentMode('sodium chloride')).toBe(false)
    expect(shouldSuggestAgentMode('Acetone')).toBe(false)
    expect(shouldSuggestAgentMode('67-64-1')).toBe(false)
  })
})

describe('waste records questions', () => {
  it.each([
    ['폐액통 현황 알려줘', { kind: 'container_status' }],
    ['폐액통 얼마나 찼어?', { kind: 'container_status' }],
    ['폐액통 수거 요청 현황 보여줘', { kind: 'container_status' }],
    ['show waste container status', { kind: 'container_status' }],
    ['지난달 폐기 기록 요약해줘', { kind: 'waste_summary', period: 'last_month' }],
    ['이번 주 폐기량 알려줘', { kind: 'waste_summary', period: 'this_week' }],
    ['지난주 폐액 내역', { kind: 'waste_summary', period: 'last_week' }],
    ['오늘 폐액 기록', { kind: 'waste_summary', period: 'today' }],
    ['이번 달 폐기 통계', { kind: 'waste_summary', period: 'this_month' }],
    ['폐기 내역 보여줘', { kind: 'waste_summary', period: 'last_30d' }],
    ['waste log for last week', { kind: 'waste_summary', period: 'last_week' }],
  ] as const)('answers "%s" from the lab\'s records', (text, intent) => {
    expect(parseWasteIntent(text)).toEqual(intent)
    expect(routeAgentInputLocally(text)).toEqual({ kind: 'waste', intent })
  })

  // Asking how to dispose of something, or asking for something to be done, is never a records question.
  it.each([
    '폐액통에 부어도 될까',
    '폐액통에 뭐 넣어도 돼?',
    '폐액통 수거 요청 어떻게 해?',
    '폐액통에 부어서 수거 요청해줘',
    '폐액 수거 요청해줘',
    '폐액통 교체 신청',
    '폐기 방법 기록 알려줘',
    '아세톤 폐기 방법 알려줘',
    '폐액 어떻게 처리해?',
    '지난달에 뭐 버렸어?',
    'how do I empty the waste container',
    'Can I pour this into the waste bottle?',
    'list what I can mix in the waste container',
    '폐액통',
    '폐액',
  ])('leaves "%s" to the fixed disposal card', (text) => {
    expect(parseWasteIntent(text)).toBeNull()
    expect(routeAgentInputLocally(text)).toEqual({ kind: 'disposal' })
  })

  // A pickup is the one thing the app can propose to do; it is shown for confirmation, never sent.
  it.each([
    '폐액통 수거 요청해줘',
    '폐액통 수거 신청',
    '폐기통 수거 좀 불러줘',
    'request a pickup for the waste container',
    'schedule waste container collection',
  ])('proposes a pickup for "%s"', (text) => {
    expect(parseWasteIntent(text)).toEqual({ kind: 'pickup_request' })
    expect(routeAgentInputLocally(text)).toEqual({ kind: 'waste', intent: { kind: 'pickup_request' } })
  })

  // Components written with amounts describe a batch; the review screen judges it.
  it('reads a list of components with amounts as a batch to review, without any model', () => {
    const mL = (value: number) => ({ value, unit: 'mL', kind: 'volume' })
    expect(routeAgentInputLocally('아세톤 200mL랑 메탄올 100mL 섞은 폐액')).toEqual({
      kind: 'waste',
      intent: { kind: 'waste_batch', components: [{ name: '아세톤', amount: mL(200) }, { name: '메탄올', amount: mL(100) }] },
    })
    // Even a question about pouring ends at the review when it names what and how much.
    expect(parseWasteIntent('폐액통에 아세톤 200mL 부어도 돼?')).toEqual({
      kind: 'waste_batch', components: [{ name: '아세톤', amount: mL(200) }],
    })
    // A records question keeps its meaning even with an amount in it.
    expect(parseWasteIntent('지난달 폐기 기록 중 아세톤 200mL 찾아줘')).toEqual({ kind: 'waste_summary', period: 'last_month' })
    // Without waste wording the sentence is not a waste request at all.
    expect(routeAgentInputLocally('아세톤 200mL랑 메탄올 100mL 있어?')).toEqual({ kind: 'planner' })
  })

  it('never treats text without waste wording as a waste question', () => {
    expect(routeAgentInputLocally('구매 요청 현황 알려줘')).toEqual({ kind: 'planner' })
    expect(routeAgentInputLocally('지난달 입고 내역 보여줘')).toEqual({ kind: 'planner' })
  })
})

describe('local routing before any network call', () => {
  it('routes waste wording to fixed rules even when it also reads as a sentence or a name', () => {
    expect(routeAgentInputLocally('아세톤 어떻게 버려?')).toEqual({ kind: 'disposal' })
    expect(routeAgentInputLocally('폐액')).toEqual({ kind: 'disposal' })
    expect(routeAgentInputLocally('waste')).toEqual({ kind: 'disposal' })
  })

  it('sends a plain name or CAS number to the normal search', () => {
    expect(routeAgentInputLocally('  Acetone ')).toEqual({ kind: 'identifier', query: 'Acetone' })
    expect(routeAgentInputLocally('67-64-1')).toEqual({ kind: 'identifier', query: '67-64-1' })
  })

  it('sends sentences and multi-word text to the planner', () => {
    expect(routeAgentInputLocally('아세톤 어디 있어?')).toEqual({ kind: 'planner' })
    expect(routeAgentInputLocally('sodium chloride')).toEqual({ kind: 'planner' })
  })

  it('does nothing for empty text', () => {
    expect(routeAgentInputLocally('   ')).toEqual({ kind: 'empty' })
  })
})
