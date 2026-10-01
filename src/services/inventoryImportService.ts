import { supabase } from './supabaseClient'
import { postJson } from './internalApi'
import { IMPORT_LIMITS, type ImportJob, type ImportSource, type ImportProfile, type ImportCommitReceipt, type ValidatedImportRow } from '../features/inventory/import/types'
import { buildImportRows } from '../features/inventory/import/tables'

const BUCKET = 'inventory-imports'
const pendingSaves = new Map<string, { signature: string; requestId: string }>()
function fail(error: unknown): never {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
  if (/relation .* does not exist|schema cache|PGRST|function .* does not exist/i.test(message)) throw new Error('통합 가져오기 준비가 필요합니다. 데이터베이스 업데이트 후 다시 시도해 주세요.')
  if (/revision changed|changed in another tab|already registered in another tab/i.test(message)) throw new Error('다른 탭에서 작업이 변경되거나 등록되었습니다. 저장된 작업을 다시 열어 최신 내용을 확인하세요.')
  throw new Error(message)
}
export function stripImportImages(sources: ImportSource[]): ImportSource[] {
  return sources.map(source => ({ ...source, grids: source.grids.map(grid => { const { imageData: _image, ...rest } = grid; void _image; return rest }) }))
}
export const inventoryImportService = {
  async findSource(hash: string, labId: string | null) {
    let query = supabase.from('inventory_import_jobs').select('id,name').contains('metadata', { sources: [{ hash }] }).order('updated_at', { ascending: false }).limit(1)
    query = labId ? query.eq('lab_id', labId) : query.is('lab_id', null)
    const { data, error } = await query
    if (error) fail(error)
    return data?.[0] as { id: string; name: string } | undefined
  },
  async list(labId: string | null) {
    let query = supabase.from('inventory_import_jobs').select('id,name,updated_at').order('updated_at', { ascending: false }).limit(30)
    query = labId ? query.eq('lab_id', labId) : query.is('lab_id', null)
    const { data, error } = await query
    if (error) fail(error)
    return (data || []) as Array<{ id: string; name: string; updated_at: string }>
  },
  async create(labId: string | null, name: string): Promise<ImportJob> {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) throw new Error('로그인이 필요합니다.')
    const { data, error } = await supabase.from('inventory_import_jobs').insert({ lab_id: labId, user_id: auth.user.id, name }).select('id,revision').single()
    if (error) fail(error)
    return { id: data.id, revision: data.revision, userId: auth.user.id, labId, name, sources: [], tables: [], rows: [] }
  },
  async load(id: string, expectedLabId: string | null): Promise<ImportJob> {
    const { data, error } = await supabase.from('inventory_import_jobs').select('*').eq('id', id).single()
    if (error) fail(error)
    if (data.lab_id !== expectedLabId) throw new Error('다른 연구실의 가져오기 작업입니다.')
    const storedRows: ImportJob['rows'] = []
    for (let offset = 0; ; offset += 500) {
      const result = await supabase.from('inventory_import_rows').select('draft,inventory_id').eq('job_id', id).order('row_id').range(offset, offset + 499)
      if (result.error) fail(result.error)
      storedRows.push(...(result.data || []).map(row => ({ ...row.draft, ...(row.inventory_id ? { importedId: row.inventory_id } : {}) })))
      if ((result.data?.length || 0) < 500) break
    }
    const sources = data.metadata.sources || []
    const tables = data.metadata.tables || []
    const generated = buildImportRows(sources, tables, storedRows)
    // Receipts survive table-range changes and remain visible in the job summary.
    const ids = new Set(generated.map(row => row.id))
    return { id, name: data.name, labId: data.lab_id, userId: data.user_id, revision: data.revision, sources, tables,
      rows: [...generated, ...storedRows.filter(row => row.importedId && !ids.has(row.id))], updatedAt: data.updated_at }
  },
  async save(job: ImportJob, changedRows = job.rows, includeMetadata = true, onCheckpoint?: (job: ImportJob, savedIds: string[]) => void): Promise<ImportJob> {
    let revision = job.revision
    const metadata = { sources: stripImportImages(job.sources), tables: job.tables, rowIds: job.rows.map(row => row.id) }
    // A revision is held across every chunk. A stale tab cannot overwrite a newer draft.
    for (let offset = 0; offset < Math.max(changedRows.length, 1); offset += IMPORT_LIMITS.batch) {
      const args = {
        p_job_id: job.id, p_revision: revision, p_metadata: offset === 0 && includeMetadata ? metadata : null,
        p_rows: changedRows.slice(offset, offset + IMPORT_LIMITS.batch),
      }
      const signature = JSON.stringify(args)
      const previous = pendingSaves.get(job.id)
      const requestId = previous?.signature === signature ? previous.requestId : crypto.randomUUID()
      pendingSaves.set(job.id, { signature, requestId })
      const { data, error } = await supabase.rpc('save_inventory_import_v1', { ...args, p_request_id: requestId })
      if (error) fail(error)
      revision = data as number
      pendingSaves.delete(job.id)
      onCheckpoint?.({ ...job, revision }, args.p_rows.map(row => row.id))
    }
    return { ...job, revision }
  },
  async upload(path: string, data: Blob) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, data, { upsert: false, contentType: data.type || 'application/octet-stream' })
    if (error && !/already exists|duplicate/i.test(error.message)) fail(error)
  },
  async download(path: string): Promise<Blob> {
    const { data, error } = await supabase.storage.from(BUCKET).download(path)
    if (error) fail(error)
    return data!
  },
  async signedUrl(path: string): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
    if (error) fail(error)
    return data!.signedUrl
  },
  async commit(job: ImportJob, rows: ValidatedImportRow[]): Promise<ImportCommitReceipt[]> {
    if (!rows.length || rows.length > IMPORT_LIMITS.batch || rows.some(row => row.status !== 'ready' || !row.input)) throw new Error('확인된 행을 100개 이하로 선택하세요.')
    const { data, error } = await supabase.rpc('commit_inventory_import_batch_v1', {
      p_job_id: job.id, p_revision: job.revision, p_rows: rows.map(row => ({ rowId: row.row.id, input: row.input })),
    })
    if (error) fail(error)
    const receipts = data as ImportCommitReceipt[]
    if (!Array.isArray(receipts) || receipts.length !== rows.length || receipts.some((r, i) => r.rowId !== rows[i].row.id || (!r.inventoryId && !r.error))) throw new Error('등록 결과 확인이 필요합니다. 작업을 다시 열면 중복 없이 이어갈 수 있습니다.')
    return receipts
  },
  async profiles(labId: string | null): Promise<ImportProfile[]> {
    let query = supabase.from('inventory_import_profiles').select('id,name,signature,profile').limit(100)
    query = labId ? query.eq('lab_id', labId) : query.is('lab_id', null)
    const { data, error } = await query
    if (error) fail(error)
    return (data || []).map(row => ({ ...row.profile, id: row.id, name: row.name, signature: row.signature }))
  },
  async saveProfile(job: ImportJob, profile: Omit<ImportProfile, 'id'>) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('로그인이 필요합니다.')
    const { error } = await supabase.from('inventory_import_profiles').insert({ user_id: user.id, lab_id: job.labId, name: profile.name, signature: profile.signature, profile })
    if (error) fail(error)
  },
  analyze(jobId: string, sourceId: string, gridId: string, mode: 'mapping' | 'document', tableId?: string) {
    return postJson<{ mapping?: ImportJob['tables'][number]['mapping']; grid?: ImportSource['grids'][number]; warnings: string[] }>(
      '/api/ai/inventory-import', { jobId, sourceId, gridId, mode, tableId },
    )
  },
}
