import i18n from '../locales/i18n'
import type { Chemical } from '../types'
import { hasCasNumberFormat, normalizeCasNumber } from '../utils/casNumber'
import { chemicalFromEnrichment, enrichChemical } from './chemicalEnrichmentService'

function localizedDisplayName(chemical: Chemical, localizedName?: string): string {
  if (!localizedName || !i18n.language.toLowerCase().startsWith('ko')) return chemical.name
  return localizedName === chemical.name ? chemical.name : `${localizedName} (${chemical.name})`
}

/**
 * Search identity, GHS, KOSHA reference pH, and pH-catalog metadata through
 * the single server enrichment boundary. The browser never calls upstream
 * PubChem, KOSHA, Wikipedia, or local synonym fallbacks from this path.
 */
export async function searchChemical(query: string): Promise<Chemical | null> {
  const trimmedQuery = query.normalize('NFKC').trim()
  if (!trimmedQuery) return null

  const casNumber = normalizeCasNumber(trimmedQuery)
  if (hasCasNumberFormat(trimmedQuery) && !casNumber) return null

  try {
    const enrichment = await enrichChemical({
      requestId: `search:${trimmedQuery}`,
      ...(casNumber ? { casNumber } : { name: trimmedQuery }),
    })
    const chemical = chemicalFromEnrichment(enrichment)
    if (!chemical) return null
    return {
      ...chemical,
      name: localizedDisplayName(chemical, enrichment.identity.localizedName),
    }
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[Chemical search] Unified enrichment failed:', error)
    return null
  }
}
