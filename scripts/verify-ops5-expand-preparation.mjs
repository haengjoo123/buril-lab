import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const OPS5_PREPARATION_BASE_SHA = '7a210b10034a9c0deecb60a7a4022317f082db58'
export const OPS5_MIGRATION = 'supabase/migrations/20260903162850_ops5_expand_server_join.sql'
export const OPS5_PERMISSION_TEST = 'supabase/tests/ops5_expand_permissions.sql'
export const OPS5_MIGRATION_SHA256 = '09c9aeb92e2b5745ce69b8acc0b0c754cae4ca30bf735f6c5ba1f57aa584bc1b'
export const OPS5_PERMISSION_TEST_SHA256 = '183a3a73c23a66b274ac9fd4d4a00cca38a65ba4d1af4d34c901370e919812b3'

export const OPS5_APPROVED_PATHS = Object.freeze([
  '.env.example',
  'docs/operations/ops5-expand-preparation.md',
  'functions/api/_middleware.test.ts',
  'functions/api/_middleware.ts',
  'functions/api/_routePolicy.ts',
  'functions/api/_shared/requestBody.ts',
  'functions/api/labs/join.test.ts',
  'functions/api/labs/join.ts',
  'package.json',
  'scripts/fixtures/ops5-join-assertions.sql',
  'scripts/fixtures/ops5-local-bootstrap.sql',
  'scripts/ops5-local-join-api.test.ts',
  'scripts/ops5-local-join-api.ts',
  'scripts/static-security-headers.test.ts',
  'scripts/test-ops5-local-postgres.mjs',
  'scripts/test-ops5-workerd.mjs',
  'scripts/verify-no-client-secrets.mjs',
  'scripts/verify-no-client-secrets.test.ts',
  'scripts/verify-ops5-expand-preparation.mjs',
  'scripts/verify-ops5-expand-preparation.test.ts',
  'src/services/cabinetService.test.ts',
  'src/services/cabinetService.ts',
  'src/services/internalApi.test.ts',
  'src/services/internalApi.ts',
  'src/services/labService.test.ts',
  'src/services/labService.ts',
  'src/store/useLabStore.ts',
  OPS5_MIGRATION,
  OPS5_PERMISSION_TEST,
  'vite.config.ts',
])

function fail(message) {
  throw new Error(`[ops5-preparation] ${message}`)
}

function normalized(value) {
  return value.replace(/\r\n/g, '\n')
}

function sha256(value) {
  return createHash('sha256').update(normalized(value), 'utf8').digest('hex')
}

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    fail('cannot verify the Git preparation boundary')
  }
}

export function verifyOps5Paths(paths) {
  const allowed = new Set(OPS5_APPROVED_PATHS)
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !candidate || /[\\\x00-\x1f\x7f]/.test(candidate)
      || candidate.startsWith('/') || candidate.split('/').some((part) => !part || part === '.' || part === '..')) {
      fail('a changed path is malformed')
    }
    if (!allowed.has(candidate)) fail(`unreviewed path is present: ${candidate}`)
  }
  return paths.length
}

function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) fail(`${label} is missing: ${marker}`)
  }
}

export function verifyOps5DatabaseSources(migrationSource, permissionTestSource) {
  const migration = normalized(migrationSource)
  const permissionTest = normalized(permissionTestSource)
  if (sha256(migration) !== OPS5_MIGRATION_SHA256) fail('reviewed migration content changed')
  if (sha256(permissionTest) !== OPS5_PERMISSION_TEST_SHA256) fail('reviewed pgTAP content changed')
  requireMarkers(migration, [
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    'alter table public.cabinets add column image_path text;',
    'create function private.guard_cabinet_image_path_v1()',
    'create trigger cabinets_guard_image_path_v1',
    'create table private.lab_join_attempts_v1',
    'alter table private.lab_join_attempts_v1 enable row level security;',
    'create function public.join_lab_server_v1(',
    'create function public.record_cabinet_activity_v2(',
    "'cabinet_activity'",
    "'database'",
    'commit;',
  ], 'migration')
  requireMarkers(permissionTest, [
    'select plan(14);',
    "'private.guard_cabinet_image_path_v1()'",
    "'private.lab_join_attempts_v1'",
    "'public.join_lab_server_v1(uuid,uuid,text,text,text,text)'",
    "'public.record_cabinet_activity_v2(uuid,text,text,text,text,uuid)'",
    "'public.insert_audit_log_rpc(uuid,text,uuid,text,uuid,text,text,jsonb,jsonb,jsonb,text,uuid)'",
    'select * from finish();',
    'rollback;',
  ], 'pgTAP')
  for (const pattern of [
    /\bdrop\s+(?:table|column|function|policy|schema)\b/i,
    /alter\s+table\s+public\.cabinets\s+drop/i,
    /update\s+public\.cabinets\b/i,
    /(?:delete|update)\s+from\s+public\.audit_logs\b/i,
    /storage\.objects/i,
    /revoke[\s\S]{0,200}public\.join_lab\s*\(/i,
    /revoke[\s\S]{0,200}public\.insert_audit_log_rpc\s*\(/i,
  ]) {
    if (pattern.test(migration)) fail(`migration contains a Contract/Switch operation: ${pattern}`)
  }
  return { migrationSha256: sha256(migration), permissionTestSha256: sha256(permissionTest) }
}

export function verifyOps5ClientSources({ labService, cabinetService, joinHandler }) {
  if (!/postJson(?:<[^>]+>)?\(\s*['"]\/api\/labs\/join['"]/.test(labService)) {
    fail('new client does not use the server join endpoint')
  }
  if (/\.rpc\(\s*['"]join_lab['"]/.test(labService)) fail('new client still calls the legacy join RPC')
  if (!cabinetService.includes(".rpc('record_cabinet_activity_v2'")) fail('new client does not use the safe activity RPC')
  if (/updateCabinet[^\n]+image_path/.test(cabinetService)) fail('browser update API exposes the server-managed image path')
  if (cabinetService.includes(".rpc('insert_audit_log_rpc'") || cabinetService.includes(".from('audit_logs')")) {
    fail('new client retains a forgeable audit fallback')
  }
  if (!joinHandler.includes("redirect: 'manual'") || joinHandler.includes("redirect: 'error'")) {
    fail('join upstream redirects are not manually refused for Workers')
  }
  if (!joinHandler.includes('LAB_JOIN_AUTH_RESPONSE_BYTES') || !joinHandler.includes('LAB_JOIN_RPC_RESPONSE_BYTES')) {
    fail('join upstream response limits are missing')
  }
  return { joinPath: 'server', cabinetAuditPath: 'database-derived', redirectPolicy: 'manual-refuse' }
}

export function verifyOps5ExpandPreparation(root = fileURLToPath(new URL('../', import.meta.url))) {
  if (!/^[0-9a-f]{40}$/.test(OPS5_PREPARATION_BASE_SHA)) fail('base SHA is invalid')
  git(root, ['cat-file', '-e', `${OPS5_PREPARATION_BASE_SHA}^{commit}`])
  git(root, ['merge-base', '--is-ancestor', OPS5_PREPARATION_BASE_SHA, 'HEAD'])
  const changed = git(root, ['diff', '--name-only', OPS5_PREPARATION_BASE_SHA, '--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const paths = [...new Set([...changed, ...untracked])].sort()
  verifyOps5Paths(paths)
  for (const candidate of paths) {
    const status = lstatSync(path.join(root, candidate), { throwIfNoEntry: false })
    if (!status?.isFile()) fail(`reviewed path must be a regular file: ${candidate}`)
  }

  const database = verifyOps5DatabaseSources(
    readFileSync(path.join(root, OPS5_MIGRATION), 'utf8'),
    readFileSync(path.join(root, OPS5_PERMISSION_TEST), 'utf8'),
  )
  const client = verifyOps5ClientSources({
    labService: readFileSync(path.join(root, 'src/services/labService.ts'), 'utf8'),
    cabinetService: readFileSync(path.join(root, 'src/services/cabinetService.ts'), 'utf8'),
    joinHandler: readFileSync(path.join(root, 'functions/api/labs/join.ts'), 'utf8'),
  })
  return {
    result: 'ops5-expand-preparation-ok',
    baseSha: OPS5_PREPARATION_BASE_SHA,
    changedFiles: paths.length,
    database,
    client,
    productionReady: false,
    requiresOps4AndFreshMain: true,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(verifyOps5ExpandPreparation())) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Ops5 preparation verification failed.')
    process.exitCode = 1
  }
}
