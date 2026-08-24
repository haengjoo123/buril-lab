import i18n from '../locales/i18n'
import { isChemicalEnrichmentEnabled } from '../config/featureFlags'
import type { Chemical } from '../types'
import { hasCasNumberFormat, normalizeCasNumber } from '../utils/casNumber'
import { chemicalFromEnrichment, enrichChemical } from './chemicalEnrichmentService'
import { fetchChemicalInfoLegacy } from './pubchemApi'
import { ChemicalSearchError, isChemicalSearchError } from './chemicalSearchError'

export { ChemicalSearchError, isChemicalSearchError } from './chemicalSearchError'

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

  if (!isChemicalEnrichmentEnabled) {
    try {
      return await fetchChemicalInfoLegacy(trimmedQuery, { throwOnUnavailable: true })
    } catch (error) {
      throw new ChemicalSearchError(
        'temporary_unavailable',
        'Legacy chemical lookup is temporarily unavailable.',
        { cause: error },
      )
    }
  }

  try {
    const enrichment = await enrichChemical({
      requestId: `search:${trimmedQuery}`,
      ...(casNumber ? { casNumber } : { name: trimmedQuery }),
    })
    if (enrichment.identity.status === 'not_found') return null

    const chemical = chemicalFromEnrichment(enrichment)
    if (!chemical) {
      if (enrichment.overallStatus === 'retryable') {
        throw new ChemicalSearchError(
          'temporary_unavailable',
          'Chemical identity lookup is temporarily unavailable.',
        )
      }
      throw new ChemicalSearchError(
        'invalid_response',
        'Chemical lookup returned an incomplete identity.',
        { retryable: false },
      )
    }
    return {
      ...chemical,
      name: localizedDisplayName(chemical, enrichment.identity.localizedName),
    }
  } catch (error) {
    if (isChemicalSearchError(error)) throw error
    if (import.meta.env.DEV) console.warn('[Chemical search] Unified enrichment failed:', error)
    throw new ChemicalSearchError(
      'temporary_unavailable',
      'Chemical lookup could not reach the enrichment service.',
      { cause: error },
    )
  }
}
