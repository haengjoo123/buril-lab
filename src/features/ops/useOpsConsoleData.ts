import { useCallback, useEffect, useRef, useState } from 'react'
import { listFeedbackInbox } from '../../services/feedbackAdminService'
import { listSafetyCenterApprovals, type SafetyCenterApprovalItem } from '../../services/opsAdminService'
import { loadAnalyticsSummary } from '../../services/opsAnalyticsService'
import type { FeedbackInboxItem } from '../../types/feedback'
import { getOpsAccessProblem, type OpsAccessProblem } from './opsAccess'

export const OPS_HOME_PERIODS = [7, 30] as const
export type OpsHomePeriod = (typeof OPS_HOME_PERIODS)[number]
export const DEFAULT_OPS_HOME_PERIOD: OpsHomePeriod = 7

/**
 * Coming back to the home reloads data older than this. Operator APIs allow 20 calls a minute
 * (functions/api/_middleware.ts), and one full reload costs three.
 */
export const OPS_DATA_STALE_MS = 60_000

export type OpsConsoleSection = 'overview' | 'analytics' | 'centers' | 'feedback'

export type OpsSourceId = 'centers' | 'feedback' | 'summary'
export const OPS_SOURCES: readonly OpsSourceId[] = ['centers', 'feedback', 'summary']
/** What the navigation badges need on every section. The summary is only shown on the home. */
const BADGE_SOURCES: readonly OpsSourceId[] = ['centers', 'feedback']

/**
 * Sections that load and change the list behind a source themselves (approve a center, resolve a
 * suggestion). They hand every good load and change to the console (`replaceCenters`,
 * `replaceFeedback`), so the home and the badges never keep showing work that was just done, and
 * the console does not load that list again while the section is open.
 */
const SECTION_SOURCE: Partial<Record<OpsConsoleSection, OpsSourceId>> = {
  centers: 'centers',
  feedback: 'feedback',
}

export type OpsSummaryPayload = Awaited<ReturnType<typeof loadAnalyticsSummary>>

/** The summary with the period it was loaded for, so a period switch never shows the old numbers as new. */
export interface OpsSummaryData {
  period: OpsHomePeriod
  payload: OpsSummaryPayload
}

export interface OpsSourceState<T> {
  /** Last good response. Kept when a later refresh fails. */
  data: T | null
  /** When `data` arrived. */
  loadedAt: number | null
  /** Why the last request was refused, when it was an access problem (MFA, role, rate limit). */
  problem: OpsAccessProblem | null
  /** The last request failed (with or without a `problem`). */
  failed: boolean
  loading: boolean
}

const EMPTY_SOURCE: OpsSourceState<never> = { data: null, loadedAt: null, problem: null, failed: false, loading: false }

/** One operator call with its own loading and error state. A newer request always wins over an older one. */
function useOpsSource<T>() {
  const [state, setState] = useState<OpsSourceState<T>>(EMPTY_SOURCE)
  const sequenceRef = useRef(0)
  const statusRef = useRef<{ inFlight: boolean; attemptedAt: number | null }>({ inFlight: false, attemptedAt: null })

  const run = useCallback(async (fetcher: () => Promise<T>) => {
    sequenceRef.current += 1
    const sequence = sequenceRef.current
    statusRef.current = { ...statusRef.current, inFlight: true }
    setState((current) => ({ ...current, loading: true }))
    try {
      const data = await fetcher()
      if (sequence !== sequenceRef.current) return
      setState({ data, loadedAt: Date.now(), problem: null, failed: false, loading: false })
    } catch (error) {
      if (sequence !== sequenceRef.current) return
      setState((current) => ({ ...current, problem: getOpsAccessProblem(error), failed: true, loading: false }))
    } finally {
      if (sequence === sequenceRef.current) statusRef.current = { inFlight: false, attemptedAt: Date.now() }
    }
  }, [])

  /**
   * Takes a list a section already loaded (and maybe changed since), without a call. It counts as
   * an attempt at `loadedAt` and wins over any request still in flight, which can only be older.
   */
  const replace = useCallback((data: T, loadedAt: number) => {
    sequenceRef.current += 1
    statusRef.current = { inFlight: false, attemptedAt: loadedAt }
    setState({ data, loadedAt, problem: null, failed: false, loading: false })
  }, [])

  const isInFlight = useCallback(() => statusRef.current.inFlight, [])

  /** Never tried, or the last finished attempt is older than OPS_DATA_STALE_MS. */
  const isStale = useCallback((now: number) => {
    const { inFlight, attemptedAt } = statusRef.current
    return !inFlight && (attemptedAt === null || now - attemptedAt > OPS_DATA_STALE_MS)
  }, [])

  /** Not loaded and not loading yet. */
  const isUntried = useCallback(() => !statusRef.current.inFlight && statusRef.current.attemptedAt === null, [])

  return { state, run, replace, isInFlight, isStale, isUntried }
}

export interface OpsConsoleDataOptions {
  /**
   * The analytics review tab is open, where candidates are decided. The home's "검토할 개선 후보"
   * count comes from the summary, so it is reloaded on the next return to the home.
   */
  reviewsOpen?: boolean
}

/**
 * Data the operator console home and its navigation badges share: the safety-center list, the
 * feedback list and the analytics summary, all `reader` calls. One reload makes at most these
 * three calls, in parallel, and each source keeps its own result so one failure stays in its card.
 */
export function useOpsConsoleData(section: OpsConsoleSection, { reviewsOpen = false }: OpsConsoleDataOptions = {}) {
  const [days, setDaysState] = useState<OpsHomePeriod>(DEFAULT_OPS_HOME_PERIOD)
  const daysRef = useRef<OpsHomePeriod>(DEFAULT_OPS_HOME_PERIOD)
  const previousSectionRef = useRef<OpsConsoleSection | null>(null)
  /** Review candidates may have been decided since the summary was loaded. */
  const reviewsChangedRef = useRef(false)
  const {
    state: centers, run: runCenters, replace: replaceCenters,
    isInFlight: centersInFlight, isStale: centersStale, isUntried: centersUntried,
  } = useOpsSource<SafetyCenterApprovalItem[]>()
  const {
    state: feedback, run: runFeedback, replace: replaceFeedback,
    isInFlight: feedbackInFlight, isStale: feedbackStale, isUntried: feedbackUntried,
  } = useOpsSource<FeedbackInboxItem[]>()
  const {
    state: summary, run: runSummary, isInFlight: summaryInFlight, isStale: summaryStale, isUntried: summaryUntried,
  } = useOpsSource<OpsSummaryData>()

  /**
   * Reloads the given sources. A source already loading is skipped unless `force` (a new period,
   * or review counts the operator may just have changed).
   */
  const reload = useCallback(async (
    sources: readonly OpsSourceId[] = OPS_SOURCES,
    options: { force?: boolean } = {},
  ) => {
    const tasks: Array<Promise<void>> = []
    if (sources.includes('centers') && (options.force || !centersInFlight())) {
      tasks.push(runCenters(() => listSafetyCenterApprovals()))
    }
    if (sources.includes('feedback') && (options.force || !feedbackInFlight())) {
      tasks.push(runFeedback(() => listFeedbackInbox()))
    }
    if (sources.includes('summary') && (options.force || !summaryInFlight())) {
      const period = daysRef.current
      // The home asks for the KPIs on the same call, so one reload stays at most three calls.
      tasks.push(runSummary(async () => ({ period, payload: await loadAnalyticsSummary(period, { includeKpis: true }) })))
    }
    await Promise.allSettled(tasks)
  }, [centersInFlight, feedbackInFlight, runCenters, runFeedback, runSummary, summaryInFlight])

  const isSourceStale = useCallback((source: OpsSourceId, now: number) => {
    if (source === 'centers') return centersStale(now)
    if (source === 'feedback') return feedbackStale(now)
    return summaryStale(now)
  }, [centersStale, feedbackStale, summaryStale])

  const isSourceUntried = useCallback((source: OpsSourceId) => {
    if (source === 'centers') return centersUntried()
    if (source === 'feedback') return feedbackUntried()
    return summaryUntried()
  }, [centersUntried, feedbackUntried, summaryUntried])

  useEffect(() => {
    if (reviewsOpen) reviewsChangedRef.current = true
  }, [reviewsOpen])

  // Runs once per section change:
  // - the home reloads what is older than OPS_DATA_STALE_MS, and the summary after the review tab;
  // - other sections only load badge counts that were never loaded;
  // - the centers and feedback screens load their own list and hand it over (no second call).
  useEffect(() => {
    const previous = previousSectionRef.current
    previousSectionRef.current = section
    if (previous === section) return
    const now = Date.now()
    const own = SECTION_SOURCE[section]
    const reviewsChanged = section === 'overview' && reviewsChangedRef.current
    if (reviewsChanged) reviewsChangedRef.current = false
    const due = (section === 'overview' ? OPS_SOURCES : BADGE_SOURCES).filter((source) => (
      source !== own
      && !(reviewsChanged && source === 'summary')
      && (section === 'overview' ? isSourceStale(source, now) : isSourceUntried(source))
    ))
    // Forced so a summary that left before a decision cannot stand in for the new one.
    if (reviewsChanged) void reload(['summary'], { force: true })
    if (due.length > 0) void reload(due)
  }, [section, isSourceStale, isSourceUntried, reload])

  const setDays = useCallback((next: OpsHomePeriod) => {
    if (next === daysRef.current) return
    daysRef.current = next
    setDaysState(next)
    void reload(['summary'], { force: true })
  }, [reload])

  // "갱신 HH:mm" is the oldest of the shown sources, so every number is at least that fresh.
  const loadedTimes = [centers.loadedAt, feedback.loadedAt, summary.loadedAt].filter((value): value is number => value !== null)
  const loadedAt = loadedTimes.length > 0 ? Math.min(...loadedTimes) : null

  return {
    days,
    setDays,
    reload,
    replaceCenters,
    replaceFeedback,
    centers,
    feedback,
    summary,
    loadedAt,
    isLoading: centers.loading || feedback.loading || summary.loading,
  }
}

export type OpsConsoleData = ReturnType<typeof useOpsConsoleData>
