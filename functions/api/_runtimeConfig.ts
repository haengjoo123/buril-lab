export const RUNTIME_CONFIG_KEY = 'runtime_config'

export type VoiceDisposalMode = 'redirect' | 'guided'
export type KoshaContentMode = 'full' | 'link_only'

export interface RuntimeConfig {
  voiceDisposalMode: VoiceDisposalMode
  koshaContentMode: KoshaContentMode
  accountDeletionEnabled: boolean
  maintenanceEnabled: boolean
}

export interface RuntimeConfigKvNamespace {
  get(key: string, type: 'json'): Promise<unknown>
}

export interface RuntimeConfigEnv {
  BURILLAB_RUNTIME_CONFIG?: RuntimeConfigKvNamespace
}

export const NORMAL_RUNTIME_CONFIG: Readonly<RuntimeConfig> = Object.freeze({
  voiceDisposalMode: 'redirect',
  koshaContentMode: 'full',
  accountDeletionEnabled: false,
  maintenanceEnabled: false,
})

export const SAFE_RUNTIME_CONFIG: Readonly<RuntimeConfig> = Object.freeze({
  voiceDisposalMode: 'redirect',
  koshaContentMode: 'link_only',
  accountDeletionEnabled: false,
  maintenanceEnabled: false,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseRuntimeConfig(value: unknown): RuntimeConfig | null {
  if (!isRecord(value)) return null

  const requiredFields = [
    'voice_disposal_mode',
    'kosha_content_mode',
    'account_deletion_enabled',
    'maintenance_worker_enabled',
  ] as const
  if (!requiredFields.every((field) => Object.prototype.hasOwnProperty.call(value, field))) {
    return null
  }

  const voiceDisposalMode = value.voice_disposal_mode
  const koshaContentMode = value.kosha_content_mode
  const accountDeletionEnabled = value.account_deletion_enabled
  const maintenanceEnabled = value.maintenance_worker_enabled

  if (voiceDisposalMode !== 'redirect' && voiceDisposalMode !== 'guided') return null
  if (koshaContentMode !== 'full' && koshaContentMode !== 'link_only') return null
  if (typeof accountDeletionEnabled !== 'boolean') return null
  if (typeof maintenanceEnabled !== 'boolean') return null

  return {
    // Gate 0 contains neither guided disposal nor the deletion/maintenance
    // workers. Preserve schema compatibility without allowing KV to activate
    // code paths that are intentionally absent from this release.
    voiceDisposalMode: 'redirect',
    koshaContentMode,
    accountDeletionEnabled: false,
    maintenanceEnabled: false,
  }
}

export async function resolveRuntimeConfig(env: RuntimeConfigEnv): Promise<RuntimeConfig> {
  const namespace = env.BURILLAB_RUNTIME_CONFIG
  if (!namespace) return { ...SAFE_RUNTIME_CONFIG }

  try {
    const stored = await namespace.get(RUNTIME_CONFIG_KEY, 'json')
    if (stored === null || stored === undefined) return { ...SAFE_RUNTIME_CONFIG }
    return parseRuntimeConfig(stored) ?? { ...SAFE_RUNTIME_CONFIG }
  } catch (error) {
    console.error('[runtime-config] KV read failed:', error)
    return { ...SAFE_RUNTIME_CONFIG }
  }
}
