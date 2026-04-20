import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { CheckCheck, Inbox, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppSelect } from '../../components/AppSelect'
import { EmptyState } from '../../components/EmptyState'
import { FeedbackAdminApiError, listFeedbackInbox, updateFeedbackStatus } from '../../services/feedbackAdminService'
import type { FeedbackInboxItem, FeedbackStatus, FeedbackType } from '../../types/feedback'

type StatusFilter = 'all' | FeedbackStatus
type TypeFilter = 'all' | FeedbackType

const STATUS_ORDER: FeedbackStatus[] = ['new', 'in_progress', 'resolved']

function getStatusBadgeClass(status: FeedbackStatus): string {
  if (status === 'resolved') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  }

  if (status === 'in_progress') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  }

  return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
}

function getActionButtonClass(isActive: boolean): string {
  return isActive
    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
    : 'bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white'
}

export const FeedbackInboxView: React.FC = () => {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<FeedbackInboxItem[]>([])
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAccessDenied, setIsAccessDenied] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [updatingState, setUpdatingState] = useState<{ id: string; status: FeedbackStatus } | null>(null)

  const deferredKeyword = useDeferredValue(keyword)
  const locale = i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US'

  const loadItems = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') {
      setIsInitialLoading(true)
    } else {
      setIsRefreshing(true)
    }

    setError(null)

    try {
      const nextItems = await listFeedbackInbox()
      setItems(nextItems)
      setIsAccessDenied(false)
    } catch (loadError) {
      if (loadError instanceof FeedbackAdminApiError && loadError.status === 403) {
        setIsAccessDenied(true)
        setItems([])
        return
      }

      setIsAccessDenied(false)
      setError(
        loadError instanceof Error
          ? loadError.message
          : t('feedback_admin_load_error', '개선 제안 목록을 불러오지 못했습니다.'),
      )
    } finally {
      if (mode === 'initial') {
        setIsInitialLoading(false)
      } else {
        setIsRefreshing(false)
      }
    }
  }, [t])

  useEffect(() => {
    void loadItems('initial')
  }, [loadItems])

  const filteredItems = useMemo(() => {
    const normalizedKeyword = deferredKeyword.trim().toLowerCase()

    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) {
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
      ].join(' ').toLowerCase()

      return searchable.includes(normalizedKeyword)
    })
  }, [deferredKeyword, items, statusFilter, typeFilter])

  const summary = useMemo(() => ({
    total: items.length,
    newCount: items.filter((item) => item.status === 'new').length,
    inProgressCount: items.filter((item) => item.status === 'in_progress').length,
    resolvedCount: items.filter((item) => item.status === 'resolved').length,
  }), [items])

  const statusOptions = useMemo(() => ([
    { value: 'all', label: t('feedback_admin_filter_all_status', '전체 상태') },
    { value: 'new', label: t('feedback_admin_status_new', '신규') },
    { value: 'in_progress', label: t('feedback_admin_status_in_progress', '진행 중') },
    { value: 'resolved', label: t('feedback_admin_status_resolved', '해결됨') },
  ]), [t])

  const typeOptions = useMemo(() => ([
    { value: 'all', label: t('feedback_admin_filter_all_types', '전체 유형') },
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

  const handleStatusChange = useCallback(async (feedbackId: string, nextStatus: FeedbackStatus) => {
    setUpdatingState({ id: feedbackId, status: nextStatus })
    setError(null)

    try {
      const updatedItem = await updateFeedbackStatus(feedbackId, nextStatus)
      setItems((prev) => prev.map((item) => item.id === feedbackId ? updatedItem : item))
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : t('feedback_admin_update_error', '상태를 변경하지 못했습니다.'),
      )
    } finally {
      setUpdatingState(null)
    }
  }, [t])

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    )
  }

  if (isAccessDenied) {
    return (
      <div className="p-5">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-8 text-center dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/80 text-amber-600 shadow-sm dark:bg-slate-900/80 dark:text-amber-300">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {t('feedback_admin_access_denied_title', '개발자 전용 페이지')}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {t(
              'feedback_admin_access_denied_desc',
              '이 페이지는 allowlist에 등록된 개발자 계정만 접근할 수 있습니다.',
            )}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-4" style={{ paddingBottom: '72px' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
            <Inbox className="w-6 h-6 text-blue-500" />
            {t('feedback_admin_title', '개선 제안 Inbox')}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('feedback_admin_subtitle', '앱 전체에서 들어온 제안을 최신순으로 확인하고 상태를 관리합니다.')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadItems('refresh')}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-700"
        >
          {isRefreshing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {t('feedback_admin_refresh', '새로고침')}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">{t('feedback_admin_summary_total', '전체')}</div>
          <div className="text-lg font-bold text-slate-900 dark:text-white">{summary.total}</div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-950/20">
          <div className="text-[11px] text-blue-700 dark:text-blue-300">{t('feedback_admin_status_new', '신규')}</div>
          <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{summary.newCount}</div>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="text-[11px] text-amber-700 dark:text-amber-300">{t('feedback_admin_status_in_progress', '진행 중')}</div>
          <div className="text-lg font-bold text-amber-700 dark:text-amber-300">{summary.inProgressCount}</div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="text-[11px] text-emerald-700 dark:text-emerald-300">{t('feedback_admin_status_resolved', '해결됨')}</div>
          <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{summary.resolvedCount}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <AppSelect
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            options={statusOptions}
            buttonClassName="bg-white dark:bg-slate-900"
          />
          <AppSelect
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as TypeFilter)}
            options={typeOptions}
            buttonClassName="bg-white dark:bg-slate-900"
          />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('feedback_admin_search_placeholder', '내용, 연락처, 이메일로 검색')}
            className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {filteredItems.map((item) => {
          const isUpdating = updatingState?.id === item.id
          const createdAt = formatDateTime(item.created_at)
          const resolvedAt = formatDateTime(item.resolved_at)
          const reporter = item.user_email || item.contact || t('feedback_admin_unknown_reporter', '알 수 없음')

          return (
            <article
              key={item.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {item.type === 'bug'
                        ? t('feedback_type_bug')
                        : item.type === 'improvement'
                          ? t('feedback_type_improvement')
                          : t('feedback_type_general')}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClass(item.status)}`}>
                      {item.status === 'new'
                        ? t('feedback_admin_status_new', '신규')
                        : item.status === 'in_progress'
                          ? t('feedback_admin_status_in_progress', '진행 중')
                          : t('feedback_admin_status_resolved', '해결됨')}
                    </span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-100">
                    {item.message}
                  </p>
                </div>

                <div className="shrink-0 text-right text-xs text-slate-500 dark:text-slate-400">
                  {createdAt}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 text-xs text-slate-600 dark:text-slate-300">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">
                    {t('feedback_admin_reporter', '보낸 사람')}
                  </span>
                  <span className="break-all">{reporter}</span>
                </div>

                {item.contact && item.user_email !== item.contact && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-500 dark:text-slate-400">
                      {t('feedback_contact_label')}
                    </span>
                    <span className="break-all">{item.contact}</span>
                  </div>
                )}

                {resolvedAt && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-500 dark:text-slate-400">
                      {t('feedback_admin_resolved_at', '처리 시각')}
                    </span>
                    <span>{resolvedAt}</span>
                    {item.resolved_by && (
                      <span className="break-all text-slate-500 dark:text-slate-400">
                        ({t('feedback_admin_resolved_by', '처리자')}: {item.resolved_by})
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {STATUS_ORDER.map((status) => {
                  const isActive = item.status === status

                  return (
                    <button
                      key={status}
                      type="button"
                      disabled={isUpdating || isActive}
                      onClick={() => void handleStatusChange(item.id, status)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${getActionButtonClass(isActive)}`}
                    >
                      {isUpdating && updatingState?.status === status ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isActive ? (
                        <CheckCheck className="w-3.5 h-3.5" />
                      ) : null}
                      {status === 'new'
                        ? t('feedback_admin_status_new', '신규')
                        : status === 'in_progress'
                          ? t('feedback_admin_status_in_progress', '진행 중')
                          : t('feedback_admin_status_resolved', '해결됨')}
                    </button>
                  )
                })}
              </div>
            </article>
          )
        })}

        {filteredItems.length === 0 && (
          <EmptyState
            variant="audit"
            subtitle={items.length === 0
              ? t('feedback_admin_empty', '아직 들어온 개선 제안이 없습니다.')
              : t('feedback_admin_empty_filtered', '현재 필터에 맞는 제안이 없습니다.')}
          />
        )}
      </div>
    </div>
  )
}

export default FeedbackInboxView
