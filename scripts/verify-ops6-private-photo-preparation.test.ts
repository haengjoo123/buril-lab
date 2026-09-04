import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  OPS6_EXPAND_MIGRATION,
  OPS6_NATIVE_ASSERTIONS,
  OPS6_PERMISSION_TEST,
  OPS6_SWITCH_MIGRATION,
  verifyOps6ApplicationSources,
  verifyOps6DatabaseSources,
  verifyOps6Paths,
  verifyOps6PrivatePhotoPreparation,
} from './verify-ops6-private-photo-preparation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const database = {
  expand: read(OPS6_EXPAND_MIGRATION),
  switchMigration: read(OPS6_SWITCH_MIGRATION),
  permissionTest: read(OPS6_PERMISSION_TEST),
  nativeAssertions: read(OPS6_NATIVE_ASSERTIONS),
}
const application = {
  cabinetService: read('src/services/cabinetService.ts'),
  sharedApi: read('functions/api/cabinets/_shared.ts'),
  imageApi: read('functions/api/cabinets/[id]/image.ts'),
  imageUrlsApi: read('functions/api/cabinets/image-urls.ts'),
  migrationTool: read('scripts/migrate-ops6-private-photos.mjs'),
  stagingWorkerConfig: read('workers/storage-backup/wrangler.staging.jsonc'),
  productionWorkerConfig: read('workers/storage-backup/wrangler.production.jsonc'),
  workerVerifier: read('scripts/verify-storage-backup-worker-deployment.mjs'),
  documentation: read('docs/operations/ops6-private-photo-preparation.md'),
  packageSource: read('package.json'),
}

describe('Ops6 private photo preparation boundary', () => {
  it('verifies the exact owned preparation worktree without claiming production readiness', () => {
    const hasSuccessorGate = read('package.json').includes('"ops7:verify"')
    if (hasSuccessorGate) {
      expect(() => verifyOps6PrivatePhotoPreparation(root)).toThrow(/unreviewed path/)
      return
    }
    expect(verifyOps6PrivatePhotoPreparation(root)).toMatchObject({
      result: 'ops6-private-photo-preparation-ok',
      productionReady: false,
      hostedSupabaseAcceptance: false,
      requiresEarlierOperationalGates: true,
    })
  })

  it.each(['../escape.ts','src\\escape.ts','src/unreviewed.ts'])('rejects an unreviewed or malformed path: %s', (candidate) => {
    expect(() => verifyOps6Paths([candidate])).toThrow(/ops6-preparation/)
  })

  it('pins the exact reviewed Expand, Switch, permission and native assertion SQL', () => {
    expect(verifyOps6DatabaseSources(database)).toMatchObject({
      expandSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      switchSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(() => verifyOps6DatabaseSources({
      ...database,
      switchMigration: database.switchMigration.replace('commit;', 'delete from storage.objects;\ncommit;'),
    })).toThrow(/reviewed switchMigration content changed/)
  })

  it('rejects browser Storage fallback and migration deletion paths', () => {
    expect(() => verifyOps6ApplicationSources({
      ...application,
      cabinetService: `${application.cabinetService}\nsupabase.storage.from('cabinets')`,
    })).toThrow(/Storage directly/)
    expect(() => verifyOps6ApplicationSources({
      ...application,
      migrationTool: `${application.migrationTool}\nadapter.remove('legacy.webp')`,
    })).toThrow(/unapproved deletion/)
  })

  it('rejects a Worker rollback to legacy URL pointers', () => {
    expect(() => verifyOps6ApplicationSources({
      ...application,
      productionWorkerConfig: application.productionWorkerConfig.replace('private_path', 'legacy_url'),
    })).toThrow(/private_path/)
  })
})
