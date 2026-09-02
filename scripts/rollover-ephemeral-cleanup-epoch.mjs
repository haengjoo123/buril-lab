import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { publicKeyFingerprint } from './ephemeral-release-attestation.mjs'
import {
  CLEANUP_ABSENT_SECRET_NAMES, MAX_CUMULATIVE_LEASES, cleanupEpochArchivePath,
  createCleanupEpochSuccessor, readCleanupEpochArchive, verifyCleanupReceiptChain,
} from './ephemeral-cleanup-epochs.mjs'
import { loadProtectedEphemeralReleaseKey } from './ephemeral-release-key-store.mjs'
import { fetchAndVerifyCleanupHistory } from './verify-ephemeral-cleanup-receipt.mjs'
import { findTrustedQualityRun } from './verify-github-quality-run.mjs'
import { assertNoRepositoryCredentialState, runGh, withSupervisorProcessLock } from './supervise-ephemeral-release.mjs'

const REPOSITORY = 'haengjoo123/buril-lab'
const FULL_HASH = /^[0-9a-f]{64}$/
const REQUIRED_JOBS = ['Application checks', 'Blank database interface', 'Cloudflare release contract', 'Gate 0 browser interface']
const FORBIDDEN_VARIABLES = [
  'EPHEMERAL_PROVIDER_CREATION_PENDING', 'EPHEMERAL_LEASE_GRANT', 'EPHEMERAL_CREDENTIAL_PROBE_GRANT',
]
const FORBIDDEN_SECRETS = [...CLEANUP_ABSENT_SECRET_NAMES, 'STAGING_CLOUDFLARE_STORAGE_BACKUP_ACCEPTANCE_TOKEN']
const execFileAsync = promisify(execFile)

async function runGit(args) {
  try {
    return (await execFileAsync('git', args, {
      encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024,
    })).stdout.trim()
  } catch { throw new Error('The reviewed epoch Git boundary could not be verified.') }
}

function parseNameList(raw) {
  const values = JSON.parse(raw)
  if (!Array.isArray(values) || values.some((entry) => typeof entry?.name !== 'string')) {
    throw new Error('Cleanup epoch credential-state names are malformed.')
  }
  return values.map((entry) => entry.name)
}

export async function assertEpochCredentialStateAbsent({ run = runGh } = {}) {
  await assertNoRepositoryCredentialState({ run })
  const repositorySecrets = parseNameList(await run(['secret', 'list', '--repo', REPOSITORY, '--json', 'name']))
  if (repositorySecrets.some((name) => FORBIDDEN_SECRETS.includes(name))) {
    throw new Error('Repository-scoped temporary credentials forbid cleanup epoch rollover.')
  }
  for (const environment of ['staging', 'production']) {
    const [secretRaw, variableRaw] = await Promise.all([
      run(['secret', 'list', '--repo', REPOSITORY, '--env', environment, '--json', 'name']),
      run(['variable', 'list', '--repo', REPOSITORY, '--env', environment, '--json', 'name']),
    ])
    if (parseNameList(secretRaw).some((name) => FORBIDDEN_SECRETS.includes(name))
      || parseNameList(variableRaw).some((name) => FORBIDDEN_VARIABLES.includes(name))) {
      throw new Error('Cleanup epoch rollover requires both environments to have no temporary credentials or pending work.')
    }
  }
}

export async function verifyReviewedEpochSource({ run = runGh, git = runGit, now = Date.now() } = {}) {
  const [head, status, main] = await Promise.all([
    git(['rev-parse', 'HEAD']), git(['status', '--porcelain', '--untracked-files=all']),
    run(['api', `repos/${REPOSITORY}/commits/main`, '--jq', '.sha']),
  ])
  if (!/^[0-9a-f]{40}$/.test(head) || head !== main || status !== '') {
    throw new Error('Cleanup epoch apply requires a clean worktree at the exact protected main SHA.')
  }
  const payload = JSON.parse(await run([
    'api', `repos/${REPOSITORY}/actions/workflows/quality.yml/runs?head_sha=${head}&per_page=100`,
  ]))
  const quality = findTrustedQualityRun(payload.workflow_runs, { repository: REPOSITORY, commitSha: head, now })
  const jobs = JSON.parse(await run(['api', `repos/${REPOSITORY}/actions/runs/${quality.id}/jobs?filter=latest&per_page=100`]))
  if (!Array.isArray(jobs.jobs) || jobs.total_count !== REQUIRED_JOBS.length || jobs.jobs.length !== REQUIRED_JOBS.length
    || REQUIRED_JOBS.some((name) => jobs.jobs.filter((job) => job.name === name && job.run_id === quality.id
      && job.status === 'completed' && job.conclusion === 'success').length !== 1)) {
    throw new Error('Cleanup epoch apply requires all four exact main Quality jobs to succeed.')
  }
  return { commitSha: head, qualityRunId: String(quality.id) }
}

export function resolveCleanupEpochTransition({ currentReceipt, environment, expectedHash, publicKey, now, readArchive }) {
  if (!FULL_HASH.test(expectedHash || '')) throw new Error('Cleanup epoch expected receipt hash is invalid.')
  const current = verifyCleanupReceiptChain(currentReceipt, publicKey, { environment, now, readArchive })
  const archivedRaw = (readArchive || readCleanupEpochArchive)(environment, expectedHash)
  const archived = verifyCleanupReceiptChain(archivedRaw, publicKey, { environment, now, readArchive })
  if (archived.receiptHash !== expectedHash || archived.payload.sequence !== MAX_CUMULATIVE_LEASES) {
    throw new Error('Cleanup epoch transition requires the exact complete archived predecessor.')
  }
  if (current.receiptHash === expectedHash) {
    return { state: 'ready', current, predecessor: archived, archivePath: cleanupEpochArchivePath(environment, expectedHash) }
  }
  // Forward-only recovery after the primary variable was stored but its mirror
  // was not. Never bootstrap, overwrite a progressed receipt, or re-sign it.
  if (current.payload.version !== 4 || current.payload.sequence !== 0
    || current.payload.previous_epoch_receipt_sha256 !== expectedHash || current.epoch !== archived.epoch + 1
    || JSON.stringify(current.leases) !== JSON.stringify(archived.leases)) {
    throw new Error('Cleanup epoch receipt changed or progressed beyond the exact requested transition.')
  }
  return { state: 'resume', current, predecessor: archived, archivePath: cleanupEpochArchivePath(environment, expectedHash) }
}

export async function runCleanupEpochRollover({ mode, environment, expectedHash, confirmation }, {
  run = runGh, git = runGit, publicKey, loadKey = loadProtectedEphemeralReleaseKey,
  fetchHistory = fetchAndVerifyCleanupHistory, now = Date.now(), readArchive = readCleanupEpochArchive,
} = {}) {
  if (!['plan', 'apply'].includes(mode) || !['staging', 'production'].includes(environment)
    || !FULL_HASH.test(expectedHash || '') || !publicKey) throw new Error('Cleanup epoch command inputs are invalid.')
  if (mode === 'apply' && confirmation !== `ROLLOVER ${environment} ${expectedHash}`) {
    throw new Error('Cleanup epoch apply requires the exact environment and predecessor hash confirmation.')
  }
  const reviewed = mode === 'apply' ? await verifyReviewedEpochSource({ run, git, now }) : null
  await assertEpochCredentialStateAbsent({ run })
  const readReceipt = () => run(['variable', 'get', 'EPHEMERAL_CLEANUP_RECEIPT', '--repo', REPOSITORY, '--env', environment])
  const previousReceipt = await readReceipt()
  const transition = resolveCleanupEpochTransition({ currentReceipt: previousReceipt, environment, expectedHash, publicKey, now, readArchive })
  const archivePath = transition.archivePath
  if (mode === 'apply' && await git(['ls-files', '--error-unmatch', '--', archivePath]) !== archivePath) {
    throw new Error('The exact signed epoch archive must already be reviewed and tracked on main.')
  }
  const mirrorArgs = ['variable', 'get', 'STAGING_EPHEMERAL_CLEANUP_RECEIPT', '--repo', REPOSITORY, '--env', 'production']
  const mirrorBefore = environment === 'staging' ? await run(mirrorArgs) : null
  if (mirrorBefore !== null && mirrorBefore !== previousReceipt
    && mirrorBefore !== readArchive(environment, expectedHash)) {
    throw new Error('The Staging receipt mirror is not the exact predecessor or recorded successor.')
  }
  // Read the CLI's already authenticated GitHub session only in memory. This
  // neither creates a token nor includes it in command arguments or evidence.
  const githubToken = await run(['auth', 'token'])
  const history = await fetchHistory({
    GITHUB_TOKEN: githubToken, GITHUB_REPOSITORY: REPOSITORY,
    DEPLOY_ENVIRONMENT: environment, EPHEMERAL_CLEANUP_RECEIPT: previousReceipt,
  }, { publicKey, now, readArchive })
  const result = {
    environment, mode, state: transition.state, predecessorHash: expectedHash,
    preservedLeaseCount: history.coveredRunCount, nextEpoch: transition.predecessor.epoch + 1,
    archivePath, reviewed,
  }
  if (mode === 'plan') return Object.freeze(result)

  // Recheck live names and exact variables immediately before the one mutation.
  const rechecked = await verifyReviewedEpochSource({ run, git, now })
  if (rechecked.commitSha !== reviewed.commitSha || rechecked.qualityRunId !== reviewed.qualityRunId) {
    throw new Error('The reviewed main source changed during epoch verification.')
  }
  await assertEpochCredentialStateAbsent({ run })
  if (await readReceipt() !== previousReceipt || (mirrorBefore !== null && await run(mirrorArgs) !== mirrorBefore)) {
    throw new Error('Cleanup epoch state changed during verification; no receipt was replaced.')
  }
  let successor = previousReceipt
  if (transition.state === 'ready') {
    const privateKey = await loadKey()
    if (publicKeyFingerprint(privateKey) !== publicKeyFingerprint(publicKey)) {
      throw new Error('Protected cleanup epoch key does not match the pinned public key.')
    }
    successor = createCleanupEpochSuccessor({ previousReceipt, environment, publicKey, privateKey, now, readArchive })
    try {
      await run(['variable', 'set', 'EPHEMERAL_CLEANUP_RECEIPT', '--repo', REPOSITORY, '--env', environment, '--body', successor])
    } catch { /* A lost acknowledgement is safe only when the exact read below succeeds. */ }
    if (await readReceipt() !== successor) {
      throw new Error('The signed epoch successor was not stored exactly; preserve the archive and retry apply.')
    }
  }
  if (mirrorBefore !== null) {
    try {
      await run(['variable', 'set', 'STAGING_EPHEMERAL_CLEANUP_RECEIPT', '--repo', REPOSITORY, '--env', 'production', '--body', successor])
    } catch { /* Forward-only resume repairs a partial mirror write. */ }
    if (await run(mirrorArgs) !== successor) {
      throw new Error('The signed epoch successor mirror is pending; retry the same exact apply, not a new lease.')
    }
  }
  await assertEpochCredentialStateAbsent({ run })
  if (await readReceipt() !== successor) throw new Error('Cleanup epoch successor changed unexpectedly.')
  const verified = verifyCleanupReceiptChain(successor, publicKey, { environment, now, readArchive })
  return Object.freeze({ ...result, state: 'complete', receiptHash: verified.receiptHash, currentEpochLeaseCount: 0 })
}

async function main() {
  const [mode, ...args] = process.argv.slice(2)
  const values = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || args[i + 1] === undefined || Object.hasOwn(values, args[i])) {
      throw new Error('Cleanup epoch arguments must be unique --name value pairs.')
    }
    values[args[i]] = args[i + 1]
  }
  const expected = mode === 'apply' ? ['--environment', '--expected-receipt-sha256', '--confirmation'] : ['--environment', '--expected-receipt-sha256']
  if (JSON.stringify(Object.keys(values).sort()) !== JSON.stringify(expected.sort())) throw new Error('Cleanup epoch arguments are invalid.')
  const publicKey = await readFile('config/ephemeral-release-public-key.pem', 'utf8')
  const result = await withSupervisorProcessLock(() => runCleanupEpochRollover({
    mode, environment: values['--environment'], expectedHash: values['--expected-receipt-sha256'], confirmation: values['--confirmation'],
  }, { publicKey }), { context: `cleanup-epoch:${mode}:${values['--environment']}` })
  console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Provider/API responses or command buffers must not escape through errors.
    console.error('Signed cleanup epoch verification or transition failed. Preserve the exact archive and current variables; do not start credentials.')
    process.exitCode = 1
  })
}
