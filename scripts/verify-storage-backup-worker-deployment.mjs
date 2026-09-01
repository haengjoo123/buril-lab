import { appendFile, readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const CLOUDFLARE_ACCOUNT_ID = '692fedd5b67a5fd545bb16038bbd4c85'
const PINNED_WRANGLER_VERSION = '4.125.0'
const SECRET_FILE_PATTERN = /^\/home\/runner\/work\/_temp\/burillab-storage-backup-secrets-[A-Za-z0-9]{6}\/secrets\.json$/
const COMPATIBILITY_DATE = '2026-08-20'
const COMPATIBILITY_FLAGS = Object.freeze(['nodejs_compat'])
const COMMON_PLAIN_TEXT_BINDINGS = Object.freeze({
  SOURCE_POINTER_MODE: 'legacy_url',
  SOURCE_STORAGE_BUCKET: 'cabinets',
  WORKERS_SUBREQUEST_LIMIT: '4000',
  WORKERS_USAGE_PLAN: 'paid',
})
const TARGETS = Object.freeze({
  staging: Object.freeze({
    environment: 'staging',
    accountId: CLOUDFLARE_ACCOUNT_ID,
    workerName: 'buril-lab-storage-backup-staging',
    runtimeConfigKvId: 'dcaa52254fa6447bbe7c21f54354ad0d',
    backupBucket: 'buril-lab-cabinet-backups-staging',
    cron: '15 17 * * *',
    configPath: 'workers/storage-backup/wrangler.staging.jsonc',
    usesSecretFile: true,
    requireExistingWorker: false,
    plainTextBindings: Object.freeze({
      BACKUP_ENVIRONMENT: 'staging',
      SUPABASE_PROJECT_REF: 'qpgnomuqdcucjmxrunnw',
      SUPABASE_URL: 'https://qpgnomuqdcucjmxrunnw.supabase.co',
      ...COMMON_PLAIN_TEXT_BINDINGS,
    }),
  }),
  production: Object.freeze({
    environment: 'production',
    accountId: CLOUDFLARE_ACCOUNT_ID,
    workerName: 'buril-lab-storage-backup-production',
    runtimeConfigKvId: 'dd6866f35f794a91b0fb5a24cbe57cf3',
    backupBucket: 'buril-lab-cabinet-backups-production',
    cron: '45 17 * * *',
    configPath: 'workers/storage-backup/wrangler.production.jsonc',
    usesSecretFile: false,
    requireExistingWorker: true,
    plainTextBindings: Object.freeze({
      BACKUP_ENVIRONMENT: 'production',
      SUPABASE_PROJECT_REF: 'zafxzidbtbryiksemlwc',
      SUPABASE_URL: 'https://zafxzidbtbryiksemlwc.supabase.co',
      ...COMMON_PLAIN_TEXT_BINDINGS,
    }),
  }),
})
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CONTROL_PLANE_JSON_BYTES = 1024 * 1024
const MAX_WRANGLER_OUTPUT_BYTES = 64 * 1024
const CLOUDFLARE_ENVELOPE_KEYS = Object.freeze(['errors', 'messages', 'result', 'success'])
const CLOUDFLARE_RESULT_INFO_KEYS = Object.freeze([
  'count',
  'page',
  'per_page',
  'total_count',
  'total_pages',
])

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

function requireExactKeys(value, requiredKeys, optionalKeys, name) {
  if (!isRecord(value)) throw new Error(`${name} has an invalid shape.`)
  const actualKeys = Object.keys(value).sort()
  const required = [...requiredKeys].sort()
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  if (
    required.some((key) => !Object.hasOwn(value, key))
    || actualKeys.some((key) => !allowed.has(key))
  ) {
    throw new Error(`${name} contains missing or unapproved fields.`)
  }
  return value
}

function parseCloudflareEnvelope(raw, name, {
  allowResultInfo = false,
  allowNullDiagnostics = false,
} = {}) {
  const response = parseJson(raw, name)
  requireExactKeys(
    response,
    CLOUDFLARE_ENVELOPE_KEYS,
    allowResultInfo ? ['result_info'] : [],
    name,
  )
  const hasEmptyArrayDiagnostics = (
    Array.isArray(response.errors)
    && response.errors.length === 0
    && Array.isArray(response.messages)
    && response.messages.length === 0
  )
  const hasObservedNullDiagnostics = (
    allowNullDiagnostics
    && response.errors === null
    && response.messages === null
  )
  if (response.success !== true || (!hasEmptyArrayDiagnostics && !hasObservedNullDiagnostics)) {
    throw new Error(`${name} did not return one successful, error-free response.`)
  }

  if (Object.hasOwn(response, 'result_info')) {
    const resultInfo = requireExactKeys(
      response.result_info,
      [],
      CLOUDFLARE_RESULT_INFO_KEYS,
      `${name} result_info`,
    )
    for (const value of Object.values(resultInfo)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} result_info contains an invalid count.`)
      }
    }
  }
  return response
}

function requireUniqueStrings(values, name) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new Error(`${name} must be an array of strings.`)
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${name} contains a duplicate value.`)
  }
  return values
}

function expectedTag(runId, leaseId) {
  if (!/^[1-9][0-9]*$/.test(runId || '') || !/^[0-9a-f]{32}$/.test(leaseId || '')) {
    throw new Error('Storage-backup deployment run and lease identity is malformed.')
  }
  return `r${runId}-l${leaseId}`
}

function expectedMessage(environment, commitSha, runId, leaseId) {
  return `quality-approved ${environment} storage backup run ${runId} lease ${leaseId} commit ${commitSha}`
}

function requireExactArray(value, expected, name) {
  if (
    !Array.isArray(value)
    || value.length !== expected.length
    || value.some((item, index) => item !== expected[index])
  ) {
    throw new Error(`${name} differs from the pinned Wrangler command contract.`)
  }
}

function requireBoundedTimestamp(value, name, { start, now }) {
  const parsed = Date.parse(value || '')
  if (!Number.isFinite(parsed) || parsed < start || parsed > now + 60_000) {
    throw new Error(`${name} is outside the guarded deployment time boundary.`)
  }
  return parsed
}

function verifyWranglerWorkerSession(entry, {
  target,
  commitSha,
  runId,
  leaseId,
  start,
  now,
}) {
  requireExactKeys(entry, [
    'type', 'version', 'wrangler_version', 'command_line_args', 'log_file_path',
    'timestamp',
  ], [], 'Wrangler Worker session output')
  if (
    entry.type !== 'wrangler-session'
    || entry.version !== 1
    || entry.wrangler_version !== PINNED_WRANGLER_VERSION
    || typeof entry.log_file_path !== 'string'
    || entry.log_file_path.length === 0
    || entry.log_file_path.length > 4_096
    || /[\u0000-\u001f\u007f]/.test(entry.log_file_path)
  ) {
    throw new Error('Wrangler Worker session does not match the pinned deployment contract.')
  }

  const baseArgs = [
    'deploy',
    '--config', target.configPath,
  ]
  if (target.usesSecretFile) {
    const secretFile = entry.command_line_args?.[4]
    if (typeof secretFile !== 'string' || !SECRET_FILE_PATTERN.test(secretFile)) {
      throw new Error('Wrangler Worker session did not use the isolated GitHub runner secret file.')
    }
    baseArgs.push('--secrets-file', secretFile)
  }
  requireExactArray(entry.command_line_args, [
    ...baseArgs,
    '--strict',
    '--autoconfig=false',
    '--tag', expectedTag(runId, leaseId),
    '--message', expectedMessage(target.environment, commitSha, runId, leaseId),
  ], 'Wrangler Worker session command line')
  return requireBoundedTimestamp(
    entry.timestamp,
    'Wrangler Worker session timestamp',
    { start, now },
  )
}

export function verifyWranglerWorkerDeployOutput(raw, {
  environment,
  workerName,
  commitSha,
  runId,
  leaseId,
  startedAt,
  now = Date.now(),
} = {}) {
  if (
    typeof raw !== 'string'
    || Buffer.byteLength(raw, 'utf8') < 1
    || Buffer.byteLength(raw, 'utf8') > MAX_WRANGLER_OUTPUT_BYTES
  ) throw new Error('Wrangler Worker deployment output is empty or oversized.')
  if (!FULL_SHA_PATTERN.test(commitSha || '')) {
    throw new Error('Wrangler Worker deployment output requires the exact lowercase commit SHA.')
  }
  const target = requireExactWorker({ environment, accountId: CLOUDFLARE_ACCOUNT_ID, workerName })
  expectedTag(runId, leaseId)
  const lines = raw.trimEnd().split(/\r?\n/)
  if (lines.length !== 2) {
    throw new Error('Wrangler Worker deployment output must contain exactly one session and one deploy record.')
  }
  let entries
  try {
    entries = lines.map((line) => JSON.parse(line))
  } catch {
    throw new Error('Wrangler Worker deployment output is not valid JSON Lines.')
  }
  const [session, entry] = entries
  if (session?.type !== 'wrangler-session' || entry?.type !== 'deploy') {
    throw new Error('Wrangler Worker deployment record order differs from the pinned contract.')
  }
  const start = Date.parse(startedAt || '')
  const nowTime = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(start) || !Number.isFinite(nowTime) || start > nowTime + 60_000) {
    throw new Error('Wrangler Worker deployment time boundary is invalid.')
  }
  const sessionAt = verifyWranglerWorkerSession(session, {
    target,
    commitSha,
    runId,
    leaseId,
    start,
    now: nowTime,
  })
  requireExactKeys(entry, [
    'type', 'version', 'worker_name', 'worker_tag', 'version_id', 'targets',
    'worker_name_overridden', 'timestamp',
  ], ['wrangler_environment'], 'Wrangler Worker deployment output')
  const outputAt = requireBoundedTimestamp(
    entry.timestamp,
    'Wrangler Worker deployment timestamp',
    { start, now: nowTime },
  )
  if (
    entry.type !== 'deploy'
    || entry.version !== 1
    || ![null, workerName].includes(entry.worker_name)
    || entry.worker_name_overridden !== false
    || (entry.worker_tag !== null && typeof entry.worker_tag !== 'string')
    || !UUID_PATTERN.test(entry.version_id || '')
    || outputAt < sessionAt
  ) {
    throw new Error('Wrangler Worker deployment output does not match the guarded mutation.')
  }
  requireExactArray(entry.targets, [`schedule: ${target.cron}`], 'Wrangler Worker deployment targets')
  return Object.freeze({ versionId: entry.version_id, outputAt: new Date(outputAt).toISOString() })
}

function requireExactWorker({ environment, accountId, workerName }) {
  const target = TARGETS[environment]
  if (
    !target
    || accountId !== target.accountId
    || workerName !== target.workerName
  ) {
    throw new Error('Storage-backup verification is restricted to an exact approved account and Worker.')
  }
  return target
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
    throw new Error('The backup Worker has an unapproved secret set.')
  }
  return secretNames
}

function verifyWorkerBindings(raw, target) {
  const response = parseCloudflareEnvelope(raw, 'Cloudflare Worker bindings')
  if (!Array.isArray(response.result)) {
    throw new Error('Cloudflare Worker bindings result must be an array.')
  }

  const expectedNames = new Set([
    'BURILLAB_RUNTIME_CONFIG',
    'CABINET_BACKUPS',
    'SUPABASE_SERVICE_ROLE_KEY',
    ...Object.keys(target.plainTextBindings),
  ])
  if (response.result.length !== expectedNames.size) {
    throw new Error('The backup Worker must have exactly the approved ten bindings.')
  }

  const seen = new Set()
  for (const item of response.result) {
    if (!isRecord(item) || typeof item.name !== 'string' || seen.has(item.name)) {
      throw new Error('Cloudflare Worker bindings contain a malformed or duplicate name.')
    }
    seen.add(item.name)
    if (!expectedNames.has(item.name)) {
      throw new Error('Cloudflare Worker bindings contain an unapproved binding name.')
    }

    if (item.name === 'BURILLAB_RUNTIME_CONFIG') {
      requireExactKeys(
        item,
        ['name', 'namespace_id', 'type'],
        [],
        'Staging runtime-config KV binding',
      )
      if (item.type !== 'kv_namespace' || item.namespace_id !== target.runtimeConfigKvId) {
        throw new Error('The backup Worker has the wrong runtime-config KV binding.')
      }
      continue
    }
    if (item.name === 'CABINET_BACKUPS') {
      requireExactKeys(item, ['bucket_name', 'name', 'type'], [], 'Staging R2 binding')
      if (item.type !== 'r2_bucket' || item.bucket_name !== target.backupBucket) {
        throw new Error('The backup Worker has the wrong private R2 binding.')
      }
      continue
    }
    if (item.name === 'SUPABASE_SERVICE_ROLE_KEY') {
      requireExactKeys(item, ['name', 'type'], [], 'Staging Supabase secret binding')
      if (item.type !== 'secret_text') {
        throw new Error('The backup Worker Supabase binding is not secret text.')
      }
      continue
    }

    requireExactKeys(item, ['name', 'text', 'type'], [], `Staging plain-text binding ${item.name}`)
    if (
      item.type !== 'plain_text'
      || item.text !== target.plainTextBindings[item.name]
    ) {
      throw new Error(`The backup Worker has an unsafe value for ${item.name}.`)
    }
  }

  if (seen.size !== expectedNames.size || [...expectedNames].some((name) => !seen.has(name))) {
    throw new Error('The backup Worker binding set is incomplete.')
  }
  return response.result.length
}

function verifyEmptyWorkerSurface(raw, name, {
  allowResultInfo = false,
  allowNullDiagnostics = false,
} = {}) {
  const response = parseCloudflareEnvelope(raw, name, { allowResultInfo, allowNullDiagnostics })
  if (!Array.isArray(response.result) || response.result.length !== 0) {
    throw new Error(`${name} must be exactly empty.`)
  }
  if (Object.hasOwn(response, 'result_info')) {
    for (const key of ['count', 'total_count', 'total_pages']) {
      if (Object.hasOwn(response.result_info, key) && response.result_info[key] !== 0) {
        throw new Error(`${name} pagination metadata reports a hidden non-empty result.`)
      }
    }
  }
}

function verifyWorkerSubdomain(raw) {
  const response = parseCloudflareEnvelope(raw, 'Cloudflare Worker subdomain')
  requireExactKeys(
    response.result,
    ['enabled', 'previews_enabled'],
    [],
    'Cloudflare Worker subdomain result',
  )
  if (response.result.enabled !== false || response.result.previews_enabled !== false) {
    throw new Error('The backup Worker workers.dev or preview URL is enabled.')
  }
}

function verifyWorkerService(raw, target) {
  const response = parseCloudflareEnvelope(raw, 'Cloudflare Worker service metadata')
  if (!isRecord(response.result) || !isRecord(response.result.script)) {
    throw new Error('Cloudflare Worker service metadata has no script object.')
  }
  const script = response.result.script
  if (response.result.environment !== 'production' || script.id !== target.workerName) {
    throw new Error('Cloudflare Worker service metadata identifies the wrong environment or Worker.')
  }
  if (script.compatibility_date !== COMPATIBILITY_DATE) {
    throw new Error('The backup Worker compatibility date has drifted.')
  }
  const flags = requireUniqueStrings(
    script.compatibility_flags,
    'Cloudflare Worker compatibility flags',
  )
  if (
    flags.length !== COMPATIBILITY_FLAGS.length
    || flags.some((flag, index) => flag !== COMPATIBILITY_FLAGS[index])
  ) {
    throw new Error('The backup Worker compatibility flags have drifted.')
  }
  const handlers = requireUniqueStrings(script.handlers, 'Cloudflare Worker default handlers')
  if (handlers.length !== 1 || handlers[0] !== 'scheduled') {
    throw new Error('The backup Worker must expose only the scheduled handler.')
  }
  if (!isRecord(script.limits)) {
    throw new Error('The backup Worker has no verifiable execution limits.')
  }
  requireExactKeys(
    script.limits,
    ['subrequests'],
    [],
    'Cloudflare Worker execution limits',
  )
  if (script.limits.subrequests !== 4000) {
    throw new Error('The backup Worker subrequest limit has drifted.')
  }
  if (
    (script.named_handlers !== undefined
      && (!Array.isArray(script.named_handlers) || script.named_handlers.length !== 0))
    || (script.tail_consumers !== undefined
      && script.tail_consumers !== null
      && (!Array.isArray(script.tail_consumers) || script.tail_consumers.length !== 0))
    || (script.placement_mode !== undefined && script.placement_mode !== null)
  ) {
    throw new Error('The backup Worker service metadata contains an unapproved execution surface.')
  }
}

function verifyWorkerSchedules(raw, target) {
  const response = parseCloudflareEnvelope(raw, 'Cloudflare Worker schedules')
  requireExactKeys(response.result, ['schedules'], [], 'Cloudflare Worker schedules result')
  if (!Array.isArray(response.result.schedules) || response.result.schedules.length !== 1) {
    throw new Error('The backup Worker must have exactly one Cron schedule.')
  }
  const schedule = requireExactKeys(
    response.result.schedules[0],
    ['cron'],
    ['created_on', 'modified_on'],
    'Cloudflare Worker Cron schedule',
  )
  if (schedule.cron !== target.cron) {
    throw new Error('The backup Worker Cron schedule has drifted.')
  }
  for (const key of ['created_on', 'modified_on']) {
    if (
      Object.hasOwn(schedule, key)
      && (
        typeof schedule[key] !== 'string'
        || !Number.isFinite(Date.parse(schedule[key]))
      )
    ) {
      throw new Error('The Staging backup Worker Cron metadata is malformed.')
    }
  }
}

export function verifyStorageBackupWorkerSurface({
  bindingsRaw,
  routesRaw,
  domainsRaw,
  subdomainRaw,
  serviceRaw,
  schedulesRaw,
  environment,
  accountId,
  workerName,
}) {
  const target = requireExactWorker({ environment, accountId, workerName })
  const bindingCount = verifyWorkerBindings(bindingsRaw, target)
  verifyEmptyWorkerSurface(routesRaw, 'Cloudflare Worker routes')
  verifyEmptyWorkerSurface(domainsRaw, 'Cloudflare Worker custom domains', {
    allowResultInfo: true,
    allowNullDiagnostics: true,
  })
  verifyWorkerSubdomain(subdomainRaw)
  verifyWorkerService(serviceRaw, target)
  verifyWorkerSchedules(schedulesRaw, target)
  return {
    bindingCount,
    routeCount: 0,
    customDomainCount: 0,
    cron: target.cron,
  }
}

export function verifyStorageBackupWorkerSecretPreflight({
  responseRaw,
  httpStatus,
  environment,
  accountId,
  workerName,
}) {
  const target = requireExactWorker({ environment, accountId, workerName })
  if (httpStatus !== '200' && httpStatus !== '404') {
    throw new Error('The backup Worker secret preflight returned an unexpected HTTP status.')
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

  if (target.requireExistingWorker) {
    throw new Error('The Production backup Worker and its approved secret must exist before a code-only deployment.')
  }
  const errors = Array.isArray(response.errors) ? response.errors : []
  if (
    response.success !== false
    || errors.length === 0
    || errors.some((error) => !isRecord(error) || ![10007, 10090].includes(error.code))
  ) {
    throw new Error('Cloudflare did not prove that the backup Worker is absent.')
  }
  return { workerExists: false, approvedSecretCount: 0 }
}

export function verifyStorageBackupWorkerDeployment({
  deploymentRaw,
  versionsRaw,
  secretsRaw,
  bindingsRaw,
  routesRaw,
  domainsRaw,
  subdomainRaw,
  serviceRaw,
  schedulesRaw,
  commitSha,
  runId,
  leaseId,
  expectedVersionId,
  environment,
  accountId,
  workerName,
}) {
  const target = requireExactWorker({ environment, accountId, workerName })
  if (typeof commitSha !== 'string' || !FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('Storage-backup deployment verification requires a lowercase full Git SHA.')
  }
  const tag = expectedTag(runId, leaseId)
  if (!UUID_PATTERN.test(expectedVersionId || '')) {
    throw new Error('Storage-backup deployment requires the exact Wrangler-created version ID.')
  }

  const deployment = parseJson(deploymentRaw, 'Wrangler deployment status')
  const versions = parseJson(versionsRaw, 'Wrangler version list')
  const secrets = parseJson(secretsRaw, 'Wrangler secret list')
  if (!isRecord(deployment) || !UUID_PATTERN.test(deployment.id)) {
    throw new Error('Wrangler deployment status has no valid deployment ID.')
  }
  if (!Array.isArray(deployment.versions) || deployment.versions.length !== 1) {
    throw new Error('The backup Worker must have one active version only.')
  }
  const active = deployment.versions[0]
  if (
    !isRecord(active)
    || !UUID_PATTERN.test(active.version_id)
    || active.percentage !== 100
  ) {
    throw new Error('The backup Worker active version must receive exactly 100 percent.')
  }
  const message = expectedMessage(target.environment, commitSha, runId, leaseId)
  if (!isRecord(deployment.annotations) || deployment.annotations['workers/message'] !== message) {
    throw new Error('The active Worker deployment message does not match the approved commit.')
  }

  if (!Array.isArray(versions) || versions.length === 0 || versions.length > 10) {
    throw new Error('Wrangler version list has an invalid shape.')
  }
  const versionIds = versions.map((version) => (
    isRecord(version) && UUID_PATTERN.test(version.id) ? version.id : null
  ))
  if (versionIds.includes(null) || new Set(versionIds).size !== versionIds.length) {
    throw new Error('Wrangler version list contains a malformed or duplicate version ID.')
  }
  const activeVersion = versions.find((version) => isRecord(version) && version.id === active.version_id)
  if (!activeVersion || !isRecord(activeVersion.annotations)) {
    throw new Error('The active Worker version is absent from the bounded version list.')
  }
  if (
    active.version_id !== expectedVersionId
    || activeVersion.annotations['workers/tag'] !== tag
    || activeVersion.annotations['workers/message'] !== message
  ) {
    throw new Error('The active Worker version identity does not match the approved commit.')
  }

  readApprovedSecretNames(secrets, { allowEmpty: false })
  verifyStorageBackupWorkerSurface({
    bindingsRaw,
    routesRaw,
    domainsRaw,
    subdomainRaw,
    serviceRaw,
    schedulesRaw,
    environment,
    accountId,
    workerName,
  })

  return {
    environment: target.environment,
    workerName: target.workerName,
    commitSha,
    runId,
    leaseId,
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
  if (command === 'wrangler-output') {
    const result = verifyWranglerWorkerDeployOutput(
      await readFile(process.env.WRANGLER_OUTPUT_FILE_PATH, 'utf8'),
      {
        environment: process.env.DEPLOY_ENVIRONMENT,
        workerName: process.env.STORAGE_BACKUP_WORKER_NAME,
        commitSha: process.env.DEPLOY_COMMIT_SHA,
        runId: process.env.GITHUB_RUN_ID,
        leaseId: process.env.DEPLOY_LEASE_ID,
        startedAt: process.env.WORKER_DEPLOY_STARTED_AT,
      },
    )
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, [
        `worker_version_id=${result.versionId}`,
        `worker_output_at=${result.outputAt}`,
        '',
      ].join('\n'), 'utf8')
    }
    console.log(`Verified newly created Worker version ${result.versionId}.`)
    return
  }
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
        ? `Verified the existing ${process.env.DEPLOY_ENVIRONMENT} Worker secret allow-list (${result.approvedSecretCount}).`
        : `Verified that the ${process.env.DEPLOY_ENVIRONMENT} backup Worker does not exist yet.`,
    )
    return
  }
  if (command !== 'active') {
    throw new Error('Usage: verify-storage-backup-worker-deployment.mjs preflight|wrangler-output|active')
  }
  const result = verifyStorageBackupWorkerDeployment({
    deploymentRaw: process.env.STORAGE_BACKUP_DEPLOYMENT_JSON,
    versionsRaw: process.env.STORAGE_BACKUP_VERSIONS_JSON,
    secretsRaw: process.env.STORAGE_BACKUP_SECRETS_JSON,
    bindingsRaw: process.env.STORAGE_BACKUP_BINDINGS_JSON,
    routesRaw: process.env.STORAGE_BACKUP_ROUTES_JSON,
    domainsRaw: process.env.STORAGE_BACKUP_DOMAINS_JSON,
    subdomainRaw: process.env.STORAGE_BACKUP_SUBDOMAIN_JSON,
    serviceRaw: process.env.STORAGE_BACKUP_SERVICE_JSON,
    schedulesRaw: process.env.STORAGE_BACKUP_SCHEDULES_JSON,
    commitSha: process.env.DEPLOY_COMMIT_SHA,
    runId: process.env.GITHUB_RUN_ID,
    leaseId: process.env.DEPLOY_LEASE_ID,
    expectedVersionId: process.env.EXPECTED_WORKER_VERSION_ID,
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
