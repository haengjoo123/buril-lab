import reference from './fixtures/decisions-review-identities.json' with { type: 'json' }
import { opaqueUuid } from './decisions-expanded-fixtures.mjs'

const materials = reference.materials
const addresses = ['시료실', '공용 준비실', '기기분석실', '세척실', '정량분석실']
const brands = ['Solena', 'Arden', 'Delta', 'Nuri', 'Minerva']
const ordinals = ['첫', '두', '세', '네', '다섯']
let registry
function registeredCases() {
  if (registry) return registry
  registry = new Map()
  for (let material = 0; material < materials.length; material++) {
    for (let variant = 0; variant < 20; variant++) {
      for (const feature of ['voiceCandidate', 'classification']) {
        const id = 'blind-v1-' + opaqueUuid([feature, material, variant].join('/'))
        registry.set(id, { feature, material, variant })
      }
    }
  }
  return registry
}

function bottles(id, material, index, variant, neighbor) {
  const seed = index * 31 + variant * 17
  const stock = (substance, serial) => ({
    source: serial % 3 ? 'inventory' : 'cabinet_item',
    id: opaqueUuid(id + '/stock/' + serial),
    name: substance.name,
    casNumber: substance.casNumber,
    storageType: 'cabinet',
    cabinetName: 'R-' + ((serial % 13) + 1),
    shelfLevel: serial % 5,
    brand: brands[serial % brands.length],
    productNumber: 'GX-' + (22031 + serial * 19),
    storageLocationName: addresses[serial % addresses.length],
    matchedBy: 'contains',
  })
  const target = stock(material, seed),
    similar = stock(neighbor, seed + 1)
  const second = { ...target, id: opaqueUuid(id + '/second') }
  const other = materials.filter((m) => m !== material && m !== neighbor)
  const size = [10, 11, 12, 14, 17].includes(variant) ? [30, 60, 120][(index + variant) % 3] : 4
  let matches = [
    target,
    similar,
    ...Array.from({ length: size - 2 }, (_, i) => stock(other[(i * 11 + seed) % other.length], seed + i + 10)),
  ]
  let text,
    language = 'ko'
  switch (variant) {
    case 0:
      text = '재고에 ' + material.ko + ' 남아 있는지 확인 부탁해'
      break
    case 1:
      text = 'Which bottle is labelled ' + material.name + '?'
      language = 'en'
      break
    case 2:
      text = '등록번호가 ' + material.casNumber + '인 시약 재고'
      break
    case 3:
      second.productNumber += '-X'
      matches[2] = second
      text = material.ko + ' 재주문하려는데 품번 ' + target.productNumber + '인 병 찾아줘'
      break
    case 4:
      second.brand = 'Alba'
      matches[2] = second
      text = target.brand + '에서 나온 ' + material.name + ' 어디 뒀지?'
      break
    case 5:
      second.storageLocationName = '별관 실습실'
      matches[2] = second
      text = target.storageLocationName + '에 둔 ' + material.ko + '의 위치'
      break
    case 6:
      second.cabinetName = 'R-19'
      matches[2] = second
      text = target.cabinetName + ' 안의 ' + material.ko + ' 재고만 보여줘'
      break
    case 7:
      second.shelfLevel = (target.shelfLevel + 1) % 5
      matches[2] = second
      text = target.cabinetName + '에서 ' + ordinals[target.shelfLevel] + ' 번째 선반에 둔 ' + material.ko
      break
    case 8:
      second.shelfLevel = (target.shelfLevel + 2) % 5
      matches[2] = second
      text = 'Stock check for ' + material.name + ', shelf #' + (target.shelfLevel + 1)
      language = 'en'
      break
    case 9:
      text = material.ko + ' (' + material.name + ') 재고 수량 알려줘'
      break
    case 10:
      text = '혹시 CAS ' + material.casNumber + ' 재고 위치를 알 수 있을까'
      break
    case 11:
      second.productNumber += '-B'
      matches[4] = second
      text = 'Find ' + material.name + ' with product code ' + target.productNumber
      language = 'en'
      break
    case 12:
      second.storageLocationName = '분리보관실'
      matches[2] = second
      text = target.storageLocationName + '의 ' + material.ko + ' 제품 ' + target.productNumber
      break
    case 13:
      matches[2] = second
      text = '어느 병이 ' + material.ko + '이지?'
      break
    case 14:
      matches = matches.filter((m) => m !== target)
      text = 'Is there any ' + material.name + ' on the list?'
      language = 'en'
      break
    case 15:
      text = '라벨이 ' + material.name + '이고 CAS는 ' + neighbor.casNumber + '인 재고'
      break
    case 16:
      second.shelfLevel = (target.shelfLevel + 1) % 5
      matches[2] = second
      text = '선반 ' + (target.shelfLevel + 1) + '번 말고 다른 선반의 ' + material.ko
      break
    case 17:
      text = material.name + ' and ' + neighbor.name + ' — where are both bottles?'
      language = 'en'
      break
    case 18:
      second.shelfLevel = undefined
      matches[2] = second
      text = target.shelfLevel + 1 + '번 선반에 있는 ' + material.name
      break
    case 19:
      text = '라벨을 읽기 어려운데 ' + material.ko + '인지 ' + neighbor.ko + '인지 확인해 줘'
      break
  }
  let state = seed + 893341
  for (let end = matches.length - 1; end > 0; end--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const j = state % (end + 1)
    ;[matches[end], matches[j]] = [matches[j], matches[end]]
  }
  return { text, language, matches }
}

function chemical(m, other, i) {
  const { name, ko, casNumber, molecularFormula } = m
  const conflictingFormula =
    molecularFormula === other.molecularFormula
      ? materials.find((candidate) => candidate.molecularFormula !== molecularFormula).molecularFormula
      : other.molecularFormula
  const variants = [
    [name, molecularFormula, casNumber],
    [ko, '', casNumber],
    [ko + ' (' + name + ')', molecularFormula, ''],
    [name + ' / catalog label', '', ''],
    ['라벨 기재명 ' + ko, '', ''],
    [name + ' / CAS ' + casNumber, '', ''],
    [ko + ' 시약급', molecularFormula, ''],
    [name + ' (reagent grade)', molecularFormula, casNumber],
    [name + ' | ' + ko, '', casNumber],
    ['재고 라벨 ' + ko, molecularFormula, ''],
    ['Lot REV-' + (i + m.cid) + ' ' + name, '', ''],
    [ko, molecularFormula, casNumber],
    [name, '', casNumber],
    [name + ' [' + molecularFormula + ']', '', ''],
    [ko + ' / ' + name, '', ''],
    [name, other.molecularFormula, other.casNumber],
    [ko + ' (' + name + ')', molecularFormula, other.casNumber],
    ['남은 혼합액. 라벨에 ' + ko + '만 남아 있고 다른 성분은 모름.', '', ''],
    ['Unknown sample REV-' + m.cid + ', prior label missing', '', ''],
    [name, conflictingFormula, casNumber],
  ]
  const [label, formula, cas] = variants[i]
  return { name: label, molecularFormula: formula, casNumber: cas }
}

/** These fixtures carry no expected choice. Only a sealed, separate human review supplies one. */
export function reviewFixtureById(id) {
  if (!id.startsWith('blind-v1-')) return null
  const key = registeredCases().get(id)
  if (!key) return null
  const { feature, material: n, variant } = key,
    m = materials[n]
  const near =
    materials.find((x) => x !== m && x.molecularFormula === m.molecularFormula) ??
    materials.find(
      (x) => x !== m && x.name.split(' ').slice(0, 2).join(' ') === m.name.split(' ').slice(0, 2).join(' '),
    ) ??
    materials[(n + 7) % materials.length]
  return {
    id,
    feature,
    family: m.casNumber,
    split: 'validation',
    input: feature === 'classification' ? chemical(m, near, variant) : bottles(id, m, n, variant, near),
  }
}
export const blindReviewFixtures = () => Array.from(registeredCases().keys(), reviewFixtureById)
