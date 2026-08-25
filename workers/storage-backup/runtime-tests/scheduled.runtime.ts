import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'

const RUNTIME_CONFIG_KEY = 'runtime_config'
const SENTINEL_KEY = 'runtime-tests/sentinel.txt'

async function setBackupEnabled(enabled: boolean): Promise<void> {
  await env.BURILLAB_RUNTIME_CONFIG.put(RUNTIME_CONFIG_KEY, JSON.stringify({
    voice_disposal_mode: 'redirect',
    kosha_content_mode: 'link_only',
    account_deletion_enabled: false,
    maintenance_worker_enabled: false,
    storage_backup_enabled: enabled,
  }))
}

async function expectSentinelUnchanged(): Promise<void> {
  const stored = await env.CABINET_BACKUPS.get(SENTINEL_KEY)
  expect(stored).not.toBeNull()
  expect(await stored?.text()).toBe('unchanged')
  const listed = await env.CABINET_BACKUPS.list()
  expect(listed.objects.map((entry) => entry.key)).toEqual([SENTINEL_KEY])
}

describe('scheduled Worker in the Cloudflare runtime', () => {
  beforeEach(async () => {
    await env.BURILLAB_RUNTIME_CONFIG.delete(RUNTIME_CONFIG_KEY)
    const existing = await env.CABINET_BACKUPS.list()
    if (existing.objects.length > 0) {
      await env.CABINET_BACKUPS.delete(existing.objects.map((entry) => entry.key))
    }
    await env.CABINET_BACKUPS.put(SENTINEL_KEY, 'unchanged')
  })

  it('has no public fetch handler and exits cleanly while the KV flag is off', async () => {
    expect('fetch' in worker).toBe(false)
    await setBackupEnabled(false)

    await expect(worker.scheduled({} as ScheduledController, env)).resolves.toBeUndefined()

    await expectSentinelUnchanged()
  })

  it('uses the real KV binding but refuses Supabase and R2 work on the Free profile', async () => {
    await setBackupEnabled(true)

    await expect(worker.scheduled({} as ScheduledController, env)).rejects.toThrow(
      'storage_backup_failed:workers_paid_plan_required',
    )

    await expectSentinelUnchanged()
  })
})
