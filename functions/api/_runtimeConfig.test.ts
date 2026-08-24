import { describe, expect, it, vi } from 'vitest'
import {
  NORMAL_RUNTIME_CONFIG,
  RUNTIME_CONFIG_KEY,
  SAFE_RUNTIME_CONFIG,
  resolveRuntimeConfig,
  type RuntimeConfigKvNamespace,
} from './_runtimeConfig'

function kv(value: unknown): RuntimeConfigKvNamespace {
  return { get: vi.fn().mockResolvedValue(value) }
}

describe('runtime configuration resolver', () => {
  it('uses normal values only when all four safety fields are present and typed', async () => {
    const namespace = kv({
      voice_disposal_mode: 'redirect',
      kosha_content_mode: 'full',
      account_deletion_enabled: false,
      maintenance_worker_enabled: false,
    })

    await expect(resolveRuntimeConfig({ BURILLAB_RUNTIME_CONFIG: namespace })).resolves.toEqual(
      NORMAL_RUNTIME_CONFIG,
    )
    expect(namespace.get).toHaveBeenCalledWith(RUNTIME_CONFIG_KEY, 'json')
  })

  it('keeps unavailable Gate 0 workflows disabled even if KV requests them', async () => {
    await expect(resolveRuntimeConfig({
      BURILLAB_RUNTIME_CONFIG: kv({
        voice_disposal_mode: 'guided',
        kosha_content_mode: 'full',
        account_deletion_enabled: true,
        maintenance_worker_enabled: true,
      }),
    })).resolves.toEqual({
      voiceDisposalMode: 'redirect',
      koshaContentMode: 'full',
      accountDeletionEnabled: false,
      maintenanceEnabled: false,
    })
  })

  it.each([
    ['missing binding', {}],
    ['missing key', { BURILLAB_RUNTIME_CONFIG: kv(null) }],
    ['empty object', { BURILLAB_RUNTIME_CONFIG: kv({}) }],
    ['partial object', { BURILLAB_RUNTIME_CONFIG: kv({
      voice_disposal_mode: 'redirect',
      kosha_content_mode: 'full',
      account_deletion_enabled: false,
    }) }],
    ['invalid field', { BURILLAB_RUNTIME_CONFIG: kv({
      voice_disposal_mode: 'redirect',
      kosha_content_mode: 'full',
      account_deletion_enabled: false,
      maintenance_worker_enabled: 'no',
    }) }],
  ])('fails closed for a %s', async (_label, env) => {
    await expect(resolveRuntimeConfig(env)).resolves.toEqual(SAFE_RUNTIME_CONFIG)
  })

  it('fails closed when KV is unavailable', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const namespace: RuntimeConfigKvNamespace = {
      get: vi.fn().mockRejectedValue(new Error('unavailable')),
    }

    await expect(resolveRuntimeConfig({ BURILLAB_RUNTIME_CONFIG: namespace })).resolves.toEqual(
      SAFE_RUNTIME_CONFIG,
    )
    expect(consoleSpy).toHaveBeenCalled()
  })
})
