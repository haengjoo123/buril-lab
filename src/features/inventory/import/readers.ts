import * as XLSX from 'xlsx'
import * as cptable from 'xlsx/dist/cpexcel.full.mjs'
import { parseCsvText } from '../../../utils/csvFiles'
import i18n from '../../../locales/i18n'
import { IMPORT_LIMITS, type ImportCell, type ImportGrid, type ImportSource } from './types'

XLSX.set_cptable(cptable)
export interface ReadImportOptions { encoding?: string; delimiter?: string }
export const IMPORT_ACCEPT = '.xlsx,.xls,.csv,.tsv,.pdf,.jpg,.jpeg,.png,.webp'
export function importKind(name: string): ImportSource['kind'] {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'xlsx' || ext === 'xls') return 'spreadsheet'
  if (ext === 'csv' || ext === 'tsv') return 'delimited'
  if (ext === 'pdf') return 'pdf'
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) return 'image'
  throw new Error(i18n.t('inv_err_file_type'))
}
export function checkImportFiles(files: Array<{ name: string; size: number }>, existingBytes = 0) {
  for (const file of files) {
    importKind(file.name)
    if (file.size > IMPORT_LIMITS.fileBytes || file.size === 0) throw new Error(i18n.t('inv_err_file_empty_or_large', { name: file.name }))
  }
  if (files.reduce((n, file) => n + file.size, existingBytes) > IMPORT_LIMITS.totalBytes) throw new Error(i18n.t('inv_err_total_size'))
}
export async function hashImportBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')
}
export function decodeImportText(bytes: Uint8Array, requested?: string) {
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null
  const sample = bytes.subarray(0, 4096)
  const evenZeros = sample.filter((byte, i) => byte === 0 && i % 2 === 0).length
  const oddZeros = sample.filter((byte, i) => byte === 0 && i % 2 === 1).length
  const inferredUtf16 = sample.length >= 4 && Math.max(evenZeros, oddZeros) > sample.length / 8
    ? evenZeros > oddZeros ? 'utf-16be' : 'utf-16le' : null
  let encoding = requested || bom || inferredUtf16 || 'utf-8'
  let uncertain = !requested && !bom && Boolean(inferredUtf16)
  let text: string
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes) }
  catch {
    if (requested || bom) throw new Error(i18n.t('inv_err_encoding_unreadable'))
    encoding = 'euc-kr'; uncertain = true
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes) }
    catch { throw new Error(i18n.t('inv_err_encoding_check')) }
  }
  if (text.includes('\u0000')) throw new Error(i18n.t('inv_err_encoding_utf16'))
  return { text: text.replace(/^\uFEFF/, ''), encoding, uncertain }
}
export function detectImportDelimiter(text: string): string {
  const candidates = [',', '\t', ';', '|'].map(delimiter => {
    const rows = parseCsvText(text, delimiter).filter(row => row.some(Boolean)).slice(0, 50)
    const widths = rows.map(row => row.length).filter(n => n > 1)
    const frequencies = new Map<number, number>()
    for (const width of widths) frequencies.set(width, (frequencies.get(width) || 0) + 1)
    return { delimiter, score: Math.max(0, ...Array.from(frequencies, ([width, count]) => count * 10 + Math.min(width, 20))) }
  })
  return candidates.sort((a, b) => b.score - a.score)[0].delimiter
}
export function gridFromText(rows: string[][], id: string, label: string): ImportGrid {
  if (rows.reduce((n, row) => n + row.length, 0) > IMPORT_LIMITS.cells) throw new Error(i18n.t('inv_err_table_too_big'))
  return { id, label, cells: rows.map((row, r) => row.map((value, c) => ({ address: XLSX.utils.encode_cell({ r, c }), raw: value, text: value }))) }
}
export function readSpreadsheet(bytes: ArrayBuffer): ImportGrid[] {
  const workbook = XLSX.read(bytes, { type: 'array', cellNF: true, cellText: true, cellFormula: true, cellDates: false, bookVBA: false })
  let totalCells = 0
  return workbook.SheetNames.map((label, sheetIndex) => {
    const sheet = workbook.Sheets[label]
    const ref = sheet['!ref']
    if (!ref) return { id: `sheet-${sheetIndex}`, label, cells: [] }
    const range = XLSX.utils.decode_range(ref)
    totalCells += (range.e.r + 1) * (range.e.c + 1)
    if (totalCells > IMPORT_LIMITS.cells) throw new Error(i18n.t('inv_err_cells_limit'))
    const cells: ImportCell[][] = []
    for (let r = 0; r <= range.e.r; r++) {
      const row: ImportCell[] = []
      for (let c = 0; c <= range.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c })
        const cell = sheet[address] as XLSX.CellObject | undefined
        let raw = cell?.v ?? null
        let text = cell?.w ?? (raw == null ? '' : String(raw))
        if (cell?.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
          const date = XLSX.SSF.parse_date_code(Number(cell.v), { date1904: workbook.Workbook?.WBProps?.date1904 })
          if (date) text = `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
        }
        if (raw instanceof Date) raw = raw.toISOString()
        row.push({ address, raw, text, ...(cell?.f ? { formula: cell.f } : {}),
          ...(cell?.f && cell.v == null ? { issue: i18n.t('inv_issue_formula_no_result') } : cell?.t === 'e' ? { issue: i18n.t('inv_issue_excel_error') } : {}) })
      }
      cells.push(row)
    }
    for (const merge of sheet['!merges'] || []) {
      const parent = cells[merge.s.r]?.[merge.s.c]
      if (!parent) continue
      for (let r = merge.s.r; r <= Math.min(merge.e.r, range.e.r); r++) for (let c = merge.s.c; c <= Math.min(merge.e.c, range.e.c); c++) {
        if (r !== merge.s.r || c !== merge.s.c) cells[r][c] = { ...parent, raw: cells[r][c].raw, address: XLSX.utils.encode_cell({ r, c }), mergedFrom: parent.address }
      }
    }
    return { id: `sheet-${sheetIndex}`, label, cells, hidden: Boolean(workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden) }
  })
}
export async function readImportSource(name: string, bytes: ArrayBuffer, id: string, options: ReadImportOptions = {}): Promise<ImportSource> {
  checkImportFiles([{ name, size: bytes.byteLength }])
  const kind = importKind(name)
  const hash = await hashImportBytes(bytes)
  if (kind === 'spreadsheet') return { id, name, size: bytes.byteLength, hash, kind, grids: readSpreadsheet(bytes) }
  if (kind === 'delimited') {
    const decoded = decodeImportText(new Uint8Array(bytes), options.encoding)
    const delimiter = options.delimiter || (name.endsWith('.tsv') ? '\t' : detectImportDelimiter(decoded.text))
    return { id, name, size: bytes.byteLength, hash, kind, encoding: decoded.encoding, encodingUncertain: decoded.uncertain, delimiter,
      grids: [gridFromText(parseCsvText(decoded.text, delimiter), 'text', name)] }
  }
  return { id, name, size: bytes.byteLength, hash, kind, grids: [] }
}
