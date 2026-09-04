import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  OPS10_MIGRATION,
  OPS10_NATIVE_ASSERTIONS,
  OPS10_PERMISSION_TEST,
  OPS10_PREPARATION_BASE_SHA,
  verifyOps10ApplicationSources,
  verifyOps10DatabaseSources,
  verifyOps10OperatorPreparation,
  verifyOps10Paths,
} from './verify-ops10-operator-preparation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const database = {
  migration: read(OPS10_MIGRATION),
  permissionTest: read(OPS10_PERMISSION_TEST),
  nativeAssertions: read(OPS10_NATIVE_ASSERTIONS),
}
const application = {
  adminShared: read('functions/api/admin/feedback/_shared.ts'),
  analyticsShared: read('functions/api/admin/analytics/_shared.ts'),
  feedbackStatus: read('functions/api/admin/feedback/status.ts'),
  centerStatus: read('functions/api/admin/safety-centers/status.ts'),
  reviews: read('functions/api/admin/analytics/reviews.ts'),
  feedbackList: read('functions/api/admin/feedback/list.ts'),
  documentUrl: read('functions/api/admin/safety-centers/document-url.ts'),
  exportHandler: read('functions/api/admin/analytics/export.ts'),
}

describe('Ops10 operator-role and MFA preparation boundary', () => {
  it('pins its base and rejects the later Ops11 successor tree', () => {
    expect(OPS10_PREPARATION_BASE_SHA).toMatch(/^[0-9a-f]{40}$/)
    expect(() => verifyOps10OperatorPreparation(root)).toThrow(/ops10-preparation/)
  })

  it.each(['../escape.ts','src\\escape.ts','src/unreviewed.ts'])(
    'rejects an unreviewed or malformed path: %s',
    (candidate) => expect(() => verifyOps10Paths([candidate])).toThrow(/ops10-preparation/),
  )

  it('pins the exact migration, pgTAP and native assertions', () => {
    expect(verifyOps10DatabaseSources(database)).toMatchObject({
      migrationSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      permissionTestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(() => verifyOps10DatabaseSources({
      ...database,
      migration: database.migration.replace('commit;', 'drop table private.operator_role_assignments_v1;\ncommit;'),
    })).toThrow(/reviewed operator migration changed/)
  })

  it('rejects removal of AAL2 enforcement or a return to direct administrator mutation', () => {
    expect(() => verifyOps10ApplicationSources({
      ...application,
      adminShared: application.adminShared.replace("payload.aal === 'aal2'", "payload.aal === 'aal1'"),
    })).toThrow(/administrator authorization/)
    expect(() => verifyOps10ApplicationSources({
      ...application,
      feedbackStatus: `${application.feedbackStatus}\nadminClient.from('feedback').update({ status })`,
    })).toThrow(/bypasses its atomic operator audit/)
  })

  it('rejects a second analytics email gate outside the explicit fallback boundary', () => {
    expect(() => verifyOps10ApplicationSources({
      ...application,
      analyticsShared: `${application.analyticsShared}\nconst emails = env.OPS_ANALYTICS_EXPORT_EMAILS`,
    })).toThrow(/second client-side email check/)
  })
})
