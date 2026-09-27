import type { ImportAttribute } from './types'

export function readableImportAttributes(value: unknown): ImportAttribute[] {
  if (!Array.isArray(value)) return []
  return value.filter((a): a is ImportAttribute => Boolean(a) && typeof a === 'object' && typeof a.label === 'string' && typeof a.value === 'string' && typeof a.address === 'string')
}
export function exportImportAttributes(value: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  const counts = new Map<string, number>()
  for (const a of readableImportAttributes(value)) {
    const count = (counts.get(a.label) || 0) + 1; counts.set(a.label, count)
    out[`원본 · ${a.label}${count > 1 ? ` (${count})` : ''}`] = a.value
  }
  return out
}
