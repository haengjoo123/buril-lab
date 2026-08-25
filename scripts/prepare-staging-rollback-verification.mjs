import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const STAGING_ROLLBACK_PROJECT = 'buril-lab-staging'
export const STAGING_ROLLBACK_CUSTOM_ORIGIN = 'https://staging.burillab.com'
export const STAGING_ROLLBACK_PAGES_APEX = 'buril-lab-staging.pages.dev'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const DEPLOYMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function requiredString(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function requireFullSha(value, name) {
  const normalized = requiredString(value, name)
  if (!FULL_SHA_PATTERN.test(normalized)) {
    throw new Error(`${name} must be a lowercase, full 40-character Git SHA.`)
  }
  return normalized
}

function requireDeploymentId(value) {
  const normalized = requiredString(value, 'ROLLBACK_TARGET_DEPLOYMENT_ID')
  if (!DEPLOYMENT_ID_PATTERN.test(normalized)) {
    throw new Error('ROLLBACK_TARGET_DEPLOYMENT_ID must be a lowercase Pages deployment UUID.')
  }
  return normalized
}

export function buildStagingRollbackVerification({
  eventName,
  repository,
  ref,
  runAttempt,
  sourceCommitSha,
  targetCommitSha,
  targetDeploymentId,
  confirmation,
}) {
  if (eventName !== 'workflow_dispatch' || repository !== 'haengjoo123/buril-lab' || ref !== 'refs/heads/main') {
    throw new Error('Staging rollback verification must be dispatched from protected main in the canonical repository.')
  }
  if (runAttempt !== '1') {
    throw new Error('Staging rollback verification retries are forbidden; dispatch a new verification instead.')
  }

  const sourceSha = requireFullSha(sourceCommitSha, 'GITHUB_SHA')
  const commitSha = requireFullSha(targetCommitSha, 'ROLLBACK_TARGET_COMMIT_SHA')
  const deploymentId = requireDeploymentId(targetDeploymentId)
  const expectedConfirmation = `VERIFY ROLLBACK ${STAGING_ROLLBACK_PROJECT} ${deploymentId} ${commitSha}`
  if (confirmation !== expectedConfirmation) {
    throw new Error('ROLLBACK_CONFIRMATION does not acknowledge the exact Staging project, deployment, and commit.')
  }

  const immutableOrigin = `https://${deploymentId.slice(0, 8)}.${STAGING_ROLLBACK_PAGES_APEX}`
  return Object.freeze({
    sourceSha,
    targetCommitSha: commitSha,
    targetDeploymentId: deploymentId,
    targetImmutableOrigin: immutableOrigin,
    customGate0Confirmation: `RUN GATE0 ${STAGING_ROLLBACK_PROJECT} ${deploymentId} ${commitSha} ${STAGING_ROLLBACK_CUSTOM_ORIGIN}`,
    immutableGate0Confirmation: `RUN GATE0 ${STAGING_ROLLBACK_PROJECT} ${deploymentId} ${commitSha} ${immutableOrigin}`,
  })
}

export async function prepareStagingRollbackVerification({
  environment = process.env,
  outputPath = environment.GITHUB_OUTPUT,
} = {}) {
  const result = buildStagingRollbackVerification({
    eventName: environment.GITHUB_EVENT_NAME,
    repository: environment.GITHUB_REPOSITORY,
    ref: environment.GITHUB_REF,
    runAttempt: environment.GITHUB_RUN_ATTEMPT,
    sourceCommitSha: environment.GITHUB_SHA,
    targetCommitSha: environment.ROLLBACK_TARGET_COMMIT_SHA,
    targetDeploymentId: environment.ROLLBACK_TARGET_DEPLOYMENT_ID,
    confirmation: environment.ROLLBACK_CONFIRMATION,
  })

  if (outputPath) {
    await appendFile(outputPath, [
      `source_sha=${result.sourceSha}`,
      `target_commit_sha=${result.targetCommitSha}`,
      `target_deployment_id=${result.targetDeploymentId}`,
      `target_immutable_origin=${result.targetImmutableOrigin}`,
      `custom_gate0_confirmation=${result.customGate0Confirmation}`,
      `immutable_gate0_confirmation=${result.immutableGate0Confirmation}`,
      '',
    ].join('\n'), 'utf8')
  }
  return result
}

async function main() {
  const result = await prepareStagingRollbackVerification()
  console.log(`Prepared Staging rollback verification for ${result.targetDeploymentId} at ${result.targetImmutableOrigin}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Staging rollback verification preparation failed.')
    process.exitCode = 1
  })
}
