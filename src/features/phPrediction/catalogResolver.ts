import type { ChemicalPhCatalogMatch, PhCatalogMatchedBy } from '../../types'
import { formulaCompositionKey } from '../../utils/chemicalFormula'
import { DEFAULT_PH_CATALOG, PH_CATALOG_BY_ID } from './catalog'
import type { PhCatalogRecord } from './catalogTypes'

export interface PhCatalogIdentityInput {
  standardInchiKey?: string
  casNumber?: string
  pubchemCid?: number
  equivalentPubchemCids?: readonly number[]
  molecularFormula?: string
  currentPhCatalogId?: string
}

function recordsByExactIdentity(
  input: PhCatalogIdentityInput,
  matchedBy: PhCatalogMatchedBy,
): PhCatalogRecord[] {
  if (matchedBy === 'inchi_key') {
    const key = input.standardInchiKey?.trim().toUpperCase()
    if (!key) return []
    return DEFAULT_PH_CATALOG.records.filter((record) => (
      record.structureIdentity.kind === 'pubchem'
      && record.structureIdentity.standardInchiKey.toUpperCase() === key
    ))
  }

  if (matchedBy === 'cas') {
    const cas = input.casNumber?.trim()
    if (!cas) return []
    return DEFAULT_PH_CATALOG.records.filter((record) => record.casNumber === cas)
  }

  const cids = new Set([
    ...(input.pubchemCid ? [input.pubchemCid] : []),
    ...(input.equivalentPubchemCids ?? []),
  ])
  if (cids.size === 0) return []
  return DEFAULT_PH_CATALOG.records.filter((record) => (
    record.structureIdentity.kind === 'pubchem'
    && cids.has(record.structureIdentity.pubchemCid)
  ))
}

function currentSelectionConflicts(input: PhCatalogIdentityInput, candidates: readonly PhCatalogRecord[]): boolean {
  if (!input.currentPhCatalogId) return false
  if (!PH_CATALOG_BY_ID.has(input.currentPhCatalogId)) return true
  return !candidates.some((record) => record.id === input.currentPhCatalogId)
}

export function resolvePhCatalogIdentity(input: PhCatalogIdentityInput): ChemicalPhCatalogMatch {
  const catalogVersion = DEFAULT_PH_CATALOG.version

  for (const matchedBy of ['inchi_key', 'cas', 'pubchem_cid'] as const) {
    const matches = recordsByExactIdentity(input, matchedBy)
    if (matches.length === 0) continue

    const candidateIds = Array.from(new Set(matches.map((record) => record.id)))
    if (currentSelectionConflicts(input, matches)) {
      return {
        status: 'ambiguous', candidateIds, matchedBy, catalogVersion, selection: 'none',
      }
    }

    if (candidateIds.length === 1) {
      return {
        status: 'matched',
        id: input.currentPhCatalogId || candidateIds[0],
        candidateIds,
        matchedBy,
        catalogVersion,
        selection: input.currentPhCatalogId ? 'manual' : 'automatic',
      }
    }

    return {
      status: 'ambiguous', candidateIds, matchedBy, catalogVersion, selection: 'none',
    }
  }

  const formulaKey = formulaCompositionKey(input.molecularFormula)
  const candidateIds = formulaKey
    ? DEFAULT_PH_CATALOG.records
      .filter((record) => formulaCompositionKey(record.formula) === formulaKey)
      .map((record) => record.id)
    : []

  return {
    status: candidateIds.length > 0 ? 'ambiguous' : 'unmatched',
    candidateIds,
    catalogVersion,
    selection: 'none',
  }
}
