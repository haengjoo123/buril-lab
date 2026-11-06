import i18n from '../../locales/i18n';

// These assertions deliberately verify Korean UI copy, independent of host locale.
beforeEach(async () => { await i18n.changeLanguage('ko'); });

import { beforeEach, describe, expect, it } from 'vitest'
import {
  MATRIX_LABELS,
  canonicalComponentDisplayKey,
  fillDailyTrend,
  ingestionFailureStatus,
  koreanChemicalDisplayName,
  koreanReviewDisplayText,
  opsAnalyticsLabel,
  searchEventWindows,
  seoulDateString,
} from './opsAnalyticsLabels'

describe('opsAnalyticsLabels', () => {
  it('updates translated labels when the language changes after import', async () => {
    expect(opsAnalyticsLabel('aqueous', MATRIX_LABELS)).toBe('물·수용액')
    await i18n.changeLanguage('en')
    expect(opsAnalyticsLabel('aqueous', MATRIX_LABELS)).toBe('Water / aqueous solution')
    expect(canonicalComponentDisplayKey('name:sample')).toBe('Name sample')
    await i18n.changeLanguage('ko')
    expect(canonicalComponentDisplayKey('name:sample')).toBe('명칭 sample')
  })

  it('removes a redundant English chemical name from a Korean display name', () => {
    expect(koreanChemicalDisplayName('수산화나트륨 (Sodium Hydroxide)')).toBe('수산화나트륨')
    expect(koreanChemicalDisplayName('벤조일아세톤 (Benzoylacetone)')).toBe('벤조일아세톤')
  })

  it('keeps chemical formulae, standards, and names that have no Korean label', () => {
    expect(koreanChemicalDisplayName('수산화나트륨 (NaOH)')).toBe('수산화나트륨 (NaOH)')
    expect(koreanChemicalDisplayName('시약 (CAS 67-64-1)')).toBe('시약 (CAS 67-64-1)')
    expect(koreanChemicalDisplayName('Sodium Hydroxide')).toBe('Sodium Hydroxide')
  })

  it('formats canonical keys without exposing storage prefixes', () => {
    expect(canonicalComponentDisplayKey('cas:1310-73-2')).toBe('CAS 1310-73-2')
    expect(canonicalComponentDisplayKey('name:미상 시약')).toBe('명칭 미상 시약')
    expect(canonicalComponentDisplayKey('unexpected:key')).toBe('식별값 확인 필요')
  })

  it('uses Korean labels while keeping a safe fallback for unknown codes', () => {
    expect(opsAnalyticsLabel('aqueous', MATRIX_LABELS)).toBe('물·수용액')
    expect(opsAnalyticsLabel('future_matrix', MATRIX_LABELS, '미분류')).toBe('미분류')
  })

  it('replaces internal review terminology in visible copy', () => {
    expect(koreanReviewDisplayText('문헌·골든셋·담당자 검토')).toBe('문헌·검증 기준표·담당자 검토')
  })
})

describe('search event windows', () => {
  it('hides windows longer than the selected period', () => {
    expect(searchEventWindows(7)).toEqual([7])
    expect(searchEventWindows(30)).toEqual([7, 30])
    expect(searchEventWindows(90)).toEqual([7, 30, 90])
    expect(searchEventWindows(3)).toEqual([])
  })
})

describe('ingestion failure status', () => {
  it('compares the rate with the 1% operating baseline', () => {
    expect(ingestionFailureStatus(0)).toBe('normal')
    expect(ingestionFailureStatus(0.99)).toBe('normal')
    expect(ingestionFailureStatus(1)).toBe('attention')
    expect(ingestionFailureStatus(4.5)).toBe('attention')
  })

  it('does not claim a status without a usable rate', () => {
    expect(ingestionFailureStatus(undefined)).toBe('unknown')
    expect(ingestionFailureStatus(Number.NaN)).toBe('unknown')
    expect(ingestionFailureStatus(-1)).toBe('unknown')
  })
})

describe('fillDailyTrend', () => {
  it('uses Asia/Seoul calendar dates', () => {
    expect(seoulDateString(new Date('2026-11-05T14:59:59Z'))).toBe('2026-11-05')
    expect(seoulDateString(new Date('2026-11-05T15:00:00Z'))).toBe('2026-11-06')
  })

  it('fills every date in the window with zero rows and keeps server counts', () => {
    // 2026-11-06 10:00 KST; a 7-day window starts 2026-10-30 10:00 KST.
    const now = new Date('2026-11-06T01:00:00Z')
    const filled = fillDailyTrend([
      { date: '2026-11-06', searches: 2, noResults: 1 },
      { date: '2026-11-01', searches: 5, noResults: 0 },
    ], 7, now)
    expect(filled.map((point) => point.date)).toEqual([
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
      '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
    ])
    expect(filled.find((point) => point.date === '2026-11-01')).toEqual({ date: '2026-11-01', searches: 5, noResults: 0 })
    expect(filled.find((point) => point.date === '2026-11-03')).toEqual({ date: '2026-11-03', searches: 0, noResults: 0 })
    expect(filled.reduce((total, point) => total + point.searches, 0)).toBe(7)
  })

  it('switches to the next Seoul date at 15:00 UTC', () => {
    const beforeMidnight = fillDailyTrend([], 1, new Date('2026-11-05T14:30:00Z'))
    expect(beforeMidnight.map((point) => point.date)).toEqual(['2026-11-04', '2026-11-05'])
    const afterMidnight = fillDailyTrend([], 1, new Date('2026-11-05T15:30:00Z'))
    expect(afterMidnight.map((point) => point.date)).toEqual(['2026-11-05', '2026-11-06'])
  })

  it('crosses month and year boundaries and sorts the result', () => {
    const filled = fillDailyTrend([{ date: '2027-01-01', searches: 1, noResults: 0 }], 3, new Date('2027-01-01T03:00:00Z'))
    expect(filled.map((point) => point.date)).toEqual(['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'])
  })

  it('keeps server dates outside the window and does not mutate the input', () => {
    const points = [{ date: '2026-10-01', searches: 3, noResults: 1 }]
    const filled = fillDailyTrend(points, 1, new Date('2026-11-06T01:00:00Z'))
    expect(filled.map((point) => point.date)).toEqual(['2026-10-01', '2026-11-05', '2026-11-06'])
    expect(points).toEqual([{ date: '2026-10-01', searches: 3, noResults: 1 }])
  })

  it('covers the whole 90-day window', () => {
    const filled = fillDailyTrend([], 90, new Date('2026-11-06T01:00:00Z'))
    expect(filled).toHaveLength(91)
    expect(filled[0].date).toBe('2026-08-08')
    expect(filled.at(-1)?.date).toBe('2026-11-06')
  })
})
