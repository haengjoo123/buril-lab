import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  OPS8_MIGRATION,
  OPS8_NATIVE_ASSERTIONS,
  OPS8_PERMISSION_TEST,
  OPS8_PREPARATION_BASE_SHA,
  verifyOps8ApplicationSources,
  verifyOps8DatabaseSources,
  verifyOps8PasswordPreparation,
  verifyOps8Paths,
} from './verify-ops8-password-preparation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const database = {
  migration: read(OPS8_MIGRATION),
  permissionTest: read(OPS8_PERMISSION_TEST),
  nativeAssertions: read(OPS8_NATIVE_ASSERTIONS),
}
const application = {
  policy: read('src/utils/labPasswordPolicy.ts'),
  labService: read('src/services/labService.ts'),
  labStore: read('src/store/useLabStore.ts'),
  modal: read('src/components/LabManagementModal.tsx'),
  authVerifier: read('scripts/verify-supabase-auth-password-config.mjs'),
}

describe('Ops8 password preparation boundary', () => {
  it('pins its base and verifies a local-only preparation', () => {
    expect(OPS8_PREPARATION_BASE_SHA).toMatch(/^[0-9a-f]{40}$/)
    expect(verifyOps8PasswordPreparation(root)).toMatchObject({
      result: 'ops8-password-preparation-ok',
      activeMigrations: 6,
      activePgTapTests: 5,
      productionReady: false,
      hostedSupabaseAcceptance: false,
      requiresEarlierOperationalGates: true,
    })
  })

  it.each(['../escape.ts','src\\escape.ts','src/unreviewed.ts'])(
    'rejects an unreviewed or malformed path: %s',
    (candidate) => expect(() => verifyOps8Paths([candidate])).toThrow(/ops8-preparation/),
  )

  it('pins the exact reviewed migration, pgTAP and native assertions', () => {
    expect(verifyOps8DatabaseSources(database)).toMatchObject({
      migrationSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      permissionTestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(() => verifyOps8DatabaseSources({
      ...database,
      migration: database.migration.replace('commit;', 'drop function public.set_lab_join_password(uuid,text);\ncommit;'),
    })).toThrow(/reviewed password migration changed/)
  })

  it('rejects a browser-only policy or a hosted verifier with writes', () => {
    expect(() => verifyOps8ApplicationSources({
      ...application,
      labService: application.labService.replaceAll('join_password_needs_change', 'ignored_policy_flag'),
    })).toThrow(/replacement flag/)
    expect(() => verifyOps8ApplicationSources({
      ...application,
      authVerifier: `${application.authVerifier}\nfetch(url, { method: 'PATCH' })`,
    })).toThrow(/write request/)
  })
})
