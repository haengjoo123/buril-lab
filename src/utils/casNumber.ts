const CAS_NUMBER_SHAPE_PATTERN = /^\d{2,7}-\d{2}-\d$/
const CAS_NUMBER_PATTERN = /^[1-9]\d{1,6}-\d{2}-\d$/

function normalizeCasFormatting(value?: string | null): string {
  return (value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim()
}

export function hasCasNumberFormat(value?: string | null): boolean {
  return CAS_NUMBER_SHAPE_PATTERN.test(normalizeCasFormatting(value))
}

export function passesCasChecksum(value?: string | null): boolean {
  const normalized = normalizeCasFormatting(value)
  if (!CAS_NUMBER_PATTERN.test(normalized)) return false

  const [left, middle, checkDigit] = normalized.split('-')
  const digits = `${left}${middle}`.split('').reverse()
  const total = digits.reduce(
    (sum, digit, index) => sum + Number.parseInt(digit, 10) * (index + 1),
    0,
  )

  return total % 10 === Number.parseInt(checkDigit, 10)
}

export function normalizeCasNumber(value?: string | null): string | null {
  const normalized = normalizeCasFormatting(value)
  return passesCasChecksum(normalized) ? normalized : null
}

export function isValidCasNumber(value?: string | null): boolean {
  return normalizeCasNumber(value) !== null
}

export function extractValidCasNumber(text: string): string | null {
  const candidates = text.normalize('NFKC').match(/\b[1-9]\d{1,6}-\d{2}-\d\b/g) || []
  return candidates.map((candidate) => normalizeCasNumber(candidate)).find(Boolean) || null
}
