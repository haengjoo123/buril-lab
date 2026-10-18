import { normalizeCasNumber } from '../utils/casNumber'
import type { ChemicalRegulationLookup } from '../utils/chemicalRegulations'
import { getJson } from './internalApi'

const UNAVAILABLE: ChemicalRegulationLookup = { status: 'unavailable' }

// One request per CAS per session; failures are dropped so a later view retries.
const lookups = new Map<string, Promise<ChemicalRegulationLookup>>()

export function fetchChemicalRegulations(rawCasNumber: string): Promise<ChemicalRegulationLookup> {
  const casNumber = normalizeCasNumber(rawCasNumber)
  if (!casNumber) return Promise.resolve({ status: 'not_found' })

  const existing = lookups.get(casNumber)
  if (existing) return existing

  const request = getJson<ChemicalRegulationLookup>(
    `/api/chemicals/regulations?cas=${encodeURIComponent(casNumber)}`,
    { cache: 'no-store' },
  )
    .then((lookup) => {
      if (lookup.status === 'unavailable') lookups.delete(casNumber)
      return lookup
    })
    .catch(() => {
      lookups.delete(casNumber)
      return UNAVAILABLE
    })
  lookups.set(casNumber, request)
  return request
}
