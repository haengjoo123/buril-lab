import { strictFormulaKey, type ClassificationIdentityEvidence } from './_classificationEvidence'

// These are the ten constituents in the auxiliary classification contract.
const metals = [
  ['Ag', 'silver', '은'],
  ['Cd', 'cadmium', '카드뮴'],
  ['Pb', 'lead', '납'],
  ['Hg', 'mercury', '수은'],
  ['Cr', 'chromium', '크롬'],
  ['As', 'arsenic', '비소'],
  ['Ni', 'nickel', '니켈'],
  ['Cu', 'copper', '구리'],
  ['Zn', 'zinc', '아연'],
  ['Ba', 'barium', '바륨'],
]
const listedElements = new Set(metals.map(([symbol]) => symbol))
const listedEnglish = metals.map(([, en]) => en).join('|')
const listedKorean = metals.map(([, , ko]) => ko).join('|')
const saltSymbols = new Map(
  metals.flatMap(
    ([symbol, en, ko]) =>
      [
        [en, symbol],
        [ko, symbol],
      ] as const,
  ),
)
const anionEnglish =
  'acetate|chloride|bromide|iodide|fluoride|sulfate|sulphate|sulfide|sulphide|nitrate|carbonate|hydroxide|oxide|phosphate|cyanide'
const anionKorean =
  '아세트산|초산|염화|브로민화|브롬화|아이오딘화|플루오린화|황산|황화|질산|탄산|수산화|산화|인산|시안화'
const saltEnglish = new RegExp('\\b(' + listedEnglish + ')(?:\\([ivx]+\\))?\\s+(' + anionEnglish + ')\\b', 'iu')
const saltKorean = new RegExp('(?:^|[^가-힣])(' + anionKorean + ')\\s*(' + listedKorean + ')(?=$|[^가-힣])', 'u')
const standaloneMetal = new RegExp(
  '\\b(?:' + listedEnglish + ')\\b|(?:^|[^가-힣])(?:' + listedKorean + ')(?=$|[^가-힣])',
  'iu',
)
const lowerThanMetal = ['ACID', 'ALKALI', 'NEUTRAL', 'ORGANIC_HALOGEN', 'ORGANIC_NON_HALOGEN', 'SOLID_WASTE']

export function classificationConstraints(
  chemical: { name?: string; molecularFormula?: string },
  reference: ClassificationIdentityEvidence | undefined,
  acidBaseCue: boolean,
) {
  const label = (chemical.name ?? '').normalize('NFKC')
  const composition =
    strictFormulaKey(chemical.molecularFormula) ??
    (reference?.status === 'available' ? strictFormulaKey(reference.molecularFormula) : null)
  const elements = new Set(composition?.split('|').map((item) => item.split(':')[0]))
  const en = saltEnglish.exec(label),
    ko = saltKorean.exec(label)
  const namedSymbol = saltSymbols.get(en?.[1]?.toLowerCase() ?? ko?.[2] ?? '')
  const hasListedMetal = Boolean(en || ko || [...elements].some((element) => listedElements.has(element)))
  const ionicSulfide =
    en?.[2]?.toLowerCase() === 'sulfide' || en?.[2]?.toLowerCase() === 'sulphide' || ko?.[1] === '황화'
  const blocked = new Set<string>()
  if (hasListedMetal) for (const category of lowerThanMetal) blocked.add(category)
  if (ionicSulfide) blocked.add('HEAVY_METAL')
  if (!elements.size && !hasListedMetal && !standaloneMetal.test(label)) blocked.add('HEAVY_METAL')
  if (elements.size) {
    if (namedSymbol && !elements.has(namedSymbol)) {
      for (const category of [...lowerThanMetal, 'REACTIVE', 'CYANIDE', 'HEAVY_METAL']) blocked.add(category)
    }
    if (![...elements].some((element) => listedElements.has(element))) blocked.add('HEAVY_METAL')
    const halogen = ['F', 'Cl', 'Br', 'I'].some((element) => elements.has(element))
    if (!elements.has('C') || !halogen) blocked.add('ORGANIC_HALOGEN')
    if (!elements.has('C') || halogen) blocked.add('ORGANIC_NON_HALOGEN')
  }
  const supportedForm = acidBaseCue && !hasListedMetal && elements.has('H') && elements.has('O') && !elements.has('C')
  if (supportedForm) {
    blocked.add('SOLID_WASTE')
    blocked.add('NEUTRAL')
    blocked.add(/hydroxide|수산화/iu.test(label) ? 'ACID' : 'ALKALI')
  }
  return { blocked: [...blocked], hasListedMetal, supportedForm }
}
