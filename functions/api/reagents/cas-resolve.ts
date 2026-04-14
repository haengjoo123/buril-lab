import { XMLParser } from 'fast-xml-parser'
import { json } from '../gemini/_utils'

interface Env {
  KOSHA_API_KEY?: string
}

type CasResolveStatus = 'match' | 'no_match' | 'ambiguous' | 'conflict' | 'skipped'
type CasSuggestionConfidence = 'high' | 'medium' | 'low'
type CasEvidenceCode =
  | 'kosha_exact_name_match'
  | 'kosha_alias_exact_match'
  | 'pubchem_canonical_exact_match'
  | 'pubchem_iupac_exact_match'
  | 'pubchem_synonym_exact_match'
  | 'wikidata_title_exact_match'
  | 'cas_consensus'
type CasSuggestionSource = 'KOSHA' | 'PubChem' | 'Wikidata'
type CasReasonCode =
  | 'missing_name'
  | 'unsupported_name_pattern'
  | 'no_exact_match'
  | 'multiple_candidates'
  | 'source_conflict'
  | 'low_confidence'

interface CasResolveItemInput {
  id: string
  inputName: string
  sourceType: string
  brand?: string
  productNumber?: string
  capacity?: string
}

interface CasResolveItemResult {
  id: string
  status: CasResolveStatus
  casNumber?: string
  canonicalName?: string
  localizedName?: string
  matchedInput: string
  matchedAlias?: string
  alternatives?: CandidateOption[]
  evidence: CasEvidenceCode[]
  sources: CasSuggestionSource[]
  confidence: CasSuggestionConfidence
  reason?: CasReasonCode
}

interface CandidateOption {
  casNumber: string
  canonicalName?: string
  localizedName?: string
  matchedAlias?: string
  confidence: CasSuggestionConfidence
}

interface KOSHASearchItem {
  chemId?: string | number
  chemNameKor?: string
  casNo?: string
}

interface Candidate {
  casNumber: string
  canonicalName?: string
  localizedName?: string
  matchedAlias?: string
  evidence: CasEvidenceCode[]
  sources: CasSuggestionSource[]
  confidence: CasSuggestionConfidence
}

type SourceLookup =
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: Candidate[] }
  | { kind: 'match'; candidate: Candidate }

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const KOSHA_BASE_URL = 'https://msds.kosha.or.kr/openapi/service/msdschem'
const PUBCHEM_BASE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php'
const WIKIPEDIA_ENDPOINTS = [
  { locale: 'ko', url: 'https://ko.wikipedia.org/w/api.php' },
  { locale: 'en', url: 'https://en.wikipedia.org/w/api.php' },
] as const
const CAS_PATTERN = /^\d{2,7}-\d{2}-\d$/
const MAX_ITEMS = 25
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

const suggestionCache = new Map<string, { expiresAt: number; value: Omit<CasResolveItemResult, 'id'> }>()

function normalizeName(value?: string | null): string {
  return (value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasHangul(value: string): boolean {
  return /[가-힣]/.test(value)
}

function shouldSkipName(rawName: string): boolean {
  const normalized = normalizeName(rawName)
  if (!normalized) return true

  const compact = normalized.replace(/\s+/g, '')
  if (compact.length <= 2) return true

  if (/[+,/]/.test(rawName)) return true

  const skipPatterns = [
    /\bbuffer\b/i,
    /\bmedia\b/i,
    /\bsolution\b/i,
    /\bmixture\b/i,
    /\bmix\b/i,
    /\bserum\b/i,
    /\bagar\b/i,
    /\bbroth\b/i,
    /\bpbs\b/i,
    /\bdmem\b/i,
    /\brpmi\b/i,
    /\btbe\b/i,
    /\btae\b/i,
    /\btris[- ]?hcl\b/i,
    /\b(?:lb|m9)\b/i,
    /\b\d+(?:\.\d+)?\s*(?:m|n|x|%)\b/i,
    /\b\d+(?:\.\d+)?\s*(?:mg\/ml|g\/l|mol\/l)\b/i,
  ]

  return skipPatterns.some((pattern) => pattern.test(rawName))
}

function normalizeCasNumber(value?: string | null): string | null {
  const normalized = (value || '').replace(/\s+/g, '').trim()
  if (!CAS_PATTERN.test(normalized)) return null
  if (!passesCasChecksum(normalized)) return null
  return normalized
}

function passesCasChecksum(casNumber: string): boolean {
  const [left, middle, right] = casNumber.split('-')
  if (!left || !middle || !right) return false

  const digits = `${left}${middle}`.split('').reverse()
  const checksum = Number.parseInt(right, 10)
  if (!Number.isFinite(checksum)) return false

  const total = digits.reduce((sum, digit, index) => sum + Number.parseInt(digit, 10) * (index + 1), 0)
  return total % 10 === checksum
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function mergeCandidate(base: Candidate, additions: Partial<Candidate>): Candidate {
  return {
    casNumber: additions.casNumber || base.casNumber,
    canonicalName: additions.canonicalName || base.canonicalName,
    localizedName: additions.localizedName || base.localizedName,
    matchedAlias: additions.matchedAlias || base.matchedAlias,
    evidence: unique([...(base.evidence || []), ...(additions.evidence || [])]),
    sources: unique([...(base.sources || []), ...(additions.sources || [])]),
    confidence: additions.confidence || base.confidence,
  }
}

function toCandidateOptions(candidates: Candidate[]): CandidateOption[] {
  const seen = new Set<string>()
  const options: CandidateOption[] = []

  for (const candidate of candidates) {
    const key = `${candidate.casNumber}|${candidate.canonicalName || ''}|${candidate.localizedName || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    options.push({
      casNumber: candidate.casNumber,
      canonicalName: candidate.canonicalName,
      localizedName: candidate.localizedName,
      matchedAlias: candidate.matchedAlias,
      confidence: candidate.confidence,
    })
    if (options.length >= 3) break
  }

  return options
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) return null
  return await response.json() as T
}

async function fetchText(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
    },
  })

  if (!response.ok) return null
  return await response.text()
}

function toItemArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function getKoshaMatchEvidence(chemicalName: string, query: string): CasEvidenceCode | null {
  const normalizedQuery = normalizeName(query)
  const normalizedName = normalizeName(chemicalName)
  if (normalizedName === normalizedQuery) {
    return 'kosha_exact_name_match'
  }

  const beforeParen = normalizeName(chemicalName.split('(')[0] || '')
  if (beforeParen && beforeParen === normalizedQuery) {
    return 'kosha_exact_name_match'
  }

  const aliases = Array.from(chemicalName.matchAll(/\((.*?)\)/g))
    .flatMap((match) => (match[1] || '').split(','))
    .map((item) => normalizeName(item))
    .filter(Boolean)

  return aliases.includes(normalizedQuery) ? 'kosha_alias_exact_match' : null
}

async function searchKoshaExact(query: string, apiKey?: string): Promise<SourceLookup> {
  if (!apiKey?.trim() || !hasHangul(query)) {
    return { kind: 'none' }
  }

  const params = new URLSearchParams({
    serviceKey: apiKey,
    searchWrd: query.trim(),
    searchCnd: '0',
    pageNo: '1',
    numOfRows: '20',
  })

  const xmlText = await fetchText(`${KOSHA_BASE_URL}/chemlist?${params.toString()}`)
  if (!xmlText) return { kind: 'none' }

  const parsed = parser.parse(xmlText) as {
    response?: { body?: { items?: { item?: KOSHASearchItem | KOSHASearchItem[] } } }
  }
  const items = toItemArray(parsed.response?.body?.items?.item)

  const exactMatches = items
    .map((item) => {
      const chemNameKor = String(item.chemNameKor || '').trim()
      const casNumber = normalizeCasNumber(item.casNo ? String(item.casNo) : '')
      const evidence = chemNameKor ? getKoshaMatchEvidence(chemNameKor, query) : null
      if (!chemNameKor || !casNumber || !evidence) return null

      return {
        chemNameKor,
        casNumber,
        evidence,
      }
    })
    .filter((item): item is { chemNameKor: string; casNumber: string; evidence: CasEvidenceCode } => Boolean(item))

  const uniqueCasNumbers = unique(exactMatches.map((item) => item.casNumber))
  if (uniqueCasNumbers.length === 0) return { kind: 'none' }
  if (uniqueCasNumbers.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: toCandidateOptions(exactMatches.map((item) => ({
        casNumber: item.casNumber,
        localizedName: item.chemNameKor,
        evidence: [item.evidence],
        sources: ['KOSHA'],
        confidence: 'medium',
      }))).map((option) => ({
        casNumber: option.casNumber,
        canonicalName: option.canonicalName,
        localizedName: option.localizedName,
        matchedAlias: option.matchedAlias,
        evidence: [],
        sources: ['KOSHA'],
        confidence: option.confidence,
      })),
    }
  }

  const winner = exactMatches[0]
  return {
    kind: 'match',
    candidate: {
      casNumber: winner.casNumber,
      localizedName: winner.chemNameKor,
      evidence: [winner.evidence],
      sources: ['KOSHA'],
      confidence: 'high',
    },
  }
}

async function fetchPubChemRecordByLookup(lookup: string): Promise<{
  cid: number
  title?: string
  iupacName?: string
  synonyms: string[]
  casNumbers: string[]
} | null> {
  const propertyUrl = `${PUBCHEM_BASE_URL}/compound/name/${encodeURIComponent(lookup)}/property/Title,IUPACName/JSON`
  const propertyResponse = await fetchJson<{
    PropertyTable?: {
      Properties?: Array<{
        CID?: number
        Title?: string
        IUPACName?: string
      }>
    }
  }>(propertyUrl)

  const property = propertyResponse?.PropertyTable?.Properties?.[0]
  const cid = property?.CID
  if (!cid) return null

  const synonymsResponse = await fetchJson<{
    InformationList?: {
      Information?: Array<{
        Synonym?: string[]
      }>
    }
  }>(`${PUBCHEM_BASE_URL}/compound/cid/${cid}/synonyms/JSON`)

  const synonyms = synonymsResponse?.InformationList?.Information?.[0]?.Synonym || []
  const casNumbers = unique(
    synonyms
      .map((item) => normalizeCasNumber(item))
      .filter((item): item is string => Boolean(item)),
  )

  return {
    cid,
    title: property?.Title?.trim(),
    iupacName: property?.IUPACName?.trim(),
    synonyms,
    casNumbers,
  }
}

async function searchPubChemExact(query: string): Promise<SourceLookup> {
  const record = await fetchPubChemRecordByLookup(query)
  if (!record) return { kind: 'none' }

  if (record.casNumbers.length === 0) {
    return { kind: 'none' }
  }
  if (record.casNumbers.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: record.casNumbers.slice(0, 3).map((casNumber) => ({
        casNumber,
        canonicalName: record.title || record.iupacName || query.trim(),
        evidence: [],
        sources: ['PubChem'],
        confidence: 'medium',
      })),
    }
  }

  const normalizedQuery = normalizeName(query)
  const matchedCanonical = record.title && normalizeName(record.title) === normalizedQuery
  const matchedIupac = record.iupacName && normalizeName(record.iupacName) === normalizedQuery
  const matchedSynonym = record.synonyms.find((synonym) => normalizeName(synonym) === normalizedQuery)

  let evidence: CasEvidenceCode | null = null
  if (matchedCanonical) evidence = 'pubchem_canonical_exact_match'
  else if (matchedIupac) evidence = 'pubchem_iupac_exact_match'
  else if (matchedSynonym) evidence = 'pubchem_synonym_exact_match'

  if (!evidence) {
    return { kind: 'none' }
  }

  return {
    kind: 'match',
    candidate: {
      casNumber: record.casNumbers[0],
      canonicalName: record.title || record.iupacName || query.trim(),
      matchedAlias: evidence === 'pubchem_synonym_exact_match' ? matchedSynonym : undefined,
      evidence: [evidence],
      sources: ['PubChem'],
      confidence: 'medium',
    },
  }
}

async function enrichCandidateFromPubChemCas(candidate: Candidate): Promise<Candidate> {
  const pubchemRecord = await fetchPubChemRecordByLookup(candidate.casNumber)
  if (!pubchemRecord) return candidate

  if (!pubchemRecord.casNumbers.includes(candidate.casNumber)) {
    return candidate
  }

  return mergeCandidate(candidate, {
    canonicalName: pubchemRecord.title || pubchemRecord.iupacName || candidate.canonicalName,
    evidence: ['cas_consensus'],
    sources: ['PubChem'],
    confidence: 'high',
  })
}

async function enrichCandidateWithKoshaName(candidate: Candidate, apiKey?: string): Promise<Candidate> {
  if (!apiKey?.trim()) return candidate

  const params = new URLSearchParams({
    serviceKey: apiKey,
    searchWrd: candidate.casNumber,
    searchCnd: '1',
    pageNo: '1',
    numOfRows: '3',
  })

  const xmlText = await fetchText(`${KOSHA_BASE_URL}/chemlist?${params.toString()}`)
  if (!xmlText) return candidate

  const parsed = parser.parse(xmlText) as {
    response?: { body?: { items?: { item?: KOSHASearchItem | KOSHASearchItem[] } } }
  }
  const items = toItemArray(parsed.response?.body?.items?.item)
  const matched = items.find((item) => normalizeCasNumber(String(item.casNo || '')) === candidate.casNumber)
  const localizedName = String(matched?.chemNameKor || '').trim()

  if (!localizedName) {
    return candidate
  }

  return mergeCandidate(candidate, {
    localizedName,
    evidence: ['cas_consensus'],
    sources: ['KOSHA'],
    confidence: 'high',
  })
}

async function searchWikidataExact(query: string): Promise<SourceLookup> {
  const endpoints = hasHangul(query)
    ? [WIKIPEDIA_ENDPOINTS[0], WIKIPEDIA_ENDPOINTS[1]]
    : [WIKIPEDIA_ENDPOINTS[1], WIKIPEDIA_ENDPOINTS[0]]

  const normalizedQuery = normalizeName(query)

  for (const endpoint of endpoints) {
    const queryParams = new URLSearchParams({
      action: 'query',
      prop: 'pageprops',
      titles: query.trim(),
      redirects: '1',
      format: 'json',
      origin: '*',
    })

    const pageResponse = await fetchJson<{
      query?: {
        pages?: Record<string, {
          title?: string
          pageprops?: { wikibase_item?: string }
        }>
      }
    }>(`${endpoint.url}?${queryParams.toString()}`)

    const pages = pageResponse?.query?.pages || {}
    const page = Object.values(pages)[0]
    const pageTitle = page?.title?.trim()
    const entityId = page?.pageprops?.wikibase_item?.trim()

    if (!pageTitle || !entityId || normalizeName(pageTitle) !== normalizedQuery) {
      continue
    }

    const entityParams = new URLSearchParams({
      action: 'wbgetentities',
      ids: entityId,
      props: 'claims|labels',
      languages: 'ko|en',
      format: 'json',
      origin: '*',
    })

    const entityResponse = await fetchJson<{
      entities?: Record<string, {
        claims?: {
          P231?: Array<{
            mainsnak?: {
              datavalue?: { value?: string }
            }
          }>
        }
        labels?: Record<string, { value?: string }>
      }>
    }>(`${WIKIDATA_API_URL}?${entityParams.toString()}`)

    const entity = entityResponse?.entities?.[entityId]
    const casNumbers = unique(
      toItemArray(entity?.claims?.P231)
        .map((claim) => normalizeCasNumber(claim?.mainsnak?.datavalue?.value || ''))
        .filter((value): value is string => Boolean(value)),
    )

    if (casNumbers.length !== 1) {
      continue
    }

    return {
      kind: 'match',
      candidate: {
        casNumber: casNumbers[0],
        canonicalName: entity?.labels?.en?.value || entity?.labels?.ko?.value || pageTitle,
        localizedName: entity?.labels?.ko?.value || undefined,
        evidence: ['wikidata_title_exact_match'],
        sources: ['Wikidata'],
        confidence: 'low',
      },
    }
  }

  return { kind: 'none' }
}

function cacheKeyFor(inputName: string): string {
  return normalizeName(inputName)
}

async function resolveSuggestion(input: CasResolveItemInput, env: Env): Promise<Omit<CasResolveItemResult, 'id'>> {
  const matchedInput = input.inputName.trim()
  if (!matchedInput) {
    return {
      status: 'skipped',
      matchedInput,
      evidence: [],
      sources: [],
      confidence: 'low',
      reason: 'missing_name',
    }
  }

  if (shouldSkipName(matchedInput)) {
    return {
      status: 'skipped',
      matchedInput,
      evidence: [],
      sources: [],
      confidence: 'low',
      reason: 'unsupported_name_pattern',
    }
  }

  const [koshaLookup, pubchemLookup] = await Promise.all([
    searchKoshaExact(matchedInput, env.KOSHA_API_KEY),
    searchPubChemExact(matchedInput),
  ])

  if (koshaLookup.kind === 'ambiguous' || pubchemLookup.kind === 'ambiguous') {
    const alternatives = toCandidateOptions([
      ...(koshaLookup.kind === 'ambiguous' ? koshaLookup.candidates : []),
      ...(pubchemLookup.kind === 'ambiguous' ? pubchemLookup.candidates : []),
    ])

    return {
      status: 'ambiguous',
      matchedInput,
      alternatives,
      evidence: [],
      sources: [],
      confidence: 'low',
      reason: 'multiple_candidates',
    }
  }

  if (koshaLookup.kind === 'match' && pubchemLookup.kind === 'match' && koshaLookup.candidate.casNumber !== pubchemLookup.candidate.casNumber) {
    return {
      status: 'conflict',
      matchedInput,
      evidence: [],
      sources: unique([...koshaLookup.candidate.sources, ...pubchemLookup.candidate.sources]),
      confidence: 'low',
      reason: 'source_conflict',
    }
  }

  if (koshaLookup.kind === 'match') {
    const enriched = await enrichCandidateFromPubChemCas(koshaLookup.candidate)
    return {
      status: 'match',
      matchedInput,
      casNumber: enriched.casNumber,
      canonicalName: enriched.canonicalName,
      localizedName: enriched.localizedName,
      matchedAlias: enriched.matchedAlias,
      evidence: enriched.evidence,
      sources: enriched.sources,
      confidence: enriched.confidence,
    }
  }

  if (pubchemLookup.kind === 'match') {
    const enriched = await enrichCandidateWithKoshaName(pubchemLookup.candidate, env.KOSHA_API_KEY)
    return {
      status: 'match',
      matchedInput,
      casNumber: enriched.casNumber,
      canonicalName: enriched.canonicalName,
      localizedName: enriched.localizedName,
      matchedAlias: enriched.matchedAlias,
      evidence: enriched.evidence,
      sources: enriched.sources,
      confidence: enriched.confidence,
      reason: enriched.confidence === 'low' ? 'low_confidence' : undefined,
    }
  }

  const wikidataLookup = await searchWikidataExact(matchedInput)
  if (wikidataLookup.kind === 'match') {
    let enriched = await enrichCandidateFromPubChemCas(wikidataLookup.candidate)
    enriched = await enrichCandidateWithKoshaName(enriched, env.KOSHA_API_KEY)

    return {
      status: 'match',
      matchedInput,
      casNumber: enriched.casNumber,
      canonicalName: enriched.canonicalName,
      localizedName: enriched.localizedName,
      matchedAlias: enriched.matchedAlias,
      evidence: enriched.evidence,
      sources: enriched.sources,
      confidence: enriched.confidence,
      reason: enriched.confidence === 'low' ? 'low_confidence' : undefined,
    }
  }

  return {
    status: 'no_match',
    matchedInput,
    evidence: [],
    sources: [],
    confidence: 'low',
    reason: 'no_exact_match',
  }
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}) => {
  const body = await context.request.json() as {
    items?: CasResolveItemInput[]
  }

  const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : []
  if (items.length === 0) {
    return json({ error: 'At least one item is required.' }, { status: 400 })
  }

  const results = await Promise.all(items.map(async (item) => {
    const key = cacheKeyFor(item.inputName)
    const now = Date.now()
    const cached = suggestionCache.get(key)

    if (cached && cached.expiresAt > now) {
      return {
        id: item.id,
        ...cached.value,
      }
    }

    const resolved = await resolveSuggestion(item, context.env)
    suggestionCache.set(key, {
      expiresAt: now + CACHE_TTL_MS,
      value: resolved,
    })

    return {
      id: item.id,
      ...resolved,
    }
  }))

  return json({ items: results })
}
