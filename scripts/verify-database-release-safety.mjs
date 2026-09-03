import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const defaultRepoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

export const BASELINE_FILE = '20260824000000_production_baseline.sql'
export const BASELINE_VERSION = '20260824000000'
export const EXPECTED_BASELINE_SHA256 = '4dff32df8daae096e55136010872f58f5d5b9b2e345576e5a3a3b915beb28821'
export const EXPECTED_LEGACY_ARCHIVE_SHA256 = 'e941ec312dc16580124e9112778aeb9304431659af785eda4dcbf66b5e0f558c'
export const EXPECTED_LEGACY_SQL_COUNT = 50
export const EXPECTED_PUBLIC_TABLE_COUNT = 49
export const EXPECTED_REMOTE_HISTORY_COUNT = 89
export const EXPECTED_REMOTE_HISTORY_SHA256 = 'ff169071822bd12de18c5485473e000aa50ad092ec6544fab25d045a471b113b'
export const EXPECTED_SNAPSHOT_ROW_COUNT = 118
export const EXPECTED_SNAPSHOT_SHA256 = 'c72f031e8d459e2db425352d9f97daadecada97e3f0c57060fe2b57217a964d6'
export const EXPECTED_LOCAL_ONLY_WITHOUT_SQL = ['20260823163832']
export const EXPECTED_LEGACY_TESTS = [
  'cabinet_state_atomic.sql',
  'reagent_date_tracking.sql',
  'search_batch_intelligence.sql',
  'waste_disposal_v2_inventory_disposal.sql',
  'waste_disposal_v2_inventory_move.sql',
  'waste_disposal_v2_inventory_usage.sql',
  'waste_disposal_v2_policy.sql',
  'waste_disposal_v2_verification.sql',
]
export const EXPECTED_PERMISSION_TEST_SHA256 = '48edb5c96bfdfa8f42ae1660b4c15f229cbf5b2a6fc0aa6ece3ddff625d350d3'
export const EXPECTED_INCREMENTAL_MIGRATIONS = Object.freeze({
  '20260903162850_ops5_expand_server_join.sql': '09c9aeb92e2b5745ce69b8acc0b0c754cae4ca30bf735f6c5ba1f57aa584bc1b',
  '20260904020000_ops6_private_cabinet_photos_expand.sql': 'a5c63cb5342e58aa0bd1555713ecad98e20d22bf3b82e2bd3d39d9104d07d4c8',
  '20260904021000_ops6_private_cabinet_photos_switch.sql': 'd153d1e380ea87613cf4f228b06823f4c46387e08346e5ce68f721d3cdd5a63d',
  '20260904030000_ops7_contract_legacy_join_audit.sql': '073927a0689e3cfd11e93ebcb47a3bd2ba828625553adc6389806a94e554951e',
})
export const EXPECTED_ACTIVE_PERMISSION_TESTS = Object.freeze({
  'baseline_permissions.sql': EXPECTED_PERMISSION_TEST_SHA256,
  'ops5_expand_permissions.sql': '183a3a73c23a66b274ac9fd4d4a00cca38a65ba4d1af4d34c901370e919812b3',
  'ops6_private_photos_permissions.sql': '56be7e3115c21332eb11e25674ef5f6e7498522919c4d091b7e0b12e9d175c48',
  'ops7_contract_permissions.sql': '73cf2ec168ed0f6ec60ead91a901be4f9e39d24de3dba12cf2ff37bd6b75d942',
})
export const EXPECTED_CI_MARKER = '{"schema_version":1,"enabled":true,"reset_count":2,"permission_tests":true}'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizeText(value) {
  return value.replace(/\r\n/g, '\n')
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function migrationFiles(directory) {
  return readdirSync(directory)
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
}

export function snapshotSha256(snapshot) {
  const canonicalLines = [
    String(snapshot.captured_at ?? ''),
    String(snapshot.production_project_ref ?? ''),
    String(snapshot.note ?? ''),
    ...snapshot.migrations.map((row) => [row.local ?? '', row.remote ?? '', row.time ?? ''].join('|')),
  ]
  return sha256(canonicalLines.join('\n'))
}

export function historySha256(versions) {
  return sha256([...new Set(versions)].sort().join('\n'))
}

export function verifyBaselineSql(sql) {
  const normalized = normalizeText(sql)
  assert(
    normalized.startsWith(
      '-- BurilLab production baseline captured 2026-08-24.\n'
      + '-- DO NOT execute this file against the existing production database.\n',
    ),
    'The production execution warning is missing from the baseline header.',
  )
  assert(
    sha256(normalized) === EXPECTED_BASELINE_SHA256,
    'The reviewed production baseline SQL content changed.',
  )

  const publicTables = [...normalized.matchAll(/^CREATE TABLE public\.([a-z_][a-z0-9_]*)/gmi)]
    .map((match) => match[1])
  assert(
    publicTables.length === EXPECTED_PUBLIC_TABLE_COUNT,
    `Expected ${EXPECTED_PUBLIC_TABLE_COUNT} public tables, found ${publicTables.length}.`,
  )
  assert(new Set(publicTables).size === publicTables.length, 'A public table is declared more than once.')
  assert(!/^GRANT [^;]+ ON TABLE public\.[^;]+ TO PUBLIC;/gmi.test(normalized), 'A public table grants privileges to PUBLIC.')

  const roleGrantCounts = { anon: 0, authenticated: 0, service_role: 0 }
  for (const table of publicTables) {
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert(
      new RegExp(`^ALTER TABLE(?: ONLY)? public\\.${escaped} ENABLE ROW LEVEL SECURITY;$`, 'mi').test(normalized),
      `Public table ${table} does not enable RLS.`,
    )

    let hasExplicitRoleGrant = false
    for (const role of Object.keys(roleGrantCounts)) {
      if (new RegExp(`^GRANT [^;]+ ON TABLE public\\.${escaped} TO ${role};$`, 'mi').test(normalized)) {
        roleGrantCounts[role] += 1
        hasExplicitRoleGrant = true
      }
    }
    assert(hasExplicitRoleGrant, `Public table ${table} has no explicit Data API/server role GRANT.`)
    assert(
      new RegExp(`^GRANT [^;]+ ON TABLE public\\.${escaped} TO service_role;$`, 'mi').test(normalized),
      `Public table ${table} has no explicit service_role GRANT.`,
    )
  }

  const functionHeaders = [...normalized.matchAll(
    /^CREATE FUNCTION (public|private)\.([^\n]+?)[\s\S]*?^    AS \$[^$]*\$/gm,
  )].map((match) => ({
    schema: match[1],
    signature: match[2],
    header: match[0].slice(0, match[0].lastIndexOf('    AS ')),
  }))
  const securityDefiners = functionHeaders.filter(({ header }) => /SECURITY DEFINER/i.test(header))
  for (const definition of securityDefiners) {
    assert(
      /SET search_path TO/i.test(definition.header),
      `SECURITY DEFINER function ${definition.schema}.${definition.signature} has no fixed search_path.`,
    )
  }
  assert(
    !/^GRANT [^;]+ ON FUNCTION public\.[^;]+ TO PUBLIC;/gmi.test(normalized),
    'A public function explicitly grants execution to PUBLIC.',
  )

  for (const prohibited of [
    'manufacturer_sds_records',
    'expiry_notifications',
    'account_deletion_jobs',
    'operator_role_assignments',
    'deletion_maintenance',
  ]) {
    assert(!normalized.includes(prohibited), `Baseline unexpectedly contains deferred object ${prohibited}.`)
  }

  return {
    publicTables: publicTables.length,
    explicitRoleGrants: roleGrantCounts,
    securityDefinerFunctions: securityDefiners.length,
  }
}

export function verifySnapshot(snapshot, legacyVersionsOnDisk) {
  assert(snapshot.migrations.length === EXPECTED_SNAPSHOT_ROW_COUNT, 'Migration evidence row count changed.')
  assert(snapshotSha256(snapshot) === EXPECTED_SNAPSHOT_SHA256, 'Migration evidence snapshot hash changed.')
  assert(/^[a-z]{20}$/.test(String(snapshot.production_project_ref ?? '')), 'Snapshot project ref is invalid.')

  const remoteVersions = snapshot.migrations
    .map((row) => String(row.remote ?? '').trim())
    .filter(Boolean)
  assert(remoteVersions.length === EXPECTED_REMOTE_HISTORY_COUNT, 'Remote migration evidence must contain 89 versions.')
  assert(new Set(remoteVersions).size === remoteVersions.length, 'Remote migration evidence contains duplicates.')
  assert(remoteVersions.every((version) => /^\d{14}$/.test(version)), 'Remote migration evidence contains an invalid version.')
  assert(historySha256(remoteVersions) === EXPECTED_REMOTE_HISTORY_SHA256, 'Remote 89-version history hash changed.')

  const localVersions = snapshot.migrations
    .map((row) => String(row.local ?? '').trim())
    .filter(Boolean)
  const localWithoutSql = [...new Set(localVersions)]
    .filter((version) => !legacyVersionsOnDisk.includes(version))
    .sort()
  assert(
    JSON.stringify(localWithoutSql) === JSON.stringify(EXPECTED_LOCAL_ONLY_WITHOUT_SQL),
    `Unexpected local-only evidence versions without archived SQL: ${localWithoutSql.join(', ')}`,
  )

  return {
    rows: snapshot.migrations.length,
    remoteVersions: remoteVersions.length,
    localEvidenceVersions: localVersions.length,
    localOnlyWithoutSql: localWithoutSql,
  }
}

export function verifyDatabaseReleaseSafety(repoRoot = defaultRepoRoot) {
  const activeDirectory = resolve(repoRoot, 'supabase/migrations')
  const legacyDirectory = resolve(repoRoot, 'supabase/legacy_migrations')
  const activeTestsDirectory = resolve(repoRoot, 'supabase/tests')
  const legacyTestsDirectory = resolve(repoRoot, 'supabase/legacy_tests')
  const deferredDirectory = resolve(repoRoot, 'supabase/deferred_migrations')

  const activeNames = readdirSync(activeDirectory).sort()
  const expectedActiveNames = [BASELINE_FILE, ...Object.keys(EXPECTED_INCREMENTAL_MIGRATIONS), 'README.md'].sort()
  assert(
    JSON.stringify(activeNames) === JSON.stringify(expectedActiveNames),
    `Active migration directory contains unreviewed files: ${activeNames.join(', ')}`,
  )
  assert(!existsSync(deferredDirectory), 'Deferred pilot migrations must not be present in the Prep 1 release slice.')

  const activeTests = readdirSync(activeTestsDirectory).sort()
  assert(
    JSON.stringify(activeTests) === JSON.stringify(Object.keys(EXPECTED_ACTIVE_PERMISSION_TESTS).sort()),
    `Active database test directory contains non-pgTAP files: ${activeTests.join(', ')}`,
  )
  const legacyTests = readdirSync(legacyTestsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  assert(
    JSON.stringify(legacyTests) === JSON.stringify([...EXPECTED_LEGACY_TESTS].sort()),
    `Legacy database test archive changed: ${legacyTests.join(', ')}`,
  )

  const baselineSql = readFileSync(resolve(activeDirectory, BASELINE_FILE), 'utf8')
  const baseline = verifyBaselineSql(baselineSql)
  for (const [name, expectedSha256] of Object.entries(EXPECTED_INCREMENTAL_MIGRATIONS)) {
    const migration = normalizeText(readFileSync(resolve(activeDirectory, name), 'utf8'))
    assert(sha256(migration) === expectedSha256, `Reviewed incremental migration changed: ${name}`)
    assert(/(?:^|\n)begin;\n/i.test(migration), `Incremental migration must start an explicit transaction: ${name}`)
    assert(/\ncommit;\n?$/i.test(migration), `Incremental migration must commit its explicit transaction: ${name}`)
    assert(/set local lock_timeout\s*=\s*'5s';/i.test(migration), `Incremental migration has no 5s lock timeout: ${name}`)
    assert(/set local statement_timeout\s*=\s*'60s';/i.test(migration), `Incremental migration has no 60s statement timeout: ${name}`)
  }

  const legacyFiles = migrationFiles(legacyDirectory)
  assert(legacyFiles.length === EXPECTED_LEGACY_SQL_COUNT, 'Legacy SQL archive file count changed.')
  const legacyArchiveLines = legacyFiles.map((name) => {
    const content = normalizeText(readFileSync(resolve(legacyDirectory, name), 'utf8'))
    return `${name}\0${sha256(content)}`
  })
  assert(
    sha256(legacyArchiveLines.join('\n')) === EXPECTED_LEGACY_ARCHIVE_SHA256,
    'Legacy migration SQL archive content changed.',
  )

  const legacyVersions = legacyFiles.map((name) => name.slice(0, 14))
  const snapshot = JSON.parse(readFileSync(
    resolve(legacyDirectory, 'application-history-before-baseline.json'),
    'utf8',
  ))
  const evidence = verifySnapshot(snapshot, legacyVersions)

  const config = readFileSync(resolve(repoRoot, 'supabase/config.toml'), 'utf8')
  assert(/major_version\s*=\s*17/.test(config), 'Local database major version must match the PG17 baseline.')
  assert(/\[db\.seed\][\s\S]*?enabled\s*=\s*false/.test(config), 'Prep 1 must not seed production-like data.')
  assert(/minimum_password_length\s*=\s*6/.test(config), 'Prep 1 must retain the pre-Gate2 local password baseline.')
  assert(!/\[auth\.mfa(?:\.|\])/.test(config), 'MFA configuration belongs to a later gate.')
  assert(!/auto_expose_new_tables\s*=\s*true/.test(config), 'Data API auto-exposure must remain disabled.')

  for (const [name, expectedSha256] of Object.entries(EXPECTED_ACTIVE_PERMISSION_TESTS)) {
    const permissionTest = normalizeText(readFileSync(resolve(activeTestsDirectory, name), 'utf8'))
    assert(sha256(permissionTest) === expectedSha256, `Reviewed permission pgTAP test changed: ${name}`)
    for (const marker of [
      'begin;',
      'create extension if not exists pgtap with schema extensions;',
      'select * from finish();',
      'rollback;',
    ]) {
      assert(permissionTest.includes(marker), `Permission pgTAP contract ${name} is missing: ${marker}`)
    }
    assert(/select plan\(\d+\);/i.test(permissionTest), `Permission pgTAP contract ${name} has no explicit plan.`)
  }

  const ciMarker = normalizeText(readFileSync(resolve(repoRoot, 'supabase/ci-quality.json'), 'utf8')).trim()
  assert(ciMarker === EXPECTED_CI_MARKER, 'Supabase CI opt-in marker differs from the exact Prep 1 contract.')
  const parsedCiMarker = JSON.parse(ciMarker)
  assert(
    JSON.stringify(Object.keys(parsedCiMarker).sort())
      === JSON.stringify(['enabled', 'permission_tests', 'reset_count', 'schema_version'].sort()),
    'Supabase CI opt-in marker fields changed.',
  )

  const repairScript = readFileSync(
    resolve(repoRoot, 'scripts/repair-production-migration-history.ps1'),
    'utf8',
  )
  for (const marker of [
    "[ValidateSet('plan', 'apply', 'restore-legacy')]",
    '$expectedLegacyCount = 89',
    `$expectedLegacyHistorySha256 = '${EXPECTED_REMOTE_HISTORY_SHA256}'`,
    `$expectedSnapshotSha256 = '${EXPECTED_SNAPSHOT_SHA256}'`,
    "$expectedSupabaseCliVersion = '2.115.0'",
    "npx '--no-install'",
    'SUPABASE_DB_PASSWORD',
  ]) {
    assert(repairScript.includes(marker), `Migration-history repair guard is missing: ${marker}`)
  }
  assert(!repairScript.includes("'--password'"), 'Repair must never put the database password in argv.')
  assert(!repairScript.includes("'db', 'push'"), 'Repair must never execute db push.')
  assert(!repairScript.includes("'db', 'reset'"), 'Repair must never execute db reset.')

  return {
    activeMigrations: 1 + Object.keys(EXPECTED_INCREMENTAL_MIGRATIONS).length,
    legacySqlFiles: legacyFiles.length,
    activePgTapTests: activeTests.length,
    legacySqlTests: legacyTests.length,
    baseline,
    evidence,
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  try {
    console.log(JSON.stringify(verifyDatabaseReleaseSafety()))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
