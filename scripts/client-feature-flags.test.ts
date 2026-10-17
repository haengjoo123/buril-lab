import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from 'vite'
import { FEATURE_FLAGS } from './web-release.mjs'

afterEach(() => vi.unstubAllEnvs())

describe('release feature flags reach the browser build', () => {
  it.each(['true', 'false', ''])('injects the configured value %j for every release flag', async (value) => {
    for (const flag of FEATURE_FLAGS) vi.stubEnv(flag, value)

    const config = await resolveConfig({ mode: 'test' }, 'build')

    for (const flag of FEATURE_FLAGS) {
      expect(config.define?.[`import.meta.env.${flag}`], flag).toBe(JSON.stringify(value))
    }
    expect(config.envPrefix).toBe('BURIL_AUTO_ENV_DISABLED_')
  })
})
