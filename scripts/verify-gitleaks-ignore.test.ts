import { describe, expect, it } from 'vitest'
import { assertSecretAbsent, secretVariants, TEMPORARY_KOSHA_EXCEPTION as exception, verifyFingerprints } from './verify-gitleaks-ignore.mjs'

describe('temporary historical credential exception', () => {
  const start = Date.parse(exception.approvedAt)
  const end = Date.parse(exception.expiresAt)
  it('allows only the approved 168-hour window, including its start', () => {
    expect(end - start).toBe(168 * 60 * 60 * 1000)
    expect(verifyFingerprints(exception.fingerprint, start)).toEqual([exception.fingerprint])
    expect(verifyFingerprints(exception.fingerprint, end - 1)).toEqual([exception.fingerprint])
  })
  it.each(['before', 'expiry', 'after', 'invalid'])('fails closed at %s', boundary => {
    const now = { before: start - 1, expiry: end, after: end + 1, invalid: NaN }[boundary]
    expect(() => verifyFingerprints(exception.fingerprint, now)).toThrow(/168-hour/)
  })
  it('retains exact-fingerprint checks and rejects broad or duplicate ignores', () => {
    for (const source of ['', '.env', 'generic-api-key', `${exception.fingerprint}\n${exception.fingerprint}`]) {
      expect(() => verifyFingerprints(source, start)).toThrow()
    }
  })
  it('does not expire permanent revoked-key exceptions', () => {
    const permanent = '50fcc8f32e1b7c6b718df478b56dbbd6aa699d15:.env:gcp-api-key:4'
    expect(verifyFingerprints(permanent, end + 1)).toEqual([permanent])
  })
  it('rejects raw and URL-encoded reintroduction without exposing the credential', () => {
    const fake = 'fixture-only+/=not-a-real-key'
    for (const value of [fake, encodeURIComponent(fake)]) {
      expect(() => assertSecretAbsent(Buffer.from(`key=${value}`), secretVariants(fake))).toThrow(/current tracked file/)
      expect(() => assertSecretAbsent(Buffer.from(value), secretVariants(encodeURIComponent(fake)))).toThrow(/current tracked file/)
    }
    expect(() => assertSecretAbsent(Buffer.from('ordinary source'), secretVariants(fake))).not.toThrow()
  })
})
