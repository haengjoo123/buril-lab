import { describe, expect, it } from 'vitest'
import { CABINET_RELEASE_BASE_SHA, CABINET_RELEASE_PATHS, verifyCabinetChangedPaths, verifyCabinetPolicy, verifyCabinetRelease } from './verify-cabinet-release.mjs'
import { filterOps11GeneratedUntrackedPaths } from './verify-ops11-deletion-worker-preparation.mjs'

describe('reviewed cabinet successor release', () => {
  it('verifies the complete current candidate while retaining hosted gates', () => {
    expect(verifyCabinetRelease()).toMatchObject({ result: 'cabinet-release-candidate-ok',
      baseSha: CABINET_RELEASE_BASE_SHA, activeMigrations: 12, activePgTapTests: 11,
      hostedAcceptance: false, productionReady: false, ops12Included: false,
      deletionRuntimeDefaultEnabled: false })
    expect(new Set(CABINET_RELEASE_PATHS).size).toBe(CABINET_RELEASE_PATHS.length)
  })
  it.each(['../escape.ts', 'src\\escape.ts', '/src/x.ts', 'docs/operations/../escape.md', 'scripts/apply-ops12-cleanup.mjs', 'functions/api/ai/_openai.ts', 'wrangler.jsonc', '6. 버릴랩/기획.md', 'package.json'])(
    'rejects paths outside the reviewed successor scope: %s', candidate => {
      expect(() => verifyCabinetChangedPaths([candidate])).toThrow()
    })
  it('preserves exact Korean names when checking unreviewed paths', () => {
    expect(() => verifyCabinetChangedPaths(['6. 버릴랩/기획.md'])).toThrow('unreviewed path: 6. 버릴랩/기획.md')
  })
  it('excludes only the exact untracked Gitleaks report, and rejects committed reports', () => {
    expect(filterOps11GeneratedUntrackedPaths(['results.sarif', 'nested/results.sarif', 'src/new.ts']))
      .toEqual(['nested/results.sarif', 'src/new.ts'])
    expect(() => verifyCabinetChangedPaths(['results.sarif'])).toThrow(/unreviewed path/)
  })
  it('rejects removal of Quality, Staging, backup, database, and scheduler gates', () => {
    const policy = verifyCabinetRelease().policy
    for (const key of ['requiresSameShaQuality', 'requiresSameShaStaging', 'requiresFreshProductionBackup', 'requiresHostedDatabaseAcceptance', 'requiresDeletionSchedulerAcceptance']) {
      expect(() => verifyCabinetPolicy({ ...policy, [key]: false })).toThrow(/reviewed cabinet contract/)
    }
    expect(() => verifyCabinetPolicy({ ...policy, ops12Included: true })).toThrow()
    expect(() => verifyCabinetPolicy({ ...policy, baseSha: '0'.repeat(40) })).toThrow()
  })
})
