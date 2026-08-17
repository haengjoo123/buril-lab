import type {
  ChemicalEnrichmentRequest,
  ChemicalEnrichmentRequestItem,
  ChemicalEnrichmentResult,
} from '../../../src/types'
import { normalizeCasNumber } from '../../../src/utils/casNumber'
import {
  projectLegacyGhsCache,
  readChemicalEnrichmentCache,
  verifyLabMembership,
  writeChemicalEnrichmentCache,
  type ChemicalCacheEnv,
} from './_cache'
import { enrichChemicalItem, type ChemicalEnrichmentEnv } from './_pipeline'

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
  const scope = body.scope && typeof body.scope === 'object' && !Array.isArray(body.scope)
    ? body.scope as Record<string, unknown>
    : undefined
  const labId = typeof scope?.labId === 'string' ? scope.labId.trim() : undefined
  if (labId && !UUID_PATTERN.test(labId)) throw new Error('scope.labId is invalid.')
  return { items, ...(labId ? { scope: { labId } } : {}) }
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

export const onRequestPost = async (context: FunctionContext): Promise<Response> => {
  const contentLength = Number(context.request.headers.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) return jsonResponse({ error: 'Request body is too large.' }, 413)

  let requestBody: ChemicalEnrichmentRequest
  try {
    const rawText = await context.request.text()
    if (new TextEncoder().encode(rawText).byteLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Request body is too large.' }, 413)
    }
    requestBody = parseRequest(JSON.parse(rawText) as unknown)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid request body.' }, 400)
  }

  const userId = typeof context.data.userId === 'string' ? context.data.userId : undefined
  const labId = requestBody.scope?.labId
  if (labId && (!userId || !(await verifyLabMembership(context.env, userId, labId)))) {
    return jsonResponse({ error: 'The requested laboratory scope is not accessible.' }, 403)
  }

  const results = await mapWithConcurrency(requestBody.items, 3, async (item): Promise<ChemicalEnrichmentResult> => {
    const cached = await readChemicalEnrichmentCache(context.env, item)
    return cached || enrichChemicalItem(item, context.env)
  })

  const backgroundWrites = requestBody.items.flatMap((item, index) => {
    const result = results[index]
    const writes: Promise<void>[] = [writeChemicalEnrichmentCache(context.env, item, result)]
    if (userId) writes.push(projectLegacyGhsCache(context.env, userId, labId, result))
    return writes
  })
  context.waitUntil(Promise.all(backgroundWrites).then(() => undefined))

  return jsonResponse({ results })
}
