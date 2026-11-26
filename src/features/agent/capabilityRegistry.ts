import type { AgentCapabilityId } from './agentContract'
import type { AgentScreen, AgentScreenUnavailableReason } from './agentResults'

/** What the signed-in person can reach right now. Decided by the app, never by a model. */
export interface AgentRuntimeContext {
  /** Null in the personal space, where lab-only screens and records do not exist. */
  labId: string | null
  isAdmin: boolean
  /** The lab's join password still needs changing: one of the admin's tasks. */
  joinPasswordNeedsChange: boolean
  dailyInspectionEnabled: boolean
  purchaseRequestsEnabled: boolean
  regulationBatchEnabled: boolean
  cabinetLockRulesEnabled: boolean
  wasteContainersEnabled: boolean
}

/**
 * Capabilities this build can run for this person. The server offers the
 * planner nothing else, so a request cannot be routed to a closed feature.
 */
export function declaredAgentCapabilities(context: AgentRuntimeContext): AgentCapabilityId[] {
  const inLab = Boolean(context.labId)
  const capabilities: AgentCapabilityId[] = ['item_lookup', 'expiry_list', 'open_screen']
  // The low-stock forecast ships with purchase requests and also works in the personal space.
  if (context.purchaseRequestsEnabled) capabilities.push('low_stock')
  if (context.regulationBatchEnabled) capabilities.push('regulated_list')
  if (context.cabinetLockRulesEnabled && inLab) capabilities.push('cabinet_locks')
  if (context.dailyInspectionEnabled && inLab) capabilities.push('inspection_gaps')
  if (context.purchaseRequestsEnabled && inLab) capabilities.push('purchase_status')
  if (context.isAdmin && inLab) capabilities.push('admin_tasks')
  // Proposals to record something. The server offers them to the planner only
  // while the runtime switch allows actions, and the app checks that again.
  capabilities.push('log_usage', 'register_item')
  if (context.purchaseRequestsEnabled && inLab) capabilities.push('request_purchase')
  return capabilities
}

/** Why a screen cannot be opened for this person, or null when it can. */
export function screenUnavailableReason(
  screen: AgentScreen,
  context: AgentRuntimeContext,
): AgentScreenUnavailableReason | null {
  const inLab = Boolean(context.labId)
  if (screen === 'admin') {
    if (!inLab) return 'lab_only'
    return context.isAdmin ? null : 'admin_only'
  }
  if (screen === 'inspection') {
    if (!context.dailyInspectionEnabled) return 'not_enabled'
    return inLab ? null : 'lab_only'
  }
  if (screen === 'purchases') {
    if (!context.purchaseRequestsEnabled) return 'not_enabled'
    return inLab ? null : 'lab_only'
  }
  return null
}
