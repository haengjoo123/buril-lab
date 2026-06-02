import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Building2, CheckCircle2, Clock, Loader2, RefreshCw, Search, ShieldAlert, XCircle } from 'lucide-react'
import { AppSelect } from '../../components/AppSelect'
import {
  listSafetyCenterApprovals,
  OpsAdminApiError,
  updateSafetyCenterApprovalStatus,
  type SafetyCenterApprovalItem,
} from '../../services/opsAdminService'
import type { SafetyCenterStatus } from '../safety-center/types'

type StatusFilter = 'all' | SafetyCenterStatus

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '전체 상태' },
  { value: 'pending', label: '승인 대기' },
  { value: 'approved', label: '승인됨' },
  { value: 'rejected', label: '거절됨' },
]

function statusLabel(status: SafetyCenterStatus): string {
  if (status === 'approved') return '승인됨'
  if (status === 'rejected') return '거절됨'
  return '승인 대기'
}

function statusTone(status: SafetyCenterStatus): string {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-100'
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-100'
  return 'bg-amber-50 text-amber-700 border-amber-100'
}

function formatDateTime(value: string | null): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
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
  const [items, setItems] = useState<SafetyCenterApprovalItem[]>([])
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAccessDenied, setIsAccessDenied] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [keyword, setKeyword] = useState('')
  const [updating, setUpdating] = useState<{ id: string; status: SafetyCenterStatus } | null>(null)

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
      setError(loadError instanceof Error ? loadError.message : '센터 승인 요청을 불러오지 못했습니다.')
    } finally {
      if (mode === 'initial') {
        setIsInitialLoading(false)
      } else {
        setIsRefreshing(false)
      }
    }
  }, [])

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
      setError(updateError instanceof Error ? updateError.message : '승인 상태를 변경하지 못했습니다.')
    } finally {
      setUpdating(null)
    }
  }, [])

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
          <h2 className="text-lg font-medium text-slate-900">운영자 전용 페이지</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
            이 페이지는 운영자 allowlist에 등록된 계정만 접근할 수 있습니다.
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
            기관 센터 승인
          </h1>
          <p className="mt-1 text-sm font-normal text-slate-500">
            기관 안전관리센터 개설 요청을 검토하고 승인 또는 거절합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadItems('refresh')}
          disabled={isRefreshing}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          새로고침
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="전체" value={summary.total} Icon={Building2} tone="bg-slate-100 text-slate-700" />
        <SummaryCard label="승인 대기" value={summary.pending} Icon={Clock} tone="bg-amber-50 text-amber-700" />
        <SummaryCard label="승인됨" value={summary.approved} Icon={CheckCircle2} tone="bg-emerald-50 text-emerald-700" />
        <SummaryCard label="거절됨" value={summary.rejected} Icon={XCircle} tone="bg-red-50 text-red-700" />
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
              placeholder="기관명, 도메인, 센터명으로 검색"
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-3">
        {filteredItems.map((item) => {
          const isUpdating = updating?.id === item.id

          return (
            <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-slate-950">{item.center_name}</h2>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-normal text-slate-600">
                    {item.institution_name} · {item.institution_domain}
                  </p>
                  <div className="mt-3 grid gap-1 text-xs font-normal text-slate-500 md:grid-cols-2">
                    <span>요청자: {item.created_by}</span>
                    <span>요청일: {formatDateTime(item.created_at)}</span>
                    <span>승인자: {item.approved_by ?? '-'}</span>
                    <span>승인일: {formatDateTime(item.approved_at)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {item.status !== 'approved' && (
                    <button
                      type="button"
                      onClick={() => void handleStatusChange(item.id, 'approved')}
                      disabled={Boolean(isUpdating)}
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isUpdating && updating?.status === 'approved' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      승인
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
                      거절
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
                      대기로 변경
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
            <h2 className="mt-4 text-base font-semibold text-slate-800">표시할 센터 요청이 없습니다</h2>
            <p className="mt-2 text-sm font-normal text-slate-500">
              {items.length === 0 ? '아직 기관 센터 승인 요청이 없습니다.' : '현재 필터에 맞는 요청이 없습니다.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
