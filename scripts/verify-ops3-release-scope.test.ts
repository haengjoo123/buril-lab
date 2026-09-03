import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OPS3_APPROVED_PATHS, OPS3_BASE_SHA, verifyOps3ChangedPaths,
  verifyOps3ReleaseScope, verifyRedirectOnlyVoiceSource,
} from './verify-ops3-release-scope.mjs'

const repoRoot = resolve(import.meta.dirname, '..')

describe('Ops3 release-scope boundary', () => {
  it('pins an exact pre-Ops3 main commit and a duplicate-free reviewed path set', () => {
    expect(OPS3_BASE_SHA).toMatch(/^[0-9a-f]{40}$/)
    expect(new Set(OPS3_APPROVED_PATHS).size).toBe(OPS3_APPROVED_PATHS.length)
    expect([...OPS3_APPROVED_PATHS]).toEqual([...OPS3_APPROVED_PATHS].sort())
    expect(verifyOps3ChangedPaths([...OPS3_APPROVED_PATHS])).toBe(OPS3_APPROVED_PATHS.length)
  })

  it.each([
    'functions/api/labs/join.ts',
    'functions/api/maintenance/delete.ts',
    'src/features/ops/roles.ts',
    'supabase/migrations/20260903000000_expand.sql',
    'workers/deletion-scheduler/index.ts',
    'package-lock.json',
    '.github/workflows/deploy-production.yml',
  ])('rejects a later-gate or dependency path: %s', (file) => {
    expect(() => verifyOps3ChangedPaths([file])).toThrow(/unreviewed path/)
  })

  it.each(['docs/operations/../../src/unsafe.ts', 'docs/operations/./note.md', '/functions/api/new.ts', 'functions\\api\\new.ts'])(
    'rejects non-canonical paths: %s', (file) => {
      expect(() => verifyOps3ChangedPaths([file])).toThrow(/malformed/)
    },
  )

  it.each(['guidedDisposal', 'update_waste_batch_draft', 'draftPatch', 'decisionStatus', 'componentCandidates'])(
    'rejects guided voice state: %s', (token) => {
      expect(() => verifyRedirectOnlyVoiceSource({ voice: `open_waste_batch_review ${token}` })).toThrow(/guided voice/)
    },
  )

  it('requires the screen-review redirect action', () => {
    expect(() => verifyRedirectOnlyVoiceSource({ voice: 'location expiration remaining' })).toThrow(/redirect action/)
  })

  it('verifies this working tree against the fixed database and voice safety contracts', () => {
    const hasSuccessorGate = readFileSync(resolve(repoRoot, 'package.json'), 'utf8').includes('"ops6:verify"')
    if (hasSuccessorGate) {
      expect(() => verifyOps3ReleaseScope()).toThrow(/unreviewed path/)
      return
    }
    expect(verifyOps3ReleaseScope()).toMatchObject({
      baseSha: OPS3_BASE_SHA,
      activeMigrations: 1,
      voiceMode: 'redirect',
      result: 'ops3-release-scope-ok',
    })
  })
})
