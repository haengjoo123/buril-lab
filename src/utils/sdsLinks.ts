import { normalizeCasNumber } from './casNumber'
import { getReagentBrand, normalizeReagentBrand, type ReagentBrandId } from './reagentBrands'

/**
 * SDS links for an inventory item, best match first.
 *
 * Works from the brand / product number / CAS already on the item, so it does
 * not need a linked catalog product:
 *   1. manufacturer_product – the manufacturer's page for this product number
 *   2. manufacturer_search  – the manufacturer's SDS search by CAS
 *   3. public_reference     – KOSHA public MSDS by CAS (substance-level reference)
 *
 * Every URL pattern was checked against the live site on 2026-10-18.
 */

export type SdsLinkTier = 'manufacturer_product' | 'manufacturer_search' | 'public_reference'

export interface SdsLink {
  tier: SdsLinkTier
  source: ReagentBrandId | 'kosha'
  sourceName: string
  /** The product number or CAS number the link searches for. */
  query: string
  url: string
}

export interface SdsLinkInput {
  brand?: string | null
  productNumber?: string | null
  casNumber?: string | null
}

type UrlBuilder = (value: string) => string

interface ManufacturerSdsRule {
  byProductNumber?: UrlBuilder
  byCas?: UrlBuilder
}

const encode = encodeURIComponent

const sigmaSearch = (value: string, type: 'product_number' | 'cas_number') =>
  `https://www.sigmaaldrich.com/KR/ko/search/${encode(value)}?focus=products&page=1&perpage=30&sort=relevance&term=${encode(value)}&type=${type}`

const daejungSearch: UrlBuilder = (value) =>
  `https://www.daejungchem.co.kr/02_product/search/?cNav=7&S_STR1=${encode(value)}`

const MANUFACTURER_SDS_RULES: Partial<Record<ReagentBrandId, ManufacturerSdsRule>> = {
  sigma_aldrich: {
    // Direct /sds/{brand}/{number} URLs need Merck's internal brand key
    // (SIAL, SIGALD...), which users do not record, so search instead.
    byProductNumber: (value) => sigmaSearch(value, 'product_number'),
    byCas: (value) => sigmaSearch(value, 'cas_number'),
  },
  thermo_fisher: {
    byProductNumber: (value) => `https://www.thermofisher.com/search/results?query=${encode(value)}&focusarea=Search%20All`,
  },
  tci: {
    byProductNumber: (value) => `https://www.tcichemicals.com/KR/ko/p/${encode(value)}`,
  },
  daejung: {
    byProductNumber: daejungSearch,
    byCas: daejungSearch,
  },
  duksan: {
    byCas: (value) => `https://duksan.kr/page/03/msds.php?keyword=${encode(value)}`,
  },
  samchun: {
    byCas: (value) => `http://www.samchun.com/kr/sub/product/msds.asp?s_opt1=CASNumber&s_opt2=i&s_keyword=${encode(value)}`,
  },
}

const koshaSearch: UrlBuilder = (value) =>
  `https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do?searchCondition=cas_no&searchKeyword=${encode(value)}`

// "179124-1L", "34860-500ML-R": the trailing pack size is not part of the catalog number.
const PACK_SIZE_SUFFIX = /-\d+(?:\.\d+)?(?:ML|L|G|KG|MG|UG|EA|PK|PAK)(?:-[A-Z])?$/i
// Older Sigma labels print "A-3909" for catalog number A3909.
const LEGACY_SIGMA_NUMBER = /^([A-Z])-(\d{3,})$/i

export function normalizeProductNumber(raw: string | null | undefined, brandId?: ReagentBrandId): string | null {
  let value = (raw || '').normalize('NFKC').replace(/\s+/g, '').trim()
  if (!/[0-9]/.test(value)) return null

  value = value.replace(PACK_SIZE_SUFFIX, '')
  if (brandId === 'sigma_aldrich') value = value.replace(LEGACY_SIGMA_NUMBER, '$1$2')
  return value || null
}

export function resolveSdsLinks(input: SdsLinkInput): SdsLink[] {
  const brand = normalizeReagentBrand(input.brand)
  const productNumber = normalizeProductNumber(input.productNumber, brand?.id)
  const casNumber = normalizeCasNumber(input.casNumber)
  const rule = brand ? MANUFACTURER_SDS_RULES[brand.id] : undefined
  const links: SdsLink[] = []

  if (brand && rule?.byProductNumber && productNumber) {
    links.push({
      tier: 'manufacturer_product',
      source: brand.id,
      sourceName: brand.displayName,
      query: productNumber,
      url: rule.byProductNumber(productNumber),
    })
  }

  if (brand && rule?.byCas && casNumber) {
    links.push({
      tier: 'manufacturer_search',
      source: brand.id,
      sourceName: brand.displayName,
      query: casNumber,
      url: rule.byCas(casNumber),
    })
  }

  if (casNumber) {
    links.push({
      tier: 'public_reference',
      source: 'kosha',
      sourceName: 'KOSHA',
      query: casNumber,
      url: koshaSearch(casNumber),
    })
  }

  return links
}

// Manufacturers whose SDS search accepts a CAS number, in the order labs most
// often stock them.
const CAS_SEARCH_MANUFACTURERS: ReagentBrandId[] = ['sigma_aldrich', 'duksan', 'daejung', 'samchun']

/**
 * SDS search links at every manufacturer that can search by CAS, for a
 * substance whose brand is not known (e.g. a search result).
 */
export function resolveManufacturerCasLinks(rawCasNumber: string | null | undefined): SdsLink[] {
  const casNumber = normalizeCasNumber(rawCasNumber)
  if (!casNumber) return []

  return CAS_SEARCH_MANUFACTURERS.flatMap((id) => {
    const byCas = MANUFACTURER_SDS_RULES[id]?.byCas
    if (!byCas) return []
    return [{
      tier: 'manufacturer_search' as const,
      source: id,
      sourceName: getReagentBrand(id).displayName,
      query: casNumber,
      url: byCas(casNumber),
    }]
  })
}
