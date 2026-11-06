// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { InternalApiError } from '../../services/internalApi'
import { getOpsAccessProblem, isConsoleWideAccessIssue } from './opsAccess'

describe('operator access problems', () => {
  it('maps the server refusal codes to actionable issues', () => {
    expect(getOpsAccessProblem(new InternalApiError('x', 403, 'MFA_REQUIRED'))).toEqual({ issue: 'mfa_required' })
    expect(getOpsAccessProblem(new InternalApiError('x', 403, 'OPERATOR_REVIEW_REQUIRED'))).toEqual({ issue: 'review_required' })
    expect(getOpsAccessProblem(new InternalApiError('x', 403, 'OPERATOR_ROLE_REQUIRED'))).toEqual({ issue: 'role_required' })
  })

  it('treats an uncoded 403 as a plain denial and 401 as signed out', () => {
    expect(getOpsAccessProblem(new InternalApiError('x', 403))).toEqual({ issue: 'denied' })
    expect(getOpsAccessProblem(new InternalApiError('x', 403, 'SOMETHING_ELSE'))).toEqual({ issue: 'denied' })
    expect(getOpsAccessProblem(new InternalApiError('x', 401))).toEqual({ issue: 'signed_out' })
  })

  it('keeps the retry delay for rate limiting', () => {
    expect(getOpsAccessProblem(new InternalApiError('x', 429, 'RATE_LIMITED', 12))).toEqual({
      issue: 'rate_limited', retryAfterSeconds: 12,
    })
  })

  it('ignores errors that are not access problems', () => {
    expect(getOpsAccessProblem(new InternalApiError('x', 500))).toBeNull()
    expect(getOpsAccessProblem(new InternalApiError('x', 409))).toBeNull()
    expect(getOpsAccessProblem(new Error('network'))).toBeNull()
    expect(getOpsAccessProblem(null)).toBeNull()
  })

  it('separates console-wide refusals from role-specific ones', () => {
    expect(isConsoleWideAccessIssue('mfa_required')).toBe(true)
    expect(isConsoleWideAccessIssue('review_required')).toBe(true)
    expect(isConsoleWideAccessIssue('signed_out')).toBe(true)
    expect(isConsoleWideAccessIssue('role_required')).toBe(false)
    expect(isConsoleWideAccessIssue('denied')).toBe(false)
    expect(isConsoleWideAccessIssue('rate_limited')).toBe(false)
  })
})
