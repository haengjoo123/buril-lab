import { describe, expect, it } from 'vitest'
import { parseWasteComponents, WASTE_COMPONENT_LIMIT } from './parseWasteComponents'

const mL = (value: number) => ({ value, unit: 'mL', kind: 'volume' })

describe('reading waste components from one sentence', () => {
  it.each([
    ['아세톤 200mL랑 메탄올 100mL 섞은 폐액', [['아세톤', mL(200)], ['메탄올', mL(100)]]],
    ['아세톤 200 mL, 메탄올 100 mL, 물 1L 폐액', [['아세톤', mL(200)], ['메탄올', mL(100)], ['물', { value: 1, unit: 'L', kind: 'volume' }]]],
    ['아세톤 200mL와 에탄올 50mL 그리고 헥산 30mL 버릴게', [['아세톤', mL(200)], ['에탄올', mL(50)], ['헥산', mL(30)]]],
    ['아세톤200ml+메탄올100ml 폐액', [['아세톤', mL(200)], ['메탄올', mL(100)]]],
    ['아세톤을 200mL 버렸어', [['아세톤', mL(200)]]],
    ['아세톤 1,500 mL 폐액', [['아세톤', mL(1500)]]],
    ['아세톤 0.5리터하고 메탄올 300밀리리터 폐액', [['아세톤', { value: 0.5, unit: 'L', kind: 'volume' }], ['메탄올', mL(300)]]],
    ['DMSO 500 μL랑 버퍼 2 cc 폐액', [['DMSO', { value: 500, unit: 'uL', kind: 'volume' }], ['버퍼', mL(2)]]],
    ['sodium chloride 5 g and acetone 100 mL waste', [['sodium chloride', { value: 5, unit: 'g', kind: 'mass' }], ['acetone', mL(100)]]],
    ['2-프로판올 100mL랑 1,2-디클로로에탄 50mL 폐액', [['2-프로판올', mL(100)], ['1,2-디클로로에탄', mL(50)]]],
    ['염화 나트륨 10g 폐기', [['염화 나트륨', { value: 10, unit: 'g', kind: 'mass' }]]],
  ])('reads "%s"', (text, expected) => {
    expect(parseWasteComponents(text).map((component) => [component.name, component.amount])).toEqual(expected)
  })

  it('reads names that follow their amounts', () => {
    expect(parseWasteComponents('200 mL of acetone and 100 mL of methanol waste').map((component) => component.name))
      .toEqual(['acetone', 'methanol'])
    expect(parseWasteComponents('200mL 아세톤이랑 100mL 메탄올 섞은 폐액').map((component) => component.name))
      .toEqual(['아세톤', '메탄올'])
    expect(parseWasteComponents('200mL 황산과 100mL 질산 폐액').map((component) => component.name)).toEqual(['황산', '질산'])
  })

  it('leaves out the words around a name', () => {
    expect(parseWasteComponents('폐액통에 아세톤 200mL 부어도 돼?')).toEqual([{ name: '아세톤', amount: mL(200) }])
    expect(parseWasteComponents('여기에 메탄올 약 100mL 버릴게')).toEqual([{ name: '메탄올', amount: mL(100) }])
    // A concentration beside the name is not part of it; it is entered in the review.
    expect(parseWasteComponents('10% 염산 500mL랑 3M 수산화나트륨 200mL 폐액').map((component) => component.name))
      .toEqual(['염산', '수산화나트륨'])
  })

  it('reads only components written with an amount', () => {
    // 황산 has no amount, so it is left for the person to add in the review.
    expect(parseWasteComponents('황산과 질산 100mL 폐액')).toEqual([{ name: '질산', amount: mL(100) }])
    expect(parseWasteComponents('아세톤 200mL랑 메탄올 섞은 폐액')).toEqual([{ name: '아세톤', amount: mL(200) }])
  })

  it('never shortens a name into another substance', () => {
    // 질산은 is silver nitrate; dropping the last syllable would make it nitric acid.
    expect(parseWasteComponents('질산은 100mL 폐액')[0].name).toBe('질산은')
    expect(parseWasteComponents('과산화수소 100mL 폐액')[0].name).toBe('과산화수소')
    // An unreadable lead-in stays in the name, so the lookup fails instead of guessing.
    expect(parseWasteComponents('오늘 쓴 아세톤 200mL 폐액')[0].name).toBe('오늘 쓴 아세톤')
  })

  it.each([
    '아세톤 어떻게 버려?',
    '아세톤이랑 메탄올 섞어도 돼?',
    '폐액통 현황 알려줘',
    '3M 염산 폐액',
    '10% 에탄올 폐액',
    '200mL',
    '폐액 200mL',
    '',
  ])('finds no component in "%s"', (text) => {
    expect(parseWasteComponents(text)).toEqual([])
  })

  it('does not read a unit out of an ordinary word', () => {
    expect(parseWasteComponents('아세톤 5 gallon 폐액')).toEqual([])
    expect(parseWasteComponents('아세톤 200 Molar 폐액')).toEqual([])
  })

  it('ignores an amount of nothing and stops at the limit', () => {
    expect(parseWasteComponents('아세톤 0mL 폐액')).toEqual([])
    const many = Array.from({ length: 12 }, (_, index) => `시약${String.fromCharCode(0xac00 + index)} ${index + 1}mL`).join(', ')
    expect(parseWasteComponents(`${many} 폐액`)).toHaveLength(WASTE_COMPONENT_LIMIT)
  })
})
