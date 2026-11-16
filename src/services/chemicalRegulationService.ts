import { normalizeCasNumber } from '../utils/casNumber'
import type {
  ChemicalRegulationBatchResponse,
  ChemicalRegulationLookup,
} from '../utils/chemicalRegulations'
import { getJson, postJson } from './internalApi'

const UNAVAILABLE: ChemicalRegulationLookup = { status: 'unavailable' }
const BATCH_SIZE = 100
const BATCH_RETRY_DELAY_MS = 2_500
const MAX_BATCH_ROUNDS = 12

// One request per CAS per session; failures are dropped so a later view retries.
const lookups = new Map<string, Promise<ChemicalRegulationLookup>>()

export function fetchChemicalRegulations(rawCasNumber: string): Promise<ChemicalRegulationLookup> {
  const casNumber = normalizeCasNumber(rawCasNumber)
  if (!casNumber) return Promise.resolve({ status: 'not_found' })

  const existing = lookups.get(casNumber)
  if (existing) return existing

  const request = getJson<ChemicalRegulationLookup>(
    `/api/chemicals/regulations?cas=${encodeURIComponent(casNumber)}`,
    { cache: 'no-store' },
  )
    .then((lookup) => {
      if (lookup.status === 'unavailable') lookups.delete(casNumber)
      return lookup
    })
    .catch(() => {
      lookups.delete(casNumber)
      return UNAVAILABLE
    })
  lookups.set(casNumber, request)
  return request
}

export interface ChemicalRegulationBatchRound {
  /** Definitive answers (found / not_found) known so far, by normalized CAS. */
  resolved: Map<string, ChemicalRegulationLookup>
  /** CAS numbers the server has not looked up yet; ask again shortly. */
  pending: string[]
  /** CAS numbers that could not be answered this round (upstream or network failure). */
  failed: string[]
}

/**
 * One round of the lab-wide lookup: answers already in this session come from
 * memory, the rest are asked in chunks of 100. Definitive answers are kept for
 * the session, so the detail card opens without another request.
 */
export async function fetchChemicalRegulationsBatch(
  rawCasNumbers: readonly string[],
  options?: { signal?: AbortSignal },
): Promise<ChemicalRegulationBatchRound> {
  const casNumbers = Array.from(new Set(rawCasNumbers
    .map((value) => normalizeCasNumber(value))
    .filter((value): value is string => Boolean(value))))
  const round: ChemicalRegulationBatchRound = { resolved: new Map(), pending: [], failed: [] }

  const toAsk: string[] = []
  await Promise.all(casNumbers.map(async (cas) => {
    const known = lookups.get(cas)
    if (!known) {
      toAsk.push(cas)
      return
    }
    const lookup = await known
    if (lookup.status === 'unavailable') round.failed.push(cas)
    else round.resolved.set(cas, lookup)
  }))

  for (let start = 0; start < toAsk.length; start += BATCH_SIZE) {
    const chunk = toAsk.slice(start, start + BATCH_SIZE)
    try {
      const { results } = await postJson<ChemicalRegulationBatchResponse>(
        '/api/chemicals/regulations-batch',
        { cas: chunk },
        { signal: options?.signal },
      )
      for (const cas of chunk) {
        const result = results[cas]
        if (result?.status === 'found' || result?.status === 'not_found') {
          lookups.set(cas, Promise.resolve(result))
          round.resolved.set(cas, result)
        } else if (result?.status === 'pending') {
          round.pending.push(cas)
        } else {
          round.failed.push(cas)
        }
      }
    } catch (error) {
      if (options?.signal?.aborted) throw error
      round.failed.push(...chunk)
    }
  }
  return round
}

/**
 * Repeats batch rounds while the server still reports pending CAS numbers,
 * calling `onProgress` with everything known after each round. Stops when
 * nothing is pending, when a round makes no progress, or when aborted.
 */
export async function loadChemicalRegulations(
  rawCasNumbers: readonly string[],
  options: {
    signal?: AbortSignal
    onProgress?: (resolved: Map<string, ChemicalRegulationLookup>) => void
    retryDelayMs?: number
    maxRounds?: number
  } = {},
): Promise<Map<string, ChemicalRegulationLookup>> {
  const { signal, onProgress, retryDelayMs = BATCH_RETRY_DELAY_MS, maxRounds = MAX_BATCH_ROUNDS } = options
  const resolved = new Map<string, ChemicalRegulationLookup>()
  let remaining: readonly string[] = rawCasNumbers

  for (let round = 0; round < maxRounds && remaining.length > 0; round += 1) {
    if (round > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, retryDelayMs)
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(signal.reason)
        }, { once: true })
      })
    }
    const result = await fetchChemicalRegulationsBatch(remaining, { signal })
    const before = resolved.size
    for (const [cas, lookup] of result.resolved) resolved.set(cas, lookup)
    onProgress?.(new Map(resolved))
    if (result.pending.length === 0 || resolved.size === before) break
    remaining = result.pending
  }
  return resolved
}

/** Test hook: forget what this session has looked up. */
export function clearChemicalRegulationSession(): void {
  lookups.clear()
}
