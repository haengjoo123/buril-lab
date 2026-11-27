import { postJson } from './internalApi'
import type { AgentModeResponse, AgentQueryRequest, AgentQueryResponse } from '../features/agent/agentContract'

/** An object, like inventoryService, so the layout fixture can answer it without a server. */
export const agentService = {
  /** Asks the server to turn one sentence into a plan. The server runs nothing. */
  requestPlan(request: AgentQueryRequest, signal?: AbortSignal): Promise<AgentQueryResponse> {
    return postJson<AgentQueryResponse>('/api/agent/query', request, { signal })
  },

  /**
   * Asks whether proposals to record something are switched on. Sends no
   * request text: it is for requests the app decides by fixed rules.
   */
  requestMode(signal?: AbortSignal): Promise<AgentModeResponse> {
    return postJson<AgentModeResponse>('/api/agent/mode', {}, { signal })
  },
}
