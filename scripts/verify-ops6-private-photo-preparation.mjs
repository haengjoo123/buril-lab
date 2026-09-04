import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const OPS6_PREPARATION_BASE_SHA = 'a13e6894d823bab2ba9acc08250629aabfde9a6e'
export const OPS6_EXPAND_MIGRATION = 'supabase/migrations/20260904020000_ops6_private_cabinet_photos_expand.sql'
export const OPS6_SWITCH_MIGRATION = 'supabase/migrations/20260904021000_ops6_private_cabinet_photos_switch.sql'
export const OPS6_PERMISSION_TEST = 'supabase/tests/ops6_private_photos_permissions.sql'
export const OPS6_NATIVE_ASSERTIONS = 'scripts/fixtures/ops6-photo-assertions.sql'
export const OPS6_EXPAND_SHA256 = 'a5c63cb5342e58aa0bd1555713ecad98e20d22bf3b82e2bd3d39d9104d07d4c8'
export const OPS6_SWITCH_SHA256 = 'd153d1e380ea87613cf4f228b06823f4c46387e08346e5ce68f721d3cdd5a63d'
export const OPS6_PERMISSION_TEST_SHA256 = '56be7e3115c21332eb11e25674ef5f6e7498522919c4d091b7e0b12e9d175c48'
export const OPS6_NATIVE_ASSERTIONS_SHA256 = '418c959017498086a187434e3a09be8d94f20d263a377f93a50594d4b224851d'

export const OPS6_APPROVED_PATHS = Object.freeze([
  'docs/operations/ops6-private-photo-preparation.md',
  'functions/api/_middleware.ts',
  'functions/api/_routePolicy.test.ts',
  'functions/api/_routePolicy.ts',
  'functions/api/cabinets/[id]/image.test.ts',
  'functions/api/cabinets/[id]/image.ts',
  'functions/api/cabinets/_shared.test.ts',
  'functions/api/cabinets/_shared.ts',
  'functions/api/cabinets/image-urls.test.ts',
  'functions/api/cabinets/image-urls.ts',
  'package.json',
  'scripts/cloudflare-release.test.ts',
  OPS6_NATIVE_ASSERTIONS,
  'scripts/migrate-ops6-private-photos.mjs',
  'scripts/migrate-ops6-private-photos.test.ts',
  'scripts/ops6-private-photo-migration-core.mjs',
  'scripts/ops6-private-photo-migration-core.test.ts',
  'scripts/test-ops6-local-postgres.mjs',
  'scripts/verify-database-release-safety.mjs',
  'scripts/verify-database-release-safety.test.ts',
  'scripts/verify-ops3-release-scope.test.ts',
  'scripts/verify-ops5-expand-preparation.test.ts',
  'scripts/verify-ops6-private-photo-preparation.mjs',
  'scripts/verify-ops6-private-photo-preparation.test.ts',
  'scripts/verify-storage-backup-worker-deployment.mjs',
  'src/features/fridge/CabinetListView.tsx',
  'src/services/cabinetService.test.ts',
  'src/services/cabinetService.ts',
  'src/services/internalApi.test.ts',
  'src/services/internalApi.ts',
  OPS6_EXPAND_MIGRATION,
  OPS6_SWITCH_MIGRATION,
  'supabase/migrations/README.md',
  OPS6_PERMISSION_TEST,
  'workers/storage-backup/runtime-tests/scheduled.runtime.ts',
  'workers/storage-backup/src/storageBackup.test.ts',
  'workers/storage-backup/src/storageBackup.ts',
  'workers/storage-backup/wrangler.production.jsonc',
  'workers/storage-backup/wrangler.staging.jsonc',
])

function fail(message) {
  throw new Error(`[ops6-preparation] ${message}`)
}

function normalized(value) {
  return value.replace(/\r\n/g, '\n')
}

function sha256(value) {
  return createHash('sha256').update(normalized(value), 'utf8').digest('hex')
}

function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }) }
  catch { fail('cannot verify the Git preparation boundary') }
}

function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) fail(`${label} is missing: ${marker}`)
}

export function verifyOps6Paths(paths) {
  const allowed = new Set(OPS6_APPROVED_PATHS)
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !candidate || /[\\\x00-\x1f\x7f]/.test(candidate)
      || candidate.startsWith('/') || candidate.split('/').some((part) => !part || part === '.' || part === '..')) {
      fail('a changed path is malformed')
    }
    if (!allowed.has(candidate)) fail(`unreviewed path is present: ${candidate}`)
  }
  return paths.length
}

export function verifyOps6DatabaseSources({ expand, switchMigration, permissionTest, nativeAssertions }) {
  const sources = {
    expand: normalized(expand),
    switchMigration: normalized(switchMigration),
    permissionTest: normalized(permissionTest),
    nativeAssertions: normalized(nativeAssertions),
  }
  const expected = {
    expand: OPS6_EXPAND_SHA256,
    switchMigration: OPS6_SWITCH_SHA256,
    permissionTest: OPS6_PERMISSION_TEST_SHA256,
    nativeAssertions: OPS6_NATIVE_ASSERTIONS_SHA256,
  }
  for (const [name, source] of Object.entries(sources)) {
    if (sha256(source) !== expected[name]) fail(`reviewed ${name} content changed`)
  }
  requireMarkers(sources.expand, [
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    'create table private.cabinet_image_objects_v1',
    'create table private.cabinet_image_retention_v1',
    'alter table private.cabinet_image_objects_v1 enable row level security;',
    'create function public.get_cabinet_image_paths_v1(',
    'create function public.get_cabinet_image_state_v1(',
    'create function public.set_cabinet_image_path_v1(',
    'create function public.migrate_cabinet_image_path_v1(',
    "raise exception 'Migrate the legacy cabinet image before changing it'",
    "clock_timestamp() + interval '7 days'",
    'grant execute on function public.set_cabinet_image_path_v1',
  ], 'Expand migration')
  for (const pattern of [
    /\bdrop\s+(?:table|column|function|schema|policy)\b/i,
    /update\s+storage\.buckets/i,
    /update\s+public\.cabinets\s+set\s+image_url\s*=\s*null/i,
    /\bdelete\s+from\b/i,
  ]) if (pattern.test(sources.expand)) fail(`Expand contains a Switch/destructive operation: ${pattern}`)

  requireMarkers(sources.switchMigration, [
    'Referenced public cabinet photos have not all been migrated',
    'Private cabinet photo metadata is incomplete',
    'update storage.buckets',
    'set public = false',
    "allowed_mime_types = array['image/webp']::text[]",
    'drop policy if exists "Auth Users Delete" on storage.objects;',
    'drop policy if exists "Auth Users Insert" on storage.objects;',
    'drop policy if exists "Auth Users Update" on storage.objects;',
    'update public.cabinets set image_url = null',
    'check (image_url is null)',
  ], 'Switch migration')
  for (const pattern of [
    /\bdelete\s+from\b/i,
    /\bdrop\s+(?:table|column|function|schema)\b/i,
    /\btruncate\b/i,
    /storage\.objects\s+(?:set|where)/i,
  ]) if (pattern.test(sources.switchMigration)) fail(`Switch contains an unapproved destructive operation: ${pattern}`)
  requireMarkers(sources.permissionTest, [
    'select plan(16);',
    "'private.cabinet_image_objects_v1'",
    "'public.set_cabinet_image_path_v1(uuid,uuid,text,text,text,bigint)'",
    "polname in ('Auth Users Insert','Auth Users Update','Auth Users Delete')",
    'select * from finish();',
    'rollback;',
  ], 'permission test')
  requireMarkers(sources.nativeAssertions, [
    'OPS6_EXPAND_SQL_ASSERTIONS_PASSED',
  ], 'native assertions')
  requireMarkers(sources.nativeAssertions, [
    'warning starts at 40',
    '51st referenced photo',
    'generic setter bypassed the legacy migration path',
    'cabinet with a legacy public photo was deleted before migration',
  ], 'native assertions')
  return Object.freeze({
    expandSha256: sha256(sources.expand),
    switchSha256: sha256(sources.switchMigration),
    permissionTestSha256: sha256(sources.permissionTest),
    nativeAssertionsSha256: sha256(sources.nativeAssertions),
  })
}

export function verifyOps6ApplicationSources({ cabinetService, sharedApi, imageApi, imageUrlsApi, migrationTool,
  stagingWorkerConfig, productionWorkerConfig, workerVerifier, documentation, packageSource }) {
  if (cabinetService.includes("storage.from('cabinets')") || cabinetService.includes('.getPublicUrl(')) {
    fail('browser cabinet service still accesses cabinet Storage directly')
  }
  requireMarkers(cabinetService, [
    "postJson<{ success: true; urls: Record<string, string | null> }>",
    "'/api/cabinets/image-urls'",
    'postBytes<',
    'removeCabinetImage',
  ], 'cabinet service')
  requireMarkers(sharedApi, [
    'CABINET_PHOTO_MAX_BYTES = 2 * 1024 * 1024',
    'CABINET_PHOTO_SIGNED_URL_SECONDS = 60 * 60',
    "redirect: 'manual'",
    'url.pathname === `/storage/v1/object/sign/cabinets/${expectedPath}`',
  ], 'cabinet API boundary')
  requireMarkers(imageApi, [
    "code: 'CABINET_IMAGE_MIGRATION_REQUIRED'",
    "admin.rpc('set_cabinet_image_path_v1'",
    'leave the body for backup quarantine',
  ], 'cabinet image API')
  requireMarkers(imageUrlsApi, [
    "admin.rpc('get_cabinet_image_paths_v1'",
    'createSignedUrls(paths, CABINET_PHOTO_SIGNED_URL_SECONDS)',
    'checkedSignedUrl(entry?.signedUrl, origin, path)',
  ], 'signed URL API')
  requireMarkers(migrationTool, [
    "if (!['plan','apply'].includes(mode)",
    'exact action-time confirmation is missing',
    'private object failed its download SHA-256 verification',
    'loadProtectedEphemeralReleaseKey()',
    "kind: 'ops6_private_photo_copy_receipt'",
    'switchApplied: false, deletions: 0',
  ], 'migration tool')
  for (const pattern of [
    /\.remove\s*\(/,
    /\bdelete\s*\(/,
    /upsert\s*:\s*true/,
    /console\.(?:log|error)[^\n]*(?:credential|serviceRoleKey|SUPABASE_SERVICE_ROLE_KEY)/i,
  ]) if (pattern.test(migrationTool)) fail(`migration tool contains an unapproved deletion or secret output: ${pattern}`)
  for (const [label, config] of [['Staging Worker', stagingWorkerConfig], ['Production Worker', productionWorkerConfig]]) {
    if (!config.includes('"SOURCE_POINTER_MODE": "private_path"') || config.includes('"SOURCE_POINTER_MODE": "legacy_url"')) {
      fail(`${label} does not use only private_path`)
    }
  }
  if (!workerVerifier.includes("SOURCE_POINTER_MODE: 'private_path'")) fail('deployed Worker verifier is not pinned to private_path')
  requireMarkers(documentation, [
    '`productionReady: false`',
    '실제 Supabase·Cloudflare 변경: 0',
    '실제 파일 삭제: 0',
    '운영 1·2 관찰, 운영 3, 운영 4, 운영 5',
  ], 'Ops6 documentation')
  if (!packageSource.includes('"ops6:verify": "node scripts/verify-ops6-private-photo-preparation.mjs"')) {
    fail('package script does not expose the Ops6 verifier')
  }
  return Object.freeze({
    browserStorageWrites: 0,
    signedUrlSeconds: 3600,
    maximumReferencedPhotosPerScope: 50,
    retentionDays: 7,
    migrationDeletes: 0,
    backupPointerMode: 'private_path',
  })
}

export function verifyOps6PrivatePhotoPreparation(root = fileURLToPath(new URL('../', import.meta.url))) {
  git(root, ['cat-file','-e',`${OPS6_PREPARATION_BASE_SHA}^{commit}`])
  git(root, ['merge-base','--is-ancestor',OPS6_PREPARATION_BASE_SHA,'HEAD'])
  const changed = git(root, ['diff','--name-only',OPS6_PREPARATION_BASE_SHA,'--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const untracked = git(root, ['ls-files','--others','--exclude-standard','--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const paths = [...new Set([...changed,...untracked])].sort()
  verifyOps6Paths(paths)
  for (const candidate of paths) {
    const status = lstatSync(path.join(root, candidate), { throwIfNoEntry: false })
    if (!status?.isFile()) fail(`reviewed path must be a regular file: ${candidate}`)
  }
  const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')
  const database = verifyOps6DatabaseSources({
    expand: read(OPS6_EXPAND_MIGRATION),
    switchMigration: read(OPS6_SWITCH_MIGRATION),
    permissionTest: read(OPS6_PERMISSION_TEST),
    nativeAssertions: read(OPS6_NATIVE_ASSERTIONS),
  })
  const application = verifyOps6ApplicationSources({
    cabinetService: read('src/services/cabinetService.ts'),
    sharedApi: read('functions/api/cabinets/_shared.ts'),
    imageApi: read('functions/api/cabinets/[id]/image.ts'),
    imageUrlsApi: read('functions/api/cabinets/image-urls.ts'),
    migrationTool: read('scripts/migrate-ops6-private-photos.mjs'),
    stagingWorkerConfig: read('workers/storage-backup/wrangler.staging.jsonc'),
    productionWorkerConfig: read('workers/storage-backup/wrangler.production.jsonc'),
    workerVerifier: read('scripts/verify-storage-backup-worker-deployment.mjs'),
    documentation: read('docs/operations/ops6-private-photo-preparation.md'),
    packageSource: read('package.json'),
  })
  return Object.freeze({
    result: 'ops6-private-photo-preparation-ok',
    baseSha: OPS6_PREPARATION_BASE_SHA,
    changedFiles: paths.length,
    database,
    application,
    productionReady: false,
    hostedSupabaseAcceptance: false,
    requiresEarlierOperationalGates: true,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(verifyOps6PrivatePhotoPreparation())) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Ops6 preparation verification failed.')
    process.exitCode = 1
  }
}
