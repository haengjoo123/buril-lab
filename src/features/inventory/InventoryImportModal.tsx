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

interface Props { isOpen: boolean; items: InventoryItem[]; locations: StorageLocation[]; cabinets: Cabinet[]; onClose: () => void; onImported: () => void }
const inputClass = 'min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40 dark:border-slate-600'
const statusLabels = { all: '전체', ready: '등록 준비', review: '확인 필요', duplicate: '중복 후보', excluded: '제외', imported: '등록 완료' }

export function InventoryImportModal(props: Props) {
  const labId = useLabStore(state => state.currentLabId)
  // Unmounting this session on scope changes prevents late reads from replacing another lab's draft.
  return props.isOpen ? <ImportSession key={labId || 'personal'} {...props} labId={labId} /> : null
}
function ImportSession({ items, locations, cabinets, onClose, onImported, labId }: Props & { labId: string | null }) {
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
    && (!locationFilter || (row.row.fields.storage_location || '(빈칸)') === locationFilter)), [validated, filter, issueFilter, locationFilter])
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
    if (grid?.imagePath) void service.signedUrl(grid.imagePath).then(url => { if (!stale) setSourceUrl(url) }).catch(() => { if (!stale) setError('원본 미리보기를 불러오지 못했습니다.') })
    return () => { stale = true }
  }, [grid?.imagePath, grid?.imageData])
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
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '작업을 완료하지 못했습니다.') }
    finally { running.current = false; if (alive.current) setBusy('') }
  }
  const load = async (id: string) => run('작업을 불러오는 중', async () => {
    const loaded = await service.load(id, labId)
    if (!alive.current) return
    jobRef.current = loaded; setJob(loaded); dirtyRows.current.clear(); metadataDirty.current = false; setDirty(false)
    setSelectedTable(loaded.tables[0]?.id || ''); const first = loaded.sources[0]; setSelectedGrid(first?.grids[0] ? `${first.id}/${first.grids[0].id}` : '')
    setConflict(null)
  })
  const addFiles = async (files: File[], allowNew = false) => run('자료를 읽고 저장하는 중', async () => {
    if (files.some(file => file.size === 0 || file.size > IMPORT_LIMITS.fileBytes)) throw new Error('빈 파일 또는 20MB를 넘는 파일이 있습니다. 나누어 가져오세요.')
    if (files.reduce((size, file) => size + file.size, jobRef.current?.sources.reduce((size, s) => size + s.size, 0) || 0) > IMPORT_LIMITS.totalBytes) throw new Error('작업당 100MB를 넘습니다. 나누어 가져오세요.')
    await save()
    for (const [fileIndex, file] of files.entries()) {
      if (pause.current) break
      const parsed = await readInWorker(file)
      let source = parsed.source
      if (jobRef.current?.sources.some(s => s.hash === source.hash)) throw new Error(`${file.name}: 이미 이 작업에 포함된 파일입니다.`)
      if (!allowNew) {
        const found = await service.findSource(source.hash, labId)
        if (found && found.id !== jobRef.current?.id) { setConflict({ ...found, files: files.slice(fileIndex) }); return }
      }
      const active = jobRef.current || await service.create(labId, file.name)
      source = await prepareDocument(source, file)
      const pageCount = [...active.sources, source].reduce((n, s) => n + s.grids.filter(g => g.page).length, 0)
      if (pageCount > IMPORT_LIMITS.pages) throw new Error('작업당 50페이지를 넘습니다. 나누어 가져오세요.')
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
        setBusy(`${source.name} · ${grid.label} 분석 중`)
        try { await analyzeGrid({ sourceId: source.id, gridId: grid.id }, 'document') }
        catch (e) { setNotice(`${e instanceof Error ? e.message : '문서 분석을 완료하지 못했습니다.'} 저장된 원본에서 페이지를 선택해 다시 분석할 수 있습니다.`); break }
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
  const analyze = async (mode: 'mapping' | 'document', all = false) => run(mode === 'mapping' ? '열의 의미를 분석하는 중' : '문서에서 재고를 읽는 중', async () => {
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
  const commit = () => run('재고를 등록하는 중', async () => {
    const active = await save(); if (!active) return
    const ready = validateImportRows(active.rows, context).filter(row => row.status === 'ready')
    let completed = 0
    try {
    for (let offset = 0; offset < ready.length; offset += IMPORT_LIMITS.batch) {
      if (pause.current) break
      setBusy(`재고 등록 ${offset} / ${ready.length}`)
      const receipts = await service.commit(jobRef.current!, ready.slice(offset, offset + IMPORT_LIMITS.batch))
      const map = new Map(receipts.map(r => [r.rowId, r]))
      const current = jobRef.current!
      const next = { ...current, rows: current.rows.map(row => map.has(row.id) ? { ...row, importedId: map.get(row.id)?.inventoryId, error: map.get(row.id)?.error } : row) }
      jobRef.current = next; if (alive.current) setJob(next)
      completed += receipts.filter(r => r.inventoryId).length
    }
    setConfirmCommit(false); setNotice(`${completed}건 등록 완료. 남은 확인 항목과 실패 항목은 이 작업에서 이어서 처리할 수 있습니다.`)
    } finally { onImported() }
  })
  const close = () => { if (busy) { pause.current = true; setNotice('현재 단계 저장 후 멈춥니다. 완료되면 닫을 수 있습니다.'); return } void run('수정 내용을 저장하는 중', async () => { await save(); onClose() }) }
  const exportCurrent = () => run('엑셀을 만드는 중', async () => {
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
  return <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/50 p-2 sm:p-5" role="dialog" aria-modal="true" aria-label="통합 재고 가져오기">
    <div className="flex max-h-[95vh] w-full max-w-7xl flex-col rounded-2xl bg-white text-slate-800 shadow-xl dark:bg-slate-900 dark:text-slate-100">
      <header className="flex items-center justify-between border-b p-4 dark:border-slate-700"><div><h2 className="text-lg font-bold">기존 장부에서 재고 가져오기</h2><p className="text-xs text-slate-500">파일이나 종이를 올리고 확인할 부분만 수정하세요. 3D 배치는 나중에 할 수 있습니다.</p></div><button onClick={close} aria-label="닫기" className="p-2"><X /></button></header>
      <div className="overflow-y-auto p-4">
        {error && <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}{job && <button disabled={Boolean(busy)} className={`${buttonClass} mt-2 block`} onClick={() => void load(job.id)}>미저장 수정을 취소하고 저장된 작업 다시 열기</button>}</div>}
        {notice && <div role="status" className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-200">{notice}</div>}
        {busy && <div role="status" className="mb-3 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{busy}<button className={buttonClass} onClick={() => { pause.current = true }}>현재 단계 후 멈춤</button></div>}
        <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => filesRef.current?.click()}><Upload className="mr-1 inline h-4 w-4" />자료 추가</button><label className={buttonClass}>종이 촬영<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={e => { const f = [...(e.target.files || [])]; e.target.value = ''; void addFiles(f) }} /></label><button className={buttonClass} onClick={exportCurrent}>현재 재고 내보내기</button>{job && <button className={buttonClass} onClick={() => void run('저장 중', async () => { await save(); jobRef.current = null; setJob(null); setStep('sources') })}>새 가져오기</button>}</div>
          <input ref={filesRef} type="file" multiple accept={IMPORT_ACCEPT} className="sr-only" onChange={e => { const f = [...(e.target.files || [])]; e.target.value = ''; void addFiles(f) }} />
          {!job && <><div className="rounded-xl border-2 border-dashed p-8 text-center" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void addFiles([...e.dataTransfer.files]) }}><FileText className="mx-auto mb-2 h-9 w-9 text-emerald-600" /><p>엑셀·CSV·PDF·사진을 여기에 놓으세요</p><p className="mt-2 text-xs text-slate-500">파일당 20MB · 작업당 100MB / 10,000행 / 50페이지<br />HWP·DOCX는 PDF로 저장하면 가져올 수 있습니다.</p></div>{recent.length > 0 && <div><h3 className="mb-2 font-semibold">이어서 가져오기</h3><div className="flex flex-wrap gap-2">{recent.map(r => <button key={r.id} className={buttonClass} onClick={() => void load(r.id)}>{r.name} · {new Date(r.updated_at).toLocaleDateString()}</button>)}</div></div>}</>}
          {conflict && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">같은 파일의 작업이 있습니다: {conflict.name}<div className="mt-2 flex gap-2"><button className={buttonClass} onClick={() => void load(conflict.id)}>기존 작업 이어서</button><button className={buttonClass} onClick={() => void addFiles(conflict.files, true)}>{job ? '현재 작업에도 추가' : '별도 작업으로 가져오기'}</button></div></div>}
          {job && <>
            <div className="flex flex-wrap items-center gap-2"><button className={buttonClass} onClick={() => setStep('sources')}>1. 자료와 열 연결</button><button className={buttonClass} onClick={() => setStep('review')}>2. 확인과 등록</button><span className="text-xs text-slate-500">{job.sources.length}개 파일 · {dirty ? '저장할 수정 내용 있음' : '진행 내용 저장됨'}</span></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">{(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map(status => <button key={status} className={`rounded-lg border p-2 text-left ${filter === status && step === 'review' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950' : 'dark:border-slate-700'}`} onClick={() => { setFilter(status); setScrollTop(0); setStep('review') }}><span className="block text-xs">{statusLabels[status]}</span><strong className="text-lg">{counts[status]}</strong></button>)}</div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]">
              <section className="min-w-0 space-y-3">
                {step === 'sources' ? <>
                  <label className="flex flex-col gap-1 text-sm">표 선택<select className={inputClass} value={selectedTable} onChange={e => { setSelectedTable(e.target.value); const t = job.tables.find(t => t.id === e.target.value); if (t) setSelectedGrid(`${t.sourceId}/${t.gridId}`) }}><option value="">표를 선택하세요</option>{job.tables.map(t => <option key={t.id} value={t.id}>{t.label}{t.included ? '' : ' (제외)'}</option>)}</select></label>
                  {job.sources.some(s => s.grids.some(g => g.needsAnalysis)) && <button className={buttonClass} onClick={() => void analyze('document', true)}>아직 읽지 않은 문서·사진 분석</button>}
                  {table && tableGrid && <fieldset disabled={job.rows.some(r => r.tableId === table.id && r.importedId)} className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-3 text-sm"><label><input type="checkbox" checked={table.included} onChange={e => changeTable({ included: e.target.checked })} /> 이 표 포함</label><label>방향 <select className={inputClass} value={table.orientation} onChange={e => changeTable({ orientation: e.target.value as ImportTable['orientation'] })}><option value="rows">한 행에 한 시약</option><option value="columns">한 열에 한 시약</option></select></label><button className={buttonClass} onClick={() => void analyze('mapping')}>AI로 열 연결 제안</button></div>
                    <div className="grid grid-cols-3 gap-2">{([['headerRow', '제목 행'], ['headerDepth', '제목 줄 수'], ['startRow', '시작 행'], ['endRow', '끝 행'], ['startColumn', '시작 열'], ['endColumn', '끝 열']] as const).map(([key, label]) => <label key={key} className="text-xs">{label}<input aria-label={label} className={`${inputClass} w-full`} type="number" min="1" value={table[key] + (key === 'headerDepth' ? 0 : 1)} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1) changeTable({ [key]: n - (key === 'headerDepth' ? 0 : 1) }) }} /></label>)}</div>
                    <p className="text-xs text-slate-500">용량과 단위가 다른 열이면 두 열을 연결하세요. 연결하지 않은 열도 추가정보로 보존됩니다.</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{IMPORT_FIELDS.map(field => <label key={field} className="flex flex-col gap-1 text-xs">{FIELD_LABELS[field]}<select className={inputClass} value={table.mapping[field]?.[0] || ''} onChange={e => changeTable({ mapping: { ...table.mapping, [field]: e.target.value ? [e.target.value, ...(table.mapping[field]?.slice(1) || [])] : [] } })}><option value="">연결하지 않음</option>{headers.map(h => <option key={h.id} value={h.id}>{h.label} (열 {Number(h.id.slice(1)) + 1})</option>)}</select>{field === 'capacity' && <select aria-label="용량 단위 열" className={inputClass} value={table.mapping[field]?.[1] || ''} onChange={e => changeTable({ mapping: { ...table.mapping, capacity: [table.mapping.capacity?.[0] || '', e.target.value].filter(Boolean) } })}><option value="">단위 열 추가 연결</option>{headers.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}</select>}</label>)}</div>
                    <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => { changeTable({ confirmed: true }); patchRows(r => r.tableId === table.id, r => ({ ...r, reviewed: true })); setStep('review') }}>이 표의 연결과 원본 확인 완료</button><button className={buttonClass} onClick={() => void run('양식을 저장하는 중', async () => { await save(); await service.saveProfile(jobRef.current!, { name: table.label.slice(0, 200), signature: profileSignature(table, tableGrid), mapping: table.mapping, orientation: table.orientation, headerDepth: table.headerDepth }); setProfiles(await service.profiles(labId)); setNotice('다음에도 같은 구조의 파일에 적용할 수 있습니다.') })}>연결을 연구실 양식으로 저장</button>{compatibleProfiles.map(profile => <button key={profile.id} className={buttonClass} onClick={() => changeTable({ mapping: profile.mapping, needsReview: true, confirmed: false })}>{profile.name} 적용</button>)}</div>
                  </fieldset>}
                </> : <>
                  <div className="flex flex-wrap gap-2">
                    <select aria-label="확인할 문제 종류" className={`${inputClass} w-full sm:w-auto sm:max-w-72`} value={issueFilter} onChange={e => setIssueFilter(e.target.value)}><option value="">모든 문제</option>{issueGroups.map(([code, message]) => <option key={code} value={code}>{message}</option>)}</select>
                    <select aria-label="원본 위치명으로 모아 보기" className={`${inputClass} max-w-full`} value={locationFilter} onChange={e => setLocationFilter(e.target.value)}><option value="">모든 원본 위치명</option>{locationGroups.map(location => <option key={location} value={location || '(빈칸)'}>{location || '(빈칸)'}</option>)}</select>
                    <span className="self-center text-xs text-slate-500">현재 목록 {filtered.length}행</span>
                  </div>
                  <div className="flex flex-wrap gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800"><input aria-label="빈 수량에 적용할 값" className={`${inputClass} w-20`} value={bulkQuantity} onChange={e => setBulkQuantity(e.target.value)} /><button className={buttonClass} onClick={() => patchRows(r => !r.fields.quantity?.trim(), r => ({ ...r, fields: { ...r.fields, quantity: bulkQuantity } }))}>빈 수량에 적용</button><button className={buttonClass} onClick={() => patchRows(r => /^0(?:\s*(개|병|ea))?$/i.test(r.fields.quantity?.trim() || ''), r => ({ ...r, excluded: true }))}>수량 0인 행 제외</button>
                    <select aria-label="일괄 보관위치" className={inputClass} value={bulkLocation} onChange={e => setBulkLocation(e.target.value)}><option value="">위치 미지정</option>{locations.map(l => <option key={l.id} value={`other:${l.id}`}>{l.name}</option>)}{cabinets.map(c => <option key={c.id} value={`cabinet:${c.id}`}>{c.name} (배치 대기)</option>)}</select><button className={buttonClass} onClick={() => { const [kind, id] = bulkLocation.split(':'); const target = (kind === 'cabinet' ? cabinets : locations).find(l => l.id === id); const ids = new Set(filtered.map(r => r.row.id)); patchRows(r => ids.has(r.id), r => ({ ...r, fields: { ...r.fields, storage_type: kind || 'other', storage_location: target?.name || '' } })) }}>현재 목록에 위치 적용</button>
                    <button className={buttonClass} onClick={() => { const ids = new Set(filtered.filter(r => r.status === 'duplicate').map(r => r.row.id)); patchRows(r => ids.has(r.id), r => ({ ...r, duplicateDecision: 'skip' })) }}>중복 후보 제외</button><button className={buttonClass} onClick={() => { const ids = new Set(filtered.filter(r => r.status === 'duplicate').map(r => r.row.id)); patchRows(r => ids.has(r.id), r => ({ ...r, duplicateDecision: 'new' })) }}>중복 후보 별도 등록</button></div>
                  <div className="flex flex-wrap gap-2"><select aria-label="비울 선택 필드" className={inputClass} value={clearField} onChange={e => setClearField(e.target.value as ImportField)}>{IMPORT_FIELDS.filter(field => field !== 'name' && field !== 'quantity').map(field => <option key={field} value={field}>{FIELD_LABELS[field]}</option>)}</select><button className={buttonClass} onClick={() => { const ids = new Set(filtered.map(entry => entry.row.id)); patchRows(row => ids.has(row.id), row => ({ ...row, fields: { ...row.fields, [clearField]: '' } })); setNotice('선택 필드를 비웠습니다. 원문은 추가정보에 보존됩니다.') }}>현재 목록의 선택 필드 비우기</button></div>
                  <div ref={listRef} className="h-[400px] overflow-auto rounded-lg border dark:border-slate-700" onScroll={e => setScrollTop(e.currentTarget.scrollTop)}><div style={{ height: filtered.length * 52, position: 'relative' }}>{visible.map((entry, index) => <button key={entry.row.id} style={{ position: 'absolute', top: (start + index) * 52, height: 52 }} className={`flex w-full items-center gap-2 border-b px-3 text-left text-sm dark:border-slate-700 ${selectedRow === entry.row.id ? 'bg-emerald-50 dark:bg-emerald-950' : ''}`} onClick={() => { setSelectedRow(entry.row.id); const t = job.tables.find(t => t.id === entry.row.tableId); if (t) { setSelectedGrid(`${t.sourceId}/${t.gridId}`); setSelectedTable(t.id) } }}><span className="w-9 shrink-0 text-xs text-slate-500">{entry.row.sourceRow}</span><span className="min-w-0 flex-1 truncate">{entry.row.fields.name || '(시약명 확인 필요)'}</span><span className="w-12 truncate">{entry.row.fields.quantity || '—'}</span><span className={`w-20 shrink-0 text-xs ${entry.row.error || entry.status === 'review' ? 'text-amber-700 dark:text-amber-300' : ''}`}>{entry.row.error && !entry.row.excluded ? '저장 실패' : statusLabels[entry.status]}</span></button>)}</div></div>
                  {currentRow && <fieldset disabled={Boolean(currentRow.importedId)} className="space-y-3 rounded-xl border p-3 dark:border-slate-700"><div className="flex justify-between text-sm"><strong>{currentRow.sourceLabel} · {currentRow.sourceRow}행</strong><label><input type="checkbox" checked={currentRow.excluded} onChange={e => patchRows(r => r.id === currentRow.id, r => ({ ...r, excluded: e.target.checked }))} /> 제외</label></div><div className="text-sm text-amber-700 dark:text-amber-300">{validated.find(r => r.row.id === currentRow.id)?.issues.map((issue, i) => <p key={i}>{issue.message}</p>)}{currentRow.error}</div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{IMPORT_FIELDS.map(field => <label key={field} className="text-xs">{FIELD_LABELS[field]}<input className={`${inputClass} w-full`} value={currentRow.fields[field] || ''} onChange={e => patchRows(r => r.id === currentRow.id, r => ({ ...r, fields: { ...r.fields, [field]: e.target.value } }))} />{currentRow.originalFields[field] !== currentRow.fields[field] && <span className="text-slate-500">원본: {currentRow.originalFields[field] || '(빈칸)'}</span>}</label>)}</div><div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => patchRows(r => r.id === currentRow.id, r => ({ ...r, reviewed: true }))}>이 행 원본 확인 완료</button><button className={buttonClass} onClick={() => patchRows(r => r.id === currentRow.id, r => ({ ...r, duplicateDecision: 'new' }))}>별도 재고로 등록</button></div><details><summary className="text-sm">보존된 원본 열 전체</summary><dl className="mt-2 space-y-1 text-xs">{currentRow.attributes.map((a, i) => <div key={i} className="break-words"><dt className="inline font-bold">{a.label} ({a.address}): </dt><dd className="inline">{a.value || '(빈칸)'}</dd></div>)}</dl></details></fieldset>}
                </>}
              </section>
              <aside className="min-w-0 space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50"><label className="flex flex-col gap-1 text-xs">원본 시트 / 페이지<select className={inputClass} value={selectedGrid} onChange={e => { setSelectedGrid(e.target.value); const t = job.tables.find(t => `${t.sourceId}/${t.gridId}` === e.target.value); setSelectedTable(t?.id || '') }}><option value="">선택하세요</option>{job.sources.flatMap(s => s.grids.map(g => <option key={`${s.id}/${g.id}`} value={`${s.id}/${g.id}`}>{s.name} · {g.label}{g.hidden ? ' (숨김 시트)' : ''}</option>))}</select></label>
                {grid?.imagePath && <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={pageRows.some(r => r.importedId)} onClick={() => void analyze('document')}>{grid.needsAnalysis ? '이 페이지 분석' : '이 페이지 다시 분석'}</button><button className={buttonClass} disabled={pageRows.some(r => r.importedId)} onClick={() => void run('페이지를 나누는 중', async () => {
                  await save(); if (!gridSource || !grid.imagePath) return
                  const images = await splitDocumentImage(await service.download(grid.imagePath)); const active = jobRef.current!
                  if (active.sources.reduce((n, s) => n + s.grids.filter(g => g.page).length, 0) >= IMPORT_LIMITS.pages) throw new Error('작업당 페이지/영역 수가 50개를 넘습니다.')
                  const split = images.map((imageData, i) => ({ id: `${grid.id}-${crypto.randomUUID().slice(0, 8)}`, label: `${grid.label} ${i === 0 ? '위쪽' : '아래쪽'}`, page: grid.page, cells: [], imageData, needsAnalysis: true, imagePath: '' }))
                  for (const part of split) { part.imagePath = `${active.id}/${gridSource.id}/${part.id}.jpg`; await service.upload(part.imagePath, await dataUrlBlob(part.imageData)) }
                  const sources = active.sources.map(s => s.id === gridSource.id ? { ...s, grids: s.grids.flatMap(g => g.id === grid.id ? split : [g]) } : s)
                  const tables = active.tables.filter(t => !(t.sourceId === gridSource.id && t.gridId === grid.id)); const rows = buildImportRows(sources, tables, active.rows)
                  update({ ...active, sources, tables, rows }, [], true); await save(); setSelectedGrid(`${gridSource.id}/${split[0].id}`); setSelectedTable('')
                })}>위·아래 영역으로 나누기</button></div>}
                {grid?.analysisWarnings?.map((warning, i) => <p key={i} className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>)}
                {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="block"><div className="relative"><img src={sourceUrl} alt="재고 장부 원본" className="w-full rounded-lg" />{sourceRow?.cells.filter(c => c.bounds).map((cell, i) => <span key={i} className="pointer-events-none absolute border-2 border-emerald-500 bg-emerald-400/10" style={{ left: `${cell.bounds![0] * 100}%`, top: `${cell.bounds![1] * 100}%`, width: `${(cell.bounds![2] - cell.bounds![0]) * 100}%`, height: `${(cell.bounds![3] - cell.bounds![1]) * 100}%` }} />)}</div><span className="text-xs underline">원본 크게 보기</span></a>}
                {!!previewCells.length && <div className="max-h-80 overflow-auto"><table className="w-full border-collapse text-xs"><tbody>{previewCells.slice(previewStart, previewStart + 15).map((row, i) => <tr key={i} className={sourceRow?.sourceRow === previewStart + i + 1 ? 'bg-emerald-100 dark:bg-emerald-950' : ''}><th className="border p-1"><button disabled={!table || job.rows.some(r => r.tableId === table.id && r.importedId)} title="이 행을 제목 행으로 선택" onClick={() => { setSelectedRow(''); changeTable({ headerRow: previewStart + i, headerDepth: 1, confirmed: false, needsReview: true }) }}>{previewStart + i + 1}</button></th>{row.map(cell => <td key={cell.address} className="whitespace-nowrap border p-1 dark:border-slate-600" title={cell.address}>{cell.text || '—'}</td>)}</tr>)}</tbody></table></div>}
                {gridSource?.kind === 'delimited' && <div className="space-y-2"><p className="text-xs">문자 인코딩: {gridSource.encoding}{gridSource.encodingUncertain ? ' · 확인 필요' : ''}</p><select aria-label="문자 인코딩" className={inputClass} value={encoding} onChange={e => setEncoding(e.target.value)}><option value="utf-8">UTF-8</option><option value="euc-kr">CP949 (한국어)</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select><select aria-label="구분자" className={inputClass} value={delimiter} onChange={e => setDelimiter(e.target.value)}><option value=",">쉼표</option><option value=";">세미콜론</option><option value={'\t'}>탭</option><option value="|">세로줄</option></select><button className={buttonClass} disabled={job.rows.some(r => r.sourceId === gridSource.id && r.importedId)} onClick={() => void run('다시 읽는 중', async () => { await save(); const file = new File([await service.download(gridSource.path!)], gridSource.name); const { source: parsed } = await readInWorker(file, { encoding, delimiter }, gridSource.id); const active = jobRef.current!; const changed = { ...parsed, id: gridSource.id, path: gridSource.path }; const sources = active.sources.map(s => s.id === changed.id ? changed : s); const tables = [...active.tables.filter(t => t.sourceId !== changed.id), ...detectTables(changed)]; const rows = buildImportRows(sources, tables, active.rows); update({ ...active, sources, tables, rows }, rows.filter(r => r.sourceId === changed.id).map(r => r.id), true); await save() })}>선택한 설정으로 다시 읽기</button></div>}
                {pageRows.length > 0 && (gridSource?.kind === 'pdf' || gridSource?.kind === 'image') && <button className={buttonClass} onClick={() => { const ids = new Set(pageRows.map(r => r.id)); patchRows(r => ids.has(r.id), r => ({ ...r, reviewed: true })); setNotice(`원본과 ${pageRows.length}행 확인 완료. 수량·날짜 등 오류는 별도로 수정해 주세요.`) }}>원본과 이 페이지 {pageRows.length}행 확인 완료</button>}
              </aside>
            </div>
          </>}
        </fieldset>
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t p-3 dark:border-slate-700">{confirmCommit && <p className="w-full text-right text-sm">준비된 {counts.ready}건을 새로 등록합니다. 확인 필요 {counts.review}건·중복 후보 {counts.duplicate}건은 남겨둡니다.</p>}<button className={buttonClass} disabled={Boolean(busy) || !dirty} onClick={() => void run('수정 내용을 저장하는 중', async () => { await save() })}><Save className="mr-1 inline h-4 w-4" />수정 저장</button><button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" disabled={Boolean(busy) || !counts.ready} onClick={() => confirmCommit ? void commit() : setConfirmCommit(true)}><CheckCircle2 className="mr-1 inline h-4 w-4" />{confirmCommit ? `${counts.ready}건 등록 확정` : `준비된 ${counts.ready}건 등록`}</button></footer>
    </div>
  </div>
}
