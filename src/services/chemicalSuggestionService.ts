import { getJson } from './internalApi'

interface ChemicalSuggestionResponse {
  suggestions?: string[]
}

export async function fetchChemicalSuggestions(
  query: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<string[]> {
  const normalized = query.normalize('NFKC').trim()
  if (normalized.length < 2) return []
  const response = await getJson<ChemicalSuggestionResponse>(
    `/api/chemicals/suggest?q=${encodeURIComponent(normalized)}&limit=${Math.min(Math.max(limit, 1), 10)}`,
    { signal },
  )
  return Array.isArray(response.suggestions) ? response.suggestions : []
}
