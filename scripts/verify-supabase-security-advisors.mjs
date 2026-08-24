import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const ADVISOR_CLI_VERSION = '2.115.0'
export const BASELINE_ENVIRONMENTS = ['production', 'staging']
export const EXPECTED_COUNTS = Object.freeze({ production: 53, staging: 50 })

const repoRoot = resolve(import.meta.dirname, '..')
const baselineDirectory = resolve(repoRoot, 'supabase/security-advisors')
const permissionQueryPath = resolve(repoRoot, 'scripts/supabase-security-advisor-permissions.sql')
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/
const ALLOWED_LEVELS = new Set(['ERROR', 'WARN', 'INFO'])
const ALLOWED_DISPOSITIONS = new Set(['accepted_design', 'temporary_open'])
const ALLOWED_RULES = new Set([
  'authenticated_security_definer_function_executable',
  'auth_leaked_password_protection',
  'rls_enabled_no_policy',
])
const PERMISSION_QUERY_MARKER = 'This query intentionally returns no application rows, function bodies, or secrets.'
const PERMISSION_QUERY_SHA256 = '0fc48a1f1aeb55fa908490e38864161ee12bcda5445acae973d6dcfb9deeca95'
const FORBIDDEN_SQL_STATEMENTS = /\b(?:alter|call|comment|copy|create|delete|do|drop|execute|grant|insert|refresh|reset|revoke|set|truncate|update|vacuum)\b/i
const SECRET_VALUE_PATTERN = /(?:sb_secret_|sbp_)[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.|postgres(?:ql)?:\/\/[^\s"']+/i
const EMAIL_VALUE_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PERMISSION_ROW_FIELDS = [
  'object_kind',
  'schema_name',
  'object_name',
  'identity_arguments',
  'language',
  'security_definer',
  'anon_execute',
  'authenticated_execute',
  'service_role_execute',
  'rls_enabled',
  'rls_forced',
  'policy_count',
  'anon_schema_usage',
  'anon_bypass_rls',
  'anon_select',
  'anon_insert',
  'anon_update',
  'anon_delete',
  'authenticated_schema_usage',
  'authenticated_bypass_rls',
  'authenticated_select',
  'authenticated_insert',
  'authenticated_update',
  'authenticated_delete',
  'service_role_schema_usage',
  'service_role_bypass_rls',
  'service_role_select',
  'service_role_insert',
  'service_role_update',
  'service_role_delete',
]

export class AdvisorContractError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AdvisorContractError'
  }
}

function fail(message) {
  throw new AdvisorContractError(message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object`)
  return value
}

function assertString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    fail(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`)
  }
  return value
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`)
  return value
}

function assertInteger(value, label) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value)
    ? Number.parseInt(value, 10)
    : value
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    fail(`${label} must be a non-negative integer`)
  }
  return normalized
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(assertRecord(value, label)).sort(compareText)
  const expected = [...expectedKeys].sort(compareText)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} has unexpected or missing fields`)
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function assertDate(value, label) {
  assertString(value, label)
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail(`${label} must be an ISO date`)
  }
  return value
}

function assertNullableDate(value, label) {
  if (value === null) return null
  return assertDate(value, label)
}

function assertOfficialRemediationUrl(value, label) {
  assertString(value, label)
  let url
  try {
    url = new URL(value)
  } catch {
    fail(`${label} must be a valid URL`)
  }
  if (url.protocol !== 'https:' || url.hostname !== 'supabase.com') {
    fail(`${label} must be an official Supabase HTTPS URL`)
  }
  return value
}

function rolePermissionsFromRow(row, role, label) {
  return {
    schema_usage: assertBoolean(row[`${role}_schema_usage`], `${label}.${role}_schema_usage`),
    bypass_rls: assertBoolean(row[`${role}_bypass_rls`], `${label}.${role}_bypass_rls`),
    select: assertBoolean(row[`${role}_select`], `${label}.${role}_select`),
    insert: assertBoolean(row[`${role}_insert`], `${label}.${role}_insert`),
    update: assertBoolean(row[`${role}_update`], `${label}.${role}_update`),
    delete: assertBoolean(row[`${role}_delete`], `${label}.${role}_delete`),
  }
}

function validateRolePermissions(value, label) {
  assertExactKeys(value, ['schema_usage', 'bypass_rls', 'select', 'insert', 'update', 'delete'], label)
  for (const key of ['schema_usage', 'bypass_rls', 'select', 'insert', 'update', 'delete']) {
    assertBoolean(value[key], `${label}.${key}`)
  }
}

function functionLookupKey(object) {
  return `function:${object.schema}.${object.name}(${object.identity_arguments})`
}

function tableLookupKey(object) {
  return `table:${object.schema}.${object.name}`
}

function validateObject(object, label) {
  assertRecord(object, label)
  if (object.kind === 'function') {
    assertExactKeys(
      object,
      ['kind', 'schema', 'name', 'identity_arguments', 'language', 'security_definer'],
      label,
    )
    assertString(object.schema, `${label}.schema`)
    assertString(object.name, `${label}.name`)
    assertString(object.identity_arguments, `${label}.identity_arguments`, { allowEmpty: true })
    assertString(object.language, `${label}.language`)
    if (object.security_definer !== true) fail(`${label}.security_definer must be true`)
    return
  }
  if (object.kind === 'table') {
    assertExactKeys(object, ['kind', 'schema', 'name'], label)
    assertString(object.schema, `${label}.schema`)
    assertString(object.name, `${label}.name`)
    return
  }
  if (object.kind === 'auth_setting') {
    assertExactKeys(object, ['kind', 'entity', 'name'], label)
    if (object.entity !== 'Auth' || object.name !== 'leaked_password_protection') {
      fail(`${label} is not the reviewed Auth setting`)
    }
    return
  }
  fail(`${label}.kind is unsupported`)
}

function validateEvidence(evidence, object, label) {
  assertRecord(evidence, label)
  if (object.kind === 'function') {
    assertExactKeys(
      evidence,
      ['kind', 'anon_execute', 'authenticated_execute', 'service_role_execute'],
      label,
    )
    if (evidence.kind !== 'function_execute') fail(`${label}.kind must be function_execute`)
    assertBoolean(evidence.anon_execute, `${label}.anon_execute`)
    assertBoolean(evidence.authenticated_execute, `${label}.authenticated_execute`)
    assertBoolean(evidence.service_role_execute, `${label}.service_role_execute`)
    if (evidence.authenticated_execute !== true) {
      fail(`${label} contradicts the authenticated SECURITY DEFINER finding`)
    }
    return
  }
  if (object.kind === 'table') {
    assertExactKeys(
      evidence,
      ['kind', 'rls_enabled', 'rls_forced', 'policy_count', 'anon', 'authenticated', 'service_role'],
      label,
    )
    if (evidence.kind !== 'table_access') fail(`${label}.kind must be table_access`)
    if (evidence.rls_enabled !== true) fail(`${label}.rls_enabled must be true`)
    assertBoolean(evidence.rls_forced, `${label}.rls_forced`)
    if (assertInteger(evidence.policy_count, `${label}.policy_count`) !== 0) {
      fail(`${label}.policy_count must be zero for this finding`)
    }
    validateRolePermissions(evidence.anon, `${label}.anon`)
    validateRolePermissions(evidence.authenticated, `${label}.authenticated`)
    validateRolePermissions(evidence.service_role, `${label}.service_role`)
    return
  }
  assertExactKeys(evidence, ['kind', 'advisor_assertion'], label)
  if (
    evidence.kind !== 'advisor_only'
    || evidence.advisor_assertion !== 'auth_leaked_password_protection'
  ) {
    fail(`${label} is not the reviewed Auth advisor assertion`)
  }
}

function validateEntry(entry, index, today) {
  const label = `entries[${index}]`
  assertExactKeys(
    entry,
    [
      'cache_key',
      'rule',
      'level',
      'object',
      'evidence',
      'remediation_url',
      'disposition',
      'reason',
      'reviewed_by_role',
      'reviewed_at',
      'expires_on',
      'target_gate',
    ],
    label,
  )
  const cacheKey = assertString(entry.cache_key, `${label}.cache_key`)
  const rule = assertString(entry.rule, `${label}.rule`)
  if (!ALLOWED_RULES.has(rule)) fail(`${label}.rule is not reviewed`)
  if (!cacheKey.startsWith(rule)) fail(`${label}.cache_key must start with its rule`)
  if (!ALLOWED_LEVELS.has(entry.level)) fail(`${label}.level is invalid`)
  validateObject(entry.object, `${label}.object`)
  validateEvidence(entry.evidence, entry.object, `${label}.evidence`)
  assertOfficialRemediationUrl(entry.remediation_url, `${label}.remediation_url`)
  if (!ALLOWED_DISPOSITIONS.has(entry.disposition)) fail(`${label}.disposition is invalid`)
  if (assertString(entry.reason, `${label}.reason`).length < 20) {
    fail(`${label}.reason must contain a concrete review reason`)
  }
  const reviewedByRole = assertString(entry.reviewed_by_role, `${label}.reviewed_by_role`)
  if (reviewedByRole.includes('@')) fail(`${label}.reviewed_by_role must not contain an email address`)
  assertDate(entry.reviewed_at, `${label}.reviewed_at`)
  const expiresOn = assertNullableDate(entry.expires_on, `${label}.expires_on`)
  if (entry.target_gate !== null) assertString(entry.target_gate, `${label}.target_gate`)

  if (entry.disposition === 'temporary_open') {
    if (expiresOn === null || entry.target_gate === null) {
      fail(`${label} temporary_open findings require an expiry and target gate`)
    }
    if (expiresOn <= today) fail(`${label} temporary_open finding has expired`)
  } else if (expiresOn !== null || entry.target_gate !== null) {
    fail(`${label} accepted_design findings must not carry an expiry or target gate`)
  }
  if (entry.disposition === 'accepted_design' && rule !== 'rls_enabled_no_policy') {
    fail(`${label} only a reviewed default-deny RLS finding may be accepted_design`)
  }

  if (rule === 'authenticated_security_definer_function_executable' && entry.object.kind !== 'function') {
    fail(`${label} must identify a function`)
  }
  if (rule === 'rls_enabled_no_policy' && entry.object.kind !== 'table') {
    fail(`${label} must identify a table`)
  }
  if (rule === 'auth_leaked_password_protection' && entry.object.kind !== 'auth_setting') {
    fail(`${label} must identify the Auth setting`)
  }
}

export function validateBaseline(baseline, expectedEnvironment, { today = new Date().toISOString().slice(0, 10) } = {}) {
  assertDate(today, 'today')
  assertExactKeys(
    baseline,
    ['schema_version', 'environment', 'advisor_cli_version', 'expected_count', 'observed_on', 'entries'],
    `${expectedEnvironment} baseline`,
  )
  if (baseline.schema_version !== 1) fail(`${expectedEnvironment} schema_version must be 1`)
  if (baseline.environment !== expectedEnvironment) fail(`${expectedEnvironment} baseline environment mismatch`)
  if (baseline.advisor_cli_version !== ADVISOR_CLI_VERSION) {
    fail(`${expectedEnvironment} advisor CLI version is not pinned to ${ADVISOR_CLI_VERSION}`)
  }
  assertDate(baseline.observed_on, `${expectedEnvironment} observed_on`)
  if (!Array.isArray(baseline.entries)) fail(`${expectedEnvironment} entries must be an array`)
  const expectedCount = EXPECTED_COUNTS[expectedEnvironment]
  if (baseline.expected_count !== expectedCount || baseline.entries.length !== expectedCount) {
    fail(`${expectedEnvironment} baseline must contain exactly ${expectedCount} entries`)
  }
  const serialized = JSON.stringify(baseline)
  if (SECRET_VALUE_PATTERN.test(serialized) || EMAIL_VALUE_PATTERN.test(serialized)) {
    fail(`${expectedEnvironment} baseline contains a prohibited credential or personal identifier`)
  }

  baseline.entries.forEach((entry, index) => validateEntry(entry, index, today))
  const cacheKeys = baseline.entries.map((entry) => entry.cache_key)
  const sorted = [...cacheKeys].sort(compareText)
  if (JSON.stringify(cacheKeys) !== JSON.stringify(sorted)) {
    fail(`${expectedEnvironment} entries must be sorted by cache_key`)
  }
  if (new Set(cacheKeys).size !== cacheKeys.length) {
    fail(`${expectedEnvironment} entries contain duplicate cache_key values`)
  }
  return baseline
}

export function loadBaseline(environment, options) {
  if (!BASELINE_ENVIRONMENTS.includes(environment)) fail(`unsupported environment: ${environment}`)
  const path = resolve(baselineDirectory, `${environment}.json`)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail(`${environment} baseline is missing or invalid JSON`)
  }
  return validateBaseline(parsed, environment, options)
}

export function validatePermissionQuery(sql = readFileSync(permissionQueryPath, 'utf8')) {
  assertString(sql, 'permission query')
  if (!sql.includes(PERMISSION_QUERY_MARKER)) fail('permission query is missing its public-safe data boundary')
  const withoutComments = sql.replace(/--.*$/gm, '')
  const withoutStrings = withoutComments.replace(/'(?:''|[^'])*'/g, "''")
  if (!/^\s*with\b/i.test(withoutStrings)) fail('permission query must be a single catalog CTE query')
  if (FORBIDDEN_SQL_STATEMENTS.test(withoutStrings)) fail('permission query contains a mutating SQL statement')
  if (/\b(?:pg_get_functiondef|prosrc)\b/i.test(withoutStrings)) {
    fail('permission query must not read function bodies')
  }
  if ((withoutStrings.match(/;/g) || []).length !== 1 || !/;\s*$/.test(withoutStrings)) {
    fail('permission query must contain exactly one statement')
  }
  const canonical = sql.replace(/\r\n/g, '\n').trimEnd() + '\n'
  const digest = createHash('sha256').update(canonical).digest('hex')
  if (digest !== PERMISSION_QUERY_SHA256) {
    fail('permission query differs from the reviewed SHA-256 contract')
  }
  return true
}

export function normalizeAdvisorPayload(payload) {
  const root = assertRecord(payload, 'advisor payload')
  if (!Array.isArray(root.results)) fail('advisor payload must contain a results array')

  const normalized = root.results.map((raw, index) => {
    const row = assertRecord(raw, `advisor results[${index}]`)
    const cacheKey = assertString(row.cache_key, `advisor results[${index}].cache_key`)
    const rule = assertString(row.name, `advisor results[${index}].name`)
    if (!ALLOWED_RULES.has(rule)) fail(`advisor returned an unreviewed rule: ${rule}`)
    const level = assertString(row.level, `advisor results[${index}].level`).toUpperCase()
    if (!ALLOWED_LEVELS.has(level)) fail(`advisor results[${index}].level is invalid`)
    const metadata = assertRecord(row.metadata, `advisor results[${index}].metadata`)
    const remediationUrl = assertOfficialRemediationUrl(
      row.remediation,
      `advisor results[${index}].remediation`,
    )
    let object
    let evidence

    if (rule === 'authenticated_security_definer_function_executable') {
      object = {
        kind: 'function',
        schema: assertString(metadata.schema, `advisor results[${index}].metadata.schema`),
        name: assertString(metadata.name, `advisor results[${index}].metadata.name`),
        identity_arguments: assertString(
          metadata.arguments,
          `advisor results[${index}].metadata.arguments`,
          { allowEmpty: true },
        ),
        language: assertString(metadata.language, `advisor results[${index}].metadata.language`),
        security_definer: metadata.security_definer,
      }
      if (object.security_definer !== true) fail(`advisor results[${index}] is not SECURITY DEFINER`)
    } else if (rule === 'rls_enabled_no_policy') {
      if (metadata.type !== 'table') fail(`advisor results[${index}] is not a table`)
      object = {
        kind: 'table',
        schema: assertString(metadata.schema, `advisor results[${index}].metadata.schema`),
        name: assertString(metadata.name, `advisor results[${index}].metadata.name`),
      }
    } else {
      if (metadata.type !== 'auth' || metadata.entity !== 'Auth') {
        fail(`advisor results[${index}] is not the reviewed Auth setting`)
      }
      object = { kind: 'auth_setting', entity: 'Auth', name: 'leaked_password_protection' }
      evidence = { kind: 'advisor_only', advisor_assertion: 'auth_leaked_password_protection' }
    }

    return {
      cache_key: cacheKey,
      rule,
      level,
      object,
      evidence,
      remediation_url: remediationUrl,
    }
  }).sort((left, right) => compareText(left.cache_key, right.cache_key))

  const keys = normalized.map((entry) => entry.cache_key)
  if (new Set(keys).size !== keys.length) fail('advisor payload contains duplicate cache_key values')
  return normalized
}

export function normalizePermissionPayload(payload) {
  const root = assertRecord(payload, 'permission payload')
  if (!Array.isArray(root.rows)) fail('permission payload must contain a rows array')
  const normalized = root.rows.map((raw, index) => {
    const row = assertRecord(raw, `permission rows[${index}]`)
    assertExactKeys(row, PERMISSION_ROW_FIELDS, `permission rows[${index}]`)
    const kind = assertString(row.object_kind, `permission rows[${index}].object_kind`)
    if (kind === 'function') {
      const object = {
        kind: 'function',
        schema: assertString(row.schema_name, `permission rows[${index}].schema_name`),
        name: assertString(row.object_name, `permission rows[${index}].object_name`),
        identity_arguments: assertString(
          row.identity_arguments,
          `permission rows[${index}].identity_arguments`,
          { allowEmpty: true },
        ),
        language: assertString(row.language, `permission rows[${index}].language`),
        security_definer: assertBoolean(
          row.security_definer,
          `permission rows[${index}].security_definer`,
        ),
      }
      return {
        lookup_key: functionLookupKey(object),
        object,
        evidence: {
          kind: 'function_execute',
          anon_execute: assertBoolean(row.anon_execute, `permission rows[${index}].anon_execute`),
          authenticated_execute: assertBoolean(
            row.authenticated_execute,
            `permission rows[${index}].authenticated_execute`,
          ),
          service_role_execute: assertBoolean(
            row.service_role_execute,
            `permission rows[${index}].service_role_execute`,
          ),
        },
      }
    }
    if (kind === 'table') {
      const object = {
        kind: 'table',
        schema: assertString(row.schema_name, `permission rows[${index}].schema_name`),
        name: assertString(row.object_name, `permission rows[${index}].object_name`),
      }
      return {
        lookup_key: tableLookupKey(object),
        object,
        evidence: {
          kind: 'table_access',
          rls_enabled: assertBoolean(row.rls_enabled, `permission rows[${index}].rls_enabled`),
          rls_forced: assertBoolean(row.rls_forced, `permission rows[${index}].rls_forced`),
          policy_count: assertInteger(row.policy_count, `permission rows[${index}].policy_count`),
          anon: rolePermissionsFromRow(row, 'anon', `permission rows[${index}]`),
          authenticated: rolePermissionsFromRow(row, 'authenticated', `permission rows[${index}]`),
          service_role: rolePermissionsFromRow(row, 'service_role', `permission rows[${index}]`),
        },
      }
    }
    fail(`permission rows[${index}].object_kind is unsupported`)
  }).sort((left, right) => compareText(left.lookup_key, right.lookup_key))

  const keys = normalized.map((entry) => entry.lookup_key)
  if (new Set(keys).size !== keys.length) fail('permission payload contains duplicate objects')
  return normalized
}

export function buildObservedEntries(advisorEntries, permissionEntries) {
  const permissions = new Map(permissionEntries.map((entry) => [entry.lookup_key, entry]))
  const consumed = new Set()
  const observed = advisorEntries.map((entry) => {
    if (entry.object.kind === 'auth_setting') return entry
    const lookupKey = entry.object.kind === 'function'
      ? functionLookupKey(entry.object)
      : tableLookupKey(entry.object)
    const permission = permissions.get(lookupKey)
    if (!permission) fail(`permission evidence is missing for ${entry.cache_key}`)
    consumed.add(lookupKey)
    if (JSON.stringify(permission.object) !== JSON.stringify(entry.object)) {
      fail(`advisor and permission metadata differ for ${entry.cache_key}`)
    }
    return { ...entry, evidence: permission.evidence }
  })

  const unconsumed = [...permissions.keys()].filter((key) => !consumed.has(key))
  if (unconsumed.length > 0) fail('permission query returned objects absent from the advisor result')
  return observed.sort((left, right) => compareText(left.cache_key, right.cache_key))
}

function technicalProjection(entry) {
  return {
    cache_key: entry.cache_key,
    rule: entry.rule,
    level: entry.level,
    object: entry.object,
    evidence: entry.evidence,
  }
}

export function compareObservedWithBaseline(baseline, observedEntries) {
  if (observedEntries.length !== baseline.expected_count) {
    fail(`${baseline.environment} hosted advisor count changed`)
  }
  const expected = new Map(baseline.entries.map((entry) => [entry.cache_key, technicalProjection(entry)]))
  const actual = new Map(observedEntries.map((entry) => [entry.cache_key, technicalProjection(entry)]))
  const missing = [...expected.keys()].filter((key) => !actual.has(key))
  const unexpected = [...actual.keys()].filter((key) => !expected.has(key))
  const changed = [...expected.keys()].filter(
    (key) => actual.has(key) && JSON.stringify(expected.get(key)) !== JSON.stringify(actual.get(key)),
  )
  if (missing.length || unexpected.length || changed.length) {
    const summary = [
      missing.length ? `missing=${missing.length}` : '',
      unexpected.length ? `unexpected=${unexpected.length}` : '',
      changed.length ? `changed=${changed.length}` : '',
    ].filter(Boolean).join(', ')
    fail(`${baseline.environment} hosted advisor differs from the reviewed baseline (${summary})`)
  }
}

export function assertHostedEnvironment(environment, env = process.env) {
  if (!BASELINE_ENVIRONMENTS.includes(environment)) fail('hosted mode requires staging or production')
  const accessToken = env.SUPABASE_ACCESS_TOKEN
  const projectRef = env.SUPABASE_PROJECT_REF
  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
    fail('hosted advisor check requires the environment-scoped SUPABASE_ACCESS_TOKEN secret')
  }
  if (typeof projectRef !== 'string' || !PROJECT_REF_PATTERN.test(projectRef)) {
    fail('hosted advisor check requires a valid environment-scoped SUPABASE_PROJECT_REF variable')
  }
  return { accessToken, projectRef }
}

function parseStrictJson(text, label) {
  if (typeof text !== 'string' || text.trim().length === 0) fail(`${label} returned no JSON`)
  try {
    return JSON.parse(text)
  } catch {
    fail(`${label} returned invalid JSON`)
  }
}

function runSupabaseJson(args, label, env) {
  const result = spawnSync('supabase', args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    fail(`${label} failed closed before producing a reviewed result`)
  }
  return parseStrictJson(result.stdout, label)
}

export function runHostedCheck(environment, env = process.env) {
  const { projectRef } = assertHostedEnvironment(environment, env)
  validatePermissionQuery()
  const baseline = loadBaseline(environment)
  const advisorPayload = runSupabaseJson(
    [
      'db', 'advisors',
      '--project-ref', projectRef,
      '--type', 'security',
      '--level', 'info',
      '--fail-on', 'none',
      '--output-format', 'json',
      '--agent', 'yes',
    ],
    'Supabase hosted Security Advisor',
    env,
  )
  const permissionPayload = runSupabaseJson(
    [
      'db', 'query',
      '--project-ref', projectRef,
      '--file', permissionQueryPath,
      '--output-format', 'json',
      '--agent', 'yes',
    ],
    'Supabase hosted permission query',
    env,
  )
  const advisors = normalizeAdvisorPayload(advisorPayload)
  const permissions = normalizePermissionPayload(permissionPayload)
  const observed = buildObservedEntries(advisors, permissions)
  compareObservedWithBaseline(baseline, observed)
  return { environment, findings: observed.length }
}

export function runStaticCheck(options) {
  validatePermissionQuery()
  return BASELINE_ENVIRONMENTS.map((environment) => {
    const baseline = loadBaseline(environment, options)
    return { environment, findings: baseline.entries.length }
  })
}

function readArgument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function main() {
  const mode = process.argv[2] || 'static'
  if (mode === 'static') {
    const results = runStaticCheck()
    console.log(`Supabase advisor baselines verified (${results.map((row) => `${row.environment}=${row.findings}`).join(', ')}).`)
    return
  }
  if (mode === 'hosted') {
    const environment = readArgument('--environment') || process.env.ADVISOR_ENVIRONMENT
    const result = runHostedCheck(environment)
    console.log(`Supabase hosted advisor contract verified for ${result.environment} (${result.findings} findings).`)
    return
  }
  fail('usage: verify-supabase-security-advisors.mjs [static|hosted --environment staging|production]')
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  try {
    main()
  } catch (error) {
    const message = error instanceof AdvisorContractError
      ? error.message
      : 'Supabase advisor verification failed unexpectedly'
    console.error(message)
    process.exitCode = 1
  }
}
