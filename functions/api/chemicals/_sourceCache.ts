import type { ChemicalCacheEnv } from './_cache'
import {
  CHEMICAL_ENRICHMENT_RESULT_VERSION,
  createChemicalCacheAdminClient,
} from './_cache'

export type ChemicalSourceRecordType = 'identity' | 'reference_ph'
export type ChemicalSourceCacheStatus = 'complete' | 'source_absent'

interface ChemicalSourceCacheRow {
  cache_status: ChemicalSourceCacheStatus
  result: Record<string, unknown> | null
  fetched_at: string
  expires_at: string
}
export interface ChemicalSourceCacheValue<T extends Record<string, unknown>> {
  status: ChemicalSourceCacheStatus
  result: T
  fetchedAt: string
  expiresAt: string
}

export async function readChemicalSourceCache<T extends Record<string, unknown>>(
  env: ChemicalCacheEnv,
  recordType: ChemicalSourceRecordType,
  lookupKey: string,
): Promise<ChemicalSourceCacheValue<T> | null> {
  const supabase = createChemicalCacheAdminClient(env)
  if (!supabase) return null

  try {
    const { data, error } = await supabase
      .from('chemical_source_cache')
      .select('cache_status,result,fetched_at,expires_at')
      .eq('source', 'kosha')
      .eq('record_type', recordType)
      .eq('lookup_key', lookupKey)
      .eq('result_version', CHEMICAL_ENRICHMENT_RESULT_VERSION)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (error) {
      console.warn(JSON.stringify({ message: 'chemical source cache read failed', recordType, error: error.message }))
      return null
    }
    const row = data as ChemicalSourceCacheRow | null
    if (!row?.result) return null
    return {
      status: row.cache_status,
      result: row.result as T,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
    }
  } catch (error) {
    console.warn(JSON.stringify({
      message: 'chemical source cache read failed',
      recordType,
      error: error instanceof Error ? error.message : String(error),
    }))
    return null
  }
}

export async function writeChemicalSourceCache(
  env: ChemicalCacheEnv,
  recordType: ChemicalSourceRecordType,
  lookupKeys: readonly string[],
  cacheStatus: ChemicalSourceCacheStatus,
  result: Record<string, unknown>,
  ttlMs: number,
): Promise<void> {
  const supabase = createChemicalCacheAdminClient(env)
  const keys = Array.from(new Set(lookupKeys.filter(Boolean)))
  if (!supabase || keys.length === 0 || ttlMs <= 0) return
  const fetchedAt = new Date()
  const expiresAt = new Date(fetchedAt.getTime() + ttlMs)

  try {
    const { error } = await supabase.from('chemical_source_cache').upsert(
      keys.map((lookupKey) => ({
        source: 'kosha',
        record_type: recordType,
        lookup_key: lookupKey,
        result_version: CHEMICAL_ENRICHMENT_RESULT_VERSION,
        cache_status: cacheStatus,
        result,
        fetched_at: fetchedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        updated_at: fetchedAt.toISOString(),
      })),
      { onConflict: 'source,record_type,lookup_key,result_version' },
    )
    if (error) {
      console.warn(JSON.stringify({ message: 'chemical source cache write failed', recordType, error: error.message }))
    }
  } catch (error) {
    console.warn(JSON.stringify({
      message: 'chemical source cache write failed',
      recordType,
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}

export function createChemicalLeaseOwnerToken(): string {
  return crypto.randomUUID()
}

export async function tryAcquireChemicalLease(
  env: ChemicalCacheEnv,
  leaseKey: string,
  ownerToken: string,
  leaseSeconds = 30,
): Promise<boolean> {
  const supabase = createChemicalCacheAdminClient(env)
  if (!supabase) return true
  const { data, error } = await supabase.rpc('try_acquire_chemical_enrichment_lease', {
    p_lease_key: leaseKey,
    p_result_version: CHEMICAL_ENRICHMENT_RESULT_VERSION,
    p_owner_token: ownerToken,
    p_lease_seconds: leaseSeconds,
  })
  if (error) {
    console.warn(JSON.stringify({ message: 'chemical enrichment lease acquisition failed', error: error.message }))
    return true
  }
  return data === true
}

export async function releaseChemicalLease(
  env: ChemicalCacheEnv,
  leaseKey: string,
  ownerToken: string,
): Promise<void> {
  const supabase = createChemicalCacheAdminClient(env)
  if (!supabase) return
  const { error } = await supabase.rpc('release_chemical_enrichment_lease', {
    p_lease_key: leaseKey,
    p_result_version: CHEMICAL_ENRICHMENT_RESULT_VERSION,
    p_owner_token: ownerToken,
  })
  if (error) {
    console.warn(JSON.stringify({ message: 'chemical enrichment lease release failed', error: error.message }))
  }
}
