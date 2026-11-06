// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const postJsonMock = vi.hoisted(() => vi.fn())

vi.mock('./supabaseClient', () => ({ supabase: { auth: { getSession: vi.fn() } } }))
vi.mock('./internalApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('./internalApi')>(),
  postJson: postJsonMock,
}))

import { isAnalyticsKpis, loadAnalyticsSummary } from './opsAnalyticsService'

function kpisShape(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-06T08:27:55.229315+00:00',
    period: { days: 7, timeZone: 'Asia/Seoul', currentStart: 'a', currentEnd: 'b', previousStart: 'c' },
    exclusions: { internalLabs: 0, internalUsers: 0 },
    inbox: {},
    product: {},
    safety: {},
    b2b: {},
    ...overrides,
  }
}

describe('operator analytics summary call', () => {
  beforeEach(() => {
    postJsonMock.mockReset()
    postJsonMock.mockResolvedValue({ summary: {}, governance: {} })
  })

  it('keeps the request body at { days } unless the KPIs are asked for', async () => {
    await loadAnalyticsSummary(7)
    expect(postJsonMock).toHaveBeenLastCalledWith('/api/admin/analytics/summary', { days: 7 })

    await loadAnalyticsSummary(7, { includeKpis: false })
    expect(postJsonMock).toHaveBeenLastCalledWith('/api/admin/analytics/summary', { days: 7 })

    await loadAnalyticsSummary(30, { includeKpis: true })
    expect(postJsonMock).toHaveBeenLastCalledWith('/api/admin/analytics/summary', { days: 30, includeKpis: true })
  })

  it('accepts only a schema-1 KPI payload with every section', () => {
    expect(isAnalyticsKpis(kpisShape())).toBe(true)
    expect(isAnalyticsKpis(null)).toBe(false)
    expect(isAnalyticsKpis(undefined)).toBe(false)
    expect(isAnalyticsKpis([])).toBe(false)
    expect(isAnalyticsKpis('kpis')).toBe(false)
    expect(isAnalyticsKpis(kpisShape({ schemaVersion: 2 }))).toBe(false)
    expect(isAnalyticsKpis(kpisShape({ b2b: undefined }))).toBe(false)
    expect(isAnalyticsKpis(kpisShape({ safety: null }))).toBe(false)
    expect(isAnalyticsKpis(kpisShape({ inbox: [] }))).toBe(false)
  })
})
