import { dedupeAliasTerms } from './reagentAliases'
import { normalizeVoiceLookupText, type VoiceAgentIntent } from './voiceAgent'

const GENERIC_EDGE_STOP_WORDS = new Set([
  'a',
  'an',
  'can',
  'me',
  'please',
  'pls',
  'the',
  'this',
  'that',
  'these',
  'those',
  'you',
  '줘',
  '좀',
  '이거',
  '저거',
  '그거',
])

const INTENT_EDGE_STOP_WORDS: Record<VoiceAgentIntent, Set<string>> = {
  location: new Set([
    'where',
    'is',
    'are',
    'find',
    'location',
    'located',
    '어디',
    '어디에',
    '어디서',
    '위치',
    '찾아',
    '찾아줘',
    '알려',
    '알려줘',
    '말해',
    '말해줘',
    '보관',
    '있나',
    '있니',
    '있나요',
    '있어',
    '있어요',
  ]),
  expiration: new Set([
    'when',
    'expire',
    'expires',
    'expired',
    'expiry',
    'expiration',
    'date',
    '유통기한',
    '기한',
    '만료',
    '만료일',
    '알려',
    '알려줘',
    '말해',
    '말해줘',
    '언제',
  ]),
  remaining: new Set([
    'how',
    'much',
    'left',
    'remaining',
    'amount',
    '잔량',
    '남은',
    '남아',
    '남았어',
    '남았니',
    '남았나요',
    '얼마',
    '얼마나',
    '알려',
    '알려줘',
    '말해',
    '말해줘',
  ]),
  disposal: new Set([
    'dispose',
    'disposal',
    'discard',
    'throw',
    'away',
    'trash',
    'how',
    '폐기',
    '버려',
    '버리',
    '처리',
    '방법',
    '어떻게',
    '알려',
    '알려줘',
    '말해',
    '말해줘',
  ]),
}

function stripKoreanParticle(token: string): string {
  return token.replace(/(은|는|이|가|을|를|에|의|도|만|와|과|랑|이나|나)$/u, '')
}

function normalizeToken(token: string): string {
  return stripKoreanParticle(token.trim())
}

function buildStopWordSet(intent?: VoiceAgentIntent): Set<string> {
  const stopWords = new Set(GENERIC_EDGE_STOP_WORDS)

  if (intent) {
    for (const token of INTENT_EDGE_STOP_WORDS[intent]) {
      stopWords.add(token)
    }
  }

  return stopWords
}

export function sanitizeVoiceReagentQuery(
  value?: string | null,
  intent?: VoiceAgentIntent,
): string {
  const normalized = normalizeVoiceLookupText(value)
  if (!normalized) {
    return ''
  }

  const tokens = normalized
    .split(' ')
    .map(normalizeToken)
    .filter(Boolean)

  if (tokens.length === 0) {
    return ''
  }

  const stopWords = buildStopWordSet(intent)

  let start = 0
  let end = tokens.length - 1

  while (start <= end && stopWords.has(tokens[start])) {
    start += 1
  }

  while (end >= start && stopWords.has(tokens[end])) {
    end -= 1
  }

  const trimmed = tokens.slice(start, end + 1)
  if (trimmed.length > 0) {
    return trimmed.join(' ')
  }

  const fallback = tokens.filter((token) => !stopWords.has(token))
  return fallback.join(' ') || normalized
}

export function buildVoiceLookupVariants(params: {
  rawInput?: string | null
  reagentQuery?: string | null
  queryAliases?: Array<string | null | undefined>
  intent?: VoiceAgentIntent
  limit?: number
}): string[] {
  const sanitizedValues = dedupeAliasTerms([
    sanitizeVoiceReagentQuery(params.reagentQuery, params.intent),
    ...(params.queryAliases || []).map((value) => sanitizeVoiceReagentQuery(value, params.intent)),
    sanitizeVoiceReagentQuery(params.rawInput, params.intent),
  ])

  if (sanitizedValues.length > 0) {
    return typeof params.limit === 'number'
      ? sanitizedValues.slice(0, params.limit)
      : sanitizedValues
  }

  return dedupeAliasTerms(
    [
      params.reagentQuery,
      ...(params.queryAliases || []),
      params.rawInput,
    ],
    params.limit,
  )
}
