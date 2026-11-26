import type { InventoryItem } from '../../services/inventoryService'
import { normalizeCasNumber } from '../../utils/casNumber'
import { normalizeCompactToken } from '../../utils/voiceAgent'
import type { AgentItemRef } from './agentContract'

/**
 * Matches the reagent a person named against the lab's own records.
 *
 * Nothing here picks "the" item on the person's behalf: every record in the
 * best-scoring tier is returned, because several bottles of one reagent are
 * normal and all of them answer "where is it".
 */
export type AgentItemMatchReason =
  | 'cas'
  | 'name_exact'
  | 'product_exact'
  | 'alias_exact'
  | 'prefix'
  | 'contains'
  | 'alias_contains'

export interface AgentItemMatch {
  item: InventoryItem
  reason: AgentItemMatchReason
  score: number
}

export interface AgentItemMatchResult {
  /** Best tier only, best first, at most AGENT_ITEM_MATCH_LIMIT entries. */
  matches: AgentItemMatch[]
  /** Size of the best tier before the limit was applied. */
  totalInTier: number
  /** True when no record matched the typed name and only a suggested alias did. */
  aliasOnly: boolean
}

export const AGENT_ITEM_MATCH_LIMIT = 8
/** Records scoring this close to the best one belong to the same answer. */
const TIER_WINDOW = 15
const MIN_PARTIAL_LENGTH = 2
const MIN_ALIAS_PARTIAL_LENGTH = 3

const SCORES: Record<AgentItemMatchReason, number> = {
  cas: 100,
  name_exact: 95,
  product_exact: 90,
  alias_exact: 80,
  prefix: 70,
  contains: 55,
  alias_contains: 45,
}

const ALIAS_REASONS = new Set<AgentItemMatchReason>(['alias_exact', 'alias_contains'])

/** "아세톤 (Acetone)" is stored as one name; either part alone is an exact match. */
function nameSegments(name: string): string[] {
  return name
    .split(/[()[\]{},/]/)
    .map((segment) => normalizeCompactToken(segment))
    .filter(Boolean)
}

function scoreItem(
  item: InventoryItem,
  query: string,
  aliases: string[],
  casNumber: string | null,
): AgentItemMatch | null {
  const reasons: AgentItemMatchReason[] = []

  if (casNumber && normalizeCasNumber(item.cas_number) === casNumber) reasons.push('cas')

  const name = normalizeCompactToken(item.name)
  const segments = nameSegments(item.name)
  if (query) {
    if (name === query || segments.includes(query)) reasons.push('name_exact')
    else if (query.length >= MIN_PARTIAL_LENGTH && name.startsWith(query)) reasons.push('prefix')
    else if (query.length >= MIN_PARTIAL_LENGTH && name.includes(query)) reasons.push('contains')

    const productNumber = normalizeCompactToken(item.product_number)
    if (productNumber && productNumber === query) reasons.push('product_exact')
  }

  for (const alias of aliases) {
    if (name === alias || segments.includes(alias)) reasons.push('alias_exact')
    else if (alias.length >= MIN_ALIAS_PARTIAL_LENGTH && name.includes(alias)) reasons.push('alias_contains')
  }

  if (reasons.length === 0) return null
  const reason = reasons.reduce((best, candidate) => (SCORES[candidate] > SCORES[best] ? candidate : best))
  return { item, reason, score: SCORES[reason] }
}

export function matchInventoryItems(items: InventoryItem[], ref: AgentItemRef): AgentItemMatchResult {
  const query = normalizeCompactToken(ref.text)
  const aliases = [...new Set(ref.aliases.map((alias) => normalizeCompactToken(alias)))]
    .filter((alias) => alias && alias !== query)
  const casNumber = normalizeCasNumber(ref.casNumber)

  const scored = items
    .map((item) => scoreItem(item, query, aliases, casNumber))
    .filter((match): match is AgentItemMatch => match !== null)
  if (scored.length === 0) return { matches: [], totalInTier: 0, aliasOnly: false }

  const bestScore = Math.max(...scored.map((match) => match.score))
  const tier = scored
    .filter((match) => match.score >= bestScore - TIER_WINDOW)
    .sort((left, right) => right.score - left.score
      || left.item.name.localeCompare(right.item.name)
      || right.item.created_at.localeCompare(left.item.created_at))

  return {
    matches: tier.slice(0, AGENT_ITEM_MATCH_LIMIT),
    totalInTier: tier.length,
    aliasOnly: tier.every((match) => ALIAS_REASONS.has(match.reason)),
  }
}
