import { InternalApiError } from '../../services/internalApi'

/**
 * Why an operator request was refused, in the terms the operator can act on.
 * The server sends these as `code` on 403/429 responses (functions/api/admin/feedback/_shared.ts,
 * functions/api/_middleware.ts); everything else stays a plain error message.
 */
export type OpsAccessIssue =
  | 'signed_out'
  | 'mfa_required'
  | 'review_required'
  | 'role_required'
  | 'rate_limited'
  | 'denied'

export interface OpsAccessProblem {
  issue: OpsAccessIssue
  retryAfterSeconds?: number
}

const CODE_TO_ISSUE: Record<string, OpsAccessIssue> = {
  MFA_REQUIRED: 'mfa_required',
  OPERATOR_REVIEW_REQUIRED: 'review_required',
  OPERATOR_ROLE_REQUIRED: 'role_required',
  RATE_LIMITED: 'rate_limited',
}

/** Returns the access problem behind an operator API error, or null when it is not an access problem. */
export function getOpsAccessProblem(error: unknown): OpsAccessProblem | null {
  if (!(error instanceof InternalApiError)) return null
  if (error.status === 401) return { issue: 'signed_out' }
  if (error.status === 429) {
    return { issue: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds }
  }
  if (error.status !== 403) return null
  const mapped = error.code ? CODE_TO_ISSUE[error.code] : undefined
  return { issue: mapped ?? 'denied' }
}

/** Whether a refusal applies to the whole console (sign-in, MFA, review) rather than one action or role. */
export function isConsoleWideAccessIssue(issue: OpsAccessIssue): boolean {
  return issue === 'signed_out' || issue === 'mfa_required' || issue === 'review_required'
}
