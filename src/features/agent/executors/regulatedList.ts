import type { InventoryItem } from '../../../services/inventoryService'
import { normalizeCasNumber } from '../../../utils/casNumber'
import { hazardousRegulationEntries, type ChemicalRegulationLookup } from '../../../utils/chemicalRegulations'
import {
  REGULATION_OBLIGATION_RULES,
  obligationsForEntries,
  type RegulationObligation,
} from '../../../utils/regulationObligations'
import type { AgentRegulatedSubstance, AgentResult } from '../agentResults'

export const AGENT_REGULATED_LIMIT = 12

/** CAS numbers of the records, each once, for the regulation lookup. */
export function distinctCasNumbers(items: readonly InventoryItem[]): string[] {
  return [...new Set(items
    .map((item) => normalizeCasNumber(item.cas_number))
    .filter((cas): cas is string => Boolean(cas)))]
}

/**
 * Substances the lab holds that 화학물질관리법 classifies, with the duties those
 * classes bring. Records without a CAS number and lookups without an answer
 * are counted, because silence about them would read as "not regulated".
 */
export function runRegulatedList(
  items: InventoryItem[],
  lookups: ReadonlyMap<string, ChemicalRegulationLookup>,
): AgentResult {
  const itemsByCas = new Map<string, InventoryItem[]>()
  let withoutCasCount = 0
  for (const item of items) {
    const cas = normalizeCasNumber(item.cas_number)
    if (!cas) {
      withoutCasCount += 1
      continue
    }
    const group = itemsByCas.get(cas)
    if (group) group.push(item)
    else itemsByCas.set(cas, [item])
  }

  const substances: AgentRegulatedSubstance[] = []
  const obligations = new Map<string, RegulationObligation>()
  let unresolvedCount = 0
  for (const [casNumber, group] of itemsByCas) {
    const lookup = lookups.get(casNumber)
    if (!lookup || lookup.status === 'unavailable') {
      unresolvedCount += 1
      continue
    }
    if (lookup.status !== 'found') continue
    const entries = hazardousRegulationEntries(lookup.record)
    if (entries.length === 0) continue

    substances.push({
      casNumber,
      name: lookup.record.nameKo?.trim() || group[0].name,
      classes: [...new Set(entries.map((entry) => entry.typeName))],
      itemCount: group.length,
    })
    for (const obligation of obligationsForEntries(lookup.record.entries)) {
      if (!obligations.has(obligation.id)) obligations.set(obligation.id, obligation)
    }
  }

  substances.sort((left, right) => right.itemCount - left.itemCount || left.name.localeCompare(right.name, 'ko'))
  return {
    type: 'regulated_list',
    substances: substances.slice(0, AGENT_REGULATED_LIMIT),
    total: substances.length,
    // Table order, so the list reads the same way as the reagent detail card.
    obligations: REGULATION_OBLIGATION_RULES
      .map((rule) => obligations.get(rule.id))
      .filter((obligation): obligation is RegulationObligation => Boolean(obligation)),
    withoutCasCount,
    unresolvedCount,
    inventoryCount: items.length,
  }
}
