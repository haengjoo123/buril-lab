import { create } from 'zustand'
import { agentService } from '../services/agentService'
import { InternalApiError } from '../services/internalApi'
import {
  AGENT_MAX_TEXT_LENGTH,
  AGENT_SCHEMA_VERSION,
  type AgentLanguage,
} from '../features/agent/agentContract'
import { agentDataSources } from '../features/agent/agentDataSources'
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
  reset: () => void
}

/** The server gives up on the model after 8 s plus one retry; this bounds the whole wait. */
export const AGENT_PLAN_REQUEST_TIMEOUT_MS = 20_000

let nextTurnId = 0
let activeRequest: AbortController | null = null

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

  const run = async (id: number, plan: AgentRunnablePlan, options: AgentSubmitOptions) => {
    if (!isCurrent(id)) return
    set({ status: 'running', turn: { ...get().turn!, plan } })
    const outcome = await runAgentPlan(plan, { sources: agentDataSources, context: options.context })
    if ('uiAction' in outcome) leave(id, outcome.uiAction, options.onUiAction)
    else finish(id, { result: outcome.result })
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
      const id = nextTurnId
      set({ text, status: 'planning', turn: { id, text, plan: null, result: null, error: null } })

      try {
        if (route.kind === 'identifier') {
          leave(id, { type: 'search_chemical', query: route.query }, options.onUiAction)
          return
        }
        // Waste wording stays on this device: fixed rules decide, and no model sees it.
        if (route.kind === 'disposal') {
          await run(id, { kind: 'redirect_disposal' }, options)
          return
        }
        if (route.kind === 'waste') {
          await run(id, route.intent, options)
          return
        }

        const controller = new AbortController()
        activeRequest = controller
        const timeout = setTimeout(() => controller.abort(), AGENT_PLAN_REQUEST_TIMEOUT_MS)
        let plan: AgentRunnablePlan
        try {
          const response = await agentService.requestPlan({
            schemaVersion: AGENT_SCHEMA_VERSION,
            text,
            language: options.language,
            capabilities: declaredAgentCapabilities(options.context),
          }, controller.signal)
          if (response.schemaVersion !== AGENT_SCHEMA_VERSION) throw new AgentUpdateRequiredError()
          plan = response.plan
        } finally {
          clearTimeout(timeout)
          if (activeRequest === controller) activeRequest = null
        }
        await run(id, plan, options)
      } catch (error) {
        finish(id, { error: errorKindOf(error) })
      }
    },

    reset: () => {
      cancelActiveRequest()
      set({ text: '', status: 'idle', turn: null })
    },
  }
})
