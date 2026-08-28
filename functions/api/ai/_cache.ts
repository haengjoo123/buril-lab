import { createClient } from '@supabase/supabase-js'

export interface AICacheEnv {
  SUPABASE_URL?: string
  VITE_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

interface AICacheRow<T> {
  response_data: T | null
}

function resolveSupabaseUrl(env: AICacheEnv): string | null {
  return env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim() || null
}

function createSupabaseAdminClient(env: AICacheEnv) {
  const url = resolveSupabaseUrl(env)
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !serviceRoleKey) {
    return null
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify)
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortForStableStringify((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }

  return value
}

export function stableCacheKey(version: string, payload: unknown): string {
  return `${version}:${JSON.stringify(sortForStableStringify(payload))}`
}

export async function readAICache<T>(
  env: AICacheEnv,
  apiType: string,
  cacheKey: string,
): Promise<T | null> {
  const supabase = createSupabaseAdminClient(env)
  if (!supabase) return null

  try {
    const { data, error } = await supabase
      .from('ai_api_cache')
      .select('response_data')
      .eq('api_type', apiType)
      .eq('cache_key', cacheKey)
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn(`[AI Cache] Failed to read ${apiType}:`, error.message)
      return null
    }

    return ((data as AICacheRow<T> | null)?.response_data ?? null) as T | null
  } catch (error) {
    console.warn(`[AI Cache] Failed to read ${apiType}:`, error)
    return null
  }
}

export async function writeAICache<T>(
  env: AICacheEnv,
  apiType: string,
  cacheKey: string,
  responseData: T,
): Promise<void> {
  const supabase = createSupabaseAdminClient(env)
  if (!supabase) return

  try {
    const { error } = await supabase.from('ai_api_cache').insert({
      api_type: apiType,
      cache_key: cacheKey,
      response_data: responseData,
    })

    if (error) {
      console.warn(`[AI Cache] Failed to write ${apiType}:`, error.message)
    }
  } catch (error) {
    console.warn(`[AI Cache] Failed to write ${apiType}:`, error)
  }
}
