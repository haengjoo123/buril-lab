import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { KNOWN_EXACT_API_ROUTES, isAllowedApiMethod, resolveApiRoutePolicy } from './_routePolicy'
import { onRequest as notFound } from './[[path]]'

const apiRoot = fileURLToPath(new URL('.', import.meta.url))

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) return routeFiles(file)
    if (entry.name.startsWith('_') || entry.name.endsWith('.test.ts') || !entry.name.endsWith('.ts')) return []
    return /\bonRequest(?:Get|Post)\b/.test(readFileSync(file, 'utf8')) ? [file] : []
  })
}

describe('API file routing policy', () => {
  it('explicitly covers every method-specific Pages handler', () => {
    const registered = [...KNOWN_EXACT_API_ROUTES, '/api/cabinets/[id]/image', '/api/kosha/[endpoint]'].sort()
    const actual = routeFiles(apiRoot)
      .map((file) => `/api/${relative(apiRoot, file).replaceAll('\\', '/').replace(/\.ts$/, '')}`)
      .sort()
    expect(registered).toEqual(actual)
    for (const file of routeFiles(apiRoot)) {
      const route = `/api/${relative(apiRoot, file).replaceAll('\\', '/').replace(/\.ts$/, '')}`
      const policyPath = route.replace('/cabinets/[id]/', '/cabinets/00000000-0000-4000-8000-000000000000/')
      const policy = resolveApiRoutePolicy(policyPath)
      const source = readFileSync(file, 'utf8')
      expect(policy?.methods).toEqual(source.includes('onRequestGet') ? ['GET'] : ['POST'])
    }
  })

  it('matches specific routes before the KOSHA parameter and supports a trailing slash', () => {
    expect(resolveApiRoutePolicy('/api/kosha/msds')?.id).toBe('/api/kosha/msds')
    expect(resolveApiRoutePolicy('/api/kosha/chemdetail01')?.id).toBe('/api/kosha/[endpoint]')
    expect(resolveApiRoutePolicy('/api/voice/query/')?.methods).toEqual(['POST'])
    expect(resolveApiRoutePolicy('/api/voice/query//')).toBeNull()
    expect(resolveApiRoutePolicy('/api/cabinets/00000000-0000-4000-8000-000000000000/image')?.id)
      .toBe('/api/cabinets/[id]/image')
    expect(resolveApiRoutePolicy('/api/cabinets/not-a-uuid/image')).toBeNull()
  })

  it.each(['/api', '/api/missing', '/api/voice/query/extra', '/api/kosha/a/b', '/api/_middleware']) (
    'does not map the unknown API path %s to a valid handler',
    (path) => expect(resolveApiRoutePolicy(path)).toBeNull(),
  )

  it('allows only the declared HTTP methods', () => {
    const policy = resolveApiRoutePolicy('/api/voice/query')!
    expect(isAllowedApiMethod(policy, 'POST')).toBe(true)
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      expect(isAllowedApiMethod(policy, method)).toBe(false)
    }
  })

  it('has a JSON catch-all even when no specific function matches', async () => {
    const response = notFound()
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'API route was not found.', code: 'API_NOT_FOUND' })
  })
})
