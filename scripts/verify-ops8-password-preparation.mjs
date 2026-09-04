import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDatabaseReleaseSafety } from './verify-database-release-safety.mjs'

export const OPS8_PREPARATION_BASE_SHA = '40ae779f387a115527365637cefd48ba4a2a65c3'
export const OPS8_MIGRATION = 'supabase/migrations/20260904040000_ops8_lab_password_policy.sql'
export const OPS8_PERMISSION_TEST = 'supabase/tests/ops8_lab_password_policy.sql'
export const OPS8_NATIVE_ASSERTIONS = 'scripts/fixtures/ops8-password-assertions.sql'
export const OPS8_MIGRATION_SHA256 = '3f7210de31759efc6179ee712616a9dbb89b0f34e366f3c86eb951d0baca0f18'
export const OPS8_PERMISSION_TEST_SHA256 = '19ebad4a89d75a9e905cc827e3014db4d0f675130f474550ad2748957ce87733'
export const OPS8_NATIVE_ASSERTIONS_SHA256 = 'd2c514c191736374545f3bfdb61b7f38b2918e1489376411f34a12855166fc8c'

export const OPS8_APPROVED_PATHS = Object.freeze([
  'docs/operations/ops8-password-preparation.md',
  'package.json',
  OPS8_NATIVE_ASSERTIONS,
  'scripts/test-ops8-local-postgres.mjs',
  'scripts/verify-database-release-safety.mjs',
  'scripts/verify-database-release-safety.test.ts',
  'scripts/verify-ops7-contract-preparation.test.ts',
  'scripts/verify-ops8-password-preparation.mjs',
  'scripts/verify-ops8-password-preparation.test.ts',
  'scripts/verify-supabase-auth-password-config.mjs',
  'scripts/verify-supabase-auth-password-config.test.ts',
  'src/components/LabManagementModal.tsx',
  'src/locales/translations.ts',
  'src/services/labService.ts',
  'src/services/labService.test.ts',
  'src/store/useLabStore.ts',
  'src/utils/labPasswordPolicy.ts',
  'src/utils/labPasswordPolicy.test.ts',
  OPS8_MIGRATION,
  'supabase/migrations/README.md',
  OPS8_PERMISSION_TEST,
])

function fail(message) { throw new Error(`[ops8-preparation] ${message}`) }
function normalized(value) { return value.replace(/\r\n/g, '\n') }
function sha256(value) { return createHash('sha256').update(normalized(value), 'utf8').digest('hex') }
function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) fail(`${label} is missing: ${marker}`)
}
function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }) }
  catch { fail('cannot verify the Git preparation boundary') }
}

export function verifyOps8Paths(paths) {
  const allowed = new Set(OPS8_APPROVED_PATHS)
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !candidate || /[\\\x00-\x1f\x7f]/.test(candidate)
      || candidate.startsWith('/') || candidate.split('/').some((part) => !part || part === '.' || part === '..')) {
      fail('a changed path is malformed')
    }
    if (!allowed.has(candidate)) fail(`unreviewed path is present: ${candidate}`)
  }
  return paths.length
}

export function verifyOps8DatabaseSources({ migration, permissionTest, nativeAssertions }) {
  const sources = {
    migration: normalized(migration),
    permissionTest: normalized(permissionTest),
    nativeAssertions: normalized(nativeAssertions),
  }
  if (sha256(sources.migration) !== OPS8_MIGRATION_SHA256) fail('reviewed password migration changed')
  if (sha256(sources.permissionTest) !== OPS8_PERMISSION_TEST_SHA256) fail('reviewed permission test changed')
  if (sha256(sources.nativeAssertions) !== OPS8_NATIVE_ASSERTIONS_SHA256) fail('reviewed native assertions changed')
  requireMarkers(sources.migration, [
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    'join_password_needs_change boolean not null default false',
    'private.assert_lab_join_password_v1(',
    "char_length(v_password) < 12 or char_length(v_password) > 128",
    "new.join_password_hash := 'sha256$' || extensions.crypt",
    'new.join_password_needs_change := true;',
    'from public, anon, authenticated, service_role;',
  ], 'password migration')
  for (const pattern of [
    /\bdrop\s+(?:table|column|function|schema)\b/i,
    /\bdelete\s+from\b/i,
    /\btruncate\b/i,
    /grant\s+execute\s+on\s+function\s+private\.assert_lab_join_password_v1[^;]+to\s+(?:public|anon|authenticated)/i,
  ]) if (pattern.test(sources.migration)) fail(`password migration contains an unapproved operation: ${pattern}`)
  requireMarkers(sources.permissionTest, [
    'select plan(18);',
    "'private.assert_lab_join_password_v1(text,text)'",
    "'public.set_lab_join_password(uuid,text)'",
    'select * from finish();',
    'rollback;',
  ], 'permission test')
  requireMarkers(sources.nativeAssertions, [
    'OPS8_PASSWORD_SQL_ASSERTIONS_PASSED',
    'private password helper is exposed',
    'password trigger security settings changed',
  ], 'native assertions')
  return Object.freeze({
    migrationSha256: sha256(sources.migration),
    permissionTestSha256: sha256(sources.permissionTest),
    nativeAssertionsSha256: sha256(sources.nativeAssertions),
  })
}

export function verifyOps8ApplicationSources({ policy, labService, labStore, modal, authVerifier }) {
  requireMarkers(policy, [
    'LAB_JOIN_PASSWORD_MIN_LENGTH = 12',
    'LAB_JOIN_PASSWORD_MAX_LENGTH = 128',
    "return 'lab_name'",
    "return 'common'",
  ], 'client password policy')
  if (!labService.includes('join_password_needs_change')) fail('lab reads do not include the replacement flag')
  if (!labStore.includes('join_password_needs_change?: boolean')) fail('lab state does not type the replacement flag')
  requireMarkers(modal, [
    'validateLabJoinPassword(createName, createPassword)',
    'validateLabJoinPassword(settingsName, settingsPassword)',
    'currentMembership?.lab?.join_password_needs_change',
    'lab_mgmt_password_replacement_required',
  ], 'lab management UI')
  requireMarkers(authVerifier, [
    "method: 'GET'",
    '/v1/projects/${projectRef}/config/auth',
    'config.password_hibp_enabled !== true',
    'auth configuration returned HTTP',
  ], 'hosted Auth verifier')
  if (/method:\s*['"](?:PATCH|POST|PUT|DELETE)['"]/.test(authVerifier)) {
    fail('hosted Auth verifier contains a write request')
  }
  return Object.freeze({ clientMinimum: 12, clientMaximum: 128, hostedVerifierReadOnly: true })
}

export function verifyOps8PasswordPreparation(root = fileURLToPath(new URL('../', import.meta.url))) {
  git(root, ['cat-file','-e',`${OPS8_PREPARATION_BASE_SHA}^{commit}`])
  git(root, ['merge-base','--is-ancestor',OPS8_PREPARATION_BASE_SHA,'HEAD'])
  const changed = git(root, ['diff','--name-only',OPS8_PREPARATION_BASE_SHA,'--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const untracked = git(root, ['ls-files','--others','--exclude-standard','--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const paths = [...new Set([...changed,...untracked])].sort()
  verifyOps8Paths(paths)
  for (const candidate of paths) {
    const status = lstatSync(path.join(root, candidate), { throwIfNoEntry: false })
    if (!status?.isFile()) fail(`reviewed path must be a regular file: ${candidate}`)
  }
  const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')
  const database = verifyOps8DatabaseSources({
    migration: read(OPS8_MIGRATION),
    permissionTest: read(OPS8_PERMISSION_TEST),
    nativeAssertions: read(OPS8_NATIVE_ASSERTIONS),
  })
  const application = verifyOps8ApplicationSources({
    policy: read('src/utils/labPasswordPolicy.ts'),
    labService: read('src/services/labService.ts'),
    labStore: read('src/store/useLabStore.ts'),
    modal: read('src/components/LabManagementModal.tsx'),
    authVerifier: read('scripts/verify-supabase-auth-password-config.mjs'),
  })
  const documentation = read('docs/operations/ops8-password-preparation.md')
  requireMarkers(documentation, [
    '`productionReady: false`',
    '`hostedSupabaseAcceptance: false`',
    '기존 해시를 그대로 보존',
    '실제 Supabase·Cloudflare 변경',
  ], 'Ops8 documentation')
  const packageSource = read('package.json')
  for (const marker of [
    '"ops8:verify": "node scripts/verify-ops8-password-preparation.mjs"',
    '"ops8:auth-config:hosted": "node scripts/verify-supabase-auth-password-config.mjs"',
  ]) if (!packageSource.includes(marker)) fail(`package script is missing: ${marker}`)
  const releaseSafety = verifyDatabaseReleaseSafety(root)
  if (releaseSafety.activeMigrations !== 6 || releaseSafety.activePgTapTests !== 5) {
    fail('active database release manifest is not pinned through Ops8')
  }
  return Object.freeze({
    result: 'ops8-password-preparation-ok',
    baseSha: OPS8_PREPARATION_BASE_SHA,
    changedFiles: paths.length,
    database,
    application,
    activeMigrations: releaseSafety.activeMigrations,
    activePgTapTests: releaseSafety.activePgTapTests,
    productionReady: false,
    hostedSupabaseAcceptance: false,
    requiresEarlierOperationalGates: true,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(verifyOps8PasswordPreparation())) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Ops8 preparation verification failed.')
    process.exitCode = 1
  }
}
