export type ApiMethod = 'GET' | 'POST'

export interface ApiRoutePolicy {
  id: string
  methods: readonly ApiMethod[]
}

const POST_ROUTES = [
  '/api/account/delete',
  '/api/admin/analytics/export',
  '/api/admin/analytics/mixtures',
  '/api/admin/analytics/reviews',
  '/api/admin/analytics/search',
  '/api/admin/analytics/summary',
  '/api/admin/feedback/list',
  '/api/admin/feedback/status',
  '/api/admin/safety-centers/document-url',
  '/api/admin/safety-centers/list',
  '/api/admin/safety-centers/status',
  '/api/ai/classify',
  '/api/ai/disposal-guide',
  '/api/ai/scan-label',
  '/api/analytics/guest-delete',
  '/api/analytics/search-action',
  '/api/analytics/search-event',
  '/api/analytics/user-delete',
  '/api/chemicals/enrich',
  '/api/gemini/classify',
  '/api/gemini/disposal-guide',
  '/api/gemini/scan-label',
  '/api/labs/join',
  '/api/reagents/cas-resolve',
  '/api/voice/query',
  '/api/voice/speak',
  '/api/voice/transcribe',
  '/api/waste/authorize-predicted-ph',
] as const

const GET_ROUTES = [
  '/api/chemicals/suggest',
  '/api/kosha/msds',
] as const

const exactPolicies = new Map<string, ApiRoutePolicy>([
  ...POST_ROUTES.map((path) => [path, { id: path, methods: ['POST'] as const }] as const),
  ...GET_ROUTES.map((path) => [path, { id: path, methods: ['GET'] as const }] as const),
])

const dynamicPolicies: ReadonlyArray<{ pattern: RegExp; policy: ApiRoutePolicy }> = [
  {
    pattern: /^\/api\/kosha\/[^/]+$/,
    policy: { id: '/api/kosha/[endpoint]', methods: ['GET'] },
  },
]

export const KNOWN_EXACT_API_ROUTES = Object.freeze([
  ...POST_ROUTES,
  ...GET_ROUTES,
])

export function resolveApiRoutePolicy(pathname: string): ApiRoutePolicy | null {
  const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const exact = exactPolicies.get(normalizedPath)
  if (exact) return exact

  return dynamicPolicies.find(({ pattern }) => pattern.test(normalizedPath))?.policy || null
}

export function isAllowedApiMethod(policy: ApiRoutePolicy, method: string): method is ApiMethod {
  return policy.methods.includes(method as ApiMethod)
}

export function getApiRequestBodyLimit(policy: ApiRoutePolicy): number {
  if (policy.id === '/api/labs/join') return 8 * 1024
  if (/^\/api\/(?:ai|gemini)\/scan-label$/.test(policy.id)) return 12 * 1024 * 1024
  if (policy.id === '/api/voice/transcribe') return 5 * 1024 * 1024 + 64 * 1024
  if (policy.id.startsWith('/api/analytics/')) return 32 * 1024
  if (policy.id === '/api/voice/query'
    || policy.id === '/api/waste/authorize-predicted-ph'
    || /^\/api\/(?:ai|gemini)\/disposal-guide$/.test(policy.id)) return 256 * 1024
  return 64 * 1024
}
