/**
 * Wire contract between the search-bar agent mode and POST /api/agent/query.
 *
 * The server only turns one sentence into a typed plan. It never reads lab data
 * and never writes anything: the app runs the plan with its own services, under
 * the signed-in user's access. The contract has no free-text answer field, so
 * no model-written guidance can reach the screen.
 *
 * This module is imported by Pages Functions, so it must stay free of browser,
 * Supabase and i18n imports.
 */
export const AGENT_SCHEMA_VERSION = 1
export const AGENT_MAX_TEXT_LENGTH = 300
export const AGENT_MAX_ITEM_TEXT_LENGTH = 120
export const AGENT_MAX_ITEM_ALIASES = 4

/**
 * Status questions answered from the lab's records with no further detail to
 * extract: the capability id is the whole plan.
 */
export const AGENT_STATUS_CAPABILITY_IDS = [
  'low_stock',
  'regulated_list',
  'cabinet_locks',
  'inspection_gaps',
  'purchase_status',
  'admin_tasks',
] as const
export type AgentStatusCapabilityId = (typeof AGENT_STATUS_CAPABILITY_IDS)[number]

/**
 * Requests to record something. The plan only says what the person asked for;
 * the app shows it as a proposal and saves nothing until the person confirms.
 * The planner is offered these only while the runtime switch is `actions`.
 */
export const AGENT_ACTION_CAPABILITY_IDS = ['log_usage', 'register_item', 'request_purchase'] as const
export type AgentActionCapabilityId = (typeof AGENT_ACTION_CAPABILITY_IDS)[number]

/** Capabilities the planner may choose. A build declares the ones it can run. */
export const AGENT_CAPABILITY_IDS = [
  'item_lookup',
  'expiry_list',
  'open_screen',
  ...AGENT_STATUS_CAPABILITY_IDS,
  ...AGENT_ACTION_CAPABILITY_IDS,
] as const
export type AgentCapabilityId = (typeof AGENT_CAPABILITY_IDS)[number]

export const AGENT_MAX_CAPACITY_TEXT_LENGTH = 40
export const AGENT_MAX_QUANTITY = 999

export const AGENT_FACETS = ['location', 'expiry', 'remaining'] as const
export type AgentFacet = (typeof AGENT_FACETS)[number]

export const AGENT_EXPIRY_WINDOWS = ['expired', 'within_7d', 'within_30d', 'attention'] as const
export type AgentExpiryWindow = (typeof AGENT_EXPIRY_WINDOWS)[number]

/**
 * Screens the planner may open. Waste screens are absent on purpose: wording
 * about waste never reaches the planner and is routed by fixed rules instead.
 */
export const AGENT_PLANNER_SCREENS = ['inventory', 'cabinet', 'admin', 'inspection', 'purchases'] as const
export type AgentPlannerScreen = (typeof AGENT_PLANNER_SCREENS)[number]

export type AgentLanguage = 'ko' | 'en'
export type AgentMode = 'read_only' | 'actions'

export interface AgentQueryRequest {
  schemaVersion: typeof AGENT_SCHEMA_VERSION
  text: string
  language: AgentLanguage
  capabilities: AgentCapabilityId[]
}

export interface AgentItemRef {
  /** The reagent name exactly as the person typed it. */
  text: string
  /** Other names the planner suggests for matching. Never shown as fact. */
  aliases: string[]
  /** Kept only when the person typed it and its checksum is valid. */
  casNumber: string | null
}

export type AgentUnsupportedReason = 'out_of_scope' | 'capability_disabled' | 'low_confidence'

/**
 * What the person said about a bottle. A percentage is kept only when they
 * typed the number; otherwise the proposal asks for it.
 */
export type AgentUsageChange =
  | { kind: 'remaining'; percent: number | null }
  | { kind: 'used_up' }

export type AgentPlan =
  | { kind: 'item_lookup'; item: AgentItemRef; facet: AgentFacet }
  | { kind: 'expiry_list'; window: AgentExpiryWindow }
  | { kind: 'open_screen'; screen: AgentPlannerScreen }
  | { kind: AgentStatusCapabilityId }
  | { kind: 'log_usage'; item: AgentItemRef; change: AgentUsageChange }
  /** The name, count and package size as typed; the registration form asks for the rest. */
  | { kind: 'register_item'; name: string; casNumber: string | null; quantity: number | null; capacity: string | null }
  | { kind: 'request_purchase'; item: AgentItemRef; quantity: number | null }
  | { kind: 'handoff_search'; query: string }
  | { kind: 'redirect_disposal' }
  | { kind: 'unsupported'; reason: AgentUnsupportedReason }

export interface AgentQueryResponse {
  schemaVersion: typeof AGENT_SCHEMA_VERSION
  mode: AgentMode
  plan: AgentPlan
  /** Requests left today, or null when the limit was not consulted. */
  quotaRemaining: number | null
}

/** What POST /api/agent/mode answers: whether proposals to record something are switched on. */
export interface AgentModeResponse {
  schemaVersion: typeof AGENT_SCHEMA_VERSION
  mode: 'off' | AgentMode
}

export function isAgentCapabilityId(value: unknown): value is AgentCapabilityId {
  return typeof value === 'string' && (AGENT_CAPABILITY_IDS as readonly string[]).includes(value)
}

export function isAgentStatusCapabilityId(value: unknown): value is AgentStatusCapabilityId {
  return typeof value === 'string' && (AGENT_STATUS_CAPABILITY_IDS as readonly string[]).includes(value)
}
