import { supabase } from './supabaseClient'

export type MfaAssuranceLevel = 'aal1' | 'aal2' | null

export interface MfaStatus {
  currentLevel: MfaAssuranceLevel
  nextLevel: MfaAssuranceLevel
  verifiedFactorId: string | null
  verifiedFactorCount: number
}

export interface TotpEnrollment {
  factorId: string
  qrCode: string
  secret: string
}

export function normalizeTotpCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}

export function isCompleteTotpCode(value: string): boolean {
  return /^\d{6}$/.test(value)
}

export async function loadMfaStatus(): Promise<MfaStatus> {
  const [factorsResult, assuranceResult] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ])

  if (factorsResult.error) throw factorsResult.error
  if (assuranceResult.error) throw assuranceResult.error

  const verifiedFactors = factorsResult.data.totp
  return {
    currentLevel: assuranceResult.data.currentLevel,
    nextLevel: assuranceResult.data.nextLevel,
    verifiedFactorId: verifiedFactors[0]?.id ?? null,
    verifiedFactorCount: verifiedFactors.length,
  }
}

export async function beginTotpEnrollment(): Promise<TotpEnrollment> {
  const factorsResult = await supabase.auth.mfa.listFactors()
  if (factorsResult.error) throw factorsResult.error
  if (factorsResult.data.totp.length > 0) {
    throw new Error('A verified TOTP factor already exists.')
  }

  // An interrupted setup cannot be resumed because its secret is deliberately
  // not persisted. Remove only stale, unverified TOTP factors before starting
  // a new user-requested setup.
  const staleFactors = factorsResult.data.all.filter(
    (factor) => factor.factor_type === 'totp' && factor.status === 'unverified',
  )
  for (const factor of staleFactors) {
    const result = await supabase.auth.mfa.unenroll({ factorId: factor.id })
    if (result.error) throw result.error
  }

  const result = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'BurilLab authenticator',
    issuer: 'BurilLab',
  })
  if (result.error) throw result.error

  return {
    factorId: result.data.id,
    qrCode: result.data.totp.qr_code,
    secret: result.data.totp.secret,
  }
}

export async function verifyTotpFactor(factorId: string, code: string): Promise<void> {
  if (!factorId || !isCompleteTotpCode(code)) {
    throw new Error('A six-digit TOTP code is required.')
  }
  const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
  if (result.error) throw result.error
}

export async function discardUnverifiedTotp(factorId: string): Promise<void> {
  if (!factorId) return
  const result = await supabase.auth.mfa.unenroll({ factorId })
  if (result.error) throw result.error
}
