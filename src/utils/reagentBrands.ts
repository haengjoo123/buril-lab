/**
 * Canonical reagent manufacturers.
 *
 * Inventory rows store the brand as free text ("Duksan", "DUKSAN REAGENTS",
 * "덕산약품"...). Anything that keys off the manufacturer (SDS links, catalog
 * matching) goes through normalizeReagentBrand so spelling variants agree.
 */

export type ReagentBrandId =
  | 'sigma_aldrich'
  | 'thermo_fisher'
  | 'tci'
  | 'duksan'
  | 'daejung'
  | 'samchun'
  | 'junsei'
  | 'kanto'
  | 'mp_biomedicals'

export interface ReagentBrand {
  id: ReagentBrandId
  displayName: string
}

interface BrandDefinition extends ReagentBrand {
  aliases: string[]
}

const BRAND_DEFINITIONS: BrandDefinition[] = [
  {
    id: 'sigma_aldrich',
    displayName: 'Sigma-Aldrich',
    // Merck life-science brands share sigmaaldrich.com product numbering.
    aliases: [
      'sigma', 'aldrich', 'sigmaaldrich', 'sial', 'sigald', 'fluka', 'supelco',
      'merck', 'millipore', 'milliporesigma', 'calbiochem',
      '시그마', '시그마알드리치', '알드리치', '머크',
    ],
  },
  {
    id: 'thermo_fisher',
    displayName: 'Thermo Fisher Scientific',
    aliases: [
      'thermo', 'thermofisher', 'thermofisherscientific', 'thermoscientific',
      'fisher', 'fisherscientific', 'fisherchemical', 'acros', 'acrosorganics',
      'alfaaesar', 'gibco', 'invitrogen',
      '써모', '써모피셔', '써모피셔사이언티픽',
    ],
  },
  {
    id: 'tci',
    displayName: 'TCI',
    aliases: ['tci', 'tokyochemicalindustry', '도쿄화성'],
  },
  {
    id: 'duksan',
    displayName: '덕산약품',
    // "dksan" is a typo seen in registered inventory.
    aliases: ['duksan', 'dksan', 'dsp', '덕산', '덕산약품', '덕산과학'],
  },
  {
    id: 'daejung',
    displayName: '대정화금',
    aliases: ['daejung', '대정', '대정화금'],
  },
  {
    id: 'samchun',
    displayName: '삼전순약',
    aliases: ['samchun', '삼전', '삼전순약'],
  },
  {
    id: 'junsei',
    displayName: 'Junsei',
    aliases: ['junsei', '준세이'],
  },
  {
    id: 'kanto',
    displayName: 'Kanto Chemical',
    aliases: ['kanto', '칸토'],
  },
  {
    id: 'mp_biomedicals',
    displayName: 'MP Biomedicals',
    aliases: ['mpbiomedicals', 'mpbio'],
  },
]

// Company-form and product-line words that do not identify the manufacturer.
const GENERIC_SUFFIXES = [
  'reagents', 'reagent', 'chemicals', 'chemical', 'purechemicals', 'pure',
  'industries', 'industry', 'korea', 'corporation', 'corp', 'company', 'coltd',
  'co', 'ltd', 'inc', 'gmbh', 'kk', '주식회사', '약품', '화학', '시약',
]
// "(주)덕산약품" and "주식회사 대정화금" put the company form first.
const GENERIC_PREFIXES = ['주식회사', '주']

const ALIAS_INDEX = new Map<string, BrandDefinition>(
  BRAND_DEFINITIONS.flatMap((brand) => brand.aliases.map((alias) => [alias, brand] as const)),
)

function brandKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function stripGenericSuffixes(key: string): string {
  let current = key
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of GENERIC_SUFFIXES) {
      if (current.length > suffix.length && current.endsWith(suffix)) {
        current = current.slice(0, -suffix.length)
        changed = true
      }
    }
  }
  return current
}

/** Resolve a free-text brand to its canonical manufacturer, or null if unknown. */
export function normalizeReagentBrand(raw?: string | null): ReagentBrand | null {
  const key = brandKey(raw || '')
  if (!key) return null

  const prefix = GENERIC_PREFIXES.find((candidate) => key.length > candidate.length && key.startsWith(candidate))
  const unprefixed = prefix ? key.slice(prefix.length) : key
  const candidates = [key, stripGenericSuffixes(key), unprefixed, stripGenericSuffixes(unprefixed)]

  for (const candidate of candidates) {
    const match = ALIAS_INDEX.get(candidate)
    if (match) return { id: match.id, displayName: match.displayName }
  }
  return null
}

/** The canonical manufacturer for a known brand id. */
export function getReagentBrand(id: ReagentBrandId): ReagentBrand {
  const match = BRAND_DEFINITIONS.find((brand) => brand.id === id)
  if (!match) throw new Error(`Unknown reagent brand: ${id}`)
  return { id: match.id, displayName: match.displayName }
}
