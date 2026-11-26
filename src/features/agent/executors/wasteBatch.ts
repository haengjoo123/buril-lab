import { analyzeChemical } from '../../../utils/chemicalAnalyzer'
import { hasCasNumberFormat, normalizeCasNumber } from '../../../utils/casNumber'
import type { AgentDataSources } from '../agentDataSources'
import type { AgentResult, AgentWasteComponentLookup, AgentWasteComponentRow } from '../agentResults'
import type { ParsedWasteComponent } from '../parseWasteComponents'

type WasteBatchSources = Pick<AgentDataSources, 'lookupChemical' | 'loadFormChoices'>

/**
 * Looks up one typed component the way the normal search does, and classifies
 * it with the app's rule engine only. No model is asked: a substance the rules
 * cannot place stays unplaced for the review screen to deal with.
 */
export async function lookupWasteComponent(
  typedName: string,
  sources: WasteBatchSources,
  options: { skipFormChoices?: boolean } = {},
): Promise<AgentWasteComponentLookup> {
  try {
    const typedCas = hasCasNumberFormat(typedName) ? normalizeCasNumber(typedName) : null
    // A name that fits several forms is a question for the person, never a default.
    if (!typedCas && !options.skipFormChoices) {
      const choices = await sources.loadFormChoices(typedName).catch(() => [])
      if (choices.length > 1) return { status: 'choose_form', choices }
    }
    const chemical = await sources.lookupChemical(typedName)
    if (!chemical) return { status: 'not_found' }
    return {
      status: 'found',
      analysis: analyzeChemical(chemical),
      verifiedByCas: Boolean(typedCas && normalizeCasNumber(chemical.casNumber) === typedCas),
    }
  } catch {
    return { status: 'failed' }
  }
}

/** Looks up every component read from the sentence. Nothing is added to the batch here. */
export async function runWasteBatchProposal(
  components: readonly ParsedWasteComponent[],
  sources: WasteBatchSources,
  labId: string | null,
): Promise<AgentResult> {
  const rows: AgentWasteComponentRow[] = await Promise.all(components.map(async (component, index) => ({
    key: `${index}:${component.name}`,
    typedName: component.name,
    amount: component.amount,
    lookup: await lookupWasteComponent(component.name, sources),
  })))
  return { type: 'waste_batch_proposal', components: rows, labId }
}
