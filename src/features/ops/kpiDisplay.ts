import type { AnalyticsKpis, KpiOnboardingFunnel, KpiRatio } from '../../services/opsAnalyticsService'
import { SMALL_SAMPLE_MIN, type RateDisplay } from './opsHomeTasks'

/** The Intl locale for the UI language (Korean or English). */
export function localeOf(language: string): string {
  return language.startsWith('ko') ? 'ko-KR' : 'en-US'
}

/** A missing field from an older server shows "—" instead of breaking the whole home. */
export function formatNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR') : '—'
}

/** Rolling weeks in the north-star trend (analytics_admin_kpis_v1 product.wsal.weekly). */
export const WSAL_WEEKS = 8

/** A count from the server, or 0 when it is missing or not a sane count (an older or broken payload). */
function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/** n and N as counts, with n clamped to [0, N]; null when there is no base. */
function cleanRatio(ratio: KpiRatio | null | undefined): { numerator: number; denominator: number } | null {
  if (!ratio || typeof ratio !== 'object') return null
  const { numerator, denominator } = ratio
  if (typeof numerator !== 'number' || !Number.isFinite(numerator)) return null
  if (typeof denominator !== 'number' || !Number.isFinite(denominator)) return null
  const base = Math.trunc(denominator)
  if (base <= 0) return null
  return { numerator: Math.min(base, Math.max(0, Math.trunc(numerator))), denominator: base }
}

/** {n, N} → empty (N <= 0 or invalid) | ratio "n/N" (N < 10) | percent (rounded to 0.1). n is clamped to [0, N]. */
export function ratioDisplay(ratio: KpiRatio | null | undefined): RateDisplay {
  const clean = cleanRatio(ratio)
  if (!clean) return { kind: 'empty' }
  if (clean.denominator < SMALL_SAMPLE_MIN) return { kind: 'ratio', ...clean }
  return { kind: 'percent', percent: Math.round((clean.numerator / clean.denominator) * 1000) / 10, smallSample: false }
}

export type KpiDelta = { kind: 'up' | 'down' | 'same'; value: number }

/** Absolute difference; same when equal. */
export function countDelta(current: number, previous: number): KpiDelta {
  const difference = toCount(current) - toCount(previous)
  if (difference === 0) return { kind: 'same', value: 0 }
  return { kind: difference > 0 ? 'up' : 'down', value: Math.abs(difference) }
}

/**
 * The count change worth an arrow, or null. Below SMALL_SAMPLE_MIN in the previous period (zero
 * included) a change of a few reads as a trend it is not, so the screen shows only "직전 N".
 */
export function comparableCountDelta(current: number, previous: number): KpiDelta | null {
  return toCount(previous) >= SMALL_SAMPLE_MIN ? countDelta(current, previous) : null
}

/**
 * Percentage-point change; null unless both denominators >= SMALL_SAMPLE_MIN. Computed from the two
 * percents as shown (each rounded to 0.1), so "▲0.1%p (직전 4.2%)" never appears next to 4.2%.
 */
export function ratioPointsDelta(current: KpiRatio, previous: KpiRatio): KpiDelta | null {
  const now = cleanRatio(current)
  const before = cleanRatio(previous)
  if (!now || !before || now.denominator < SMALL_SAMPLE_MIN || before.denominator < SMALL_SAMPLE_MIN) return null
  const shownPercent = (ratio: { numerator: number; denominator: number }) => Math.round((ratio.numerator / ratio.denominator) * 1000)
  const tenthsOfPoint = shownPercent(now) - shownPercent(before)
  if (tenthsOfPoint === 0) return { kind: 'same', value: 0 }
  return { kind: tenthsOfPoint > 0 ? 'up' : 'down', value: Math.abs(tenthsOfPoint) / 10 }
}

export function sumFunnels(a: KpiOnboardingFunnel, b: KpiOnboardingFunnel): KpiOnboardingFunnel {
  return {
    shown: toCount(a?.shown) + toCount(b?.shown),
    stepCompleted: toCount(a?.stepCompleted) + toCount(b?.stepCompleted),
    allStepsCompleted: toCount(a?.allStepsCompleted) + toCount(b?.allStepsCompleted),
    firstValueReached: toCount(a?.firstValueReached) + toCount(b?.firstValueReached),
    skipped: toCount(a?.skipped) + toCount(b?.skipped),
  }
}

/** weekly labs, oldest first, always 8 numbers (missing → 0). */
export function wsalTrend(kpis: AnalyticsKpis): number[] {
  const weekly = Array.isArray(kpis.product?.wsal?.weekly) ? kpis.product.wsal.weekly : []
  const offset = weekly.length - WSAL_WEEKS
  return Array.from({ length: WSAL_WEEKS }, (_, index) => toCount(weekly[offset + index]?.labs))
}
