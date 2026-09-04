import { enqueueDeletionRequest, type DeletionIntakeEnv } from '../deletions/_shared'

export const onRequestPost = async (context: {
  request: Request
  env: DeletionIntakeEnv
  data?: Record<string, unknown>
}): Promise<Response> => enqueueDeletionRequest(context, 'lab')
