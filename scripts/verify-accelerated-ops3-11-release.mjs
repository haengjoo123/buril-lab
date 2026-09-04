import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDatabaseReleaseSafety } from './verify-database-release-safety.mjs'
import { verifyOps11DeletionWorkerPreparation } from './verify-ops11-deletion-worker-preparation.mjs'

export const ACCELERATED_RELEASE_MAIN_SHA = '7a210b10034a9c0deecb60a7a4022317f082db58'
export const ACCELERATED_RELEASE_OPS11_SHA = '9570667443155db55719d12c8a825fad92fb27c0'
export const ACCELERATED_RELEASE_POLICY = 'docs/operations/accelerated-ops3-11-release-2026-09-05.md'

function fail(message) { throw new Error(`[accelerated-ops3-11] ${message}`) }
function normalized(value) { return value.replace(/\r\n/g, '\n') }
function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) fail(`${label} is missing: ${marker}`)
}
function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch { fail(`cannot verify Git boundary: git ${args.join(' ')}`) }
}

export function verifyAcceleratedPolicySources({ policy, rollout }) {
  policy = normalized(policy)
  rollout = normalized(rollout)
  requireMarkers(policy, [
    'policyMode: accelerated-risk-based',
    'releaseTarget: Ops3-Ops11',
    'ops12Included: false',
    'initialDeletionUi: false',
    'legacyContractRevocation: post-new-path-smoke',
    'hostedAcceptance: required',
    'productionReady: false',
    '예약 호출 3회',
    '공개 원본과 고아 파일은 삭제하지 않습니다',
    '기준선\n   SQL 본문은 운영 DB에 실행하지 않습니다',
  ], 'accelerated release policy')
  requireMarkers(rollout, [
    '2026-09-04 정책 변경',
    './accelerated-ops3-11-release-2026-09-05.md',
    'Ops 3~11은 2026-09-04 승인된 가속 정책에 따라 7일 관찰을 출시 후에도 이어갈 수 있습니다',
    '| 운영 12 | 금지 |',
  ], 'operations rollout')
  return Object.freeze({ policyMode: 'accelerated-risk-based', ops12Included: false })
}

export function verifyNoOps12Paths(paths) {
  const forbidden = paths.filter((candidate) => /(?:^|[\\/_-])ops12(?:[\\/_.-]|$)/i.test(candidate))
  if (forbidden.length > 0) fail(`Ops12 is present in the accelerated candidate: ${forbidden.join(', ')}`)
  return true
}

export function verifyAcceleratedOps311Release(root = fileURLToPath(new URL('../', import.meta.url))) {
  for (const sha of [ACCELERATED_RELEASE_MAIN_SHA, ACCELERATED_RELEASE_OPS11_SHA]) {
    git(root, ['cat-file', '-e', `${sha}^{commit}`])
    git(root, ['merge-base', '--is-ancestor', sha, 'HEAD'])
  }

  const tracked = git(root, ['ls-files']).split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  verifyNoOps12Paths(tracked)

  const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')
  const policy = verifyAcceleratedPolicySources({
    policy: read(ACCELERATED_RELEASE_POLICY),
    rollout: read('docs/operations/operations-safety-rollout.md'),
  })

  const deletionUi = read('src/config/deletion.ts')
  if (!deletionUi.includes('DELETION_UI_ENABLED = false as const')) {
    fail('initial deletion UI must remain OFF until three scheduled successes')
  }

  for (const configPath of [
    'workers/storage-backup/wrangler.staging.jsonc',
    'workers/storage-backup/wrangler.production.jsonc',
  ]) {
    const config = read(configPath)
    requireMarkers(config, ['"SOURCE_POINTER_MODE": "private_path"'], configPath)
  }

  const database = verifyDatabaseReleaseSafety(root)
  if (database.activeMigrations !== 9 || database.activePgTapTests !== 8) {
    fail('database release set must be pinned from the baseline through Ops11')
  }
  const ops11 = verifyOps11DeletionWorkerPreparation(root)

  return Object.freeze({
    result: 'accelerated-ops3-11-candidate-ok',
    mainBaseSha: ACCELERATED_RELEASE_MAIN_SHA,
    ops11Sha: ACCELERATED_RELEASE_OPS11_SHA,
    policy,
    activeMigrations: database.activeMigrations,
    activePgTapTests: database.activePgTapTests,
    deletionUiEnabled: false,
    storageBackupPointerMode: 'private_path',
    ops12Included: false,
    candidateReady: true,
    productionReady: false,
    hostedAcceptance: false,
    requiresFreshProductionBackup: true,
    requiresSameShaStaging: true,
    requiresThreeDeletionSchedulerSuccesses: true,
    ops11Preparation: ops11.result,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(verifyAcceleratedOps311Release())) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Accelerated Ops3-11 verification failed.')
    process.exitCode = 1
  }
}
