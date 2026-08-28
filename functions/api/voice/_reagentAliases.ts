import { XMLParser } from 'fast-xml-parser'
import { z } from 'zod'
import {
  buildSeedAliasTerms,
  dedupeAliasTerms,
  normalizeAliasText,
} from '../../../src/utils/reagentAliases'
import { normalizeCasNumber } from '../../../src/utils/casNumber'
import {
  type VoiceLanguage,
  type VoiceMatch,
  type VoiceMatchSource,
} from '../../../src/utils/voiceAgent'
import {
  parseOpenAIResponse,
  summarizeOpenAIError,
  type OpenAIResponsesEnv,
} from '../ai/_openai'

export interface ReagentAliasEnv extends OpenAIResponsesEnv {
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

const PUBCHEM_BASE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
const KOSHA_BASE_URL = 'https://msds.kosha.or.kr/openapi/service/msdschem'
const KOSHA_CAS_SEARCH_CONDITION = 1
const MAX_MATCH_CANDIDATES = 120
const MAX_GENERATED_ALIASES = 10
export const VOICE_ALIAS_MAX_OUTPUT_TOKENS = 500
export const VOICE_CANDIDATE_MAX_OUTPUT_TOKENS = 500
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

const reagentAliasesSchema = z.object({
  aliases: z.array(z.string().min(1).max(120)).max(MAX_GENERATED_ALIASES),
})
const candidateResolutionSchema = z.object({
  candidateId: z.string().max(200),
  confidence: z.number().min(0).max(1),
  queryAliases: z.array(z.string().min(1).max(120)).max(MAX_GENERATED_ALIASES),
})

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
  const normalizedCasNumber = normalizeCasNumber(casNumber)
  if (!env.KOSHA_API_KEY?.trim() || !normalizedCasNumber) {
    return null
  }

  const params = new URLSearchParams({
    serviceKey: env.KOSHA_API_KEY,
    searchWrd: normalizedCasNumber,
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
  const exactMatch = items.find(
    (item) => normalizeCasNumber(String(item.casNo || '')) === normalizedCasNumber,
  )
  const name = exactMatch?.chemNameKor?.trim()
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

    const casNumber = synonyms
      .map((synonym) => normalizeCasNumber(synonym))
      .find((value): value is string => Boolean(value))
    return {
      canonicalName: property.Title?.trim() || property.IUPACName?.trim() || lookup,
      casNumber,
      synonyms,
    }
  } catch (error) {
    console.warn('[voice/aliases] PubChem lookup failed:', error)
    return null
  }
}

async function generateOpenAIAliasesForMatch(
  env: ReagentAliasEnv,
  match: VoiceMatch,
  knownAliases: string[],
  safetyIdentifier: string,
): Promise<string[]> {
  if (!env.OPENAI_API_KEY?.trim()) {
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
    const response = await parseOpenAIResponse(env, {
      input: prompt,
      maxOutputTokens: VOICE_ALIAS_MAX_OUTPUT_TOKENS,
      safetyIdentifier,
      schema: reagentAliasesSchema,
      schemaName: 'reagent_aliases',
    })
    return filterUsefulAliases(response.data.aliases)
  } catch (error) {
    console.warn('[voice/aliases] OpenAI alias generation failed:', summarizeOpenAIError(error))
    return []
  }
}

export async function generateAliasesForMatch(
  env: ReagentAliasEnv,
  match: VoiceMatch,
  safetyIdentifier: string,
): Promise<string[]> {
  const seeds = buildSeedAliasTerms({
    name: match.name,
    casNumber: match.casNumber,
    productNumber: match.productNumber,
    brand: match.brand,
  })

  const pubchem = await fetchPubChemAliases(match.casNumber || match.name)
  const koshaName = await fetchKoshaKoreanNameByCas(env, match.casNumber || pubchem?.casNumber)

  const openAIAliases = await generateOpenAIAliasesForMatch(env, match, [
    ...seeds,
    pubchem?.canonicalName,
    ...(pubchem?.synonyms || []),
    pubchem?.casNumber,
    koshaName,
  ].filter((value): value is string => Boolean(value)), safetyIdentifier)

  return filterUsefulAliases([
    ...seeds,
    pubchem?.canonicalName,
    ...(pubchem?.synonyms || []),
    pubchem?.casNumber,
    koshaName,
    ...openAIAliases,
  ])
}

export async function resolveCandidateWithOpenAI(
  env: ReagentAliasEnv,
  rawInput: string,
  language: VoiceLanguage,
  matches: VoiceMatch[],
  safetyIdentifier: string,
): Promise<CandidateAliasResolution | null> {
  if (!env.OPENAI_API_KEY?.trim() || matches.length === 0) {
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
    const response = await parseOpenAIResponse(env, {
      input: prompt,
      maxOutputTokens: VOICE_CANDIDATE_MAX_OUTPUT_TOKENS,
      safetyIdentifier,
      schema: candidateResolutionSchema,
      schemaName: 'voice_candidate_resolution',
    })

    const candidateId = response.data.candidateId.trim() || null
    const confidence = typeof response.data.confidence === 'number'
      ? Math.max(0, Math.min(1, response.data.confidence))
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
      queryAliases: filterUsefulAliases(response.data.queryAliases),
    }
  } catch (error) {
    console.warn('[voice/aliases] OpenAI candidate resolution failed:', summarizeOpenAIError(error))
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
