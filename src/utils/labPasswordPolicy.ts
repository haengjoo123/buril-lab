export const LAB_JOIN_PASSWORD_MIN_LENGTH = 12
export const LAB_JOIN_PASSWORD_MAX_LENGTH = 128

export type LabPasswordPolicyIssue = 'length' | 'lab_name' | 'common'

const COMMON_LAB_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789012345',
  '1234567890123456',
  'password1234',
  'password12345',
  'password123456',
  'qwertyuiop12',
  'qwerty123456',
  'letmein123456',
  'welcome123456',
  'admin12345678',
  'administrator',
  'iloveyou12345',
  'changeme1234',
  'burillab1234',
  'researchlab123',
  'laboratory123',
])

const compact = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export function validateLabJoinPassword(
  labName: string,
  password: string,
): LabPasswordPolicyIssue | null {
  if (password === '') return null
  if (password.length < LAB_JOIN_PASSWORD_MIN_LENGTH || password.length > LAB_JOIN_PASSWORD_MAX_LENGTH) {
    return 'length'
  }

  const normalizedName = labName.trim().toLocaleLowerCase()
  if (normalizedName.length >= 2 && password.toLocaleLowerCase().includes(normalizedName)) {
    return 'lab_name'
  }

  const compactPassword = compact(password)
  const compactName = compact(labName.trim())
  if (compactName.length >= 3 && compactPassword.includes(compactName)) return 'lab_name'
  if (!compactPassword || COMMON_LAB_PASSWORDS.has(compactPassword)) return 'common'
  return null
}

export function labPasswordIssueFromError(error: unknown): LabPasswordPolicyIssue | null {
  const candidate = error && typeof error === 'object'
    ? [
        (error as { code?: unknown }).code,
        (error as { message?: unknown }).message,
        (error as { details?: unknown }).details,
        (error as { error?: unknown }).error,
      ].filter((value): value is string => typeof value === 'string').join('\n')
    : String(error ?? '')
  if (candidate.includes('lab_password_length')) return 'length'
  if (candidate.includes('lab_password_contains_lab_name')) return 'lab_name'
  if (candidate.includes('lab_password_common')) return 'common'
  return null
}
