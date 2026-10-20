import type { DisposalCategory, WasteComponent } from '../types'
import { analyzeChemical } from './chemicalAnalyzer'
import { fatalToxicityDilutionLimit, type FatalToxicityDilutionLimit } from './fatalToxicityDilutionLimits'
import { regulationConcentrationForComponent } from './wasteComponentRegulation'

/**
 * Whether a component held by the fatal acute-toxicity rule is a solution
 * diluted below its legal limit (see fatalToxicityDilutionLimits.ts).
 */
export type FatalToxicityDilution =
  /** The component is not held by the fatal acute-toxicity rule. */
  | { status: 'not_applicable' }
  /** Held, and no vetted legal limit exists: stays held at any concentration. */
  | { status: 'no_limit' }
  /** Neat product or solid: judged as supplied and stays held. */
  | { status: 'not_solution'; limit: FatalToxicityDilutionLimit }
  /** A solution without a usable concentration stays held. */
  | { status: 'concentration_unknown'; limit: FatalToxicityDilutionLimit }
  | { status: 'at_or_above'; limit: FatalToxicityDilutionLimit; percent: number }
  | { status: 'below'; limit: FatalToxicityDilutionLimit; percent: number }

const isHeldForFatalToxicity = (component: WasteComponent): boolean =>
  component.category === 'SPECIAL_HAZARD' && component.reason === 'reason_fatal_acute_toxicity'

export function assessFatalToxicityDilution(component: WasteComponent): FatalToxicityDilution {
  if (!isHeldForFatalToxicity(component)) return { status: 'not_applicable' }
  const limit = fatalToxicityDilutionLimit(component.chemical.casNumber)
  if (!limit) return { status: 'no_limit' }
  if ((component.materialForm ?? 'solution') !== 'solution') return { status: 'not_solution', limit }
  const concentration = regulationConcentrationForComponent(component)
  if (!concentration) return { status: 'concentration_unknown', limit }
  return concentration.percent < limit.percent
    ? { status: 'below', limit, percent: concentration.percent }
    : { status: 'at_or_above', limit, percent: concentration.percent }
}

/** The category a below-limit solution would be routed by, ignoring only the fatal-toxicity precedence. */
export function dilutedCategory(component: WasteComponent): DisposalCategory {
  // analyzeChemical reassigns `properties`; the shallow copy keeps the component untouched.
  return analyzeChemical({ ...component.chemical }, { ignoreFatalAcuteToxicity: true }).category
}

/**
 * The category the batch is routed by. A solution proven below its legal
 * limit is classified without the fatal-toxicity precedence, so reactive,
 * cyanide, heavy-metal, acid and solvent rules decide it as usual. Anything
 * that would then be unresolved keeps the special-review hold.
 */
export function concentrationAwareCategory(component: WasteComponent): DisposalCategory {
  if (assessFatalToxicityDilution(component).status !== 'below') return component.category
  const category = dilutedCategory(component)
  return category === 'UNKNOWN' ? component.category : category
}
