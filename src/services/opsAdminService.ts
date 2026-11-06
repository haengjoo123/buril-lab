import { postJson } from './internalApi'
import type { SafetyCenterStatus } from '../features/safety-center/types'
import type { SafetyCenterReviewReason } from '../features/ops/safetyCenterReviewReasons'

export interface SafetyCenterApprovalItem {
  id: string
  institution_name: string
  institution_domain: string
  center_name: string
  status: SafetyCenterStatus
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
  /**
   * Lowercased part of the requester's email after '@' (never the full address). The list API
   * fills it for at most the 20 oldest pending requests; other rows, and failed lookups, get null.
   */
  requester_email_domain?: string | null
  /**
   * Whether that domain equals the institution domain or is a subdomain of it. Null when it was
   * not checked. Status updates return rows without it.
   */
  domain_matches?: boolean | null
  /**
   * Operator rejection reason and optional note, shown to the applicant while the center is
   * rejected. Approving keeps the stored pair (an approval undone back to rejected shows it again).
   */
  review_reason?: SafetyCenterReviewReason | null
  review_note?: string | null
}

/** Sent only with a rejection. A rejection without it keeps the stored reason (approval undo). */
export interface SafetyCenterRejectReview {
  reasonPreset: SafetyCenterReviewReason
  note: string | null
}

interface SafetyCenterListResponse {
  items: SafetyCenterApprovalItem[]
}

interface SafetyCenterStatusResponse {
  item: SafetyCenterApprovalItem
}

interface SafetyCenterDocumentUrlResponse {
  url: string
  expiresIn: number
  fileName: string | null
}

export async function listSafetyCenterApprovals(): Promise<SafetyCenterApprovalItem[]> {
  const payload = await postJson<SafetyCenterListResponse>('/api/admin/safety-centers/list', {})
  return payload.items
}

export async function updateSafetyCenterApprovalStatus(
  centerId: string,
  status: SafetyCenterStatus,
  review?: SafetyCenterRejectReview,
): Promise<SafetyCenterApprovalItem> {
  const payload = await postJson<SafetyCenterStatusResponse>('/api/admin/safety-centers/status', {
    centerId,
    status,
    ...(status === 'rejected' && review ? { reasonPreset: review.reasonPreset, note: review.note } : {}),
  })

  return payload.item
}

export async function getSafetyCenterVerificationDocumentUrl(centerId: string): Promise<SafetyCenterDocumentUrlResponse> {
  return await postJson<SafetyCenterDocumentUrlResponse>('/api/admin/safety-centers/document-url', {
    centerId,
  })
}
