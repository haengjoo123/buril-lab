import { runStorageBackupSchedule } from './scheduled'

export default {
  async scheduled(_controller, env): Promise<void> {
    await runStorageBackupSchedule(env)
  },
} satisfies ExportedHandler<Env>
