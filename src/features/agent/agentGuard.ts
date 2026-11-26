import { hasCasNumberFormat } from '../../utils/casNumber'
import { parseWasteComponents, type ParsedWasteComponent } from './parseWasteComponents'

/**
 * Fixed rules that decide where a typed request goes before any model call.
 *
 * Imported by Pages Functions as well, so keep it free of browser imports.
 */

/**
 * Wording about disposal, mixing, dilution, neutralisation, drains or putting
 * something into a container. Such text is never sent to a model.
 *
 * A copy of DISPOSAL_SAFETY_PATTERNS in functions/api/voice/query.ts, so that
 * the app can decide without a network call and the agent endpoint does not
 * depend on the voice handler. agentGuard.test.ts reads both files and fails
 * when a voice pattern is missing here or the two rules disagree.
 */
const DISPOSAL_WORDING_PATTERNS = [
  /폐(?:기|액|시약)|버리|처리(?:법|방법|해|하)|혼합|섞|희석|묽게|중화|배수구|싱크대?|하수|폐액통|폐기통/i,
  /용기.{0,16}(?:넣|투입|붓|부어|담)|(?:넣|투입|붓|부어|담).{0,16}용기/i,
  /\b(?:dispose|disposal|discard|trash|waste|throw(?:\s+\w+){0,4}\s+away|mix|mixing|combine|dilute|dilution|neutralize|neutralise|neutralization|neutralisation|drain|sink|sewer|pour|deposit)\b/i,
  /\b(?:put|add|transfer)\b.{0,32}\b(?:container|bottle|drum)\b|\b(?:container|bottle|drum)\b.{0,32}\b(?:put|add|transfer|pour)\b/i,
  /버려|버릴|버렸|버림|부어도|부으면|쏟아|흘려|폐(?:수|유|산|용매|알칼리)/,
  /\b(?:dispos(?:es|ed|ing)|discard(?:s|ed|ing)|dilut(?:es|ed|ing)|neutrali[sz](?:es|ed|ing)|pour(?:s|ed|ing)|throw(?:s|ing)?\s+(?:\w+\s+){0,4}out)\b/i,
]

export function hasDisposalWording(input: string): boolean {
  const normalized = input.normalize('NFKC').toLowerCase()
  return DISPOSAL_WORDING_PATTERNS.some((pattern) => pattern.test(normalized))
}

/**
 * Words that mark a question or command. Chemical names are often several
 * words long, so a word count cannot tell a name from a sentence; a cue can.
 */
const KOREAN_SENTENCE_CUE = /[?？]|어디|얼마|언제|어떻게|어떤|무엇|뭐|몇\s?(?:개|병|통)|알려|보여|찾아|열어|해\s?줘|줘$|있어|있나|있니|있는|남았|남은|목록|리스트|현황|화면|유통기한|유효기한|만료|임박|잔량|위치|지난|부족/
const ENGLISH_SENTENCE_CUE = /\b(?:where|when|which|what|how\s+(?:much|many|long)|show|list|find|open|go\s+to|expired?|expiring|expiry|expiration|remaining|left|location|located|running\s+(?:low|out)|please)\b/i

export type AgentInputKind = 'empty' | 'identifier' | 'sentence' | 'unclear'

/**
 * identifier: a CAS number, or one word without a cue (a name or product number).
 * sentence:   carries a question or command cue.
 * unclear:    several words without a cue, e.g. a multi-word chemical name.
 */
export function classifyAgentInput(input: string): AgentInputKind {
  const text = input.normalize('NFKC').trim()
  if (!text) return 'empty'
  if (hasCasNumberFormat(text)) return 'identifier'
  if (KOREAN_SENTENCE_CUE.test(text) || ENGLISH_SENTENCE_CUE.test(text)) return 'sentence'
  return /\s/.test(text) ? 'unclear' : 'identifier'
}

export type AgentWastePeriod = 'today' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'last_30d'

/**
 * Requests about waste records that fixed rules can decide from the lab's own
 * data. They never tell anyone how to dispose of anything.
 */
export type AgentWasteIntent =
  | { kind: 'container_status' }
  | { kind: 'waste_summary'; period: AgentWastePeriod }
  /** Asking for a container to be collected. Shown as a proposal; nothing is sent until confirmed. */
  | { kind: 'pickup_request' }
  /**
   * Components written with their amounts. They are looked up by name and
   * offered for the waste batch review, where the rule engine does the judging.
   */
  | { kind: 'waste_batch'; components: ParsedWasteComponent[] }

/**
 * Asking how to dispose of, mix or pour something. Such text gets the fixed
 * disposal card, never a records answer or a proposal.
 */
const WASTE_HANDLING_PATTERN = /부어|붓|넣|투입|담아|버려|버리|버릴|버렸|섞|혼합|희석|묽게|중화|배수구|싱크|하수|쏟|흘려|어떻게|방법|해도|되나|될까|돼\?|\b(?:pour\w*|put|add|mix\w*|combine|dilut\w*|neutrali\w*|drain|sink|sewer|discard\w*|throw\w*|how\s+(?:do|to|should|can)|can\s+i|should\s+i)\b/i
/** Asking for something to be done. Only a pickup request is one the app can propose. */
const WASTE_ACTION_REQUEST_PATTERN = /요청\s?해|신청/
const WASTE_PICKUP_CUE = /수거|회수|픽업|\b(?:pick\s?-?up|collect(?:ion|ed)?)\b/i
const WASTE_PICKUP_REQUEST_CUE = /요청|신청|불러|\b(?:request|schedule|arrange|call)\b/i
const WASTE_RECORD_NOUN = /(?:폐기|폐액)\s?(?:기록|내역|이력|량|통계|요약)|\bwaste\s+(?:logs?|records?|history|summary|volume)\b/i
const WASTE_CONTAINER_NOUN = /폐액통|폐기통|\bwaste\s+(?:containers?|bottles?|drums?)\b/i
const WASTE_CONTAINER_STATUS_CUE = /현황|상태|얼마|찼|목록|리스트|보여|알려|몇|\b(?:status|how\s+full|list|show)\b/i

const WASTE_PERIOD_PATTERNS: ReadonlyArray<[RegExp, AgentWastePeriod]> = [
  [/오늘|\btoday\b/i, 'today'],
  [/이번\s?주|금주|\bthis\s+week\b/i, 'this_week'],
  [/지난\s?주|저번\s?주|\blast\s+week\b/i, 'last_week'],
  [/이번\s?달|이달|금월|\bthis\s+month\b/i, 'this_month'],
  [/지난\s?달|저번\s?달|전월|\blast\s+month\b/i, 'last_month'],
]

/** What waste wording asks of the lab's records, or null when it asks for guidance or another action. */
export function parseWasteIntent(input: string): AgentWasteIntent | null {
  const text = input.normalize('NFKC')
  // A list of components with amounts describes a batch, whatever else the sentence asks.
  // It leads to the review screen, which is also where every disposal question ends up.
  if (!WASTE_RECORD_NOUN.test(text)) {
    const components = parseWasteComponents(text)
    if (components.length > 0) return { kind: 'waste_batch', components }
  }
  if (WASTE_HANDLING_PATTERN.test(text)) return null
  const namesContainer = WASTE_CONTAINER_NOUN.test(text)
  // "수거 요청 현황" asks how requests stand; it is answered by the container list below.
  if (namesContainer && WASTE_PICKUP_CUE.test(text) && WASTE_PICKUP_REQUEST_CUE.test(text)
    && !WASTE_CONTAINER_STATUS_CUE.test(text)) {
    return { kind: 'pickup_request' }
  }
  if (WASTE_ACTION_REQUEST_PATTERN.test(text)) return null
  if (WASTE_RECORD_NOUN.test(text)) {
    const period = WASTE_PERIOD_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] ?? 'last_30d'
    return { kind: 'waste_summary', period }
  }
  if (namesContainer && WASTE_CONTAINER_STATUS_CUE.test(text)) return { kind: 'container_status' }
  return null
}

export type AgentLocalRoute =
  | { kind: 'empty' }
  /** Waste wording that asks for guidance: answered by the fixed card, never by a model. */
  | { kind: 'disposal' }
  /** Waste wording about records or a pickup: decided by fixed rules from the lab's data. */
  | { kind: 'waste'; intent: AgentWasteIntent }
  /** A plain name or CAS number: the normal search answers it better. */
  | { kind: 'identifier'; query: string }
  | { kind: 'planner' }

export function routeAgentInputLocally(input: string): AgentLocalRoute {
  const text = input.trim()
  if (!text) return { kind: 'empty' }
  if (hasDisposalWording(text)) {
    const intent = parseWasteIntent(text)
    return intent ? { kind: 'waste', intent } : { kind: 'disposal' }
  }
  if (classifyAgentInput(text) === 'identifier') return { kind: 'identifier', query: text }
  return { kind: 'planner' }
}

/** Normal search mode offers agent mode only for text that is clearly a sentence. */
export function shouldSuggestAgentMode(input: string): boolean {
  return classifyAgentInput(input) === 'sentence'
}
