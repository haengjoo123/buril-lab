import { describe, expect, it, vi } from 'vitest'
import { createAgentModeHandler, type AgentModeDependencies } from './mode'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function setup(mode: 'off' | 'read_only' | 'actions') {
  const resolveConfig = vi.fn<AgentModeDependencies['resolveConfig']>().mockResolvedValue({ mode, dailyQuota: 100 })
  const handler = createAgentModeHandler({ resolveConfig })
  const call = (userId: string | null = USER_ID) => handler({
    request: new Request('https://burillab.com/api/agent/mode', { method: 'POST' }),
    env: {},
    data: userId ? { userId } : {},
  })
  return { call, resolveConfig }
}

describe('agent mode endpoint', () => {
  it('requires the user identity that the API middleware verified', async () => {
    const run = setup('actions')
    const response = await run.call(null)
    expect(response.status).toBe(401)
    expect(run.resolveConfig).not.toHaveBeenCalled()
  })

  it.each(['off', 'read_only', 'actions'] as const)('reports the runtime switch as %s', async (mode) => {
    const response = await setup(mode).call()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    // Only the switch: the daily allowance and anything else in the config stay on the server.
    await expect(response.json()).resolves.toEqual({ schemaVersion: 1, mode })
  })
})
