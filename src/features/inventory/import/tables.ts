import { matchImportHeader, token } from './normalize'
import { IMPORT_LIMITS, type ImportCell, type ImportDraftRow, type ImportGrid, type ImportMapping, type ImportSource, type ImportTable, type ImportValues } from './types'

export function orientedCells(grid: ImportGrid, orientation: ImportTable['orientation']): ImportCell[][] {
  if (orientation === 'rows') return grid.cells
  const width = Math.max(0, ...grid.cells.map(row => row.length))
  return Array.from({ length: width }, (_, c) => grid.cells.map((row, r) => row[c] || { address: `${r}:${c}`, raw: null, text: '' }))
}
export function tableHeaders(table: ImportTable, grid: ImportGrid): Array<{ id: string; label: string }> {
  const cells = orientedCells(grid, table.orientation)
  return Array.from({ length: Math.max(0, table.endColumn - table.startColumn + 1) }, (_, offset) => {
    const col = offset + table.startColumn
    const labels = [...new Set(cells.slice(table.headerRow, table.headerRow + table.headerDepth).map(row => row[col]?.text.trim()).filter(Boolean))]
    return { id: `c${col}`, label: labels.join(' / ') || `열 ${col + 1}` }
  })
}
export function defaultMapping(table: ImportTable, grid: ImportGrid): ImportMapping {
  const mapping: ImportMapping = {}
  for (const header of tableHeaders(table, grid)) {
    const field = matchImportHeader(header.label) || header.label.split(' / ').map(matchImportHeader).find(Boolean)
    if (field && !mapping[field]) mapping[field] = [header.id]
  }
  return mapping
}
export function detectTables(source: ImportSource): ImportTable[] {
  const result: ImportTable[] = []
  for (const grid of source.grids) {
    if (grid.needsAnalysis || !grid.cells.some(row => row.some(cell => cell.text.trim()))) continue
    let orientation: ImportTable['orientation'] = 'rows'
    const firstColumnScore = grid.cells.filter(row => matchImportHeader(row[0]?.text || '')).length
    const maxRowScore = Math.max(0, ...grid.cells.map(row => row.filter(cell => matchImportHeader(cell.text)).length))
    if (firstColumnScore >= 3 && firstColumnScore > maxRowScore) orientation = 'columns'
    const cells = orientedCells(grid, orientation)
    const width = Math.max(0, ...cells.map(row => row.length))
    const candidates: Array<{ row: number; depth: number; start: number; end: number; uncertain: boolean }> = []
    for (let index = 0; index < cells.length; index++) {
      const row = cells[index]
      const names = row.flatMap((cell, c) => matchImportHeader(cell.text) === 'name' ? [c] : [])
      if (!names.length) continue
      const starts = [0, ...names.slice(1).map(c => {
        // A blank separator may precede a row-number column and the next name.
        for (let gap = c - 1; gap > names[names.indexOf(c) - 1]; gap--) if (!row[gap]?.text.trim()) return gap + 1
        return c
      })]
      let consumedDepth = 1
      for (const [part, start] of starts.entries()) {
        const end = (starts[part + 1] ?? width) - 1
        const fields = row.slice(start, end + 1).map(c => matchImportHeader(c.text)).filter(Boolean)
        let depth = 1
        if (new Set(fields).size < 2) {
          const nextFields = (cells[index + 1] || []).slice(start, end + 1).map(c => matchImportHeader(c.text)).filter(Boolean)
          if (new Set([...fields, ...nextFields]).size < 2) continue
          depth = 2; consumedDepth = 2
        }
        candidates.push({ row: index, depth, start, end, uncertain: names.length > 1 || depth > 1 })
      }
      index += consumedDepth - 1
    }
    const headers = candidates.length ? candidates : [{ row: cells.findIndex(row => row.some(cell => cell.text.trim())), depth: 1, start: 0, end: width - 1, uncertain: true }]
    for (let h = 0; h < headers.length; h++) {
      const header = headers[h]
      const next = headers.slice(h + 1).find(candidate => candidate.row > header.row && candidate.start <= header.end && candidate.end >= header.start)
      const table: ImportTable = { id: `${source.id}/${grid.id}/${header.row}/${header.start}`, sourceId: source.id, gridId: grid.id,
        label: `${source.name} · ${grid.label}${headers.length > 1 ? ` · 표 ${h + 1}` : ''}`, headerRow: header.row, headerDepth: header.depth,
        startRow: header.row + header.depth, endRow: (next?.row ?? cells.length) - 1,
        startColumn: header.start, endColumn: header.end, orientation, mapping: {},
        included: !grid.hidden, needsReview: header.uncertain || Boolean(source.encodingUncertain || grid.analysisWarnings?.length || grid.handwriting), confirmed: false }
      table.mapping = defaultMapping(table, grid)
      result.push(table)
    }
  }
  return result
}
export function profileSignature(table: ImportTable, grid: ImportGrid): string {
  return `${table.orientation}:${table.headerDepth}:${tableHeaders(table, grid).map(h => `${h.id}=${token(h.label)}`).join('|')}`
}
export function rowsFromTable(table: ImportTable, source: ImportSource): ImportDraftRow[] {
  const grid = source.grids.find(item => item.id === table.gridId)
  if (!grid || !table.included) return []
  const cells = orientedCells(grid, table.orientation)
  const headers = tableHeaders(table, grid)
  const rows: ImportDraftRow[] = []
  for (let r = Math.max(table.startRow, table.headerRow + table.headerDepth); r <= Math.min(table.endRow, cells.length - 1); r++) {
    const row = cells[r] || []
    const selectedCells = row.slice(table.startColumn, table.endColumn + 1)
    if (!selectedCells.some(cell => cell.text.trim() || cell.issue)) continue
    const fields: ImportValues = {}
    for (const [field, ids] of Object.entries(table.mapping)) {
      fields[field as keyof ImportValues] = ids!.map(id => {
        const cell = row[Number(id.slice(1))]
        // Display formatting can hide zero or round 1.5 to "2". Counts must use
        // the actual number; identifiers still use their formatted leading zeros.
        if ((field === 'quantity' || (field === 'capacity' && ids!.length > 1)) && typeof cell?.raw === 'number') return String(cell.raw)
        return cell?.text.trim() || ''
      }).filter(Boolean).join(' ')
    }
    const summary = /^(합계|소계|총계|total|subtotal)(\s|$)/i.test((fields.name || selectedCells.find(c => c.text.trim())?.text || '').trim())
    const repeatedHeader = matchImportHeader(fields.name || '') === 'name' && Object.values(fields).filter(v => matchImportHeader(v || '')).length >= 2
    rows.push({ id: `${table.id}/${r}`, sourceId: source.id, tableId: table.id, sourceLabel: table.label, sourceRow: r + 1,
      fields, originalFields: { ...fields }, cells: selectedCells,
      attributes: headers.map(header => ({ label: header.label, value: row[Number(header.id.slice(1))]?.text || '', address: row[Number(header.id.slice(1))]?.address || header.id })),
      reviewRequired: (table.needsReview && !table.confirmed) || source.kind === 'image' || source.kind === 'pdf',
      reviewed: table.confirmed, excluded: summary || repeatedHeader,
      ...(summary || repeatedHeader ? { error: summary ? '소계/합계 행 (제외 제안)' : '반복 제목 행 (제외 제안)' } : {}) })
  }
  return rows
}
export function buildImportRows(sources: ImportSource[], tables: ImportTable[], previous: ImportDraftRow[] = []): ImportDraftRow[] {
  const old = new Map(previous.map(row => [row.id, row]))
  const rows = tables.flatMap(table => {
    const source = sources.find(item => item.id === table.sourceId)
    return source ? rowsFromTable(table, source) : []
  }).map(row => {
    const existing = old.get(row.id)
    if (!existing) return row
    if (existing.importedId) return existing
    // Preserve edits only when the source-to-field mapping has not changed.
    return JSON.stringify(existing.originalFields) === JSON.stringify(row.originalFields) ? { ...row, ...existing } : row
  })
  if (rows.length > IMPORT_LIMITS.rows) throw new Error('10,000행을 넘습니다. 표 범위를 나누어 가져오세요. 일부 행만 등록하지 않았습니다.')
  return rows
}
