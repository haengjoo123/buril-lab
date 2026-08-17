import { XMLParser } from 'fast-xml-parser'
import type { ChemicalReferencePhLookup } from '../../../src/types'
import { normalizeCasNumber } from '../../../src/utils/casNumber'
import { parseKoshaPhDetail } from '../../../src/utils/koshaPh'
import type { ChemicalCacheEnv } from './_cache'
import {
  createChemicalLeaseOwnerToken,
  readChemicalSourceCache,
  releaseChemicalLease,
  tryAcquireChemicalLease,
  writeChemicalSourceCache,
} from './_sourceCache'

export interface KoshaEnv extends ChemicalCacheEnv {
  KOSHA_API_KEY?: string
}

export interface KoshaIdentity {
  casNumber: string
  chemId: string
  localizedName?: string
}

export type KoshaIdentityOutcome =
  | { kind: 'found'; identity: KoshaIdentity }
  | { kind: 'ambiguous'; candidates: KoshaIdentity[] }
  | { kind: 'not_found' }
  | { kind: 'transient_error'; pending?: boolean }

export type KoshaFetchOutcome =
  | { kind: 'ok'; data: string }
  | { kind: 'not_found' }
  | { kind: 'transient_error' }

type FetchLike = typeof fetch

interface CachedIdentityPayload extends Record<string, unknown> {
  kind: 'found' | 'ambiguous' | 'not_found'
  identities: KoshaIdentity[]
}

interface CachedReferencePhPayload extends Record<string, unknown> {
  status: 'available' | 'source_absent'
  value?: number
  sourceId: string
}

const KOSHA_BASE_URL = 'https://msds.kosha.or.kr/openapi/service/msdschem'
const FETCH_TIMEOUT_MS = 6_000
const MAX_FETCH_ATTEMPTS = 2
const IDENTITY_TTL_MS = 30 * 24 * 60 * 60 * 1000
const IDENTITY_NEGATIVE_TTL_MS = 60 * 60 * 1000
const REFERENCE_PH_TTL_MS = 30 * 24 * 60 * 60 * 1000
const REFERENCE_PH_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
const LEASE_POLL_DELAYS_MS = [150, 250, 350, 500]

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
const inFlight = new Map<string, Promise<unknown>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nestedRecord(record: Record<string, unknown> | undefined, ...keys: string[]): Record<string, unknown> | undefined {
  let current: unknown = record
  for (const key of keys) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return isRecord(current) ? current : undefined
}

export function parseKoshaItems(xml: string): Record<string, unknown>[] {
  const parsed = parser.parse(xml) as unknown
  const root = isRecord(parsed) ? parsed : undefined
  const items = nestedRecord(root, 'response', 'body', 'items')?.item
  if (Array.isArray(items)) return items.filter(isRecord)
  return isRecord(items) ? [items] : []
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs))
}

async function withInFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const created = factory()
  inFlight.set(key, created)
  try {
    return await created
  } finally {
    if (inFlight.get(key) === created) inFlight.delete(key)
  }
}

export async function fetchKoshaText(
  endpoint: string,
  params: URLSearchParams,
  env: KoshaEnv,
  fetchImpl: FetchLike = fetch,
): Promise<KoshaFetchOutcome> {
  if (!env.KOSHA_API_KEY?.trim()) return { kind: 'transient_error' }
  const upstreamParams = new URLSearchParams(params)
  upstreamParams.set('serviceKey', env.KOSHA_API_KEY)

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetchImpl(`${KOSHA_BASE_URL}/${endpoint}?${upstreamParams}`, {
        signal: controller.signal,
        headers: { Accept: 'application/xml,text/xml' },
      })
      if (response.status === 404) return { kind: 'not_found' }
      if (response.ok) return { kind: 'ok', data: await response.text() }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      if (!retryable || attempt === MAX_FETCH_ATTEMPTS - 1) return { kind: 'transient_error' }
    } catch {
      if (attempt === MAX_FETCH_ATTEMPTS - 1) return { kind: 'transient_error' }
    } finally {
      globalThis.clearTimeout(timeout)
    }
    await wait(300 * (attempt + 1))
  }
  return { kind: 'transient_error' }
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
}

function identityFromItem(item: Record<string, unknown>): KoshaIdentity | null {
  const casNumber = normalizeCasNumber(String(item.casNo ?? ''))
  const rawChemId = String(item.chemId ?? '').trim()
  if (!casNumber || !/^\d{1,12}$/.test(rawChemId)) return null
  const localizedName = typeof item.chemNameKor === 'string' ? item.chemNameKor.trim() : undefined
  return {
    casNumber,
    chemId: rawChemId.padStart(6, '0'),
    ...(localizedName ? { localizedName } : {}),
  }
}

function exactNameMatches(candidate: string, expected: string): boolean {
  const normalizedCandidate = candidate.normalize('NFKC').trim()
  const normalizedExpected = expected.normalize('NFKC').trim()
  if (normalizedCandidate === normalizedExpected) return true
  const beforeParen = normalizedCandidate.split('(')[0].trim()
  const parenthesized = Array.from(normalizedCandidate.matchAll(/\(([^)]*)\)/g))
    .flatMap((match) => match[1].split(',').map((value) => value.trim()))
  return beforeParen === normalizedExpected || parenthesized.includes(normalizedExpected)
}

export async function searchKoshaNames(
  keyword: string,
  limit: number,
  env: KoshaEnv,
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  const normalizedKeyword = keyword.normalize('NFKC').trim()
  if (normalizedKeyword.length < 2) return []
  const response = await fetchKoshaText('chemlist', new URLSearchParams({
    searchWrd: normalizedKeyword,
    searchCnd: '0',
    pageNo: '1',
    numOfRows: String(Math.min(Math.max(limit * 2, limit), 20)),
  }), env, fetchImpl)
  if (response.kind !== 'ok') return []
  return Array.from(new Set(
    parseKoshaItems(response.data)
      .map((item) => typeof item.chemNameKor === 'string' ? item.chemNameKor.trim() : '')
      .filter(Boolean),
  )).slice(0, limit)
}

function cachedIdentityOutcome(payload: CachedIdentityPayload): KoshaIdentityOutcome {
  if (payload.kind === 'found' && payload.identities[0]) return { kind: 'found', identity: payload.identities[0] }
  if (payload.kind === 'ambiguous') return { kind: 'ambiguous', candidates: payload.identities }
  return { kind: 'not_found' }
}

async function pollIdentityCache(env: KoshaEnv, lookupKey: string): Promise<KoshaIdentityOutcome | null> {
  for (const delay of LEASE_POLL_DELAYS_MS) {
    await wait(delay)
    const cached = await readChemicalSourceCache<CachedIdentityPayload>(env, 'identity', lookupKey)
    if (cached) return cachedIdentityOutcome(cached.result)
  }
  return null
}

async function resolveKoshaIdentity(
  env: KoshaEnv,
  lookupKey: string,
  searchWrd: string,
  searchCnd: '0' | '1',
  select: (items: Record<string, unknown>[]) => KoshaIdentity[],
  fetchImpl: FetchLike,
): Promise<KoshaIdentityOutcome> {
  const cached = await readChemicalSourceCache<CachedIdentityPayload>(env, 'identity', lookupKey)
  if (cached) return cachedIdentityOutcome(cached.result)

  return withInFlight(`identity:${lookupKey}`, async () => {
    const cachedAfterJoin = await readChemicalSourceCache<CachedIdentityPayload>(env, 'identity', lookupKey)
    if (cachedAfterJoin) return cachedIdentityOutcome(cachedAfterJoin.result)

    const ownerToken = createChemicalLeaseOwnerToken()
    const leaseKey = `kosha:identity:${lookupKey}`
    const acquired = await tryAcquireChemicalLease(env, leaseKey, ownerToken)
    if (!acquired) return (await pollIdentityCache(env, lookupKey)) || { kind: 'transient_error', pending: true }

    try {
      const response = await fetchKoshaText('chemlist', new URLSearchParams({
        searchWrd,
        searchCnd,
        pageNo: '1',
        numOfRows: '20',
      }), env, fetchImpl)
      if (response.kind === 'transient_error') return { kind: 'transient_error' }
      const identities = response.kind === 'ok' ? select(parseKoshaItems(response.data)) : []
      const uniqueByCas = Array.from(new Map(identities.map((identity) => [identity.casNumber, identity])).values())
      const outcome: KoshaIdentityOutcome = uniqueByCas.length === 1
        ? { kind: 'found', identity: uniqueByCas[0] }
        : uniqueByCas.length > 1
          ? { kind: 'ambiguous', candidates: uniqueByCas }
          : { kind: 'not_found' }
      const payload: CachedIdentityPayload = {
        kind: outcome.kind === 'found' ? 'found' : outcome.kind === 'ambiguous' ? 'ambiguous' : 'not_found',
        identities: outcome.kind === 'found' ? [outcome.identity] : outcome.kind === 'ambiguous' ? outcome.candidates : [],
      }
      const aliases = outcome.kind === 'found' ? [lookupKey, `cas:${outcome.identity.casNumber}`] : [lookupKey]
      await writeChemicalSourceCache(
        env,
        'identity',
        aliases,
        outcome.kind === 'not_found' ? 'source_absent' : 'complete',
        payload,
        outcome.kind === 'found' ? IDENTITY_TTL_MS : IDENTITY_NEGATIVE_TTL_MS,
      )
      return outcome
    } finally {
      await releaseChemicalLease(env, leaseKey, ownerToken)
    }
  })
}

export function resolveKoshaIdentityByCas(
  casNumber: string,
  env: KoshaEnv,
  fetchImpl: FetchLike = fetch,
): Promise<KoshaIdentityOutcome> {
  const normalizedCas = normalizeCasNumber(casNumber)
  if (!normalizedCas) return Promise.resolve({ kind: 'not_found' })
  return resolveKoshaIdentity(
    env,
    `cas:${normalizedCas}`,
    normalizedCas,
    '1',
    (items) => items.map(identityFromItem).filter((value): value is KoshaIdentity => Boolean(value))
      .filter((identity) => identity.casNumber === normalizedCas),
    fetchImpl,
  )
}

export function resolveKoshaIdentityByExactName(
  name: string,
  env: KoshaEnv,
  fetchImpl: FetchLike = fetch,
): Promise<KoshaIdentityOutcome> {
  const normalized = normalizeName(name)
  if (!normalized) return Promise.resolve({ kind: 'not_found' })
  return resolveKoshaIdentity(
    env,
    `name:${normalized}`,
    name.normalize('NFKC').trim(),
    '0',
    (items) => items
      .filter((item) => exactNameMatches(String(item.chemNameKor ?? ''), name))
      .map(identityFromItem)
      .filter((value): value is KoshaIdentity => Boolean(value)),
    fetchImpl,
  )
}

function cachedReferencePh(value: {
  result: CachedReferencePhPayload
  fetchedAt: string
  expiresAt: string
}): ChemicalReferencePhLookup {
  return value.result.status === 'available' && typeof value.result.value === 'number'
    ? {
        status: 'available',
        value: value.result.value,
        source: 'kosha',
        sourceId: value.result.sourceId,
        fetchedAt: value.fetchedAt,
        expiresAt: value.expiresAt,
      }
    : {
        status: 'source_absent',
        source: 'kosha',
        sourceId: value.result.sourceId,
        fetchedAt: value.fetchedAt,
        expiresAt: value.expiresAt,
      }
}

async function pollReferencePhCache(env: KoshaEnv, lookupKey: string): Promise<ChemicalReferencePhLookup | null> {
  for (const delay of LEASE_POLL_DELAYS_MS) {
    await wait(delay)
    const cached = await readChemicalSourceCache<CachedReferencePhPayload>(env, 'reference_ph', lookupKey)
    if (cached) return cachedReferencePh(cached)
  }
  return null
}

export async function resolveKoshaReferencePh(
  identity: KoshaIdentity,
  env: KoshaEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ChemicalReferencePhLookup> {
  const lookupKey = `chem_id:${identity.chemId}`
  const cached = await readChemicalSourceCache<CachedReferencePhPayload>(env, 'reference_ph', lookupKey)
  if (cached) return cachedReferencePh(cached)

  return withInFlight(`reference_ph:${lookupKey}`, async () => {
    const cachedAfterJoin = await readChemicalSourceCache<CachedReferencePhPayload>(env, 'reference_ph', lookupKey)
    if (cachedAfterJoin) return cachedReferencePh(cachedAfterJoin)

    const ownerToken = createChemicalLeaseOwnerToken()
    const leaseKey = `kosha:reference_ph:${lookupKey}`
    const acquired = await tryAcquireChemicalLease(env, leaseKey, ownerToken)
    if (!acquired) {
      return (await pollReferencePhCache(env, lookupKey)) || {
        status: 'pending',
        source: 'kosha',
        sourceId: identity.chemId,
        retryAfterMs: 2_000,
      }
    }

    try {
      const response = await fetchKoshaText('chemdetail09', new URLSearchParams({ chemId: identity.chemId }), env, fetchImpl)
      if (response.kind === 'transient_error') {
        return { status: 'transient_error', source: 'kosha', sourceId: identity.chemId, retryAfterMs: 2_000 }
      }
      const items = response.kind === 'ok' ? parseKoshaItems(response.data) : []
      const phItem = items.find((item) => String(item.msdsItemNameKor ?? '').toLowerCase().includes('ph'))
      const value = parseKoshaPhDetail(typeof phItem?.itemDetail === 'string' ? phItem.itemDetail : undefined)
      const status = value === undefined ? 'source_absent' as const : 'available' as const
      const payload: CachedReferencePhPayload = {
        status,
        ...(value !== undefined ? { value } : {}),
        sourceId: identity.chemId,
      }
      const fetchedAt = new Date()
      const ttlMs = value === undefined ? REFERENCE_PH_NEGATIVE_TTL_MS : REFERENCE_PH_TTL_MS
      await writeChemicalSourceCache(
        env,
        'reference_ph',
        [lookupKey, `cas:${identity.casNumber}`],
        value === undefined ? 'source_absent' : 'complete',
        payload,
        ttlMs,
      )
      return {
        status,
        ...(value !== undefined ? { value } : {}),
        source: 'kosha',
        sourceId: identity.chemId,
        fetchedAt: fetchedAt.toISOString(),
        expiresAt: new Date(fetchedAt.getTime() + ttlMs).toISOString(),
      }
    } finally {
      await releaseChemicalLease(env, leaseKey, ownerToken)
    }
  })
}
