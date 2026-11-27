import { create } from 'zustand'
import { agentEventService } from '../services/agentEventService'
import { agentService } from '../services/agentService'
import { InternalApiError } from '../services/internalApi'
import {
  AGENT_MAX_TEXT_LENGTH,
  AGENT_SCHEMA_VERSION,
  type AgentLanguage,
} from '../features/agent/agentContract'
import { agentDataSources } from '../features/agent/agentDataSources'
import {
  buildAgentQueryEvent,
  outcomeOfError,
  outcomeOfResult,
  outcomeOfUiAction,
  type AgentEventOutcome,
  type AgentEventRoute,
} from '../features/agent/agentEvents'
import { routeAgentInputLocally } from '../features/agent/agentGuard'
import type {
  AgentErrorKind,
  AgentResult,
  AgentRunnablePlan,
  AgentUiAction,
} from '../features/agent/agentResults'
import { declaredAgentCapabilities, type AgentRuntimeContext } from '../features/agent/capabilityRegistry'
import { AgentUpdateRequiredError, runAgentPlan } from '../features/agent/runAgentPlan'

/** planning: waiting for the server's plan. running: reading the lab's records. */
export type AgentStatus = 'idle' | 'planning' | 'running'

export interface AgentTurn {
  id: number
  /** The sentence as it was sent. */
  text: string
  plan: AgentRunnablePlan | null
  result: AgentResult | null
  error: AgentErrorKind | null
}

export interface AgentSubmitOptions {
  language: AgentLanguage
  context: AgentRuntimeContext
  /** Navigation and other effects stay with the app shell. */
  onUiAction: (action: AgentUiAction) => void
}

interface AgentStore {
  text: string
  status: AgentStatus
  turn: AgentTurn | null
  setText: (text: string) => void
  submit: (options: AgentSubmitOptions, text?: string) => Promise<void>
  /** The person confirmed the proposal on screen and it was saved. */
  confirmProposal: () => void
  reset: () => void
}

/** What one request needs to be recorded once it ends. */
interface TurnRecord {
  id: number
  requestId: string | null
  startedAt: number
  route: AgentEventRoute
  text: string
  language: AgentLanguage
  labId: string | null
}

/** The server gives up on the model after 8 s plus one retry; this bounds the whole wait. */
export const AGENT_PLAN_REQUEST_TIMEOUT_MS = 20_000
/** Asking for the runtime switch involves no model, so it answers quickly or not at all. */
export const AGENT_MODE_REQUEST_TIMEOUT_MS = 8_000

let nextTurnId = 0
let activeRequest: AbortController | null = null
/** The request on screen, kept so a confirmed proposal can be recorded against it. */
let shownTurn: TurnRecord | null = null

/**
 * Whether proposals to record something are switched on, for a request the
 * app decided by fixed rules. Anything but a clear yes counts as no.
 */
async function actionsSwitchedOn(): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AGENT_MODE_REQUEST_TIMEOUT_MS)
  try {
    const response = await agentService.requestMode(controller.signal)
    return response.schemaVersion === AGENT_SCHEMA_VERSION && response.mode === 'actions'
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function cancelActiveRequest() {
  activeRequest?.abort()
  activeRequest = null
}

function errorKindOf(error: unknown): AgentErrorKind {
  if (error instanceof AgentUpdateRequiredError) return 'update_required'
  if (!(error instanceof InternalApiError)) return 'failed'
  if (error.code === 'AGENT_UPDATE_REQUIRED') return 'update_required'
  if (error.code === 'AGENT_QUOTA_EXCEEDED') return 'quota_exceeded'
  if (error.code === 'AGENT_DISABLED') return 'disabled'
  if (error.status === 401) return 'login_required'
  if (error.status === 429) return 'rate_limited'
  // 404: the endpoint is not deployed in this environment yet.
  if (error.status === 404) return 'disabled'
  return 'failed'
}

export const useAgentStore = create<AgentStore>((set, get) => {
  const isCurrent = (id: number) => get().turn?.id === id

  /**
   * Records how a request ended. Only the request still on screen counts: one
   * the person replaced or cleared never showed them its result.
   */
  const record = (
    turn: TurnRecord,
    kind: string,
    { outcome, reason }: { outcome: AgentEventOutcome; reason: string | null },
  ) => {
    if (!turn.requestId || !isCurrent(turn.id)) return
    // Nothing waits for this, and a failure to record must not reach the answer.
    void agentEventService.record(buildAgentQueryEvent({
      requestId: turn.requestId,
      labId: turn.labId,
      route: turn.route,
      kind,
      language: turn.language,
      latencyMs: Date.now() - turn.startedAt,
      text: turn.text,
      outcome,
      reason,
    })).catch(() => undefined)
  }

  const finish = (id: number, patch: Partial<AgentTurn>) => {
    const turn = get().turn
    if (!turn || turn.id !== id) return
    set({ status: 'idle', turn: { ...turn, ...patch } })
  }

  /** The app went somewhere else, so there is nothing left to show here. */
  const leave = (id: number, action: AgentUiAction, onUiAction: AgentSubmitOptions['onUiAction']) => {
    if (!isCurrent(id)) return
    set({ status: 'idle', turn: null, text: '' })
    onUiAction(action)
  }

  const run = async (
    turn: TurnRecord,
    plan: AgentRunnablePlan,
    options: AgentSubmitOptions,
    allowActions = false,
  ) => {
    if (!isCurrent(turn.id)) return
    set({ status: 'running', turn: { ...get().turn!, plan } })
    const outcome = await runAgentPlan(plan, { sources: agentDataSources, context: options.context, allowActions })
    if ('uiAction' in outcome) {
      record(turn, plan.kind, outcomeOfUiAction(outcome.uiAction))
      leave(turn.id, outcome.uiAction, options.onUiAction)
    } else {
      record(turn, plan.kind, outcomeOfResult(outcome.result))
      finish(turn.id, { result: outcome.result })
    }
  }

  return {
    text: '',
    status: 'idle',
    turn: null,

    setText: (text) => set({ text: text.slice(0, AGENT_MAX_TEXT_LENGTH) }),

    submit: async (options, override) => {
      const text = (override ?? get().text).trim().slice(0, AGENT_MAX_TEXT_LENGTH)
      const route = routeAgentInputLocally(text)
      if (route.kind === 'empty') return

      cancelActiveRequest()
      nextTurnId += 1
      const turn: TurnRecord = {
        id: nextTurnId,
        requestId: globalThis.crypto?.randomUUID?.() ?? null,
        startedAt: Date.now(),
        route: route.kind === 'planner' ? 'planner' : 'rule',
        text,
        language: options.language,
        labId: options.context.labId,
      }
      shownTurn = turn
      set({ text, status: 'planning', turn: { id: turn.id, text, plan: null, result: null, error: null } })

      try {
        if (route.kind === 'identifier') {
          const action: AgentUiAction = { type: 'search_chemical', query: route.query }
          record(turn, 'identifier', outcomeOfUiAction(action))
          leave(turn.id, action, options.onUiAction)
          return
        }
        // Waste wording stays on this device: fixed rules decide, and no model sees it.
        if (route.kind === 'disposal') {
          await run(turn, { kind: 'redirect_disposal' }, options)
          return
        }
        if (route.kind === 'waste') {
          // A pickup is a proposal to record something, so the runtime switch decides
          // whether it is offered. Only the question is sent, never the sentence.
          const allowActions = route.intent.kind === 'pickup_request' && await actionsSwitchedOn()
          await run(turn, route.intent, options, allowActions)
          return
        }

        const controller = new AbortController()
        activeRequest = controller
        const timeout = setTimeout(() => controller.abort(), AGENT_PLAN_REQUEST_TIMEOUT_MS)
        let plan: AgentRunnablePlan
        let allowActions = false
        try {
          const response = await agentService.requestPlan({
            schemaVersion: AGENT_SCHEMA_VERSION,
            text,
            language: options.language,
            capabilities: declaredAgentCapabilities(options.context),
          }, controller.signal)
          if (response.schemaVersion !== AGENT_SCHEMA_VERSION) throw new AgentUpdateRequiredError()
          plan = response.plan
          allowActions = response.mode === 'actions'
        } finally {
          clearTimeout(timeout)
          if (activeRequest === controller) activeRequest = null
        }
        await run(turn, plan, options, allowActions)
      } catch (error) {
        const kind = errorKindOf(error)
        // The plan kind when the failure came after planning, e.g. while reading the records.
        record(turn, get().turn?.plan?.kind ?? 'planner', outcomeOfError(kind))
        finish(turn.id, { error: kind })
      }
    },

    confirmProposal: () => {
      const kind = get().turn?.plan?.kind
      if (!shownTurn || !kind || !isCurrent(shownTurn.id)) return
      // Its own record under a new id: the proposal itself was already recorded once.
      record(
        { ...shownTurn, requestId: globalThis.crypto?.randomUUID?.() ?? null },
        kind,
        { outcome: 'confirmed', reason: null },
      )
    },

    reset: () => {
      cancelActiveRequest()
      shownTurn = null
      set({ text: '', status: 'idle', turn: null })
    },
  }
})
