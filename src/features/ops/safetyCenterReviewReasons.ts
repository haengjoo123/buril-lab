/**
 * Operator rejection reasons for a safety-center application. The same closed list is enforced by
 * the status API (functions/api/admin/safety-centers/status.ts) and by the database
 * (safety_centers_review_reason_check); labels are `sc_review_reason_<code>`.
 */
export const SAFETY_CENTER_REVIEW_REASONS = [
  'document_unverifiable',
  'institution_mismatch',
  'domain_mismatch',
  'not_safety_office',
  'duplicate_center',
  'other',
] as const

export type SafetyCenterReviewReason = typeof SAFETY_CENTER_REVIEW_REASONS[number]

/** Longest note to the applicant, in Unicode code points (what the API and the database count). */
export const REVIEW_NOTE_MAX = 500

export type RejectReviewError = 'reason_required' | 'note_required' | 'note_too_long'

export function isSafetyCenterReviewReason(value: unknown): value is SafetyCenterReviewReason {
  return typeof value === 'string' && (SAFETY_CENTER_REVIEW_REASONS as readonly string[]).includes(value)
}

/**
 * Invisible control characters the API refuses (C0 and DEL except tab, line feed and carriage
 * return). They only arrive by pasting, so they are dropped instead of failing the rejection.
 */
function withoutControlCharacters(value: string): string {
  return Array.from(value).filter((character) => {
    const code = character.charCodeAt(0)
    return !(code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || code === 0x7f)
  }).join('')
}

/** The note as it will be sent: control characters dropped, trimmed, empty as null. */
export function normalizeReviewNote(note: string): string | null {
  return withoutControlCharacters(note).trim() || null
}

/** Length of the note as sent, in code points (an emoji counts once). */
export function reviewNoteLength(note: string): number {
  return Array.from(normalizeReviewNote(note) ?? '').length
}

/**
 * A rejection needs a reason; `other` also needs a note; a note is optional otherwise and at most
 * REVIEW_NOTE_MAX code points. Returns the note to send (trimmed, null when empty).
 */
export function validateRejectReview(
  reason: SafetyCenterReviewReason | null,
  note: string,
): { ok: true; note: string | null } | { ok: false; error: RejectReviewError } {
  if (!reason) return { ok: false, error: 'reason_required' }
  const normalized = normalizeReviewNote(note)
  if (normalized !== null && Array.from(normalized).length > REVIEW_NOTE_MAX) {
    return { ok: false, error: 'note_too_long' }
  }
  if (reason === 'other' && normalized === null) return { ok: false, error: 'note_required' }
  return { ok: true, note: normalized }
}
