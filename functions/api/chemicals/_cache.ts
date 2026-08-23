import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ChemicalEnrichmentRequestItem, ChemicalEnrichmentResult } from '../../../src/types'

export interface ChemicalCacheEnv {
  SUPABASE_URL?: string
  VITE_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

interface CacheRow {
  result: ChemicalEnrichmentResult | null
  expires_at: string | null
  fetched_at: string | null
  result_version: number
}

export interface ChemicalEnrichmentCacheHit {
  result: ChemicalEnrichmentResult
  freshness: 'fresh' | 'stale'
  resultVersion: number
}

export const CHEMICAL_ENRICHMENT_RESULT_VERSION = 3
const PREVIOUS_CHEMICAL_ENRICHMENT_RESULT_VERSION = 2

export function createChemicalCacheAdminClient(env: ChemicalCacheEnv): SupabaseClient | null {
  const url = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim()
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function getChemicalLookupKeys(item: ChemicalEnrichmentRequestItem): string[] {
  const keys: string[] = []
  if (item.casNumber) keys.push(`cas:${item.casNumber}`)
  if (item.standardInchiKey) keys.push(`inchikey:${item.standardInchiKey.toUpperCase()}`)
  if (item.pubchemCid) keys.push(`cid:${item.pubchemCid}`)
  if (item.name) {
    const formula = item.molecularFormula?.normalize('NFKC').replace(/\s+/g, '') || ''
    keys.push(`name:${normalizeName(item.name)}|formula:${formula}`)
  }
  return Array.from(new Set(keys))
}

export function getChemicalResultAliasKeys(result: ChemicalEnrichmentResult): string[] {
  const keys: string[] = []
  if (result.identity.casNumber) keys.push(`cas:${result.identity.casNumber}`)
  if (result.identity.standardInchiKey) keys.push(`inchikey:${result.identity.standardInchiKey.toUpperCase()}`)
  if (result.identity.pubchemCid) keys.push(`cid:${result.identity.pubchemCid}`)
  for (const cid of result.identity.equivalentPubchemCids) keys.push(`cid:${cid}`)
  return Array.from(new Set(keys))
}

export function getChemicalCacheExpiry(result: ChemicalEnrichmentResult): Date | null {
  if (result.overallStatus === 'retryable' || result.hazard.status === 'transient_error') return null
  const ttl = result.overallStatus === 'complete'
    ? 7 * 24 * 60 * 60 * 1000
    : result.identity.status === 'not_found'
      ? 5 * 60 * 1000
      : 60 * 60 * 1000
  return new Date(Date.now() + ttl)
}

export async function readChemicalEnrichmentCache(
  env: ChemicalCacheEnv,
  item: ChemicalEnrichmentRequestItem,
): Promise<ChemicalEnrichmentCacheHit | null> {
  const supabase = createChemicalCacheAdminClient(env)
  const keys = getChemicalLookupKeys(item)
  if (!supabase || keys.length === 0) return null

  try {
    const { data, error } = await supabase
      .from('chemical_enrichment_cache')
      .select('result,expires_at,fetched_at,result_version')
      .in('lookup_key', keys)
      .in('result_version', [
        CHEMICAL_ENRICHMENT_RESULT_VERSION,
        PREVIOUS_CHEMICAL_ENRICHMENT_RESULT_VERSION,
      ])
      .order('result_version', { ascending: false })
      .order('fetched_at', { ascending: false })
      .limit(20)
    if (error) {
      console.warn(JSON.stringify({ message: 'chemical cache read failed', error: error.message }))
      return null
    }
    const rows = Array.isArray(data) ? data as CacheRow[] : []
    const now = Date.now()
    const fresh = rows.find((row) => (
      row.result_version === CHEMICAL_ENRICHMENT_RESULT_VERSION
      && Boolean(row.result)
      && Boolean(row.expires_at)
      && new Date(row.expires_at!).getTime() > now
    ))
    if (fresh?.result) {
      return {
        result: { ...fresh.result, requestId: item.requestId },
        freshness: 'fresh',
        resultVersion: fresh.result_version,
      }
    }

    const stale = rows.find((row) => {
      if (!row.result) return false
      if (row.result_version === CHEMICAL_ENRICHMENT_RESULT_VERSION) return true
      return row.result_version === PREVIOUS_CHEMICAL_ENRICHMENT_RESULT_VERSION
        && row.result.overallStatus === 'complete'
        && (row.result.hazard.status === 'classified' || row.result.hazard.status === 'not_classified')
    })
    return stale?.result ? {
      result: { ...stale.result, requestId: item.requestId },
      freshness: 'stale',
      resultVersion: stale.result_version,
    } : null
  } catch (error) {
    console.warn(JSON.stringify({ message: 'chemical cache read failed', error: error instanceof Error ? error.message : String(error) }))
    return null
  }
}

export async function writeChemicalEnrichmentCache(
  env: ChemicalCacheEnv,
  item: ChemicalEnrichmentRequestItem,
  result: ChemicalEnrichmentResult,
): Promise<void> {
  const supabase = createChemicalCacheAdminClient(env)
  const expiresAt = getChemicalCacheExpiry(result)
  if (!supabase || !expiresAt) return

  const keys = Array.from(new Set([...getChemicalLookupKeys(item), ...getChemicalResultAliasKeys(result)]))
  if (keys.length === 0) return
  const canonicalIdentityKey = result.identity.standardInchiKey
    ? `inchikey:${result.identity.standardInchiKey.toUpperCase()}`
    : result.identity.casNumber ? `cas:${result.identity.casNumber}` : keys[0]
  const cacheStatus = result.identity.status === 'not_found'
    ? 'not_found'
    : result.overallStatus === 'complete' ? 'complete' : result.hazard.status
  const now = new Date().toISOString()
  const cacheResult = { ...result }
  delete cacheResult.delivery

  try {
    const { error } = await supabase.from('chemical_enrichment_cache').upsert(
      keys.map((lookupKey) => ({
        lookup_key: lookupKey,
        result_version: CHEMICAL_ENRICHMENT_RESULT_VERSION,
        canonical_identity_key: canonicalIdentityKey,
        cache_status: cacheStatus,
        result: cacheResult,
        fetched_at: result.hazard.fetchedAt || now,
        expires_at: expiresAt.toISOString(),
        updated_at: now,
      })),
      { onConflict: 'lookup_key,result_version' },
    )
    if (error) console.warn(JSON.stringify({ message: 'chemical cache write failed', error: error.message }))
  } catch (error) {
    console.warn(JSON.stringify({ message: 'chemical cache write failed', error: error instanceof Error ? error.message : String(error) }))
  }
}

export async function verifyLabMembership(
  env: ChemicalCacheEnv,
  userId: string,
  labId: string,
): Promise<boolean> {
  const supabase = createChemicalCacheAdminClient(env)
  if (!supabase) return false
  const { data, error } = await supabase
    .from('lab_members')
    .select('lab_id')
    .eq('lab_id', labId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  return !error && Boolean(data)
}

export async function projectLegacyGhsCache(
  env: ChemicalCacheEnv,
  userId: string,
  labId: string | undefined,
  result: ChemicalEnrichmentResult,
): Promise<void> {
  const supabase = createChemicalCacheAdminClient(env)
  const casNumber = result.identity.casNumber
  if (!supabase || !casNumber || !['classified', 'not_classified'].includes(result.hazard.status)) return

  const scopeType = labId ? 'lab' : 'user'
  const scopeId = labId || userId
  const expiresAt = result.hazard.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const legacyResult = {
    cid: result.identity.pubchemCid || 0,
    name: result.identity.canonicalName || '',
    hCodes: result.hazard.hCodes,
    pictograms: result.hazard.pictograms,
    signalWord: result.hazard.signalWord || null,
    isAcidic: false,
    isBasic: false,
    success: true,
    status: 'success',
  }

  const { error } = await supabase.from('ghs_cas_cache').upsert({
    scope_type: scopeType,
    scope_id: scopeId,
    cas_number: casNumber,
    result: legacyResult,
    result_version: 3,
    cache_status: 'success',
    fetched_at: result.hazard.fetchedAt,
    expires_at: expiresAt,
    created_by: userId,
    updated_by: userId,
  }, { onConflict: 'scope_type,scope_id,cas_number' })
  if (error) console.warn(JSON.stringify({ message: 'legacy GHS projection failed', error: error.message }))
}
