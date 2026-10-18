import { describe, expect, it } from 'vitest'
import { normalizeProductNumber, resolveSdsLinks } from './sdsLinks'

const tiers = (links: ReturnType<typeof resolveSdsLinks>) => links.map((link) => link.tier)

describe('normalizeProductNumber', () => {
  it('drops a trailing pack size', () => {
    expect(normalizeProductNumber('179124-1L')).toBe('179124')
    expect(normalizeProductNumber('34860-500ML-R')).toBe('34860')
    expect(normalizeProductNumber('A4544-25G')).toBe('A4544')
  })

  it('keeps hyphens that are part of the catalog number', () => {
    expect(normalizeProductNumber('6532-2340')).toBe('6532-2340')
    expect(normalizeProductNumber('70011-044')).toBe('70011-044')
  })

  it('rewrites legacy Sigma numbers only for Sigma-Aldrich', () => {
    expect(normalizeProductNumber('A-3909', 'sigma_aldrich')).toBe('A3909')
    expect(normalizeProductNumber('A-3909', 'daejung')).toBe('A-3909')
  })

  it('rejects values without any digit', () => {
    expect(normalizeProductNumber('dgdnvjdnfndjf')).toBeNull()
    expect(normalizeProductNumber('  ')).toBeNull()
    expect(normalizeProductNumber(null)).toBeNull()
  })
})

describe('resolveSdsLinks', () => {
  it('orders Sigma-Aldrich links product page, CAS search, then KOSHA', () => {
    const links = resolveSdsLinks({ brand: 'Sigma', productNumber: '179124-1L', casNumber: '67-64-1' })

    expect(tiers(links)).toEqual(['manufacturer_product', 'manufacturer_search', 'public_reference'])
    expect(links[0]).toMatchObject({ source: 'sigma_aldrich', sourceName: 'Sigma-Aldrich', query: '179124' })
    expect(links[0].url).toBe(
      'https://www.sigmaaldrich.com/KR/ko/search/179124?focus=products&page=1&perpage=30&sort=relevance&term=179124&type=product_number',
    )
    expect(links[1].url).toContain('type=cas_number')
    expect(links[2].url).toBe(
      'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do?searchCondition=cas_no&searchKeyword=67-64-1',
    )
  })

  it('uses the CAS search for Duksan, whose site does not search by product number', () => {
    const links = resolveSdsLinks({ brand: 'DUKSAN REAGENTS', productNumber: '562', casNumber: '67-64-1' })

    expect(tiers(links)).toEqual(['manufacturer_search', 'public_reference'])
    expect(links[0]).toMatchObject({ source: 'duksan', sourceName: '덕산약품' })
    expect(links[0].url).toBe('https://duksan.kr/page/03/msds.php?keyword=67-64-1')
  })

  it('links a TCI product page by product number', () => {
    const [link] = resolveSdsLinks({ brand: 'TCI', productNumber: 'U0018' })
    expect(link.url).toBe('https://www.tcichemicals.com/KR/ko/p/U0018')
  })

  it('falls back to KOSHA when the brand is unknown', () => {
    const links = resolveSdsLinks({ brand: 'cmos', productNumber: '123', casNumber: '67-64-1' })
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ tier: 'public_reference', source: 'kosha' })
  })

  it('ignores an invalid CAS number', () => {
    const links = resolveSdsLinks({ brand: 'Duksan', casNumber: '67-64-2' })
    expect(links).toEqual([])
  })

  it('returns no links without brand, product number, or CAS', () => {
    expect(resolveSdsLinks({})).toEqual([])
  })

  it('encodes query values', () => {
    const [link] = resolveSdsLinks({ brand: 'Thermo', productNumber: 'A11S 4' })
    expect(link.url).toContain('query=A11S4')
  })
})
