import type {
  WasteBatchDraft,
  WasteDecision,
  WasteDecisionReason,
} from '../types'
import type {
  ActiveWastePolicy,
  ResolvedWasteStream,
} from '../services/wastePolicyService'
import { analyzeWasteBatch } from './wasteBatch'

export interface PolicyBoundWasteDecision {
  decision: WasteDecision
  matchedStream: ResolvedWasteStream | null
  /** Matching policy row even when disabled; used only for escalation contact/SOP. */
  policyStream: ResolvedWasteStream | null
}

export interface WastePolicyEscalationDetails {
  handlerContact: string | null
  sopUrl: string | null
}

/** Only trusted HTTPS SOP links are exposed as actionable links in the client. */
export function getWastePolicyEscalationDetails(
  stream: ResolvedWasteStream | null,
): WastePolicyEscalationDetails {
  const handlerContact = stream?.handlerContact?.trim() || null
  const sopUrl = stream?.sopUrl?.trim() || null
  return {
    handlerContact,
    sopUrl: sopUrl?.startsWith('https://') ? sopUrl : null,
  }
}

/** Resolve the deterministic waste decision against one immutable policy read. */
export function resolveWasteDecisionAgainstPolicy(
  batch: WasteBatchDraft,
  policy: ActiveWastePolicy | null,
): PolicyBoundWasteDecision {
  const baseDecision = analyzeWasteBatch(batch)
  const policyStream = policy?.resolvedStreams.find(
    ({ streamCode }) => streamCode === baseDecision.streamCode,
  ) ?? null
  const matchedStream = policyStream?.isEnabled ? policyStream : null
  // The policy's stable category governs the safe action. Local container
  // names and locations are optional, user-facing guidance only.
  // The record RPC strictly compares this UUID with the currently interpreted
  // active policy. A disabled/missing stream can still produce a legitimate
  // blocked isolation/handover record, so it must use the active institution
  // (or system) version rather than the human-readable built-in fallback.
  const activePolicyVersion = matchedStream?.policyVersionId
    ?? policy?.institutionPolicyVersionId
    ?? policy?.systemPolicyVersionId
    ?? baseDecision.policyVersion

  return {
    matchedStream,
    policyStream,
    decision: analyzeWasteBatch(batch, {
      policyVersion: activePolicyVersion,
      policy: {
        streamAvailable: Boolean(matchedStream),
        allowedHazardFlags: matchedStream?.allowedHazardFlags,
        blockedHazardFlags: matchedStream?.blockedHazardFlags,
      },
    }),
  }
}

const sortedStrings = (values: string[]): string[] => [...values].sort()

const normalizeReasons = (reasons: WasteDecisionReason[]) => reasons
  .map((reason) => ({
    code: reason.code,
    messageKey: reason.messageKey,
    ruleId: reason.ruleId ?? null,
    chemicals: sortedStrings(reason.chemicals ?? []),
  }))
  .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))

/**
 * Snapshot every policy-derived value that can change the action or the
 * physical destination shown to a user. Lab overrides are represented by the
 * resolved stream fields, so a location/contact change is detected even when
 * the parent policy version id did not change.
 */
export function createWastePolicyGuardFingerprint(
  policy: ActiveWastePolicy | null,
  resolution: PolicyBoundWasteDecision,
): string {
  const { decision, policyStream } = resolution
  return JSON.stringify({
    activeVersions: {
      system: policy?.systemPolicyVersionId ?? null,
      institution: policy?.institutionPolicyVersionId ?? null,
      lab: policy?.labPolicyVersionId ?? null,
    },
    decision: {
      decisionStatus: decision.decisionStatus,
      streamCode: decision.streamCode,
      policyVersion: decision.policyVersion,
      allowedActions: sortedStrings(decision.allowedActions),
      blockingReasons: normalizeReasons(decision.blockingReasons),
      missingFields: sortedStrings(decision.missingFields),
    },
    stream: policyStream ? {
      streamCode: policyStream.streamCode,
      policyVersionId: policyStream.policyVersionId ?? null,
      isEnabled: policyStream.isEnabled,
      containerLabel: policyStream.containerLabel?.trim() || null,
      containerColor: policyStream.containerColor?.trim() || null,
      location: policyStream.location?.trim() || null,
      handlerContact: policyStream.handlerContact?.trim() || null,
      sopUrl: policyStream.sopUrl?.trim() || null,
      allowedHazardFlags: sortedStrings(policyStream.allowedHazardFlags),
      blockedHazardFlags: sortedStrings(policyStream.blockedHazardFlags),
      prohibitions: sortedStrings(policyStream.prohibitions),
      labelRequirements: sortedStrings(policyStream.labelRequirements),
      sourceRefs: policyStream.sourceRefs
        .map(({ title, url }) => ({ title: title.trim(), url: url?.trim() || null }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    } : null,
  })
}

export function hasWastePolicyContextChanged(
  currentPolicy: ActiveWastePolicy | null,
  currentResolution: PolicyBoundWasteDecision,
  latestPolicy: ActiveWastePolicy | null,
  latestResolution: PolicyBoundWasteDecision,
): boolean {
  return createWastePolicyGuardFingerprint(currentPolicy, currentResolution)
    !== createWastePolicyGuardFingerprint(latestPolicy, latestResolution)
}
