import { createClient } from '@supabase/supabase-js'

const apiUrlValue = process.env.SUPABASE_URL || process.env.API_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY

if (!apiUrlValue || !serviceRoleKey) {
  throw new Error('Local SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the Gate0 seed.')
}

function requireLoopbackSupabaseUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Gate0 seed received an invalid Supabase URL.')
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`Gate0 seed refuses a non-local Supabase URL: ${parsed.origin}`)
  }
  return parsed.origin
}

const localApiUrl = requireLoopbackSupabaseUrl(apiUrlValue)
const supabase = createClient(localApiUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const E2E_EMAIL = process.env.GATE0_E2E_EMAIL || 'gate0-browser@burillab.test'
const E2E_PASSWORD = process.env.GATE0_E2E_PASSWORD || 'Local-Gate0-Only!2026'
const LAB_ID = '10000000-0000-4000-8000-000000000010'
const INVENTORY_ID = '20000000-0000-4000-8000-000000000010'
const STORAGE_LOCATION_ID = '40000000-0000-4000-8000-000000000010'
const POLICY_ID = '50000000-0000-4000-8000-000000000010'
const LAB_NAME = 'Gate0 합성 연구실'
const INVENTORY_NAME = 'Gate0 Synthetic Powder'
const POLICY_NAME = 'Gate0 합성 시스템 폐기 정책'

async function requireNoError(result, operation) {
  if (result.error) throw new Error(`${operation} failed: ${result.error.message}`)
  return result.data
}

const existingLab = await requireNoError(
  await supabase.from('labs').select('id,name').eq('id', LAB_ID).maybeSingle(),
  'Reading the prior synthetic lab',
)
if (existingLab && existingLab.name !== LAB_NAME) {
  throw new Error('Gate0 seed refuses to replace a non-synthetic lab at its reserved UUID.')
}

const existingInventory = await requireNoError(
  await supabase.from('inventory').select('id,lab_id,name').eq('id', INVENTORY_ID).maybeSingle(),
  'Reading the prior synthetic inventory',
)
if (existingInventory && (existingInventory.lab_id !== LAB_ID || existingInventory.name !== INVENTORY_NAME)) {
  throw new Error('Gate0 seed refuses to replace non-synthetic inventory at its reserved UUID.')
}

const existingActiveSystemPolicy = await requireNoError(
  await supabase
    .from('waste_policy_versions')
    .select('id,name')
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

await requireNoError(
  await supabase.from('waste_policy_versions').delete().eq('id', POLICY_ID),
  'Cleaning the prior synthetic system policy',
)

// Removing the reserved lab cascades prior synthetic inventory and any waste
// records created by an earlier run. No production or remote URL can reach
// this point because the loopback check happens before the client is created.
await requireNoError(
  await supabase.from('labs').delete().eq('id', LAB_ID),
  'Cleaning the prior synthetic lab',
)

const existingUsers = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (existingUsers.error) throw new Error(`Listing local synthetic users failed: ${existingUsers.error.message}`)
for (const existing of existingUsers.data.users.filter((user) => user.email === E2E_EMAIL)) {
  const removed = await supabase.auth.admin.deleteUser(existing.id)
  if (removed.error) throw new Error(`Removing the prior synthetic user failed: ${removed.error.message}`)
}

const created = await supabase.auth.admin.createUser({
  email: E2E_EMAIL,
  password: E2E_PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: 'Gate0 관리자', synthetic: true },
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
  target: 'loopback-only',
  email: E2E_EMAIL,
  labId: LAB_ID,
  inventoryId: INVENTORY_ID,
  storageLocationId: STORAGE_LOCATION_ID,
  policyId: POLICY_ID,
}))
