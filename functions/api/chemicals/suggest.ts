import { searchKoshaNames, type KoshaEnv } from './_kosha'
import { createChemicalCacheAdminClient } from './_cache'

interface FunctionContext {
  request: Request
  env: KoshaEnv
}

interface PubChemAutocompleteResponse {
  dictionary_terms?: {
    compound?: string[]
  }
}

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10
const FETCH_TIMEOUT_MS = 4_000
const inFlight = new Map<string, Promise<string[]>>()

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': status === 200 ? 'public, max-age=60, stale-while-revalidate=300' : 'no-store',
    },
  })
}

function containsKorean(value: string): boolean {
  return /[\u3131-\u318e\uac00-\ud7a3]/.test(value)
}

async function fetchPubChemSuggestions(keyword: string, limit: number): Promise<string[]> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound/${encodeURIComponent(keyword)}/json?limit=${limit}`,
      { signal: controller.signal, headers: { Accept: 'application/json' } },
    )
    if (!response.ok) return []
    const payload = await response.json() as PubChemAutocompleteResponse
    return Array.from(new Set(payload.dictionary_terms?.compound || [])).slice(0, limit)
  } catch {
    return []
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function coalesce(key: string, factory: () => Promise<string[]>): Promise<string[]> {
  const existing = inFlight.get(key)
  if (existing) return existing
  const created = factory()
  inFlight.set(key, created)
  try {
    return await created
  } finally {
    if (inFlight.get(key) === created) inFlight.delete(key)
  }
}

async function fetchApprovedAliasSuggestions(
  query: string,
  limit: number,
  env: KoshaEnv,
): Promise<string[]> {
  const adminClient = createChemicalCacheAdminClient(env)
  if (!adminClient) return []
  const normalized = query.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
  const { data, error } = await adminClient
    .from('global_reagent_aliases')
    .select('canonical_name')
    .eq('is_active', true)
    .gte('normalized_alias', normalized)
    .lt('normalized_alias', `${normalized}\uffff`)
    .order('normalized_alias')
    .limit(limit)
  if (error) {
    console.warn('[chemicals/suggest] Approved alias lookup failed:', error.message)
    return []
  }
  return Array.from(new Set((data || [])
    .map((row) => row.canonical_name?.trim())
    .filter((value): value is string => Boolean(value))))
}

export const onRequestGet = async (context: FunctionContext): Promise<Response> => {
  const url = new URL(context.request.url)
  const query = (url.searchParams.get('q') || '').normalize('NFKC').trim()
  const requestedLimit = Number(url.searchParams.get('limit') || DEFAULT_LIMIT)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT
  if (query.length < 2 || query.length > 100) {
    return jsonResponse({ error: 'q must contain between 2 and 100 characters.' }, 400)
  }

  const source = containsKorean(query) ? 'kosha' : 'pubchem'
  const key = `${source}:${query.toLowerCase()}:${limit}`
  const [approvedAliases, upstream] = await Promise.all([
    fetchApprovedAliasSuggestions(query, limit, context.env),
    coalesce(key, () => source === 'kosha'
      ? searchKoshaNames(query, limit, context.env)
      : fetchPubChemSuggestions(query, limit)),
  ])
  const suggestions = Array.from(new Set([...approvedAliases, ...upstream])).slice(0, limit)
  return jsonResponse({
    suggestions,
    source: approvedAliases.length > 0 ? `approved_alias+${source}` : source,
  })
}
