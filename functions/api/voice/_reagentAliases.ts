import { XMLParser } from 'fast-xml-parser'
import {
  buildSeedAliasTerms,
  dedupeAliasTerms,
  normalizeAliasText,
} from '../../../src/utils/reagentAliases'
import {
  type VoiceLanguage,
  type VoiceMatch,
  type VoiceMatchSource,
} from '../../../src/utils/voiceAgent'

export interface ReagentAliasEnv {
  GEMINI_API_KEY?: string
  KOSHA_API_KEY?: string
}

export interface ReagentAliasRow {
  source_item_type: VoiceMatchSource
  source_item_id: string
  canonical_name: string
  alias: string
  normalized_alias: string
  cas_number?: string | null
}

export interface CandidateAliasResolution {
  candidateId: string | null
  confidence: number
  queryAliases: string[]
}

const GEMINI_PRIMARY_MODEL = 'gemini-3-flash-preview'
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash'
const PUBCHEM_BASE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
const KOSHA_BASE_URL = 'https://msds.kosha.or.kr/openapi/service/msdschem'
const KOSHA_CAS_SEARCH_CONDITION = 1
const MAX_MATCH_CANDIDATES = 120
const MAX_GENERATED_ALIASES = 10
const CAS_PATTERN = /^\d{2,7}-\d{2}-\d$/
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

interface PubChemResolution {
  canonicalName?: string
  casNumber?: string
  synonyms: string[]
}

interface KoshaSearchItem {
  chemNameKor?: string
  casNo?: string
}

function getJsonMimeRequestBody(prompt: string) {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  }
}

async function generateGeminiJson<T>(
  apiKey: string,
  prompt: string,
  allowFallback = true,
): Promise<T> {
  const model = allowFallback ? GEMINI_PRIMARY_MODEL : GEMINI_FALLBACK_MODEL
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(getJsonMimeRequestBody(prompt)),
    },
  )

  if (!response.ok) {
    if (allowFallback && response.status === 503) {
      return generateGeminiJson<T>(apiKey, prompt, false)
    }

    throw new Error(`Gemini request failed with status ${response.status}.`)
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }

  const rawText = (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('')
    .trim()

  if (!rawText) {
    throw new Error('Gemini returned an empty response.')
  }

  return JSON.parse(rawText) as T
}

function isUsefulAlias(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.length < 2 || trimmed.length > 120) return false
  if (/^\d+$/.test(trimmed)) return false
  return true
}

function filterUsefulAliases(values: Array<string | null | undefined>, limit = MAX_GENERATED_ALIASES): string[] {
  return dedupeAliasTerms(
    values.filter((value): value is string => typeof value === 'string' && isUsefulAlias(value)),
    limit,
  )
}

function getMatchKey(match: Pick<VoiceMatch, 'source' | 'id'>): string {
  return `${match.source}:${match.id}`
}

function extractXmlItems(xmlText: string): KoshaSearchItem[] {
  const parsed = xmlParser.parse(xmlText) as {
    response?: {
      body?: {
        items?: {
          item?: KoshaSearchItem | KoshaSearchItem[]
        }
      }
    }
  }

  const items = parsed.response?.body?.items?.item
  if (!items) return []
  return Array.isArray(items) ? items : [items]
}

async function fetchKoshaKoreanNameByCas(env: ReagentAliasEnv, casNumber?: string | null): Promise<string | null> {
  if (!env.KOSHA_API_KEY?.trim() || !casNumber || !CAS_PATTERN.test(casNumber.trim())) {
    return null
  }

  const params = new URLSearchParams({
    serviceKey: env.KOSHA_API_KEY,
    searchWrd: casNumber.trim(),
    searchCnd: String(KOSHA_CAS_SEARCH_CONDITION),
    pageNo: '1',
    numOfRows: '3',
  })

  const response = await fetch(`${KOSHA_BASE_URL}/chemlist?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
    },
  })

  if (!response.ok) {
    return null
  }

  const items = extractXmlItems(await response.text())
  const name = items[0]?.chemNameKor?.trim()
  return name || null
}

async function fetchPubChemAliases(query: string): Promise<PubChemResolution | null> {
  const lookup = query.trim()
  if (!lookup) return null

  try {
    const propertyUrl = `${PUBCHEM_BASE_URL}/compound/name/${encodeURIComponent(lookup)}/property/Title,IUPACName/JSON`
    const propertyResponse = await fetch(propertyUrl)

    if (!propertyResponse.ok) {
      return null
    }

    const propertyData = await propertyResponse.json() as {
      PropertyTable?: {
        Properties?: Array<{
          CID?: number
          Title?: string
          IUPACName?: string
        }>
      }
    }

    const property = propertyData.PropertyTable?.Properties?.[0]
    const cid = property?.CID
    if (!cid) {
      return null
    }

    const synonymsResponse = await fetch(
      `${PUBCHEM_BASE_URL}/compound/cid/${cid}/synonyms/JSON`,
    )

    let synonyms: string[] = []
    if (synonymsResponse.ok) {
      const synonymsData = await synonymsResponse.json() as {
        InformationList?: {
          Information?: Array<{
            Synonym?: string[]
          }>
        }
      }
      synonyms = synonymsData.InformationList?.Information?.[0]?.Synonym || []
    }

    const casNumber = synonyms.find((synonym) => CAS_PATTERN.test(synonym.trim()))
    return {
      canonicalName: property.Title?.trim() || property.IUPACName?.trim() || lookup,
      casNumber: casNumber?.trim(),
      synonyms,
    }
  } catch (error) {
    console.warn('[voice/aliases] PubChem lookup failed:', error)
    return null
  }
}

async function generateGeminiAliasesForMatch(
  env: ReagentAliasEnv,
  match: VoiceMatch,
  knownAliases: string[],
): Promise<string[]> {
  if (!env.GEMINI_API_KEY?.trim()) {
    return []
  }

  const prompt = [
    'Generate reagent search aliases for one laboratory chemical.',
    'Return only JSON with this shape:',
    '{"aliases":["string"]}',
    'Rules:',
    '- Include up to 8 aliases.',
    '- Include bilingual aliases when useful: Korean common names, Korean phonetic transliterations, English canonical names, and common abbreviations.',
    '- Do not include full question sentences.',
    '- Do not include duplicates.',
    `Canonical name: ${match.name}`,
    `CAS number: ${match.casNumber || ''}`,
    `Known aliases: ${knownAliases.join(', ') || 'none'}`,
  ].join('\n')

  try {
    const response = await generateGeminiJson<{ aliases?: string[] }>(env.GEMINI_API_KEY, prompt)
    return filterUsefulAliases(response.aliases || [])
  } catch (error) {
    console.warn('[voice/aliases] Gemini alias generation failed:', error)
    return []
  }
}

export async function generateAliasesForMatch(
  env: ReagentAliasEnv,
  match: VoiceMatch,
): Promise<string[]> {
  const seeds = buildSeedAliasTerms({
    name: match.name,
    casNumber: match.casNumber,
    productNumber: match.productNumber,
    brand: match.brand,
  })

  const pubchem = await fetchPubChemAliases(match.casNumber || match.name)
  const koshaName = await fetchKoshaKoreanNameByCas(env, match.casNumber || pubchem?.casNumber)

  const geminiAliases = await generateGeminiAliasesForMatch(env, match, [
    ...seeds,
    pubchem?.canonicalName,
    ...(pubchem?.synonyms || []),
    pubchem?.casNumber,
    koshaName,
  ].filter((value): value is string => Boolean(value)))

  return filterUsefulAliases([
    ...seeds,
    pubchem?.canonicalName,
    ...(pubchem?.synonyms || []),
    pubchem?.casNumber,
    koshaName,
    ...geminiAliases,
  ])
}

export async function resolveCandidateWithGemini(
  env: ReagentAliasEnv,
  rawInput: string,
  language: VoiceLanguage,
  matches: VoiceMatch[],
): Promise<CandidateAliasResolution | null> {
  if (!env.GEMINI_API_KEY?.trim() || matches.length === 0) {
    return null
  }

  const candidates = matches.slice(0, MAX_MATCH_CANDIDATES).map((match) => ({
    candidateId: getMatchKey(match),
    name: match.name,
    brand: match.brand || '',
    productNumber: match.productNumber || '',
    casNumber: match.casNumber || '',
    storageType: match.storageType || '',
  }))

  const prompt = [
    'Map a user spoken reagent query to one reagent candidate from the current lab inventory.',
    'Return only JSON with this exact shape:',
    '{"candidateId":"source:id or empty","confidence":0.0,"queryAliases":["string"]}',
    'Rules:',
    '- Choose at most one candidateId.',
    '- If uncertain, return an empty candidateId and low confidence.',
    '- queryAliases should contain a few useful normalized search aliases for the same reagent.',
    '- Use chemistry knowledge, transliterations, Korean common names, and English synonyms when appropriate.',
    `Preferred language: ${language}`,
    `User query: ${rawInput}`,
    `Candidates: ${JSON.stringify(candidates)}`,
  ].join('\n')

  try {
    const response = await generateGeminiJson<{
      candidateId?: string
      confidence?: number
      queryAliases?: string[]
    }>(env.GEMINI_API_KEY, prompt)

    const candidateId = response.candidateId?.trim() || null
    const confidence = typeof response.confidence === 'number'
      ? Math.max(0, Math.min(1, response.confidence))
      : 0

    if (!candidateId) {
      return null
    }

    const knownCandidateIds = new Set(candidates.map((candidate) => candidate.candidateId))
    if (!knownCandidateIds.has(candidateId)) {
      return null
    }

    return {
      candidateId,
      confidence,
      queryAliases: filterUsefulAliases(response.queryAliases || []),
    }
  } catch (error) {
    console.warn('[voice/aliases] Gemini candidate resolution failed:', error)
    return null
  }
}

export function buildAliasMap(
  matches: VoiceMatch[],
  aliasRows: ReagentAliasRow[],
): Map<string, string[]> {
  const aliasMap = new Map<string, string[]>()

  for (const match of matches) {
    aliasMap.set(
      getMatchKey(match),
      buildSeedAliasTerms({
        name: match.name,
        casNumber: match.casNumber,
        productNumber: match.productNumber,
        brand: match.brand,
      }),
    )
  }

  for (const row of aliasRows) {
    const key = `${row.source_item_type}:${row.source_item_id}`
    const current = aliasMap.get(key) || []
    aliasMap.set(key, dedupeAliasTerms([
      ...current,
      row.alias,
      row.canonical_name,
      row.cas_number || undefined,
    ]))
  }

  return aliasMap
}

export function getMatchKeyForAlias(match: Pick<VoiceMatch, 'source' | 'id'>): string {
  return getMatchKey(match)
}

export function buildAliasUpsertRows(
  match: VoiceMatch,
  aliases: string[],
  metadata?: Record<string, unknown>,
): Array<{
  source_item_type: VoiceMatchSource
  source_item_id: string
  canonical_name: string
  alias: string
  normalized_alias: string
  cas_number: string | null
  lab_id: string | null
  metadata: Record<string, unknown>
}> {
  return dedupeAliasTerms([
    ...buildSeedAliasTerms({
      name: match.name,
      casNumber: match.casNumber,
      productNumber: match.productNumber,
      brand: match.brand,
    }),
    ...aliases,
  ]).map((alias) => ({
    source_item_type: match.source,
    source_item_id: match.id,
    canonical_name: match.name,
    alias,
    normalized_alias: normalizeAliasText(alias),
    cas_number: match.casNumber || null,
    lab_id: match.labId || null,
    metadata: metadata || {},
  }))
}
