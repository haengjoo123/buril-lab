/**
 * Parses a KOSHA Section 9 pH detail without mistaking temperature,
 * concentration, or molarity for a pH value.
 */
export function parseKoshaPhDetail(detail?: string | null): number | undefined {
  const normalized = String(detail ?? '').normalize('NFKC').trim()
  if (!normalized) return undefined

  const explicitPh = normalized.match(/\bpH\s*(?:[:=]|is|는|은)?\s*(-?\d+(?:\.\d+)?)/i)
  if (explicitPh) {
    const value = Number(explicitPh[1])
    return Number.isFinite(value) && value >= 0 && value <= 14 ? value : undefined
  }

  const withoutConditions = normalized
    .replace(/-?\d+(?:\.\d+)?\s*(?:°\s*[CF]|℃|℉)/gi, ' ')
    .replace(/-?\d+(?:\.\d+)?\s*%/g, ' ')
    .replace(/-?\d+(?:\.\d+)?\s*(?:mM|M|mol\s*\/?\s*L|mg\s*\/?\s*mL)\b/gi, ' ')
    .replace(/\([^)]*(?:°\s*[CF]|℃|℉|%|mM|mol\s*\/?\s*L)[^)]*\)/gi, ' ')
  const values = (withoutConditions.match(/-?\d+(?:\.\d+)?/g) ?? [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 14)

  return values.length === 1 ? values[0] : undefined
}
