import { normalizeCasNumber } from '../utils/casNumber'
import type { ReagentHandlingDraftLookup } from '../utils/reagentHandlingDraft'
import { getJson } from './internalApi'

const UNAVAILABLE: ReagentHandlingDraftLookup = { status: 'unavailable' }

// One request per identity per session; failures are dropped so a later view retries.
const lookups = new Map<string, Promise<ReagentHandlingDraftLookup>>()

/** Looks up by CAS when present; by name only when there is no CAS. */
export function fetchReagentHandlingDraft(
  rawCasNumber: string | null | undefined,
  rawName: string | null | undefined,
): Promise<ReagentHandlingDraftLookup> {
  const casNumber = rawCasNumber ? normalizeCasNumber(rawCasNumber) : null
  const name = (rawName || '').normalize('NFKC').trim()
  if (rawCasNumber?.trim() && !casNumber) return Promise.resolve({ status: 'not_found' })
  if (!casNumber && (name.length < 2 || name.length > 200)) return Promise.resolve({ status: 'not_found' })

  const key = casNumber ? `cas:${casNumber}` : `name:${name.toLocaleLowerCase('en-US')}`
  const existing = lookups.get(key)
  if (existing) return existing

  const query = casNumber ? `cas=${encodeURIComponent(casNumber)}` : `name=${encodeURIComponent(name)}`
  const request = getJson<ReagentHandlingDraftLookup>(`/api/reagents/handling-draft?${query}`, { cache: 'no-store' })
    .then((lookup) => {
      if (lookup.status === 'unavailable') lookups.delete(key)
      return lookup
    })
    .catch(() => {
      lookups.delete(key)
      return UNAVAILABLE
    })
  lookups.set(key, request)
  return request
}
