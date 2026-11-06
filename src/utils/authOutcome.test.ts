import { describe, expect, it } from 'vitest'
import {
  classifyAuthError,
  getAuthErrorMessageKey,
  getRetryAfterSeconds,
  toAuthActionResult,
  toSignUpResult,
} from './authOutcome'

describe('getRetryAfterSeconds', () => {
  it('reads the wait time from Supabase rate-limit messages', () => {
    expect(getRetryAfterSeconds('For security purposes, you can only request this after 42 seconds.')).toBe(42)
    expect(getRetryAfterSeconds('For security purposes, you can only request this after 1 second.')).toBe(1)
  })

  it('returns null when the message has no wait time', () => {
    expect(getRetryAfterSeconds('email rate limit exceeded')).toBeNull()
    expect(getRetryAfterSeconds(null)).toBeNull()
  })
})

describe('classifyAuthError', () => {
  it.each([
    ['invalid_credentials', 'invalid_credentials'],
    ['user_already_exists', 'already_registered'],
    ['email_exists', 'already_registered'],
    ['email_not_confirmed', 'email_not_confirmed'],
    ['weak_password', 'weak_password'],
    ['same_password', 'same_password'],
    ['over_email_send_rate_limit', 'rate_limited'],
    ['over_request_rate_limit', 'rate_limited'],
    ['email_address_invalid', 'invalid_email'],
  ])('maps Supabase code %s to %s', (errorCode, kind) => {
    expect(classifyAuthError({ error: 'anything', errorCode })).toBe(kind)
  })

  it.each([
    ['Invalid login credentials', 'invalid_credentials'],
    ['User already registered', 'already_registered'],
    ['Email not confirmed', 'email_not_confirmed'],
    ['Password should be at least 6 characters.', 'weak_password'],
    ['New password should be different from the old password.', 'same_password'],
    ['For security purposes, you can only request this after 42 seconds.', 'rate_limited'],
    ['email rate limit exceeded', 'rate_limited'],
    ['Unable to validate email address: invalid format', 'invalid_email'],
    ['Failed to fetch', 'network'],
    ['Load failed', 'network'],
  ])('falls back to the message "%s" when no code is sent', (error, kind) => {
    expect(classifyAuthError({ error, errorCode: null })).toBe(kind)
  })

  it('uses the generic kind for unknown errors', () => {
    expect(classifyAuthError({ error: 'Something odd happened', errorCode: 'unexpected_failure' })).toBe('generic')
    expect(classifyAuthError({ error: null })).toBe('generic')
  })

  it('maps every kind to an auth i18n key', () => {
    expect(getAuthErrorMessageKey('invalid_credentials')).toBe('auth_error_invalid_credentials')
    expect(getAuthErrorMessageKey('generic')).toBe('auth_error_generic')
  })
})

describe('toAuthActionResult', () => {
  it('keeps the message and code of an error', () => {
    expect(toAuthActionResult({ message: 'Invalid login credentials', code: 'invalid_credentials' }))
      .toEqual({ error: 'Invalid login credentials', errorCode: 'invalid_credentials' })
  })

  it('returns no error for a successful call', () => {
    expect(toAuthActionResult(null)).toEqual({ error: null, errorCode: null })
  })
})

describe('toSignUpResult', () => {
  it('asks for email confirmation when no session was created', () => {
    expect(toSignUpResult({ data: { user: { identities: [{ id: '1' }] }, session: null }, error: null }))
      .toEqual({ error: null, errorCode: null, needsEmailConfirmation: true })
  })

  it('continues directly when a session was created', () => {
    expect(toSignUpResult({ data: { user: { identities: [{ id: '1' }] }, session: { access_token: 'x' } }, error: null }))
      .toEqual({ error: null, errorCode: null, needsEmailConfirmation: false })
  })

  it('treats a user without identities as an already registered email', () => {
    const result = toSignUpResult({ data: { user: { identities: [] }, session: null }, error: null })
    expect(result.needsEmailConfirmation).toBe(false)
    expect(classifyAuthError(result)).toBe('already_registered')
  })

  it('passes errors through', () => {
    const result = toSignUpResult({
      data: { user: null, session: null },
      error: { message: 'Password is known to be weak', code: 'weak_password' },
    })
    expect(result).toEqual({ error: 'Password is known to be weak', errorCode: 'weak_password', needsEmailConfirmation: false })
  })
})
