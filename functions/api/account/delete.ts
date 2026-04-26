import { createClient } from '@supabase/supabase-js'

interface AccountDeleteEnv {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

interface QueryError {
  code?: string
  message?: string
  details?: string
  hint?: string
}

interface QueryResult {
  error: QueryError | null
}

interface CleanupWarning {
  step: string
  error: string
}

interface CabinetImageRow {
  image_url: string | null
}

type SupabaseClient = ReturnType<typeof createClient>
type CleanupOperation = () => PromiseLike<QueryResult>

interface CleanupStepOptions {
  tolerateConstraintErrors?: boolean
}

const OPTIONAL_SCHEMA_ERROR_CODES = new Set([
  '42P01',
  '42703',
  'PGRST116',
  'PGRST200',
  'PGRST204',
  'PGRST205',
])

const TOLERATED_CONSTRAINT_ERROR_CODES = new Set([
  '23502',
  '23503',
])

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init?.headers || {}),
    },
  })
}

function resolveSupabaseUrl(env: AccountDeleteEnv): string | null {
  return env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim() || null
}

function resolveSupabaseAnonKey(env: AccountDeleteEnv): string | null {
  return env.SUPABASE_ANON_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim() || null
}

function createSupabaseUserClient(env: AccountDeleteEnv, authHeader: string): SupabaseClient {
  const url = resolveSupabaseUrl(env)
  const anonKey = resolveSupabaseAnonKey(env)

  if (!url || !anonKey) {
    throw new Error('Supabase URL or anon key is not configured.')
  }

  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function createSupabaseAdminClient(env: AccountDeleteEnv): SupabaseClient {
  const url = resolveSupabaseUrl(env)
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase URL or service role key is not configured.')
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function formatQueryError(error: QueryError): string {
  return [error.message, error.details, error.hint].filter(Boolean).join(' ') || 'Unknown database error.'
}

function isOptionalSchemaError(error: QueryError): boolean {
  if (error.code && OPTIONAL_SCHEMA_ERROR_CODES.has(error.code)) {
    return true
  }

  const normalized = formatQueryError(error).toLowerCase()
  return normalized.includes('does not exist')
    || normalized.includes('could not find')
    || normalized.includes('schema cache')
}

async function runCleanupStep(
  warnings: CleanupWarning[],
  step: string,
  operation: CleanupOperation,
  options: CleanupStepOptions = {},
): Promise<void> {
  const { error } = await operation()
  if (!error) return

  if (
    isOptionalSchemaError(error)
    || (options.tolerateConstraintErrors && error.code && TOLERATED_CONSTRAINT_ERROR_CODES.has(error.code))
  ) {
    warnings.push({ step, error: formatQueryError(error) })
    return
  }

  throw new Error(`${step}: ${formatQueryError(error)}`)
}

function parseCabinetStoragePath(imageUrl: string | null): string | null {
  if (!imageUrl) return null

  const marker = '/storage/v1/object/public/cabinets/'
  const markerIndex = imageUrl.indexOf(marker)
  if (markerIndex >= 0) {
    const pathWithQuery = imageUrl.slice(markerIndex + marker.length)
    return decodeURIComponent(pathWithQuery.split('?')[0]).replace(/^\/+/, '') || null
  }

  if (!imageUrl.includes('://') && !imageUrl.startsWith('/')) {
    return imageUrl
  }

  return null
}

async function removePrivateCabinetImages(
  adminClient: SupabaseClient,
  userId: string,
  warnings: CleanupWarning[],
): Promise<void> {
  const { data, error } = await adminClient
    .from('cabinets')
    .select('image_url')
    .eq('user_id', userId)
    .is('lab_id', null)

  if (error) {
    if (isOptionalSchemaError(error)) {
      warnings.push({ step: 'List private cabinet images', error: formatQueryError(error) })
      return
    }

    throw new Error(`List private cabinet images: ${formatQueryError(error)}`)
  }

  const paths = ((data || []) as CabinetImageRow[])
    .map((row) => parseCabinetStoragePath(row.image_url))
    .filter((path): path is string => Boolean(path))

  if (paths.length === 0) return

  const { error: storageError } = await adminClient.storage.from('cabinets').remove(paths)
  if (storageError) {
    warnings.push({ step: 'Delete private cabinet images', error: storageError.message })
  }
}

async function removePersonalRows(
  adminClient: SupabaseClient,
  userId: string,
  warnings: CleanupWarning[],
): Promise<void> {
  const deleteByUserId = (table: string, column = 'user_id') =>
    runCleanupStep(warnings, `Delete ${table}`, () =>
      adminClient.from(table).delete().eq(column, userId))

  const updateByUserId = (table: string, values: Record<string, unknown>, column = 'user_id') =>
    runCleanupStep(warnings, `Anonymize ${table}`, () =>
      adminClient.from(table).update(values).eq(column, userId), {
        tolerateConstraintErrors: true,
      })

  await deleteByUserId('user_search_history')
  await deleteByUserId('voice_query_feedback')
  await deleteByUserId('reagent_aliases')
  await deleteByUserId('commerce_intent_events')
  await deleteByUserId('safety_compliance_events')

  await removePrivateCabinetImages(adminClient, userId, warnings)

  await runCleanupStep(warnings, 'Delete private inventory rows', () =>
    adminClient.from('inventory').delete().eq('user_id', userId).is('lab_id', null))
  await runCleanupStep(warnings, 'Delete private storage locations', () =>
    adminClient.from('storage_locations').delete().eq('user_id', userId).is('lab_id', null))
  await runCleanupStep(warnings, 'Delete private cabinets', () =>
    adminClient.from('cabinets').delete().eq('user_id', userId).is('lab_id', null))

  await updateByUserId('feedback', {
    user_id: null,
    user_email: null,
    contact: null,
    user_agent: null,
  })
  await updateByUserId('waste_logs', {
    user_id: null,
    handler_name: null,
  })
  await updateByUserId('inventory', { user_id: null })
  await updateByUserId('storage_locations', { user_id: null })
  await updateByUserId('cabinets', { user_id: null })
  await updateByUserId('labs', { created_by: null }, 'created_by')
  await updateByUserId('cabinet_disposal_logs', { disposed_by: null }, 'disposed_by')
  await updateByUserId('cabinet_activity_logs', { performed_by: null }, 'performed_by')
  await updateByUserId('audit_logs', {
    actor_user_id: null,
    actor_name: 'Deleted user',
  }, 'actor_user_id')

  await deleteByUserId('lab_members')
}

export const onRequestPost = async (context: {
  request: Request
  env: AccountDeleteEnv
}) => {
  const authHeader = context.request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Authentication is required.' }, { status: 401 })
  }

  let userClient: SupabaseClient
  let adminClient: SupabaseClient
  try {
    userClient = createSupabaseUserClient(context.env, authHeader)
    adminClient = createSupabaseAdminClient(context.env)
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Failed to initialize account deletion.' },
      { status: 500 },
    )
  }

  const { data, error: userError } = await userClient.auth.getUser()
  if (userError || !data.user) {
    return json({ error: 'Authentication is required.' }, { status: 401 })
  }

  const warnings: CleanupWarning[] = []
  try {
    await removePersonalRows(adminClient, data.user.id, warnings)
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Failed to remove account data.' },
      { status: 500 },
    )
  }

  const { error: hardDeleteError } = await adminClient.auth.admin.deleteUser(data.user.id)
  if (!hardDeleteError) {
    return json({ success: true, warnings })
  }

  const { error: softDeleteError } = await adminClient.auth.admin.deleteUser(data.user.id, true)
  if (softDeleteError) {
    return json(
      { error: `Failed to delete auth account: ${softDeleteError.message}` },
      { status: 500 },
    )
  }

  warnings.push({
    step: 'Hard delete auth account',
    error: hardDeleteError.message,
  })
  return json({ success: true, softDeleted: true, warnings })
}
