import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { open, readFile, unlink } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import {
  attestationEnvelopeHash,
  publicKeyFingerprint,
  verifySignedAttestation,
} from './ephemeral-release-attestation.mjs'
import {
  defaultEphemeralKeyPath,
  loadProtectedEphemeralReleaseKey,
} from './ephemeral-release-key-store.mjs'
import {
  advanceProviderCreationJournal,
  assertProviderCreationRunAbsenceCanAbort,
  createAbortedLeaseReceipt,
  createCredentialInjectionProbe,
  appendClosedLeaseReceipt,
  createInitialCleanupReceipt,
  createLeaseMaterial,
  createProviderCreationPending,
  resolveProviderCreationCleanupState,
  sha256,
  verifyProviderCreationCleanupSuccessor,
  verifyProviderCreationJournal,
  verifyProviderCreationLeaseGrant,
  verifyProviderCreationRecoveryEvidence,
  STAGING_CREDENTIAL_INJECTION_PROBE_WORKFLOW,
} from './ephemeral-release-supervisor-core.mjs'
import {
  CLEANUP_ABSENT_SECRET_NAMES,
  MAX_CUMULATIVE_LEASES,
} from './verify-ephemeral-cleanup-receipt.mjs'
import {
  verifyActiveSupabasePat,
  verifyInactiveCloudflareToken,
  verifyInactiveSupabasePat,
} from './verify-ephemeral-provider-lifecycle.mjs'
import { verifyCloudflareTokenTtl } from './verify-cloudflare-token-ttl.mjs'
import { findTrustedStagingRun } from './verify-github-staging-run.mjs'
import { verifyCleanupReceiptCoversRun } from './verify-ephemeral-cleanup-receipt.mjs'

const REPOSITORY = 'haengjoo123/buril-lab'
const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024
const INPUT_MAX_BYTES = 64 * 1024
const MAX_RECOVERY_RUN_PAGES = 10
const RECOVERY_RUNS_PER_PAGE = 100
const RECOVERY_CLOCK_SKEW_MS = 5 * 60 * 1000
// GitHub evaluates environment-secret expressions when a workflow run is
// created. Give a just-written environment secret time to reach that control
// plane before dispatching the one permitted ephemeral-credential run.
const SECRET_DISPATCH_PROPAGATION_DELAY_MS = 75_000
// GitHub can acknowledge workflow_dispatch before the corresponding run is
// visible to the run-list API. Keep the signed dispatch-intent journal and
// reconcile for five minutes instead of treating the first minute of absence
// as proof that no run exists.
const DISPATCH_RECONCILIATION_ATTEMPTS = 60
const DISPATCH_RECONCILIATION_INTERVAL_MS = 5_000
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const RUN_URL_PATTERN = /^https:\/\/github\.com\/haengjoo123\/buril-lab\/actions\/runs\/([1-9]\d*)\/?$/
const TERMINAL_GATE_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'skipped',
  'stale',
  'success',
  'timed_out',
])
const REPOSITORY_FORBIDDEN_VARIABLE_NAMES = Object.freeze([
  'EPHEMERAL_CLEANUP_RECEIPT',
  'EPHEMERAL_LAST_ABORTED_LEASE_RECEIPT',
  'EPHEMERAL_LEASE_GRANT',
  'EPHEMERAL_PROVIDER_CREATION_PENDING',
  'STAGING_EPHEMERAL_CLEANUP_RECEIPT',
])
const CONTRACTS = Object.freeze({
  staging: Object.freeze({
    workflow: 'deploy-staging.yml',
    workflowName: 'Deploy staging',
    jobName: 'Supervised deploy of verified commit to buril-lab-staging',
    pagesMutationStep: 'Deploy the exact commit to Staging Pages',
    projectRef: 'qpgnomuqdcucjmxrunnw',
  }),
  production: Object.freeze({
    workflow: 'deploy-production.yml',
    workflowName: 'Deploy production manually',
    jobName: 'Manually deploy verified commit to buril-lab',
    pagesMutationStep: 'Deploy the exact commit to production Pages',
    projectRef: 'zafxzidbtbryiksemlwc',
  }),
})

const STAGING_CREDENTIAL_INJECTION_PROBE_CONTRACT = Object.freeze({
  workflow: STAGING_CREDENTIAL_INJECTION_PROBE_WORKFLOW,
  workflowName: 'Verify staging ephemeral credentials',
  jobName: 'Verify exact environment-secret injection',
  verificationStep: 'Verify exact environment-secret injection',
})

function parseArguments(argv) {
  const [command, ...rest] = argv
  const values = {}
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]
    const value = rest[index + 1]
    const key = name?.startsWith('--') ? name.slice(2) : ''
    if (!key || value === undefined || Object.hasOwn(values, key)) {
      throw new Error('Supervisor arguments must use unique --name value pairs.')
    }
    values[key] = value
  }
  if (command === 'bootstrap') {
    exactKeys(values, ['environment'], 'Bootstrap arguments')
  } else if (command === 'deploy') {
    const keys = values.environment === 'production'
      ? ['environment', 'commit', 'storage-backup', 'cloudflare-account-id', 'staging-run-id']
      : ['environment', 'commit', 'storage-backup', 'cloudflare-account-id']
    exactKeys(values, keys, 'Deploy arguments')
  } else if (command === 'recover') {
    exactKeys(values, ['environment', 'lease', 'cloudflare-account-id'], 'Recovery arguments')
  }
  return { command, values }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} fields are invalid.`)
}

export async function withSupervisorProcessLock(action, {
  lockPath = `${defaultEphemeralKeyPath()}.supervisor.lock`,
  context = 'unknown',
  openImpl = open,
  readFileImpl = readFile,
  unlinkImpl = unlink,
  processAliveImpl = (ownerPid) => {
    try {
      process.kill(ownerPid, 0)
      return true
    } catch (error) {
      if (error?.code === 'ESRCH') return false
      if (error?.code === 'EPERM') return true
      throw error
    }
  },
  now = Date.now(),
  pid = process.pid,
} = {}) {
  if (
    typeof action !== 'function'
    || typeof lockPath !== 'string'
    || lockPath.length === 0
    || typeof context !== 'string'
    || context.length === 0
    || context.length > 256
    || /[\r\n\0]/.test(context)
    || !Number.isSafeInteger(pid)
    || pid <= 0
  ) {
    throw new Error('Supervisor process-lock input is invalid.')
  }
  const startedAt = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(startedAt)) throw new Error('Supervisor process-lock time is invalid.')
  const owner = JSON.stringify({
    version: 1,
    pid,
    context,
    started_at: new Date(startedAt).toISOString(),
    nonce: randomBytes(16).toString('hex'),
  })
  const acquisitionPath = `${lockPath}.acquire`
  let acquisitionHandle
  try {
    acquisitionHandle = await openImpl(acquisitionPath, 'wx', 0o600)
    await acquisitionHandle.writeFile(owner, 'utf8')
    await acquisitionHandle.sync()
  } catch (error) {
    await acquisitionHandle?.close().catch(() => undefined)
    if (error?.code === 'EEXIST') {
      throw new Error('Another supervisor is acquiring the protected local lock; retry after that acquisition finishes.')
    }
    throw new Error('The protected local supervisor acquisition lock could not be created.')
  }
  let handle = null
  try {
    try {
      handle = await openImpl(lockPath, 'wx', 0o600)
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw new Error('The protected local supervisor lock could not be created.')
      }
      let existingRaw
      let existingOwner
      try {
        existingRaw = await readFileImpl(lockPath, 'utf8')
        existingOwner = JSON.parse(existingRaw)
        exactKeys(existingOwner, ['version', 'pid', 'context', 'started_at', 'nonce'], 'Supervisor lock owner')
      } catch {
        throw new Error('The existing supervisor lock owner is malformed; preserve it for manual review.')
      }
      if (
        existingOwner.version !== 1
        || !Number.isSafeInteger(existingOwner.pid)
        || existingOwner.pid <= 0
        || typeof existingOwner.context !== 'string'
        || existingOwner.context.length === 0
        || existingOwner.context.length > 256
        || /[\r\n\0]/.test(existingOwner.context)
        || !Number.isFinite(Date.parse(existingOwner.started_at))
        || !/^[0-9a-f]{32}$/.test(existingOwner.nonce || '')
      ) {
        throw new Error('The existing supervisor lock owner is invalid; preserve it for manual review.')
      }
      let ownerAlive
      try {
        ownerAlive = await processAliveImpl(existingOwner.pid)
      } catch {
        throw new Error('The existing supervisor process state could not be proven.')
      }
      if (typeof ownerAlive !== 'boolean') {
        throw new Error('The existing supervisor process state was not authoritative.')
      }
      if (ownerAlive) {
        throw new Error('Another ephemeral release supervisor owns the protected local lock; do not remove it until that process is proven stopped.')
      }
      if (await readFileImpl(lockPath, 'utf8') !== existingRaw) {
        throw new Error('The stopped supervisor lock changed during guarded recovery.')
      }
      await unlinkImpl(lockPath)
      handle = await openImpl(lockPath, 'wx', 0o600)
    }
    await handle.writeFile(owner, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle?.close().catch(() => undefined)
    if (handle) await unlinkImpl(lockPath).catch(() => undefined)
    throw error
  } finally {
    let acquisitionOwnerMatches = false
    try {
      acquisitionOwnerMatches = await readFileImpl(acquisitionPath, 'utf8') === owner
    } finally {
      await acquisitionHandle.close().catch(() => undefined)
    }
    if (!acquisitionOwnerMatches) {
      throw new Error('Supervisor acquisition-lock ownership changed unexpectedly.')
    }
    await unlinkImpl(acquisitionPath)
  }
  let result
  let operationFailure = null
  try {
    result = await action()
  } catch (error) {
    operationFailure = error
  }
  let cleanupFailure = null
  try {
    const storedOwner = await readFileImpl(lockPath, 'utf8')
    if (storedOwner !== owner) {
      throw new Error('Supervisor process-lock ownership changed unexpectedly.')
    }
    await handle.close()
    handle = null
    await unlinkImpl(lockPath)
  } catch (error) {
    cleanupFailure = error
  } finally {
    await handle?.close().catch(() => undefined)
  }
  if (operationFailure && cleanupFailure) {
    throw new AggregateError([operationFailure, cleanupFailure], 'Supervisor operation and protected lock cleanup both failed.')
  }
  if (cleanupFailure) throw cleanupFailure
  if (operationFailure) throw operationFailure
  return result
}

export function runGh(args, { input, timeoutMs = 30_000, spawnImpl = spawn } = {}) {
  const operation = args[0] === 'secret' || args[0] === 'variable'
    ? `GitHub ${args[0]} ${args[1] || 'operation'} failed.`
    : args[0] === 'workflow' || args[0] === 'run' || args[0] === 'api'
      ? `GitHub ${args[0]} operation failed.`
      : 'GitHub CLI operation failed.'
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl('gh', args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    let total = 0
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (error) rejectPromise(error)
      else resolvePromise(value)
    }
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          child.kill()
          finish(new Error('GitHub CLI operation timed out.'))
        }, timeoutMs)
      : null
    child.on('error', () => finish(new Error('GitHub CLI could not start.')))
    child.stdout.on('data', (chunk) => {
      total += chunk.length
      if (total > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill()
        finish(new Error('GitHub CLI output was oversized.'))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      total += chunk.length
      if (total > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill()
        finish(new Error('GitHub CLI output was oversized.'))
      }
    })
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(operation))
        return
      }
      finish(null, Buffer.concat(stdout).toString('utf8').trim())
    })
    child.stdin.end(input === undefined ? undefined : input)
  })
}

async function parseGithubNameList(args, label, run = runGh) {
  const raw = await run(args)
  let parsed
  try {
    parsed = JSON.parse(raw || '[]')
  } catch {
    throw new Error(`${label} was invalid JSON.`)
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry?.name !== 'string')) {
    throw new Error(`${label} was malformed.`)
  }
  return new Set(parsed.map((entry) => entry.name))
}

async function listEnvironmentSecrets(environment, run = runGh) {
  return parseGithubNameList([
    'secret', 'list', '--repo', REPOSITORY, '--env', environment, '--json', 'name',
  ], 'GitHub environment secret list', run)
}

async function assertEnvironmentSecretsPresent(environment, expectedNames) {
  if (
    !Array.isArray(expectedNames)
    || expectedNames.length === 0
    || new Set(expectedNames).size !== expectedNames.length
    || expectedNames.some((name) => typeof name !== 'string' || !/^[A-Z0-9_]+$/.test(name))
  ) {
    throw new Error('Expected GitHub environment-secret names are invalid.')
  }
  const present = await listEnvironmentSecrets(environment)
  if (expectedNames.some((name) => !present.has(name))) {
    throw new Error('GitHub did not report every temporary environment secret after setup.')
  }
}

export async function removeCredentialSecrets(environment, { run = runGh } = {}) {
  let present = null
  try {
    present = await listEnvironmentSecrets(environment, run)
  } catch {
    // An authoritative final read decides success. Until then, attempt every reviewed name.
  }
  const targets = present
    ? CLEANUP_ABSENT_SECRET_NAMES.filter((name) => present.has(name))
    : [...CLEANUP_ABSENT_SECRET_NAMES]
  for (const name of targets) {
    try {
      await run(['secret', 'delete', name, '--repo', REPOSITORY, '--env', environment])
    } catch {
      // A lost delete response is harmless only when the final authoritative list proves absence.
    }
  }
  const after = await listEnvironmentSecrets(environment, run)
  const remaining = CLEANUP_ABSENT_SECRET_NAMES.filter((name) => after.has(name))
  if (remaining.length > 0) throw new Error('One or more temporary or legacy GitHub secrets remain.')
}

async function listEnvironmentVariables(environment, run = runGh) {
  return parseGithubNameList([
    'variable', 'list', '--repo', REPOSITORY, '--env', environment, '--json', 'name',
  ], 'GitHub environment variable list', run)
}

export async function assertNoRepositoryCredentialState({ run = runGh } = {}) {
  const [secrets, variables] = await Promise.all([
    parseGithubNameList([
      'secret', 'list', '--repo', REPOSITORY, '--json', 'name',
    ], 'GitHub repository secret list', run),
    parseGithubNameList([
      'variable', 'list', '--repo', REPOSITORY, '--json', 'name',
    ], 'GitHub repository variable list', run),
  ])
  const forbiddenSecrets = CLEANUP_ABSENT_SECRET_NAMES.filter((name) => secrets.has(name))
  const forbiddenVariables = REPOSITORY_FORBIDDEN_VARIABLE_NAMES.filter((name) => variables.has(name))
  if (forbiddenSecrets.length > 0 || forbiddenVariables.length > 0) {
    throw new Error('Repository-scoped credential or release state would bypass environment isolation.')
  }
}

async function removeEnvironmentVariable(environment, name, run = runGh) {
  const present = await listEnvironmentVariables(environment, run)
  if (present.has(name)) {
    try {
      await run(['variable', 'delete', name, '--repo', REPOSITORY, '--env', environment])
    } catch {
      // The final read below decides whether a failed response represents a failed delete.
    }
  }
  const after = await listEnvironmentVariables(environment, run)
  if (after.has(name)) {
    throw new Error(`The temporary GitHub variable remains present: ${name}`)
  }
}

async function ensureNoProviderCreationPending(environment) {
  const variables = await listEnvironmentVariables(environment)
  if (variables.has('EPHEMERAL_PROVIDER_CREATION_PENDING')) {
    throw new Error('A prior provider-credential creation attempt remains unresolved.')
  }
}

async function clearGithubCredentialState(environment) {
  const failures = []
  try {
    await assertNoRepositoryCredentialState()
  } catch (error) {
    failures.push(error)
  }
  try {
    await removeCredentialSecrets(environment)
  } catch (error) {
    failures.push(error)
  }
  try {
    await removeEnvironmentVariable(environment, 'EPHEMERAL_LEASE_GRANT')
  } catch (error) {
    failures.push(error)
  }
  try {
    await assertNoRepositoryCredentialState()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'GitHub temporary credential cleanup could not be proven.')
  }
}

async function setSecret(environment, name, value) {
  await runGh(['secret', 'set', name, '--repo', REPOSITORY, '--env', environment], { input: value })
}

async function setVariable(environment, name, value) {
  await runGh(['variable', 'set', name, '--repo', REPOSITORY, '--env', environment, '--body', value])
}

async function getVariable(environment, name) {
  return runGh(['variable', 'get', name, '--repo', REPOSITORY, '--env', environment])
}

async function assertCleanupReceiptUnchanged(environment, expectedReceipt) {
  const current = await getVariable(environment, 'EPHEMERAL_CLEANUP_RECEIPT')
  if (current !== expectedReceipt) {
    throw new Error('The signed cleanup receipt changed before its exact successor could be stored.')
  }
}

async function storePendingJournal(environment, journal) {
  await setVariable(environment, 'EPHEMERAL_PROVIDER_CREATION_PENDING', journal)
  const stored = await getVariable(environment, 'EPHEMERAL_PROVIDER_CREATION_PENDING')
  if (stored !== journal) {
    throw new Error('GitHub did not preserve the exact provider-creation phase journal.')
  }
}

async function removeExactPendingJournal(environment, expectedJournal) {
  const current = await getVariable(environment, 'EPHEMERAL_PROVIDER_CREATION_PENDING')
  if (current !== expectedJournal) {
    throw new Error('Provider-creation journal changed before its exact removal.')
  }
  await removeEnvironmentVariable(environment, 'EPHEMERAL_PROVIDER_CREATION_PENDING')
}

async function loadKeys() {
  const [privateKey, publicKey] = await Promise.all([
    loadProtectedEphemeralReleaseKey(),
    readFile('config/ephemeral-release-public-key.pem', 'utf8'),
  ])
  if (publicKeyFingerprint(privateKey) !== publicKeyFingerprint(publicKey)) {
    throw new Error('Protected supervisor key does not match the pinned public key.')
  }
  return { privateKey, publicKey }
}

async function nextInputLine(inputIterator, label) {
  const result = await inputIterator.next()
  if (result.done || typeof result.value !== 'string' || Buffer.byteLength(result.value) > INPUT_MAX_BYTES) {
    throw new Error(`${label} was not supplied safely over standard input.`)
  }
  return result.value
}

export function readHiddenTtyLine({ input = process.stdin, output = process.stdout } = {}) {
  if (!input?.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Hidden credential input requires an interactive terminal.')
  }
  return new Promise((resolvePromise, rejectPromise) => {
    let value = ''
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      input.off('data', onData)
      input.off('error', onError)
      input.off('end', onEnd)
      input.setRawMode(false)
      output.write('\n')
      if (error) rejectPromise(error)
      else resolvePromise(value)
    }
    const onError = () => finish(new Error('Hidden credential input failed.'))
    const onEnd = () => finish(new Error('Hidden credential input ended unexpectedly.'))
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      for (const byte of bytes) {
        if (byte === 3) {
          finish(new Error('Hidden credential input was cancelled.'))
          return
        }
        if (byte === 13 || byte === 10) {
          finish(null)
          return
        }
        if (byte === 8 || byte === 127) {
          value = value.slice(0, -1)
          continue
        }
        if (byte >= 32 && byte <= 126) {
          value += String.fromCharCode(byte)
          if (Buffer.byteLength(value, 'utf8') > INPUT_MAX_BYTES) {
            finish(new Error('Hidden credential input was oversized.'))
            return
          }
        }
      }
    }
    input.on('data', onData)
    input.once('error', onError)
    input.once('end', onEnd)
    input.setRawMode(true)
    input.resume()
  })
}

async function bootstrap(environment, inputIterator) {
  const contract = CONTRACTS[environment]
  if (!contract) throw new Error('Bootstrap environment must be staging or production.')
  const { privateKey, publicKey } = await loadKeys()
  process.stdout.write(`After checking both provider dashboards, provide public-safe legacy credential hashes and the exact operator confirmation for ${environment} as one JSON line.\n`)
  const raw = await nextInputLine(inputIterator, 'Bootstrap evidence')
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    throw new Error('Bootstrap evidence is not valid JSON.')
  }
  exactKeys(input, ['legacy_credentials', 'confirmation'], 'Bootstrap evidence')
  if (input.confirmation !== 'I_VERIFIED_LEGACY_PROVIDER_CREDENTIALS_ABSENT') {
    throw new Error('Bootstrap requires an explicit operator dashboard-attestation confirmation.')
  }
  if (!Array.isArray(input.legacy_credentials)) throw new Error('Bootstrap legacy_credentials must be an array.')
  const credentials = input.legacy_credentials.map((entry) => {
    exactKeys(entry, ['provider', 'credential_id_hash'], 'Bootstrap legacy credential')
    if (!HASH_PATTERN.test(entry.credential_id_hash)) throw new Error('Bootstrap credential hash is malformed.')
    return { provider: entry.provider, credentialIdHash: entry.credential_id_hash }
  })
  await ensureNoProviderCreationPending(environment)
  await clearGithubCredentialState(environment)
  const receipt = createInitialCleanupReceipt({
    environment,
    legacyCredentials: credentials,
    privateKey,
  })
  verifySignedAttestation(receipt, publicKey, 'cleanup_receipt')
  await setVariable(environment, 'EPHEMERAL_CLEANUP_RECEIPT', receipt)
  const stored = await getVariable(environment, 'EPHEMERAL_CLEANUP_RECEIPT')
  if (stored !== receipt) throw new Error('GitHub did not preserve the exact signed bootstrap receipt.')
  console.log(`Signed ${environment} operator-dashboard bootstrap attestation recorded (${attestationEnvelopeHash(receipt)}).`)
}

async function readProviderCredentials(inputIterator, expectedPatLabel, storageBackup) {
  const readToken = async (prompt, label, { allowEmpty = false } = {}) => {
    while (true) {
      console.log(prompt)
      const value = await nextInputLine(inputIterator, label)
      if ((allowEmpty && value === '') || (value.length >= 20 && !/[\r\n\0]/.test(value))) {
        return value
      }
      console.error(`${label} was rejected locally. Enter it again; nothing was transmitted.`)
    }
  }
  return {
    supabase_pat: await readToken('Enter the Supabase PAT (input is hidden).', 'Supabase PAT'),
    supabase_pat_label: expectedPatLabel,
    cloudflare_pages_token: await readToken('Enter the Cloudflare Pages token (input is hidden).', 'Cloudflare Pages token'),
    cloudflare_worker_token: storageBackup
      ? await readToken('Enter the Cloudflare Worker token (input is hidden).', 'Cloudflare Worker token')
      : '',
  }
}

export async function finalizeEphemeralReleaseLifecycle({
  operationFailure = null,
  clearGithub,
  confirmProviderRevocation,
  verifyProviderInactivity,
  recordCleanup,
}) {
  const failures = []
  let githubCleared = false
  let providersInactive = false
  try {
    await clearGithub()
    githubCleared = true
  } catch (error) {
    failures.push(error)
  }
  try {
    await confirmProviderRevocation()
    await verifyProviderInactivity()
    providersInactive = true
  } catch (error) {
    failures.push(error)
  }
  if (githubCleared && providersInactive) {
    try {
      await recordCleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (operationFailure) failures.push(operationFailure)
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Ephemeral release did not complete every required lifecycle phase.')
  }
}

export function parseDispatchedRunId(output) {
  if (typeof output !== 'string') throw new Error('GitHub workflow dispatch output is malformed.')
  const ids = output
    .split(/\r?\n/)
    .map((line) => line.trim().match(RUN_URL_PATTERN)?.[1] ?? null)
    .filter(Boolean)
  if (ids.length > 1 || new Set(ids).size > 1) {
    throw new Error('GitHub workflow dispatch returned ambiguous run URLs.')
  }
  return ids[0] ?? null
}

function validateDispatchedRun(run, contract, expectedTitle, commitSha, expectedRunId = null) {
  if (
    !run
    || !Number.isSafeInteger(run.databaseId)
    || run.databaseId <= 0
    || (expectedRunId !== null && String(run.databaseId) !== expectedRunId)
    || run.displayTitle !== expectedTitle
    || run.headSha !== commitSha
    || run.attempt !== 1
    || run.event !== 'workflow_dispatch'
    || run.headBranch !== 'main'
    || run.workflowName !== contract.workflowName
    || run.url !== `https://github.com/${REPOSITORY}/actions/runs/${run.databaseId}`
  ) {
    throw new Error('The dispatched GitHub run does not match the exact supervised lease.')
  }
  return run
}

export function credentialGateResult(run, contract) {
  if (!Array.isArray(run?.jobs)) return 'indeterminate'
  const jobs = run.jobs.filter((job) => job?.name === contract.jobName)
  if (jobs.length !== 1 || jobs[0].status !== 'completed') return 'indeterminate'
  const steps = Array.isArray(jobs[0].steps) ? jobs[0].steps : []
  const conclusions = [
    'Verify the signed current ephemeral lease',
    'Verify the signed cumulative credential cleanup receipt',
  ].map((name) => {
    const matching = steps.filter((step) => step?.name === name)
    if (
      matching.length !== 1
      || matching[0].status !== 'completed'
      || !TERMINAL_GATE_CONCLUSIONS.has(matching[0].conclusion)
    ) return null
    return matching[0].conclusion
  })
  if (conclusions.some((conclusion) => conclusion === null)) return 'indeterminate'
  return conclusions.every((conclusion) => conclusion === 'success') ? 'succeeded' : 'failed'
}

export function credentialGatesSucceeded(run, contract) {
  return credentialGateResult(run, contract) === 'succeeded'
}

export function credentialInjectionProbeResult(run, contract = STAGING_CREDENTIAL_INJECTION_PROBE_CONTRACT) {
  if (!Array.isArray(run?.jobs) || run?.status !== 'completed') return 'indeterminate'
  if (!TERMINAL_GATE_CONCLUSIONS.has(run.conclusion)) return 'indeterminate'
  if (run.conclusion !== 'success') return 'failed'
  const jobs = run.jobs.filter((job) => job?.name === contract.jobName)
  if (jobs.length !== 1 || jobs[0].status !== 'completed') return 'indeterminate'
  if (!TERMINAL_GATE_CONCLUSIONS.has(jobs[0].conclusion)) return 'indeterminate'
  if (jobs[0].conclusion !== 'success') return 'failed'
  const steps = Array.isArray(jobs[0].steps) ? jobs[0].steps : []
  const verificationSteps = steps.filter((step) => step?.name === contract.verificationStep)
  if (verificationSteps.length !== 1) return 'failed'
  const [verificationStep] = verificationSteps
  if (verificationStep.status !== 'completed' || !TERMINAL_GATE_CONCLUSIONS.has(verificationStep.conclusion)) {
    return 'indeterminate'
  }
  return verificationStep.conclusion === 'success' ? 'succeeded' : 'failed'
}

// A dashboard-only revocation attestation is acceptable only when the exact
// supervised run is terminal, unsuccessful, and GitHub proves that its Pages
// write step was skipped. This lets recovery close a pre-deployment failure or
// an intentional cancellation without requiring an already-deleted credential
// to be re-entered, while never treating a possible Pages mutation as safely
// aborted.
export function failedBeforePagesMutation(run, contract) {
  if (
    !contract?.jobName
    || !contract?.pagesMutationStep
    || run?.status !== 'completed'
    || !['failure', 'cancelled'].includes(run?.conclusion)
    || !Array.isArray(run?.jobs)
  ) return false
  const jobs = run.jobs.filter((job) => job?.name === contract.jobName)
  if (jobs.length !== 1 || jobs[0].status !== 'completed' || !Array.isArray(jobs[0].steps)) return false
  const mutationSteps = jobs[0].steps.filter((step) => step?.name === contract.pagesMutationStep)
  return mutationSteps.length === 1
    && mutationSteps[0].status === 'completed'
    && mutationSteps[0].conclusion === 'skipped'
}

function journalRunEvidence(run) {
  return Object.freeze({
    run_id: String(run.databaseId),
    run_attempt: run.attempt,
    display_title: run.displayTitle,
    updated_at: run.updatedAt,
  })
}

export async function findDispatchedRun(contract, expectedTitle, commitSha, {
  dispatchOutput = '',
  dispatchedAfter = Date.now(),
  attempts = DISPATCH_RECONCILIATION_ATTEMPTS,
  wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  runGhImpl = runGh,
  runDetailsImpl = runDetails,
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || typeof wait !== 'function') {
    throw new Error('Dispatch reconciliation options are invalid.')
  }
  const exactRunId = parseDispatchedRunId(dispatchOutput)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (exactRunId !== null) {
      try {
        const details = await runDetailsImpl(exactRunId)
        return validateDispatchedRun(details, contract, expectedTitle, commitSha, exactRunId)
      } catch (error) {
        if (attempt === attempts || /does not match/.test(String(error?.message || ''))) throw error
      }
    } else {
      const raw = await runGhImpl([
        'run', 'list', '--repo', REPOSITORY, '--workflow', contract.workflow, '--branch', 'main',
        '--event', 'workflow_dispatch', '--limit', '100',
        '--json', 'databaseId,displayTitle,headSha,status,conclusion,createdAt,updatedAt,attempt,event,headBranch,url,workflowName',
      ])
      let runs
      try {
        runs = JSON.parse(raw)
      } catch {
        throw new Error('GitHub workflow-run list was invalid JSON.')
      }
      if (!Array.isArray(runs)) throw new Error('GitHub workflow-run list was malformed.')
      const matches = runs.filter((run) => (
        run?.displayTitle === expectedTitle
        && run?.headSha === commitSha
        && Number.isFinite(Date.parse(run?.createdAt))
        && Date.parse(run.createdAt) >= dispatchedAfter - 10_000
      ))
      if (matches.length > 1) throw new Error('GitHub returned multiple possible runs for one supervised dispatch.')
      if (matches.length === 1) {
        return validateDispatchedRun(matches[0], contract, expectedTitle, commitSha)
      }
    }
    if (attempt < attempts) await wait(DISPATCH_RECONCILIATION_INTERVAL_MS)
  }
  throw new Error('The exact supervised workflow run did not appear in GitHub.')
}

async function runDetails(runId) {
  const raw = await runGh([
    'run', 'view', String(runId), '--repo', REPOSITORY,
    '--json', 'databaseId,displayTitle,headSha,status,conclusion,createdAt,updatedAt,attempt,event,headBranch,url,workflowName,jobs',
  ])
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('GitHub workflow-run detail was invalid JSON.')
  }
}

async function productionStagingEvidence(commitSha, publicKey, stagingRunId) {
  if (!/^\d+$/.test(stagingRunId || '')) {
    throw new Error('Production requires one exact supervised Staging run identifier.')
  }
  const cleanupReceipt = await getVariable('production', 'STAGING_EPHEMERAL_CLEANUP_RECEIPT')
  const raw = await runGh([
    'api', '--method', 'GET',
    `repos/${REPOSITORY}/actions/runs/${stagingRunId}`,
  ])
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new Error('GitHub Staging workflow-run response was invalid JSON.')
  }
  const run = findTrustedStagingRun([payload], {
    repository: REPOSITORY,
    commitSha,
    runId: stagingRunId,
  })
  verifyCleanupReceiptCoversRun(cleanupReceipt, publicKey, run)
  return Object.freeze({
    runId: String(run.id),
    cleanupReceipt,
  })
}

async function runStagingCredentialInjectionProbe({ commitSha, cleanupReceipt, privateKey }) {
  const probeId = randomBytes(16).toString('hex')
  const supabaseProbeSecret = `probe-supabase-${randomBytes(32).toString('base64url')}`
  const pagesProbeSecret = `probe-pages-${randomBytes(32).toString('base64url')}`
  const probeMaterial = createCredentialInjectionProbe({
    environment: 'staging',
    commitSha,
    probeId,
    cleanupReceipt,
    supabaseProbeSecret,
    pagesProbeSecret,
    privateKey,
  })
  const expectedTitle = `Verify staging ephemeral credential injection ${commitSha} (probe=${probeId})`
  let operationFailure = null
  try {
    await setSecret('staging', 'SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN', supabaseProbeSecret)
    await setSecret('staging', 'STAGING_PAGES_EPHEMERAL_TOKEN', pagesProbeSecret)
    await assertEnvironmentSecretsPresent('staging', [
      'SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN',
      'STAGING_PAGES_EPHEMERAL_TOKEN',
    ])
    console.log('Waiting for GitHub environment-secret propagation before the non-deploying injection probe.')
    await new Promise((resolvePromise) => setTimeout(resolvePromise, SECRET_DISPATCH_PROPAGATION_DELAY_MS))
    const dispatchArguments = [
      'workflow', 'run', STAGING_CREDENTIAL_INJECTION_PROBE_CONTRACT.workflow,
      '--repo', REPOSITORY, '--ref', 'main',
      '-f', `commit_sha=${commitSha}`,
      '-f', `probe_id=${probeId}`,
      '-f', `confirmation=VERIFY buril-lab-staging credential injection ${commitSha} PROBE ${probeId}`,
      '-f', `probe_grant=${probeMaterial.grant}`,
    ]
    const dispatchedAfter = Date.now()
    let dispatchOutput = ''
    let dispatchFailure = null
    try {
      dispatchOutput = await runGh(dispatchArguments)
    } catch (error) {
      dispatchFailure = error
    }
    let probeRun
    try {
      probeRun = await findDispatchedRun(
        STAGING_CREDENTIAL_INJECTION_PROBE_CONTRACT,
        expectedTitle,
        commitSha,
        { dispatchOutput, dispatchedAfter },
      )
    } catch (reconcileError) {
      throw new AggregateError(
        [dispatchFailure, reconcileError].filter(Boolean),
        'The Staging credential-injection probe could not be reconciled to one exact GitHub run.',
      )
    }
    if (dispatchFailure) {
      console.warn('The credential-injection probe dispatch response failed, but its exact created run was reconciled safely.')
    }
    await runGh(['run', 'watch', String(probeRun.databaseId), '--repo', REPOSITORY, '--exit-status'], {
      timeoutMs: 15 * 60 * 1000,
    })
    const details = await runDetails(probeRun.databaseId)
    validateDispatchedRun(
      details,
      STAGING_CREDENTIAL_INJECTION_PROBE_CONTRACT,
      expectedTitle,
      commitSha,
      String(probeRun.databaseId),
    )
    if (credentialInjectionProbeResult(details) !== 'succeeded') {
      throw new Error('The exact Staging credential-injection probe did not prove both secret values reached its runner.')
    }
  } catch (error) {
    operationFailure = error
  }
  let cleanupFailure = null
  try {
    await clearGithubCredentialState('staging')
  } catch (error) {
    cleanupFailure = error
  }
  if (operationFailure && cleanupFailure) {
    throw new AggregateError(
      [operationFailure, cleanupFailure],
      'The Staging credential-injection probe and its GitHub cleanup both failed.',
    )
  }
  if (cleanupFailure) throw cleanupFailure
  if (operationFailure) throw operationFailure
}

async function deploy(environment, commitSha, storageBackup, cloudflareAccountId, stagingRunId, inputIterator) {
  const contract = CONTRACTS[environment]
  if (!contract || !FULL_SHA_PATTERN.test(commitSha)) throw new Error('Deploy target is invalid.')
  if (typeof storageBackup !== 'boolean' || (environment === 'production' && storageBackup)) {
    throw new Error('Deploy storage-backup selection is invalid.')
  }
  if (!/^[0-9a-f]{32}$/.test(cloudflareAccountId || '')) throw new Error('Cloudflare account identifier is malformed.')
  const { privateKey, publicKey } = await loadKeys()
  const cleanupReceipt = await getVariable(environment, 'EPHEMERAL_CLEANUP_RECEIPT')
  const cleanupPayload = verifySignedAttestation(cleanupReceipt, publicKey, 'cleanup_receipt').payload
  if (cleanupPayload.environment !== environment) throw new Error('Current signed cleanup receipt belongs to another environment.')
  if (
    !Array.isArray(cleanupPayload.leases)
    || cleanupPayload.sequence !== cleanupPayload.leases.length
    || cleanupPayload.leases.length >= MAX_CUMULATIVE_LEASES
  ) {
    throw new Error('The signed cleanup receipt epoch must be reviewed and rolled over before another credential is created.')
  }
  await ensureNoProviderCreationPending(environment)
  await clearGithubCredentialState(environment)
  if (environment === 'staging' && stagingRunId !== undefined) {
    throw new Error('Staging deploy must not accept a Production-only Staging run identifier.')
  }
  const stagingEvidence = environment === 'production'
    ? await productionStagingEvidence(commitSha, publicKey, stagingRunId)
    : null
  if (environment === 'staging') {
    await runStagingCredentialInjectionProbe({ commitSha, cleanupReceipt, privateKey })
  }

  const leaseId = randomBytes(16).toString('hex')
  const expectedPatLabel = `burillab-${environment}-${leaseId}`
  console.log(`Lease prepared: ${leaseId}`)
  let pendingJournal = createProviderCreationPending({
    environment,
    commitSha,
    leaseId,
    storageBackup,
    supabasePatLabel: expectedPatLabel,
    cloudflareAccountId,
    cleanupReceipt,
    privateKey,
  })
  await storePendingJournal(environment, pendingJournal)
  console.log(`Create the shortest-lived provider credentials now. Supabase PAT label must be: ${expectedPatLabel}`)
  console.log('Enter each provider secret at the hidden prompts. The values are never passed in process arguments.')
  let credentials
  try {
    credentials = await readProviderCredentials(inputIterator, expectedPatLabel, storageBackup)
  } catch (error) {
    let githubFailure = null
    try {
      await clearGithubCredentialState(environment)
    } catch (cleanupError) {
      githubFailure = cleanupError
    }
    console.error('Provider credential capture did not finish. Revoke every credential created for this lease; the pending marker intentionally remains until manual verification.')
    throw new AggregateError([error, ...(githubFailure ? [githubFailure] : [])], 'Provider credential capture did not complete safely.')
  }

  let run
  let material
  let operationFailure = null
  let expectedTitle = null
  let dispatched = false
  let preDispatchStage = 'Supabase PAT verification'
  try {
    await verifyActiveSupabasePat(credentials.supabase_pat, contract.projectRef)
    preDispatchStage = 'Cloudflare Pages token verification'
    const pageMetadata = await verifyCloudflareTokenTtl({
      CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
      CLOUDFLARE_EPHEMERAL_TOKEN: credentials.cloudflare_pages_token,
    })
    const hashes = [pageMetadata.tokenIdHash]
    if (storageBackup) {
      const workerMetadata = await verifyCloudflareTokenTtl({
        CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
        CLOUDFLARE_EPHEMERAL_TOKEN: credentials.cloudflare_worker_token,
      })
      hashes.push(workerMetadata.tokenIdHash)
    }
    preDispatchStage = 'lease material creation'
    material = createLeaseMaterial({
      environment,
      commitSha,
      leaseId,
      storageBackup,
      cleanupReceipt,
      cloudflareTokenIdHashes: hashes,
      cloudflareTokens: [
        credentials.cloudflare_pages_token,
        ...(credentials.cloudflare_worker_token ? [credentials.cloudflare_worker_token] : []),
      ],
      supabasePatLabel: credentials.supabase_pat_label,
      supabasePat: credentials.supabase_pat,
      stagingRunId: stagingEvidence?.runId ?? null,
      stagingCleanupReceipt: stagingEvidence?.cleanupReceipt ?? null,
      privateKey,
    })
    pendingJournal = advanceProviderCreationJournal({
      journal: pendingJournal,
      publicKey,
      privateKey,
      nextPhase: 'lease_materialized',
      leaseEvidence: {
        grant_sha256: attestationEnvelopeHash(material.grant),
        cloudflare_token_id_hashes: [...material.cloudflareTokenIdHashes],
        cloudflare_token_sha256: [...material.cloudflareTokenSha256],
        supabase_pat_label_hash: material.supabasePatLabelHash,
        supabase_pat_sha256: material.supabasePatSha256,
      },
    })
    await storePendingJournal(environment, pendingJournal)
    preDispatchStage = 'GitHub temporary credential setup'
    await setVariable(environment, 'EPHEMERAL_LEASE_GRANT', material.grant)
    await setSecret(environment, 'SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN', credentials.supabase_pat)
    const pageSecretName = environment === 'staging'
      ? 'STAGING_PAGES_EPHEMERAL_TOKEN'
      : 'PRODUCTION_PAGES_EPHEMERAL_TOKEN'
    await setSecret(environment, pageSecretName, credentials.cloudflare_pages_token)
    if (storageBackup) {
      await setSecret(environment, 'STAGING_WORKER_EPHEMERAL_TOKEN', credentials.cloudflare_worker_token)
    }
    await assertEnvironmentSecretsPresent(environment, [
      'SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN',
      pageSecretName,
      ...(storageBackup ? ['STAGING_WORKER_EPHEMERAL_TOKEN'] : []),
    ])
    console.log('Waiting for GitHub environment-secret propagation before the supervised deployment dispatch.')
    await new Promise((resolvePromise) => setTimeout(resolvePromise, SECRET_DISPATCH_PROPAGATION_DELAY_MS))

    preDispatchStage = 'GitHub workflow dispatch'
    const confirmation = environment === 'staging'
      ? `DEPLOY buril-lab-staging ${commitSha} LEASE ${leaseId} WITH EPHEMERAL TOKENS`
      : `DEPLOY buril-lab production ${commitSha} STAGING ${stagingEvidence.runId} LEASE ${leaseId} WITH EPHEMERAL TOKENS`
    const dispatchArguments = [
      'workflow', 'run', contract.workflow, '--repo', REPOSITORY, '--ref', 'main',
      '-f', `commit_sha=${commitSha}`,
      '-f', `lease_id=${leaseId}`,
      '-f', `confirmation=${confirmation}`,
    ]
    if (environment === 'staging') {
      dispatchArguments.push('-f', `deploy_storage_backup=${storageBackup}`)
      // The grant contains signed hashes, never a provider secret. It is passed
      // as an immutable dispatch input because environment variables can be
      // snapshotted before a just-written value becomes visible to a runner.
      dispatchArguments.push('-f', `lease_grant=${material.grant}`)
    } else {
      dispatchArguments.push('-f', `staging_run_id=${stagingEvidence.runId}`)
    }
    expectedTitle = environment === 'staging'
      ? `Deploy staging ${commitSha} (lease=${leaseId}, storage-backup=${storageBackup})`
      : `Deploy production ${commitSha} (lease=${leaseId})`
    pendingJournal = advanceProviderCreationJournal({
      journal: pendingJournal,
      publicKey,
      privateKey,
      nextPhase: 'dispatch_intent',
    })
    await storePendingJournal(environment, pendingJournal)
    const dispatchedAfter = Date.now()
    let dispatchOutput = ''
    let dispatchFailure = null
    try {
      dispatchOutput = await runGh(dispatchArguments)
    } catch (error) {
      dispatchFailure = error
    }
    try {
      run = await findDispatchedRun(contract, expectedTitle, commitSha, {
        dispatchOutput,
        dispatchedAfter,
      })
      dispatched = true
      pendingJournal = advanceProviderCreationJournal({
        journal: pendingJournal,
        publicKey,
        privateKey,
        nextPhase: 'run_bound',
        runEvidence: journalRunEvidence(run),
      })
      await storePendingJournal(environment, pendingJournal)
    } catch (reconcileError) {
      throw new AggregateError(
        [dispatchFailure, reconcileError].filter(Boolean),
        'The supervised dispatch could not be reconciled to one exact GitHub run.',
      )
    }
    if (dispatchFailure) {
      console.warn('The dispatch response failed, but the exact created run was reconciled safely.')
    }
    await runGh(['run', 'watch', String(run.databaseId), '--repo', REPOSITORY, '--exit-status'], {
        timeoutMs: 45 * 60 * 1000,
    })
  } catch (error) {
    // The original error can contain provider or transport details.  Keep the
    // terminal diagnostic useful without ever serializing credential material.
    console.error(`Supervised release stopped during ${preDispatchStage}; no further deployment action will be attempted.`)
    operationFailure = error
  }

  await finalizeEphemeralReleaseLifecycle({
    operationFailure,
    clearGithub: () => clearGithubCredentialState(environment),
    confirmProviderRevocation: async () => {
      console.log('GitHub cleanup has been attempted. Revoke the exact Cloudflare token(s) and Supabase PAT in their provider dashboards now, then send an empty line.')
      await nextInputLine(inputIterator, 'Provider revocation confirmation')
    },
    verifyProviderInactivity: async () => {
      await verifyInactiveCloudflareToken(credentials.cloudflare_pages_token, cloudflareAccountId)
      if (credentials.cloudflare_worker_token) {
        await verifyInactiveCloudflareToken(credentials.cloudflare_worker_token, cloudflareAccountId)
      }
      await verifyInactiveSupabasePat(credentials.supabase_pat)
    },
    recordCleanup: async () => {
      if (dispatched && !run && expectedTitle) {
        throw new Error('The exact dispatched run identifier was lost and cannot be reconstructed safely.')
      }
      if (!run || !material) {
        assertProviderCreationRunAbsenceCanAbort({ journal: pendingJournal, publicKey })
        await removeExactPendingJournal(environment, pendingJournal)
        return
      }
      const details = await runDetails(run.databaseId)
      validateDispatchedRun(details, contract, expectedTitle, commitSha, String(run.databaseId))
      if (details.status !== 'completed') {
        throw new Error('The exact supervised workflow run is not terminal or no longer matches its lease.')
      }
      const gateResult = credentialGateResult(details, contract)
      if (gateResult === 'indeterminate') {
        throw new Error('GitHub gate evidence is incomplete; the signed journal remains for retry.')
      }
      const gatesSucceeded = gateResult === 'succeeded'
      const journalState = verifyProviderCreationJournal(pendingJournal, publicKey).payload
      if (journalState.phase === 'dispatch_intent') {
        pendingJournal = advanceProviderCreationJournal({
          journal: pendingJournal,
          publicKey,
          privateKey,
          nextPhase: 'run_bound',
          runEvidence: journalRunEvidence(details),
        })
        await storePendingJournal(environment, pendingJournal)
      }
      pendingJournal = advanceProviderCreationJournal({
        journal: pendingJournal,
        publicKey,
        privateKey,
        nextPhase: 'gates_verified',
        runEvidence: journalRunEvidence(details),
        credentialGatesSucceeded: gatesSucceeded,
      })
      await storePendingJournal(environment, pendingJournal)
      if (!gatesSucceeded) {
        await removeExactPendingJournal(environment, pendingJournal)
        console.log(`Run ${details.databaseId} never passed both credential gates; the cleanup receipt remains unchanged.`)
        return
      }
      await assertCleanupReceiptUnchanged(environment, cleanupReceipt)
      const receipt = appendClosedLeaseReceipt({
        previousReceipt: cleanupReceipt,
        environment,
        run: {
          id: details.databaseId,
          runAttempt: details.attempt,
          commitSha,
          leaseId,
          storageBackup,
          updatedAt: details.updatedAt,
        },
        cloudflareTokenIdHashes: material.cloudflareTokenIdHashes,
        supabasePatLabelHash: material.supabasePatLabelHash,
        supabasePatSha256: material.supabasePatSha256,
        publicKey,
        privateKey,
      })
      await setVariable(environment, 'EPHEMERAL_CLEANUP_RECEIPT', receipt)
      const stored = await getVariable(environment, 'EPHEMERAL_CLEANUP_RECEIPT')
      if (stored !== receipt) throw new Error('GitHub did not preserve the exact signed cleanup receipt.')
      verifyProviderCreationCleanupSuccessor({
        journal: pendingJournal,
        cleanupReceipt: receipt,
        publicKey,
      })
      pendingJournal = advanceProviderCreationJournal({
        journal: pendingJournal,
        publicKey,
        privateKey,
        nextPhase: 'cleanup_receipt_stored',
        successorCleanupReceipt: receipt,
      })
      await storePendingJournal(environment, pendingJournal)
      if (environment === 'staging') {
        await setVariable('production', 'STAGING_EPHEMERAL_CLEANUP_RECEIPT', receipt)
        const productionStored = await getVariable('production', 'STAGING_EPHEMERAL_CLEANUP_RECEIPT')
        if (productionStored !== receipt) {
          throw new Error('Production did not preserve the exact signed Staging cleanup receipt.')
        }
      }
      await removeExactPendingJournal(environment, pendingJournal)
      console.log(`Provider inactivity and signed cleanup recorded for run ${details.databaseId} (${attestationEnvelopeHash(receipt)}).`)
    },
  })
}

export function verifyPendingMarker(rawMarker, publicKey, {
  environment,
  leaseId,
  cloudflareAccountId,
}) {
  const signed = verifyProviderCreationJournal(rawMarker, publicKey)
  const payload = signed.payload
  const contract = CONTRACTS[environment]
  if (
    !contract
    || payload.environment !== environment
    || payload.workflow !== contract.workflow
    || payload.lease_id !== leaseId
    || payload.cloudflare_account_id !== cloudflareAccountId
    || !FULL_SHA_PATTERN.test(payload.commit_sha)
    || !/^[0-9a-f]{32}$/.test(payload.lease_id)
    || typeof payload.storage_backup !== 'boolean'
    || (environment === 'production' && payload.storage_backup)
    || payload.supabase_pat_label !== `burillab-${environment}-${leaseId}`
    || !Number.isFinite(Date.parse(payload.started_at))
    || Date.parse(payload.started_at) > Date.now() + 5 * 60 * 1000
  ) {
    throw new Error('Provider-creation pending marker does not match the exact aborted lease.')
  }
  return Object.freeze({ payload, markerHash: signed.journalHash })
}

export function verifyAbortedLeaseReceipt(rawReceipt, publicKey, pending) {
  const signed = verifySignedAttestation(rawReceipt, publicKey, 'aborted_lease_receipt')
  const payload = signed.payload
  exactKeys(payload, [
    'version', 'kind', 'environment', 'workflow', 'commit_sha', 'lease_id', 'storage_backup',
    'phase_journal_sha256', 'cleanup_receipt_sha256', 'recovered_at', 'provider_evidence',
    'supervisor_key_id',
  ], 'Aborted lease receipt')
  if (
    payload.version !== 2
    || payload.environment !== pending.payload.environment
    || payload.workflow !== pending.payload.workflow
    || payload.commit_sha !== pending.payload.commit_sha
    || payload.lease_id !== pending.payload.lease_id
    || payload.storage_backup !== pending.payload.storage_backup
    || payload.phase_journal_sha256 !== pending.markerHash
    || payload.cleanup_receipt_sha256 !== pending.payload.base_cleanup_receipt_sha256
    || !Number.isFinite(Date.parse(payload.recovered_at))
    || !Array.isArray(payload.provider_evidence)
  ) {
    throw new Error('Aborted lease receipt does not match the exact pending marker.')
  }
  return signed
}

async function getOptionalVariable(environment, name) {
  const variables = await listEnvironmentVariables(environment)
  return variables.has(name) ? getVariable(environment, name) : null
}

function expectedJournalRunTitle(payload) {
  return payload.environment === 'staging'
    ? `Deploy staging ${payload.commit_sha} (lease=${payload.lease_id}, storage-backup=${payload.storage_backup})`
    : `Deploy production ${payload.commit_sha} (lease=${payload.lease_id})`
}

export async function findJournalRun(pending, {
  run = runGh,
  getRunDetails = runDetails,
  wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  attempts = 12,
} = {}) {
  const contract = CONTRACTS[pending.payload.environment]
  const expectedTitle = expectedJournalRunTitle(pending.payload)
  if (pending.payload.run_evidence) {
    const details = await getRunDetails(pending.payload.run_evidence.run_id)
    return validateDispatchedRun(
      details,
      contract,
      expectedTitle,
      pending.payload.commit_sha,
      pending.payload.run_evidence.run_id,
    )
  }

  const startedAt = Date.parse(pending.payload.started_at)
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 12) {
    throw new Error('Recovery workflow lookup attempt count is invalid.')
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const matchingRunIds = new Set()
    let historyComplete = false
    for (let page = 1; page <= MAX_RECOVERY_RUN_PAGES; page += 1) {
      const raw = await run([
        'api', '--method', 'GET',
        `repos/${REPOSITORY}/actions/workflows/${contract.workflow}/runs?branch=main&event=workflow_dispatch&per_page=${RECOVERY_RUNS_PER_PAGE}&page=${page}`,
      ])
      let payload
      try {
        payload = JSON.parse(raw)
      } catch {
        throw new Error('GitHub recovery workflow-run page was invalid JSON.')
      }
      const runs = payload?.workflow_runs
      if (!Array.isArray(runs)) throw new Error('GitHub recovery workflow-run page was malformed.')
      for (const candidate of runs) {
        if (
          candidate?.display_title === expectedTitle
          && candidate?.head_sha === pending.payload.commit_sha
          && Number.isSafeInteger(candidate?.id)
          && candidate.id > 0
          && Number.isFinite(Date.parse(candidate?.created_at))
          && Date.parse(candidate.created_at) >= startedAt - RECOVERY_CLOCK_SKEW_MS
        ) {
          matchingRunIds.add(String(candidate.id))
        }
      }
      if (matchingRunIds.size > 1) {
        throw new Error('Recovery found multiple runs for one signed dispatch intent.')
      }
      const createdTimes = runs
        .map((candidate) => Date.parse(candidate?.created_at))
        .filter(Number.isFinite)
      const reachedJournalStart = createdTimes.some((createdAt) => createdAt < startedAt - RECOVERY_CLOCK_SKEW_MS)
      if (runs.length < RECOVERY_RUNS_PER_PAGE || reachedJournalStart) {
        historyComplete = true
        break
      }
      if (page === MAX_RECOVERY_RUN_PAGES) {
        throw new Error('GitHub recovery history exceeds the bounded audit window; the signed journal remains.')
      }
    }
    if (!historyComplete) {
      throw new Error('GitHub recovery history completeness could not be proven.')
    }
    if (matchingRunIds.size === 1) {
      const [runId] = matchingRunIds
      const details = await getRunDetails(runId)
      return validateDispatchedRun(
        details,
        contract,
        expectedTitle,
        pending.payload.commit_sha,
        runId,
      )
    }
    if (attempt < attempts) await wait(5_000)
  }
  return null
}

async function collectRecoveryProviderEvidence(
  pending,
  cloudflareAccountId,
  inputIterator,
  { allowMaterializedDashboardRevocation = false } = {},
) {
  const providers = pending.payload.storage_backup
    ? ['supabase', 'cloudflare_pages', 'cloudflare_worker']
    : ['supabase', 'cloudflare_pages']
  const providerEvidence = []
  for (const provider of providers) {
    const notCreatedConfirmation = `NOT_CREATED:${pending.payload.lease_id}:${provider}`
    const dashboardRevokedConfirmation = `DASHBOARD_REVOKED:${pending.payload.lease_id}:${provider}`
    console.log(`Enter the revoked ${provider} credential, exactly ${notCreatedConfirmation} when it was not created, or exactly ${dashboardRevokedConfirmation} when it was created and revoked in the provider dashboard before the supervisor captured it.`)
    const value = await nextInputLine(inputIterator, `${provider} recovery evidence`)
    if (value === notCreatedConfirmation) {
      if (pending.payload.lease_evidence) {
        throw new Error(`${provider} was already materialized in the signed phase journal; exact revoked credential proof is required.`)
      }
      providerEvidence.push({
        provider,
        status: 'operator_verified_not_created',
        credentialSha256: null,
      })
      continue
    }
    if (value === dashboardRevokedConfirmation) {
      if (pending.payload.lease_evidence && !allowMaterializedDashboardRevocation) {
        throw new Error(`${provider} was already materialized in the signed phase journal; exact revoked credential proof is required.`)
      }
      providerEvidence.push({
        provider,
        status: pending.payload.lease_evidence
          ? 'operator_verified_dashboard_revoked_pre_deployment'
          : 'operator_verified_dashboard_revoked',
        credentialSha256: null,
      })
      continue
    }
    if (value.length < 20 || /[\r\n\0]/.test(value)) {
      throw new Error(`${provider} recovery credential is malformed; the phase journal remains.`)
    }
    if (provider === 'supabase') await verifyInactiveSupabasePat(value)
    else await verifyInactiveCloudflareToken(value, cloudflareAccountId)
    providerEvidence.push({
      provider,
      status: 'api_verified_inactive',
      credentialSha256: sha256(value),
    })
  }
  return providerEvidence
}

async function publishStagingCleanupSuccessor(environment, receipt) {
  if (environment !== 'staging') return
  await setVariable('production', 'STAGING_EPHEMERAL_CLEANUP_RECEIPT', receipt)
  const productionStored = await getVariable('production', 'STAGING_EPHEMERAL_CLEANUP_RECEIPT')
  if (productionStored !== receipt) {
    throw new Error('Production did not preserve the recovered exact Staging cleanup receipt.')
  }
}

async function recoverPendingProviderCreation(environment, leaseId, cloudflareAccountId, inputIterator) {
  const contract = CONTRACTS[environment]
  if (!contract || !/^[0-9a-f]{32}$/.test(leaseId || '') || !/^[0-9a-f]{32}$/.test(cloudflareAccountId || '')) {
    throw new Error('Pending recovery target is malformed.')
  }
  const { privateKey, publicKey } = await loadKeys()
  await assertNoRepositoryCredentialState()
  const [rawMarker, cleanupReceipt, rawLeaseGrant] = await Promise.all([
    getOptionalVariable(environment, 'EPHEMERAL_PROVIDER_CREATION_PENDING'),
    getVariable(environment, 'EPHEMERAL_CLEANUP_RECEIPT'),
    getOptionalVariable(environment, 'EPHEMERAL_LEASE_GRANT'),
  ])
  if (!rawMarker) {
    const lastReceipt = await getOptionalVariable(environment, 'EPHEMERAL_LAST_ABORTED_LEASE_RECEIPT')
    if (lastReceipt) {
      const signed = verifySignedAttestation(lastReceipt, publicKey, 'aborted_lease_receipt')
      if (signed.payload.environment === environment && signed.payload.lease_id === leaseId) {
        console.log(`Pending lease ${leaseId} was already recovered (${signed.envelopeHash}).`)
        return
      }
    }
    throw new Error('No matching provider-creation pending marker exists.')
  }
  let recoveryMarker = rawMarker
  let pending = verifyPendingMarker(recoveryMarker, publicKey, {
    environment,
    leaseId,
    cloudflareAccountId,
  })
  let leaseGrantState = null
  let leaseGrantFailure = null
  if (rawLeaseGrant) {
    try {
      leaseGrantState = verifyProviderCreationLeaseGrant({
        journal: recoveryMarker,
        leaseGrant: rawLeaseGrant,
        publicKey,
      })
    } catch (error) {
      leaseGrantFailure = error
    }
  }
  if (leaseGrantState?.phaseRollbackDetected) {
    recoveryMarker = advanceProviderCreationJournal({
      journal: recoveryMarker,
      publicKey,
      privateKey,
      nextPhase: 'lease_materialized',
      leaseEvidence: leaseGrantState.leaseEvidence,
    })
    await storePendingJournal(environment, recoveryMarker)
    pending = verifyPendingMarker(recoveryMarker, publicKey, {
      environment,
      leaseId,
      cloudflareAccountId,
    })
    leaseGrantState = verifyProviderCreationLeaseGrant({
      journal: recoveryMarker,
      leaseGrant: rawLeaseGrant,
      publicKey,
    })
  }
  const cleanupState = resolveProviderCreationCleanupState({
    journal: recoveryMarker,
    cleanupReceipt,
    publicKey,
  })

  if (cleanupState.state === 'successor') {
    let completedJournal = recoveryMarker
    if (pending.payload.phase === 'gates_verified') {
      completedJournal = advanceProviderCreationJournal({
        journal: recoveryMarker,
        publicKey,
        privateKey,
        nextPhase: 'cleanup_receipt_stored',
        successorCleanupReceipt: cleanupReceipt,
      })
      await storePendingJournal(environment, completedJournal)
    } else if (pending.payload.phase !== 'cleanup_receipt_stored') {
      throw new Error('Cleanup successor exists before the signed journal reached its recoverable gate phase.')
    }
    await clearGithubCredentialState(environment)
    await publishStagingCleanupSuccessor(environment, cleanupReceipt)
    await removeExactPendingJournal(environment, completedJournal)
    console.log(`Recovered cleanup successor for run ${pending.payload.run_evidence.run_id} (${cleanupState.receiptHash}).`)
    return
  }

  const existingReceipt = await getOptionalVariable(environment, 'EPHEMERAL_LAST_ABORTED_LEASE_RECEIPT')
  if (existingReceipt) {
    let matchesCurrentJournal = false
    try {
      verifyAbortedLeaseReceipt(existingReceipt, publicKey, pending)
      matchesCurrentJournal = true
    } catch {
      // A receipt for an older lease is expected; this lease still needs fresh evidence.
    }
    if (matchesCurrentJournal) {
      await clearGithubCredentialState(environment)
      await removeExactPendingJournal(environment, recoveryMarker)
      console.log(`Recovered pending lease ${leaseId} from its already signed receipt.`)
      return
    }
  }

  await clearGithubCredentialState(environment)
  const discoveredRun = await findJournalRun(pending)
  if (discoveredRun && discoveredRun.status !== 'completed') {
    throw new Error('The exact recovered workflow run is not terminal; credentials are inactive and the journal remains for retry.')
  }
  const allowMaterializedDashboardRevocation = Boolean(
    pending.payload.lease_evidence
    && discoveredRun
    && failedBeforePagesMutation(discoveredRun, contract),
  )
  const providerEvidence = await collectRecoveryProviderEvidence(
    pending,
    cloudflareAccountId,
    inputIterator,
    { allowMaterializedDashboardRevocation },
  )
  verifyProviderCreationRecoveryEvidence({
    journal: recoveryMarker,
    providerEvidence,
    publicKey,
    allowMaterializedDashboardRevocation,
  })
  if (leaseGrantFailure) {
    throw new AggregateError([leaseGrantFailure], 'Stored lease grant could not be reconciled after provider revocation; the signed journal remains.')
  }
  let currentJournal = recoveryMarker
  let currentPending = pending
  const run = discoveredRun ?? await findJournalRun(currentPending)
  if (run && !currentPending.payload.lease_evidence) {
    throw new Error('A workflow run exists but the signed journal lacks its exact lease evidence; the journal remains for review.')
  }
  if (run && currentPending.payload.phase === 'lease_materialized') {
    currentJournal = advanceProviderCreationJournal({
      journal: currentJournal,
      publicKey,
      privateKey,
      nextPhase: 'dispatch_intent',
    })
    await storePendingJournal(environment, currentJournal)
    currentPending = verifyProviderCreationJournal(currentJournal, publicKey)
  }
  if (run && currentPending.payload.phase === 'dispatch_intent') {
    currentJournal = advanceProviderCreationJournal({
      journal: currentJournal,
      publicKey,
      privateKey,
      nextPhase: 'run_bound',
      runEvidence: journalRunEvidence(run),
    })
    await storePendingJournal(environment, currentJournal)
    currentPending = verifyProviderCreationJournal(currentJournal, publicKey)
  }
  if (run && currentPending.payload.phase === 'run_bound') {
    const gateResult = credentialGateResult(run, contract)
    if (gateResult === 'indeterminate') {
      throw new Error('Recovered GitHub gate evidence is incomplete; the signed journal remains for retry.')
    }
    currentJournal = advanceProviderCreationJournal({
      journal: currentJournal,
      publicKey,
      privateKey,
      nextPhase: 'gates_verified',
      runEvidence: journalRunEvidence(run),
      credentialGatesSucceeded: gateResult === 'succeeded',
    })
    await storePendingJournal(environment, currentJournal)
    currentPending = verifyProviderCreationJournal(currentJournal, publicKey)
  }
  if (run && currentPending.payload.phase === 'gates_verified' && currentPending.payload.credential_gates_succeeded) {
    if (!currentPending.payload.lease_evidence) {
      throw new Error('Recovered gated run lacks signed lease evidence.')
    }
    if (
      providerEvidence.some((entry) => entry.status !== 'api_verified_inactive')
      && !failedBeforePagesMutation(run, contract)
    ) {
      throw new Error('A gated run requires API-verified inactivity for every captured provider credential.')
    }
    await assertCleanupReceiptUnchanged(environment, cleanupReceipt)
    const receipt = appendClosedLeaseReceipt({
      previousReceipt: cleanupReceipt,
      environment,
      run: {
        id: run.databaseId,
        runAttempt: run.attempt,
        commitSha: currentPending.payload.commit_sha,
        leaseId,
        storageBackup: currentPending.payload.storage_backup,
        updatedAt: run.updatedAt,
      },
      cloudflareTokenIdHashes: currentPending.payload.lease_evidence.cloudflare_token_id_hashes,
      supabasePatLabelHash: currentPending.payload.lease_evidence.supabase_pat_label_hash,
      supabasePatSha256: currentPending.payload.lease_evidence.supabase_pat_sha256,
      publicKey,
      privateKey,
    })
    await setVariable(environment, 'EPHEMERAL_CLEANUP_RECEIPT', receipt)
    const storedReceipt = await getVariable(environment, 'EPHEMERAL_CLEANUP_RECEIPT')
    if (storedReceipt !== receipt) throw new Error('GitHub did not preserve the recovered cleanup receipt.')
    currentJournal = advanceProviderCreationJournal({
      journal: currentJournal,
      publicKey,
      privateKey,
      nextPhase: 'cleanup_receipt_stored',
      successorCleanupReceipt: receipt,
    })
    await storePendingJournal(environment, currentJournal)
    verifyProviderCreationCleanupSuccessor({ journal: currentJournal, cleanupReceipt: receipt, publicKey })
    await publishStagingCleanupSuccessor(environment, receipt)
    await removeExactPendingJournal(environment, currentJournal)
    console.log(`Recovered gated run ${run.databaseId} and recorded its exact cleanup successor.`)
    return
  }
  if (!run) {
    assertProviderCreationRunAbsenceCanAbort({ journal: currentJournal, publicKey })
  }

  const abortedReceipt = createAbortedLeaseReceipt({
    pendingMarker: currentJournal,
    publicKey,
    privateKey,
    providerEvidence,
    allowMaterializedDashboardRevocation,
  })
  await setVariable(environment, 'EPHEMERAL_LAST_ABORTED_LEASE_RECEIPT', abortedReceipt)
  const stored = await getVariable(environment, 'EPHEMERAL_LAST_ABORTED_LEASE_RECEIPT')
  if (stored !== abortedReceipt) {
    throw new Error('GitHub did not preserve the exact signed aborted-lease receipt.')
  }
  // The abort receipt binds to the signed journal envelope, not just its
  // decoded payload. Keep the envelope hash available for the exact-match
  // check below; verifyProviderCreationJournal intentionally returns no
  // markerHash.
  currentPending = verifyPendingMarker(currentJournal, publicKey, {
    environment,
    leaseId,
    cloudflareAccountId,
  })
  verifyAbortedLeaseReceipt(stored, publicKey, currentPending)
  await removeExactPendingJournal(environment, currentJournal)
  await assertNoRepositoryCredentialState()
  console.log(`Provider inactivity and signed abort recorded for lease ${leaseId} (${attestationEnvelopeHash(abortedReceipt)}).`)
}

async function main() {
  const { command, values } = parseArguments(process.argv.slice(2))
  const reader = process.stdin.isTTY
    ? null
    : createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })
  const inputIterator = reader
    ? reader[Symbol.asyncIterator]()
    : {
        next: async () => ({ done: false, value: await readHiddenTtyLine() }),
      }
  try {
    const lockContext = `${command || 'invalid'}:${values.environment || 'unknown'}:${values.lease || values.commit || 'none'}`
    await withSupervisorProcessLock(async () => {
      if (command === 'bootstrap') {
        await bootstrap(values.environment, inputIterator)
        return
      }
      if (command === 'deploy') {
        if (!['true', 'false'].includes(values['storage-backup'])) {
          throw new Error('--storage-backup must be exactly true or false.')
        }
        await deploy(
          values.environment,
          values.commit,
          values['storage-backup'] === 'true',
          values['cloudflare-account-id'],
          values['staging-run-id'],
          inputIterator,
        )
        return
      }
      if (command === 'recover') {
        await recoverPendingProviderCreation(
          values.environment,
          values.lease,
          values['cloudflare-account-id'],
          inputIterator,
        )
        return
      }
      throw new Error('Usage: supervise-ephemeral-release.mjs bootstrap|deploy|recover with explicit environment arguments.')
    }, { context: lockContext })
  } finally {
    reader?.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Ephemeral release supervision failed.')
    process.exitCode = 1
  })
}
