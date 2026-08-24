import { runScheduledBackup } from './storageBackup'

export default {
  async scheduled(_controller, env): Promise<void> {
    await runScheduledBackup(env)
  },
} satisfies ExportedHandler<Env>
