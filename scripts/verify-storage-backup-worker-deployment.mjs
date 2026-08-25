import { appendFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const STAGING_CLOUDFLARE_ACCOUNT_ID = '692fedd5b67a5fd545bb16038bbd4c85'
const STAGING_WORKER_NAME = 'buril-lab-storage-backup-staging'
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CONTROL_PLANE_JSON_BYTES = 1024 * 1024

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJson(raw, name) {
  if (
    typeof raw !== 'string'
    || raw.length === 0
    || Buffer.byteLength(raw, 'utf8') > MAX_CONTROL_PLANE_JSON_BYTES
  ) {
    throw new Error(`${name} is missing or too large.`)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`${name} is not valid JSON.`)
  }
}

function expectedMessage(commitSha) {
  return `quality-approved staging storage backup ${commitSha}`
}

function requireExactStagingWorker({ environment, accountId, workerName }) {
  if (
    environment !== 'staging'
    || accountId !== STAGING_CLOUDFLARE_ACCOUNT_ID
    || workerName !== STAGING_WORKER_NAME
  ) {
    throw new Error('Storage-backup verification is restricted to the exact Staging account and Worker.')
  }
}

function readApprovedSecretNames(secrets, { allowEmpty }) {
  if (!Array.isArray(secrets)) throw new Error('Wrangler secret list has an invalid shape.')
  const secretNames = secrets.map((secret) => {
    if (
      !isRecord(secret)
      || typeof secret.name !== 'string'
      || secret.type !== 'secret_text'
    ) {
      throw new Error('Wrangler secret list contains a malformed item.')
    }
    return secret.name
  })
  if (
    secretNames.length > 1
    || (!allowEmpty && secretNames.length !== 1)
    || (secretNames.length === 1 && secretNames[0] !== 'SUPABASE_SERVICE_ROLE_KEY')
  ) {
    throw new Error('The Staging backup Worker has an unapproved secret set.')
  }
  return secretNames
}

export function verifyStorageBackupWorkerSecretPreflight({
  responseRaw,
  httpStatus,
  environment,
  accountId,
  workerName,
}) {
  requireExactStagingWorker({ environment, accountId, workerName })
  if (httpStatus !== '200' && httpStatus !== '404') {
    throw new Error('The Staging backup Worker secret preflight returned an unexpected HTTP status.')
  }
  const response = parseJson(responseRaw, 'Cloudflare Worker secret preflight')
  if (!isRecord(response)) {
    throw new Error('Cloudflare Worker secret preflight has an invalid response shape.')
  }

  if (httpStatus === '200') {
    if (response.success !== true || !Array.isArray(response.result)) {
      throw new Error('Cloudflare Worker secret preflight did not return a successful secret list.')
    }
    const secretNames = readApprovedSecretNames(response.result, { allowEmpty: false })
    return { workerExists: true, approvedSecretCount: secretNames.length }
  }

  const errors = Array.isArray(response.errors) ? response.errors : []
  if (
    response.success !== false
    || errors.length === 0
    || errors.some((error) => !isRecord(error) || ![10007, 10090].includes(error.code))
  ) {
    throw new Error('Cloudflare did not prove that the Staging backup Worker is absent.')
  }
  return { workerExists: false, approvedSecretCount: 0 }
}

export function verifyStorageBackupWorkerDeployment({
  deploymentRaw,
  versionsRaw,
  secretsRaw,
  commitSha,
  environment,
  accountId,
  workerName,
}) {
  requireExactStagingWorker({ environment, accountId, workerName })
  if (typeof commitSha !== 'string' || !FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('Storage-backup deployment verification requires a lowercase full Git SHA.')
  }

  const deployment = parseJson(deploymentRaw, 'Wrangler deployment status')
  const versions = parseJson(versionsRaw, 'Wrangler version list')
  const secrets = parseJson(secretsRaw, 'Wrangler secret list')
  if (!isRecord(deployment) || !UUID_PATTERN.test(deployment.id)) {
    throw new Error('Wrangler deployment status has no valid deployment ID.')
  }
  if (!Array.isArray(deployment.versions) || deployment.versions.length !== 1) {
    throw new Error('The Staging backup Worker must have one active version only.')
  }
  const active = deployment.versions[0]
  if (
    !isRecord(active)
    || !UUID_PATTERN.test(active.version_id)
    || active.percentage !== 100
  ) {
    throw new Error('The Staging backup Worker active version must receive exactly 100 percent.')
  }
  const message = expectedMessage(commitSha)
  if (!isRecord(deployment.annotations) || deployment.annotations['workers/message'] !== message) {
    throw new Error('The active Worker deployment message does not match the approved commit.')
  }

  if (!Array.isArray(versions) || versions.length === 0 || versions.length > 10) {
    throw new Error('Wrangler version list has an invalid shape.')
  }
  const activeVersion = versions.find((version) => isRecord(version) && version.id === active.version_id)
  if (!activeVersion || !isRecord(activeVersion.annotations)) {
    throw new Error('The active Worker version is absent from the bounded version list.')
  }
  if (
    activeVersion.annotations['workers/tag'] !== commitSha
    || activeVersion.annotations['workers/message'] !== message
  ) {
    throw new Error('The active Worker version identity does not match the approved commit.')
  }

  readApprovedSecretNames(secrets, { allowEmpty: false })

  return {
    environment: 'staging',
    workerName: STAGING_WORKER_NAME,
    commitSha,
    deploymentId: deployment.id,
    versionId: active.version_id,
  }
}

export async function writeStorageBackupDeploymentOutputs(result, githubOutput) {
  if (githubOutput === undefined || githubOutput === '') return
  if (typeof githubOutput !== 'string' || !isAbsolute(githubOutput) || /[\r\n\0]/.test(githubOutput)) {
    throw new Error('GITHUB_OUTPUT must be an absolute file path.')
  }
  await appendFile(
    githubOutput,
    [
      `worker_name=${result.workerName}`,
      `deployment_id=${result.deploymentId}`,
      `version_id=${result.versionId}`,
      `commit_sha=${result.commitSha}`,
      '',
    ].join('\n'),
    'utf8',
  )
}

async function main() {
  const command = process.argv[2] || 'active'
  if (command === 'preflight') {
    const result = verifyStorageBackupWorkerSecretPreflight({
      responseRaw: process.env.STORAGE_BACKUP_SECRET_PREFLIGHT_JSON,
      httpStatus: process.env.STORAGE_BACKUP_SECRET_PREFLIGHT_STATUS,
      environment: process.env.DEPLOY_ENVIRONMENT,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      workerName: process.env.STORAGE_BACKUP_WORKER_NAME,
    })
    console.log(
      result.workerExists
        ? `Verified the existing Staging Worker secret allow-list (${result.approvedSecretCount}).`
        : 'Verified that the Staging backup Worker does not exist yet.',
    )
    return
  }
  if (command !== 'active') {
    throw new Error('Usage: verify-storage-backup-worker-deployment.mjs preflight|active')
  }
  const result = verifyStorageBackupWorkerDeployment({
    deploymentRaw: process.env.STORAGE_BACKUP_DEPLOYMENT_JSON,
    versionsRaw: process.env.STORAGE_BACKUP_VERSIONS_JSON,
    secretsRaw: process.env.STORAGE_BACKUP_SECRETS_JSON,
    commitSha: process.env.DEPLOY_COMMIT_SHA,
    environment: process.env.DEPLOY_ENVIRONMENT,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    workerName: process.env.STORAGE_BACKUP_WORKER_NAME,
  })
  await writeStorageBackupDeploymentOutputs(result, process.env.GITHUB_OUTPUT)
  console.log(`Verified active ${result.workerName} deployment for ${result.commitSha}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Storage-backup Worker deployment verification failed.')
    process.exitCode = 1
  })
}
