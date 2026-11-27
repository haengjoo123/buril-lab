import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))

import type { AgentQueryEvent } from '../features/agent/agentEvents'

const event: AgentQueryEvent = {
  requestId: '33333333-3333-4333-8333-333333333333',
  labId: '11111111-1111-4111-8111-111111111111',
  route: 'planner',
  kind: 'unsupported',
  outcome: 'unsupported',
  reason: 'out_of_scope',
  latencyMs: 812,
  language: 'ko',
  failedText: '오늘 점심 뭐야',
}

// The service remembers a missing function for the session, so each test loads it afresh.
async function loadService() {
  vi.resetModules()
  return (await import('./agentEventService')).agentEventService
}

describe('agent event service', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ error: null })
  })

  it('writes through the record function only', async () => {
    const service = await loadService()
    await service.record(event)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('record_agent_query_event_v1', {
      p_request_id: event.requestId,
      p_route: 'planner',
      p_kind: 'unsupported',
      p_outcome: 'unsupported',
      p_language: 'ko',
      p_lab_id: event.labId,
      p_reason: 'out_of_scope',
      p_latency_ms: 812,
      p_failed_text: '오늘 점심 뭐야',
    })
  })

  it('never throws, whatever the write does', async () => {
    const service = await loadService()
    rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'AGENT_EVENT_ACCESS_DENIED' } })
    await expect(service.record(event)).resolves.toBeUndefined()
    rpc.mockRejectedValueOnce(new Error('offline'))
    await expect(service.record(event)).resolves.toBeUndefined()
    // Neither failure means the function is missing, so the next request is still recorded.
    await service.record(event)
    expect(rpc).toHaveBeenCalledTimes(3)
  })

  it('stops trying for the session once the function turns out to be missing', async () => {
    const service = await loadService()
    rpc.mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'Could not find the function' } })
    await service.record(event)
    await service.record(event)
    await service.record(event)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
