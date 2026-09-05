import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertHostedEnvironment,
  buildObservedEntries,
  compareObservedWithBaseline,
  loadBaseline,
  normalizeAdvisorPayload,
  normalizePermissionPayload,
  runStaticCheck,
  validateBaseline,
  validatePermissionQuery,
} from './verify-supabase-security-advisors.mjs'

const fixtureDirectory = resolve(import.meta.dirname, 'fixtures/security-advisors')
const advisorFixture = JSON.parse(readFileSync(resolve(fixtureDirectory, 'advisors-cli.json'), 'utf8'))
const permissionFixture = JSON.parse(readFileSync(resolve(fixtureDirectory, 'permissions-cli.json'), 'utf8'))
const permissionQuery = readFileSync(
  resolve(import.meta.dirname, 'supabase-security-advisor-permissions.sql'),
  'utf8',
)
const baselineSchema = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../supabase/security-advisors/schema.json'),
  'utf8',
))

function fixtureObserved() {
  return buildObservedEntries(
    normalizeAdvisorPayload(structuredClone(advisorFixture)),
    normalizePermissionPayload(structuredClone(permissionFixture)),
  )
}

describe('Supabase hosted Security Advisor contract', () => {
  it('publishes the strict versioned baseline schema without extensible fields', () => {
    expect(baselineSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://burillab.com/schemas/supabase-security-advisor-baseline.schema.json',
      required: expect.arrayContaining(['observed_on']),
      additionalProperties: false,
      properties: {
        advisor_cli_version: { const: '2.115.0' },
      },
    })
    expect(baselineSchema.required).not.toContain('observed_at')
    expect(baselineSchema.$defs.role_table_permissions.required).toEqual([
      'schema_usage',
      'bypass_rls',
      'select',
      'insert',
      'update',
      'delete',
    ])
    expect(baselineSchema.$defs.entry.allOf[1]).toMatchObject({
      if: {
        properties: {
          rule: {
            enum: [
              'auth_leaked_password_protection',
              'authenticated_security_definer_function_executable',
            ],
          },
        },
      },
      then: {
        properties: {
          disposition: { const: 'temporary_open' },
        },
      },
    })
    expect(baselineSchema.$defs.entry.additionalProperties).toBe(false)
  })

  it('keeps the hosted catalog evidence query read-only and free of function bodies', () => {
    expect(validatePermissionQuery(permissionQuery)).toBe(true)
    expect(() => validatePermissionQuery(`${permissionQuery}\ndelete from public.inventory;`))
      .toThrow('mutating SQL')
    expect(() => validatePermissionQuery(permissionQuery.replace(
      'pg_catalog.pg_get_function_identity_arguments',
      'pg_catalog.pg_get_functiondef',
    ))).toThrow('function bodies')
    expect(() => validatePermissionQuery(permissionQuery.replace(
      'procedure.prosecdef as security_definer',
      '(select pg_catalog.pg_sleep(1) is null) as security_definer',
    ))).toThrow('reviewed SHA-256 contract')
  })

  it('normalizes strict CLI fixtures without retaining raw descriptions', () => {
    const observed = fixtureObserved()
    expect(observed).toHaveLength(3)
    expect(observed.map((entry) => entry.cache_key)).toEqual([
      'auth_leaked_password_protection',
      'authenticated_security_definer_function_executable_public_reviewed_rpc_target_id uuid',
      'rls_enabled_no_policy_public_server_receipts',
    ])
    expect(observed[1]).toMatchObject({
      object: {
        kind: 'function',
        schema: 'public',
        name: 'reviewed_rpc',
        identity_arguments: 'target_id uuid',
        language: 'plpgsql',
      },
      evidence: {
        anon_execute: false,
        authenticated_execute: true,
        service_role_execute: true,
      },
    })
    expect(observed[2].evidence).toMatchObject({
      anon: { bypass_rls: false },
      authenticated: { bypass_rls: false },
      service_role: { bypass_rls: true },
    })
    expect(JSON.stringify(observed)).not.toContain('description')
    expect(JSON.stringify(observed)).not.toContain('detail')
  })

  it('accepts the pinned CLI camelCase cacheKey shape and uses catalog metadata as authority', () => {
    const currentCliFixture = structuredClone(advisorFixture)
    for (const finding of currentCliFixture.results) {
      finding.cacheKey = finding.cache_key
      delete finding.cache_key
      if (finding.name === 'authenticated_security_definer_function_executable') {
        delete finding.metadata.arguments
        delete finding.metadata.language
        delete finding.metadata.security_definer
      }
    }

    const observed = buildObservedEntries(
      normalizeAdvisorPayload(currentCliFixture),
      normalizePermissionPayload(structuredClone(permissionFixture)),
    )

    expect(observed[1].object).toMatchObject({
      identity_arguments: 'target_id uuid',
      language: 'plpgsql',
      security_definer: true,
    })
  })

  it('rejects malformed output, duplicate findings, and unpaired permission evidence', () => {
    expect(() => normalizeAdvisorPayload({ lints: [] })).toThrow('results array')

    const duplicate = structuredClone(advisorFixture)
    duplicate.results.push(structuredClone(duplicate.results[0]))
    expect(() => normalizeAdvisorPayload(duplicate)).toThrow('duplicate cache_key')

    const conflictingCacheFields = structuredClone(advisorFixture)
    conflictingCacheFields.results[0].cacheKey = 'different_cache_key'
    expect(() => normalizeAdvisorPayload(conflictingCacheFields))
      .toThrow('conflicting cache-key fields')

    const extraPermission = structuredClone(permissionFixture)
    extraPermission.rows.push({
      ...structuredClone(extraPermission.rows[0]),
      object_name: 'unexpected_rpc',
    })
    expect(() => buildObservedEntries(
      normalizeAdvisorPayload(structuredClone(advisorFixture)),
      normalizePermissionPayload(extraPermission),
    )).toThrow('objects absent from the advisor result')

    const unexpectedColumn = structuredClone(permissionFixture)
    unexpectedColumn.rows[0].unexpected_column = true
    expect(() => normalizePermissionPayload(unexpectedColumn))
      .toThrow('unexpected or missing fields')
  })

  it('detects metadata and permission drift even when cache_key is unchanged', () => {
    const observed = fixtureObserved()
    const baseline = {
      schema_version: 1,
      environment: 'fixture',
      advisor_cli_version: '2.115.0',
      expected_count: 3,
      observed_on: '2026-08-24',
      entries: observed.map((entry) => ({
        ...entry,
        disposition: 'temporary_open',
        reason: 'Fixture finding remains open only for deterministic contract testing.',
        reviewed_by_role: 'test_security_owner',
        reviewed_at: '2026-08-24',
        expires_on: '2026-12-31',
        target_gate: 'fixture gate',
      })),
    }

    const languageDrift = structuredClone(observed)
    languageDrift[1].object.language = 'sql'
    expect(() => compareObservedWithBaseline(baseline, languageDrift)).toThrow('changed=1')

    const permissionDrift = structuredClone(observed)
    permissionDrift[2].evidence.authenticated.select = true
    expect(() => compareObservedWithBaseline(baseline, permissionDrift)).toThrow('changed=1')

    const bypassDrift = structuredClone(observed)
    bypassDrift[2].evidence.authenticated.bypass_rls = true
    expect(() => compareObservedWithBaseline(baseline, bypassDrift)).toThrow('changed=1')
  })

  it('fails closed when hosted environment credentials are absent or malformed', () => {
    expect(() => assertHostedEnvironment('staging', {})).toThrow('SUPABASE_ACCESS_TOKEN')
    expect(() => assertHostedEnvironment('staging', {
      SUPABASE_ACCESS_TOKEN: 'not-empty',
      SUPABASE_PROJECT_REF: 'invalid',
    })).toThrow('SUPABASE_PROJECT_REF')
    expect(assertHostedEnvironment('production', {
      SUPABASE_ACCESS_TOKEN: 'not-empty',
      SUPABASE_PROJECT_REF: 'zafxzidbtbryiksemlwc',
    })).toEqual({
      accessToken: 'not-empty',
      projectRef: 'zafxzidbtbryiksemlwc',
    })
  })

  it('fails closed when staging and production project refs are swapped', () => {
    expect(() => assertHostedEnvironment('staging', {
      SUPABASE_ACCESS_TOKEN: 'not-empty',
      SUPABASE_PROJECT_REF: 'zafxzidbtbryiksemlwc',
    })).toThrow('does not match the selected hosted advisor environment')
    expect(() => assertHostedEnvironment('production', {
      SUPABASE_ACCESS_TOKEN: 'not-empty',
      SUPABASE_PROJECT_REF: 'qpgnomuqdcucjmxrunnw',
    })).toThrow('does not match the selected hosted advisor environment')
  })

  it('rejects duplicate, unsorted, and expired committed entries', () => {
    const observed = fixtureObserved()
    const entries = observed.map((entry) => ({
      ...entry,
      disposition: 'temporary_open',
      reason: 'Fixture finding remains open only for deterministic contract testing.',
      reviewed_by_role: 'test_security_owner',
      reviewed_at: '2026-08-24',
      expires_on: '2026-12-31',
      target_gate: 'fixture gate',
    }))
    const baseline = {
      schema_version: 1,
      environment: 'production',
      advisor_cli_version: '2.115.0',
      expected_count: 60,
      observed_on: '2026-08-24',
      entries: Array.from({ length: 60 }, (_, index) => ({
        ...structuredClone(entries[index % entries.length]),
        cache_key: `${entries[index % entries.length].rule}_${String(index).padStart(3, '0')}`,
      })).sort((left, right) => left.cache_key < right.cache_key ? -1 : 1),
    }
    baseline.entries[1].cache_key = baseline.entries[0].cache_key
    expect(() => validateBaseline(baseline, 'production', { today: '2026-08-24' })).toThrow()

    baseline.entries = Array.from({ length: 60 }, (_, index) => ({
      ...structuredClone(entries[index % entries.length]),
      cache_key: `${entries[index % entries.length].rule}_${String(index).padStart(3, '0')}`,
    })).sort((left, right) => left.cache_key < right.cache_key ? -1 : 1)
    baseline.entries[0].expires_on = '2026-08-24'
    expect(() => validateBaseline(baseline, 'production', { today: '2026-08-24' })).toThrow('expired')
  })

  it('never accepts leaked-password or SECURITY DEFINER warnings as design decisions', () => {
    const production = loadBaseline('production', { today: '2026-08-24' })
    const leakedFixture = fixtureObserved().find(
      (entry) => entry.rule === 'auth_leaked_password_protection',
    )
    if (!leakedFixture) throw new Error('advisor fixture is missing the leaked-password finding')

    const leakedPasswordAccepted = structuredClone(production)
    leakedPasswordAccepted.entries[0] = {
      ...leakedFixture,
      disposition: 'accepted_design',
      reason: 'A leaked-password warning must never be accepted as a permanent design decision.',
      reviewed_by_role: 'test_security_owner',
      reviewed_at: '2026-08-24',
      expires_on: null,
      target_gate: null,
    }
    leakedPasswordAccepted.entries.sort((left, right) => left.cache_key < right.cache_key ? -1 : 1)
    expect(() => validateBaseline(leakedPasswordAccepted, 'production', { today: '2026-08-24' }))
      .toThrow('only a reviewed default-deny RLS finding may be accepted_design')

    const securityDefinerAccepted = structuredClone(production)
    const securityDefinerEntry = securityDefinerAccepted.entries.find(
      (entry) => entry.rule === 'authenticated_security_definer_function_executable',
    )
    if (!securityDefinerEntry) throw new Error('production fixture is missing a SECURITY DEFINER finding')
    securityDefinerEntry.disposition = 'accepted_design'
    securityDefinerEntry.expires_on = null
    securityDefinerEntry.target_gate = null
    expect(() => validateBaseline(securityDefinerAccepted, 'production', { today: '2026-08-24' }))
      .toThrow('only a reviewed default-deny RLS finding may be accepted_design')
  })

  it('validates the full public-safe production and staging baselines', () => {
    expect(runStaticCheck({ today: '2026-08-24' })).toEqual([
      { environment: 'production', findings: 60 },
      { environment: 'staging', findings: 60 },
    ])

    const production = loadBaseline('production', { today: '2026-08-24' })
    const staging = loadBaseline('staging', { today: '2026-08-24' })
    const productionKeys = new Set(production.entries.map((entry) => entry.cache_key))
    const stagingKeys = new Set(staging.entries.map((entry) => entry.cache_key))
    const technicalProjection = (entry: (typeof production.entries)[number]) => ({
      cache_key: entry.cache_key,
      rule: entry.rule,
      level: entry.level,
      object: entry.object,
      evidence: entry.evidence,
    })
    expect(staging.entries.filter((entry) => productionKeys.has(entry.cache_key)).map(technicalProjection))
      .toEqual(production.entries.map(technicalProjection))
    expect([...stagingKeys].filter((key) => !productionKeys.has(key))).toEqual([])
  })
})
