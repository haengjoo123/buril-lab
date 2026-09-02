import type {
  ChemicalEnrichmentDelivery,
  ChemicalEnrichmentProfile,
  ChemicalEnrichmentRequest,
  ChemicalEnrichmentRequestItem,
  ChemicalEnrichmentResult,
} from '../../../src/types'
import { normalizeCasNumber } from '../../../src/utils/casNumber'
import { readLimitedJson, RequestBodyError, requestBodyErrorResponse } from '../_shared/requestBody'
import {
  getChemicalLookupKeys,
  createChemicalCacheAdminClient,
  projectLegacyGhsCache,
  readChemicalEnrichmentCache,
  verifyLabMembership,
  writeChemicalEnrichmentCache,
  type ChemicalCacheEnv,
} from './_cache'
import { enrichChemicalItem, type ChemicalEnrichmentEnv } from './_pipeline'
import {
  resolveKoshaIdentityByCas,
  resolveKoshaReferencePh,
  type KoshaIdentity,
} from './_kosha'

interface Env extends ChemicalCacheEnv, ChemicalEnrichmentEnv {}

interface FunctionContext {
  request: Request
  env: Env
  data: Record<string, unknown>
  waitUntil(promise: Promise<unknown>): void
}

const MAX_ITEMS = 25
const MAX_BODY_BYTES = 64 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INCHI_KEY_PATTERN = /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/
const FORMULA_PATTERN = /^[A-Za-z0-9()[\].+\-·]+$/
const REFERENCE_PH_FOREGROUND_BUDGET_MS = 2_000
const coreInFlight = new Map<string, Promise<ChemicalEnrichmentResult>>()

interface ApprovedAliasRow {
  normalized_alias: string
  canonical_name: string
  cas_number: string | null
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function validateItem(value: unknown, index: number): ChemicalEnrichmentRequestItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`items[${index}] must be an object.`)
  const item = value as Record<string, unknown>
  const requestId = typeof item.requestId === 'string' ? item.requestId.trim() : ''
  if (!requestId || requestId.length > 100) throw new Error(`items[${index}].requestId is invalid.`)

  const name = typeof item.name === 'string' ? item.name.normalize('NFKC').trim() : undefined
  if (name && name.length > 200) throw new Error(`items[${index}].name is too long.`)
  const rawCas = typeof item.casNumber === 'string' ? item.casNumber : undefined
  const casNumber = rawCas ? normalizeCasNumber(rawCas) : null
  if (rawCas && !casNumber) throw new Error(`items[${index}].casNumber has an invalid checksum.`)
  const pubchemCid = item.pubchemCid === undefined ? undefined : Number(item.pubchemCid)
  if (pubchemCid !== undefined && (!Number.isSafeInteger(pubchemCid) || pubchemCid <= 0)) {
    throw new Error(`items[${index}].pubchemCid must be a positive integer.`)
  }
  const standardInchiKey = typeof item.standardInchiKey === 'string' ? item.standardInchiKey.trim().toUpperCase() : undefined
  if (standardInchiKey && !INCHI_KEY_PATTERN.test(standardInchiKey)) {
    throw new Error(`items[${index}].standardInchiKey is invalid.`)
  }
  const molecularFormula = typeof item.molecularFormula === 'string' ? item.molecularFormula.normalize('NFKC').replace(/\s+/g, '') : undefined
  if (molecularFormula && (molecularFormula.length > 100 || !FORMULA_PATTERN.test(molecularFormula))) {
    throw new Error(`items[${index}].molecularFormula is invalid.`)
  }
  const molecularWeight = item.molecularWeight === undefined ? undefined : Number(item.molecularWeight)
  if (molecularWeight !== undefined && (!Number.isFinite(molecularWeight) || molecularWeight <= 0 || molecularWeight > 10_000_000)) {
    throw new Error(`items[${index}].molecularWeight is invalid.`)
  }
  if (!name && !casNumber && !pubchemCid && !standardInchiKey) {
    throw new Error(`items[${index}] must include an identity key.`)
  }
  return {
    requestId,
    ...(name ? { name } : {}),
    ...(casNumber ? { casNumber } : {}),
    ...(pubchemCid ? { pubchemCid } : {}),
    ...(standardInchiKey ? { standardInchiKey } : {}),
    ...(molecularFormula ? { molecularFormula } : {}),
    ...(molecularWeight ? { molecularWeight } : {}),
  }
}

function parseRequest(value: unknown): ChemicalEnrichmentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Request body must be an object.')
  const body = value as Record<string, unknown>
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS) {
    throw new Error(`items must contain between 1 and ${MAX_ITEMS} entries.`)
  }
  const items = body.items.map(validateItem)
  const requestIds = new Set(items.map((item) => item.requestId))
  if (requestIds.size !== items.length) throw new Error('requestId values must be unique.')
  const profile = body.profile === undefined ? 'full' : body.profile
  if (profile !== 'full' && profile !== 'inventory_hazard') {
    throw new Error('profile must be either full or inventory_hazard.')
  }
  const scope = body.scope && typeof body.scope === 'object' && !Array.isArray(body.scope)
    ? body.scope as Record<string, unknown>
    : undefined
  const labId = typeof scope?.labId === 'string' ? scope.labId.trim() : undefined
  if (labId && !UUID_PATTERN.test(labId)) throw new Error('scope.labId is invalid.')
  return {
    items,
    profile: profile as ChemicalEnrichmentProfile,
    ...(labId ? { scope: { labId } } : {}),
  }
}

async function resolveApprovedAliases(
  items: ChemicalEnrichmentRequestItem[],
  env: Env,
): Promise<ChemicalEnrichmentRequestItem[]> {
  const names = Array.from(new Set(items.flatMap((item) => (
    item.name && !item.casNumber && !item.pubchemCid && !item.standardInchiKey
      ? [item.name.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')]
      : []
  ))))
  if (names.length === 0) return items
  const adminClient = createChemicalCacheAdminClient(env)
  if (!adminClient) return items
  const { data, error } = await adminClient
    .from('global_reagent_aliases')
    .select('normalized_alias, canonical_name, cas_number')
    .eq('is_active', true)
    .in('normalized_alias', names)
  if (error) {
    console.warn('[chemicals/enrich] Approved alias resolution failed:', error.message)
    return items
  }
  const aliases = new Map((data || []).map((row: ApprovedAliasRow) => [row.normalized_alias, row]))
  return items.map((item) => {
    if (!item.name || item.casNumber || item.pubchemCid || item.standardInchiKey) return item
    const normalized = item.name.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
    const alias = aliases.get(normalized)
    if (!alias) return item
    const verifiedCas = normalizeCasNumber(alias.cas_number)
    return {
      ...item,
      name: alias.canonical_name,
      ...(verifiedCas ? { casNumber: verifiedCas } : {}),
    }
  })
}

async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()))
  return results
}

interface CoreEnrichmentResolution {
  result: ChemicalEnrichmentResult
  delivery: ChemicalEnrichmentDelivery
  revalidation?: Promise<ChemicalEnrichmentResult>
}

function resolveUpstreamEnrichment(
  item: ChemicalEnrichmentRequestItem,
  env: Env,
): Promise<ChemicalEnrichmentResult> {
  const key = getChemicalLookupKeys(item).sort().join('|') || `request:${item.requestId}`
  const existing = coreInFlight.get(key)
  if (existing) return existing.then((result) => ({ ...result, requestId: item.requestId }))

  const created = enrichChemicalItem(item, env)
  coreInFlight.set(key, created)
  return created.then((result) => ({ ...result, requestId: item.requestId })).finally(() => {
    if (coreInFlight.get(key) === created) coreInFlight.delete(key)
  })
}

async function resolveCoreEnrichment(
  item: ChemicalEnrichmentRequestItem,
  env: Env,
  allowStale: boolean,
): Promise<CoreEnrichmentResolution> {
  const cached = await readChemicalEnrichmentCache(env, item)
  if (cached?.freshness === 'fresh') {
    return {
      result: cached.result,
      delivery: { freshness: 'fresh', source: 'server_cache' },
    }
  }
  if (cached?.freshness === 'stale' && allowStale) {
    return {
      result: cached.result,
      delivery: {
        freshness: 'stale',
        source: 'server_cache',
        revalidationScheduled: true,
      },
      revalidation: resolveUpstreamEnrichment(item, env),
    }
  }
  return {
    result: await resolveUpstreamEnrichment(item, env),
    delivery: { freshness: 'fresh', source: 'upstream' },
  }
}

function inventoryHazardResult(
  result: ChemicalEnrichmentResult,
  delivery: ChemicalEnrichmentDelivery,
): ChemicalEnrichmentResult {
  const inventoryResult: ChemicalEnrichmentResult = {
    ...result,
    referencePh: { status: 'not_requested' },
    delivery,
  }
  if (result.hazard.status !== 'transient_error') delete inventoryResult.retryAfterMs
  return inventoryResult
}

function pendingReferencePh(result: ChemicalEnrichmentResult): ChemicalEnrichmentResult {
  return {
    ...result,
    referencePh: {
      status: 'pending',
      source: 'kosha',
      ...(result.identity.koshaChemId ? { sourceId: String(result.identity.koshaChemId).padStart(6, '0') } : {}),
      retryAfterMs: 2_000,
    },
    retryAfterMs: 2_000,
  }
}

export async function hydrateKoshaSupplement(
  result: ChemicalEnrichmentResult,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<ChemicalEnrichmentResult> {
  if (result.referencePh.status === 'available' || result.referencePh.status === 'source_absent') return result
  if (result.identity.status === 'ambiguous') {
    return { ...result, referencePh: { status: 'identity_ambiguous' } }
  }
  const casNumber = result.identity.casNumber
  if (result.identity.status !== 'verified' || !casNumber) {
    return { ...result, referencePh: { status: 'source_absent' } }
  }

  let identity: KoshaIdentity | undefined
  if (result.identity.koshaChemId) {
    identity = {
      casNumber,
      chemId: String(result.identity.koshaChemId).padStart(6, '0'),
      ...(result.identity.localizedName ? { localizedName: result.identity.localizedName } : {}),
    }
  } else {
    const identityOutcome = await resolveKoshaIdentityByCas(casNumber, env, fetchImpl)
    if (identityOutcome.kind === 'ambiguous') {
      return { ...result, referencePh: { status: 'identity_ambiguous' } }
    }
    if (identityOutcome.kind === 'not_found') {
      return { ...result, referencePh: { status: 'source_absent', source: 'kosha' } }
    }
    if (identityOutcome.kind === 'transient_error') {
      return {
        ...result,
        referencePh: { status: identityOutcome.pending ? 'pending' : 'transient_error', source: 'kosha', retryAfterMs: 2_000 },
        retryAfterMs: 2_000,
      }
    }
    identity = identityOutcome.identity
  }

  const referencePh = await resolveKoshaReferencePh(identity, env, fetchImpl)
  const baseResult = { ...result }
  delete baseResult.retryAfterMs
  return {
    ...baseResult,
    identity: {
      ...result.identity,
      koshaChemId: Number(identity.chemId),
      ...(identity.localizedName ? { localizedName: identity.localizedName } : {}),
    },
    referencePh,
    ...(referencePh.status === 'pending' || referencePh.status === 'transient_error'
      ? { retryAfterMs: referencePh.retryAfterMs || 2_000 }
      : {}),
  }
}

async function foregroundSupplement(
  result: ChemicalEnrichmentResult,
  completion: Promise<ChemicalEnrichmentResult>,
): Promise<ChemicalEnrichmentResult> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined
  try {
    return await Promise.race([
      completion,
      new Promise<ChemicalEnrichmentResult>((resolve) => {
        timeoutId = globalThis.setTimeout(() => resolve(pendingReferencePh(result)), REFERENCE_PH_FOREGROUND_BUDGET_MS)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId)
  }
}

export const onRequestPost = async (context: FunctionContext): Promise<Response> => {
  let input: unknown
  try {
    input = await readLimitedJson(context.request, MAX_BODY_BYTES)
  } catch (error) {
    if (error instanceof RequestBodyError) return requestBodyErrorResponse(error)
    return jsonResponse({ error: 'Invalid request body.' }, 400)
  }
  let requestBody: ChemicalEnrichmentRequest
  try {
    // Only our fixed field-validation messages may reach this response.
    // JSON parser exceptions, which can contain request fragments, are isolated above.
    requestBody = parseRequest(input)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid request body.' }, 400)
  }

  const userId = typeof context.data.userId === 'string' ? context.data.userId : undefined
  const labId = requestBody.scope?.labId
  if (labId && (!userId || !(await verifyLabMembership(context.env, userId, labId)))) {
    return jsonResponse({ error: 'The requested laboratory scope is not accessible.' }, 403)
  }

  const resolvedItems = await resolveApprovedAliases(requestBody.items, context.env)
  const enriched = await mapWithConcurrency(resolvedItems, 3, async (item) => {
    const profile = requestBody.profile || 'full'
    const resolution = await resolveCoreEnrichment(item, context.env, profile === 'inventory_hazard')
    const coreCompletion = resolution.revalidation || Promise.resolve(resolution.result)
    if (profile === 'inventory_hazard') {
      return {
        result: inventoryHazardResult(resolution.result, resolution.delivery),
        completion: coreCompletion.catch(() => null),
      }
    }
    const completion = coreCompletion.then((core) => hydrateKoshaSupplement(core, context.env)).catch(() => ({
      ...resolution.result,
      referencePh: { status: 'transient_error' as const, source: 'kosha' as const, retryAfterMs: 2_000 },
      retryAfterMs: 2_000,
    }))
    return {
      result: {
        ...(await foregroundSupplement(resolution.result, completion)),
        delivery: resolution.delivery,
      },
      completion,
    }
  })
  const results = enriched.map((value) => value.result)

  const backgroundWrites = resolvedItems.map(async (item, index) => {
    const result = await enriched[index].completion
    if (!result) return
    await writeChemicalEnrichmentCache(context.env, item, result)
    if (userId) await projectLegacyGhsCache(context.env, userId, labId, result)
  })
  context.waitUntil(Promise.all(backgroundWrites).then(() => undefined))

  return jsonResponse({ results })
}
