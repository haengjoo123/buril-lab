import { json, internalErrorResponse, requireFeedbackAdmin, type FeedbackAdminEnv } from '../feedback/_shared'

export type SafetyCenterAdminEnv = FeedbackAdminEnv

/** Operator rejection reasons (column safety_centers.review_reason, API reasonPreset). Closed list. */
export const SAFETY_CENTER_REVIEW_REASONS = [
  'document_unverifiable',
  'institution_mismatch',
  'domain_mismatch',
  'not_safety_office',
  'duplicate_center',
  'other',
] as const

export type SafetyCenterReviewReason = typeof SAFETY_CENTER_REVIEW_REASONS[number]

/** Longest operator note to the applicant, in Unicode code points (the database counts characters). */
export const SAFETY_CENTER_REVIEW_NOTE_MAX = 500

export interface SafetyCenterAdminRow {
  id: string
  institution_name: string
  institution_domain: string
  center_name: string
  status: 'pending' | 'approved' | 'rejected'
  created_by: string
  approved_by: string | null
  approved_at: string | null
  verification_document_path: string | null
  verification_document_name: string | null
  verification_document_mime_type: string | null
  verification_document_size: number | null
  verification_document_uploaded_at: string | null
  created_at: string
  updated_at: string
  /** Written only by a rejection with a reason; later approvals keep the stored pair. */
  review_reason: SafetyCenterReviewReason | null
  review_note: string | null
}

export const SAFETY_CENTER_SELECT_FIELDS = [
  'id',
  'institution_name',
  'institution_domain',
  'center_name',
  'status',
  'created_by',
  'approved_by',
  'approved_at',
  'verification_document_path',
  'verification_document_name',
  'verification_document_mime_type',
  'verification_document_size',
  'verification_document_uploaded_at',
  'created_at',
  'updated_at',
  'review_reason',
  'review_note',
].join(', ')

export { json, internalErrorResponse, requireFeedbackAdmin }
