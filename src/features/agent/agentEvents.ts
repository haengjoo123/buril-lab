import { normalizeCasNumber } from '../../utils/casNumber'
import { AGENT_MAX_TEXT_LENGTH, type AgentLanguage } from './agentContract'
import type { AgentErrorKind, AgentResult, AgentUiAction } from './agentResults'

/**
 * What is recorded about one finished agent request, to judge the feature by
 * what people actually ask. The typed sentence goes along only when the agent
 * could not handle the request; the database enforces that as well.
 */
export type AgentEventRoute = 'planner' | 'rule'

export type AgentEventOutcome =
  /** A card with something in it. */
  | 'answered'
  /** A card that found nothing to show. */
  | 'empty'
  /** The named reagent is not in the records. */
  | 'no_match'
  | 'navigated'
  | 'handoff_search'
  | 'disposal_card'
  /** A proposal to record something was shown; nothing was saved yet. */
  | 'proposed'
  /** The person confirmed a proposal and it was saved. Recorded as its own event. */
  | 'confirmed'
  /** The screen or feature exists but is closed to this person. */
  | 'unavailable'
  | 'unsupported'
  | 'error'

export interface AgentQueryEvent {
  requestId: string
  labId: string | null
  route: AgentEventRoute
  /** The plan kind, or `identifier` / `planner` when no plan was made. */
  kind: string
  outcome: AgentEventOutcome
  reason: string | null
  latencyMs: number | null
  language: AgentLanguage
  failedText: string | null
}

/** Outcomes after which the sentence is worth keeping: they show what the agent could not do. */
const UNHANDLED_OUTCOMES = new Set<AgentEventOutcome>(['unsupported', 'no_match'])

export function isUnhandledOutcome(outcome: AgentEventOutcome): boolean {
  return UNHANDLED_OUTCOMES.has(outcome)
}

const found = (count: number): AgentEventOutcome => (count > 0 ? 'answered' : 'empty')

export function outcomeOfResult(result: AgentResult): { outcome: AgentEventOutcome; reason: string | null } {
  switch (result.type) {
    case 'item_matches':
      return { outcome: 'answered', reason: result.aliasOnly ? 'alias_only' : null }
    case 'item_no_match':
      return { outcome: 'no_match', reason: result.inventoryIsEmpty ? 'inventory_empty' : null }
    case 'expiry_list':
      return { outcome: found(result.total), reason: result.inventoryCount === 0 ? 'inventory_empty' : null }
    case 'low_stock':
      return { outcome: found(result.total), reason: result.inventoryCount === 0 ? 'inventory_empty' : null }
    case 'regulated_list':
      return { outcome: found(result.total), reason: result.inventoryCount === 0 ? 'inventory_empty' : null }
    case 'cabinet_locks':
      return { outcome: found(result.unlocked.length + result.unset.length), reason: null }
    case 'inspection_gaps':
      // "Nothing was missed" is an answer too.
      return { outcome: 'answered', reason: null }
    case 'purchase_status':
      return { outcome: found(result.requested + result.approved + result.ordered), reason: null }
    case 'admin_tasks':
      return { outcome: found(result.total), reason: result.failedSourceCount > 0 ? 'partial' : null }
    case 'container_status':
      return { outcome: found(result.containers.length), reason: null }
    case 'waste_summary':
      return { outcome: found(result.logCount), reason: result.truncated ? 'partial' : null }
    case 'usage_proposal':
      return { outcome: 'proposed', reason: result.items.length > 1 ? 'needs_choice' : null }
    case 'register_proposal':
      return { outcome: 'proposed', reason: null }
    case 'purchase_proposal':
      return { outcome: 'proposed', reason: null }
    case 'pickup_proposal':
      return { outcome: result.containers.length > 0 ? 'proposed' : 'empty', reason: null }
    case 'waste_batch_proposal': {
      // Waste wording is never stored, so nothing found is "empty" rather than "no_match".
      const found = result.components.filter((row) => row.lookup.status === 'found').length
      const open = result.components.some((row) => row.lookup.status === 'choose_form')
      return {
        outcome: found > 0 || open ? 'proposed' : 'empty',
        reason: open ? 'needs_choice' : found < result.components.length ? 'partial' : null,
      }
    }
    case 'disposal_redirect':
      return { outcome: 'disposal_card', reason: null }
    case 'screen_unavailable':
      return { outcome: 'unavailable', reason: result.reason }
    case 'unsupported':
      return { outcome: 'unsupported', reason: result.reason }
  }
}

export function outcomeOfUiAction(action: AgentUiAction): { outcome: AgentEventOutcome; reason: string | null } {
  return { outcome: action.type === 'search_chemical' ? 'handoff_search' : 'navigated', reason: null }
}

export function outcomeOfError(error: AgentErrorKind): { outcome: AgentEventOutcome; reason: string | null } {
  return { outcome: 'error', reason: error }
}

/**
 * Hides contact details and secrets someone may have typed by accident, with
 * the patterns submitted search queries are masked with (sanitizeSearchQuery
 * in functions/api/analytics/_shared.ts). Valid CAS numbers are kept: they are
 * what the request was about.
 */
export function maskFailedAgentText(input: string): string {
  const casNumbers: string[] = []
  let value = Array.from(input.normalize('NFKC'), (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? ' ' : character
  }).join('')
  value = value.replace(/\b[1-9]\d{1,6}-\d{2}-\d\b/g, (candidate) => {
    const cas = normalizeCasNumber(candidate)
    if (!cas) return candidate
    return `BURILCAS${casNumbers.push(cas) - 1}PLACEHOLDER`
  })
  value = value
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[URL]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, '[TOKEN]')
    // Before phone numbers: a key with a long run of digits would otherwise lose only that run.
    .replace(/\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g, '[TOKEN]')
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, '[PHONE]')
    .replace(/\s+/g, ' ')
    .trim()
  casNumbers.forEach((cas, index) => {
    value = value.replace(`BURILCAS${index}PLACEHOLDER`, cas)
  })
  return Array.from(value).slice(0, AGENT_MAX_TEXT_LENGTH).join('')
}

export function buildAgentQueryEvent(input: {
  requestId: string
  labId: string | null
  route: AgentEventRoute
  kind: string
  language: AgentLanguage
  latencyMs: number
  text: string
  outcome: AgentEventOutcome
  reason: string | null
}): AgentQueryEvent {
  const failedText = isUnhandledOutcome(input.outcome) ? maskFailedAgentText(input.text) || null : null
  return {
    requestId: input.requestId,
    labId: input.labId,
    route: input.route,
    kind: input.kind,
    outcome: input.outcome,
    reason: input.reason,
    latencyMs: Math.min(600_000, Math.max(0, Math.round(input.latencyMs))),
    language: input.language,
    failedText,
  }
}
