import {
  internalErrorResponse,
  json,
  requireFeedbackAdmin,
  SAFETY_CENTER_REVIEW_NOTE_MAX,
  SAFETY_CENTER_REVIEW_REASONS,
  type SafetyCenterAdminEnv,
  type SafetyCenterAdminRow,
  type SafetyCenterReviewReason,
} from './_shared'
import { isUuid } from '../../_shared/validation'

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected'])
const REVIEW_REASONS: ReadonlySet<string> = new Set<string>(SAFETY_CENTER_REVIEW_REASONS)

interface UpdateSafetyCenterStatusBody {
  centerId?: unknown
  status?: unknown
  reasonPreset?: unknown
  note?: unknown
}

export type SafetyCenterReviewInput =
  | { ok: true; reasonPreset: SafetyCenterReviewReason | null; note: string | null }
  | { ok: false; error: string }

/** C0 controls and DEL, except tab, line feed and carriage return (a note may span lines). */
function hasDisallowedControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || code === 0x7f) {
      return true
    }
  }
  return false
}

/**
 * Checks the optional rejection reason and note before any status RPC, with the same rules as
 * operator_safety_center_status_v2 (which raises 22023 on its own): a reason only when rejecting,
 * a note only with a reason, and `other` always with a note. The note is trimmed; empty means none.
 */
export function parseSafetyCenterReview(status: string, reasonPreset: unknown, note: unknown): SafetyCenterReviewInput {
  let reason: SafetyCenterReviewReason | null = null
  if (reasonPreset !== undefined && reasonPreset !== null) {
    if (typeof reasonPreset !== 'string' || !REVIEW_REASONS.has(reasonPreset)) {
      return {
        ok: false,
        error: 'reasonPreset must be one of document_unverifiable, institution_mismatch, domain_mismatch, not_safety_office, duplicate_center, or other.',
      }
    }
    reason = reasonPreset as SafetyCenterReviewReason
  }

  let trimmedNote: string | null = null
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string') {
      return { ok: false, error: 'note must be a string.' }
    }
    trimmedNote = note.trim() || null
  }
  if (trimmedNote !== null) {
    if (Array.from(trimmedNote).length > SAFETY_CENTER_REVIEW_NOTE_MAX) {
      return { ok: false, error: `note must be ${SAFETY_CENTER_REVIEW_NOTE_MAX} characters or fewer.` }
    }
    if (hasDisallowedControlCharacter(trimmedNote)) {
      return { ok: false, error: 'note must not contain control characters.' }
    }
  }

  if (status !== 'rejected' && (reason !== null || trimmedNote !== null)) {
    return { ok: false, error: 'A review reason is only accepted when rejecting.' }
  }
  if (trimmedNote !== null && reason === null) {
    return { ok: false, error: 'note requires reasonPreset.' }
  }
  if (reason === 'other' && trimmedNote === null) {
    return { ok: false, error: 'note is required when reasonPreset is other.' }
  }
  return { ok: true, reasonPreset: reason, note: trimmedNote }
}

export const onRequestPost = async (context: {
  request: Request
  env: SafetyCenterAdminEnv
  data?: { requestId?: unknown }
}) => {
  const auth = await requireFeedbackAdmin(context.request, context.env, context.data?.requestId)
  if (!auth.ok) {
    return auth.response
  }

  let body: UpdateSafetyCenterStatusBody
  try {
    body = await context.request.json() as UpdateSafetyCenterStatusBody
  } catch {
    return json({ error: 'A valid JSON body is required.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'A JSON object is required.' }, { status: 400 })
  }
  const centerId = typeof body.centerId === 'string' ? body.centerId.trim() : null
  const status = typeof body.status === 'string' ? body.status.trim() : null

  if (!isUuid(centerId)) {
    return json({ error: 'centerId must be a UUID.' }, { status: 400 })
  }

  if (!status || !VALID_STATUSES.has(status)) {
    return json({ error: 'status must be one of pending, approved, or rejected.' }, { status: 400 })
  }

  const review = parseSafetyCenterReview(status, body.reasonPreset, body.note)
  if (!review.ok) {
    return json({ error: review.error }, { status: 400 })
  }
  const { reasonPreset, note } = review

  // v2 saves the status, the optional reason and note, and the operator audit row in one transaction.
  const { adminClient, identity } = auth.context
  const { data, error } = await adminClient.rpc('operator_safety_center_status_v2', {
    p_operator_user_id: identity.id,
    p_center_id: centerId,
    p_status: status,
    p_request_id: identity.requestId,
    p_assurance_level: identity.assuranceLevel,
    p_review_reason: reasonPreset,
    p_review_note: note,
  })

  if (error) {
    return internalErrorResponse('admin.safety-centers.status.update', error)
  }
  const result = Array.isArray(data) && data.length === 1 ? data[0] : data
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return internalErrorResponse('admin.safety-centers.status.result', null)
  }
  const record = result as Record<string, unknown>
  if (record.success !== true) {
    if (record.code === 'safety_center_not_found') {
      return json({ error: 'Safety center was not found.' }, { status: 404 })
    }
    if (record.code === 'verification_document_required') {
      return json({ error: 'Verification document is required before approving a safety center.' }, { status: 400 })
    }
    return internalErrorResponse('admin.safety-centers.status.authorization', null)
  }
  if (!record.item || typeof record.item !== 'object' || Array.isArray(record.item)) {
    return internalErrorResponse('admin.safety-centers.status.item', null)
  }

  return json({
    item: record.item as SafetyCenterAdminRow,
  })
}
