import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  OPS9_MIGRATION,
  OPS9_NATIVE_ASSERTIONS,
  OPS9_PERMISSION_TEST,
  OPS9_PREPARATION_BASE_SHA,
  verifyOps9ApplicationSources,
  verifyOps9DatabaseSources,
  verifyOps9DeletionPreparation,
  verifyOps9Paths,
} from './verify-ops9-deletion-preparation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const database = {
  migration: read(OPS9_MIGRATION),
  permissionTest: read(OPS9_PERMISSION_TEST),
  nativeAssertions: read(OPS9_NATIVE_ASSERTIONS),
}
const application = {
  uiEnabled: true,
  runtimeConfig: read('functions/api/_runtimeConfig.ts'),
  intake: read('functions/api/deletions/_shared.ts'),
  accountHandler: read('functions/api/account/delete.ts'),
  labHandler: read('functions/api/labs/delete.ts'),
  deletionConfig: read('src/config/deletion.ts'),
  authHook: read('src/hooks/useAuth.ts'),
  labService: read('src/services/labService.ts'),
  settingsModal: read('src/components/SettingsModal.tsx'),
  labModal: read('src/components/LabManagementModal.tsx'),
}

describe('Ops9 deletion preparation boundary', () => {
  it('pins its base and verifies only a not-yet-enabled local preparation', () => {
    expect(OPS9_PREPARATION_BASE_SHA).toMatch(/^[0-9a-f]{40}$/)
    const hasSuccessorGate = read('package.json').includes('"ops10:verify"')
    if (hasSuccessorGate) {
      expect(() => verifyOps9DeletionPreparation(root)).toThrow(/unreviewed path/)
      return
    }
    expect(verifyOps9DeletionPreparation(root)).toMatchObject({
      result: 'ops9-deletion-preparation-ok',
      activeMigrations: 7,
      activePgTapTests: 6,
      productionReady: false,
      deletionIntakeEnabled: false,
      deletionWorkerReady: false,
      hostedSupabaseAcceptance: false,
      requiresEarlierOperationalGates: true,
    })
  })

  it.each(['../escape.ts','src\\escape.ts','src/unreviewed.ts'])(
    'rejects an unreviewed or malformed path: %s',
    (candidate) => expect(() => verifyOps9Paths([candidate])).toThrow(/ops9-preparation/),
  )

  it('pins the exact migration, pgTAP and native assertions', () => {
    expect(verifyOps9DatabaseSources(database)).toMatchObject({
      migrationSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      permissionTestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(() => verifyOps9DatabaseSources({
      ...database,
      migration: database.migration.replace('commit;', 'drop table private.deletion_jobs_v1;\ncommit;'),
    })).toThrow(/reviewed deletion migration changed/)
  })

  it('allows reviewed follow-up controls while retaining queued intake and runtime OFF defaults', () => {
    expect(verifyOps9ApplicationSources(application)).toMatchObject({
      uiEnabled: true, runtimeDefaultEnabled: false,
      immediateAccountDeletionRemoved: true, directLabDeletionRemoved: true,
    })
  })

  it('still rejects enabled UI in the original preparation phase or browser-side deletion', () => {
    expect(() => verifyOps9ApplicationSources({
      ...application,
      uiEnabled: false,
    })).toThrow(/pinned OFF/)
    expect(() => verifyOps9ApplicationSources({
      ...application,
      labService: `${application.labService}\nasync deleteLab() { return supabase.from('labs').delete() }`,
    })).toThrow(/directly deletes labs/)
  })

  it('rejects immediate local sign-out after merely queueing account deletion', () => {
    expect(() => verifyOps9ApplicationSources({
      ...application,
      authHook: application.authHook.replace(
        'return { error: null, jobId: queued.jobId };',
        'await supabase.auth.signOut(); return { error: null, jobId: queued.jobId };',
      ),
    })).toThrow(/signs out or clears data immediately/)
  })
})
