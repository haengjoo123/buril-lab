import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  OPS11_MIGRATION,
  OPS11_NATIVE_ASSERTIONS,
  OPS11_PERMISSION_TEST,
  OPS11_PREPARATION_BASE_SHA,
  filterOps11GeneratedUntrackedPaths,
  verifyOps11ApplicationSources,
  verifyOps11DatabaseSources,
  verifyOps11DeletionWorkerPreparation,
  verifyOps11Paths,
  verifyOps11WorkerSources,
} from './verify-ops11-deletion-worker-preparation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const database = {
  migration: read(OPS11_MIGRATION), permissionTest: read(OPS11_PERMISSION_TEST),
  nativeAssertions: read(OPS11_NATIVE_ASSERTIONS),
}
const application = {
  runtimeConfig: read('functions/api/_runtimeConfig.ts'), middleware: read('functions/api/_middleware.ts'),
  routePolicy: read('functions/api/_routePolicy.ts'),
  processor: read('functions/api/internal/deletions/_processor.ts'),
  handler: read('functions/api/internal/deletions/process.ts'), deletionUi: read('src/config/deletion.ts'),
  mfaService: read('src/services/mfaService.ts'),
  mfaPanel: read('src/components/MfaSettingsPanel.tsx'),
  mainLayout: read('src/components/MainLayout.tsx'),
  settingsModal: read('src/components/SettingsModal.tsx'),
}
const worker = {
  scheduler: read('workers/deletion-scheduler/src/scheduler.ts'),
  index: read('workers/deletion-scheduler/src/index.ts'),
  stagingConfig: read('workers/deletion-scheduler/wrangler.staging.jsonc'),
  productionConfig: read('workers/deletion-scheduler/wrangler.production.jsonc'),
  generatedTypes: read('workers/deletion-scheduler/worker-configuration.d.ts'),
}

describe('Ops11 deletion Worker preparation boundary', () => {
  it('pins the successor tree as not deployed and sequence-gated', () => {
    expect(OPS11_PREPARATION_BASE_SHA).toMatch(/^[0-9a-f]{40}$/)
    expect(verifyOps11DeletionWorkerPreparation(root)).toMatchObject({
      result: 'ops11-deletion-worker-preparation-ok', activeMigrations: 9, activePgTapTests: 8,
      dpapiTestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      historyRepairTestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      localJoinTestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      productionReady: false, schedulerDeployed: false, deletionIntakeEnabled: false,
      deletionUiEnabled: false, hostedSupabaseAcceptance: false,
      requiresEarlierOperationalGates: true,
    })
  })

  it.each(['../escape.ts','src\\escape.ts','src/unreviewed.ts'])(
    'rejects an unreviewed or malformed path: %s',
    (candidate) => expect(() => verifyOps11Paths([candidate])).toThrow(/ops11-preparation/),
  )

  it('ignores only the exact Gitleaks CI report as an untracked generated artifact', () => {
    expect(filterOps11GeneratedUntrackedPaths(['results.sarif', 'src/unreviewed.ts']))
      .toEqual(['src/unreviewed.ts'])
    expect(() => verifyOps11Paths(['results.sarif'])).toThrow(/unreviewed path/)
  })

  it('allows only the reviewed PWA migration assets, without widening the public directory', () => {
    expect(verifyOps11Paths([
      'public/_headers', 'public/sw-legacy-refresh.js', 'scripts/pwa-legacy-refresh.test.ts',
    ])).toBe(3)
    expect(() => verifyOps11Paths(['public/unreviewed.js'])).toThrow(/unreviewed path/)
  })

  it('pins the exact migration, pgTAP, and native assertions', () => {
    expect(verifyOps11DatabaseSources(database)).toMatchObject({
      migrationSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      permissionTestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(() => verifyOps11DatabaseSources({
      ...database, migration: database.migration.replace('commit;', 'drop table private.deletion_file_targets_v1;\ncommit;'),
    })).toThrow(/reviewed deletion worker migration changed/)
  })

  it('rejects early UI enablement or removal of the purpose-specific secret boundary', () => {
    expect(() => verifyOps11ApplicationSources({
      ...application, deletionUi: application.deletionUi.replace('false as const', 'true as const'),
    })).toThrow(/deletion UI/)
    expect(() => verifyOps11ApplicationSources({
      ...application, handler: application.handler.replace('expectedSecret.length < 32', 'expectedSecret.length < 1'),
    })).toThrow(/processor handler/)
    expect(() => verifyOps11ApplicationSources({
      ...application,
      mfaService: `${application.mfaService}\nlocalStorage.setItem('mfa', secret)`,
    })).toThrow(/persisted or logged/)
    expect(() => verifyOps11ApplicationSources({
      ...application,
      mfaService: application.mfaService.replace('supabase.auth.mfa.challengeAndVerify({ factorId, code })', 'Promise.resolve()'),
    })).toThrow(/MFA client service/)
  })

  it('rejects Scheduler auto-enable and Staging credentials in production', () => {
    expect(() => verifyOps11WorkerSources({
      ...worker, scheduler: `${worker.scheduler}\nconst unsafe = { account_deletion_enabled: true }`,
    })).toThrow(/turn deletion capabilities ON/)
    expect(() => verifyOps11WorkerSources({
      ...worker, productionConfig: `${worker.productionConfig}\nCF_ACCESS_CLIENT_ID`,
    })).toThrow(/Staging Access credentials/)
    expect(() => verifyOps11WorkerSources({
      ...worker, scheduler: worker.scheduler.replace("redirect: 'manual'", "redirect: 'error'"),
    })).toThrow(/redirect mode unsupported/)
  })
})
