import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { decodeImportText, detectImportDelimiter, gridFromText, readSpreadsheet } from './readers'
import { buildImportRows, defaultMapping, detectTables, profileSignature } from './tables'
import { normalizeImportDate, parseImportQuantity, validateImportRows } from './normalize'
import type { ImportSource } from './types'
import { exportImportAttributes } from './sourceAttributes'
import { readPdfTextTable } from './pdfText'

const source = (rows: string[][]): ImportSource => ({ id: 'source', name: 'lab.csv', size: 20, hash: 'abc', kind: 'delimited', grids: [gridFromText(rows, 'sheet', 'Lab')] })
const parse = (rows: string[][]) => { const s = source(rows); return buildImportRows([s], detectTables(s)) }
const context = { existing: [], locations: [{ id: 'room301', name: '301호 서랍' }], cabinets: [{ id: 'cab', name: 'A 시약장' }] }

describe('inventory import: preserve values and uncertainty', () => {
  it.each([['0', 0], ['1,000', 1000], ['2 병', 2], ['１２개', 12], ['1.5', null], ['1,5', null], ['', null], ['unknown', null], ['-1', null], ['1e3', null], ['1000001', null]])('quantity %s => %s', (raw, expected) => expect(parseImportQuantity(String(raw))).toBe(expected))
  it('does not default an empty quantity and keeps zero separate', () => {
    const checked = validateImportRows(parse([['시약명', '수량'], ['A', '0'], ['B', '']]), context)
    expect(checked[0].row.fields.quantity).toBe('0')
    expect(checked[0].issues.some(i => i.code === 'zero')).toBe(true)
    expect(checked[1].issues.some(i => i.code === 'quantity')).toBe(true)
  })
  it('allows unspecified locations and a cabinet without bottle models', () => {
    const rows = parse([['시약명', '수량', '위치'], ['A', '2', ''], ['B', '1', 'A 시약장'], ['C', '1', '301호 서랍']])
    const checked = validateImportRows(rows, context)
    expect(checked.map(r => r.status)).toEqual(['ready', 'ready', 'ready'])
    expect(checked[1].input?.cabinet_id).toBe('cab')
    expect(checked[2].input?.storage_location_id).toBe('room301')
  })
  it('requires review for an ambiguous location, invalid CAS and ambiguous date', () => {
    const row = parse([['시약명', '수량', 'CAS', '유효기간', '위치'], ['A', '2', '64-17-9', '03/04/2026', '없는 위치']])
    expect(validateImportRows(row, context)[0].issues.map(i => i.code)).toEqual(expect.arrayContaining(['cas', 'date', 'location']))
    expect(normalizeImportDate('2026년 9월 22일')).toBe('2026-09-22')
    expect(normalizeImportDate('2026-02-30')).toBeNull()
  })
  it('keeps duplicate headers separately and retains unmapped source columns', () => {
    const s = source([['시약명', '수량', '수량', 'Lot', '농도'], ['A', '2', '7', 'L-001', '70%']])
    const tables = detectTables(s); tables[0].mapping.quantity = ['c2']
    const rows = buildImportRows([s], tables)
    expect(rows[0].fields.quantity).toBe('7')
    expect(rows[0].attributes.map(a => a.value)).toEqual(['A', '2', '7', 'L-001', '70%'])
    expect(exportImportAttributes(rows[0].attributes)).toMatchObject({ '원본 · 수량': '2', '원본 · 수량 (2)': '7', '원본 · 농도': '70%' })
  })
  it('detects a header below row 30 and every repeated table', () => {
    const rows = parse([['안내'], ...Array.from({ length: 32 }, () => []), ['시약명', '수량'], ['A', '2'], ['시약명', '수량'], ['B', '3'], ['합계', '5']])
    expect(rows.filter(r => !r.excluded).map(r => r.fields.name)).toEqual(['A', 'B'])
    expect(rows.find(r => r.fields.name === '합계')?.excluded).toBe(true)
  })
  it('reads a transposed ledger and joins split amount/unit columns', () => {
    const s = source([['시약명', 'A', 'B'], ['수량', '2', '3'], ['용량', '500', '1'], ['단위', 'mL', 'L']])
    const tables = detectTables(s)
    expect(tables[0].orientation).toBe('columns')
    tables[0].mapping.capacity = ['c2', 'c3']
    expect(buildImportRows([s], tables).map(r => r.fields.capacity)).toEqual(['500 mL', '1 L'])
  })
  it('separates side-by-side tables without losing duplicate field names', () => {
    const s = source([['시약명', '수량', '', '번호', '시약명', '수량'], ['A', '2', '', '01', 'B', '7']])
    const tables = detectTables(s)
    expect(tables).toHaveLength(2)
    const rows = buildImportRows([s], tables)
    expect(rows.map(row => row.fields.quantity)).toEqual(['2', '7'])
    expect(rows[1].attributes[0].value).toBe('01')
    expect(rows.every(row => row.reviewRequired)).toBe(true)
  })
  it('automatically proposes a multi-row header and requires confirmation', () => {
    const s = source([['시약명', '재고', '재고'], ['', '수량', '용량'], ['A', '2', '500 mL']])
    const tables = detectTables(s)
    expect(tables[0].headerDepth).toBe(2)
    expect(buildImportRows([s], tables)[0]).toMatchObject({ fields: { quantity: '2', capacity: '500 mL' }, reviewRequired: true })
  })
  it('normalizes valid CAS and capacity spelling and rejects conflicting dates', () => {
    const rows = parse([['시약명', '수량', 'CAS', '용량'], ['A', '1', '６４-１７-５', '５００ ｍＬ']])
    expect(validateImportRows(rows, context)[0].input).toMatchObject({ cas_number: '64-17-5', capacity: '500 mL' })
    rows[0].fields.manufacturer_date = '2025-01-02'; rows[0].fields.expiry_date = '2026-02-03'
    expect(validateImportRows(rows, context)[0].issues.some(issue => issue.code === 'date_conflict')).toBe(true)
  })
  it('supports multi-row headers and invalidates a saved profile on shape changes', () => {
    const s = source([['시약명', '재고', '재고'], ['', '수량', '용량'], ['A', '2', '500 mL']])
    const tables = detectTables(s); tables[0].headerDepth = 2; tables[0].startRow = 2; tables[0].mapping = defaultMapping(tables[0], s.grids[0])
    expect(buildImportRows([s], tables)[0].fields.quantity).toBe('2')
    const signature = profileSignature(tables[0], s.grids[0])
    s.grids[0].cells[1][1].text = '잔량'
    expect(profileSignature(tables[0], s.grids[0])).not.toBe(signature)
  })
  it('flags duplicates within a file and existing inventory without merging them', () => {
    const rows = parse([['시약명', '수량'], ['A', '2'], ['A', '3']])
    expect(validateImportRows(rows, context).map(r => r.status)).toEqual(['duplicate', 'duplicate'])
    rows.forEach(row => { row.duplicateDecision = 'new' })
    expect(validateImportRows(rows, context).map(r => r.input?.quantity)).toEqual([2, 3])
    rows[0].importedId = 'registered'; rows[1].duplicateDecision = undefined
    expect(validateImportRows(rows, context)[1].status).toBe('duplicate')
  })
  it('requires source review for image rows even with valid-looking values', () => {
    const s = source([['시약명', '수량'], ['A', '2']]); s.kind = 'image'
    const rows = buildImportRows([s], detectTables(s))
    expect(validateImportRows(rows, context)[0].status).toBe('review')
    rows[0].reviewed = true
    expect(validateImportRows(rows, context)[0].status).toBe('ready')
  })
  it('preserves user edits on resume and never rewrites an imported row', () => {
    const s = source([['시약명', '수량'], ['A', '2']]); const tables = detectTables(s)
    const rows = buildImportRows([s], tables); rows[0].fields.quantity = '8'
    expect(buildImportRows([s], tables, rows)[0].fields.quantity).toBe('8')
    rows[0].importedId = 'registered'; tables[0].mapping.quantity = ['c0']
    expect(buildImportRows([s], tables, rows)[0].importedId).toBe('registered')
  })
  it('handles 10000 data rows and rejects overflow without truncating', () => {
    const data = [['시약명', '수량'], ...Array.from({ length: 10000 }, (_, i) => [`Reagent ${i}`, '1'])]
    expect(parse(data)).toHaveLength(10000)
    expect(() => parse([...data, ['overflow', '1']])).toThrow('10,000')
  })
})

describe('text PDF extraction', () => {
  it('keeps aligned text, zero and normalized source coordinates', () => {
    const items = [['시약명', 20, 100], ['수량', 200, 100], ['A', 20, 80], ['0', 200, 80]].map(([str, x, y]) => ({ str: String(str), x: Number(x), y: Number(y), width: 40, height: 10 }))
    const cells = readPdfTextTable(items, 1, 300, 200)!
    expect(cells[1].map(cell => cell.text)).toEqual(['A', '0'])
    expect(cells[1][0].bounds).toEqual([20 / 300, 0.55, 0.2, 0.6])
    expect(readPdfTextTable([{ str: 'Unstructured document', x: 20, y: 100, width: 50, height: 10 }], 1, 300, 200)).toBeNull()
  })
})
describe('source readers', () => {
  it('reads every sheet, literal zero, formatted product codes, dates and merged cells', () => {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['안내문']]), '안내')
    const ws = XLSX.utils.aoa_to_sheet([['시약명', '수량', '제품번호', '유효기간', '위치'], ['A', 0, 123, 45000, '냉장고'], ['B', 2, 456, 45001, '']])
    ws.C2.z = '00000'; ws.D2.z = 'yyyy-mm-dd'; ws['!merges'] = [{ s: { r: 1, c: 4 }, e: { r: 2, c: 4 } }]
    XLSX.utils.book_append_sheet(wb, ws, '재고')
    const grids = readSpreadsheet(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
    expect(grids).toHaveLength(2)
    expect(grids[1].cells[1][1]).toMatchObject({ raw: 0, text: '0' })
    expect(grids[1].cells[1][2].text).toBe('00123')
    expect(grids[1].cells[1][3].text).toBe('2023-03-15')
    expect(grids[1].cells[2][4]).toMatchObject({ text: '냉장고', mergedFrom: 'E2' })
  })
  it('reads binary XLS as well as XLSX', () => {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['시약명', '수량'], ['에탄올', 2]]), '재고')
    expect(readSpreadsheet(XLSX.write(wb, { type: 'array', bookType: 'biff8' }))[0].cells[1][0].text).toBe('에탄올')
  })
  it('uses cached numeric values when formatting rounds decimals or hides zero', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([['시약명', '수량'], ['Fraction', 1.5], ['Empty', 0]])
    ws.B2.z = '0'; ws.B3.z = '0;-0;""'
    ws.B3.f = '1-1'
    XLSX.utils.book_append_sheet(wb, ws, '재고')
    const s = source([]); s.grids = readSpreadsheet(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
    const rows = buildImportRows([s], detectTables(s))
    expect(rows.map(row => row.fields.quantity)).toEqual(['1.5', '0'])
    expect(rows[1].cells[1].formula).toBe('1-1')
    expect(validateImportRows(rows, context).every(row => row.status === 'review')).toBe(true)
  })
  it('detects delimiter outside quoted commas and preserves Korean text encodings', () => {
    expect(detectImportDelimiter('시약명;수량;메모\nA;2;"x,y"')).toBe(';')
    expect(detectImportDelimiter('시약명\t수량\nA\t2')).toBe('\t')
    expect(decodeImportText(new Uint8Array([0xff, 0xfe, 0x41, 0, 0x2c, 0, 0x42, 0])).text).toBe('A,B')
    expect(decodeImportText(new Uint8Array([0x41, 0, 0x2c, 0, 0x42, 0]))).toMatchObject({ text: 'A,B', uncertain: true, encoding: 'utf-16le' })
    const korean = decodeImportText(new Uint8Array([0xbd, 0xc3, 0xbe, 0xe0]))
    expect(korean.text).toBe('시약'); expect(korean.uncertain).toBe(true)
    expect(() => decodeImportText(new Uint8Array([0xff]), 'utf-8')).toThrow()
  })
})
