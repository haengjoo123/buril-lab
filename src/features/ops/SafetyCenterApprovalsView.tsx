import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import { Building2, CheckCircle2, Clock, ExternalLink, FileText, Loader2, RefreshCw, Search, ShieldAlert, XCircle } from 'lucide-react'
import { AppSelect } from '../../components/AppSelect'
import {
  getSafetyCenterVerificationDocumentUrl,
  listSafetyCenterApprovals,
  OpsAdminApiError,
  updateSafetyCenterApprovalStatus,
  type SafetyCenterApprovalItem,
} from '../../services/opsAdminService'
import type { SafetyCenterStatus } from '../safety-center/types'

type StatusFilter = 'all' | SafetyCenterStatus

const STATUS_FILTER_VALUES: StatusFilter[] = ['all', 'pending', 'approved', 'rejected']

function statusLabel(status: SafetyCenterStatus, t: (key: string) => string): string {
  if (status === 'approved') return t('ops_centers_status_approved')
  if (status === 'rejected') return t('ops_centers_status_rejected')
  return t('ops_centers_status_pending')
}

function statusTone(status: SafetyCenterStatus): string {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-100'
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-100'
  return 'bg-amber-50 text-amber-700 border-amber-100'
}

function formatDateTime(value: string | null, language: string): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat(language.startsWith('ko') ? 'ko-KR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function SummaryCard({
  label,
  value,
  Icon,
  tone,
}: {
  label: string
  value: number
  Icon: LucideIcon
  tone: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

export function SafetyCenterApprovalsView() {
  const { t, i18n } = useTranslation()
  const language = i18n.language || 'ko'
  const statusOptions = useMemo(
    () => STATUS_FILTER_VALUES.map((value) => ({
      value,
      label: value === 'all' ? t('ops_centers_status_all') : statusLabel(value, t),
    })),
    [t],
  )
  const [items, setItems] = useState<SafetyCenterApprovalItem[]>([])
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAccessDenied, setIsAccessDenied] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [keyword, setKeyword] = useState('')
  const [updating, setUpdating] = useState<{ id: string; status: SafetyCenterStatus } | null>(null)
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null)

  const loadItems = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') {
      setIsInitialLoading(true)
    } else {
      setIsRefreshing(true)
    }

    setError(null)

    try {
      const nextItems = await listSafetyCenterApprovals()
      setItems(nextItems)
      setIsAccessDenied(false)
    } catch (loadError) {
      if (loadError instanceof OpsAdminApiError && loadError.status === 403) {
        setIsAccessDenied(true)
        setItems([])
        return
      }

      setIsAccessDenied(false)
      setError(loadError instanceof Error ? loadError.message : t('ops_centers_load_failed'))
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

  const summary = useMemo(() => ({
    total: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    approved: items.filter((item) => item.status === 'approved').length,
    rejected: items.filter((item) => item.status === 'rejected').length,
  }), [items])

  const filteredItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()

    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (!normalizedKeyword) return true

      return [
        item.institution_name,
        item.institution_domain,
        item.center_name,
        item.created_by,
        item.status,
      ].join(' ').toLowerCase().includes(normalizedKeyword)
    })
  }, [items, keyword, statusFilter])

  const handleStatusChange = useCallback(async (centerId: string, nextStatus: SafetyCenterStatus) => {
    setUpdating({ id: centerId, status: nextStatus })
    setError(null)

    try {
      const updatedItem = await updateSafetyCenterApprovalStatus(centerId, nextStatus)
      setItems((prev) => prev.map((item) => item.id === centerId ? updatedItem : item))
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : t('ops_centers_update_failed'))
    } finally {
      setUpdating(null)
    }
  }, [t])

  const handleOpenDocument = useCallback(async (item: SafetyCenterApprovalItem) => {
    if (!item.verification_document_path) {
      setError(t('ops_centers_no_document_attached'))
      return
    }

    setOpeningDocumentId(item.id)
    setError(null)

    try {
      const { url } = await getSafetyCenterVerificationDocumentUrl(item.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (documentError) {
      setError(documentError instanceof Error ? documentError.message : t('ops_centers_document_link_failed'))
    } finally {
      setOpeningDocumentId(null)
    }
  }, [t])

  if (isInitialLoading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (isAccessDenied) {
    return (
      <div className="p-5">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white text-amber-600 shadow-sm">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-medium text-slate-900">{t('ops_centers_denied_title')}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
            {t('ops_centers_denied_body')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 p-5 pb-20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-950">
            <Building2 className="h-6 w-6 text-emerald-700" />
            {t('ops_centers_heading')}
          </h1>
          <p className="mt-1 text-sm font-normal text-slate-500">
            {t('ops_centers_subheading')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadItems('refresh')}
          disabled={isRefreshing}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('ops_centers_refresh')}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label={t('ops_centers_summary_total')} value={summary.total} Icon={Building2} tone="bg-slate-100 text-slate-700" />
        <SummaryCard label={t('ops_centers_status_pending')} value={summary.pending} Icon={Clock} tone="bg-amber-50 text-amber-700" />
        <SummaryCard label={t('ops_centers_status_approved')} value={summary.approved} Icon={CheckCircle2} tone="bg-emerald-50 text-emerald-700" />
        <SummaryCard label={t('ops_centers_status_rejected')} value={summary.rejected} Icon={XCircle} tone="bg-red-50 text-red-700" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[13rem_minmax(0,1fr)]">
          <AppSelect
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            options={statusOptions}
            buttonClassName="bg-white"
          />
          <label className="relative block min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('ops_centers_search_placeholder')}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-3">
        {filteredItems.map((item) => {
          const isUpdating = updating?.id === item.id
          const isOpeningDocument = openingDocumentId === item.id
          const hasVerificationDocument = Boolean(item.verification_document_path)

          return (
            <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-slate-950">{item.center_name}</h2>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(item.status)}`}>
                      {statusLabel(item.status, t)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-normal text-slate-600">
                    {item.institution_name} · {item.institution_domain}
                  </p>
                  <div className="mt-3 grid gap-1 text-xs font-normal text-slate-500 md:grid-cols-2">
                    <span>{t('ops_centers_requested_by', { value: item.created_by })}</span>
                    <span>{t('ops_centers_requested_at', { value: formatDateTime(item.created_at, language) })}</span>
                    <span>{t('ops_centers_approved_by', { value: item.approved_by ?? '-' })}</span>
                    <span>{t('ops_centers_approved_at', { value: formatDateTime(item.approved_at, language) })}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                    <div className={`flex min-w-0 items-center gap-2 ${hasVerificationDocument ? 'text-slate-700' : 'text-red-600'}`}>
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {hasVerificationDocument
                          ? `${item.verification_document_name ?? t('ops_centers_document_default_name')} · ${formatFileSize(item.verification_document_size)} · ${formatDateTime(item.verification_document_uploaded_at, language)}`
                          : t('ops_centers_no_document')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleOpenDocument(item)}
                      disabled={!hasVerificationDocument || isOpeningDocument}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isOpeningDocument ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                      {t('ops_centers_open_document')}
                    </button>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {item.status !== 'approved' && (
                    <button
                      type="button"
                      onClick={() => void handleStatusChange(item.id, 'approved')}
                      disabled={Boolean(isUpdating) || !hasVerificationDocument}
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isUpdating && updating?.status === 'approved' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      {t('ops_centers_action_approve')}
                    </button>
                  )}
                  {item.status !== 'rejected' && (
                    <button
                      type="button"
                      onClick={() => void handleStatusChange(item.id, 'rejected')}
                      disabled={Boolean(isUpdating)}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isUpdating && updating?.status === 'rejected' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      {t('ops_centers_action_reject')}
                    </button>
                  )}
                  {item.status !== 'pending' && (
                    <button
                      type="button"
                      onClick={() => void handleStatusChange(item.id, 'pending')}
                      disabled={Boolean(isUpdating)}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isUpdating && updating?.status === 'pending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                      {t('ops_centers_action_set_pending')}
                    </button>
                  )}
                </div>
              </div>
            </article>
          )
        })}

        {filteredItems.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white px-5 py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <Building2 className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-800">{t('ops_centers_empty_title')}</h2>
            <p className="mt-2 text-sm font-normal text-slate-500">
              {items.length === 0 ? t('ops_centers_empty_none') : t('ops_centers_empty_filtered')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
