import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDatabaseReleaseSafety } from './verify-database-release-safety.mjs'

export const OPS7_PREPARATION_BASE_SHA = '73141a66b2884efc9714bb77f95eddca9a6ec6ab'
export const OPS7_MIGRATION = 'supabase/migrations/20260904030000_ops7_contract_legacy_join_audit.sql'
export const OPS7_PERMISSION_TEST = 'supabase/tests/ops7_contract_permissions.sql'
export const OPS7_NATIVE_ASSERTIONS = 'scripts/fixtures/ops7-contract-assertions.sql'
export const OPS7_MIGRATION_SHA256 = '073927a0689e3cfd11e93ebcb47a3bd2ba828625553adc6389806a94e554951e'
export const OPS7_PERMISSION_TEST_SHA256 = '73cf2ec168ed0f6ec60ead91a901be4f9e39d24de3dba12cf2ff37bd6b75d942'
export const OPS7_NATIVE_ASSERTIONS_SHA256 = '96fce51d0047846f8ce6d841e21db087aef3ecd58f1f337becbafb18a90c1213'

export const OPS7_APPROVED_PATHS = Object.freeze([
  'docs/operations/ops7-contract-preparation.md',
  'package.json',
  OPS7_NATIVE_ASSERTIONS,
  'scripts/test-ops7-local-postgres.mjs',
  'scripts/verify-database-release-safety.mjs',
  'scripts/verify-database-release-safety.test.ts',
  'scripts/verify-ops6-private-photo-preparation.test.ts',
  'scripts/verify-ops7-contract-preparation.mjs',
  'scripts/verify-ops7-contract-preparation.test.ts',
  OPS7_MIGRATION,
  'supabase/migrations/README.md',
  OPS7_PERMISSION_TEST,
])

function fail(message) { throw new Error(`[ops7-preparation] ${message}`) }
function normalized(value) { return value.replace(/\r\n/g, '\n') }
function sha256(value) { return createHash('sha256').update(normalized(value), 'utf8').digest('hex') }
function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) fail(`${label} is missing: ${marker}`)
}
function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }) }
  catch { fail('cannot verify the Git preparation boundary') }
}

export function verifyOps7Paths(paths) {
  const allowed = new Set(OPS7_APPROVED_PATHS)
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !candidate || /[\\\x00-\x1f\x7f]/.test(candidate)
      || candidate.startsWith('/') || candidate.split('/').some((part) => !part || part === '.' || part === '..')) {
      fail('a changed path is malformed')
    }
    if (!allowed.has(candidate)) fail(`unreviewed path is present: ${candidate}`)
  }
  return paths.length
}

export function verifyOps7DatabaseSources({ migration, permissionTest, nativeAssertions }) {
  const sources = {
    migration: normalized(migration),
    permissionTest: normalized(permissionTest),
    nativeAssertions: normalized(nativeAssertions),
  }
  if (sha256(sources.migration) !== OPS7_MIGRATION_SHA256) fail('reviewed Contract migration changed')
  if (sha256(sources.permissionTest) !== OPS7_PERMISSION_TEST_SHA256) fail('reviewed permission test changed')
  if (sha256(sources.nativeAssertions) !== OPS7_NATIVE_ASSERTIONS_SHA256) fail('reviewed native assertions changed')
  requireMarkers(sources.migration, [
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    'public.join_lab(uuid, text, text)',
    'public.join_lab_with_password(uuid, uuid, text, text, text)',
    'public.insert_audit_log_rpc(',
    'from public, anon, authenticated, service_role;',
    'drop policy if exists "Users can insert audit_logs for their labs" on public.audit_logs;',
    'revoke all on table public.audit_logs from anon, authenticated;',
    'grant select on table public.audit_logs to authenticated;',
  ], 'Contract migration')
  for (const pattern of [
    /\bdrop\s+(?:table|column|function|schema)\b/i,
    /\bdelete\s+from\b/i,
    /\btruncate\b/i,
    /grant\s+[^;\n]+\s+on\s+function\s+public\.(?:join_lab|join_lab_with_password|insert_audit_log_rpc)/i,
  ]) if (pattern.test(sources.migration)) fail(`Contract contains an unapproved operation: ${pattern}`)
  requireMarkers(sources.permissionTest, [
    'select plan(12);',
    "'public.join_lab(uuid,text,text)'",
    "'public.insert_audit_log_rpc(uuid,text,uuid,text,uuid,text,text,jsonb,jsonb,jsonb,text,uuid)'",
    "has_table_privilege('authenticated', 'public.audit_logs', 'SELECT')",
    'select * from finish();',
    'rollback;',
  ], 'permission test')
  requireMarkers(sources.nativeAssertions, [
    'OPS7_CONTRACT_SQL_ASSERTIONS_PASSED',
    'legacy function remains executable',
    'browser audit write privilege remains',
  ], 'native assertions')
  return Object.freeze({
    migrationSha256: sha256(sources.migration),
    permissionTestSha256: sha256(sources.permissionTest),
    nativeAssertionsSha256: sha256(sources.nativeAssertions),
  })
}

export function verifyOps7ApplicationSources({ labService, joinHandler, cabinetService, auditService }) {
  if (/\.rpc\(\s*['"]join_lab['"]/.test(labService)) fail('client still calls the legacy join RPC')
  if (!labService.includes(">('/api/labs/join', {")) fail('client does not use the server join endpoint')
  if (!joinHandler.includes("adminClient.rpc('join_lab_server_v1'")) fail('server join endpoint does not use the bounded RPC')
  if (/\.rpc\(\s*['"]insert_audit_log_rpc['"]/.test(cabinetService)
    || /\.from\(\s*['"]audit_logs['"]\s*\)\s*\.(?:insert|update|delete)/.test(cabinetService)) {
    fail('cabinet client still has a generic audit write fallback')
  }
  if (!cabinetService.includes(".rpc('record_cabinet_activity_v2'")) fail('safe activity writer is missing')
  if (/\.from\(\s*['"]audit_logs['"]\s*\)\s*\.(?:insert|update|delete)/.test(auditService)) {
    fail('audit service contains a direct browser write')
  }
  return Object.freeze({ legacyClientCalls: 0, genericAuditClientWrites: 0 })
}

export function verifyOps7ContractPreparation(root = fileURLToPath(new URL('../', import.meta.url))) {
  git(root, ['cat-file','-e',`${OPS7_PREPARATION_BASE_SHA}^{commit}`])
  git(root, ['merge-base','--is-ancestor',OPS7_PREPARATION_BASE_SHA,'HEAD'])
  const changed = git(root, ['diff','--name-only',OPS7_PREPARATION_BASE_SHA,'--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const untracked = git(root, ['ls-files','--others','--exclude-standard','--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const paths = [...new Set([...changed,...untracked])].sort()
  verifyOps7Paths(paths)
  for (const candidate of paths) {
    const status = lstatSync(path.join(root, candidate), { throwIfNoEntry: false })
    if (!status?.isFile()) fail(`reviewed path must be a regular file: ${candidate}`)
  }
  const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')
  const database = verifyOps7DatabaseSources({
    migration: read(OPS7_MIGRATION),
    permissionTest: read(OPS7_PERMISSION_TEST),
    nativeAssertions: read(OPS7_NATIVE_ASSERTIONS),
  })
  const application = verifyOps7ApplicationSources({
    labService: read('src/services/labService.ts'),
    joinHandler: read('functions/api/labs/join.ts'),
    cabinetService: read('src/services/cabinetService.ts'),
    auditService: read('src/services/auditService.ts'),
  })
  const documentation = read('docs/operations/ops7-contract-preparation.md')
  requireMarkers(documentation, [
    '`productionReady: false`',
    '`contractReady: false`',
    '7일 연속으로 구 경로',
    '실제 Supabase·Cloudflare 변경: 0',
  ], 'Ops7 documentation')
  const packageSource = read('package.json')
  if (!packageSource.includes('"ops7:verify": "node scripts/verify-ops7-contract-preparation.mjs"')) {
    fail('package script does not expose the Ops7 verifier')
  }
  const releaseSafety = verifyDatabaseReleaseSafety(root)
  if (releaseSafety.activeMigrations !== 5 || releaseSafety.activePgTapTests !== 4) {
    fail('active database release manifest is not pinned through Ops7')
  }
  return Object.freeze({
    result: 'ops7-contract-preparation-ok',
    baseSha: OPS7_PREPARATION_BASE_SHA,
    changedFiles: paths.length,
    database,
    application,
    activeMigrations: releaseSafety.activeMigrations,
    activePgTapTests: releaseSafety.activePgTapTests,
    productionReady: false,
    contractReady: false,
    requiresSevenDayZeroUsageEvidence: true,
    hostedSupabaseAcceptance: false,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(verifyOps7ContractPreparation())) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Ops7 preparation verification failed.')
    process.exitCode = 1
  }
}
