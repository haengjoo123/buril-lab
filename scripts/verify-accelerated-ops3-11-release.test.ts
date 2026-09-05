import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ACCELERATED_RELEASE_POLICY,
  verifyAcceleratedOps311Release,
  verifyAcceleratedPolicySources,
  verifyNoOps12Paths,
} from './verify-accelerated-ops3-11-release.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

describe('accelerated Ops3-11 release boundary', () => {
  it('keeps destructive and hosted activation boundaries closed', () => {
    expect(verifyAcceleratedOps311Release(root)).toMatchObject({
      result: 'accelerated-ops3-11-candidate-ok',
      activeMigrations: 9,
      activePgTapTests: 8,
      deletionUiEnabled: true,
      deletionRuntimeDefaultEnabled: false,
      storageBackupPointerMode: 'private_path',
      ops12Included: false,
      candidateReady: true,
      productionReady: false,
      hostedAcceptance: false,
      requiresFreshProductionBackup: true,
      requiresSameShaStaging: true,
      requiresThreeDeletionSchedulerSuccesses: true,
    })
  })

  it('rejects an Ops12 file in this release slice', () => {
    expect(() => verifyNoOps12Paths(['scripts/apply-ops12-cleanup.mjs'])).toThrow(/Ops12/)
    expect(verifyNoOps12Paths(['scripts/verify-ops11.mjs'])).toBe(true)
  })

  it('requires the policy to retain the deletion and hosted safety boundaries', () => {
    const policy = read(ACCELERATED_RELEASE_POLICY)
    const rollout = read('docs/operations/operations-safety-rollout.md')
    expect(verifyAcceleratedPolicySources({ policy, rollout })).toEqual({
      policyMode: 'accelerated-risk-based',
      ops12Included: false,
    })
    expect(() => verifyAcceleratedPolicySources({
      policy: policy.replaceAll('initialDeletionUi: false', 'initialDeletionUi: true'),
      rollout,
    })).toThrow(/initialDeletionUi/)
    expect(() => verifyAcceleratedPolicySources({
      policy: policy.replace('deletionRuntimeActivation: post-same-sha-staging-and-production', ''),
      rollout,
    })).toThrow(/deletionRuntimeActivation/)
  })
})
