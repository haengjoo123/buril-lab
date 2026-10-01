import { normalizeCasNumber } from '../../../utils/casNumber'
import { parseCapacityMeasurement } from '../../../utils/capacityParser'
import { normalizeExpiryDate } from '../../../utils/dateValidation'
import { isManufacturerDateType, type ManufacturerDateType } from '../../../utils/manufacturerDate'
import type { ImportContext, ImportDraftRow, ImportField, ImportIssue, ValidatedImportRow } from './types'

export const token = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s_\-().:：/]+/g, '')
const aliases: Partial<Record<ImportField, string[]>> = {
  name: ['name', '이름', '시약명', '품명', '품목명', '제품명', '화학물질명', '물질명', 'reagent', 'chemical', 'chemical name', 'product name'],
  brand: ['brand', 'manufacturer', 'maker', '브랜드', '제조사', '제조회사', '제조업체'],
  product_number: ['product_number', 'product no', 'catalog no', 'catalog number', 'cat no', '제품번호', '품번', '카탈로그번호', 'pn'],
  cas_number: ['cas_number', 'cas', 'cas no', 'cas번호', 'cas registry number'],
  quantity: ['quantity', 'qty', 'count', '수량', '수량개', '병수', '개수', '재고수량', '보유수량'],
  capacity: ['capacity', 'size', 'pack size', '용량', '규격', '포장용량'],
  storage_location: ['storage_location', 'storage location', 'location', '보관위치', '보관장소', '위치', '보관장', '보관함'],
  storage_type: ['storage_type', 'storage type', '보관유형', '보관타입'],
  expiry_date: ['expiry_date', 'expiry', 'expiration date', 'exp date', '유효기간', '유효기한', '만료일'],
  manufacturer_date_type: ['manufacturer_date_type', '제조사 날짜 유형', '날짜 유형'],
  manufacturer_date: ['manufacturer_date', '제조사 날짜', '제조사일자'],
  received_date: ['received_date', 'received date', '입고일', '입고날짜'],
  opened_date: ['opened_date', 'opened date', '개봉일', '개봉날짜'],
  remaining_percent: ['remaining_percent', 'remaining percent', '잔량%', '잔량(%)'],
  memo: ['memo', 'notes', 'remark', 'remarks', '메모', '비고'],
}
const headerFields = new Map(Object.entries(aliases).flatMap(([field, names]) => [field, ...names].map(name => [token(name), field as ImportField] as const)))
export function matchImportHeader(header: string): ImportField | undefined {
  return headerFields.get(token(header))
}
export function parseImportQuantity(raw: string): number | null {
  const cleaned = raw.normalize('NFKC').trim().replace(/\s*(개|병|ea|bottles?)$/i, '').trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(cleaned)) return null
  const value = Number(cleaned.replaceAll(',', ''))
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null
}
export function normalizeImportDate(raw: string): string | null {
  const value = raw.normalize('NFKC').trim()
  const ambiguous = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}$/.exec(value)
  if (ambiguous && Number(ambiguous[1]) <= 12 && Number(ambiguous[2]) <= 12 && ambiguous[1] !== ambiguous[2]) return null
  const korean = value.replace(/년\s*/g, '-').replace(/월\s*/g, '-').replace(/일$/, '')
  return normalizeExpiryDate(korean)
}
function dateType(raw: string): ManufacturerDateType | null {
  const key = token(raw)
  if (['expiry', 'expiration', 'exp', '유효기한', '유효기간', '만료일'].includes(key)) return 'expiry'
  if (['minimumshelflife', '최소보증기한', '최소보증기간'].includes(key)) return 'minimum_shelf_life'
  if (['unlabeled', '미표기', '없음'].includes(key)) return 'unlabeled'
  return isManufacturerDateType(raw) ? raw : null
}
export function duplicateKey(item: ImportContext['existing'][number]): string {
  // A CAS alone does not identify a bottle, concentration, or lot. This only proposes a review.
  return [item.cas_number ? normalizeCasNumber(item.cas_number) || item.cas_number : token(item.name), token(item.brand || ''), token(item.product_number || ''), token(item.capacity || '')].join('|')
}
export function buildDuplicateIndex(existing: ImportContext['existing']): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const item of existing) { const key = duplicateKey(item); const ids = result.get(key) || []; ids.push(item.id); result.set(key, ids) }
  return result
}
export function validateImportRow(row: ImportDraftRow, context: ImportContext, index = buildDuplicateIndex(context.existing)): ValidatedImportRow {
  const fields = row.fields
  const issues: ImportIssue[] = []
  const add = (field: ImportField | undefined, code: string, message: string) => issues.push({ field, code, message })
  const name = (fields.name || '').trim()
  if (!name || name.length > 500) add('name', 'name', '시약명을 확인하세요 (1~500자).')
  const quantity = parseImportQuantity(fields.quantity || '')
  if (quantity === null) add('quantity', 'quantity', '수량(개)을 확인하세요. 빈칸·소수는 자동으로 바꾸지 않습니다.')
  if (quantity === 0) add('quantity', 'zero', '수량 0: 비재고 항목으로 제외할지 확인하세요.')
  const capacity = parseCapacityMeasurement(fields.capacity).rawText || ''
  if (capacity && parseCapacityMeasurement(capacity).numericValue === null) add('capacity', 'capacity', '용량과 단위를 확인하세요 (예: 500 mL).')
  const cas = fields.cas_number?.trim() || ''
  if (cas && !normalizeCasNumber(cas)) add('cas_number', 'cas', 'CAS 번호의 형식 또는 체크섬이 맞지 않습니다.')
  const location = fields.storage_location?.trim() || ''
  const cabinets = context.cabinets.filter(item => token(item.name) === token(location))
  const locations = context.locations.filter(item => token(item.name) === token(location))
  const explicitCabinet = /^(cabinet|시약장|캐비넷)$/i.test(fields.storage_type?.trim() || '')
  const explicitOther = /^(other|기타|기타보관)$/i.test(fields.storage_type?.trim() || '')
  if (fields.storage_type?.trim() && !explicitCabinet && !explicitOther) add('storage_type', 'storage_type', '보관유형을 시약장/기타로 연결하거나 비워 주세요. 원문은 보존됩니다.')
  const candidates = explicitCabinet ? cabinets : explicitOther ? locations : [...cabinets, ...locations]
  if (location && candidates.length !== 1) add('storage_location', 'location', '보관위치를 연결하거나 위치 미지정으로 바꾸세요.')
  const cabinet = location && !explicitOther && cabinets.length === 1 && candidates.length === 1 ? cabinets[0] : undefined
  const storageLocation = !cabinet && candidates.length === 1 ? locations[0] : undefined
  const dates: Record<string, string | undefined> = {}
  for (const field of ['manufacturer_date', 'expiry_date', 'received_date', 'opened_date'] as const) {
    const raw = fields[field]?.trim()
    const parsed = raw ? normalizeImportDate(raw) : null
    if (raw && !parsed) add(field, 'date', '날짜를 YYYY-MM-DD로 확인하세요. 모호한 월/일 순서는 추정하지 않습니다.')
    dates[field] = parsed || undefined
  }
  const manufacturerType = fields.manufacturer_date_type ? dateType(fields.manufacturer_date_type) : dates.expiry_date ? 'expiry' : 'unlabeled'
  if (!manufacturerType || (dates.manufacturer_date && manufacturerType === 'unlabeled')) add('manufacturer_date_type', 'date_type', '제조사 날짜의 유형을 확인하세요.')
  if (manufacturerType === 'unlabeled' && dates.expiry_date) add('expiry_date', 'date_type', '미표기 유형과 유효기간이 충돌합니다.')
  if (dates.manufacturer_date && dates.expiry_date && dates.manufacturer_date !== dates.expiry_date) add('manufacturer_date', 'date_conflict', '제조사 날짜와 유효기간이 다릅니다. 날짜와 유형을 확인하세요.')
  const remainingRaw = fields.remaining_percent?.trim().replace(/%$/, '') || ''
  const remaining = remainingRaw ? Number(remainingRaw) : undefined
  if (remainingRaw && (!/^\d+$/.test(remainingRaw) || !Number.isInteger(remaining) || remaining! < 0 || remaining! > 100)) add('remaining_percent', 'remaining', '잔량은 0~100%로 확인하세요.')
  if (row.reviewRequired && !row.reviewed) add(undefined, 'source_review', '원본과 추출 결과를 확인하세요.')
  for (const cell of row.cells) if (cell.issue && !row.reviewed) add(undefined, 'cell', cell.issue)
  const duplicates = index.get(duplicateKey({ id: row.id, name, cas_number: cas, brand: fields.brand, product_number: fields.product_number, capacity })) || []
  const status = row.importedId ? 'imported' : row.excluded || row.duplicateDecision === 'skip' ? 'excluded' : issues.length ? 'review' : duplicates.length && row.duplicateDecision !== 'new' ? 'duplicate' : 'ready'
  return { row, issues, status, duplicates, input: status === 'ready' ? {
    name, quantity: quantity!, brand: fields.brand?.trim() || undefined, product_number: fields.product_number?.trim() || undefined,
    cas_number: normalizeCasNumber(cas) || undefined, capacity: capacity || undefined, storage_type: cabinet ? 'cabinet' : 'other',
    cabinet_id: cabinet?.id, storage_location_id: storageLocation?.id,
    manufacturer_date_type: manufacturerType!, expiry_date: dates.manufacturer_date || dates.expiry_date,
    received_date: dates.received_date, opened_date: dates.opened_date, memo: fields.memo?.trim() || undefined, remaining_percent: remaining,
  } : null }
}
export function validateImportRows(rows: ImportDraftRow[], context: ImportContext): ValidatedImportRow[] {
  const index = buildDuplicateIndex(context.existing)
  for (const row of rows) if (row.importedId) {
    const key = duplicateKey({ ...row.fields, id: row.importedId, name: row.fields.name || '' })
    const ids = index.get(key) || []
    if (!ids.includes(row.importedId)) ids.push(row.importedId)
    index.set(key, ids)
  }
  const seen = new Map<string, string[]>()
  for (const row of rows) {
    if (row.excluded || row.importedId || row.duplicateDecision === 'skip') continue
    const key = duplicateKey({ id: row.id, name: row.fields.name || '', cas_number: row.fields.cas_number, brand: row.fields.brand, product_number: row.fields.product_number, capacity: row.fields.capacity })
    const ids = seen.get(key) || []; ids.push(row.id); seen.set(key, ids)
  }
  for (const [key, ids] of seen) if (ids.length > 1) index.set(key, [...(index.get(key) || []), ...ids])
  return rows.map(row => validateImportRow(row, context, index))
}
