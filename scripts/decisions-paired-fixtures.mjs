import { opaqueUuid } from './decisions-expanded-fixtures.mjs'
import { pairedMaterials } from './decisions-paired-materials.mjs'

const voiceScenarios = [
  'english-name', 'korean-with-neighbors', 'registry-number', 'product-code', 'brand',
  'cabinet', 'room', 'shelf', 'room-and-product', 'stock-count',
  'long-korean', 'long-english', 'long-room', 'long-product', 'long-registry',
  'indistinguishable-bottles', 'unstated-room', 'absent-from-long-list', 'two-reagents', 'conflicting-identifiers',
]
const classScenarios = [
  'english-full', 'korean-full', 'bilingual-full', 'label-with-registry', 'name-and-formula',
  'korean-name', 'english-name', 'annotated-formula', 'annotated-cas', 'name-and-cas',
  'label-grade', 'identity-card', 'korean-label', 'bilingual-name', 'stock-label',
  'name-conflict', 'registry-conflict', 'unresolved-mixture', 'missing-label', 'formula-conflict',
]

function classification(material, n, scenario) {
  const { name, ko, molecularFormula, casNumber, category } = material
  const others = pairedMaterials.filter(item => item.casNumber !== casNumber)
  // Include isomers when possible: matching formulas alone must not decide identity.
  const neighbor = others.find(item => item.molecularFormula === molecularFormula)
    ?? others[(n * 7 + 3) % others.length]
  const differentFormula = others.find(item => item.molecularFormula !== molecularFormula)
  const code = 'L' + (3000 + n * 23 + scenario)
  const variants = [
    [name, molecularFormula, casNumber], [ko, molecularFormula, casNumber],
    [ko + ' / ' + name, molecularFormula, casNumber], [name + ' [CAS ' + casNumber + ']', '', casNumber],
    [name, molecularFormula, ''], [ko, '', ''], [name, '', ''],
    [ko + ' (' + molecularFormula + ')', '', ''], [name + ' / CAS ' + casNumber, '', ''],
    [ko, '', casNumber], [name + ', laboratory grade', molecularFormula, casNumber],
    [code + ' | ' + name, '', ''], ['시약명 ' + ko, '', ''],
    [ko + ' (' + name + ')', '', ''], ['시약 ' + code + ' / ' + ko, molecularFormula, ''],
    [name, neighbor.molecularFormula, neighbor.casNumber], [ko, molecularFormula, neighbor.casNumber],
    ['Unidentified mixture; label mentions ' + name + ' but other components are unknown', '', ''],
    ['라벨이 없는 시료 ' + code, '', ''], [name, differentFormula.molecularFormula, casNumber],
  ]
  const [label, formula, cas] = variants[scenario]
  return { scenario: classScenarios[scenario], input: { name: label, molecularFormula: formula, casNumber: cas },
    expected: scenario < 15 ? category : null }
}

const rooms = ['준비실', '분석실', '기기실', '측정실']
const brands = ['Meridian', 'Atlas', 'Pine', 'Aster']
function stock(material, serial) {
  return {
    source: 'inventory', name: material.name, casNumber: material.casNumber, matchedBy: 'contains',
    brand: brands[serial % brands.length], productNumber: 'L-' + (11000 + serial * 17),
    storageType: 'cabinet', cabinetName: 'C-' + (1 + serial % 7),
    storageLocationName: rooms[serial % rooms.length], shelfLevel: serial % 5,
  }
}

// The signed server builds just the requested fixture. IDs derive from shuffled
// positions, independently of the answer and of the chemical's role in a case.
function voice(material, n, scenario) {
  const { name, ko, casNumber } = material
  const serial = n * 23 + scenario
  const target = stock(material, serial)
  const others = pairedMaterials.filter(item => item !== material)
  const other = others.find(item => item.molecularFormula === material.molecularFormula)
    ?? others[(n * 13 + 5) % others.length]
  const near = stock(other, serial + 1)
  let candidates = [target, near]
  let text = 'Find ' + name
  let language = 'en'
  const alternateBottle = { ...target }
  const selector = (field, alternate, query) => {
    alternateBottle[field] = alternate
    candidates = [alternateBottle, near, target]
    text = query
    language = 'ko'
  }
  const longList = (size, withTarget = true) => {
    // Cycle through unrelated materials, with one confusing neighbor up front.
    const noise = Array.from({ length: size - (withTarget ? 1 : 0) }, (_, j) =>
      j === 0 ? near : stock(others[(n * 11 + j * 17) % others.length], serial + j + 2))
    return withTarget ? [...noise, target] : noise
  }
  if (scenario === 1) { text = ko + ' 좀 찾아줘'; language = 'ko' }
  if (scenario === 2) { text = 'Locate CAS ' + casNumber }
  if (scenario === 3) selector('productNumber', 'M-103', ko + ' 중 제품 ' + target.productNumber + ' 있어?')
  if (scenario === 4) selector('brand', brands[(serial + 1) % 4], target.brand + ' 브랜드 ' + ko + ' 찾아줘')
  if (scenario === 5) selector('cabinetName', 'C-9', target.cabinetName + ' 시약장에 있는 ' + ko)
  if (scenario === 6) selector('storageLocationName', rooms[(serial + 1) % 4], target.storageLocationName + '의 ' + ko + ' 찾아줘')
  if (scenario === 7) selector('shelfLevel', (serial + 1) % 5, target.cabinetName + ' 시약장 ' + (target.shelfLevel + 1) + '번째 선반에 있는 ' + ko)
  if (scenario === 8) selector('productNumber', 'M-205', target.storageLocationName + '의 ' + ko + ', 제품번호 ' + target.productNumber)
  if (scenario === 9) text = 'How much ' + name + ' is on hand?'
  if ([10, 11, 12, 13, 14].includes(scenario)) {
    const size = [30, 60, 120][(n + scenario) % 3]
    candidates = longList(size)
    if (scenario === 10) { text = ko + ' 남은 양'; language = 'ko' }
    if (scenario === 11) text = 'Locate ' + name + ' in inventory'
    if (scenario === 12 || scenario === 13) {
      const field = scenario === 12 ? 'storageLocationName' : 'productNumber'
      candidates[1] = { ...target, [field]: scenario === 12 ? rooms[(serial + 1) % 4] : 'Q-106' }
      text = scenario === 12 ? target.storageLocationName + '에 있는 ' + ko : ko + ' 제품번호 ' + target.productNumber
      language = 'ko'
    }
    if (scenario === 14) text = 'Inventory entry for CAS ' + casNumber
  }
  if (scenario === 15) candidates = [target, { ...target }, near]
  if (scenario === 16) candidates = [target, { ...target, storageLocationName: rooms[(serial + 1) % 4] }, near]
  if (scenario === 17) candidates = longList([30, 60, 120][n % 3], false)
  if (scenario === 18) text = 'Find both ' + name + ' and ' + other.name
  if (scenario === 19) text = 'Find ' + name + ' with CAS ' + other.casNumber

  // Fisher-Yates with a per-case seed; all occurrences remain separate bottles.
  let seed = Math.imul(serial + 301, 2654435761) >>> 0
  for (let i = candidates.length - 1; i > 0; i--) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    const j = (seed >>> 0) % (i + 1)
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  const matches = candidates.map((candidate, i) => ({ ...candidate, id: opaqueUuid('paired-v1/' + n + '/' + scenario + '/' + i) }))
  const expected = scenario < 15 ? 'inventory:' + matches[candidates.indexOf(target)].id : null
  return { scenario: voiceScenarios[scenario], expected, input: { text, language, matches } }
}

export function pairedFixtureById(id) {
  const match = /^paired-1-(voice|class)-(\d+)-(\d+)$/.exec(id)
  if (!match) return null
  const n = Number(match[2]), scenario = Number(match[3]), material = pairedMaterials[n]
  if (!material || scenario >= 20 || id !== 'paired-1-' + match[1] + '-' + n + '-' + scenario) return null
  const isVoice = match[1] === 'voice'
  return { id, feature: isVoice ? 'voiceCandidate' : 'classification', family: material.casNumber,
    split: 'validation', provenance: 'prospective-synthetic-contract-v1', humanReviewed: false,
    ...(isVoice ? voice(material, n, scenario) : classification(material, n, scenario)) }
}

export function pairedDecisionFixtures() {
  return ['voice', 'class'].flatMap(prefix => pairedMaterials.flatMap((_, n) =>
    Array.from({ length: 20 }, (_, i) => pairedFixtureById('paired-1-' + prefix + '-' + n + '-' + i))))
}
