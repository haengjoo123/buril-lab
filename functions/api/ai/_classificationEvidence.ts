import { z } from 'zod'
import { normalizeCasNumber } from '../../../src/utils/casNumber'
import { formulaCompositionKey } from '../../../src/utils/chemicalFormula'

export const identityEvidenceSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available'), source: z.literal('pubchem'), casNumber: z.string(), cid: z.number().int().positive(),
    title: z.string().min(1).max(400), molecularFormula: z.string().min(1).max(200), checkedAt: z.iso.datetime(), cacheHit: z.boolean() }).strict(),
  z.object({ status: z.literal('unavailable'), cacheHit: z.literal(false) }).strict(),
  z.object({ status: z.literal('not_supplied'), cacheHit: z.literal(false) }).strict(),
])
export type ClassificationIdentityEvidence = z.infer<typeof identityEvidenceSchema>
const propertySchema = z.object({ PropertyTable: z.object({ Properties: z.array(z.object({
  CID: z.number().int().positive(), Title: z.string().min(1).max(400), MolecularFormula: z.string().min(1).max(200),
})).length(1) }) })
const cache = new Map<string, { expiresAt: number; evidence: ClassificationIdentityEvidence }>()
const pending = new Map<string, Promise<ClassificationIdentityEvidence>>()
export function resetClassificationIdentityCache() { cache.clear(); pending.clear() }

export function strictFormulaKey(value: string | undefined): string | null {
  const text = value?.normalize('NFKC').replace(/\s+/g, '').replace(/\((aq|s|l|g)\)$/i, '')
  if (!text || text.length > 200 || text.split(/[.·•]/).some(part => !part)) return null
  const tokens = text.match(/[A-Z][a-z]?|\d+|[()[\].·•]/g)
  if (!tokens || tokens.join('') !== text || tokens.some(token => /^\d+$/.test(token) && (Number(token) < 1 || Number(token) > 100_000))) return null
  const stack: string[] = []
  for (const token of tokens) {
    if (token === '(' || token === '[') { stack.push(token); if (stack.length > 8) return null }
    if ((token === ')' && stack.pop() !== '(') || (token === ']' && stack.pop() !== '[')) return null
  }
  if (stack.length) return null
  const key = formulaCompositionKey(text)
  return key && key.includes(':') ? key : null
}

export function identityEvidenceBlocks(chemical: { casNumber?: string; molecularFormula?: string }, evidence?: ClassificationIdentityEvidence): boolean {
  if (!chemical.casNumber?.trim()) return false
  const cas = normalizeCasNumber(chemical.casNumber)
  if (!cas || evidence?.status !== 'available' || evidence.casNumber !== cas) return true
  if (!chemical.molecularFormula?.trim()) return false
  const declared = strictFormulaKey(chemical.molecularFormula), reference = strictFormulaKey(evidence.molecularFormula)
  return !declared || !reference || declared !== reference
}

async function fetchIdentity(cas: string): Promise<ClassificationIdentityEvidence> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${cas}/property/MolecularFormula,Title/JSON`, {
          method: 'GET', redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/json' },
        })
        if (!response.ok || !response.body) throw new Error('reference_unavailable')
        const length = response.headers.get('content-length')
        if (length && (!/^\d+$/.test(length) || Number(length) > 16_384)) throw new Error('reference_too_large')
        reader = response.body.getReader()
        let text = '', bytes = 0
        const decoder = new TextDecoder('utf-8', { fatal: true })
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > 16_384) throw new Error('reference_too_large')
          text += decoder.decode(chunk.value, { stream: true })
        }
        text += decoder.decode()
        const record = propertySchema.parse(JSON.parse(text)).PropertyTable.Properties[0]
        return { status: 'available' as const, source: 'pubchem' as const, casNumber: cas, cid: record.CID,
          title: record.Title, molecularFormula: record.MolecularFormula, checkedAt: new Date().toISOString(), cacheHit: false }
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('reference_timeout')) }, 2_000) }),
    ])
  } catch { return { status: 'unavailable', cacheHit: false } }
  finally { clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {}) }
}

/** Public CAS facts only: no name/query, credential, model output or DB writes. */
export async function lookupClassificationIdentity(casNumber?: string): Promise<ClassificationIdentityEvidence> {
  if (!casNumber?.trim()) return { status: 'not_supplied', cacheHit: false }
  const cas = normalizeCasNumber(casNumber)
  if (!cas) return { status: 'unavailable', cacheHit: false }
  const found = cache.get(cas)
  if (found && found.expiresAt > Date.now() && found.evidence.status === 'available') return { ...found.evidence, cacheHit: true }
  if (pending.has(cas)) return pending.get(cas)!
  const job = fetchIdentity(cas)
  pending.set(cas, job)
  try {
    const evidence = await job
    if (evidence.status === 'available') {
      if (cache.size >= 128) cache.delete(cache.keys().next().value!)
      cache.set(cas, { expiresAt: Date.now() + 900_000, evidence })
    }
    return evidence
  } finally { pending.delete(cas) }
}
