import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDatabaseReleaseSafety } from './verify-database-release-safety.mjs'
import { verifyAcceleratedPolicySources, verifyNoOps12Paths } from './verify-accelerated-ops3-11-release.mjs'
import { filterOps11GeneratedUntrackedPaths, verifyOps11ApplicationSources, verifyOps11WorkerSources } from './verify-ops11-deletion-worker-preparation.mjs'

export const CABINET_RELEASE_BASE_SHA = 'd99fe93c4ae09674cda01bd24b2a463ac23686c2'
export const CABINET_RELEASE_POLICY = 'config/cabinet-release-20261002.json'
export const CABINET_RELEASE_PATHS = Object.freeze([
  '.github/workflows/quality.yml',
  CABINET_RELEASE_POLICY,
  'package-lock.json',
  'docs/operations/cabinet-trash-rollout.md',
  'docs/operations/ops-observation-recheck-2026-10-02.md',
  'docs/operations/operations-safety-rollout.md',
  'functions/api/internal/deletions/_processor.ts',
  'functions/api/internal/deletions/process.test.ts',
  'public/environments/README.md',
  'public/environments/cabinet-city.hdr',
  'scripts/fixtures/cabinet-trash-assertions.sql',
  'scripts/test-cabinet-local-postgres.mjs',
  'scripts/verify-cloudflare-release-config.mjs',
  'scripts/verify-cabinet-release.mjs',
  'scripts/verify-cabinet-release.test.ts',
  'scripts/verify-database-release-safety.mjs',
  'scripts/verify-database-release-safety.test.ts',
  'scripts/verify-accelerated-ops3-11-release.mjs',
  'scripts/verify-accelerated-ops3-11-release.test.ts',
  'scripts/verify-ops3-release-scope.mjs',
  'scripts/verify-ops3-release-scope.test.ts',
  'scripts/verify-ops5-expand-preparation.mjs',
  'scripts/verify-ops6-private-photo-preparation.mjs',
  'scripts/verify-ops7-contract-preparation.mjs',
  'scripts/verify-ops8-password-preparation.mjs',
  'scripts/verify-ops9-deletion-preparation.mjs',
  'scripts/verify-ops10-operator-preparation.mjs',
  'scripts/verify-ops11-deletion-worker-preparation.mjs',
  'scripts/verify-ops11-deletion-worker-preparation.test.ts',
  'src/features/fridge/CabinetEnvironment.tsx',
  'src/features/fridge/FridgeScene.tsx',
  'src/features/fridge/FridgeView.tsx',
  'src/features/fridge/ModelLoadBoundary.tsx',
  'src/features/fridge/ReagentEditPanel.tsx',
  'src/features/fridge/ReagentItem.tsx',
  'src/features/fridge/ResponsiveCamera.tsx',
  'src/features/fridge/ShelfUnit.tsx',
  'src/features/fridge/cabinetModelReadyContext.ts',
  'src/features/fridge/components/CabinetTrash.tsx',
  'src/features/fridge/components/ReagentModelPreview.tsx',
  'src/services/cabinetService.test.ts',
  'src/services/cabinetService.ts',
  'src/store/fridgeStore.test.ts',
  'src/store/fridgeStore.ts',
  'src/types/fridge.ts',
  'src/utils/cabinetAutoLayoutPlanner.test.ts',
  'src/utils/cabinetAutoLayoutPlanner.ts',
  'src/utils/cabinetPlacementValidation.test.ts',
  'src/utils/cabinetPlacementValidation.ts',
  'src/utils/reagentPlacementMetrics.ts',
  'supabase/legacy_tests/baseline_permissions_ops11.sql',
  'supabase/legacy_tests/ops5_expand_permissions.sql',
  'supabase/tests/ops5_expand_permissions.sql',
  'supabase/migrations/20261002000000_cabinet_trash_and_revision.sql',
  'supabase/migrations/20261002010000_inventory_import_service_grants.sql',
  'supabase/tests/baseline_permissions.sql',
  'supabase/tests/cabinet_import_permissions.sql',
  'supabase/tests/cabinet_trash_behavior.sql',
  'supabase/tests/inventory_import_behavior.sql',
  'vite.config.ts',
])

function fail(message) { throw new Error(`[cabinet-release] ${message}`) }
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export function verifyCabinetChangedPaths(paths) {
  const allowed = new Set(CABINET_RELEASE_PATHS)
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !candidate || /[\\\x00-\x1f\x7f]/u.test(candidate)
      || candidate.startsWith('/') || /^[a-z]:/iu.test(candidate)
      || candidate.split('/').some(segment => !segment || segment === '.' || segment === '..')) fail('a changed path is malformed')
    if (!allowed.has(candidate)) fail(`unreviewed path: ${candidate}`)
  }
  verifyNoOps12Paths(paths)
  return paths.length
}

export function verifyCabinetPolicy(policy) {
  const expected = {
    schemaVersion: 1, baseSha: CABINET_RELEASE_BASE_SHA,
    scope: 'inventory-import-and-cabinet-trash', ops12Included: false,
    requiresSameShaQuality: true, requiresSameShaStaging: true,
    requiresFreshProductionBackup: true, requiresHostedDatabaseAcceptance: true,
    requiresDeletionSchedulerAcceptance: true,
  }
  if (Object.keys(policy).length !== Object.keys(expected).length
    || Object.entries(expected).some(([key, value]) => policy[key] !== value)) fail('release policy differs from the reviewed cabinet contract')
  return expected
}

export function verifyCabinetRelease(root = fileURLToPath(new URL('../', import.meta.url))) {
  git(root, ['cat-file', '-e', `${CABINET_RELEASE_BASE_SHA}^{commit}`])
  git(root, ['merge-base', '--is-ancestor', CABINET_RELEASE_BASE_SHA, 'HEAD'])
  const changed = git(root, ['diff', '--name-only', '-z', CABINET_RELEASE_BASE_SHA, '--']).split('\0').filter(Boolean)
  // Gitleaks creates this exact report before Application tests. This filter
  // applies only to untracked reports; a committed report remains rejected.
  const untracked = filterOps11GeneratedUntrackedPaths(git(root, ['ls-files', '-z', '--others', '--exclude-standard', '--']).split('\0').filter(Boolean))
  const paths = [...new Set([...changed, ...untracked])].sort()
  verifyCabinetChangedPaths(paths)
  for (const candidate of paths) {
    if (!lstatSync(path.join(root, candidate), { throwIfNoEntry: false })?.isFile()) fail(`release path must be a regular file: ${candidate}`)
  }
  const read = relative => readFileSync(path.join(root, relative), 'utf8')
  const policy = verifyCabinetPolicy(JSON.parse(read(CABINET_RELEASE_POLICY)))
  verifyAcceleratedPolicySources({ policy: read('docs/operations/accelerated-ops3-11-release-2026-09-05.md'), rollout: read('docs/operations/operations-safety-rollout.md') })
  for (const config of ['workers/storage-backup/wrangler.staging.jsonc', 'workers/storage-backup/wrangler.production.jsonc']) {
    if (!read(config).includes('"SOURCE_POINTER_MODE": "private_path"')) fail('backup must use private_path')
  }
  const application = verifyOps11ApplicationSources({
    runtimeConfig: read('functions/api/_runtimeConfig.ts'), middleware: read('functions/api/_middleware.ts'),
    routePolicy: read('functions/api/_routePolicy.ts'), processor: read('functions/api/internal/deletions/_processor.ts'),
    handler: read('functions/api/internal/deletions/process.ts'), deletionUi: read('src/config/deletion.ts'),
    mfaService: read('src/services/mfaService.ts'), mfaPanel: read('src/components/MfaSettingsPanel.tsx'),
    mainLayout: read('src/components/MainLayout.tsx'), settingsModal: read('src/components/SettingsModal.tsx'),
    deletionIntake: read('functions/api/deletions/_shared.ts'), accountHandler: read('functions/api/account/delete.ts'),
    labHandler: read('functions/api/labs/delete.ts'), authHook: read('src/hooks/useAuth.ts'),
    labService: read('src/services/labService.ts'), labModal: read('src/components/LabManagementModal.tsx'),
  })
  verifyOps11WorkerSources({ scheduler: read('workers/deletion-scheduler/src/scheduler.ts'), index: read('workers/deletion-scheduler/src/index.ts'), stagingConfig: read('workers/deletion-scheduler/wrangler.staging.jsonc'), productionConfig: read('workers/deletion-scheduler/wrangler.production.jsonc'), generatedTypes: read('workers/deletion-scheduler/worker-configuration.d.ts') })
  if (createHash('sha256').update(read('package-lock.json').replace(/\r\n/g, '\n')).digest('hex') !== '25204bff4b2f1d00fcede83273b5732f36f4727e503797a8331f5e02078353fc') fail('reviewed dependency lock changed')
  const database = verifyDatabaseReleaseSafety(root)
  if (!read('functions/api/internal/deletions/_processor.ts').includes('purge_expired_cabinet_trash_v2')) fail('trash purge is not connected to maintenance')
  const workflow = read('.github/workflows/quality.yml')
  if (!workflow.includes('supabase test db supabase/tests') || workflow.includes('supabase test db supabase/tests/baseline_permissions.sql')) fail('Quality must execute all active permission and behavior tests')
  return Object.freeze({ result: 'cabinet-release-candidate-ok', baseSha: CABINET_RELEASE_BASE_SHA,
    changedFiles: paths.length, activeMigrations: database.activeMigrations, activePgTapTests: database.activePgTapTests,
    policy, deletionRuntimeDefaultEnabled: application.runtimeDefaultEnabled,
    candidateReady: true, hostedAcceptance: false, productionReady: false, ops12Included: false })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(verifyCabinetRelease())) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
