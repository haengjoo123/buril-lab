// Hand-authored contract examples, expanded by input format/wording. Not human safety review.
const substances = [
  ['Hydrochloric acid', '염산', 'HCl', '7647-01-0', 'ACID'],
  ['Sodium hydroxide', '수산화나트륨', 'NaOH', '1310-73-2', 'ALKALI'],
  ['Pure water', '순수한 물', 'H2O', '7732-18-5', 'NEUTRAL'],
  ['Acetone', '아세톤', 'C3H6O', '67-64-1', 'ORGANIC_NON_HALOGEN'],
  ['Chloroform', '클로로포름', 'CHCl3', '67-66-3', 'ORGANIC_HALOGEN'],
  ['Copper sulfate', '황산구리', 'CuSO4', '7758-98-7', 'HEAVY_METAL'],
  ['Sodium cyanide', '시안화나트륨', 'NaCN', '143-33-9', 'CYANIDE'],
  ['Nitric acid', '질산', 'HNO3', '7697-37-2', 'REACTIVE'],
  ['Sand powder', '모래 분말', 'SiO2', '14808-60-7', 'SOLID_WASTE'],
  ['Unidentified sample', '미확인 시료', '', '', 'UNKNOWN'],
]
const phrases = ['{x} 어디 있어?', '{x} 위치 알려줘', '{x} 찾아줘', 'Where is {x}?', 'Find {x}', '{x} 남은 양?', '{x} 만료일?', '{x} 재고 위치', 'Show {x}', 'Locate {x}']
export function decisionFixtures() {
  const classification = substances.flatMap(([name, ko, molecularFormula, casNumber, expected], n) => Array.from({ length: 20 }, (_, i) => ({
    id: `classification-${n}-${i}`, feature: 'classification', expected: expected === 'UNKNOWN' ? null : expected,
    input: { name: i % 2 ? ko : name, molecularFormula: i % 5 === 0 ? '' : molecularFormula, casNumber: i % 4 === 0 ? '' : casNumber },
    family: name, provenance: 'explicit-classification-contract', humanReviewed: false,
  })))
  const voiceCandidate = substances.flatMap(([name, ko, , casNumber], n) => Array.from({ length: 20 }, (_, i) => {
    const ambiguous = i >= 10
    const matches = [
      { source: 'inventory', id: 'a', name, casNumber, brand: 'Synthetic A', matchedBy: 'contains' },
      { source: 'inventory', id: 'b', name: ambiguous ? name : 'Unrelated reagent', casNumber: ambiguous ? casNumber : '', brand: 'Synthetic A', matchedBy: 'contains' },
    ]
    return { id: `voice-${n}-${i}`, feature: 'voiceCandidate', expected: ambiguous || n === 9 ? null : 'inventory:a', family: name,
      input: { text: n === 9 ? '없는 시약 찾아줘' : phrases[i % 10].replace('{x}', i % 2 ? ko : name), language: 'ko', matches },
      provenance: 'synthetic-inventory-exact-identity', humanReviewed: false }
  }))
  return [...voiceCandidate, ...classification]
}
