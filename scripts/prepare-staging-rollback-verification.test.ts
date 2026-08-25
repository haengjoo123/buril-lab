import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildStagingRollbackVerification,
  prepareStagingRollbackVerification,
  STAGING_ROLLBACK_CUSTOM_ORIGIN,
} from './prepare-staging-rollback-verification.mjs'

const sourceSha = '5c7e385cceb62171ce9614410f14a716eeecbc85'
const targetSha = '7b661b25771e6ea84ccc4c1c4547a9caf5323d52'
const targetDeploymentId = '2f1af91b-4269-4964-b983-b6a4100dd8b2'

function validInput(overrides: Record<string, string> = {}) {
  return {
    eventName: 'workflow_dispatch',
    repository: 'haengjoo123/buril-lab',
    ref: 'refs/heads/main',
    runAttempt: '1',
    sourceCommitSha: sourceSha,
    targetCommitSha: targetSha,
    targetDeploymentId,
    confirmation: `VERIFY ROLLBACK buril-lab-staging ${targetDeploymentId} ${targetSha}`,
    ...overrides,
  }
}

describe('prepare Staging rollback verification', () => {
  const temporaryPaths: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  it('binds the custom and immutable Gate 0 confirmations to one exact Staging target', () => {
    expect(buildStagingRollbackVerification(validInput())).toEqual({
      sourceSha,
      targetCommitSha: targetSha,
      targetDeploymentId,
      targetImmutableOrigin: 'https://2f1af91b.buril-lab-staging.pages.dev',
      customGate0Confirmation: `RUN GATE0 buril-lab-staging ${targetDeploymentId} ${targetSha} ${STAGING_ROLLBACK_CUSTOM_ORIGIN}`,
      immutableGate0Confirmation: `RUN GATE0 buril-lab-staging ${targetDeploymentId} ${targetSha} https://2f1af91b.buril-lab-staging.pages.dev`,
    })
  })

  it.each([
    ['non-main source', { ref: 'refs/heads/codex/test' }],
    ['retry', { runAttempt: '2' }],
    ['wrong project confirmation', { confirmation: `VERIFY ROLLBACK buril-lab ${targetDeploymentId} ${targetSha}` }],
    ['mixed-case target SHA', { targetCommitSha: targetSha.toUpperCase() }],
    ['malformed deployment UUID', { targetDeploymentId: '2f1af91b-4269-4964-b983-b6a4100dd8b2-x' }],
  ])('fails closed for %s', (_name, overrides) => {
    expect(() => buildStagingRollbackVerification(validInput(overrides))).toThrow()
  })

  it('writes only validated target fields to the GitHub output file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'burillab-rollback-'))
    temporaryPaths.push(directory)
    const outputPath = join(directory, 'github-output')
    const result = await prepareStagingRollbackVerification({
      environment: {
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REPOSITORY: 'haengjoo123/buril-lab',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_SHA: sourceSha,
        ROLLBACK_TARGET_COMMIT_SHA: targetSha,
        ROLLBACK_TARGET_DEPLOYMENT_ID: targetDeploymentId,
        ROLLBACK_CONFIRMATION: `VERIFY ROLLBACK buril-lab-staging ${targetDeploymentId} ${targetSha}`,
      },
      outputPath,
    })

    expect(result.targetImmutableOrigin).toBe('https://2f1af91b.buril-lab-staging.pages.dev')
    await expect(readFile(outputPath, 'utf8')).resolves.toBe([
      `source_sha=${sourceSha}`,
      `target_commit_sha=${targetSha}`,
      `target_deployment_id=${targetDeploymentId}`,
      'target_immutable_origin=https://2f1af91b.buril-lab-staging.pages.dev',
      `custom_gate0_confirmation=RUN GATE0 buril-lab-staging ${targetDeploymentId} ${targetSha} ${STAGING_ROLLBACK_CUSTOM_ORIGIN}`,
      `immutable_gate0_confirmation=RUN GATE0 buril-lab-staging ${targetDeploymentId} ${targetSha} https://2f1af91b.buril-lab-staging.pages.dev`,
      '',
    ].join('\n'))
  })
})
