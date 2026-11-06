import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Building2, CheckCircle2, Clock, ExternalLink, FileText, Loader2, MailCheck, MailWarning, RefreshCw, Search, XCircle } from 'lucide-react'
import { CustomDialog } from '../../components/CustomDialog'
import { SegmentedControl } from '../../components/SegmentedControl'
import { useActionToast } from '../../components/admin/ActionToast'
import {
  getSafetyCenterVerificationDocumentUrl,
  listSafetyCenterApprovals,
  updateSafetyCenterApprovalStatus,
  type SafetyCenterApprovalItem,
  type SafetyCenterRejectReview,
} from '../../services/opsAdminService'
import type { SafetyCenterStatus } from '../safety-center/types'
import { OpsAccessNotice } from './OpsAccessNotice'
import { getOpsAccessProblem, type OpsAccessProblem } from './opsAccess'
import {
  APPROVAL_WAIT_WARNING_DAYS,
  countApprovalsByStatus,
  getWaitingDays,
  sortApprovalQueue,
  type ApprovalStatusFilter,
} from './safetyCenterApprovalQueue'
import {
  isSafetyCenterReviewReason,
  REVIEW_NOTE_MAX,
  reviewNoteLength,
  SAFETY_CENTER_REVIEW_REASONS,
  validateRejectReview,
  type SafetyCenterReviewReason,
} from './safetyCenterReviewReasons'

const STATUS_FILTER_VALUES: ApprovalStatusFilter[] = ['pending', 'approved', 'rejected', 'all']
const DEFAULT_STATUS_FILTER: ApprovalStatusFilter = 'pending'

/** `?status=approved` (and the home's `?status=pending` link) preselects the filter. */
function parseStatusFilter(value: string | null): ApprovalStatusFilter {
  return STATUS_FILTER_VALUES.find((option) => option === value) ?? DEFAULT_STATUS_FILTER
}

/** Operator roles each request needs (functions/api/admin/feedback/_shared.ts OPERATOR_ACTIONS). */
const LIST_ROLE = 'reader'
const STATUS_ROLE = 'approver'
const DOCUMENT_ROLE = 'raw_exporter'

const APPROVE_UNDO_MS = 10_000

/**
 * Sign-in and MFA hold for every call, so they replace the screen. A missing role or an overdue
 * monthly review belongs to one role: only the list's own role (reader) hides the list.
 */
function replacesScreen(problem: OpsAccessProblem, requiredRole: string): boolean {
  return problem.issue === 'signed_out' || problem.issue === 'mfa_required'
    || (problem.issue === 'review_required' && requiredRole === LIST_ROLE)
}

interface ActionNotice {
  problem: OpsAccessProblem
  requiredRole?: string
  /** Re-runs the refused action. Without it, retry reloads the list. */
  retry?: () => void
}

interface ConfirmTarget {
  item: SafetyCenterApprovalItem
  nextStatus: 'rejected' | 'pending'
}

function statusLabel(status: SafetyCenterStatus, t: (key: string) => string): string {
  if (status === 'approved') return t('ops_centers_status_approved')
  if (status === 'rejected') return t('ops_centers_status_rejected')
  return t('ops_centers_status_pending')
}

function filterLabel(value: ApprovalStatusFilter, t: (key: string) => string): string {
  if (value === 'all') return t('ops_centers_summary_total')
  if (value === 'pending') return t('ops_centers_filter_pending')
  return statusLabel(value, t)
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

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

interface SafetyCenterApprovalsViewProps {
  /**
   * Gets the whole list after every good load and status change, with when the list was loaded,
   * so the console's badges and home follow what the operator does here without another call.
   */
  onItemsChange?: (items: SafetyCenterApprovalItem[], loadedAt: number) => void
}

export function SafetyCenterApprovalsView({ onItemsChange }: SafetyCenterApprovalsViewProps = {}) {
  const { t, i18n } = useTranslation()
  const language = i18n.language || 'ko'
  const { showToast, toastElement } = useActionToast({ appearance: 'light' })
  const [items, setItems] = useState<SafetyCenterApprovalItem[]>([])
  /** The list after the latest change, ahead of the re-render, so changes that finish together build on each other. */
  const itemsRef = useRef<SafetyCenterApprovalItem[]>([])
  const [loadedAt, setLoadedAt] = useState(0)
  const loadedAtRef = useRef(0)
  /** Finished status changes so far, and the count at each center's latest one. */
  const changeCountRef = useRef(0)
  const changedAtRef = useRef(new Map<string, number>())
  const onItemsChangeRef = useRef(onItemsChange)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [screenProblem, setScreenProblem] = useState<OpsAccessProblem | null>(null)
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status')
  const statusFilter = parseStatusFilter(statusParam)
  const [keyword, setKeyword] = useState('')
  /** Status each in-flight request is moving to, keyed by center id, so rows update independently. */
  const [updatingById, setUpdatingById] = useState<Record<string, SafetyCenterStatus>>({})
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)
  /** Rejection form in the confirm dialog; reset whenever the dialog opens or closes. */
  const [rejectReason, setRejectReason] = useState<SafetyCenterReviewReason | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [rejectNoteTouched, setRejectNoteTouched] = useState(false)
  const rejectFormId = useId()
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    onItemsChangeRef.current = onItemsChange
  }, [onItemsChange])

  const commitItems = useCallback((next: SafetyCenterApprovalItem[], share: boolean) => {
    itemsRef.current = next
    setItems(next)
    // Also after the screen is gone: an approval that finishes later must still reach the badges.
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
      const listed = await listSafetyCenterApprovals()
      // A status change that finished while the list was on its way is newer than the list's copy of that row.
      const current = new Map(itemsRef.current.map((item) => [item.id, item]))
      const nextItems = changeCountRef.current === changesBefore
        ? listed
        : listed.map((item) => ((changedAtRef.current.get(item.id) ?? 0) > changesBefore ? current.get(item.id) ?? item : item))
      loadedAtRef.current = Date.now()
      setLoadedAt(loadedAtRef.current)
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
      setError(t('ops_centers_load_failed'))
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

  const setStatusFilter = useCallback((next: ApprovalStatusFilter) => {
    // Replace, not push: switching the filter should not fill the back button history.
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      if (next === DEFAULT_STATUS_FILTER) params.delete('status')
      else params.set('status', next)
      return params
    }, { replace: true })
  }, [setSearchParams])

  // An unknown ?status value falls back to pending; drop it so the URL matches the filter shown.
  useEffect(() => {
    if (statusParam !== null && parseStatusFilter(statusParam) !== statusParam) setStatusFilter(DEFAULT_STATUS_FILTER)
  }, [setStatusFilter, statusParam])

  const counts = useMemo(() => countApprovalsByStatus(items), [items])

  const filterOptions = useMemo(
    () => STATUS_FILTER_VALUES.map((value) => {
      const label = filterLabel(value, t)
      const count = counts[value]
      const highlight = value === 'pending' && count > 0
      return {
        value,
        title: `${label} ${count}`,
        // Below 360px four segments leave ~42px for text, so the count stacks under the label
        // instead of squeezing the label to one character. The count itself never truncates.
        label: (
          <span className="flex min-w-0 flex-col items-center leading-4 min-[360px]:flex-row min-[360px]:gap-1">
            <span className="max-w-full min-w-0 truncate">{label}</span>
            <span
              className={highlight
                ? 'shrink-0 rounded-full bg-amber-100 px-1.5 tabular-nums text-amber-800'
                : 'shrink-0 tabular-nums text-slate-400'}
            >
              {count}
            </span>
          </span>
        ),
      }
    }),
    [counts, t],
  )

  const filteredItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()

    return sortApprovalQueue(items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (!normalizedKeyword) return true

      return [
        item.institution_name,
        item.institution_domain,
        item.center_name,
        item.status,
      ].join(' ').toLowerCase().includes(normalizedKeyword)
    }))
  }, [items, keyword, statusFilter])

  function reportActionError(actionError: unknown, requiredRole: string, retry: () => void, fallbackMessage: string) {
    const problem = getOpsAccessProblem(actionError)
    if (!problem) {
      showToast(fallbackMessage, { tone: 'error' })
      return
    }
    if (replacesScreen(problem, requiredRole)) {
      setScreenProblem(problem)
      return
    }
    setActionNotice({
      problem,
      requiredRole: problem.issue === 'role_required' || problem.issue === 'review_required' ? requiredRole : undefined,
      retry,
    })
  }

  async function changeStatus(
    item: SafetyCenterApprovalItem,
    nextStatus: SafetyCenterStatus,
    retry: () => void,
    review?: SafetyCenterRejectReview,
  ): Promise<SafetyCenterApprovalItem | null> {
    setUpdatingById((prev) => ({ ...prev, [item.id]: nextStatus }))

    try {
      // Only a rejection from the dialog carries a review. Undoing an approval back to rejected
      // sends none, so the database keeps (and the applicant sees again) the stored reason.
      const updatedItem = await updateSafetyCenterApprovalStatus(item.id, nextStatus, review)
      changeCountRef.current += 1
      changedAtRef.current.set(item.id, changeCountRef.current)
      // The status API returns the row without the list-only requester domain fields; keep them.
      commitItems(itemsRef.current.map((current) => current.id === item.id ? { ...current, ...updatedItem } : current), true)
      setActionNotice(null)
      return updatedItem
    } catch (updateError) {
      reportActionError(updateError, STATUS_ROLE, retry, t('ops_centers_update_failed'))
      return null
    } finally {
      setUpdatingById((prev) => withoutKey(prev, item.id))
    }
  }

  async function undoApproval(item: SafetyCenterApprovalItem, previousStatus: SafetyCenterStatus) {
    const restored = await changeStatus(item, previousStatus, () => void undoApproval(item, previousStatus))
    if (restored) showToast(t('ops_centers_toast_approval_undone'), { tone: 'info' })
  }

  async function handleApprove(item: SafetyCenterApprovalItem) {
    const previousStatus = item.status
    const approved = await changeStatus(item, 'approved', () => void handleApprove(item))
    if (!approved) return

    showToast(t('ops_centers_toast_approved', { name: item.center_name }), {
      tone: 'success',
      durationMs: APPROVE_UNDO_MS,
      onUndo: () => undoApproval(approved, previousStatus),
    })
  }

  function openConfirm(target: ConfirmTarget) {
    setRejectReason(null)
    setRejectNote('')
    setRejectNoteTouched(false)
    setConfirmTarget(target)
  }

  function closeConfirm() {
    setConfirmTarget(null)
    setRejectReason(null)
    setRejectNote('')
    setRejectNoteTouched(false)
  }

  async function applyConfirmedChange(
    item: SafetyCenterApprovalItem,
    nextStatus: ConfirmTarget['nextStatus'],
    review?: SafetyCenterRejectReview,
  ) {
    const updatedItem = await changeStatus(item, nextStatus, () => void applyConfirmedChange(item, nextStatus, review), review)
    closeConfirm()
    if (!updatedItem) return

    showToast(t(nextStatus === 'rejected' ? 'ops_centers_toast_rejected' : 'ops_centers_toast_pending', {
      name: item.center_name,
    }))
  }

  async function handleOpenDocument(item: SafetyCenterApprovalItem) {
    if (!item.verification_document_path) {
      showToast(t('ops_centers_no_document_attached'), { tone: 'error' })
      return
    }

    // Open the tab while the click still counts as a user gesture. Browsers block
    // window.open once we await the signed URL, so the URL is filled in afterwards.
    const documentWindow = window.open('', '_blank')
    if (!documentWindow) {
      showToast(t('ops_centers_popup_blocked'), { tone: 'error' })
      return
    }
    documentWindow.opener = null
    try {
      documentWindow.document.title = t('ops_centers_document_opening')
      documentWindow.document.body.textContent = t('ops_centers_document_opening')
    } catch {
      // The placeholder text is optional; the tab still receives the document URL.
    }

    setOpeningDocumentId(item.id)

    try {
      const { url } = await getSafetyCenterVerificationDocumentUrl(item.id)
      if (!documentWindow.closed) documentWindow.location.replace(url)
      setActionNotice(null)
    } catch (documentError) {
      documentWindow.close()
      reportActionError(documentError, DOCUMENT_ROLE, () => void handleOpenDocument(item), t('ops_centers_document_link_failed'))
    } finally {
      setOpeningDocumentId(null)
    }
  }

  if (isInitialLoading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
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

  const confirmItem = confirmTarget?.item
  const isConfirmLoading = Boolean(confirmItem && updatingById[confirmItem.id])
  const isRejecting = confirmTarget?.nextStatus === 'rejected'
  const rejectValidation = validateRejectReview(rejectReason, rejectNote)
  const rejectNoteLength = reviewNoteLength(rejectNote)
  const isRejectNoteTooLong = rejectNoteLength > REVIEW_NOTE_MAX
  // The confirm button stays disabled until a reason is chosen; say why once a note is being written.
  const showReasonRequired = !rejectValidation.ok && rejectValidation.error === 'reason_required' && rejectNoteTouched
  const rejectNoteError = isRejectNoteTooLong
    ? t('ops_centers_reject_note_too_long')
    : !rejectValidation.ok && rejectValidation.error === 'note_required'
      ? t('ops_centers_reject_note_required')
      : null
  const reasonErrorId = `${rejectFormId}-reason-error`
  const noteId = `${rejectFormId}-note`
  const noteHintId = `${rejectFormId}-note-hint`
  const emptyMessage = items.length === 0
    ? t('ops_centers_empty_none')
    : statusFilter === 'pending' && !keyword.trim()
      ? t('ops_centers_empty_pending')
      : t('ops_centers_empty_filtered')

  return (
    <div className="flex flex-col gap-5 p-5 pb-20">
      {toastElement}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-950">
            <Building2 className="h-6 w-6 text-emerald-700" />
            {t('ops_centers_heading')}
          </h2>
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
        <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <SegmentedControl
          value={statusFilter}
          options={filterOptions}
          onChange={setStatusFilter}
          ariaLabel={t('ops_centers_filter_label')}
          size="sm"
          fullWidth
          className="md:w-auto md:shrink-0"
        />
        <label className="relative block min-w-0 md:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('ops_centers_search_placeholder')}
            aria-label={t('ops_centers_search_placeholder')}
            className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400"
          />
        </label>
      </div>

      {actionNotice && (
        <OpsAccessNotice
          compact
          problem={actionNotice.problem}
          requiredRole={actionNotice.requiredRole}
          onRetry={actionNotice.retry ?? (() => void loadItems('refresh'))}
        />
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {filteredItems.map((item) => {
          const updatingStatus = updatingById[item.id]
          const isUpdating = Boolean(updatingStatus)
          const isOpeningDocument = openingDocumentId === item.id
          const hasVerificationDocument = Boolean(item.verification_document_path)
          const waitingDays = item.status === 'pending' ? getWaitingDays(item.created_at, loadedAt) : null
          const isWaitingLong = waitingDays !== null && waitingDays > APPROVAL_WAIT_WARNING_DAYS
          const domainMatches = item.status === 'pending' && typeof item.domain_matches === 'boolean'
            ? item.domain_matches
            : null
          // The applicant sees the reason only while rejected; other rows may still store an old one.
          const reviewReason = item.status === 'rejected' && isSafetyCenterReviewReason(item.review_reason)
            ? item.review_reason
            : null

          return (
            <article key={item.id} className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-lg font-semibold text-slate-950">{item.center_name}</h3>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(item.status)}`}>
                      {statusLabel(item.status, t)}
                    </span>
                    {waitingDays !== null && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${isWaitingLong
                          ? 'border-orange-200 bg-orange-50 text-orange-700'
                          : 'border-slate-200 bg-slate-50 text-slate-600'}`}
                      >
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        {waitingDays === 0
                          ? t('ops_centers_waiting_today')
                          : t('ops_centers_waiting_days', { count: waitingDays })}
                      </span>
                    )}
                    {domainMatches !== null && (
                      <span
                        title={t('ops_centers_domain_hint')}
                        className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${domainMatches
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-800'}`}
                      >
                        {domainMatches
                          ? <MailCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          : <MailWarning className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                        <span className="min-w-0 truncate">
                          {domainMatches
                            ? t('ops_centers_domain_match')
                            : t('ops_centers_domain_mismatch', { domain: item.requester_email_domain ?? '-' })}
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-normal text-slate-600">
                    {item.institution_name} · {item.institution_domain}
                  </p>
                  <div className="mt-3 grid gap-1 text-xs font-normal text-slate-500 md:grid-cols-2">
                    <span>{t('ops_centers_requested_at', { value: formatDateTime(item.created_at, language) })}</span>
                    {item.approved_at && (
                      <span>{t('ops_centers_approved_at', { value: formatDateTime(item.approved_at, language) })}</span>
                    )}
                  </div>
                  {reviewReason && (
                    <div className="mt-3 min-w-0 max-w-xl rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-800">
                      <p className="break-words font-semibold">
                        {t('ops_centers_review_reason_display', { reason: t(`sc_review_reason_${reviewReason}`) })}
                      </p>
                      {item.review_note && (
                        <p className="mt-1 truncate font-normal text-red-700" title={item.review_note}>
                          {item.review_note}
                        </p>
                      )}
                    </div>
                  )}
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
                      onClick={() => void handleApprove(item)}
                      disabled={isUpdating || !hasVerificationDocument}
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {updatingStatus === 'approved' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      {t('ops_centers_action_approve')}
                    </button>
                  )}
                  {item.status !== 'rejected' && (
                    <button
                      type="button"
                      onClick={() => openConfirm({ item, nextStatus: 'rejected' })}
                      disabled={isUpdating}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {updatingStatus === 'rejected' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      {t('ops_centers_action_reject')}
                    </button>
                  )}
                  {item.status !== 'pending' && (
                    <button
                      type="button"
                      onClick={() => openConfirm({ item, nextStatus: 'pending' })}
                      disabled={isUpdating}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {updatingStatus === 'pending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
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
            <h3 className="mt-4 text-base font-semibold text-slate-800">{t('ops_centers_empty_title')}</h3>
            <p className="mt-2 text-sm font-normal text-slate-500">{emptyMessage}</p>
          </div>
        )}
      </div>

      <CustomDialog
        isOpen={Boolean(confirmTarget)}
        onClose={closeConfirm}
        type="confirm"
        title={confirmTarget?.nextStatus === 'rejected'
          ? t('ops_centers_reject_confirm_title')
          : t('ops_centers_pending_confirm_title')}
        description={!confirmItem
          ? undefined
          : confirmTarget?.nextStatus === 'rejected'
            ? t('ops_centers_reject_confirm_body', { name: confirmItem.center_name })
            : confirmItem.status === 'approved'
              ? t('ops_centers_pending_confirm_body_approved', { name: confirmItem.center_name })
              : t('ops_centers_pending_confirm_body_rejected', { name: confirmItem.center_name })}
        confirmText={confirmTarget?.nextStatus === 'rejected'
          ? t('ops_centers_action_reject')
          : t('ops_centers_action_set_pending')}
        onConfirm={() => {
          if (!confirmTarget) return
          if (confirmTarget.nextStatus !== 'rejected') {
            void applyConfirmedChange(confirmTarget.item, confirmTarget.nextStatus)
            return
          }
          if (!rejectValidation.ok || !rejectReason) return
          void applyConfirmedChange(confirmTarget.item, 'rejected', { reasonPreset: rejectReason, note: rejectValidation.note })
        }}
        isDestructive={isRejecting}
        isConfirmLoading={isConfirmLoading}
        isConfirmDisabled={isRejecting && !rejectValidation.ok}
        preventCloseWhileLoading
      >
        {isRejecting && (
          <div className="flex flex-col gap-4 text-left">
            <fieldset className="min-w-0" aria-describedby={showReasonRequired ? reasonErrorId : undefined}>
              <legend className="text-sm font-semibold text-slate-800">{t('ops_centers_reject_reason_label')}</legend>
              <div className="mt-2 flex flex-col gap-1.5">
                {SAFETY_CENTER_REVIEW_REASONS.map((reason) => {
                  const isChecked = rejectReason === reason
                  return (
                    <label
                      key={reason}
                      className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${isChecked
                        ? 'border-red-300 bg-red-50 text-red-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                    >
                      <input
                        type="radio"
                        name={`${rejectFormId}-reason`}
                        value={reason}
                        checked={isChecked}
                        required
                        disabled={isConfirmLoading}
                        onChange={() => setRejectReason(reason)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
                      />
                      <span className="min-w-0 break-words leading-5">{t(`sc_review_reason_${reason}`)}</span>
                    </label>
                  )
                })}
              </div>
              {showReasonRequired && (
                <p id={reasonErrorId} className="mt-2 text-xs font-medium text-red-600">
                  {t('ops_centers_reject_reason_required')}
                </p>
              )}
            </fieldset>

            <div className="min-w-0">
              <label htmlFor={noteId} className="text-sm font-semibold text-slate-800">
                {t('ops_centers_reject_note_label')}
              </label>
              <textarea
                id={noteId}
                value={rejectNote}
                onChange={(event) => {
                  setRejectNote(event.target.value)
                  setRejectNoteTouched(true)
                }}
                rows={3}
                disabled={isConfirmLoading}
                placeholder={t('ops_centers_reject_note_placeholder')}
                aria-invalid={rejectNoteError ? true : undefined}
                aria-describedby={noteHintId}
                className="mt-2 block w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
              />
              <div id={noteHintId} className="mt-1 flex items-start justify-between gap-3 text-xs">
                <span className="min-w-0 font-medium text-red-600" aria-live="polite">{rejectNoteError}</span>
                <span className={`shrink-0 tabular-nums ${isRejectNoteTooLong ? 'font-semibold text-red-600' : 'text-slate-400'}`}>
                  {t('ops_centers_reject_note_count', { count: rejectNoteLength })}
                </span>
              </div>
            </div>

            <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('ops_centers_reject_shown_to_applicant')}
            </p>
          </div>
        )}
      </CustomDialog>
    </div>
  )
}
