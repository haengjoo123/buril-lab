import { normalizeCasNumber } from './casNumber'

/**
 * Korean legal classification of a substance under the Chemicals Control Act
 * (화학물질관리법), as published by Korea Environment Corporation's chemical
 * information service (data.go.kr 15149420, `chemSbstnList`).
 *
 * Substance-level only: a mixture's classification also depends on the
 * concentration thresholds in `contentThreshold`.
 */

export type ChemicalRegulationCategory =
  | 'banned'
  | 'restricted'
  | 'permitted'
  | 'accident_preparedness'
  | 'toxic'
  | 'acute_toxic'
  | 'chronic_toxic'
  | 'eco_toxic'
  | 'human_eco_hazard'
  | 'priority_control'
  | 'existing'
  | 'other'

export interface ChemicalRegulationEntry {
  category: ChemicalRegulationCategory
  /** Classification name exactly as published, e.g. "사고대비물질". */
  typeName: string
  uniqueNumber?: string
  /** Concentration rule, e.g. "25% 이상 함유한 혼합물". */
  contentThreshold?: string
  exception?: string
  noticeDate?: string
  noticeInfo?: string
}

export interface ChemicalRegulationRecord {
  casNumber: string
  keNumber?: string
  nameKo?: string
  nameEn?: string
  entries: ChemicalRegulationEntry[]
}

export type ChemicalRegulationLookup =
  | { status: 'found'; record: ChemicalRegulationRecord }
  | { status: 'not_found' }
  | { status: 'unavailable' }

// Checked in order: "인체급성유해성물질" must not fall through to a broader match.
const CATEGORY_PATTERNS: ReadonlyArray<[RegExp, ChemicalRegulationCategory]> = [
  [/금지/, 'banned'],
  [/제한/, 'restricted'],
  [/허가/, 'permitted'],
  [/사고\s*대비/, 'accident_preparedness'],
  [/인체\s*급성/, 'acute_toxic'],
  [/인체\s*만성/, 'chronic_toxic'],
  [/생태/, 'eco_toxic'],
  // Since 2025-08-07 KECO publishes one "인체등유해성물질" class whose
  // contInfo lists the acute / chronic / ecological thresholds.
  [/인체\s*등\s*유해성|유해성\s*물질/, 'human_eco_hazard'],
  [/유독/, 'toxic'],
  [/중점\s*관리/, 'priority_control'],
  [/기존/, 'existing'],
]

/**
 * 유해화학물질 under the Chemicals Control Act. The 2025 amendment replaced
 * 유독물질 with 인체등유해성물질 (acute / chronic / ecological); older and
 * split class names are kept in case they still appear.
 */
const HAZARDOUS_CATEGORIES: ReadonlySet<ChemicalRegulationCategory> = new Set([
  'banned',
  'restricted',
  'permitted',
  'accident_preparedness',
  'toxic',
  'acute_toxic',
  'chronic_toxic',
  'eco_toxic',
  'human_eco_hazard',
])

const CATEGORY_ORDER: readonly ChemicalRegulationCategory[] = [
  'banned', 'restricted', 'permitted', 'accident_preparedness',
  'human_eco_hazard', 'acute_toxic', 'chronic_toxic', 'eco_toxic', 'toxic',
  'priority_control', 'existing', 'other',
]

export function categorizeRegulationType(typeName: string): ChemicalRegulationCategory {
  return CATEGORY_PATTERNS.find(([pattern]) => pattern.test(typeName))?.[1] ?? 'other'
}

export function isHazardousChemicalCategory(category: ChemicalRegulationCategory): boolean {
  return HAZARDOUS_CATEGORIES.has(category)
}

export function hazardousRegulationEntries(record: ChemicalRegulationRecord): ChemicalRegulationEntry[] {
  return record.entries.filter((entry) => isHazardousChemicalCategory(entry.category))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asRecordList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (isRecord(value)) {
    // data.go.kr wraps lists as { item: [...] } in some services.
    if ('item' in value) return asRecordList(value.item)
    return [value]
  }
  return []
}

function text(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const trimmed = String(value).trim()
  return trimmed && trimmed !== '-' ? trimmed : undefined
}

/** data.go.kr responses come either bare ({ header, body }) or under `response`. */
function responseBody(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined
  const root = isRecord(payload.response) ? payload.response : payload
  return isRecord(root.body) ? root.body : undefined
}

export function readKecoResultCode(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const root = isRecord(payload.response) ? payload.response : payload
  return isRecord(root.header) ? text(root.header, 'resultCode') : undefined
}

// KECO sends notice dates as "20141230", or blanks when none is published.
function formatNoticeDate(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})$/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value
}

function parseEntry(raw: Record<string, unknown>): ChemicalRegulationEntry | null {
  const typeName = text(raw, 'sbstnClsfTypeNm')
  if (!typeName) return null
  const uniqueNumber = text(raw, 'unqNo')
  const contentThreshold = text(raw, 'contInfo')
  const exception = text(raw, 'excpInfo')
  const noticeDate = formatNoticeDate(text(raw, 'ancmntYmd'))
  const noticeInfo = text(raw, 'ancmntInfo')
  return {
    category: categorizeRegulationType(typeName),
    typeName,
    ...(uniqueNumber ? { uniqueNumber } : {}),
    ...(contentThreshold ? { contentThreshold } : {}),
    ...(exception ? { exception } : {}),
    ...(noticeDate ? { noticeDate } : {}),
    ...(noticeInfo ? { noticeInfo } : {}),
  }
}

/**
 * Parse a `chemSbstnList` response for one CAS number. The CAS search can
 * return neighbouring substances, so only exact CAS matches are kept.
 * Returns null when no item matches.
 */
export function parseKecoChemicalResponse(payload: unknown, casNumber: string): ChemicalRegulationRecord | null {
  const cas = normalizeCasNumber(casNumber)
  if (!cas) return null

  const matches = asRecordList(responseBody(payload)?.items)
    .filter((item) => normalizeCasNumber(text(item, 'casNo')) === cas)
  if (matches.length === 0) return null

  const entries: ChemicalRegulationEntry[] = []
  const seen = new Set<string>()
  for (const item of matches) {
    for (const raw of asRecordList(item.typeList)) {
      const entry = parseEntry(raw)
      if (!entry) continue
      const key = `${entry.typeName}|${entry.uniqueNumber ?? ''}|${entry.contentThreshold ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push(entry)
    }
  }
  entries.sort((left, right) => CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category))

  const first = matches[0]
  const keNumber = text(first, 'korexst')
  const nameKo = text(first, 'sbstnNmKor')
  const nameEn = text(first, 'sbstnNmEng')
  return {
    casNumber: cas,
    ...(keNumber ? { keNumber } : {}),
    ...(nameKo ? { nameKo } : {}),
    ...(nameEn ? { nameEn } : {}),
    entries,
  }
}
