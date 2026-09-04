import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createApiMiddleware } from '../functions/api/_middleware'
import { onRequestPost } from '../functions/api/labs/join'

type Dependencies = {
  middleware?: ReturnType<typeof createApiMiddleware>
  join?: typeof onRequestPost
}

/** Vite-only bridge; uses the same auth, limiter, body cap and handler as Pages. */
export function createLocalLabJoinApi(sourceEnvironment: Record<string, string>, dependencies: Dependencies = {}) {
  const env = { ...sourceEnvironment, APP_ENVIRONMENT: 'development' }
  const middleware = dependencies.middleware ?? createApiMiddleware()
  const join = dependencies.join ?? onRequestPost
  return async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
    try {
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        // There is no trusted Cloudflare edge in a local Vite process.
        if (name.toLowerCase() === 'cf-connecting-ip') continue
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
        else if (value !== undefined) headers.set(name, value)
      }
      const method = incoming.method ?? 'GET'
      const init: RequestInit & { duplex?: 'half' } = { method, headers }
      if (!['GET', 'HEAD'].includes(method)) {
        init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
        init.duplex = 'half'
      }
      const request = new Request(new URL(incoming.url ?? '/api/labs/join', 'http://127.0.0.1'), init)
      const data: Record<string, unknown> = {}
      const response = await middleware({ request, env, params: {}, data,
        next: (boundedRequest = request) => join({ request: boundedRequest, env, data }) })
      outgoing.statusCode = response.status
      response.headers.forEach((value, name) => outgoing.setHeader(name, value))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      outgoing.statusCode = 503
      outgoing.setHeader('Content-Type', 'application/json')
      outgoing.setHeader('Cache-Control', 'no-store')
      outgoing.setHeader('X-Content-Type-Options', 'nosniff')
      outgoing.end(JSON.stringify({ error: 'The service is temporarily unavailable.', code: 'JOIN_UNAVAILABLE' }))
    }
  }
}
