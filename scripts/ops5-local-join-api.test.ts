// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiMiddleware } from '../functions/api/_middleware'
import type { onRequestPost } from '../functions/api/labs/join'
import { createLocalLabJoinApi } from './ops5-local-join-api'

const servers: Server[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  })))
})

async function serve(dependencies: Parameters<typeof createLocalLabJoinApi>[1] = {}) {
  const server = createServer(createLocalLabJoinApi({ APP_ENVIRONMENT: 'production' }, dependencies))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local address')
  return `http://127.0.0.1:${address.port}/api/labs/join`
}

const authorizedMiddleware = () => createApiMiddleware({
  verifyToken: async () => ({ sub: '11111111-1111-4111-8111-111111111111' }),
  applyRateLimit: async () => ({ success: true, limit: 30, remaining: 29, reset: Date.now() + 60_000 }),
})

describe('Vite lab join bridge', () => {
  it('streams through the actual middleware and removes a spoofed edge IP', async () => {
    const join = vi.fn(async (context: Parameters<typeof onRequestPost>[0]) => {
      expect(context.env.APP_ENVIRONMENT).toBe('development')
      expect(context.request.headers.get('cf-connecting-ip')).toBeNull()
      expect(context.data?.userId).toBe('11111111-1111-4111-8111-111111111111')
      expect(await context.request.json()).toEqual({ labId: 'synthetic', password: 'synthetic' })
      return Response.json({ success: true })
    })
    const url = await serve({ middleware: authorizedMiddleware(), join })
    const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer synthetic',
      'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', Origin: new URL(url).origin },
    body: JSON.stringify({ labId: 'synthetic', password: 'synthetic' }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-ID')).toMatch(/^[a-f0-9-]{36}$/)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(join).toHaveBeenCalledTimes(1)
  })

  it('keeps unauthenticated calls and wrong methods away from the join handler', async () => {
    const join = vi.fn()
    const url = await serve({ join })
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(401)
    const wrongMethod = await fetch(url)
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('Allow')).toBe('POST, OPTIONS')
    expect(join).not.toHaveBeenCalled()
  })

  it('rejects oversize JSON in the shared middleware before calling the join handler', async () => {
    const join = vi.fn()
    const url = await serve({ middleware: authorizedMiddleware(), join })
    const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer synthetic',
      'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'x'.repeat(8192) }) })
    expect(response.status).toBe(413)
    expect(join).not.toHaveBeenCalled()
  })

  it('fails closed when the local request limiter is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const join = vi.fn()
    const url = await serve({ join, middleware: createApiMiddleware({
      verifyToken: async () => ({ sub: '11111111-1111-4111-8111-111111111111' }),
      applyRateLimit: async () => { throw new Error('sensitive-synthetic-error') },
    }) })
    const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer synthetic' }, body: '{}' })
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('sensitive-synthetic-error')
    expect(join).not.toHaveBeenCalled()
  })
})
