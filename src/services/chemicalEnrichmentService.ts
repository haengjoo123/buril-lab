import { isChemicalEnrichmentEnabled } from '../config/featureFlags'
import type {
  Chemical,
  ChemicalEnrichmentProfile,
  ChemicalEnrichmentRequestItem,
  ChemicalEnrichmentResult,
} from '../types'
import { postJson } from './internalApi'

interface EnrichmentApiResponse {
  results?: ChemicalEnrichmentResult[]
}

let hasPurgedLegacyCache = false

function purgeLegacyClientCache(): void {
  if (hasPurgedLegacyCache || typeof window === 'undefined') return
  hasPurgedLegacyCache = true
  try {
    const removals: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith('buril:pubchem-ghs:v1:') || key?.startsWith('buril:pubchem-ghs:v2:')) removals.push(key)
    }
    removals.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // Storage can be unavailable in privacy modes; the server cache remains authoritative.
  }
}

export async function enrichChemicals(
  items: ChemicalEnrichmentRequestItem[],
  options?: {
    labId?: string | null
    profile?: ChemicalEnrichmentProfile
    signal?: AbortSignal
  },
): Promise<ChemicalEnrichmentResult[]> {
  if (!isChemicalEnrichmentEnabled) throw new Error('Chemical enrichment is disabled.')
  purgeLegacyClientCache()
  const response = await postJson<EnrichmentApiResponse>('/api/chemicals/enrich', {
    items,
    ...(options?.profile ? { profile: options.profile } : {}),
    ...(options?.labId ? { scope: { labId: options.labId } } : {}),
  }, { signal: options?.signal })
  if (!Array.isArray(response.results) || response.results.length !== items.length) {
    throw new Error('Chemical enrichment returned an incomplete result set.')
  }
  return response.results
}

export async function enrichChemical(
  item: ChemicalEnrichmentRequestItem,
  options?: { labId?: string | null },
): Promise<ChemicalEnrichmentResult> {
  const [result] = await enrichChemicals([item], options)
  if (!result) throw new Error('Chemical enrichment returned no result.')
  return result
}

export function chemicalFromEnrichment(
  result: ChemicalEnrichmentResult,
  fallback?: Partial<Chemical>,
): Chemical | null {
  if (result.identity.status === 'not_found' || !result.identity.pubchemCid) return null
  const name = result.identity.canonicalName || fallback?.name
  const molecularFormula = result.identity.molecularFormula || fallback?.molecularFormula
  if (!name || !molecularFormula) return null

  const ghs = result.hazard.status === 'classified'
    ? {
        signal: result.hazard.signalWord || '',
        hazardStatements: result.hazard.hazardStatements.length > 0
          ? result.hazard.hazardStatements
          : result.hazard.hCodes,
        pictograms: result.hazard.pictograms,
      }
    : undefined

  const fallbackProperties = fallback?.properties || {
    isOrganic: molecularFormula.includes('C'),
    isHalogenated: false,
  }
  const referencePh = result.referencePh.status === 'available'
    ? result.referencePh.value
    : fallbackProperties.referencePh ?? fallbackProperties.ph
  const properties = {
    ...fallbackProperties,
    ...(referencePh !== undefined ? { referencePh } : {}),
    ...(result.referencePh.status === 'available' ? { phSource: 'kosha_reference' as const } : {}),
  }

  return {
    id: String(result.identity.pubchemCid),
    name,
    casNumber: result.identity.casNumber || fallback?.casNumber || '',
    molecularFormula,
    molecularWeight: result.identity.molecularWeight || fallback?.molecularWeight,
    connectivitySmiles: result.identity.connectivitySmiles || fallback?.connectivitySmiles,
    externalIdentifiers: {
      pubchemCid: result.identity.pubchemCid,
      equivalentPubchemCids: result.identity.equivalentPubchemCids,
      standardInchiKey: result.identity.standardInchiKey,
      alternateCasNumbers: result.identity.alternateCasNumbers,
    },
    hazardLookup: {
      ...result.hazard,
      algorithmVersion: result.enrichmentVersion,
    },
    referencePhLookup: result.referencePh,
    properties,
    physicalProperties: fallback?.physicalProperties,
    ...(ghs ? { ghs } : {}),
    koshaId: result.identity.koshaChemId || fallback?.koshaId,
  }
}
