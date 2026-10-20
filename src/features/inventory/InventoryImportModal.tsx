import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, X, Loader2, FileText, CheckCircle2, Save } from 'lucide-react'
import { inventoryImportService as service } from '../../services/inventoryImportService'
import type { InventoryItem, StorageLocation } from '../../services/inventoryService'
import type { Cabinet } from '../../services/cabinetService'
import { useLabStore } from '../../store/useLabStore'
import { readInWorker, prepareDocument, dataUrlBlob, splitDocumentImage } from './import/documents'
import { IMPORT_ACCEPT } from './import/readers'
import { buildImportRows, defaultMapping, detectTables, orientedCells, profileSignature, tableHeaders } from './import/tables'
import { validateImportRows } from './import/normalize'
import { FIELD_LABELS, IMPORT_FIELDS, IMPORT_LIMITS, type ImportDraftRow, type ImportField, type ImportJob, type ImportProfile, type ImportTable } from './import/types'
import { downloadRowsAsXlsx } from '../../utils/excelFiles'
import { exportImportAttributes } from './import/sourceAttributes'
import { useTranslation } from 'react-i18next'
import i18n from '../../locales/i18n'

interface Props { isOpen: boolean; items: InventoryItem[]; locations: StorageLocation[]; cabinets: Cabinet[]; onClose: () => void; onImported: () => void }
const inputClass = 'min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40 dark:border-slate-600'
const statusLabels = { all: 'inv_status_all', ready: 'inv_status_ready', review: 'inv_status_review', duplicate: 'inv_status_duplicate', excluded: 'inv_status_excluded', imported: 'inv_status_imported' }

export function InventoryImportModal(props: Props) {
  const labId = useLabStore(state => state.currentLabId)
  // Unmounting this session on scope changes prevents late reads from replacing another lab's draft.
  return props.isOpen ? <ImportSession key={labId || 'personal'} {...props} labId={labId} /> : null
}
function ImportSession({ items, locations, cabinets, onClose, onImported, labId }: Props & { labId: string | null }) {
  const { t } = useTranslation()
  const blankLabel = t('inv_blank')
  const [job, setJob] = useState<ImportJob | null>(null)
  const jobRef = useRef<ImportJob | null>(null)
  const alive = useRef(true)
  const pause = useRef(false)
  const running = useRef(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const dirtyRows = useRef(new Set<string>())
  const metadataDirty = useRef(false)
  const [recent, setRecent] = useState<Array<{ id: string; name: string; updated_at: string }>>([])
  const [profiles, setProfiles] = useState<ImportProfile[]>([])
  const [selectedTable, setSelectedTable] = useState('')
  const [selectedGrid, setSelectedGrid] = useState('')
  const [step, setStep] = useState<'sources' | 'review'>('sources')
  const [filter, setFilter] = useState<keyof typeof statusLabels>('all')
  const [issueFilter, setIssueFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [clearField, setClearField] = useState<ImportField>('cas_number')
  const [selectedRow, setSelectedRow] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [sourceUrl, setSourceUrl] = useState('')
  const [bulkLocation, setBulkLocation] = useState('')
  const [bulkQuantity, setBulkQuantity] = useState('1')
  const [encoding, setEncoding] = useState('utf-8')
  const [delimiter, setDelimiter] = useState(',')
  const [conflict, setConflict] = useState<{ id: string; name: string; files: File[] } | null>(null)
  const [confirmCommit, setConfirmCommit] = useState(false)
  const filesRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    alive.current = true
    void Promise.all([service.list(labId), service.profiles(labId)]).then(([jobs, savedProfiles]) => { if (alive.current) { setRecent(jobs); setProfiles(savedProfiles) } }).catch(e => { if (alive.current) setError(String(e.message)) })
    return () => { alive.current = false; pause.current = true }
  }, [labId])
  const context = useMemo(() => ({ existing: items, cabinets, locations }), [items, cabinets, locations])
  const validated = useMemo(() => validateImportRows(job?.rows || [], context), [job?.rows, context])
  const counts = useMemo(() => Object.fromEntries(Object.keys(statusLabels).map(status => [status, status === 'all' ? validated.length : validated.filter(row => row.status === status).length])) as Record<keyof typeof statusLabels, number>, [validated])
  const issueGroups = useMemo(() => [...new Map(validated.flatMap(row => row.issues.map(issue => [issue.code, issue.message] as const)))], [validated])
  const locationGroups = useMemo(() => [...new Set((job?.rows || []).map(row => row.fields.storage_location || ''))].sort(), [job?.rows])
  const filtered = useMemo(() => validated.filter(row => (filter === 'all' || row.status === filter)
    && (!issueFilter || row.issues.some(issue => issue.code === issueFilter))
    && (!locationFilter || (row.row.fields.storage_location || blankLabel) === locationFilter)), [validated, filter, issueFilter, locationFilter, blankLabel])
  useEffect(() => { setScrollTop(0); if (listRef.current) listRef.current.scrollTop = 0 }, [filter, issueFilter, locationFilter, filtered.length])
  const currentRow = job?.rows.find(row => row.id === selectedRow)
  const table = job?.tables.find(table => table.id === selectedTable)
  const gridSource = job?.sources.find(source => source.grids.some(grid => `${source.id}/${grid.id}` === selectedGrid))
  const grid = gridSource?.grids.find(grid => `${gridSource.id}/${grid.id}` === selectedGrid)
  const tableSource = table ? job?.sources.find(source => source.id === table.sourceId) : undefined
  const tableGrid = tableSource?.grids.find(grid => grid.id === table?.gridId)
  const headers = table && tableGrid ? tableHeaders(table, tableGrid) : []
  const compatibleProfiles = table && tableGrid ? profiles.filter(p => p.signature === profileSignature(table, tableGrid)) : []
  useEffect(() => {
    let stale = false
    setSourceUrl('')
    if (grid?.imageData) setSourceUrl(grid.imageData)
    if (grid?.imagePath) void service.signedUrl(grid.imagePath).then(url => { if (!stale) setSourceUrl(url) }).catch(() => { if (!stale) setError(t('inv_err_preview_load')) })
    return () => { stale = true }
  }, [grid?.imagePath, grid?.imageData, t])
  const update = (next: ImportJob, changed?: string[], metadata = false) => {
    jobRef.current = next
    if (alive.current) { setJob(next); setDirty(true); setConfirmCommit(false) }
    if (changed) changed.forEach(id => dirtyRows.current.add(id))
    if (metadata) metadataDirty.current = true
  }
  const save = async () => {
    const snapshot = jobRef.current
    if (!snapshot) return null
    const changed = snapshot.rows.filter(row => dirtyRows.current.has(row.id))
    if (!changed.length && !metadataDirty.current) return snapshot
    const saved = await service.save(snapshot, changed, metadataDirty.current, (checkpoint, savedIds) => {
      jobRef.current = checkpoint
      savedIds.forEach(id => dirtyRows.current.delete(id))
      metadataDirty.current = false
      if (alive.current) setJob(checkpoint)
    })
    dirtyRows.current.clear(); metadataDirty.current = false
    jobRef.current = saved
    if (alive.current) { setJob(saved); setDirty(false) }
    return saved
  }
  const run = async (label: string, action: () => Promise<void>) => {
    if (running.current) return
    running.current = true
    setBusy(label); setError(''); setNotice(''); pause.current = false
    try { await action() }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : t('inv_err_job_incomplete')) }
    finally { running.current = false; if (alive.current) setBusy('') }
  }
  const load = async (id: string) => run(t('inv_busy_loading_job'), async () => {
    const loaded = await service.load(id, labId)
    if (!alive.current) return
    jobRef.current = loaded; setJob(loaded); dirtyRows.current.clear(); metadataDirty.current = false; setDirty(false)
    setSelectedTable(loaded.tables[0]?.id || ''); const first = loaded.sources[0]; setSelectedGrid(first?.grids[0] ? `${first.id}/${first.grids[0].id}` : '')
    setConflict(null)
  })
  const addFiles = async (files: File[], allowNew = false) => run(t('inv_busy_reading_saving'), async () => {
    if (files.some(file => file.size === 0 || file.size > IMPORT_LIMITS.fileBytes)) throw new Error(t('inv_err_files_empty_or_large'))
    if (files.reduce((size, file) => size + file.size, jobRef.current?.sources.reduce((size, s) => size + s.size, 0) || 0) > IMPORT_LIMITS.totalBytes) throw new Error(t('inv_err_job_size'))
    await save()
    for (const [fileIndex, file] of files.entries()) {
      if (pause.current) break
      const parsed = await readInWorker(file)
      let source = parsed.source
      if (jobRef.current?.sources.some(s => s.hash === source.hash)) throw new Error(t('inv_err_file_already_in_job', { name: file.name }))
      if (!allowNew) {
        const found = await service.findSource(source.hash, labId)
        if (found && found.id !== jobRef.current?.id) { setConflict({ ...found, files: files.slice(fileIndex) }); return }
      }
      const active = jobRef.current || await service.create(labId, file.name)
      source = await prepareDocument(source, file)
      const pageCount = [...active.sources, source].reduce((n, s) => n + s.grids.filter(g => g.page).length, 0)
      if (pageCount > IMPORT_LIMITS.pages) throw new Error(t('inv_err_job_pages'))
      const path = `${active.id}/${source.id}/original.${file.name.split('.').pop()?.toLowerCase()}`
      await service.upload(path, file); source.path = path
      for (const grid of source.grids) if (grid.imageData) {
        grid.imagePath = `${active.id}/${source.id}/${grid.id}.jpg`
        await service.upload(grid.imagePath, await dataUrlBlob(grid.imageData))
      }
      const sources = [...active.sources, source]
      const tables = [...active.tables, ...(source.kind === 'spreadsheet' || source.kind === 'delimited' ? parsed.tables : detectTables(source))]
      const rows = buildImportRows(sources, tables, active.rows)
      const next = { ...active, sources, tables, rows }
      update(next, rows.filter(row => row.sourceId === source.id).map(row => row.id), true)
      await save()
      if (alive.current) { setSelectedGrid(`${source.id}/${source.grids[0]?.id || ''}`); setSelectedTable(tables.find(t => t.sourceId === source.id)?.id || '') }
      for (const grid of source.grids.filter(grid => grid.needsAnalysis)) {
        if (pause.current) break
        setBusy(t('inv_busy_analyzing', { source: source.name, label: grid.label }))
        try { await analyzeGrid({ sourceId: source.id, gridId: grid.id }, 'document') }
        catch (e) { setNotice(t('inv_notice_doc_analysis_failed', { message: e instanceof Error ? e.message : t('inv_err_doc_analysis_incomplete') })); break }
      }
    }
    setConflict(null)
  })
  const changeTable = (changes: Partial<ImportTable>) => {
    const active = jobRef.current
    if (!active || !table || !tableGrid || active.rows.some(row => row.tableId === table.id && row.importedId)) return
    const changed = { ...table, ...changes }
    if (changes.headerRow !== undefined || changes.headerDepth !== undefined || changes.orientation) {
      changed.startRow = changed.headerRow + changed.headerDepth
      const cells = orientedCells(tableGrid, changed.orientation)
      if (changes.orientation) { changed.endRow = cells.length - 1; changed.endColumn = Math.max(0, ...cells.map(r => r.length)) - 1 }
      changed.mapping = defaultMapping(changed, tableGrid)
    }
    const tables = active.tables.map(t => t.id === changed.id ? changed : t)
    try { const rows = buildImportRows(active.sources, tables, active.rows); update({ ...active, tables, rows }, rows.filter(r => r.tableId === table.id).map(r => r.id), true) }
    catch (e) { setError((e as Error).message) }
  }
  const patchRows = (predicate: (row: ImportDraftRow) => boolean, change: (row: ImportDraftRow) => ImportDraftRow) => {
    const active = jobRef.current; if (!active) return
    const changed: string[] = []
    const rows = active.rows.map(row => { if (row.importedId || !predicate(row)) return row; changed.push(row.id); return { ...change(row), error: undefined } })
    update({ ...active, rows }, changed)
  }
  const analyze = async (mode: 'mapping' | 'document', all = false) => run(mode === 'mapping' ? t('inv_busy_analyzing_columns') : t('inv_busy_reading_doc'), async () => {
    await save()
    const targets = all ? jobRef.current!.sources.flatMap(s => s.grids.filter(g => g.needsAnalysis).map(g => ({ sourceId: s.id, gridId: g.id }))) : gridSource && grid ? [{ sourceId: gridSource.id, gridId: grid.id }] : []
    for (const target of targets) {
      if (pause.current) break
      await analyzeGrid(target, mode)
    }
  })
  const analyzeGrid = async (target: { sourceId: string; gridId: string }, mode: 'mapping' | 'document') => {
      const active = jobRef.current!
      const result = await service.analyze(active.id, target.sourceId, target.gridId, mode, table?.id)
      const sources = active.sources.map(s => s.id === target.sourceId && result.grid ? { ...s, grids: s.grids.map(g => g.id === target.gridId ? { ...g, ...result.grid } : g) } : s)
      const source = sources.find(s => s.id === target.sourceId)!
      const tables = result.grid ? [...active.tables.filter(t => !(t.sourceId === source.id && t.gridId === target.gridId)), ...detectTables(source).filter(t => t.gridId === target.gridId)]
        : active.tables.map(t => t.id === table?.id ? { ...t, mapping: { ...t.mapping, ...result.mapping }, needsReview: true, confirmed: false } : t)
      const rows = buildImportRows(sources, tables, active.rows.filter(row => row.importedId || !active.tables.some(t => t.id === row.tableId && t.sourceId === target.sourceId && t.gridId === target.gridId)))
      update({ ...active, sources, tables, rows }, rows.filter(r => r.sourceId === source.id).map(r => r.id), true)
      await save()
      if (alive.current && mode === 'document') setSelectedTable(tables.find(t => t.sourceId === target.sourceId && t.gridId === target.gridId)?.id || '')
      if (result.warnings.length) setNotice(result.warnings.join(' '))
  }
  const commit = () => run(t('inv_busy_registering_items'), async () => {
    const active = await save(); if (!active) return
    const ready = validateImportRows(active.rows, context).filter(row => row.status === 'ready')
    let completed = 0
    try {
    for (let offset = 0; offset < ready.length; offset += IMPORT_LIMITS.batch) {
      if (pause.current) break
      setBusy(t('inv_busy_registering', { offset, total: ready.length }))
      const receipts = await service.commit(jobRef.current!, ready.slice(offset, offset + IMPORT_LIMITS.batch))
      const map = new Map(receipts.map(r => [r.rowId, r]))
      const current = jobRef.current!
      const next = { ...current, rows: current.rows.map(row => map.has(row.id) ? { ...row, importedId: map.get(row.id)?.inventoryId, error: map.get(row.id)?.error } : row) }
      jobRef.current = next; if (alive.current) setJob(next)
      completed += receipts.filter(r => r.inventoryId).length
    }
    setConfirmCommit(false); setNotice(t('inv_notice_registered', { count: completed }))
    } finally { onImported() }
  })
  const close = () => { if (busy) { pause.current = true; setNotice(t('inv_notice_pausing')); return } void run(t('inv_busy_saving_edits'), async () => { await save(); onClose() }) }
  const exportCurrent = () => run(t('inv_busy_creating_xlsx'), async () => {
    await downloadRowsAsXlsx(items.map(item => ({ name: item.name, quantity: item.quantity, brand: item.brand, cas_number: item.cas_number,
      product_number: item.product_number, capacity: item.capacity, storage_type: item.storage_type,
      storage_location: item.cabinet_name || item.storage_location_name || '', manufacturer_date_type: item.manufacturer_date_type,
      manufacturer_date: item.expiry_date, received_date: item.received_date, opened_date: item.opened_date, memo: item.memo, ...exportImportAttributes(item.source_attributes) })), 'Inventory', 'inventory.xlsx')
  })
  const start = Math.max(0, Math.floor(scrollTop / 52) - 5)
  const visible = filtered.slice(start, start + 22)
  const pageRows = gridSource && grid ? job?.rows.filter(row => row.sourceId === gridSource.id && job.tables.find(t => t.id === row.tableId)?.gridId === grid.id) || [] : []
  const sourceRow = currentRow && pageRows.some(row => row.id === currentRow.id) ? currentRow : undefined
  const previewCells = grid ? orientedCells(grid, table?.orientation || 'rows') : []
  const previewStart = Math.max(0, sourceRow ? sourceRow.sourceRow - 3 : (table?.headerRow || 0) - 2)
  return <div className="adaptive-overlay fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/50 p-2 sm:p-5" role="dialog" aria-modal="true" aria-label={t('inv_import_dialog_label')}>
    <div className="flex max-h-[95vh] w-full max-w-7xl flex-col rounded-2xl bg-white text-slate-800 shadow-xl dark:bg-slate-900 dark:text-slate-100">
      <header className="flex items-center justify-between border-b p-4 dark:border-slate-700"><div><h2 className="text-lg font-bold">{t('inv_import_title')}</h2><p className="text-xs text-slate-500">{t('inv_import_subtitle')}</p></div><button onClick={close} aria-label={t('inv_close')} className="p-2"><X /></button></header>
      <div className="overflow-y-auto p-4">
        {error && <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}{job && <button disabled={Boolean(busy)} className={`${buttonClass} mt-2 block`} onClick={() => void load(job.id)}>{t('inv_reopen_saved_job')}</button>}</div>}
        {notice && <div role="status" className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-200">{notice}</div>}
        {busy && <div role="status" className="mb-3 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{busy}<button className={buttonClass} onClick={() => { pause.current = true }}>{t('inv_pause_after_step')}</button></div>}
        <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => filesRef.current?.click()}><Upload className="mr-1 inline h-4 w-4" />{t('inv_add_files')}</button><label className={buttonClass}>{t('inv_photograph_paper')}<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={e => { const f = [...(e.target.files || [])]; e.target.value = ''; void addFiles(f) }} /></label><button className={buttonClass} onClick={exportCurrent}>{t('inv_export_current')}</button>{job && <button className={buttonClass} onClick={() => void run(t('inv_busy_saving'), async () => { await save(); jobRef.current = null; setJob(null); setStep('sources') })}>{t('inv_new_import')}</button>}</div>
          <input ref={filesRef} type="file" multiple accept={IMPORT_ACCEPT} className="sr-only" onChange={e => { const f = [...(e.target.files || [])]; e.target.value = ''; void addFiles(f) }} />
          {!job && <><div className="rounded-xl border-2 border-dashed p-8 text-center" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void addFiles([...e.dataTransfer.files]) }}><FileText className="mx-auto mb-2 h-9 w-9 text-emerald-600" /><p>{t('inv_drop_files_here')}</p><p className="mt-2 text-xs text-slate-500">{t('inv_limits_hint')}<br />{t('inv_hwp_docx_hint')}</p></div>{recent.length > 0 && <div><h3 className="mb-2 font-semibold">{t('inv_continue_import')}</h3><div className="flex flex-wrap gap-2">{recent.map(r => <button key={r.id} className={buttonClass} onClick={() => void load(r.id)}>{r.name} · {new Date(r.updated_at).toLocaleDateString()}</button>)}</div></div>}</>}
          {conflict && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{t('inv_same_file_job')} {conflict.name}<div className="mt-2 flex gap-2"><button className={buttonClass} onClick={() => void load(conflict.id)}>{t('inv_continue_existing_job')}</button><button className={buttonClass} onClick={() => void addFiles(conflict.files, true)}>{job ? t('inv_add_to_current_job') : t('inv_import_as_separate_job')}</button></div></div>}
          {job && <>
            <div className="flex flex-wrap items-center gap-2"><button className={buttonClass} onClick={() => setStep('sources')}>{t('inv_step_sources')}</button><button className={buttonClass} onClick={() => setStep('review')}>{t('inv_step_review')}</button><span className="text-xs text-slate-500">{t('inv_files_count', { count: job.sources.length })} · {dirty ? t('inv_unsaved_changes') : t('inv_progress_saved')}</span></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">{(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map(status => <button key={status} className={`rounded-lg border p-2 text-left ${filter === status && step === 'review' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950' : 'dark:border-slate-700'}`} onClick={() => { setFilter(status); setScrollTop(0); setStep('review') }}><span className="block text-xs">{t(statusLabels[status])}</span><strong className="text-lg">{counts[status]}</strong></button>)}</div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]">
              <section className="min-w-0 space-y-3">
                {step === 'sources' ? <>
                  <label className="flex flex-col gap-1 text-sm">{t('inv_select_table')}<select className={inputClass} value={selectedTable} onChange={e => { setSelectedTable(e.target.value); const t = job.tables.find(t => t.id === e.target.value); if (t) setSelectedGrid(`${t.sourceId}/${t.gridId}`) }}><option value="">{t('inv_select_table_prompt')}</option>{job.tables.map(t => <option key={t.id} value={t.id}>{t.label}{t.included ? '' : ` (${i18n.t('inv_status_excluded')})`}</option>)}</select></label>
                  {job.sources.some(s => s.grids.some(g => g.needsAnalysis)) && <button className={buttonClass} onClick={() => void analyze('document', true)}>{t('inv_analyze_unread_docs')}</button>}
                  {table && tableGrid && <fieldset disabled={job.rows.some(r => r.tableId === table.id && r.importedId)} className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-3 text-sm"><label><input type="checkbox" checked={table.included} onChange={e => changeTable({ included: e.target.checked })} /> {t('inv_include_table')}</label><label>{t('inv_orientation')} <select className={inputClass} value={table.orientation} onChange={e => changeTable({ orientation: e.target.value as ImportTable['orientation'] })}><option value="rows">{t('inv_orient_rows')}</option><option value="columns">{t('inv_orient_columns')}</option></select></label><button className={buttonClass} onClick={() => void analyze('mapping')}>{t('inv_ai_suggest_mapping')}</button></div>
                    <div className="grid grid-cols-3 gap-2">{([['headerRow', t('inv_header_row')], ['headerDepth', t('inv_header_lines')], ['startRow', t('inv_start_row')], ['endRow', t('inv_end_row')], ['startColumn', t('inv_start_col')], ['endColumn', t('inv_end_col')]] as const).map(([key, label]) => <label key={key} className="text-xs">{label}<input aria-label={label} className={`${inputClass} w-full`} type="number" min="1" value={table[key] + (key === 'headerDepth' ? 0 : 1)} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1) changeTable({ [key]: n - (key === 'headerDepth' ? 0 : 1) }) }} /></label>)}</div>
                    <p className="text-xs text-slate-500">{t('inv_capacity_mapping_hint')}</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{IMPORT_FIELDS.map(field => <label key={field} className="flex flex-col gap-1 text-xs">{FIELD_LABELS[field]}<select className={inputClass} value={table.mapping[field]?.[0] || ''} onChange={e => changeTable({ mapping: { ...table.mapping, [field]: e.target.value ? [e.target.value, ...(table.mapping[field]?.slice(1) || [])] : [] } })}><option value="">{t('inv_not_mapped')}</option>{headers.map(h => <option key={h.id} value={h.id}>{h.label} ({t('inv_col_n', { n: Number(h.id.slice(1)) + 1 })})</option>)}</select>{field === 'capacity' && <select aria-label={t('inv_capacity_unit_col')} className={inputClass} value={table.mapping[field]?.[1] || ''} onChange={e => changeTable({ mapping: { ...table.mapping, capacity: [table.mapping.capacity?.[0] || '', e.target.value].filter(Boolean) } })}><option value="">{t('inv_map_unit_col')}</option>{headers.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}</select>}</label>)}</div>
                    <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => { changeTable({ confirmed: true }); patchRows(r => r.tableId === table.id, r => ({ ...r, reviewed: true })); setStep('review') }}>{t('inv_confirm_table_mapping')}</button><button className={buttonClass} onClick={() => void run(t('inv_busy_saving_profile'), async () => { await save(); await service.saveProfile(jobRef.current!, { name: table.label.slice(0, 200), signature: profileSignature(table, tableGrid), mapping: table.mapping, orientation: table.orientation, headerDepth: table.headerDepth }); setProfiles(await service.profiles(labId)); setNotice(t('inv_notice_profile_saved')) })}>{t('inv_save_mapping_profile')}</button>{compatibleProfiles.map(profile => <button key={profile.id} className={buttonClass} onClick={() => changeTable({ mapping: profile.mapping, needsReview: true, confirmed: false })}>{t('inv_apply_profile', { name: profile.name })}</button>)}</div>
                  </fieldset>}
                </> : <>
                  <div className="flex flex-wrap gap-2">
                    <select aria-label={t('inv_issue_type_filter')} className={`${inputClass} w-full sm:w-auto sm:max-w-72`} value={issueFilter} onChange={e => setIssueFilter(e.target.value)}><option value="">{t('inv_all_issues')}</option>{issueGroups.map(([code, message]) => <option key={code} value={code}>{message}</option>)}</select>
                    <select aria-label={t('inv_group_by_source_location')} className={`${inputClass} max-w-full`} value={locationFilter} onChange={e => setLocationFilter(e.target.value)}><option value="">{t('inv_all_source_locations')}</option>{locationGroups.map(location => <option key={location} value={location || blankLabel}>{location || blankLabel}</option>)}</select>
                    <span className="self-center text-xs text-slate-500">{t('inv_current_list_rows', { count: filtered.length })}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800"><input aria-label={t('inv_bulk_quantity_value')} className={`${inputClass} w-20`} value={bulkQuantity} onChange={e => setBulkQuantity(e.target.value)} /><button className={buttonClass} onClick={() => patchRows(r => !r.fields.quantity?.trim(), r => ({ ...r, fields: { ...r.fields, quantity: bulkQuantity } }))}>{t('inv_apply_empty_quantity')}</button><button className={buttonClass} onClick={() => patchRows(r => /^0(?:\s*(개|병|ea))?$/i.test(r.fields.quantity?.trim() || ''), r => ({ ...r, excluded: true }))}>{t('inv_exclude_zero_qty_rows')}</button>
                    <select aria-label={t('inv_bulk_location')} className={inputClass} value={bulkLocation} onChange={e => setBulkLocation(e.target.value)}><option value="">{t('inv_location_unassigned')}</option>{locations.map(l => <option key={l.id} value={`other:${l.id}`}>{l.name}</option>)}{cabinets.map(c => <option key={c.id} value={`cabinet:${c.id}`}>{t('inv_cabinet_pending_layout', { name: c.name })}</option>)}</select><button className={buttonClass} onClick={() => { const [kind, id] = bulkLocation.split(':'); const target = (kind === 'cabinet' ? cabinets : locations).find(l => l.id === id); const ids = new Set(filtered.map(r => r.row.id)); patchRows(r => ids.has(r.id), r => ({ ...r, fields: { ...r.fields, storage_type: kind || 'other', storage_location: target?.name || '' } })) }}>{t('inv_apply_location_to_list')}</button>
                    <button className={buttonClass} onClick={() => { const ids = new Set(filtered.filter(r => r.status === 'duplicate').map(r => r.row.id)); patchRows(r => ids.has(r.id), r => ({ ...r, duplicateDecision: 'skip' })) }}>{t('inv_exclude_duplicates')}</button><button className={buttonClass} onClick={() => { const ids = new Set(filtered.filter(r => r.status === 'duplicate').map(r => r.row.id)); patchRows(r => ids.has(r.id), r => ({ ...r, duplicateDecision: 'new' })) }}>{t('inv_register_duplicates_separately')}</button></div>
                  <div className="flex flex-wrap gap-2"><select aria-label={t('inv_field_to_clear')} className={inputClass} value={clearField} onChange={e => setClearField(e.target.value as ImportField)}>{IMPORT_FIELDS.filter(field => field !== 'name' && field !== 'quantity').map(field => <option key={field} value={field}>{FIELD_LABELS[field]}</option>)}</select><button className={buttonClass} onClick={() => { const ids = new Set(filtered.map(entry => entry.row.id)); patchRows(row => ids.has(row.id), row => ({ ...row, fields: { ...row.fields, [clearField]: '' } })); setNotice(t('inv_notice_field_cleared')) }}>{t('inv_clear_field_in_list')}</button></div>
                  <div ref={listRef} className="h-[400px] overflow-auto rounded-lg border dark:border-slate-700" onScroll={e => setScrollTop(e.currentTarget.scrollTop)}><div style={{ height: filtered.length * 52, position: 'relative' }}>{visible.map((entry, index) => <button key={entry.row.id} style={{ position: 'absolute', top: (start + index) * 52, height: 52 }} className={`flex w-full items-center gap-2 border-b px-3 text-left text-sm dark:border-slate-700 ${selectedRow === entry.row.id ? 'bg-emerald-50 dark:bg-emerald-950' : ''}`} onClick={() => { setSelectedRow(entry.row.id); const t = job.tables.find(t => t.id === entry.row.tableId); if (t) { setSelectedGrid(`${t.sourceId}/${t.gridId}`); setSelectedTable(t.id) } }}><span className="w-9 shrink-0 text-xs text-slate-500">{entry.row.sourceRow}</span><span className="min-w-0 flex-1 truncate">{entry.row.fields.name || t('inv_name_needs_review')}</span><span className="w-12 truncate">{entry.row.fields.quantity || '—'}</span><span className={`w-20 shrink-0 text-xs ${entry.row.error || entry.status === 'review' ? 'text-amber-700 dark:text-amber-300' : ''}`}>{entry.row.error && !entry.row.excluded ? t('inv_save_failed') : t(statusLabels[entry.status])}</span></button>)}</div></div>
                  {currentRow && <fieldset disabled={Boolean(currentRow.importedId)} className="space-y-3 rounded-xl border p-3 dark:border-slate-700"><div className="flex justify-between text-sm"><strong>{currentRow.sourceLabel} · {t('inv_row_n', { n: currentRow.sourceRow })}</strong><label><input type="checkbox" checked={currentRow.excluded} onChange={e => patchRows(r => r.id === currentRow.id, r => ({ ...r, excluded: e.target.checked }))} /> {t('inv_exclude')}</label></div><div className="text-sm text-amber-700 dark:text-amber-300">{validated.find(r => r.row.id === currentRow.id)?.issues.map((issue, i) => <p key={i}>{issue.message}</p>)}{currentRow.error}</div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{IMPORT_FIELDS.map(field => <label key={field} className="text-xs">{FIELD_LABELS[field]}<input className={`${inputClass} w-full`} value={currentRow.fields[field] || ''} onChange={e => patchRows(r => r.id === currentRow.id, r => ({ ...r, fields: { ...r.fields, [field]: e.target.value } }))} />{currentRow.originalFields[field] !== currentRow.fields[field] && <span className="text-slate-500">{t('inv_original_value', { value: currentRow.originalFields[field] || blankLabel })}</span>}</label>)}</div><div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => patchRows(r => r.id === currentRow.id, r => ({ ...r, reviewed: true }))}>{t('inv_confirm_row_source')}</button><button className={buttonClass} onClick={() => patchRows(r => r.id === currentRow.id, r => ({ ...r, duplicateDecision: 'new' }))}>{t('inv_register_as_separate')}</button></div><details><summary className="text-sm">{t('inv_preserved_source_cols')}</summary><dl className="mt-2 space-y-1 text-xs">{currentRow.attributes.map((a, i) => <div key={i} className="break-words"><dt className="inline font-bold">{a.label} ({a.address}): </dt><dd className="inline">{a.value || blankLabel}</dd></div>)}</dl></details></fieldset>}
                </>}
              </section>
              <aside className="min-w-0 space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50"><label className="flex flex-col gap-1 text-xs">{t('inv_source_sheet_page')}<select className={inputClass} value={selectedGrid} onChange={e => { setSelectedGrid(e.target.value); const t = job.tables.find(t => `${t.sourceId}/${t.gridId}` === e.target.value); setSelectedTable(t?.id || '') }}><option value="">{t('inv_select_prompt')}</option>{job.sources.flatMap(s => s.grids.map(g => <option key={`${s.id}/${g.id}`} value={`${s.id}/${g.id}`}>{s.name} · {g.label}{g.hidden ? ` (${t('inv_hidden_sheet')})` : ''}</option>))}</select></label>
                {grid?.imagePath && <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={pageRows.some(r => r.importedId)} onClick={() => void analyze('document')}>{grid.needsAnalysis ? t('inv_analyze_page') : t('inv_reanalyze_page')}</button><button className={buttonClass} disabled={pageRows.some(r => r.importedId)} onClick={() => void run(t('inv_busy_splitting_page'), async () => {
                  await save(); if (!gridSource || !grid.imagePath) return
                  const images = await splitDocumentImage(await service.download(grid.imagePath)); const active = jobRef.current!
                  if (active.sources.reduce((n, s) => n + s.grids.filter(g => g.page).length, 0) >= IMPORT_LIMITS.pages) throw new Error(t('inv_err_page_area_limit'))
                  const split = images.map((imageData, i) => ({ id: `${grid.id}-${crypto.randomUUID().slice(0, 8)}`, label: `${grid.label} ${i === 0 ? t('inv_part_top') : t('inv_part_bottom')}`, page: grid.page, cells: [], imageData, needsAnalysis: true, imagePath: '' }))
                  for (const part of split) { part.imagePath = `${active.id}/${gridSource.id}/${part.id}.jpg`; await service.upload(part.imagePath, await dataUrlBlob(part.imageData)) }
                  const sources = active.sources.map(s => s.id === gridSource.id ? { ...s, grids: s.grids.flatMap(g => g.id === grid.id ? split : [g]) } : s)
                  const tables = active.tables.filter(t => !(t.sourceId === gridSource.id && t.gridId === grid.id)); const rows = buildImportRows(sources, tables, active.rows)
                  update({ ...active, sources, tables, rows }, [], true); await save(); setSelectedGrid(`${gridSource.id}/${split[0].id}`); setSelectedTable('')
                })}>{t('inv_split_top_bottom')}</button></div>}
                {grid?.analysisWarnings?.map((warning, i) => <p key={i} className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>)}
                {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="block"><div className="relative"><img src={sourceUrl} alt={t('inv_source_ledger_alt')} className="w-full rounded-lg" />{sourceRow?.cells.filter(c => c.bounds).map((cell, i) => <span key={i} className="pointer-events-none absolute border-2 border-emerald-500 bg-emerald-400/10" style={{ left: `${cell.bounds![0] * 100}%`, top: `${cell.bounds![1] * 100}%`, width: `${(cell.bounds![2] - cell.bounds![0]) * 100}%`, height: `${(cell.bounds![3] - cell.bounds![1]) * 100}%` }} />)}</div><span className="text-xs underline">{t('inv_view_source_large')}</span></a>}
                {!!previewCells.length && <div className="max-h-80 overflow-auto"><table className="w-full border-collapse text-xs"><tbody>{previewCells.slice(previewStart, previewStart + 15).map((row, i) => <tr key={i} className={sourceRow?.sourceRow === previewStart + i + 1 ? 'bg-emerald-100 dark:bg-emerald-950' : ''}><th className="border p-1"><button disabled={!table || job.rows.some(r => r.tableId === table.id && r.importedId)} title={t('inv_select_as_header_row')} onClick={() => { setSelectedRow(''); changeTable({ headerRow: previewStart + i, headerDepth: 1, confirmed: false, needsReview: true }) }}>{previewStart + i + 1}</button></th>{row.map(cell => <td key={cell.address} className="whitespace-nowrap border p-1 dark:border-slate-600" title={cell.address}>{cell.text || '—'}</td>)}</tr>)}</tbody></table></div>}
                {gridSource?.kind === 'delimited' && <div className="space-y-2"><p className="text-xs">{t('inv_encoding_label')}: {gridSource.encoding}{gridSource.encodingUncertain ? ` · ${t('inv_status_review')}` : ''}</p><select aria-label={t('inv_encoding_label')} className={inputClass} value={encoding} onChange={e => setEncoding(e.target.value)}><option value="utf-8">UTF-8</option><option value="euc-kr">{t('inv_encoding_cp949')}</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select><select aria-label={t('inv_delimiter')} className={inputClass} value={delimiter} onChange={e => setDelimiter(e.target.value)}><option value=",">{t('inv_delim_comma')}</option><option value=";">{t('inv_delim_semicolon')}</option><option value={'\t'}>{t('inv_delim_tab')}</option><option value="|">{t('inv_delim_pipe')}</option></select><button className={buttonClass} disabled={job.rows.some(r => r.sourceId === gridSource.id && r.importedId)} onClick={() => void run(t('inv_busy_rereading'), async () => { await save(); const file = new File([await service.download(gridSource.path!)], gridSource.name); const { source: parsed } = await readInWorker(file, { encoding, delimiter }, gridSource.id); const active = jobRef.current!; const changed = { ...parsed, id: gridSource.id, path: gridSource.path }; const sources = active.sources.map(s => s.id === changed.id ? changed : s); const tables = [...active.tables.filter(t => t.sourceId !== changed.id), ...detectTables(changed)]; const rows = buildImportRows(sources, tables, active.rows); update({ ...active, sources, tables, rows }, rows.filter(r => r.sourceId === changed.id).map(r => r.id), true); await save() })}>{t('inv_reread_with_settings')}</button></div>}
                {pageRows.length > 0 && (gridSource?.kind === 'pdf' || gridSource?.kind === 'image') && <button className={buttonClass} onClick={() => { const ids = new Set(pageRows.map(r => r.id)); patchRows(r => ids.has(r.id), r => ({ ...r, reviewed: true })); setNotice(t('inv_notice_page_confirmed', { count: pageRows.length })) }}>{t('inv_confirm_page_rows', { count: pageRows.length })}</button>}
              </aside>
            </div>
          </>}
        </fieldset>
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t p-3 dark:border-slate-700">{confirmCommit && <p className="w-full text-right text-sm">{t('inv_confirm_commit_summary', { ready: counts.ready, review: counts.review, duplicate: counts.duplicate })}</p>}<button className={buttonClass} disabled={Boolean(busy) || !dirty} onClick={() => void run(t('inv_busy_saving_edits'), async () => { await save() })}><Save className="mr-1 inline h-4 w-4" />{t('inv_save_edits')}</button><button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" disabled={Boolean(busy) || !counts.ready} onClick={() => confirmCommit ? void commit() : setConfirmCommit(true)}><CheckCircle2 className="mr-1 inline h-4 w-4" />{confirmCommit ? t('inv_commit_confirm', { count: counts.ready }) : t('inv_commit_ready', { count: counts.ready })}</button></footer>
    </div>
  </div>
}
