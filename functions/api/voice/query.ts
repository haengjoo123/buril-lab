import { createClient } from '@supabase/supabase-js'
import {
  buildClarificationMessage,
  buildExpiryAnswer,
  buildLocationSummary,
  describeRemainingPercent,
  detectVoiceLanguage,
  normalizeCompactToken,
  normalizeVoiceLookupText,
  type VoiceAgentIntent,
  type VoiceClarification,
  type VoiceFailureReason,
  type VoiceLanguage,
  type VoiceMatch,
  type VoiceMatchSource,
  type VoiceQueryRequest,
  type VoiceQueryResponse,
  type VoiceUiAction,
} from '../../../src/utils/voiceAgent'
import { getExpiryStatus } from '../../../src/utils/expiryStatus'
import { dedupeAliasTerms } from '../../../src/utils/reagentAliases'
import { json } from './_shared'
import {
  buildAliasMap,
  buildAliasUpsertRows,
  generateAliasesForMatch,
  getMatchKeyForAlias,
  resolveCandidateWithGemini,
  type ReagentAliasRow,
} from './_reagentAliases'

interface VoiceQueryEnv {
  GEMINI_API_KEY?: string
  KOSHA_API_KEY?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

interface IntentExtraction {
  intent: VoiceAgentIntent
  reagentQuery: string
  queryAliases?: string[]
  casNumber?: string
  language: VoiceLanguage
  confidence: number
}

interface CabinetItemRow {
  id: string
  name: string
  brand: string | null
  product_number: string | null
  cas_no: string | null
  capacity: string | null
  expiry_date: string | null
  remaining_percent: number | null
  cabinet_id: string
  shelf_id: string | null
  cabinets:
    | { name: string | null; lab_id: string | null }
    | { name: string | null; lab_id: string | null }[]
    | null
  cabinet_shelves: { level: number | null } | { level: number | null }[] | null
}

interface InventoryRow {
  id: string
  lab_id: string | null
  name: string
  brand: string | null
  product_number: string | null
  cas_number: string | null
  capacity: string | null
  expiry_date: string | null
  remaining_percent: number | null
  storage_type: 'cabinet' | 'other'
  cabinet_id: string | null
  storage_location_id: string | null
  cabinets: { name: string | null } | { name: string | null }[] | null
  storage_locations:
    | { name: string | null; icon: string | null }
    | { name: string | null; icon: string | null }[]
    | null
}

interface ScoredMatch {
  match: VoiceMatch
  score: number
}

const GEMINI_PRIMARY_MODEL = 'gemini-3-flash-preview'
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash'
const MAX_QUERY_LENGTH = 200
const MATCH_LIMIT = 200
const AMBIGUITY_SCORE_WINDOW = 15
const VALID_INTENTS: VoiceAgentIntent[] = ['location', 'expiration', 'remaining', 'disposal']
const MAX_QUERY_ALIASES = 6
const CANDIDATE_ALIAS_CONFIDENCE_THRESHOLD = 0.72
const INTENT_HINTS: Array<{ intent: VoiceAgentIntent; patterns: RegExp[] }> = [
  {
    intent: 'expiration',
    patterns: [
      /\uC720\uD1B5\uAE30\uD55C/i,
      /\uB9CC\uB8CC/i,
      /\b(expir(?:y|e|ation)|best before|use by)\b/i,
    ],
  },
  {
    intent: 'remaining',
    patterns: [
      /\uC794\uB7C9/i,
      /\uB0A8\uC740/i,
      /\uB0A8\uC558/i,
      /\uC5BC\uB9C8\uB098\s*\uB0A8/i,
      /\b(remaining|left|amount left|how much is left)\b/i,
    ],
  },
  {
    intent: 'disposal',
    patterns: [
      /\uD3D0\uAE30/i,
      /\uBC84\uB824/i,
      /\b(dispose|disposal|throw away|trash)\b/i,
    ],
  },
  {
    intent: 'location',
    patterns: [
      /\uC5B4\uB514/i,
      /\uC704\uCE58/i,
      /\uCC3E\uC544/i,
      /\b(where|location|find)\b/i,
    ],
  },
]
const MANUAL_QUERY_ALIASES: Record<string, string[]> = {
  '글루코즈': ['glucose', 'd-glucose', 'dextrose', '포도당', 'glucos'],
  '글루코스': ['glucose', 'd-glucose', 'dextrose', '포도당', 'glucos'],
  '포도당': ['glucose', 'd-glucose', 'dextrose', '글루코즈', '글루코스'],
}

function getRelationRow<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function dedupeLookupTerms(values: Array<string | null | undefined>): string[] {
  return dedupeAliasTerms(values)
}

function getManualQueryAliases(value: string): string[] {
  void MANUAL_QUERY_ALIASES
  void value
  return []
}

function buildQueryVariants(extracted: IntentExtraction, rawInput: string): string[] {
  return dedupeLookupTerms([
    rawInput,
    extracted.reagentQuery,
    ...(extracted.queryAliases || []),
    ...getManualQueryAliases(rawInput),
  ]).slice(0, MAX_QUERY_ALIASES + 2)
}

function resolveSupabaseUrl(env: VoiceQueryEnv): string | null {
  return env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim() || null
}

function resolveSupabaseAnonKey(env: VoiceQueryEnv): string | null {
  return env.SUPABASE_ANON_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim() || null
}

function createSupabaseUserClient(env: VoiceQueryEnv, authHeader: string) {
  const url = resolveSupabaseUrl(env)
  const anonKey = resolveSupabaseAnonKey(env)

  if (!url || !anonKey) {
    throw new Error('Supabase server environment variables are not configured.')
  }

  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
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
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
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

async function generateDisposalGuide(
  apiKey: string,
  chemical: { name: string; casNumber?: string | null },
  language: VoiceLanguage,
  allowFallback = true,
): Promise<string> {
  const model = allowFallback ? GEMINI_PRIMARY_MODEL : GEMINI_FALLBACK_MODEL
  const prompt = language === 'ko'
    ? [
      '당신은 실험실 시약 폐기 보조 도우미입니다.',
      `시약명: ${chemical.name}`,
      `CAS: ${chemical.casNumber || 'unknown'}`,
      '한국어로 2문장 이내로 답하세요.',
      '첫 문장은 바로 실행 가능한 폐기 방향을 말하고,',
      '둘째 문장은 불확실하면 "MSDS 확인 필요"를 반드시 포함하세요.',
      '과장하지 말고, 확실하지 않은 경우 보수적으로 답하세요.',
    ].join('\n')
    : [
      'You are a lab reagent disposal assistant.',
      `Reagent: ${chemical.name}`,
      `CAS: ${chemical.casNumber || 'unknown'}`,
      'Answer in English in no more than 2 sentences.',
      'Sentence 1 should give the likely disposal direction.',
      'Sentence 2 must include "Check the MSDS" if there is any uncertainty.',
      'Be conservative and do not overstate certainty.',
    ].join('\n')

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    },
  )

  if (!response.ok) {
    if (allowFallback && response.status === 503) {
      return generateDisposalGuide(apiKey, chemical, language, false)
    }

    throw new Error(`Gemini disposal request failed with status ${response.status}.`)
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }

  return (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join(' ')
    .trim()
}

function fallbackIntentExtraction(input: string, preferredLanguage?: VoiceLanguage): IntentExtraction {
  const normalized = normalizeVoiceLookupText(input)
  const language = preferredLanguage || detectVoiceLanguage(input)

  const keywords: Array<{ intent: VoiceAgentIntent; patterns: RegExp[] }> = [
    { intent: 'expiration', patterns: [/유통기한/, /만료/, /expiry/, /expire/] },
    { intent: 'remaining', patterns: [/잔량/, /남았/, /남아/, /remaining/, /left/] },
    { intent: 'disposal', patterns: [/폐기/, /버려/, /dispose/, /disposal/] },
    { intent: 'location', patterns: [/어디/, /위치/, /찾아/, /where/, /location/] },
  ]

  const matchedIntent = keywords.find(({ patterns }) => patterns.some((pattern) => pattern.test(input.toLowerCase())))
  const intent = matchedIntent?.intent || 'location'

  return {
    intent,
    reagentQuery: normalized,
    queryAliases: [],
    language,
    confidence: 0.35,
  }
}

function refineExtractedIntent(input: string, intent: VoiceAgentIntent): VoiceAgentIntent {
  const hintedIntent = INTENT_HINTS.find(({ patterns }) => patterns.some((pattern) => pattern.test(input)))
  return hintedIntent?.intent || intent
}

async function extractIntent(
  apiKey: string,
  input: string,
  contextLanguage?: VoiceLanguage,
): Promise<IntentExtraction> {
  const prompt = [
    'Extract a reagent lookup request from the user input.',
    'Return only JSON with this exact shape:',
    '{"intent":"location|expiration|remaining|disposal","reagentQuery":"string","queryAliases":["string"],"casNumber":"string or empty","language":"ko|en","confidence":0.0}',
    'Rules:',
    '- intent must be one of location, expiration, remaining, disposal.',
    '- reagentQuery should be the best corrected reagent name or lookup phrase.',
    '- queryAliases should contain up to 6 alternative lookup forms for DB matching.',
    '- If the user says a Korean pronunciation of an English reagent, include the likely English reagent name in queryAliases.',
    '- queryAliases may include Korean common names, English canonical names, abbreviations, or close transliterations.',
    '- Do not include duplicates or full question sentences in queryAliases.',
    '- casNumber should be empty unless the user clearly said or implied a CAS number.',
    '- confidence must be between 0 and 1.',
    '- If the user speaks Korean, set language to ko. Otherwise use en.',
    '- Correct likely speech transcription mistakes when possible.',
    '- Example: "글루코즈 어디에 있어" should produce reagentQuery around "글루코즈" and queryAliases including "glucose".',
    contextLanguage ? `Preferred response language: ${contextLanguage}` : '',
    `User input: ${input}`,
  ].filter(Boolean).join('\n')

  try {
    const extracted = await generateGeminiJson<Partial<IntentExtraction>>(apiKey, prompt)
    const initialIntent = VALID_INTENTS.includes(extracted.intent as VoiceAgentIntent)
      ? (extracted.intent as VoiceAgentIntent)
      : 'location'
    const intent = refineExtractedIntent(input, initialIntent)
    const reagentQuery = extracted.reagentQuery?.trim() || input.trim()
    const language = extracted.language === 'en' ? 'en' : 'ko'
    const queryAliases = dedupeAliasTerms(
      Array.isArray(extracted.queryAliases) ? extracted.queryAliases : [],
    ).slice(0, MAX_QUERY_ALIASES)
    const confidence = typeof extracted.confidence === 'number'
      ? Math.max(0, Math.min(1, extracted.confidence))
      : 0.5

    return {
      intent,
      reagentQuery,
      queryAliases,
      casNumber: extracted.casNumber?.trim() || undefined,
      language,
      confidence,
    }
  } catch (error) {
    console.warn('[voice/query] intent extraction fallback:', error)
    return fallbackIntentExtraction(input, contextLanguage)
  }
}

function getDaysLeft(expiryDate?: string | null): number | null {
  const status = getExpiryStatus(expiryDate)
  return status && Number.isFinite(status.daysLeft) ? status.daysLeft : null
}

function mapCabinetItem(row: CabinetItemRow): VoiceMatch {
  return {
    source: 'cabinet_item',
    id: row.id,
    name: row.name,
    labId: getRelationRow(row.cabinets)?.lab_id || undefined,
    casNumber: row.cas_no || undefined,
    productNumber: row.product_number || undefined,
    brand: row.brand || undefined,
    cabinetId: row.cabinet_id,
    cabinetName: getRelationRow(row.cabinets)?.name || undefined,
    shelfId: row.shelf_id || undefined,
    shelfLevel: getRelationRow(row.cabinet_shelves)?.level ?? undefined,
    storageType: 'cabinet',
    expiryDate: row.expiry_date || undefined,
    remainingPercent: row.remaining_percent ?? undefined,
    capacity: row.capacity || undefined,
    matchedBy: 'contains',
  }
}

function mapInventoryRow(row: InventoryRow): VoiceMatch {
  return {
    source: 'inventory',
    id: row.id,
    name: row.name,
    labId: row.lab_id || undefined,
    casNumber: row.cas_number || undefined,
    productNumber: row.product_number || undefined,
    brand: row.brand || undefined,
    cabinetId: row.cabinet_id || undefined,
    cabinetName: getRelationRow(row.cabinets)?.name || undefined,
    storageType: row.storage_type,
    storageLocationId: row.storage_location_id || undefined,
    storageLocationName: getRelationRow(row.storage_locations)?.name || undefined,
    storageLocationIcon: getRelationRow(row.storage_locations)?.icon || undefined,
    expiryDate: row.expiry_date || undefined,
    remainingPercent: row.remaining_percent ?? undefined,
    capacity: row.capacity || undefined,
    matchedBy: 'contains',
  }
}

function buildDeduplicationKey(match: VoiceMatch): string {
  return [
    normalizeCompactToken(match.cabinetId),
    normalizeVoiceLookupText(match.name),
    normalizeCompactToken(match.brand),
    normalizeCompactToken(match.productNumber),
    normalizeCompactToken(match.capacity),
    normalizeCompactToken(match.casNumber),
  ].join('|')
}

function dedupeMatches(matches: VoiceMatch[]): VoiceMatch[] {
  const cabinetKeys = new Set(
    matches
      .filter((match) => match.source === 'cabinet_item')
      .map((match) => buildDeduplicationKey(match)),
  )

  return matches.filter((match) => {
    if (match.source !== 'inventory' || match.storageType !== 'cabinet') {
      return true
    }

    return !cabinetKeys.has(buildDeduplicationKey(match))
  })
}

function buildCandidateTerms(match: VoiceMatch, aliasMap: Map<string, string[]>): string[] {
  return dedupeAliasTerms([
    match.name,
    ...(aliasMap.get(getMatchKeyForAlias(match)) || []),
  ])
}

function scoreMatch(
  match: VoiceMatch,
  reagentQueries: string[],
  casNumber: string | undefined,
  contextCabinetId: string | undefined,
  aliasMap: Map<string, string[]>,
): ScoredMatch | null {
  const normalizedProduct = normalizeCompactToken(match.productNumber)
  const normalizedCas = normalizeCompactToken(match.casNumber)
  const candidateTerms = buildCandidateTerms(match, aliasMap)
  const normalizedCandidateTerms = candidateTerms.map((term) => normalizeVoiceLookupText(term))

  let score = 0
  let matchedBy: VoiceMatch['matchedBy'] | null = null

  if (casNumber && normalizedCas && normalizedCas === normalizeCompactToken(casNumber)) {
    score = 1000
    matchedBy = 'cas'
  } else {
    for (const reagentQuery of reagentQueries) {
      const normalizedQuery = normalizeVoiceLookupText(reagentQuery)
      const compactQuery = normalizeCompactToken(reagentQuery)

      if (
        normalizedQuery &&
        normalizedCandidateTerms.some((candidate) => candidate && candidate === normalizedQuery)
      ) {
        score = 900
        matchedBy = 'name_exact'
        break
      }

      if (compactQuery && normalizedProduct && normalizedProduct === compactQuery) {
        score = 850
        matchedBy = 'product_exact'
        break
      }

      if (
        normalizedQuery &&
        normalizedCandidateTerms.some((candidate) =>
          candidate &&
          (candidate.startsWith(normalizedQuery) || normalizedQuery.startsWith(candidate)),
        )
      ) {
        score = 700
        matchedBy = 'prefix'
        break
      }

      if (
        normalizedQuery &&
        normalizedCandidateTerms.some((candidate) =>
          candidate &&
          (candidate.includes(normalizedQuery) || normalizedQuery.includes(candidate)),
        )
      ) {
        score = 600
        matchedBy = 'contains'
        break
      }
    }
  }

  if (!matchedBy) {
    return null
  }

  if (match.source === 'cabinet_item') {
    score += 20
  }

  if (contextCabinetId && match.cabinetId === contextCabinetId) {
    score += 15
  }

  return {
    score,
    match: {
      ...match,
      matchedBy,
    },
  }
}

function selectMatches(
  matches: VoiceMatch[],
  reagentQueries: string[],
  casNumber: string | undefined,
  contextCabinetId: string | undefined,
  aliasMap: Map<string, string[]>,
): ScoredMatch[] {
  return matches
    .map((match) => scoreMatch(match, reagentQueries, casNumber, contextCabinetId, aliasMap))
    .filter((value): value is ScoredMatch => value !== null)
    .sort((left, right) => right.score - left.score)
}

function buildClarification(
  reason: Exclude<VoiceFailureReason, 'user_corrected'>,
  reagentQuery: string,
  language: VoiceLanguage,
  candidates: VoiceMatch[],
): VoiceClarification {
  return {
    reason,
    message: buildClarificationMessage(reason, reagentQuery, language),
    candidates: candidates.slice(0, 4).map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      source: candidate.source,
      cabinetName: candidate.cabinetName,
      shelfLevel: candidate.shelfLevel,
      storageLocationName: candidate.storageLocationName,
    })),
  }
}

function resolveUiAction(match: VoiceMatch | null): VoiceUiAction {
  if (!match) {
    return { type: 'none' }
  }

  if (match.source === 'cabinet_item' && match.cabinetId && match.shelfId) {
    return {
      type: 'focus_cabinet_item',
      cabinetId: match.cabinetId,
      shelfId: match.shelfId,
      highlightItemId: match.id,
    }
  }

  if (match.storageType === 'other') {
    return {
      type: 'show_storage_location',
    }
  }

  return { type: 'none' }
}

async function insertFeedback(
  supabase: ReturnType<typeof createSupabaseUserClient>,
  payload: {
    rawInput: string
    normalizedQuery?: string
    intent?: VoiceAgentIntent
    failureReason: VoiceFailureReason
    correctionText?: string
    selectedMatchSource?: VoiceMatchSource
    selectedMatchId?: string
    metadata?: Record<string, unknown>
  },
) {
  const { error } = await supabase.from('voice_query_feedback').insert({
    raw_input: payload.rawInput,
    normalized_query: payload.normalizedQuery || null,
    intent: payload.intent || null,
    failure_reason: payload.failureReason,
    correction_text: payload.correctionText || null,
    selected_match_source: payload.selectedMatchSource || null,
    selected_match_id: payload.selectedMatchId || null,
    metadata: payload.metadata || {},
  })

  if (error) {
    console.warn('[voice/query] feedback insert skipped:', error.message)
  }
}

async function persistAliases(
  supabase: ReturnType<typeof createSupabaseUserClient>,
  match: VoiceMatch,
  aliases: string[],
  metadata?: Record<string, unknown>,
) {
  const rows = buildAliasUpsertRows(match, aliases, metadata)
  if (rows.length === 0) {
    return
  }

  const { error } = await supabase
    .from('reagent_aliases')
    .upsert(rows, {
      onConflict: 'source_item_type,source_item_id,normalized_alias',
      ignoreDuplicates: true,
    })

  if (error) {
    console.warn('[voice/query] alias upsert skipped:', error.message)
  }
}

function buildRemainingAnswer(match: VoiceMatch, language: VoiceLanguage): string {
  const remainingSpeech = describeRemainingPercent(match.remainingPercent, language)
  if (language === 'ko') {
    return `${match.name}는 ${remainingSpeech}`
  }

  return `For ${match.name}, ${remainingSpeech}`
}

async function buildDisposalAnswer(
  env: VoiceQueryEnv,
  match: VoiceMatch,
  language: VoiceLanguage,
): Promise<string> {
  if (!env.GEMINI_API_KEY?.trim()) {
    return language === 'ko'
      ? `${match.name}의 폐기 방법은 자동 안내를 만들지 못했어요. MSDS 확인 필요.`
      : `I could not generate a disposal guide for ${match.name}. Check the MSDS.`
  }

  try {
    const guide = await generateDisposalGuide(
      env.GEMINI_API_KEY,
      {
        name: match.name,
        casNumber: match.casNumber,
      },
      language,
    )

    return guide || (
      language === 'ko'
        ? `${match.name}의 폐기 방법을 확정할 수 없어요. MSDS 확인 필요.`
        : `I could not confirm the disposal method for ${match.name}. Check the MSDS.`
    )
  } catch (error) {
    console.warn('[voice/query] disposal guide fallback:', error)
    return language === 'ko'
      ? `${match.name}의 폐기 방법은 보수적으로 확인해야 해요. MSDS 확인 필요.`
      : `Please verify the disposal method for ${match.name} conservatively. Check the MSDS.`
  }
}

async function buildAnswerText(
  env: VoiceQueryEnv,
  intent: VoiceAgentIntent,
  match: VoiceMatch,
  language: VoiceLanguage,
): Promise<string> {
  if (intent === 'location') {
    return buildLocationSummary(match, language)
  }

  if (intent === 'expiration') {
    return buildExpiryAnswer(match.name, match.expiryDate, language, getDaysLeft)
  }

  if (intent === 'remaining') {
    return buildRemainingAnswer(match, language)
  }

  return buildDisposalAnswer(env, match, language)
}

export const onRequestPost = async (context: {
  request: Request
  env: VoiceQueryEnv
}) => {
  const authHeader = context.request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Authentication is required.' }, { status: 401 })
  }

  if (!context.env.GEMINI_API_KEY?.trim()) {
    return json({ error: 'Gemini API key is not configured.' }, { status: 500 })
  }

  let body: VoiceQueryRequest
  try {
    body = await context.request.json() as VoiceQueryRequest
  } catch {
    return json({ error: 'A valid JSON body is required.' }, { status: 400 })
  }

  const rawText = body.text?.trim()
  if (!rawText) {
    return json({ error: 'Text is required.' }, { status: 400 })
  }

  if (rawText.length > MAX_QUERY_LENGTH) {
    return json({ error: `Text must be ${MAX_QUERY_LENGTH} characters or fewer.` }, { status: 400 })
  }

  try {
    const supabase = createSupabaseUserClient(context.env, authHeader)
    const extracted = await extractIntent(
      context.env.GEMINI_API_KEY,
      rawText,
      body.context?.language,
    )
    let queryVariants = buildQueryVariants(extracted, rawText)

    const language = body.context?.language || extracted.language || detectVoiceLanguage(rawText)

    const [cabinetItemsResult, inventoryResult, aliasRowsResult] = await Promise.all([
      supabase
        .from('cabinet_items')
        .select(`
          id,
          name,
          brand,
          product_number,
          cas_no,
          capacity,
          expiry_date,
          remaining_percent,
          cabinet_id,
          shelf_id,
          cabinets ( name, lab_id ),
          cabinet_shelves ( level )
        `)
        .limit(MATCH_LIMIT),
      supabase
        .from('inventory')
        .select(`
          id,
          lab_id,
          name,
          brand,
          product_number,
          cas_number,
          capacity,
          expiry_date,
          remaining_percent,
          storage_type,
          cabinet_id,
          storage_location_id,
          cabinets ( name ),
          storage_locations ( name, icon )
        `)
        .limit(MATCH_LIMIT),
      supabase
        .from('reagent_aliases')
        .select(`
          source_item_type,
          source_item_id,
          canonical_name,
          alias,
          normalized_alias,
          cas_number
        `)
        .limit(MATCH_LIMIT * 20),
    ])

    if (cabinetItemsResult.error) {
      throw new Error(cabinetItemsResult.error.message)
    }

    if (inventoryResult.error) {
      throw new Error(inventoryResult.error.message)
    }

    if (aliasRowsResult.error) {
      throw new Error(aliasRowsResult.error.message)
    }

    const allMatches = dedupeMatches([
      ...((cabinetItemsResult.data || []) as CabinetItemRow[]).map(mapCabinetItem),
      ...((inventoryResult.data || []) as InventoryRow[]).map(mapInventoryRow),
    ])
    const aliasMap = buildAliasMap(
      allMatches,
      (aliasRowsResult.data || []) as ReagentAliasRow[],
    )

    let scoredMatches = selectMatches(
      allMatches,
      queryVariants,
      extracted.casNumber,
      body.context?.cabinetId,
      aliasMap,
    )

    let topMatch = scoredMatches[0]
    let closeMatches = topMatch
      ? scoredMatches.filter(({ score }) => topMatch.score - score <= AMBIGUITY_SCORE_WINDOW)
      : []
    let learnedQueryAliases: string[] = []

    if ((!topMatch || closeMatches.length > 1) && allMatches.length > 0) {
      const candidateResolution = await resolveCandidateWithGemini(
        context.env,
        rawText,
        language,
        topMatch ? closeMatches.map(({ match }) => match) : allMatches,
      )

      if (
        candidateResolution?.candidateId &&
        candidateResolution.confidence >= CANDIDATE_ALIAS_CONFIDENCE_THRESHOLD
      ) {
        const resolvedMatch = allMatches.find(
          (match) => getMatchKeyForAlias(match) === candidateResolution.candidateId,
        )

        if (resolvedMatch) {
          learnedQueryAliases = candidateResolution.queryAliases
          queryVariants = dedupeAliasTerms([
            ...queryVariants,
            ...candidateResolution.queryAliases,
          ]).slice(0, MAX_QUERY_ALIASES + 4)

          scoredMatches = selectMatches(
            allMatches,
            queryVariants,
            extracted.casNumber,
            body.context?.cabinetId,
            aliasMap,
          )

          topMatch = scoredMatches.find(
            ({ match }) => getMatchKeyForAlias(match) === candidateResolution.candidateId,
          ) || {
            score: 920,
            match: {
              ...resolvedMatch,
              matchedBy: 'name_exact',
            },
          }

          closeMatches = [topMatch]
        }
      }
    }

    if (!topMatch) {
      const clarification = buildClarification('no_match', extracted.reagentQuery, language, [])
      await insertFeedback(supabase, {
        rawInput: rawText,
        normalizedQuery: extracted.reagentQuery,
        intent: extracted.intent,
        failureReason: 'no_match',
        metadata: {
          source: body.source,
          transcriptMeta: body.transcriptMeta || null,
          confidence: extracted.confidence,
          learnedQueryAliases,
          queryVariants,
        },
      })

      const response: VoiceQueryResponse = {
        resolvedText: extracted.reagentQuery,
        intent: extracted.intent,
        answerText: clarification.message,
        speech: {
          mode: 'none',
          text: clarification.message,
        },
        match: null,
        uiAction: { type: 'clarify' },
        clarification,
      }

      return json(response)
    }

    if (closeMatches.length > 1) {
      const clarification = buildClarification(
        'ambiguous',
        extracted.reagentQuery,
        language,
        closeMatches.map(({ match }) => match),
      )

      await insertFeedback(supabase, {
        rawInput: rawText,
        normalizedQuery: extracted.reagentQuery,
        intent: extracted.intent,
        failureReason: 'ambiguous',
        metadata: {
          source: body.source,
          transcriptMeta: body.transcriptMeta || null,
          confidence: extracted.confidence,
          learnedQueryAliases,
          queryVariants,
          candidates: closeMatches.slice(0, 4).map(({ match, score }) => ({
            id: match.id,
            name: match.name,
            source: match.source,
            score,
          })),
        },
      })

      const response: VoiceQueryResponse = {
        resolvedText: extracted.reagentQuery,
        intent: extracted.intent,
        answerText: clarification.message,
        speech: {
          mode: 'none',
          text: clarification.message,
        },
        match: null,
        uiAction: { type: 'clarify' },
        clarification,
      }

      return json(response)
    }

    const chosenMatch = topMatch.match
    const existingAliases = aliasMap.get(getMatchKeyForAlias(chosenMatch)) || []
    const generatedAliases = existingAliases.length >= 4
      ? []
      : await generateAliasesForMatch(context.env, chosenMatch)
    const aliasesToPersist = dedupeAliasTerms([
      extracted.reagentQuery,
      ...learnedQueryAliases,
      ...generatedAliases,
    ])
    await persistAliases(
      supabase,
      chosenMatch,
      aliasesToPersist,
      {
        source: body.source,
        transcriptMeta: body.transcriptMeta || null,
        intent: extracted.intent,
      },
    )
    const answerText = await buildAnswerText(context.env, extracted.intent, chosenMatch, language)
    const response: VoiceQueryResponse = {
      resolvedText: extracted.reagentQuery,
      intent: extracted.intent,
      answerText,
      speech: {
        mode: 'remote_audio',
        text: answerText,
      },
      match: chosenMatch,
      uiAction: resolveUiAction(chosenMatch),
      clarification: null,
    }

    return json(response)
  } catch (error) {
    console.error('[voice/query] failed:', error)
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to process voice query.',
      },
      { status: 502 },
    )
  }
}
