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
export const VOICE_REFERENCE_TIMEOUT_MS = 5_000
export const VOICE_REFERENCE_MAX_BYTES = 256 * 1024
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
const pubchemPropertiesSchema = z.object({
  PropertyTable: z.object({ Properties: z.array(z.object({
    CID: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    Title: z.string().optional(),
    IUPACName: z.string().optional(),
  })) }),
})
const pubchemSynonymsSchema = z.object({
  InformationList: z.object({ Information: z.array(z.object({ Synonym: z.array(z.string()) })) }),
})

// Optional reference lookups must not hold up an already matched inventory
// result indefinitely. One deadline covers headers AND the complete body.
async function fetchReferenceText(url: string, provider: 'pubchem' | 'kosha'): Promise<string | null> {
  const controller = new AbortController()
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('Reference deadline exceeded'))
    }, VOICE_REFERENCE_TIMEOUT_MS)
  })
  try {
    response = await Promise.race([fetch(url, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: provider === 'kosha' ? 'application/xml,text/xml' : 'application/json' },
    }), deadline])
    if (!response.ok || !response.body) return null
    const declared = response.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared)
      || !Number.isSafeInteger(Number(declared)) || Number(declared) > VOICE_REFERENCE_MAX_BYTES)) return null
    reader = response.body.getReader()
    let bytes = new Uint8Array(16 * 1024)
    let length = 0
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      if (value.byteLength > VOICE_REFERENCE_MAX_BYTES - length) return null
      if (length + value.byteLength > bytes.byteLength) {
        const grown = new Uint8Array(Math.min(VOICE_REFERENCE_MAX_BYTES, Math.max(bytes.byteLength * 2, length + value.byteLength)))
        grown.set(bytes.subarray(0, length))
        bytes = grown
      }
      bytes.set(value, length)
      length += value.byteLength
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))
  } catch {
    // Never log the URL (KOSHA query contains a key), search term or raw error.
    console.warn('[voice/aliases] Reference lookup unavailable:', { provider })
    return null
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (reader) {
      // A source's cancel hook may never finish; it must not defeat the deadline.
      void reader.cancel().catch(() => undefined)
      reader.releaseLock()
    } else if (response?.body) {
      void response.body.cancel().catch(() => undefined)
    }
  }
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

  try {
    const text = await fetchReferenceText(`${KOSHA_BASE_URL}/chemlist?${params.toString()}`, 'kosha')
    if (text === null) return null
    const items = extractXmlItems(text)
    const exactMatch = items.find(
      (item) => normalizeCasNumber(String(item.casNo || '')) === normalizedCasNumber,
    )
    const name = exactMatch?.chemNameKor
    return typeof name === 'string' ? name.trim() || null : null
  } catch {
    console.warn('[voice/aliases] Invalid reference response:', { provider: 'kosha' })
    return null
  }
}

async function fetchPubChemAliases(query: string): Promise<PubChemResolution | null> {
  const lookup = query.trim()
  if (!lookup) return null

  try {
    const propertyUrl = `${PUBCHEM_BASE_URL}/compound/name/${encodeURIComponent(lookup)}/property/Title,IUPACName/JSON`
    const propertyText = await fetchReferenceText(propertyUrl, 'pubchem')
    if (propertyText === null) return null
    const propertyData = pubchemPropertiesSchema.safeParse(JSON.parse(propertyText))
    if (!propertyData.success) return null
    const property = propertyData.data.PropertyTable.Properties[0]
    const cid = property?.CID
    if (!cid) {
      return null
    }

    const synonymsText = await fetchReferenceText(`${PUBCHEM_BASE_URL}/compound/cid/${cid}/synonyms/JSON`, 'pubchem')

    let synonyms: string[] = []
    if (synonymsText !== null) {
      const synonymsData = pubchemSynonymsSchema.safeParse(JSON.parse(synonymsText))
      if (synonymsData.success) synonyms = synonymsData.data.InformationList.Information[0]?.Synonym || []
    }

    const casNumber = synonyms
      .map((synonym) => normalizeCasNumber(synonym))
      .find((value): value is string => Boolean(value))
    return {
      canonicalName: property.Title?.trim() || property.IUPACName?.trim() || lookup,
      casNumber,
      synonyms,
    }
  } catch {
    console.warn('[voice/aliases] Invalid reference response:', { provider: 'pubchem' })
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
