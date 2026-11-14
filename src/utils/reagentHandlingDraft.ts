/**
 * AI-drafted handling and storage notes for one reagent (reagent_reference_drafts).
 * Reference text only: never GHS, storage-warning or waste-routing evidence.
 * Shared by the server projection and the client panel.
 */

export type ReagentDraftReviewStatus = 'unreviewed' | 'in_review' | 'verified'

export interface ReagentHandlingDraftFirstAid {
  inhalation?: string
  skin?: string
  eye?: string
  ingestion?: string
  noteToPhysician?: string
}

export interface ReagentHandlingDraft {
  name: string
  reviewStatus: ReagentDraftReviewStatus
  handling: {
    ppe?: string[]
    keyCautions?: string[]
    firstAid?: ReagentHandlingDraftFirstAid
    spillSmall?: string
    spillLarge?: string
  }
  storage: {
    temp?: string
    container?: string
    conditions?: string[]
    lightSensitive?: boolean
    hygroscopic?: boolean
    airSensitive?: boolean
    waterReactive?: boolean
    peroxideFormer?: boolean
    peroxideTestIntervalMonths?: number
  }
}

export type ReagentHandlingDraftLookup =
  | { status: 'found'; draft: ReagentHandlingDraft }
  | { status: 'not_found' }
  | { status: 'unavailable' }

const FIRST_AID_KEYS = {
  inhalation: 'inhalation',
  skin: 'skin',
  eye: 'eye',
  ingestion: 'ingestion',
  note_to_physician: 'noteToPhysician',
} as const

function text(value: unknown, max = 1_000): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

function textList(value: unknown, maxItems = 12): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.flatMap((entry) => {
    const item = text(entry)
    return item ? [item] : []
  }).slice(0, maxItems)
  return items.length > 0 ? items : undefined
}

function flag(value: unknown): boolean | undefined {
  return value === true ? true : undefined
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/**
 * Field paths a reviewer flagged as major or critical, e.g.
 * "handling.key_cautions[0], needs_review[1]" -> handling.key_cautions, needs_review.
 */
export function flaggedDraftFields(verify: unknown): Set<string> {
  const flagged = new Set<string>()
  const issues = object(verify).issues
  if (!Array.isArray(issues)) return flagged
  for (const issue of issues) {
    const entry = object(issue)
    if (entry.severity !== 'major' && entry.severity !== 'critical') continue
    if (typeof entry.field !== 'string') continue
    for (const part of entry.field.split(',')) {
      const path = part.replace(/\[[^\]]*\]/g, '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0]
      if (path) flagged.add(path)
    }
  }
  return flagged
}

function isWithheld(flagged: Set<string>, path: string): boolean {
  // A flag on a parent (handling) withholds every child; a flag on a child withholds only it.
  const segments = path.split('.')
  for (let length = 1; length <= segments.length; length += 1) {
    if (flagged.has(segments.slice(0, length).join('.'))) return true
  }
  return false
}

/**
 * Projects a draft record for display. Reviewer-flagged fields are dropped unless a
 * person has verified the draft, so the client never receives text a reviewer disputed.
 */
export function projectReagentHandlingDraft(row: {
  name_ko: string
  review_status: string
  record: unknown
  verify: unknown
}): ReagentHandlingDraft | null {
  if (row.review_status === 'rejected') return null
  const reviewStatus: ReagentDraftReviewStatus = row.review_status === 'verified'
    ? 'verified'
    : row.review_status === 'in_review' ? 'in_review' : 'unreviewed'
  const flagged = reviewStatus === 'verified' ? new Set<string>() : flaggedDraftFields(row.verify)
  const keep = (path: string) => !isWithheld(flagged, path)
  const record = object(row.record)
  const handlingSource = object(record.handling)
  const storageSource = object(record.storage)

  const handling: ReagentHandlingDraft['handling'] = {}
  if (keep('handling.ppe')) handling.ppe = textList(handlingSource.ppe)
  if (keep('handling.key_cautions')) handling.keyCautions = textList(handlingSource.key_cautions)
  const firstAidSource = object(handlingSource.first_aid)
  const firstAid: ReagentHandlingDraftFirstAid = {}
  for (const [sourceKey, targetKey] of Object.entries(FIRST_AID_KEYS)) {
    if (keep(`handling.first_aid.${sourceKey}`)) {
      const value = text(firstAidSource[sourceKey])
      if (value) firstAid[targetKey] = value
    }
  }
  if (Object.keys(firstAid).length > 0) handling.firstAid = firstAid
  if (keep('handling.spill_small')) handling.spillSmall = text(handlingSource.spill_small)
  if (keep('handling.spill_large')) handling.spillLarge = text(handlingSource.spill_large)

  const storage: ReagentHandlingDraft['storage'] = {}
  if (keep('storage.temp')) storage.temp = text(storageSource.temp)
  if (keep('storage.container')) storage.container = text(storageSource.container)
  if (keep('storage.conditions')) storage.conditions = textList(storageSource.conditions)
  if (keep('storage.light_sensitive')) storage.lightSensitive = flag(storageSource.light_sensitive)
  if (keep('storage.hygroscopic')) storage.hygroscopic = flag(storageSource.hygroscopic)
  if (keep('storage.air_sensitive')) storage.airSensitive = flag(storageSource.air_sensitive)
  if (keep('storage.water_reactive')) storage.waterReactive = flag(storageSource.water_reactive)
  if (keep('storage.peroxide_former')) storage.peroxideFormer = flag(storageSource.peroxide_former)
  if (keep('storage.peroxide_test_interval_months')) {
    const months = storageSource.peroxide_test_interval_months
    if (typeof months === 'number' && Number.isFinite(months) && months > 0 && months <= 120) {
      storage.peroxideTestIntervalMonths = months
    }
  }

  const prune = <T extends object>(value: T): T => Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
  const result: ReagentHandlingDraft = {
    name: row.name_ko,
    reviewStatus,
    handling: prune(handling),
    storage: prune(storage),
  }
  if (Object.keys(result.handling).length === 0 && Object.keys(result.storage).length === 0) return null
  return result
}
