import { pathToFileURL } from 'node:url'

const CLOUDFLARE_ACCOUNT_ID = '692fedd5b67a5fd545bb16038bbd4c85'
const MAX_RUNTIME_CONFIG_BYTES = 32 * 1_024
const TARGETS = Object.freeze({
  staging: Object.freeze({
    namespaceId: 'dcaa52254fa6447bbe7c21f54354ad0d',
    runtimeConfig: Object.freeze({
      voice_disposal_mode: 'redirect',
      kosha_content_mode: 'link_only',
      account_deletion_enabled: false,
      maintenance_worker_enabled: false,
      storage_backup_enabled: false,
    }),
  }),
  production: Object.freeze({
    namespaceId: 'dd6866f35f794a91b0fb5a24cbe57cf3',
    runtimeConfig: Object.freeze({
      voice_disposal_mode: 'redirect',
      kosha_content_mode: 'full',
      account_deletion_enabled: false,
      maintenance_worker_enabled: false,
      storage_backup_enabled: false,
    }),
  }),
})

function requireExactTarget({ environment, accountId, namespaceId }) {
  const target = TARGETS[environment]
  if (!target) {
    throw new Error('Storage-backup runtime verification requires an approved environment.')
  }
  if (accountId !== CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Storage-backup runtime verification received the wrong Cloudflare account.')
  }
  if (namespaceId !== target.namespaceId) {
    throw new Error(`Storage-backup runtime verification received the wrong ${environment} KV namespace.`)
  }
  return target
}

export function verifyStorageBackupRuntimeOff(raw, target) {
  const expectedTarget = requireExactTarget(target)
  if (typeof raw !== 'string' || raw.length === 0 || Buffer.byteLength(raw, 'utf8') > MAX_RUNTIME_CONFIG_BYTES) {
    throw new Error(`${target.environment} runtime_config is missing or too large.`)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${target.environment} runtime_config is not valid JSON.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${target.environment} runtime_config must be one JSON object.`)
  }
  const expectedKeys = Object.keys(expectedTarget.runtimeConfig).sort()
  const actualKeys = Object.keys(parsed).sort()
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`${target.environment} runtime_config must contain exactly the five approved safety switches.`)
  }
  for (const [key, expected] of Object.entries(expectedTarget.runtimeConfig)) {
    if (parsed[key] !== expected) {
      throw new Error(`${target.environment} runtime_config has an unsafe value for ${key}.`)
    }
  }

  return {
    environment: target.environment,
    accountId: CLOUDFLARE_ACCOUNT_ID,
    namespaceId: expectedTarget.namespaceId,
    storageBackupEnabled: false,
  }
}

async function main() {
  const result = verifyStorageBackupRuntimeOff(
    process.env.STORAGE_BACKUP_RUNTIME_CONFIG_JSON,
    {
      environment: process.env.DEPLOY_ENVIRONMENT,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      namespaceId: process.env.BURILLAB_RUNTIME_CONFIG_KV_ID,
    },
  )
  console.log(`Storage backup remains exactly OFF in ${result.environment} runtime config.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Storage-backup runtime verification failed.')
    process.exitCode = 1
  })
}
