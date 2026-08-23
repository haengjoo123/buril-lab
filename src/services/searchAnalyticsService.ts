import { isSearchAnalyticsEnabled } from '../config/featureFlags'
import { getInternalApiUrl } from './apiUrl'
import { supabase } from './supabaseClient'

export type SearchAnalyticsOutcome = 'matched' | 'no_result' | 'invalid_query' | 'technical_error'
export type SearchAnalyticsChannel = 'manual' | 'autocomplete' | 'history' | 'scan' | 'voice' | 'url'
export type SearchAnalyticsAction =
  | 'result_opened'
  | 'result_selected'
  | 'query_reformulated'
  | 'scan_corrected'
  | 'added_to_batch'

interface GuestIdentity {
  subjectId: string
  deleteToken: string
}
interface AnalyticsSessionState {
  subjectKey: string
  sessionId: string
  previousEventId: string | null
  lastAt: number
}

export interface RecordSearchEventInput {
  rawQuery: string
  searchChannel: SearchAnalyticsChannel
  outcome: SearchAnalyticsOutcome
  labId?: string | null
  chemicalResultCount?: number
  productResultCount?: number
  cabinetResultCount?: number
  latencyMs?: number
  matchedCas?: string | null
  matchedPubchemCid?: number | null
  matchedKoshaId?: string | number | null
  matchedStandardName?: string | null
}

export interface RecordSearchActionInput {
  eventId: string
  actionType: SearchAnalyticsAction
  relatedEventId?: string | null
  targetType?: 'chemical' | 'product' | 'cabinet' | 'query' | 'batch'
  targetRef?: string | null
  matchedCas?: string | null
  matchedStandardName?: string | null
  metadata?: Record<string, string | number | boolean | null | undefined>
}

interface SearchEventResponse {
  eventId: string
}

const GUEST_IDENTITY_KEY = 'buril:search-analytics:guest:v1'
const SESSION_KEY = 'buril:search-analytics:session:v1'
const FAILURE_COUNT_KEY = 'buril:search-analytics:pending-failures:v1'
const SESSION_TIMEOUT_MS = 30 * 60 * 1000

function createUuid(): string {
  return globalThis.crypto.randomUUID()
}

function createDeleteToken(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function readJson<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // Analytics storage must never interrupt the product flow.
  }
}

function removeStored(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    // Best effort only.
  }
}

function getGuestIdentity(): GuestIdentity {
  const existing = readJson<GuestIdentity>(GUEST_IDENTITY_KEY)
  if (existing?.subjectId && existing.deleteToken) return existing
  const created = { subjectId: createUuid(), deleteToken: createDeleteToken() }
  writeJson(GUEST_IDENTITY_KEY, created)
  return created
}

function getFailureCount(): number {
  try {
    const value = Number(globalThis.localStorage?.getItem(FAILURE_COUNT_KEY) || 0)
    return Number.isInteger(value) && value > 0 ? Math.min(value, 1000) : 0
  } catch {
    return 0
  }
}

function incrementFailureCount(): void {
  try {
    globalThis.localStorage?.setItem(FAILURE_COUNT_KEY, String(Math.min(getFailureCount() + 1, 1000)))
  } catch {
    // Best effort only.
  }
}

function clearFailureCount(): void {
  removeStored(FAILURE_COUNT_KEY)
}

function getSessionState(subjectKey: string): AnalyticsSessionState {
  const now = Date.now()
  const existing = readJson<AnalyticsSessionState>(SESSION_KEY)
  if (
    existing?.subjectKey === subjectKey
    && existing.sessionId
    && now - existing.lastAt <= SESSION_TIMEOUT_MS
  ) {
    return existing
  }
  return { subjectKey, sessionId: createUuid(), previousEventId: null, lastAt: now }
}

async function createRequestContext(): Promise<{
  headers: Record<string, string>
  subjectKey: string
  guest: GuestIdentity | null
}> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`
    return { headers, subjectKey: `user:${session.user.id}`, guest: null }
  }
  const guest = getGuestIdentity()
  headers['X-Buril-Guest-Subject'] = guest.subjectId
  return { headers, subjectKey: `guest:${guest.subjectId}`, guest }
}

async function postAnalytics<T>(
  path: string,
  body: Record<string, unknown>,
  context: Awaited<ReturnType<typeof createRequestContext>>,
): Promise<T> {
  const response = await fetch(getInternalApiUrl(path), {
    method: 'POST',
    headers: context.headers,
    body: JSON.stringify({
      ...body,
      ...(context.guest ? {
        guestSubjectId: context.guest.subjectId,
        guestDeleteToken: context.guest.deleteToken,
      } : {}),
    }),
  })
  const payload = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || `Analytics request failed with status ${response.status}.`)
  return payload
}

export async function recordSearchEvent(input: RecordSearchEventInput): Promise<string | null> {
  if (!isSearchAnalyticsEnabled || !input.rawQuery.trim()) return null
  try {
    const requestContext = await createRequestContext()
    const session = getSessionState(requestContext.subjectKey)
    const eventId = createUuid()
    const previousIngestionFailures = getFailureCount()
    const response = await postAnalytics<SearchEventResponse>('/api/analytics/search-event', {
      eventId,
      sessionId: session.sessionId,
      previousEventId: session.previousEventId,
      ...input,
      previousIngestionFailures,
    }, requestContext)
    writeJson(SESSION_KEY, {
      ...session,
      previousEventId: response.eventId,
      lastAt: Date.now(),
    })
    clearFailureCount()
    return response.eventId
  } catch (error) {
    incrementFailureCount()
    if (import.meta.env.DEV) console.warn('[Search analytics] Event capture failed:', error)
    return null
  }
}

export async function recordSearchAction(input: RecordSearchActionInput): Promise<boolean> {
  if (!isSearchAnalyticsEnabled || !input.eventId) return false
  try {
    const requestContext = await createRequestContext()
    await postAnalytics('/api/analytics/search-action', {
      actionId: createUuid(),
      ...input,
      metadata: Object.fromEntries(
        Object.entries(input.metadata || {}).filter((entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined),
      ),
    }, requestContext)
    return true
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[Search analytics] Action capture failed:', error)
    return false
  }
}

export function hasGuestSearchAnalytics(): boolean {
  return Boolean(readJson<GuestIdentity>(GUEST_IDENTITY_KEY)?.subjectId)
}

export async function deleteGuestSearchAnalytics(): Promise<boolean> {
  if (!isSearchAnalyticsEnabled) return true
  const guest = readJson<GuestIdentity>(GUEST_IDENTITY_KEY)
  if (!guest) return true
  try {
    const requestContext = await createRequestContext()
    await postAnalytics('/api/analytics/guest-delete', {}, {
      ...requestContext,
      subjectKey: `guest:${guest.subjectId}`,
      guest,
      headers: {
        'Content-Type': 'application/json',
        'X-Buril-Guest-Subject': guest.subjectId,
      },
    })
    removeStored(GUEST_IDENTITY_KEY)
    removeStored(SESSION_KEY)
    clearFailureCount()
    return true
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[Search analytics] Guest deletion failed:', error)
    return false
  }
}
