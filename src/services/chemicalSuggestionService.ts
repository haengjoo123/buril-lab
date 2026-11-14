import { getJson } from './internalApi'

/** One concrete form of a name that fits several reagents (e.g. anhydrous vs hydrate). */
export interface ChemicalFormChoice {
  name: string
  nameEn?: string
}

export interface ChemicalSuggestionResult {
  suggestions: string[]
  /** Present only when the exact query names more than one form; the person must pick one. */
  formChoices: ChemicalFormChoice[]
}

interface ChemicalSuggestionResponse {
  suggestions?: string[]
  formChoices?: ChemicalFormChoice[]
}

function readFormChoices(value: unknown): ChemicalFormChoice[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { name, nameEn } = entry as Record<string, unknown>
    if (typeof name !== 'string' || !name.trim()) return []
    return [{ name: name.trim(), ...(typeof nameEn === 'string' && nameEn.trim() ? { nameEn: nameEn.trim() } : {}) }]
  })
}

export async function fetchChemicalSuggestionResult(
  query: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<ChemicalSuggestionResult> {
  const normalized = query.normalize('NFKC').trim()
  if (normalized.length < 2) return { suggestions: [], formChoices: [] }
  const response = await getJson<ChemicalSuggestionResponse>(
    `/api/chemicals/suggest?q=${encodeURIComponent(normalized)}&limit=${Math.min(Math.max(limit, 1), 10)}`,
    { signal },
  )
  return {
    suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
    formChoices: readFormChoices(response.formChoices),
  }
}

export async function fetchChemicalSuggestions(
  query: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<string[]> {
  return (await fetchChemicalSuggestionResult(query, limit, signal)).suggestions
}
