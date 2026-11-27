import { supabase } from './supabaseClient'
import type { AgentQueryEvent } from '../features/agent/agentEvents'

/** PostgREST reports a function that is not in the schema with this code. */
const MISSING_FUNCTION_CODE = 'PGRST202'

// Until the usage record migration reaches an environment, every write would fail the same
// way. After the first such failure this session stops trying.
let unavailable = false

/** An object, like agentService, so the layout fixture and tests can replace it. */
export const agentEventService = {
  /**
   * Records one finished agent request. Measurement must never get in the way
   * of the answer, so this never throws and nothing waits for it.
   */
  async record(event: AgentQueryEvent): Promise<void> {
    if (unavailable) return
    try {
      const { error } = await supabase.rpc('record_agent_query_event_v1', {
        p_request_id: event.requestId,
        p_route: event.route,
        p_kind: event.kind,
        p_outcome: event.outcome,
        p_language: event.language,
        p_lab_id: event.labId,
        p_reason: event.reason,
        p_latency_ms: event.latencyMs,
        p_failed_text: event.failedText,
      })
      if (error?.code === MISSING_FUNCTION_CODE) unavailable = true
    } catch {
      // Offline or signed out: the request itself already succeeded or failed on its own.
    }
  },
}
