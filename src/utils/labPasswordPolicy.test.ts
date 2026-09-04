import { describe, expect, it } from 'vitest'
import {
  LAB_JOIN_PASSWORD_MAX_LENGTH,
  LAB_JOIN_PASSWORD_MIN_LENGTH,
  labPasswordIssueFromError,
  validateLabJoinPassword,
} from './labPasswordPolicy'

describe('lab join password policy', () => {
  it('keeps an empty password as the explicit passwordless-lab choice', () => {
    expect(validateLabJoinPassword('합성 연구실', '')).toBeNull()
  })

  it('requires 12 through 128 characters for a protected lab', () => {
    expect(validateLabJoinPassword('합성 연구실', 'A1!short')).toBe('length')
    expect(validateLabJoinPassword('합성 연구실', 'A1!safe-phrase')).toBeNull()
    expect(validateLabJoinPassword('합성 연구실', 'x'.repeat(LAB_JOIN_PASSWORD_MAX_LENGTH))).toBeNull()
    expect(validateLabJoinPassword('합성 연구실', 'x'.repeat(LAB_JOIN_PASSWORD_MAX_LENGTH + 1))).toBe('length')
    expect(LAB_JOIN_PASSWORD_MIN_LENGTH).toBe(12)
  })

  it('rejects the lab name even when separators or case differ', () => {
    expect(validateLabJoinPassword('Alpha Lab', 'Safe-Alpha-Lab-2026!')).toBe('lab_name')
    expect(validateLabJoinPassword('합성 연구실', '2026!합성연구실!safe')).toBe('lab_name')
  })

  it('rejects common and whitespace-only values', () => {
    expect(validateLabJoinPassword('합성 연구실', 'Password-1234!')).toBe('common')
    expect(validateLabJoinPassword('합성 연구실', ' '.repeat(12))).toBe('common')
  })

  it('maps only reviewed server policy codes', () => {
    expect(labPasswordIssueFromError({ message: 'lab_password_common' })).toBe('common')
    expect(labPasswordIssueFromError({ code: 'lab_password_contains_lab_name' })).toBe('lab_name')
    expect(labPasswordIssueFromError(new Error('unrelated'))).toBeNull()
  })
})
