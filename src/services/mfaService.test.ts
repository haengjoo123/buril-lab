// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginTotpEnrollment,
  discardUnverifiedTotp,
  isCompleteTotpCode,
  loadMfaStatus,
  normalizeTotpCode,
  verifyTotpFactor,
} from './mfaService'

const mocked = vi.hoisted(() => ({
  listFactors: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  unenroll: vi.fn(),
}))

vi.mock('./supabaseClient', () => ({
  supabase: { auth: { mfa: mocked } },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocked.listFactors.mockResolvedValue({
    data: { all: [], totp: [], phone: [], webauthn: [] }, error: null,
  })
  mocked.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] }, error: null,
  })
  mocked.enroll.mockResolvedValue({
    data: { id: 'new-factor', type: 'totp', totp: { qr_code: 'data:image/svg+xml,qr', secret: 'SYNTHETIC', uri: 'otpauth://synthetic' } },
    error: null,
  })
  mocked.challengeAndVerify.mockResolvedValue({ data: { session: {} }, error: null })
  mocked.unenroll.mockResolvedValue({ data: { id: 'factor' }, error: null })
})

describe('MFA settings service', () => {
  it('normalizes only a six-digit authenticator code', () => {
    expect(normalizeTotpCode(' 12-34 56 78 ')).toBe('123456')
    expect(isCompleteTotpCode('123456')).toBe(true)
    expect(isCompleteTotpCode('12345')).toBe(false)
  })

  it('loads verified factors and the current assurance level', async () => {
    mocked.listFactors.mockResolvedValueOnce({
      data: { all: [], totp: [{ id: 'verified-factor' }], phone: [], webauthn: [] }, error: null,
    })
    mocked.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: { currentLevel: 'aal2', nextLevel: 'aal2', currentAuthenticationMethods: [] }, error: null,
    })
    await expect(loadMfaStatus()).resolves.toEqual({
      currentLevel: 'aal2', nextLevel: 'aal2', verifiedFactorId: 'verified-factor', verifiedFactorCount: 1,
    })
  })

  it('removes only stale unverified TOTP factors before starting enrollment', async () => {
    mocked.listFactors.mockResolvedValueOnce({
      data: {
        all: [
          { id: 'stale-totp', factor_type: 'totp', status: 'unverified' },
          { id: 'verified-phone', factor_type: 'phone', status: 'verified' },
        ],
        totp: [], phone: [{ id: 'verified-phone' }], webauthn: [],
      },
      error: null,
    })
    await expect(beginTotpEnrollment()).resolves.toEqual({
      factorId: 'new-factor', qrCode: 'data:image/svg+xml,qr', secret: 'SYNTHETIC',
    })
    expect(mocked.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: 'stale-totp' })
    expect(mocked.enroll).toHaveBeenCalledExactlyOnceWith({
      factorType: 'totp', friendlyName: 'BurilLab authenticator', issuer: 'BurilLab',
    })
  })

  it('will not create a second verified TOTP factor', async () => {
    mocked.listFactors.mockResolvedValueOnce({
      data: { all: [], totp: [{ id: 'existing' }], phone: [], webauthn: [] }, error: null,
    })
    await expect(beginTotpEnrollment()).rejects.toThrow('already exists')
    expect(mocked.enroll).not.toHaveBeenCalled()
  })

  it('rejects incomplete codes locally and verifies complete codes once', async () => {
    await expect(verifyTotpFactor('factor', '12345')).rejects.toThrow('six-digit')
    expect(mocked.challengeAndVerify).not.toHaveBeenCalled()
    await expect(verifyTotpFactor('factor', '123456')).resolves.toBeUndefined()
    expect(mocked.challengeAndVerify).toHaveBeenCalledExactlyOnceWith({ factorId: 'factor', code: '123456' })
  })

  it('discards only the specified unfinished factor', async () => {
    await expect(discardUnverifiedTotp('unfinished')).resolves.toBeUndefined()
    expect(mocked.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: 'unfinished' })
  })
})
