import { isChemicalSearchError } from '../services/chemicalSearchError'

export type SearchErrorMessageKey =
  | 'search_offline_error'
  | 'search_external_service_error'
  | 'search_error'

export function getSearchErrorMessageKey(error: unknown, isOnline: boolean): SearchErrorMessageKey {
  if (!isOnline) return 'search_offline_error'
  if (isChemicalSearchError(error)) return 'search_external_service_error'
  return 'search_error'
}
