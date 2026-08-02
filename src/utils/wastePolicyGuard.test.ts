import { describe, expect, it } from 'vitest'
import type { AnalysisResult, WasteBatchDraft } from '../types'
import type { ActiveWastePolicy, ResolvedWasteStream } from '../services/wastePolicyService'
import {
  getWastePolicyEscalationDetails,
  hasWastePolicyContextChanged,
  resolveWasteDecisionAgainstPolicy,
} from './wastePolicyGuard'
import {
  createEmptyWasteBatch,
  createWasteComponentFromAnalysis,
  normalizeWasteAmount,
} from './wasteBatch'

const acetone: AnalysisResult = {
  chemical: {
    id: '180',
    name: 'Acetone',
    casNumber: '67-64-1',
    molecularFormula: 'C3H6O',
    properties: { isOrganic: true, isHalogenated: false },
    ghs: { signal: 'Danger', hazardStatements: ['H225'] },
  },
  category: 'ORGANIC_NON_HALOGEN',
  binColor: 'bg-yellow-500',
  label: 'waste_organic_non_halogen',
  reason: 'test',
  isSafe: true,
}

function createBatch(): WasteBatchDraft {
  const normalized = normalizeWasteAmount(500, 'mL')
  if (!normalized) throw new Error('test amount must normalize')
  return {
    ...createEmptyWasteBatch({ id: 'batch-1', now: '2026-08-02T00:00:00.000Z' }),
    components: [createWasteComponentFromAnalysis(acetone, {
      cartLineId: 'line-1',
      identityConfidence: 'verified',
      ghsDataStatus: 'verified',
    })],
    matrix: 'organic_non_halogenated',
    matrixSource: 'user',
    totalAmount: {
      value: 500,
      unit: 'mL',
      ...normalized,
      isApproximate: false,
      isUnknown: false,
    },
  }
}

function createBlockedCyanideBatch(): WasteBatchDraft {
  const normalized = normalizeWasteAmount(250, 'mL')
  if (!normalized) throw new Error('test amount must normalize')
  const hydrochloricAcid: AnalysisResult = {
    chemical: {
      id: 'hcl',
      name: 'Hydrochloric acid',
      casNumber: '7647-01-0',
      molecularFormula: 'HCl',
      properties: { isOrganic: false, isHalogenated: false },
      ghs: { signal: 'Danger', hazardStatements: ['H314'] },
    },
    category: 'ACID',
    binColor: 'bg-red-500',
    label: 'waste_acid',
    reason: 'test',
    isSafe: true,
  }
  const sodiumCyanide: AnalysisResult = {
    chemical: {
      id: 'nacn',
      name: 'Sodium cyanide',
      casNumber: '143-33-9',
      molecularFormula: 'NaCN',
      properties: { isOrganic: false, isHalogenated: false },
      ghs: { signal: 'Danger', hazardStatements: ['H300', 'H310', 'H330'] },
    },
    category: 'CYANIDE',
    binColor: 'bg-teal-600',
    label: 'waste_cyanide',
    reason: 'test',
    isSafe: false,
  }

  return {
    ...createEmptyWasteBatch({ id: 'blocked-batch', now: '2026-08-02T00:00:00.000Z' }),
    components: [hydrochloricAcid, sodiumCyanide].map((analysis, index) =>
      createWasteComponentFromAnalysis(analysis, {
        cartLineId: `blocked-line-${index}`,
        identityConfidence: 'verified',
        ghsDataStatus: 'verified',
      })),
    matrix: 'aqueous',
    matrixSource: 'user',
    totalAmount: {
      value: 250,
      unit: 'mL',
      ...normalized,
      isApproximate: false,
      isUnknown: false,
    },
    measuredPhStatus: 'unknown',
  }
}

function createStream(overrides: Partial<ResolvedWasteStream> = {}): ResolvedWasteStream {
  return {
    streamCode: 'ORGANIC_NON_HALOGENATED',
    displayNameKo: '비할로겐 유기폐액',
    displayNameEn: 'Non-halogenated waste',
    containerLabel: '유기폐액통 1',
    containerColor: '#facc15',
    location: '폐기물실 A',
    handlerContact: '안전팀 02-000-0000',
    sopUrl: 'https://example.edu/sop',
    allowedHazardFlags: ['FLAMMABLE'],
    blockedHazardFlags: [],
    prohibitions: ['산화제와 혼합 금지'],
    labelRequirements: ['성분과 양'],
    policyVersionId: 'policy-v1',
    policyScope: 'institution',
    sourceRefs: [{ title: '기관 SOP', url: 'https://example.edu/sop' }],
    isEnabled: true,
    sortOrder: 1,
    inheritedPhysical: {},
    labOverride: null,
    ...overrides,
  }
}

function createPolicy(
  streamOverrides: Partial<ResolvedWasteStream> = {},
  policyOverrides: Partial<ActiveWastePolicy> = {},
): ActiveWastePolicy {
  return {
    systemPolicyVersionId: 'system-v1',
    institutionPolicyVersionId: 'policy-v1',
    labPolicyVersionId: null,
    resolvedStreams: [createStream(streamOverrides)],
    ...policyOverrides,
  }
}

describe('waste policy record guard', () => {
  it('exposes the assigned handler and only an HTTPS SOP link for blocked guidance', () => {
    expect(getWastePolicyEscalationDetails(createStream())).toEqual({
      handlerContact: '안전팀 02-000-0000',
      sopUrl: 'https://example.edu/sop',
    })
    expect(getWastePolicyEscalationDetails(createStream({
      handlerContact: '  야간 담당자  ',
      sopUrl: 'http://unsafe.example/sop',
    }))).toEqual({
      handlerContact: '야간 담당자',
      sopUrl: null,
    })
  })

  it('accepts a fresh read when the decision and physical stream are unchanged', () => {
    const batch = createBatch()
    const current = createPolicy()
    const latest = createPolicy({
      allowedHazardFlags: ['FLAMMABLE'],
      labelRequirements: ['성분과 양'],
    })

    expect(hasWastePolicyContextChanged(
      current,
      resolveWasteDecisionAgainstPolicy(batch, current),
      latest,
      resolveWasteDecisionAgainstPolicy(batch, latest),
    )).toBe(false)
  })

  it('detects an activated policy version before a record is written', () => {
    const batch = createBatch()
    const current = createPolicy()
    const latest = createPolicy(
      { policyVersionId: 'policy-v2' },
      { institutionPolicyVersionId: 'policy-v2' },
    )

    expect(hasWastePolicyContextChanged(
      current,
      resolveWasteDecisionAgainstPolicy(batch, current),
      latest,
      resolveWasteDecisionAgainstPolicy(batch, latest),
    )).toBe(true)
  })

  it('detects a lab location/contact override even when the policy version is unchanged', () => {
    const batch = createBatch()
    const current = createPolicy()
    const latest = createPolicy({
      location: '임시 폐기물실 B',
      handlerContact: '야간 안전담당자 010-0000-0000',
    })

    expect(hasWastePolicyContextChanged(
      current,
      resolveWasteDecisionAgainstPolicy(batch, current),
      latest,
      resolveWasteDecisionAgainstPolicy(batch, latest),
    )).toBe(true)
  })

  it('detects a policy hazard rule that changes ready to blocked', () => {
    const batch = createBatch()
    const current = createPolicy()
    const latest = createPolicy({ blockedHazardFlags: ['FLAMMABLE'] })
    const latestResolution = resolveWasteDecisionAgainstPolicy(batch, latest)

    expect(latestResolution.decision.decisionStatus).toBe('blocked')
    expect(hasWastePolicyContextChanged(
      current,
      resolveWasteDecisionAgainstPolicy(batch, current),
      latest,
      latestResolution,
    )).toBe(true)
  })

  it('allows container deposit from the active category without container metadata', () => {
    const resolution = resolveWasteDecisionAgainstPolicy(createBatch(), createPolicy({
      containerLabel: null,
      location: null,
    }))

    expect(resolution.decision).toMatchObject({
      decisionStatus: 'ready',
      streamCode: 'ORGANIC_NON_HALOGENATED',
      allowedActions: ['container_deposit'],
    })
    expect(resolution.matchedStream).toMatchObject({ containerLabel: null, location: null })
  })

  it('uses the active institution UUID when a blocked stream is disabled', () => {
    const blockedBatch = createBlockedCyanideBatch()
    const activePolicy = createPolicy({}, {
      institutionPolicyVersionId: 'institution-policy-disabled-stream',
      resolvedStreams: [createStream({
        streamCode: 'CYANIDE_SULFIDE',
        policyVersionId: 'institution-policy-disabled-stream',
        isEnabled: false,
      })],
    })

    const resolution = resolveWasteDecisionAgainstPolicy(blockedBatch, activePolicy)

    expect(resolution.matchedStream).toBeNull()
    expect(getWastePolicyEscalationDetails(resolution.policyStream)).toEqual({
      handlerContact: '안전팀 02-000-0000',
      sopUrl: 'https://example.edu/sop',
    })
    expect(resolution.decision).toMatchObject({
      decisionStatus: 'blocked',
      streamCode: 'CYANIDE_SULFIDE',
      policyVersion: 'institution-policy-disabled-stream',
      allowedActions: ['isolated', 'handover'],
    })
  })
})
