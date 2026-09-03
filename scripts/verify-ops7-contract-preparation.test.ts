import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  OPS7_MIGRATION,
  OPS7_NATIVE_ASSERTIONS,
  OPS7_PERMISSION_TEST,
  OPS7_PREPARATION_BASE_SHA,
  verifyOps7ApplicationSources,
  verifyOps7ContractPreparation,
  verifyOps7DatabaseSources,
  verifyOps7Paths,
} from './verify-ops7-contract-preparation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const database = {
  migration: read(OPS7_MIGRATION),
  permissionTest: read(OPS7_PERMISSION_TEST),
  nativeAssertions: read(OPS7_NATIVE_ASSERTIONS),
}
const application = {
  labService: read('src/services/labService.ts'),
  joinHandler: read('functions/api/labs/join.ts'),
  cabinetService: read('src/services/cabinetService.ts'),
  auditService: read('src/services/auditService.ts'),
}

describe('Ops7 Contract preparation boundary', () => {
  it('pins its base and verifies only a not-yet-applicable local preparation', () => {
    expect(OPS7_PREPARATION_BASE_SHA).toMatch(/^[0-9a-f]{40}$/)
    expect(verifyOps7ContractPreparation(root)).toMatchObject({
      result: 'ops7-contract-preparation-ok',
      activeMigrations: 5,
      activePgTapTests: 4,
      productionReady: false,
      contractReady: false,
      requiresSevenDayZeroUsageEvidence: true,
      hostedSupabaseAcceptance: false,
    })
  })

  it.each(['../escape.ts','src\\escape.ts','src/unreviewed.ts'])(
    'rejects an unreviewed or malformed path: %s',
    (candidate) => expect(() => verifyOps7Paths([candidate])).toThrow(/ops7-preparation/),
  )

  it('pins the exact reviewed migration, pgTAP and native assertions', () => {
    expect(verifyOps7DatabaseSources(database)).toMatchObject({
      migrationSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      permissionTestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(() => verifyOps7DatabaseSources({
      ...database,
      migration: database.migration.replace('commit;', 'drop function public.join_lab(uuid,text,text);\ncommit;'),
    })).toThrow(/reviewed Contract migration changed/)
  })

  it('rejects any browser fallback to a legacy join or generic audit writer', () => {
    expect(() => verifyOps7ApplicationSources({
      ...application,
      labService: `${application.labService}\nsupabase.rpc('join_lab', {})`,
    })).toThrow(/legacy join/)
    expect(() => verifyOps7ApplicationSources({
      ...application,
      cabinetService: `${application.cabinetService}\nsupabase.rpc('insert_audit_log_rpc', {})`,
    })).toThrow(/generic audit/)
  })
})
