// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { AnalyticsKpis } from '../../services/opsAnalyticsService'
import {
  comparableCountDelta,
  countDelta,
  ratioDisplay,
  ratioPointsDelta,
  sumFunnels,
  wsalTrend,
} from './kpiDisplay'
import { formatRate } from './opsHomeTasks'

function withWeekly(weekly: unknown): AnalyticsKpis {
  return { product: { wsal: { current: 0, previous: 0, totalLabs: 0, weekly } } } as unknown as AnalyticsKpis
}

describe('KPI ratios', () => {
  it('shows n/N under 10 cases and a percent from 10', () => {
    expect(ratioDisplay({ numerator: 0, denominator: 0 })).toEqual({ kind: 'empty' })
    expect(ratioDisplay({ numerator: 3, denominator: 5 })).toEqual({ kind: 'ratio', numerator: 3, denominator: 5 })
    expect(ratioDisplay({ numerator: 12, denominator: 40 })).toEqual({ kind: 'percent', percent: 30, smallSample: false })
    expect(formatRate(ratioDisplay({ numerator: 1, denominator: 3 }))).toBe('1/3')
    expect(formatRate(ratioDisplay({ numerator: 1, denominator: 30 }))).toBe('3.3%')
  })

  it('clamps n to [0, N] and treats broken values as empty', () => {
    expect(ratioDisplay({ numerator: 7, denominator: 5 })).toEqual({ kind: 'ratio', numerator: 5, denominator: 5 })
    expect(ratioDisplay({ numerator: -2, denominator: 5 })).toEqual({ kind: 'ratio', numerator: 0, denominator: 5 })
    expect(ratioDisplay({ numerator: Number.NaN, denominator: 5 })).toEqual({ kind: 'empty' })
    expect(ratioDisplay({ numerator: 1, denominator: Number.NaN })).toEqual({ kind: 'empty' })
    expect(ratioDisplay(null)).toEqual({ kind: 'empty' })
    expect(ratioDisplay(undefined)).toEqual({ kind: 'empty' })
  })
})

describe('KPI changes', () => {
  it('counts the absolute change', () => {
    expect(countDelta(4, 1)).toEqual({ kind: 'up', value: 3 })
    expect(countDelta(1, 4)).toEqual({ kind: 'down', value: 3 })
    expect(countDelta(2, 2)).toEqual({ kind: 'same', value: 0 })
  })

  it('gives a count change an arrow only from 10 in the previous period', () => {
    expect(comparableCountDelta(4, 0)).toBeNull()
    expect(comparableCountDelta(4, 1)).toBeNull()
    expect(comparableCountDelta(30, 9)).toBeNull()
    expect(comparableCountDelta(13, 10)).toEqual({ kind: 'up', value: 3 })
    expect(comparableCountDelta(3, 20)).toEqual({ kind: 'down', value: 17 })
  })

  it('compares rates in points only when both periods have 10 or more cases', () => {
    expect(ratioPointsDelta({ numerator: 30, denominator: 100 }, { numerator: 20, denominator: 100 })).toEqual({ kind: 'up', value: 10 })
    expect(ratioPointsDelta({ numerator: 10, denominator: 40 }, { numerator: 30, denominator: 60 })).toEqual({ kind: 'down', value: 25 })
    expect(ratioPointsDelta({ numerator: 1, denominator: 30 }, { numerator: 1, denominator: 30 })).toEqual({ kind: 'same', value: 0 })
    expect(ratioPointsDelta({ numerator: 3, denominator: 5 }, { numerator: 1, denominator: 5 })).toBeNull()
    expect(ratioPointsDelta({ numerator: 30, denominator: 100 }, { numerator: 0, denominator: 0 })).toBeNull()
    // 4.249% and 4.151% both show as 4.2%, so no arrow; the change follows the shown percents.
    expect(ratioPointsDelta({ numerator: 4249, denominator: 100000 }, { numerator: 4151, denominator: 100000 })).toEqual({ kind: 'same', value: 0 })
    expect(ratioPointsDelta({ numerator: 4251, denominator: 100000 }, { numerator: 4149, denominator: 100000 })).toEqual({ kind: 'up', value: 0.2 })
  })
})

describe('KPI helpers', () => {
  it('adds the web and app onboarding funnels', () => {
    expect(sumFunnels(
      { shown: 1, stepCompleted: 1, allStepsCompleted: 0, firstValueReached: 1, skipped: 0 },
      { shown: 1, stepCompleted: 0, allStepsCompleted: 0, firstValueReached: 0, skipped: 1 },
    )).toEqual({ shown: 2, stepCompleted: 1, allStepsCompleted: 0, firstValueReached: 1, skipped: 1 })
  })

  it('reads the 8 weekly lab counts oldest first, filling gaps with 0', () => {
    const weekly = [0, 0, 0, 0, 1, 1, 1, 4].map((labs, index) => ({ start: `w${index}`, end: `w${index + 1}`, labs }))
    expect(wsalTrend(withWeekly(weekly))).toEqual([0, 0, 0, 0, 1, 1, 1, 4])
    expect(wsalTrend(withWeekly(weekly.slice(5)))).toEqual([0, 0, 0, 0, 0, 1, 1, 4])
    expect(wsalTrend(withWeekly(null))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })
})
