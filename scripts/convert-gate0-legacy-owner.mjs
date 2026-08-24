import { createClient } from '@supabase/supabase-js'
import {
  GATE0_RESERVED_INVENTORY_ID,
  GATE0_RESERVED_LAB_ID,
  GATE0_RESERVED_POLICY_ID,
  GATE0_STAGING_ORIGIN,
  verifyLegacyFixtureConversion,
} from './gate0-seed-safety.mjs'

const apiUrl = process.env.SUPABASE_URL?.trim()
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const fixtureEmail = process.env.GATE0_E2E_EMAIL?.trim()
const expectedUserId = process.env.GATE0_LEGACY_USER_ID?.trim()
const confirmation = process.env.GATE0_LEGACY_CONVERSION_CONFIRMATION

if (process.env.GITHUB_ACTIONS === 'true') {
  throw new Error('Gate0 legacy ownership conversion is manual-only and refuses GitHub Actions.')
}
if (!apiUrl || !serviceRoleKey || !fixtureEmail || !expectedUserId || !confirmation) {
  throw new Error('Legacy conversion requires the Staging URL, service role, fixture email, exact user UUID, and confirmation.')
}
if (apiUrl !== GATE0_STAGING_ORIGIN) {
  throw new Error('Gate0 legacy conversion is restricted to the exact Staging Supabase origin.')
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expectedUserId)) {
  throw new Error('GATE0_LEGACY_USER_ID must be a UUID.')
}

const supabase = createClient(apiUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function requireNoError(result, operation) {
  if (result.error) throw new Error(`${operation} failed: ${result.error.message}`)
  return result.data
}

const userResult = await supabase.auth.admin.getUserById(expectedUserId)
if (userResult.error || !userResult.data.user) {
  throw new Error(`Reading the exact legacy fixture user failed: ${userResult.error?.message || 'missing user'}`)
}
const user = userResult.data.user
const [lab, inventory, policy, membership] = await Promise.all([
  requireNoError(
    await supabase.from('labs').select('id,name,created_by').eq('id', GATE0_RESERVED_LAB_ID).maybeSingle(),
    'Reading the reserved lab',
  ),
  requireNoError(
    await supabase.from('inventory').select('id,lab_id,user_id,name').eq('id', GATE0_RESERVED_INVENTORY_ID).maybeSingle(),
    'Reading the reserved inventory',
  ),
  requireNoError(
    await supabase
      .from('waste_policy_versions')
      .select('id,name,scope_type,created_by,activated_by')
      .eq('id', GATE0_RESERVED_POLICY_ID)
      .maybeSingle(),
    'Reading the reserved policy',
  ),
  requireNoError(
    await supabase
      .from('lab_members')
      .select('lab_id,user_id,role')
      .eq('lab_id', GATE0_RESERVED_LAB_ID)
      .eq('user_id', expectedUserId)
      .maybeSingle(),
    'Reading the reserved membership',
  ),
])

const appMetadata = verifyLegacyFixtureConversion({
  user,
  fixtureEmail,
  expectedUserId,
  confirmation,
  lab,
  inventory,
  policy,
  membership,
})

const updated = await supabase.auth.admin.updateUserById(expectedUserId, {
  app_metadata: appMetadata,
})
if (updated.error) throw new Error(`Writing the trusted legacy owner marker failed: ${updated.error.message}`)

console.log('Converted the reviewed legacy Gate0 owner marker. No fixture data was deleted; run the seed separately.')
