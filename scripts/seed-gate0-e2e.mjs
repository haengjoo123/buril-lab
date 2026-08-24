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
    ['otherInventoryInsideReservedLab', 'Checking other inventory inside the reserved lab',
      supabase.from('inventory').select('id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID).or(ownerOutsideFixture('user_id'))],
    ['fixtureStorageLocationsOutsideReservedLab', 'Checking fixture storage outside the reserved lab',
      supabase.from('storage_locations').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).or(outsideReservedLab)],
    ['otherStorageLocationsInsideReservedLab', 'Checking other storage inside the reserved lab',
      supabase.from('storage_locations').select('id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID).or(ownerOutsideFixture('user_id'))],
    ['fixtureCabinetsOutsideReservedLab', 'Checking fixture cabinets outside the reserved lab',
      supabase.from('cabinets').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).or(outsideReservedLab)],
    ['otherCabinetsInsideReservedLab', 'Checking other cabinets inside the reserved lab',
      supabase.from('cabinets').select('id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID).or(ownerOutsideFixture('user_id'))],
    ['fixtureWasteLogsOutsideReservedLab', 'Checking fixture waste logs outside the reserved lab',
      supabase.from('waste_logs').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).or(outsideReservedLab)],
    ['otherWasteLogsInsideReservedLab', 'Checking other waste logs inside the reserved lab',
      supabase.from('waste_logs').select('id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID).or(ownerOutsideFixture('user_id'))],
    ['fixtureOverridesOutsideReservedLab', 'Checking fixture policy overrides outside the reserved lab',
      supabase.from('waste_policy_lab_overrides').select('lab_id', { count: 'exact', head: true })
        .or(`created_by.eq.${userId},updated_by.eq.${userId}`).neq('lab_id', LAB_ID)],
    ['otherOverridesInsideReservedLab', 'Checking other policy overrides inside the reserved lab',
      supabase.from('waste_policy_lab_overrides').select('lab_id', { count: 'exact', head: true })
        .eq('lab_id', LAB_ID)
        .or(`${ownerOutsideFixture('created_by')},${ownerOutsideFixture('updated_by')}`)],
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
if (fixtureUser && target.target === 'staging-exact') {
  await verifyRemoteFixtureIsolation(fixtureUser.id)
}

// Removing the reserved lab cascades prior synthetic inventory and any waste
// records created by an earlier run. Delete it before the policy because waste
// records retain an ON DELETE RESTRICT reference to their policy version.
await requireNoError(
  await supabase.from('labs').delete().eq('id', LAB_ID),
  'Cleaning the prior synthetic lab',
)

await requireNoError(
  await supabase.from('waste_policy_versions').delete().eq('id', POLICY_ID),
  'Cleaning the prior synthetic system policy',
)

if (fixtureUser) {
  const removed = await supabase.auth.admin.deleteUser(fixtureUser.id)
  if (removed.error) throw new Error(`Removing the prior synthetic user failed: ${removed.error.message}`)
}

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
const userId = created.data.user.id

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

await requireNoError(await supabase.from('labs').insert({
  id: LAB_ID,
  name: LAB_NAME,
  created_by: userId,
  institution_name: 'BurilLab 합성 품질검사 기관',
  institution_type: 'university',
  research_field: 'synthetic chemistry',
}), 'Creating the synthetic lab')

await requireNoError(await supabase.from('lab_members').insert({
  lab_id: LAB_ID,
  user_id: userId,
  role: 'admin',
  nickname: 'Gate0 관리자',
}), 'Creating the synthetic membership')

await requireNoError(await supabase.from('storage_locations').insert({
  id: STORAGE_LOCATION_ID,
  lab_id: LAB_ID,
  user_id: userId,
  name: 'Gate0 합성 선반',
  icon: '📦',
}), 'Creating the synthetic storage location')

await requireNoError(await supabase.from('inventory').insert({
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
  storage_location_id: STORAGE_LOCATION_ID,
  manufacturer_date_type: 'unlabeled',
}), 'Creating the synthetic inventory')

await requireNoError(await supabase.from('waste_policy_versions').insert({
  id: POLICY_ID,
  policy_key: 'gate0-synthetic-system-policy',
  scope_type: 'system',
  version_label: 'gate0-v1',
  name: POLICY_NAME,
  jurisdiction: 'KR',
  status: 'active',
  source_refs: [{ title: 'Gate0 synthetic browser fixture' }],
  created_by: userId,
  activated_by: userId,
  activated_at: '2026-08-24T00:00:00.000Z',
}), 'Creating the synthetic active system policy')

await requireNoError(await supabase.from('waste_policy_streams').insert({
  policy_version_id: POLICY_ID,
  stream_code: 'SOLID_CONTAMINATED',
  display_name_ko: '합성 오염 고체 폐기물',
  display_name_en: 'Synthetic contaminated solid waste',
  description_ko: 'Gate0 브라우저 시험용 합성 고체 폐기물 분류',
  container_label: 'Gate0 합성 고체 폐기물통',
  location: 'Gate0 합성 보관 위치',
  handler_contact: 'Gate0 안전 담당자',
  allowed_hazard_flags: [],
  blocked_hazard_flags: [],
  prohibitions: [],
  label_requirements: ['성분명', '양'],
  is_enabled: true,
  sort_order: 80,
}), 'Creating the synthetic active policy stream')

await requireNoError(await supabase.from('waste_policy_lab_overrides').insert({
  lab_id: LAB_ID,
  stream_code: 'SOLID_CONTAMINATED',
  display_name_ko: '합성 오염 고체 폐기물',
  display_name_en: 'Synthetic contaminated solid waste',
  container_label: 'Gate0 합성 고체 폐기물통',
  location: 'Gate0 합성 보관 위치',
  handler_contact: 'Gate0 안전 담당자',
  created_by: userId,
  updated_by: userId,
}), 'Creating the synthetic lab policy override')

console.log(JSON.stringify({
  seeded: true,
  target: target.target,
  labId: LAB_ID,
  inventoryId: INVENTORY_ID,
  storageLocationId: STORAGE_LOCATION_ID,
  policyId: POLICY_ID,
}))
