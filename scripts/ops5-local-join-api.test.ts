// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiMiddleware } from '../functions/api/_middleware'
import type { onRequestPost } from '../functions/api/labs/join'
import { createLocalLabJoinApi } from './ops5-local-join-api'

const servers: Server[] = []
const fetchBlockedPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540,
  548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080,
])
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  })))
})

async function serve(dependencies: Parameters<typeof createLocalLabJoinApi>[1] = {}) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = createServer(createLocalLabJoinApi({ APP_ENVIRONMENT: 'production' }, dependencies))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      throw new Error('No local address')
    }
    if (fetchBlockedPorts.has(address.port)) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      continue
    }
    servers.push(server)
    return `http://127.0.0.1:${address.port}/api/labs/join`
  }
  throw new Error('Could not allocate a fetch-safe local port')
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
