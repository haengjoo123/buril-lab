import {
  json,
  parseBoundedLimit,
  requireAnalyticsAdmin,
  type AnalyticsAdminEnv,
} from './_shared'
import { normalizeCasNumber } from '../../../../src/utils/casNumber'

interface ReviewsBody {
  operation?: unknown
  limit?: unknown
  cursor?: { createdAt?: unknown; id?: unknown }
  candidateId?: unknown
  status?: unknown
  notes?: unknown
  evidence?: unknown
  proposedAlias?: unknown
  canonicalName?: unknown
  canonicalCas?: unknown
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SELECT_FIELDS = [
  'id', 'candidate_type', 'source_key', 'title', 'summary', 'proposed_alias',
  'canonical_name', 'canonical_cas', 'evidence', 'sample_count', 'status',
  'review_notes', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at',
].join(', ')

export const onRequestPost = async (context: { request: Request; env: AnalyticsAdminEnv }) => {
  const auth = await requireAnalyticsAdmin(context.request, context.env)
  if (!auth.ok) return auth.response
  let body: ReviewsBody = {}
  try { body = await context.request.json() as ReviewsBody } catch { /* Empty body lists candidates. */ }
  const operation = body.operation === 'decide' ? 'decide' : 'list'

  if (operation === 'decide') {
    const candidateId = typeof body.candidateId === 'string' && UUID_PATTERN.test(body.candidateId)
      ? body.candidateId
      : null
    const status = body.status === 'approved' || body.status === 'rejected' ? body.status : null
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 4000) : ''
    const evidence = body.evidence && typeof body.evidence === 'object' && !Array.isArray(body.evidence)
      ? body.evidence
      : {}
    const proposedAlias = typeof body.proposedAlias === 'string' ? body.proposedAlias.trim().slice(0, 200) : null
    const canonicalName = typeof body.canonicalName === 'string' ? body.canonicalName.trim().slice(0, 300) : null
    const canonicalCasInput = typeof body.canonicalCas === 'string' ? body.canonicalCas.trim() : ''
    const canonicalCas = canonicalCasInput ? normalizeCasNumber(canonicalCasInput) : null
    if (!candidateId || !status) {
      return json({ error: 'candidateId and approved/rejected status are required.' }, { status: 400 })
    }
    if (canonicalCasInput && !canonicalCas) {
      return json({ error: 'canonicalCas must be a checksum-valid CAS number.' }, { status: 400 })
    }
    const { data, error } = await auth.context.adminClient.rpc('analytics_review_candidate_decide', {
      p_candidate_id: candidateId,
      p_status: status,
      p_notes: notes,
      p_evidence: evidence,
      p_operator_user_id: auth.context.identity.id,
      p_proposed_alias: proposedAlias,
      p_canonical_name: canonicalName,
      p_canonical_cas: canonicalCas,
    })
    if (error) return json({ error: error.message }, { status: error.code === 'P0002' ? 404 : 400 })
    return json({ item: data })
  }

  const { error: refreshError } = await auth.context.adminClient.rpc('analytics_admin_refresh_reviews')
  if (refreshError) return json({ error: refreshError.message }, { status: 500 })
  const limit = parseBoundedLimit(body.limit, 50, 100)
  let query = auth.context.adminClient
    .from('analytics_review_candidates')
    .select(SELECT_FIELDS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  const cursorCreatedAt = typeof body.cursor?.createdAt === 'string' ? body.cursor.createdAt : null
  const cursorId = typeof body.cursor?.id === 'string' && UUID_PATTERN.test(body.cursor.id) ? body.cursor.id : null
  if (cursorCreatedAt && cursorId && Number.isFinite(Date.parse(cursorCreatedAt))) {
    const cursorTimestamp = new Date(cursorCreatedAt).toISOString()
    query = query.or(`created_at.lt.${cursorTimestamp},and(created_at.eq.${cursorTimestamp},id.lt.${cursorId})`)
  }
  const { data, error } = await query
  if (error) return json({ error: error.message }, { status: 500 })
  const rows = (data || []) as unknown as Array<Record<string, unknown> & {
    id: string
    created_at: string
  }>
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return json({
    items,
    nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
  })
}
