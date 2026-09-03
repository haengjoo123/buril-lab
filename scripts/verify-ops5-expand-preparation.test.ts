import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  OPS5_MIGRATION,
  OPS5_PERMISSION_TEST,
  verifyOps5ClientSources,
  verifyOps5DatabaseSources,
  verifyOps5ExpandPreparation,
  verifyOps5Paths,
} from './verify-ops5-expand-preparation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migration = readFileSync(path.join(root, OPS5_MIGRATION), 'utf8')
const permissionTest = readFileSync(path.join(root, OPS5_PERMISSION_TEST), 'utf8')

describe('Ops5 Expand preparation boundary', () => {
  it('verifies the exact owned preparation worktree', () => {
    const hasSuccessorGate = readFileSync(path.join(root, 'package.json'), 'utf8').includes('"ops6:verify"')
    if (hasSuccessorGate) {
      expect(() => verifyOps5ExpandPreparation(root)).toThrow(/unreviewed path/)
      return
    }
    expect(verifyOps5ExpandPreparation(root)).toMatchObject({
      result: 'ops5-expand-preparation-ok',
      productionReady: false,
      requiresOps4AndFreshMain: true,
    })
  })

  it.each(['../escape.ts', 'src\\escape.ts', 'src/unreviewed.ts'])('rejects an unreviewed or malformed path: %s', (candidate) => {
    expect(() => verifyOps5Paths([candidate])).toThrow(/ops5-preparation/)
  })

  it('rejects a Switch or Contract operation even if the reviewed SQL is otherwise present', () => {
    expect(() => verifyOps5DatabaseSources(
      migration.replace('commit;', 'drop function public.join_lab(uuid,text,text);\ncommit;'),
      permissionTest,
    )).toThrow(/reviewed migration content changed/)
  })

  it('rejects browser fallbacks to the generic audit RPC', () => {
    expect(() => verifyOps5ClientSources({
      labService: "postJson('/api/labs/join', {})",
      cabinetService: ".rpc('record_cabinet_activity_v2', {}).rpc('insert_audit_log_rpc', {})",
      joinHandler: "const LAB_JOIN_AUTH_RESPONSE_BYTES=1, LAB_JOIN_RPC_RESPONSE_BYTES=1; redirect: 'manual'",
    })).toThrow(/forgeable audit fallback/)
  })
})
