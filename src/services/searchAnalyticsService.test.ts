import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.hoisted(() => vi.fn())
const analyticsFlag = vi.hoisted(() => ({ enabled: true }))

vi.mock('./supabaseClient', () => ({
  supabase: { auth: { getSession } },
}))
vi.mock('../config/featureFlags', () => ({
  get isSearchAnalyticsEnabled() { return analyticsFlag.enabled },
}))

import { recordSearchAction, recordSearchEvent } from './searchAnalyticsService'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => { data.delete(key) },
    setItem: (key, value) => { data.set(key, value) },
  }
}

describe('search analytics client capture', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    getSession.mockResolvedValue({ data: { session: null } })
    analyticsFlag.enabled = true
    vi.restoreAllMocks()
  })

  it('does not collect when the incident kill switch explicitly disables analytics', async () => {
    analyticsFlag.enabled = false
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(recordSearchEvent({
      rawQuery: 'Acetone',
      searchChannel: 'manual',
      outcome: 'matched',
    })).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends only a submitted event with a random guest subject and no network fingerprint fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const eventId = await recordSearchEvent({
      rawQuery: 'Acetone',
      searchChannel: 'manual',
      outcome: 'matched',
      chemicalResultCount: 1,
      latencyMs: 120,
    })

    expect(eventId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(headers['X-Buril-Guest-Subject']).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.rawQuery).toBe('Acetone')
    expect(body.guestDeleteToken).toEqual(expect.any(String))
    expect(body).not.toHaveProperty('ip')
    expect(body).not.toHaveProperty('userAgent')
    expect(body).not.toHaveProperty('browserFingerprint')
  })

  it('fails open when analytics ingestion is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    await expect(recordSearchEvent({
      rawQuery: '67-64-1',
      searchChannel: 'scan',
      outcome: 'technical_error',
    })).resolves.toBeNull()
  })

  it('records only allowlisted action metadata through the client contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const success = await recordSearchAction({
      eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      actionType: 'scan_corrected',
      metadata: { selectedField: 'casNumber', corrected: true, ignoredUndefined: undefined },
    })
    expect(success).toBe(true)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { metadata: Record<string, unknown> }
    expect(body.metadata).toEqual({ selectedField: 'casNumber', corrected: true })
  })
})
