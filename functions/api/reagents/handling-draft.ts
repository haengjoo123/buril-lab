import { json } from '../_shared/json'
import { createChemicalCacheAdminClient, type ChemicalCacheEnv } from '../chemicals/_cache'
import { normalizeCasNumber } from '../../../src/utils/casNumber'
import {
  projectReagentHandlingDraft,
  type ReagentHandlingDraftLookup,
} from '../../../src/utils/reagentHandlingDraft'

interface FunctionContext {
  request: Request
  env: ChemicalCacheEnv
  data: Record<string, unknown>
}

interface DraftRow {
  id: string
  name_ko: string
  review_status: string
  record: unknown
  verify: unknown
}

const DRAFT_COLUMNS = 'id, name_ko, review_status, record, verify'
const MAX_NAME_LENGTH = 200

const respond = (body: ReagentHandlingDraftLookup | { error: string }, status = 200) =>
  json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
}

/**
 * AI-drafted handling and storage notes for the reagent detail screen. Signed-in users only
 * (/api/reagents/ is protected). Reads the server-only draft tables with the service role and
 * returns one draft only when the identity is unambiguous. Never used for warnings or routing.
 */
export const onRequestGet = async (context: FunctionContext): Promise<Response> => {
  if (typeof context.data.userId !== 'string') return respond({ error: 'Authentication is required.' }, 401)
  const url = new URL(context.request.url)
  const rawCas = url.searchParams.get('cas')
  const rawName = (url.searchParams.get('name') || '').normalize('NFKC').trim()
  const casNumber = rawCas ? normalizeCasNumber(rawCas) : null
  if (rawCas && !casNumber) return respond({ error: 'A valid CAS number is required.' }, 400)
  if (!casNumber && (rawName.length < 2 || rawName.length > MAX_NAME_LENGTH)) {
    return respond({ error: 'A CAS number or a name is required.' }, 400)
  }

  const client = createChemicalCacheAdminClient(context.env)
  if (!client) return respond({ status: 'unavailable' })

  const usable = (query: ReturnType<typeof client.from>) => query
    .select(DRAFT_COLUMNS)
    .neq('review_status', 'rejected')
    .or('verify_overall.is.null,verify_overall.neq.critical')

  let rows: DraftRow[] = []
  if (casNumber) {
    // A CAS shared by two drafts (e.g. two detergents) is ambiguous: show nothing.
    const { data, error } = await usable(client.from('reagent_reference_drafts')).eq('cas_number', casNumber).limit(2)
    if (error) return respond({ status: 'unavailable' })
    rows = (data || []) as DraftRow[]
  } else {
    const normalized = normalizeName(rawName)
    const { data: aliasRows, error: aliasError } = await client
      .from('reagent_alias_drafts')
      .select('draft_id')
      .eq('normalized_alias', normalized)
      .eq('status', 'candidate')
      .neq('kind', 'common_typos')
      .limit(5)
    if (aliasError) return respond({ status: 'unavailable' })
    const draftIds = Array.from(new Set((aliasRows || []).map((row: { draft_id: string }) => row.draft_id)))
    if (draftIds.length !== 1) return respond({ status: 'not_found' })
    const { data, error } = await usable(client.from('reagent_reference_drafts')).eq('id', draftIds[0]).limit(1)
    if (error) return respond({ status: 'unavailable' })
    rows = (data || []) as DraftRow[]
  }

  if (rows.length !== 1) return respond({ status: 'not_found' })
  const draft = projectReagentHandlingDraft(rows[0])
  return respond(draft ? { status: 'found', draft } : { status: 'not_found' })
}
