import { describe, expect, it } from 'vitest'
import type { ChemicalRegulationEntry } from './chemicalRegulations'
import { REGULATION_OBLIGATION_RULES, hasObligation, obligationsForEntries } from './regulationObligations'

const humanEco = (contentThreshold?: string): ChemicalRegulationEntry => ({
  category: 'human_eco_hazard', typeName: '인체등유해성물질', ...(contentThreshold ? { contentThreshold } : {}),
})

const ids = (entries: ChemicalRegulationEntry[], concentration?: number | null) =>
  obligationsForEntries(entries, concentration).map((obligation) => obligation.id)

describe('obligationsForEntries', () => {
  it('turns a human-toxic class into locked, separated and labelled storage', () => {
    expect(ids([humanEco('인체급성유해성 : 1%, 인체만성유해성 : 0.1%')], 5)).toEqual([
      'store_locked', 'separate_storage', 'label_container',
    ])
  })

  it('does not ask for locked storage when only the ecological threshold applies', () => {
    expect(ids([humanEco('생태유해성 : 1%')], 5)).toEqual(['separate_storage', 'label_container'])
    expect(ids([humanEco('인체급성유해성 : 10%, 생태유해성 : 1%')], 5)).toEqual(['separate_storage', 'label_container'])
    expect(ids([{ category: 'eco_toxic', typeName: '생태유해성물질' }])).toEqual(['separate_storage', 'label_container'])
  })

  it('keeps use-limited classes to their own line and adds handling duties only for hazardous classes', () => {
    expect(ids([{ category: 'restricted', typeName: '제한물질', contentThreshold: '이를 1% 이상 함유한 혼합물' }], 5))
      .toEqual(['check_restricted_use'])
    expect(ids([
      { category: 'banned', typeName: '금지물질' },
      { category: 'permitted', typeName: '허가물질' },
      { category: 'accident_preparedness', typeName: '사고대비물질' },
    ])).toEqual(['do_not_use_banned', 'check_permit', 'separate_storage', 'label_container'])
  })

  it('drops classes that are below their threshold at the entered concentration', () => {
    const entries = [
      { category: 'accident_preparedness', typeName: '사고대비물질', contentThreshold: '이를 10% 이상 함유한 혼합물' },
      humanEco('인체급성유해성 : 10%'),
    ] satisfies ChemicalRegulationEntry[]
    expect(ids(entries, 3.6)).toEqual([])
    expect(ids(entries, 10)).toEqual(['store_locked', 'separate_storage', 'label_container'])
  })

  it('marks duties as conditional with the lowest threshold while the concentration is unknown', () => {
    const obligations = obligationsForEntries([
      { category: 'accident_preparedness', typeName: '사고대비물질', contentThreshold: '이를 25% 이상 함유한 혼합물' },
      humanEco('인체급성유해성 : 10%, 생태유해성 : 1%'),
    ])
    const byId = Object.fromEntries(obligations.map((obligation) => [obligation.id, obligation]))
    expect(byId.store_locked.condition).toEqual({ kind: 'concentration', lowestPercent: 10 })
    expect(byId.separate_storage.condition).toEqual({ kind: 'concentration', lowestPercent: 1 })
    expect(byId.separate_storage.categories).toEqual(['accident_preparedness', 'human_eco_hazard'])
  })

  it('treats a duty as definite when any triggering class applies without a rule', () => {
    const [locked] = obligationsForEntries([
      { category: 'acute_toxic', typeName: '인체급성유해성물질' },
      humanEco('인체급성유해성 : 10%'),
    ])
    expect(locked).toMatchObject({ id: 'store_locked', condition: { kind: 'always' } })
  })

  it('ignores non-hazardous classes', () => {
    expect(ids([{ category: 'existing', typeName: '기존화학물질' }, { category: 'priority_control', typeName: '중점관리물질' }])).toEqual([])
  })

  it('answers whether a single duty applies', () => {
    expect(hasObligation([humanEco('인체급성유해성 : 1%')], 'store_locked')).toBe(true)
    expect(hasObligation([humanEco('생태유해성 : 1%')], 'store_locked')).toBe(false)
  })
})

describe('REGULATION_OBLIGATION_RULES', () => {
  it('cites a checked legal source for every line in both languages', () => {
    const seen = new Set<string>()
    for (const rule of REGULATION_OBLIGATION_RULES) {
      expect(seen.has(rule.id), rule.id).toBe(false)
      seen.add(rule.id)
      expect(rule.text.ko.length, rule.id).toBeGreaterThan(5)
      expect(rule.text.en.length, rule.id).toBeGreaterThan(5)
      expect(rule.source.citation, rule.id).toMatch(/법|지침/)
      expect(rule.source.checkedAt, rule.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(rule.source.url, rule.id).toMatch(/^https:\/\/www\.law\.go\.kr\//)
    }
  })
})
