import { normalizeVoiceLookupText, type VoiceMatchSource } from './voiceAgent'

export type ReagentAliasSourceType = VoiceMatchSource

export interface AliasSeedInput {
  name?: string | null
  casNumber?: string | null
  productNumber?: string | null
  brand?: string | null
}

function stripParentheticalSegments(value: string): string {
  return value.replace(/\s*(?:\([^)]*\)|\[[^\]]*\])/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripTrailingDescriptors(value: string): string {
  return value
    .replace(/\s*,.*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function normalizeAliasText(value?: string | null): string {
  return normalizeVoiceLookupText(value)
}

export function dedupeAliasTerms(
  values: Array<string | null | undefined>,
  limit?: number,
): string[] {
  const unique = new Map<string, string>()

  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed) continue

    const normalized = normalizeAliasText(trimmed)
    if (!normalized) continue

    if (!unique.has(normalized)) {
      unique.set(normalized, trimmed)
    }

    if (typeof limit === 'number' && unique.size >= limit) {
      break
    }
  }

  return Array.from(unique.values())
}

export function buildSeedAliasTerms(input: AliasSeedInput): string[] {
  const name = input.name?.trim()
  const brand = input.brand?.trim()
  const productNumber = input.productNumber?.trim()
  const casNumber = input.casNumber?.trim()

  const aliasCandidates = [
    name,
    name ? stripParentheticalSegments(name) : null,
    name ? stripTrailingDescriptors(name) : null,
    casNumber,
    productNumber,
    name && brand ? `${brand} ${name}` : null,
    name && brand ? `${name} ${brand}` : null,
  ]

  return dedupeAliasTerms(aliasCandidates)
}
