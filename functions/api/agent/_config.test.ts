import { describe, expect, it, vi } from 'vitest'
import { AGENT_MODE_CONFIG_KEY, resolveAgentModeConfig } from './_config'

function envWith(value: unknown) {
  const get = vi.fn().mockResolvedValue(value)
  return { env: { BURILLAB_RUNTIME_CONFIG: { get } }, get }
}

describe('agent mode runtime switch', () => {
  it('reads its own key, never the shared runtime envelope', async () => {
    const { env, get } = envWith({ mode: 'read_only', dailyQuota: 100 })
    await expect(resolveAgentModeConfig(env)).resolves.toEqual({ mode: 'read_only', dailyQuota: 100 })
    expect(get).toHaveBeenCalledWith(AGENT_MODE_CONFIG_KEY, 'json')
    expect(AGENT_MODE_CONFIG_KEY).not.toBe('runtime_config')
  })

  it('allows actions only when the stored value says so', async () => {
    await expect(resolveAgentModeConfig(envWith({ mode: 'actions', dailyQuota: 50 }).env))
      .resolves.toEqual({ mode: 'actions', dailyQuota: 50 })
  })

  it.each([
    ['no KV binding', {}],
    ['no stored value', envWith(null).env],
    ['unknown mode', envWith({ mode: 'everything', dailyQuota: 100 }).env],
    ['missing quota', envWith({ mode: 'read_only' }).env],
    ['zero quota', envWith({ mode: 'read_only', dailyQuota: 0 }).env],
    ['quota above the cap', envWith({ mode: 'read_only', dailyQuota: 100_000 }).env],
    ['unexpected field', envWith({ mode: 'read_only', dailyQuota: 100, voice_disposal_mode: 'guided' }).env],
    ['expired', envWith({ mode: 'actions', dailyQuota: 100, expiresAt: '2020-01-01T00:00:00Z' }).env],
    ['malformed expiry', envWith({ mode: 'actions', dailyQuota: 100, expiresAt: 'tomorrow' }).env],
  ])('is off for %s', async (_label, env) => {
    await expect(resolveAgentModeConfig(env)).resolves.toEqual({ mode: 'off', dailyQuota: 0 })
  })

  it('is off when KV cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const env = { BURILLAB_RUNTIME_CONFIG: { get: vi.fn().mockRejectedValue(new Error('kv offline')) } }
    await expect(resolveAgentModeConfig(env)).resolves.toEqual({ mode: 'off', dailyQuota: 0 })
  })

  it('honours an expiry that has not passed', async () => {
    const env = envWith({ mode: 'read_only', dailyQuota: 100, expiresAt: '2999-01-01T00:00:00Z' }).env
    await expect(resolveAgentModeConfig(env)).resolves.toEqual({ mode: 'read_only', dailyQuota: 100 })
  })
})
