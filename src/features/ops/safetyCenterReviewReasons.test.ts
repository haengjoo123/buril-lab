import { describe, expect, it } from 'vitest'
import {
  isSafetyCenterReviewReason,
  normalizeReviewNote,
  REVIEW_NOTE_MAX,
  reviewNoteLength,
  SAFETY_CENTER_REVIEW_REASONS,
  validateRejectReview,
} from './safetyCenterReviewReasons'

describe('safety-center rejection reasons', () => {
  it('keeps the closed list the API and the database accept', () => {
    expect(SAFETY_CENTER_REVIEW_REASONS).toEqual([
      'document_unverifiable', 'institution_mismatch', 'domain_mismatch', 'not_safety_office', 'duplicate_center', 'other',
    ])
    expect(REVIEW_NOTE_MAX).toBe(500)
    expect(isSafetyCenterReviewReason('domain_mismatch')).toBe(true)
    expect(isSafetyCenterReviewReason('bogus')).toBe(false)
    expect(isSafetyCenterReviewReason(null)).toBe(false)
  })

  it('requires a reason', () => {
    expect(validateRejectReview(null, '')).toEqual({ ok: false, error: 'reason_required' })
    expect(validateRejectReview(null, 'note only')).toEqual({ ok: false, error: 'reason_required' })
  })

  it('makes the note optional and trims it, empty meaning none', () => {
    expect(validateRejectReview('duplicate_center', '')).toEqual({ ok: true, note: null })
    expect(validateRejectReview('duplicate_center', '   \n ')).toEqual({ ok: true, note: null })
    expect(validateRejectReview('domain_mismatch', '  학교 메일로 다시 신청해 주세요.\n ')).toEqual({
      ok: true, note: '학교 메일로 다시 신청해 주세요.',
    })
  })

  it('requires a note for other', () => {
    expect(validateRejectReview('other', '  ')).toEqual({ ok: false, error: 'note_required' })
    expect(validateRejectReview('other', '서류가 만료되었습니다.')).toEqual({ ok: true, note: '서류가 만료되었습니다.' })
  })

  it('counts code points, so 500 emoji fit and 501 do not', () => {
    expect(validateRejectReview('other', '😀'.repeat(500))).toEqual({ ok: true, note: '😀'.repeat(500) })
    expect(validateRejectReview('other', '😀'.repeat(501))).toEqual({ ok: false, error: 'note_too_long' })
    expect(validateRejectReview('other', ` ${'가'.repeat(500)} `)).toMatchObject({ ok: true })
    expect(reviewNoteLength(` ${'😀'.repeat(3)} `)).toBe(3)
  })

  it('drops pasted control characters the API refuses but keeps line breaks and tabs', () => {
    expect(normalizeReviewNote('a\u0007b\u000Bc')).toBe('abc')
    expect(normalizeReviewNote('line 1\n\tline 2')).toBe('line 1\n\tline 2')
    expect(normalizeReviewNote('\u0000\u001F')).toBeNull()
  })
})
