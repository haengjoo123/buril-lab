import { createClient } from '@supabase/supabase-js'
import {
  GATE0_INVENTORY_NAME,
  GATE0_LAB_NAME,
  GATE0_OWNER_MARKER,
  GATE0_POLICY_NAME,
  GATE0_RESERVED_INVENTORY_ID,
  GATE0_RESERVED_LAB_ID,
  GATE0_RESERVED_POLICY_ID,
  GATE0_STAGING_CONFIRMATION,
  GATE0_STAGING_ORIGIN,
  selectExistingFixtureUser,
  verifyExistingFixtureOwnership,
  verifyFixtureIsolationEvidence,
} from './gate0-seed-safety.mjs'

const apiUrlValue = process.env.SUPABASE_URL || process.env.API_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY

if (!apiUrlValue || !serviceRoleKey) {
  throw new Error('Local SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the Gate0 seed.')
}

function requireSupabaseTarget(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Gate0 seed received an invalid Supabase URL.')
  }
  const isLoopback = ['127.0.0.1', 'localhost'].includes(parsed.hostname)
  const isExactStaging = parsed.origin === GATE0_STAGING_ORIGIN
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || (!isLoopback && !isExactStaging)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`Gate0 seed refuses an unapproved Supabase URL: ${parsed.origin}`)
  }
  if (isExactStaging) {
    if (process.env.GATE0_STAGING_SEED_CONFIRMATION !== GATE0_STAGING_CONFIRMATION) {
      throw new Error('Gate0 seed refuses remote Staging without the exact confirmation.')
    }
    if (!process.env.GATE0_E2E_EMAIL || !process.env.GATE0_E2E_PASSWORD) {
      throw new Error('Remote Staging seed requires explicit synthetic credentials.')
    }
    if (process.env.GATE0_E2E_PASSWORD.length < 20) {
      throw new Error('Remote Staging seed requires a password of at least 20 characters.')
    }
    return { origin: parsed.origin, target: 'staging-exact' }
  }
  return { origin: parsed.origin, target: 'loopback-only' }
}

const target = requireSupabaseTarget(apiUrlValue)
const supabase = createClient(target.origin, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const E2E_EMAIL = process.env.GATE0_E2E_EMAIL || 'gate0-browser@burillab.test'
const E2E_PASSWORD = process.env.GATE0_E2E_PASSWORD || 'Local-Gate0-Only!2026'
const LAB_ID = GATE0_RESERVED_LAB_ID
const INVENTORY_ID = GATE0_RESERVED_INVENTORY_ID
const STORAGE_LOCATION_ID = '40000000-0000-4000-8000-000000000010'
const POLICY_ID = GATE0_RESERVED_POLICY_ID
const LAB_NAME = GATE0_LAB_NAME
const INVENTORY_NAME = GATE0_INVENTORY_NAME
const POLICY_NAME = GATE0_POLICY_NAME

async function requireNoError(result, operation) {
  if (result.error) throw new Error(`${operation} failed: ${result.error.message}`)
  return result.data
}

async function requireExactCount(result, operation) {
  if (result.error) throw new Error(`${operation} failed: ${result.error.message}`)
  if (!Number.isSafeInteger(result.count) || result.count < 0) {
    throw new Error(`${operation} returned an ambiguous row count.`)
  }
  return result.count
}

async function verifyRemoteFixtureIsolation(userId) {
  const outsideReservedLab = `lab_id.is.null,lab_id.neq.${LAB_ID}`
  const ownerOutsideFixture = (column) => `${column}.is.null,${column}.neq.${userId}`
  const checks = [
    ['fixtureMembershipsOutsideReservedLab', 'Checking fixture memberships outside the reserved lab',
      supabase.from('lab_members').select('lab_id', { count: 'exact', head: true })
        .eq('user_id', userId).neq('lab_id', LAB_ID)],
    ['otherMembershipsInsideReservedLab', 'Checking other memberships inside the reserved lab',
      supabase.from('lab_members').select('user_id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID).or(ownerOutsideFixture('user_id'))],
    ['fixtureLabsOutsideReservedLab', 'Checking other labs owned by the fixture user',
      supabase.from('labs').select('id', { count: 'exact', head: true })
        .eq('created_by', userId).neq('id', LAB_ID)],
    ['fixturePoliciesOutsideReservedPolicy', 'Checking other policies owned by the fixture user',
      supabase.from('waste_policy_versions').select('id', { count: 'exact', head: true })
        .or(`created_by.eq.${userId},activated_by.eq.${userId}`).neq('id', POLICY_ID)],
    ['otherPoliciesInsideReservedLab', 'Checking unexpected policies inside the reserved lab',
      supabase.from('waste_policy_versions').select('id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID)],
    ['fixtureInventoryOutsideReservedLab', 'Checking fixture inventory outside the reserved lab',
      supabase.from('inventory').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).or(outsideReservedLab)],
    ['unexpectedInventoryInsideReservedLab', 'Checking unexpected inventory inside the reserved lab',
      supabase.from('inventory').select('id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID).neq('id', INVENTORY_ID)],
    ['fixtureStorageLocationsInOtherLabs', 'Checking fixture storage in other labs',
      supabase.from('storage_locations').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).not('lab_id', 'is', null).neq('lab_id', LAB_ID)],
    ['unexpectedStorageLocationsInsideReservedLab', 'Checking unexpected storage inside the reserved lab',
      supabase.from('storage_locations').select('id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID).neq('id', STORAGE_LOCATION_ID)],
    ['fixtureCabinetsOutsideReservedLab', 'Checking fixture cabinets outside the reserved lab',
      supabase.from('cabinets').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).or(outsideReservedLab)],
    ['unexpectedCabinetsInsideReservedLab', 'Checking cabinets inside the reserved lab',
      supabase.from('cabinets').select('id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID)],
    ['fixtureWasteLogsOutsideReservedLab', 'Checking fixture waste logs outside the reserved lab',
      supabase.from('waste_logs').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).or(outsideReservedLab)],
    ['otherWasteLogsInsideReservedLab', 'Checking other waste logs inside the reserved lab',
      supabase.from('waste_logs').select('id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID).or(ownerOutsideFixture('user_id'))],
    ['fixtureOverridesOutsideReservedLab', 'Checking fixture policy overrides outside the reserved lab',
      supabase.from('waste_policy_lab_overrides').select('lab_id', { count: 'exact', head: true })
        .or(`created_by.eq.${userId},updated_by.eq.${userId}`).neq('lab_id', LAB_ID)],
    ['unexpectedOverridesInsideReservedLab', 'Checking unexpected policy overrides inside the reserved lab',
      supabase.from('waste_policy_lab_overrides').select('lab_id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID).neq('stream_code', 'SOLID_CONTAMINATED')],
    ['unexpectedPolicyStreamsInsideReservedPolicy', 'Checking unexpected reserved policy streams',
      supabase.from('waste_policy_streams').select('id', { count: 'exact', head: true })
        .eq('policy_version_id', POLICY_ID).neq('stream_code', 'SOLID_CONTAMINATED')],
    ['safetyCenterLabLinksInsideReservedLab', 'Checking safety center links inside the reserved lab',
      supabase.from('safety_center_lab_links').select('id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID)],
    ['safetyCenterRequestsInsideReservedLab', 'Checking safety center requests inside the reserved lab',
      supabase.from('safety_center_requests').select('id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID)],
  ]

  const evidence = Object.fromEntries(await Promise.all(checks.map(async ([key, operation, query]) => [
    key,
    await requireExactCount(await query, operation),
  ])))
  verifyFixtureIsolationEvidence(evidence)
}

const existingLab = await requireNoError(
  await supabase.from('labs').select('id,name,created_by').eq('id', LAB_ID).maybeSingle(),
  'Reading the prior synthetic lab',
)
if (existingLab && existingLab.name !== LAB_NAME) {
  throw new Error('Gate0 seed refuses to replace a non-synthetic lab at its reserved UUID.')
}

const existingInventory = await requireNoError(
  await supabase.from('inventory').select('id,lab_id,user_id,name').eq('id', INVENTORY_ID).maybeSingle(),
  'Reading the prior synthetic inventory',
)
if (existingInventory && (existingInventory.lab_id !== LAB_ID || existingInventory.name !== INVENTORY_NAME)) {
  throw new Error('Gate0 seed refuses to replace non-synthetic inventory at its reserved UUID.')
}

const existingStorageLocation = await requireNoError(
  await supabase
    .from('storage_locations')
    .select('id,lab_id,user_id,name')
    .eq('id', STORAGE_LOCATION_ID)
    .maybeSingle(),
  'Reading the prior synthetic storage location',
)
if (existingStorageLocation && (
  existingStorageLocation.lab_id !== LAB_ID
  || existingStorageLocation.name !== 'Gate0 합성 선반'
)) {
  throw new Error('Gate0 seed refuses to replace non-synthetic storage at its reserved UUID.')
}

const existingActiveSystemPolicy = await requireNoError(
  await supabase
    .from('waste_policy_versions')
    .select('id,name,created_by,activated_by')
    .eq('scope_type', 'system')
    .eq('status', 'active')
    .maybeSingle(),
  'Reading the prior active system policy',
)
if (
  existingActiveSystemPolicy
  && (existingActiveSystemPolicy.id !== POLICY_ID || existingActiveSystemPolicy.name !== POLICY_NAME)
) {
  throw new Error('Gate0 seed refuses to replace a non-synthetic active system waste policy.')
}

const existingReservedPolicy = await requireNoError(
  await supabase
    .from('waste_policy_versions')
    .select('id,name,scope_type,created_by,activated_by')
    .eq('id', POLICY_ID)
    .maybeSingle(),
  'Reading the prior reserved system policy',
)
if (
  existingReservedPolicy
  && (existingReservedPolicy.name !== POLICY_NAME || existingReservedPolicy.scope_type !== 'system')
) {
  throw new Error('Gate0 seed refuses to replace a non-synthetic policy at its reserved UUID.')
}

const existingReservedPolicyKey = await requireNoError(
  await supabase
    .from('waste_policy_versions')
    .select('id,created_by,activated_by')
    .eq('policy_key', 'gate0-synthetic-system-policy')
    .maybeSingle(),
  'Reading the prior synthetic policy key',
)
if (existingReservedPolicyKey && existingReservedPolicyKey.id !== POLICY_ID) {
  throw new Error('Gate0 seed refuses a conflicting synthetic policy key.')
}

const existingReservedOverride = await requireNoError(
  await supabase
    .from('waste_policy_lab_overrides')
    .select('lab_id,stream_code,created_by,updated_by')
    .eq('lab_id', LAB_ID)
    .eq('stream_code', 'SOLID_CONTAMINATED')
    .maybeSingle(),
  'Reading the prior synthetic policy override',
)

const existingUsers = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (existingUsers.error) throw new Error(`Listing synthetic users failed: ${existingUsers.error.message}`)
const fixtureUser = selectExistingFixtureUser(existingUsers.data.users, E2E_EMAIL)
const existingMembership = fixtureUser && existingLab
  ? await requireNoError(
      await supabase
        .from('lab_members')
        .select('lab_id,user_id,role')
        .eq('lab_id', LAB_ID)
        .eq('user_id', fixtureUser.id)
        .maybeSingle(),
      'Reading the prior synthetic membership',
    )
  : null
verifyExistingFixtureOwnership({
  user: fixtureUser,
  lab: existingLab,
  inventory: existingInventory,
  policy: existingReservedPolicy,
  membership: existingMembership,
})
if (!fixtureUser && (existingStorageLocation || existingReservedOverride || existingReservedPolicyKey)) {
  throw new Error('Gate0 seed found reserved dependent data without its synthetic owner.')
}
if (fixtureUser && existingStorageLocation && existingStorageLocation.user_id !== fixtureUser.id) {
  throw new Error('Gate0 seed refuses reserved storage owned outside the synthetic fixture.')
}
if (fixtureUser && existingReservedPolicyKey && (
  existingReservedPolicyKey.created_by !== fixtureUser.id
  || existingReservedPolicyKey.activated_by !== fixtureUser.id
)) {
  throw new Error('Gate0 seed refuses a reserved policy key owned outside the synthetic fixture.')
}
if (fixtureUser && existingReservedOverride && (
  existingReservedOverride.created_by !== fixtureUser.id
  || existingReservedOverride.updated_by !== fixtureUser.id
)) {
  throw new Error('Gate0 seed refuses a reserved override owned outside the synthetic fixture.')
}
if (fixtureUser && target.target === 'staging-exact') {
  await verifyRemoteFixtureIsolation(fixtureUser.id)
}

let userId
if (fixtureUser) {
  const refreshed = await supabase.auth.admin.updateUserById(fixtureUser.id, {
    password: E2E_PASSWORD,
    email_confirm: true,
    user_metadata: {
      ...fixtureUser.user_metadata,
      full_name: 'Gate0 관리자',
      synthetic: true,
    },
    app_metadata: {
      ...fixtureUser.app_metadata,
      synthetic: true,
      gate0_owner_marker: GATE0_OWNER_MARKER,
      gate0_lab_id: GATE0_RESERVED_LAB_ID,
    },
  })
  if (refreshed.error || !refreshed.data.user || refreshed.data.user.id !== fixtureUser.id) {
    throw new Error(`Refreshing the synthetic user failed: ${refreshed.error?.message || 'missing user'}`)
  }
  userId = refreshed.data.user.id
} else {
  const created = await supabase.auth.admin.createUser({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: 'Gate0 관리자',
      synthetic: true,
    },
    app_metadata: {
      synthetic: true,
      gate0_owner_marker: GATE0_OWNER_MARKER,
      gate0_lab_id: GATE0_RESERVED_LAB_ID,
    },
  })
  if (created.error || !created.data.user) {
    throw new Error(`Creating the synthetic user failed: ${created.error?.message || 'missing user'}`)
  }
  userId = created.data.user.id
}

const solidStreamCatalog = await requireNoError(
  await supabase
    .from('waste_stream_catalog')
    .select('code')
    .eq('code', 'SOLID_CONTAMINATED')
    .maybeSingle(),
  'Checking the synthetic waste stream catalog',
)
if (!solidStreamCatalog) {
  await requireNoError(await supabase.from('waste_stream_catalog').insert({
    code: 'SOLID_CONTAMINATED',
    display_name_ko: '오염 고체 폐기물',
    display_name_en: 'Contaminated solid waste',
    sort_order: 80,
  }), 'Creating the synthetic waste stream catalog entry')
}

await requireNoError(await supabase.from('labs').upsert({
  id: LAB_ID,
  name: LAB_NAME,
  created_by: userId,
  join_password: '',
  institution_name: 'BurilLab 합성 품질검사 기관',
  institution_type: 'university',
  research_field: 'synthetic chemistry',
}, { onConflict: 'id' }), 'Restoring the synthetic lab')

await requireNoError(await supabase.from('lab_members').upsert({
  lab_id: LAB_ID,
  user_id: userId,
  role: 'admin',
  nickname: 'Gate0 관리자',
}, { onConflict: 'lab_id,user_id' }), 'Restoring the synthetic membership')

await requireNoError(await supabase.from('storage_locations').upsert({
  id: STORAGE_LOCATION_ID,
  lab_id: LAB_ID,
  user_id: userId,
  name: 'Gate0 합성 선반',
  icon: '📦',
}, { onConflict: 'id' }), 'Restoring the synthetic storage location')

await requireNoError(await supabase.from('inventory').upsert({
  id: INVENTORY_ID,
  lab_id: LAB_ID,
  user_id: userId,
  name: INVENTORY_NAME,
  brand: 'BurilLab Synthetic',
  product_number: 'BL-GATE0-001',
  cas_number: null,
  quantity: 1,
  capacity: '100 g',
  remaining_percent: 100,
  storage_type: 'other',
  cabinet_id: null,
  storage_location_id: STORAGE_LOCATION_ID,
  product_id: null,
  expiry_date: null,
  memo: null,
  manufacturer_date_type: 'unlabeled',
  received_date: null,
  opened_date: null,
}, { onConflict: 'id' }), 'Restoring the synthetic inventory')

await requireNoError(await supabase.from('waste_policy_versions').upsert({
  id: POLICY_ID,
  policy_key: 'gate0-synthetic-system-policy',
  scope_type: 'system',
  safety_center_id: null,
  lab_id: null,
  parent_policy_version_id: null,
  version_label: 'gate0-v1',
  name: POLICY_NAME,
  jurisdiction: 'KR',
  status: 'active',
  source_refs: [{ title: 'Gate0 synthetic browser fixture' }],
  created_by: userId,
  activated_by: userId,
  activated_at: '2026-08-24T00:00:00.000Z',
}, { onConflict: 'id' }), 'Restoring the synthetic active system policy')

await requireNoError(await supabase.from('waste_policy_streams').upsert({
  policy_version_id: POLICY_ID,
  stream_code: 'SOLID_CONTAMINATED',
  display_name_ko: '합성 오염 고체 폐기물',
  display_name_en: 'Synthetic contaminated solid waste',
  description_ko: 'Gate0 브라우저 시험용 합성 고체 폐기물 분류',
  container_label: 'Gate0 합성 고체 폐기물통',
  container_color: null,
  location: 'Gate0 합성 보관 위치',
  handler_contact: 'Gate0 안전 담당자',
  sop_url: null,
  allowed_hazard_flags: [],
  blocked_hazard_flags: [],
  prohibitions: [],
  label_requirements: ['성분명', '양'],
  is_enabled: true,
  sort_order: 80,
}, { onConflict: 'policy_version_id,stream_code' }), 'Restoring the synthetic active policy stream')

await requireNoError(await supabase.from('waste_policy_lab_overrides').upsert({
  lab_id: LAB_ID,
  stream_code: 'SOLID_CONTAMINATED',
  display_name_ko: '합성 오염 고체 폐기물',
  display_name_en: 'Synthetic contaminated solid waste',
  container_label: 'Gate0 합성 고체 폐기물통',
  container_color: null,
  location: 'Gate0 합성 보관 위치',
  handler_contact: 'Gate0 안전 담당자',
  replacement_location: null,
  is_disabled: false,
  created_by: userId,
  updated_by: userId,
}, { onConflict: 'lab_id,stream_code' }), 'Restoring the synthetic lab policy override')

// An UPSERT passes through the INSERT half of the lab password trigger before
// conflict resolution, so it cannot reliably clear a pre-existing hash. Use
// the authenticated admin RPC after the canonical membership is restored.
const fixtureSessionClient = createClient(target.origin, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const fixtureSignIn = await fixtureSessionClient.auth.signInWithPassword({
  email: E2E_EMAIL,
  password: E2E_PASSWORD,
})
if (fixtureSignIn.error || !fixtureSignIn.data.session) {
  throw new Error(`Signing in the synthetic fixture failed: ${fixtureSignIn.error?.message || 'missing session'}`)
}
await requireNoError(
  await fixtureSessionClient.rpc('set_lab_join_password', {
    target_lab_id: LAB_ID,
    p_password: null,
  }),
  'Clearing the synthetic lab join password',
)
const fixtureSignOut = await fixtureSessionClient.auth.signOut({ scope: 'global' })
if (fixtureSignOut.error) {
  throw new Error(`Revoking synthetic fixture sessions failed: ${fixtureSignOut.error.message}`)
}

console.log(JSON.stringify({
  seeded: true,
  target: target.target,
  labId: LAB_ID,
  inventoryId: INVENTORY_ID,
  storageLocationId: STORAGE_LOCATION_ID,
  policyId: POLICY_ID,
}))
