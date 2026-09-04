import { handleHttpRequest, runDeletionScheduler } from './scheduler'

export default {
  fetch() {
    return handleHttpRequest()
  },
  async scheduled(controller, env): Promise<void> {
    await runDeletionScheduler(env, controller.scheduledTime)
  },
} satisfies ExportedHandler<Env>
