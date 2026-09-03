import {
  internalErrorResponse,
  json,
  requireAnalyticsExportAdmin,
  type AnalyticsAdminEnv,
} from './_shared'

interface ExportBody {
  from?: unknown
  to?: unknown
  reason?: unknown
  outcome?: unknown
}

interface ExportActionRow {
  action_type: string
  target_type: string | null
}

interface ExportWasteLogRow {
  id: string
  matrix_code: string | null
  stream_code: string | null
  handling_action: string | null
  confirmation_snapshot: Record<string, unknown> | null
}

interface ExportWasteItemRow {
  waste_log_id: string
  chemical_name: string
  cas_number: string | null
  concentration_value: number | null
  concentration_unit: string | null
  solution_volume_value: number | null
  solution_volume_unit: string | null
  solution_volume_normalized_ml: number | null
  waste_logs: ExportWasteLogRow | ExportWasteLogRow[] | null
}

interface ExportEventRow {
  id: string
  session_id: string
  created_at: string
  query_sanitized: string
  query_type: string
  search_channel: string
  outcome: string
  chemical_result_count: number
  product_result_count: number
  cabinet_result_count: number
  latency_ms: number | null
  matched_cas: string | null
  matched_standard_name: string | null
  search_analytics_actions: ExportActionRow[] | null
  waste_log_items: ExportWasteItemRow[] | null
}

const MAX_EXPORT_ROWS = 50000
const VALID_OUTCOMES = new Set(['matched', 'no_result', 'invalid_query', 'technical_error', 'legacy_success_unknown'])

function kstDate(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value))
}

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  const firstCharacter = text.charAt(0)
  const firstNonWhitespace = text.trimStart().charAt(0)
  if ((firstNonWhitespace && '=+-@'.includes(firstNonWhitespace)) || ['\t', '\r', '\n'].includes(firstCharacter)) {
    text = `'${text}`
  }
  return `"${text.replace(/"/g, '""')}"`
}

function tokenFor(map: Map<string, string>, prefix: string, value: string | null | undefined): string {
  if (!value) return ''
  const existing = map.get(value)
  if (existing) return existing
  const token = `${prefix}-${String(map.size + 1).padStart(6, '0')}`
  map.set(value, token)
  return token
}

function measuredPh(snapshot: Record<string, unknown> | null): string {
  const value = snapshot?.measuredBatchPh ?? snapshot?.measured_batch_ph
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const onRequestPost = async (context: {
  request: Request; env: AnalyticsAdminEnv; data?: { requestId?: unknown }
}) => {
  const auth = await requireAnalyticsExportAdmin(context.request, context.env, context.data?.requestId)
  if (!auth.ok) return auth.response

  let body: ExportBody
  try { body = await context.request.json() as ExportBody } catch {
    return json({ error: 'A valid JSON body is required.' }, { status: 400 })
  }
  const from = typeof body.from === 'string' ? new Date(body.from) : null
  const to = typeof body.to === 'string' ? new Date(body.to) : null
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const outcome = typeof body.outcome === 'string' && VALID_OUTCOMES.has(body.outcome) ? body.outcome : null
  if (!from || !to || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    return json({ error: 'A valid from/to range is required.' }, { status: 400 })
  }
  if (to.getTime() - from.getTime() > 90 * 24 * 60 * 60 * 1000) {
    return json({ error: 'An export cannot cover more than 90 days.' }, { status: 400 })
  }
  if (reason.length < 5 || reason.length > 1000) {
    return json({ error: 'Export reason must contain 5 to 1000 characters.' }, { status: 400 })
  }

  let query = auth.context.adminClient
    .from('search_analytics_events')
    .select(`
      id, session_id, created_at, query_sanitized, query_type, search_channel,
      outcome, chemical_result_count, product_result_count, cabinet_result_count,
      latency_ms, matched_cas, matched_standard_name,
      search_analytics_actions(action_type, target_type),
      waste_log_items(
        waste_log_id, chemical_name, cas_number, concentration_value, concentration_unit,
        solution_volume_value, solution_volume_unit, solution_volume_normalized_ml,
        waste_logs(id, matrix_code, stream_code, handling_action, confirmation_snapshot)
      )
    `)
    .gte('created_at', from.toISOString())
    .lt('created_at', to.toISOString())
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(MAX_EXPORT_ROWS + 1)
  if (outcome) query = query.eq('outcome', outcome)
  const { data, error } = await query
  if (error) return internalErrorResponse('admin.analytics.export.read', error)
  if ((data || []).length > MAX_EXPORT_ROWS) {
    return json({ error: 'Export exceeds 50,000 events. Narrow the filters.' }, { status: 413 })
  }

  const events = (data || []) as unknown as ExportEventRow[]
  const eventTokens = new Map<string, string>()
  const sessionTokens = new Map<string, string>()
  const batchTokens = new Map<string, string>()
  const header = [
    'date_kst', 'event_token', 'session_token', 'query', 'query_type', 'search_channel',
    'outcome', 'chemical_results', 'product_results', 'cabinet_results', 'latency_ms',
    'actions', 'matched_cas', 'matched_standard_name', 'batch_token', 'component_name',
    'component_cas', 'concentration_value', 'concentration_unit', 'solution_volume_value',
    'solution_volume_unit', 'solution_volume_ml', 'batch_ph', 'matrix', 'waste_stream', 'handling_action',
  ]
  const rows: string[] = [header.map(csvCell).join(',')]
  for (const event of events) {
    const actions = Array.from(new Set((event.search_analytics_actions || []).map((action) => (
      action.target_type ? `${action.action_type}:${action.target_type}` : action.action_type
    )))).sort().join(';')
    const items = event.waste_log_items?.length ? event.waste_log_items : [null]
    for (const item of items) {
      if (rows.length > MAX_EXPORT_ROWS) {
        return json({ error: 'Expanded export exceeds 50,000 rows. Narrow the filters.' }, { status: 413 })
      }
      const rawLog = item?.waste_logs
      const log = Array.isArray(rawLog) ? rawLog[0] : rawLog
      rows.push([
        kstDate(event.created_at),
        tokenFor(eventTokens, 'event', event.id),
        tokenFor(sessionTokens, 'session', event.session_id),
        event.query_sanitized,
        event.query_type,
        event.search_channel,
        event.outcome,
        event.chemical_result_count,
        event.product_result_count,
        event.cabinet_result_count,
        event.latency_ms,
        actions,
        event.matched_cas,
        event.matched_standard_name,
        tokenFor(batchTokens, 'batch', item?.waste_log_id),
        item?.chemical_name,
        item?.cas_number,
        item?.concentration_value,
        item?.concentration_unit,
        item?.solution_volume_value,
        item?.solution_volume_unit,
        item?.solution_volume_normalized_ml,
        measuredPh(log?.confirmation_snapshot || null),
        log?.matrix_code,
        log?.stream_code,
        log?.handling_action,
      ].map(csvCell).join(','))
    }
  }
  const csv = `\ufeff${rows.join('\r\n')}\r\n`
  const hash = await sha256(csv)
  const filters = { from: from.toISOString(), to: to.toISOString(), ...(outcome ? { outcome } : {}) }
  const { error: auditError } = await auth.context.adminClient.from('analytics_export_audits').insert({
    operator_user_id: auth.context.identity.id,
    operator_email: auth.context.identity.email,
    reason,
    filters,
    row_count: rows.length - 1,
    file_sha256: hash,
  })
  if (auditError) return internalErrorResponse('admin.analytics.export.audit', auditError)

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="buril-analytics-${kstDate(new Date().toISOString())}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-SHA256': hash,
    },
  })
}
