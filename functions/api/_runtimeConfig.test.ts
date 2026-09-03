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
  it.each([false, true])('uses normal web values with all five fields and backup=%s', async (storageBackupEnabled) => {
    const namespace = kv({
      voice_disposal_mode: 'redirect',
      kosha_content_mode: 'full',
      account_deletion_enabled: false,
      maintenance_worker_enabled: false,
      storage_backup_enabled: storageBackupEnabled,
    })

    await expect(resolveRuntimeConfig({ BURILLAB_RUNTIME_CONFIG: namespace })).resolves.toEqual(
      NORMAL_RUNTIME_CONFIG,
    )
    expect(namespace.get).toHaveBeenCalledWith(RUNTIME_CONFIG_KEY, 'json')
  })

  it('allows the prepared deletion intake switch while unavailable workflows stay disabled', async () => {
    await expect(resolveRuntimeConfig({
      BURILLAB_RUNTIME_CONFIG: kv({
        voice_disposal_mode: 'guided',
        kosha_content_mode: 'full',
        account_deletion_enabled: true,
        maintenance_worker_enabled: true,
        storage_backup_enabled: true,
      }),
    })).resolves.toEqual({
      voiceDisposalMode: 'redirect',
      koshaContentMode: 'full',
      accountDeletionEnabled: true,
      maintenanceEnabled: false,
    })
  })

  it.each([
    ['undefined', undefined], ['null', null], ['string', 'true'],
    ['number', 1], ['array', []], ['object', {}],
  ])('fails closed for a malformed backup field: %s', async (_label, value) => {
    await expect(resolveRuntimeConfig({
      BURILLAB_RUNTIME_CONFIG: kv({
        voice_disposal_mode: 'redirect',
        kosha_content_mode: 'full',
        account_deletion_enabled: false,
        maintenance_worker_enabled: false,
        storage_backup_enabled: value,
      }),
    })).resolves.toEqual(SAFE_RUNTIME_CONFIG)
  })

  it('fails closed for the old four-field configuration', async () => {
    await expect(resolveRuntimeConfig({
      BURILLAB_RUNTIME_CONFIG: kv({
        voice_disposal_mode: 'redirect',
        kosha_content_mode: 'full',
        account_deletion_enabled: false,
        maintenance_worker_enabled: false,
      }),
    })).resolves.toEqual(SAFE_RUNTIME_CONFIG)
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
      storage_backup_enabled: false,
    }) }],
  ])('fails closed for a %s', async (_label, env) => {
    await expect(resolveRuntimeConfig(env)).resolves.toEqual(SAFE_RUNTIME_CONFIG)
  })

  it('fails closed when KV is unavailable', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const namespace: RuntimeConfigKvNamespace = {
      get: vi.fn().mockRejectedValue(new Error('PRIVATE_RUNTIME_CONFIGURATION_DETAILS')),
    }

    await expect(resolveRuntimeConfig({ BURILLAB_RUNTIME_CONFIG: namespace })).resolves.toEqual(
      SAFE_RUNTIME_CONFIG,
    )
    expect(consoleSpy).toHaveBeenCalledWith('{"event":"runtime_config_unavailable"}')
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('PRIVATE_RUNTIME_CONFIGURATION_DETAILS')
  })
})
