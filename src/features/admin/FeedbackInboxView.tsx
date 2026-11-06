import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Inbox, Loader2, Play, RefreshCw, RotateCcw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppSelect } from '../../components/AppSelect'
import { EmptyState } from '../../components/EmptyState'
import { useActionToast } from '../../components/admin/ActionToast'
import { listFeedbackInbox, updateFeedbackStatus } from '../../services/feedbackAdminService'
import type { FeedbackInboxItem, FeedbackSourceScreen, FeedbackStatus, FeedbackType } from '../../types/feedback'
import { OpsAccessNotice } from '../ops/OpsAccessNotice'
import { getOpsAccessProblem, type OpsAccessProblem } from '../ops/opsAccess'
import {
  DEFAULT_FEEDBACK_STATUS_FILTER,
  getFeedbackQuickActions,
  matchesFeedbackStatusFilter,
  type FeedbackQuickActionKind,
  type FeedbackStatusFilter,
} from './feedbackInboxActions'

type TypeFilter = 'all' | FeedbackType

/** The app's own tab labels for the screen a feedback was sent from (admin = the lab admin tab). */
const SOURCE_SCREEN_LABEL_KEYS: Record<FeedbackSourceScreen, string> = {
  search: 'tab_search',
  logs: 'tab_logs',
  cabinet: 'tab_cabinet',
  inventory: 'tab_inventory',
  admin: 'tab_audit',
}

function sourceScreenLabel(item: FeedbackInboxItem, t: (key: string) => string): string | null {
  const key = item.source_screen ? SOURCE_SCREEN_LABEL_KEYS[item.source_screen] : undefined
  return key ? t(key) : null
}

/** Operator roles each request needs (functions/api/admin/feedback/_shared.ts OPERATOR_ACTIONS). */
const LIST_ROLE = 'reader'
const STATUS_ROLE = 'approver'

interface ActionNotice {
  problem: OpsAccessProblem
  requiredRole?: string
  /** Re-runs the refused action. Without it, retry reloads the list. */
  retry?: () => void
}

/**
 * Sign-in and MFA hold for every call, so they replace the screen. A missing role or an overdue
 * monthly review of the approver role belongs to the status change: the list (reader) stays.
 */
function replacesScreen(problem: OpsAccessProblem): boolean {
  return problem.issue === 'signed_out' || problem.issue === 'mfa_required'
}

interface FeedbackInboxViewProps {
  /**
   * Gets the whole list after every good load and status change, with when the list was loaded,
   * so the console's badges and home follow what the operator does here without another call.
   */
  onItemsChange?: (items: FeedbackInboxItem[], loadedAt: number) => void
}

const QUICK_ACTION_STYLE: Record<FeedbackQuickActionKind, { labelKey: string; toastKey: string; Icon: LucideIcon; className: string }> = {
  start: {
    labelKey: 'ops_feedback_action_start',
    toastKey: 'ops_feedback_toast_in_progress',
    Icon: Play,
    className: 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
  },
  resolve: {
    labelKey: 'ops_feedback_action_resolve',
    toastKey: 'ops_feedback_toast_resolved',
    Icon: CheckCircle2,
    className: 'border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700',
  },
  reopen: {
    labelKey: 'ops_feedback_action_reopen',
    toastKey: 'ops_feedback_toast_reopened',
    Icon: RotateCcw,
    className: 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
  },
}

function getStatusBadgeClass(status: FeedbackStatus): string {
  if (status === 'resolved') {
    return 'bg-emerald-100 text-emerald-700'
  }

  if (status === 'in_progress') {
    return 'bg-amber-100 text-amber-700'
  }

  return 'bg-blue-100 text-blue-700'
}

/** Operator console only (/ops), which is light only: no dark: classes here. */
export const FeedbackInboxView: React.FC<FeedbackInboxViewProps> = ({ onItemsChange }) => {
  const { t, i18n } = useTranslation()
  const { showToast, toastElement } = useActionToast({ appearance: 'light' })
  const [items, setItems] = useState<FeedbackInboxItem[]>([])
  /** The list after the latest change, ahead of the re-render, so changes that finish together build on each other. */
  const itemsRef = useRef<FeedbackInboxItem[]>([])
  const loadedAtRef = useRef(0)
  /** Finished status changes so far, and the count at each item's latest one. */
  const changeCountRef = useRef(0)
  const changedAtRef = useRef(new Map<string, number>())
  const onItemsChangeRef = useRef(onItemsChange)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [screenProblem, setScreenProblem] = useState<OpsAccessProblem | null>(null)
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null)
  const [statusFilter, setStatusFilter] = useState<FeedbackStatusFilter>(DEFAULT_FEEDBACK_STATUS_FILTER)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [keyword, setKeyword] = useState('')
  /** Status each in-flight request is moving to, keyed by feedback id, so rows update independently. */
  const [updatingById, setUpdatingById] = useState<Record<string, FeedbackStatus>>({})
  const hasLoadedRef = useRef(false)

  const deferredKeyword = useDeferredValue(keyword)
  const locale = i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US'

  useEffect(() => {
    onItemsChangeRef.current = onItemsChange
  }, [onItemsChange])

  const commitItems = useCallback((next: FeedbackInboxItem[], share: boolean) => {
    itemsRef.current = next
    setItems(next)
    // Also after the screen is gone: a change that finishes later must still reach the badges.
    if (share) onItemsChangeRef.current?.(next, loadedAtRef.current)
  }, [])

  const loadItems = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') {
      setIsInitialLoading(true)
    } else {
      setIsRefreshing(true)
    }

    setError(null)
    const changesBefore = changeCountRef.current

    try {
      const listed = await listFeedbackInbox()
      // A status change that finished while the list was on its way is newer than the list's copy of that item.
      const current = new Map(itemsRef.current.map((item) => [item.id, item]))
      const nextItems = changeCountRef.current === changesBefore
        ? listed
        : listed.map((item) => ((changedAtRef.current.get(item.id) ?? 0) > changesBefore ? current.get(item.id) ?? item : item))
      loadedAtRef.current = Date.now()
      commitItems(nextItems, true)
      setScreenProblem(null)
      setActionNotice(null)
      hasLoadedRef.current = true
    } catch (loadError) {
      const problem = getOpsAccessProblem(loadError)
      if (problem?.issue === 'rate_limited' && hasLoadedRef.current) {
        // Keep the list the operator is working on; only this refresh was refused.
        // A full-screen notice that is already showing switches to the wait message.
        setScreenProblem((current) => (current ? problem : current))
        setActionNotice({ problem })
        return
      }
      if (problem) {
        setScreenProblem(problem)
        commitItems([], false)
        return
      }

      setScreenProblem(null)
      setError(t('cmp_feedback_admin_load_error', '개선 제안 목록을 불러오지 못했습니다.'))
    } finally {
      if (mode === 'initial') {
        setIsInitialLoading(false)
      } else {
        setIsRefreshing(false)
      }
    }
  }, [commitItems, t])

  useEffect(() => {
    void loadItems('initial')
  }, [loadItems])

  const filteredItems = useMemo(() => {
    const normalizedKeyword = deferredKeyword.trim().toLowerCase()

    return items.filter((item) => {
      if (!matchesFeedbackStatusFilter(item.status, statusFilter)) {
        return false
      }

      if (typeFilter !== 'all' && item.type !== typeFilter) {
        return false
      }

      if (!normalizedKeyword) {
        return true
      }

      const searchable = [
        item.message,
        item.contact || '',
        item.user_email || '',
        item.user_id || '',
        item.user_agent || '',
        item.type,
        item.status,
        item.lab_name || '',
        item.source_screen || '',
        sourceScreenLabel(item, t) || '',
      ].join(' ').toLowerCase()

      return searchable.includes(normalizedKeyword)
    })
  }, [deferredKeyword, items, statusFilter, t, typeFilter])

  const summary = useMemo(() => ({
    total: items.length,
    newCount: items.filter((item) => item.status === 'new').length,
    inProgressCount: items.filter((item) => item.status === 'in_progress').length,
    resolvedCount: items.filter((item) => item.status === 'resolved').length,
  }), [items])

  const statusOptions = useMemo(() => ([
    { value: 'open', label: t('ops_feedback_filter_open') },
    { value: 'all', label: t('cmp_feedback_admin_filter_all_status', '전체 상태') },
    { value: 'new', label: t('cmp_feedback_admin_status_new', '신규') },
    { value: 'in_progress', label: t('cmp_feedback_admin_status_in_progress', '진행 중') },
    { value: 'resolved', label: t('cmp_feedback_admin_status_resolved', '해결됨') },
  ]), [t])

  const typeOptions = useMemo(() => ([
    { value: 'all', label: t('cmp_feedback_admin_filter_all_types', '전체 유형') },
    { value: 'bug', label: t('feedback_type_bug') },
    { value: 'improvement', label: t('feedback_type_improvement') },
    { value: 'general', label: t('feedback_type_general') },
  ]), [t])

  const formatDateTime = useCallback((value: string | null) => {
    if (!value) return null
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  }, [locale])

  function reportActionError(actionError: unknown, retry: () => void) {
    const problem = getOpsAccessProblem(actionError)
    if (!problem) {
      showToast(t('cmp_feedback_admin_update_error', '상태를 변경하지 못했습니다.'), { tone: 'error' })
      return
    }
    if (replacesScreen(problem)) {
      setScreenProblem(problem)
      return
    }
    setActionNotice({
      problem,
      requiredRole: problem.issue === 'role_required' || problem.issue === 'review_required' ? STATUS_ROLE : undefined,
      retry,
    })
  }

  async function changeStatus(feedbackId: string, nextStatus: FeedbackStatus, retry: () => void): Promise<boolean> {
    setUpdatingById((prev) => ({ ...prev, [feedbackId]: nextStatus }))

    try {
      const updatedItem = await updateFeedbackStatus(feedbackId, nextStatus)
      changeCountRef.current += 1
      changedAtRef.current.set(feedbackId, changeCountRef.current)
      // Merge: the status API returns the table row, which has no list-only lab_name.
      commitItems(itemsRef.current.map((item) => item.id === feedbackId ? { ...item, ...updatedItem } : item), true)
      setActionNotice(null)
      return true
    } catch (updateError) {
      reportActionError(updateError, retry)
      return false
    } finally {
      setUpdatingById((prev) => {
        const next = { ...prev }
        delete next[feedbackId]
        return next
      })
    }
  }

  async function undoStatusChange(feedbackId: string, previousStatus: FeedbackStatus) {
    const restored = await changeStatus(feedbackId, previousStatus, () => void undoStatusChange(feedbackId, previousStatus))
    if (restored) showToast(t('ops_feedback_toast_undone'), { tone: 'info' })
  }

  async function handleQuickAction(item: FeedbackInboxItem, kind: FeedbackQuickActionKind, nextStatus: FeedbackStatus) {
    const previousStatus = item.status
    const changed = await changeStatus(item.id, nextStatus, () => void handleQuickAction(item, kind, nextStatus))
    if (!changed) return

    showToast(t(QUICK_ACTION_STYLE[kind].toastKey), {
      tone: 'success',
      onUndo: () => undoStatusChange(item.id, previousStatus),
    })
  }

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    )
  }

  if (screenProblem) {
    return (
      <OpsAccessNotice
        problem={screenProblem}
        requiredRole={LIST_ROLE}
        onRetry={() => void loadItems('initial')}
      />
    )
  }

  const emptySubtitle = items.length === 0
    ? t('cmp_feedback_admin_empty', '아직 들어온 개선 제안이 없습니다.')
    : statusFilter === 'open' && typeFilter === 'all' && !keyword.trim()
      ? t('ops_feedback_empty_open')
      : t('cmp_feedback_admin_empty_filtered', '현재 필터에 맞는 제안이 없습니다.')

  return (
    <div className="p-5 flex flex-col gap-4" style={{ paddingBottom: '72px' }}>
      {toastElement}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-medium text-slate-900">
            <Inbox className="w-6 h-6 text-blue-500" />
            {t('cmp_feedback_admin_title', '개선 제안 Inbox')}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {t('cmp_feedback_admin_subtitle', '앱 전체에서 들어온 제안을 최신순으로 확인하고 상태를 관리합니다.')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadItems('refresh')}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRefreshing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {t('cmp_feedback_admin_refresh', '새로고침')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-2xs text-slate-500">{t('cmp_feedback_admin_summary_total', '전체')}</div>
          <div className="text-lg font-medium text-slate-900">{summary.total}</div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
          <div className="text-2xs text-blue-700">{t('cmp_feedback_admin_status_new', '신규')}</div>
          <div className="text-lg font-medium text-blue-700">{summary.newCount}</div>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
          <div className="text-2xs text-amber-700">{t('cmp_feedback_admin_status_in_progress', '진행 중')}</div>
          <div className="text-lg font-medium text-amber-700">{summary.inProgressCount}</div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
          <div className="text-2xs text-emerald-700">{t('cmp_feedback_admin_status_resolved', '해결됨')}</div>
          <div className="text-lg font-medium text-emerald-700">{summary.resolvedCount}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <AppSelect
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as FeedbackStatusFilter)}
            options={statusOptions}
            buttonClassName="bg-white"
          />
          <AppSelect
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as TypeFilter)}
            options={typeOptions}
            buttonClassName="bg-white"
          />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('cmp_feedback_admin_search_placeholder', '내용, 연락처, 이메일로 검색')}
            aria-label={t('cmp_feedback_admin_search_placeholder', '내용, 연락처, 이메일로 검색')}
            className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {actionNotice && (
        <OpsAccessNotice
          compact
          problem={actionNotice.problem}
          requiredRole={actionNotice.requiredRole}
          onRetry={actionNotice.retry ?? (() => void loadItems('refresh'))}
        />
      )}

      <div className="space-y-3">
        {filteredItems.map((item) => {
          const updatingStatus = updatingById[item.id]
          const createdAt = formatDateTime(item.created_at)
          const resolvedAt = formatDateTime(item.resolved_at)
          const reporter = item.user_email || item.contact || t('cmp_feedback_admin_unknown_reporter', '알 수 없음')
          const screenLabel = sourceScreenLabel(item, t)

          return (
            <article
              key={item.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-normal text-slate-700">
                      {item.type === 'bug'
                        ? t('feedback_type_bug')
                        : item.type === 'improvement'
                          ? t('feedback_type_improvement')
                          : t('feedback_type_general')}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-normal ${getStatusBadgeClass(item.status)}`}>
                      {item.status === 'new'
                        ? t('cmp_feedback_admin_status_new', '신규')
                        : item.status === 'in_progress'
                          ? t('cmp_feedback_admin_status_in_progress', '진행 중')
                          : t('cmp_feedback_admin_status_resolved', '해결됨')}
                    </span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
                    {item.message}
                  </p>
                </div>

                <div className="shrink-0 text-right text-xs text-slate-500">
                  {createdAt}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 text-xs text-slate-600">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-normal text-slate-500">
                    {t('cmp_feedback_admin_reporter', '보낸 사람')}
                  </span>
                  <span className="break-all">{reporter}</span>
                </div>

                {screenLabel && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-normal text-slate-500">
                      {t('ops_feedback_source_screen')}
                    </span>
                    <span>{screenLabel}</span>
                  </div>
                )}

                {item.lab_name && (
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-normal text-slate-500">
                      {t('ops_feedback_lab')}
                    </span>
                    <span className="min-w-0 break-words">{item.lab_name}</span>
                  </div>
                )}

                {item.contact && item.user_email !== item.contact && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-normal text-slate-500">
                      {t('feedback_contact_label')}
                    </span>
                    <span className="break-all">{item.contact}</span>
                  </div>
                )}

                {resolvedAt && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-normal text-slate-500">
                      {t('cmp_feedback_admin_resolved_at', '처리 시각')}
                    </span>
                    <span>{resolvedAt}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {getFeedbackQuickActions(item.status).map(({ kind, status }) => {
                  const { labelKey, Icon, className } = QUICK_ACTION_STYLE[kind]

                  return (
                    <button
                      key={kind}
                      type="button"
                      disabled={Boolean(updatingStatus)}
                      onClick={() => void handleQuickAction(item, kind, status)}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
                    >
                      {updatingStatus === status ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Icon className="w-4 h-4" />
                      )}
                      {t(labelKey)}
                    </button>
                  )
                })}
              </div>
            </article>
          )
        })}

        {filteredItems.length === 0 && (
          <EmptyState variant="audit" subtitle={emptySubtitle} />
        )}
      </div>
    </div>
  )
}

export default FeedbackInboxView
