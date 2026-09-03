import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BASELINE_FILE,
  EXPECTED_CI_MARKER,
  EXPECTED_LOCAL_ONLY_WITHOUT_SQL,
  EXPECTED_REMOTE_HISTORY_SHA256,
  EXPECTED_SNAPSHOT_SHA256,
  verifyBaselineSql,
  verifyDatabaseReleaseSafety,
  verifySnapshot,
} from './verify-database-release-safety.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const baseline = readFileSync(resolve(repoRoot, 'supabase/migrations', BASELINE_FILE), 'utf8')
const snapshot = JSON.parse(readFileSync(
  resolve(repoRoot, 'supabase/legacy_migrations/application-history-before-baseline.json'),
  'utf8',
))
const archivedVersions = snapshot.migrations
  .map((row: { local?: string }) => row.local || '')
  .filter((version: string) => version && !EXPECTED_LOCAL_ONLY_WITHOUT_SQL.includes(version))

describe('database release safety manifest through Ops6', () => {
  it('locks the release to one baseline, three incrementals, and the reviewed production history', () => {
    expect(verifyDatabaseReleaseSafety()).toEqual({
      activeMigrations: 4,
      legacySqlFiles: 50,
      activePgTapTests: 3,
      legacySqlTests: 8,
      baseline: {
        publicTables: 49,
        explicitRoleGrants: {
          anon: 25,
          authenticated: 32,
          service_role: 49,
        },
        securityDefinerFunctions: 54,
      },
      evidence: {
        rows: 118,
        remoteVersions: 89,
        localEvidenceVersions: 51,
        localOnlyWithoutSql: EXPECTED_LOCAL_ONLY_WITHOUT_SQL,
      },
    })
    expect(EXPECTED_REMOTE_HISTORY_SHA256).toHaveLength(64)
    expect(EXPECTED_SNAPSHOT_SHA256).toHaveLength(64)
  })

  it('rejects any change to the reviewed baseline SQL', () => {
    expect(() => verifyBaselineSql(
      baseline.replace('ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;', ''),
    )).toThrow('baseline SQL content changed')
  })

  it('rejects migration evidence that differs from the immutable snapshot', () => {
    const modified = structuredClone(snapshot)
    modified.migrations[0].remote = '20000101000000'
    expect(() => verifySnapshot(modified, archivedVersions)).toThrow('snapshot hash changed')
  })

  it('documents the single historical local marker whose SQL was never in Git', () => {
    expect(EXPECTED_LOCAL_ONLY_WITHOUT_SQL).toEqual(['20260823163832'])
  })

  it('keeps the exact CI opt-in marker and all active pgTAP permission tests', () => {
    expect(readFileSync(resolve(repoRoot, 'supabase/ci-quality.json'), 'utf8').trim()).toBe(EXPECTED_CI_MARKER)
    for (const name of [
      'baseline_permissions.sql',
      'ops5_expand_permissions.sql',
      'ops6_private_photos_permissions.sql',
    ]) {
      const permissionTest = readFileSync(resolve(repoRoot, 'supabase/tests', name), 'utf8')
      expect(permissionTest).toContain('create extension if not exists pgtap with schema extensions;')
      expect(permissionTest).toMatch(/select plan\(\d+\);/)
      expect(permissionTest).toContain('select * from finish();')
      expect(permissionTest).not.toMatch(/\bdo\s+\$\$/i)
    }
  })
})
