import type { ManufacturerDateType } from '../../../utils/manufacturerDate'

export const IMPORT_LIMITS = { fileBytes: 20 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, rows: 10_000, pages: 50, cells: 1_000_000, batch: 100 } as const
export const IMPORT_FIELDS = ['name', 'brand', 'product_number', 'cas_number', 'quantity', 'capacity', 'storage_location', 'storage_type', 'manufacturer_date_type', 'manufacturer_date', 'received_date', 'opened_date', 'expiry_date', 'memo', 'remaining_percent'] as const
export type ImportField = typeof IMPORT_FIELDS[number]
export type ImportValues = Partial<Record<ImportField, string>>
export type ImportMapping = Partial<Record<ImportField, string[]>>
export const FIELD_LABELS: Record<ImportField, string> = {
  name: '시약명', brand: '제조사', product_number: '제품번호', cas_number: 'CAS 번호', quantity: '수량(개)', capacity: '용량(단위 포함)',
  storage_location: '보관위치', storage_type: '보관유형', manufacturer_date_type: '제조사 날짜 유형', manufacturer_date: '제조사 날짜',
  received_date: '입고일', opened_date: '개봉일', expiry_date: '유효기간', memo: '메모', remaining_percent: '잔량(%)',
}
export interface ImportCell {
  address: string
  raw: string | number | boolean | null
  text: string
  formula?: string
  mergedFrom?: string
  issue?: string
  evidence?: string
  bounds?: [number, number, number, number]
}
export interface ImportGrid {
  id: string
  label: string
  cells: ImportCell[][]
  page?: number
  hidden?: boolean
  needsAnalysis?: boolean
  imagePath?: string
  imageData?: string
  text?: string
  handwriting?: boolean
  analysisWarnings?: string[]
}
export interface ImportSource {
  id: string
  name: string
  size: number
  hash: string
  kind: 'spreadsheet' | 'delimited' | 'pdf' | 'image'
  path?: string
  encoding?: string
  delimiter?: string
  encodingUncertain?: boolean
  grids: ImportGrid[]
}
export interface ImportTable {
  id: string
  sourceId: string
  gridId: string
  label: string
  headerRow: number
  headerDepth: number
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  orientation: 'rows' | 'columns'
  mapping: ImportMapping
  included: boolean
  needsReview: boolean
  confirmed: boolean
}
export interface ImportAttribute { label: string; value: string; address: string }
export interface ImportDraftRow {
  id: string
  sourceId: string
  tableId: string
  sourceLabel: string
  sourceRow: number
  fields: ImportValues
  originalFields: ImportValues
  attributes: ImportAttribute[]
  cells: ImportCell[]
  reviewRequired: boolean
  reviewed: boolean
  duplicateDecision?: 'new' | 'skip'
  excluded: boolean
  importedId?: string
  error?: string
}
export interface ImportIssue { field?: ImportField; code: string; message: string }
export interface ImportProfile { id: string; name: string; signature: string; mapping: ImportMapping; orientation: ImportTable['orientation']; headerDepth: number }
export interface ImportJob {
  id: string
  labId: string | null
  userId: string | null
  name: string
  revision: number
  sources: ImportSource[]
  tables: ImportTable[]
  rows: ImportDraftRow[]
  updatedAt?: string
}
export interface ImportCommitReceipt { rowId: string; inventoryId?: string; error?: string; idempotent?: boolean }
export interface ImportContext {
  locations: Array<{ id: string; name: string }>
  cabinets: Array<{ id: string; name: string }>
  existing: Array<{ id: string; name: string; cas_number?: string | null; brand?: string | null; product_number?: string | null; capacity?: string | null }>
}
export interface InventoryImportInput {
  name: string; quantity: number; brand?: string; product_number?: string; cas_number?: string; capacity?: string
  storage_type: 'cabinet' | 'other'; cabinet_id?: string; storage_location_id?: string
  manufacturer_date_type?: ManufacturerDateType; expiry_date?: string; received_date?: string; opened_date?: string; memo?: string; remaining_percent?: number
}
export interface ValidatedImportRow { row: ImportDraftRow; issues: ImportIssue[]; status: 'ready' | 'review' | 'duplicate' | 'excluded' | 'imported'; input: InventoryImportInput | null; duplicates: string[] }
