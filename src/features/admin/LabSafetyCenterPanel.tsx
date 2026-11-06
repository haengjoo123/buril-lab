import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Clock,
  Hourglass,
  Link2Off,
  Loader2,
  MessageSquare,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { safetyCenterService } from '../../services/safetyCenterService';
import { useLabStore } from '../../store/useLabStore';
import { invalidateLabAdminAttention } from '../../store/useLabAdminAttentionStore';
import { LabManagementModal } from '../../components/LabManagementModal';
import type {
  LabSafetyCenterLinkRequest,
  LabSafetyCenterRequest,
  SafetyCenterRequestStatus,
} from '../safety-center/types';
import {
  getLinkScopeLabel,
  getPriorityLabel,
  getRequestStatusLabel,
} from '../safety-center/safetyCenterUtils';
import {
  formatDueDate,
  getRequestDueState,
  sortLabSafetyRequests,
  type RequestDueState,
} from './safetyRequestDue';
import { canLabCloseRequest, nextLabRequestStatus } from './labRequestFlow';

type UpdatingState =
  | { type: 'link'; id: string }
  | { type: 'request'; id: string }
  | null;

const REQUEST_PRIMARY_BUTTON = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white';
const REQUEST_SECONDARY_BUTTON = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';

function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '-';
  return new Date(value).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function dueChipLabel({ daysLeft }: RequestDueState, t: TFunction): string {
  if (daysLeft > 0) return t('cmp_lsc_due_in_days', { days: daysLeft });
  if (daysLeft === 0) return t('cmp_lsc_due_today');
  return t('cmp_lsc_overdue_days', { days: -daysLeft });
}

function dueChipTone(tone: RequestDueState['tone']): string {
  if (tone === 'overdue') return 'bg-red-50 text-red-700 border-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300';
  if (tone === 'soon') return 'bg-amber-50 text-amber-700 border-amber-100 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300';
  return 'bg-slate-50 text-slate-600 border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300';
}

function linkStatusLabel(status: LabSafetyCenterLinkRequest['link_status'], t: TFunction): string {
  if (status === 'approved') return t('cmp_lsc_status_approved', '승인됨');
  if (status === 'requested') return t('cmp_lsc_status_requested', '승인 요청');
  if (status === 'rejected') return t('cmp_lsc_status_rejected', '거절됨');
  return t('cmp_lsc_status_revoked', '철회됨');
}

// Chip tones with dark variants: the admin tab follows the app's dark mode.
const TONE_EMERALD = 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300';
const TONE_BLUE = 'bg-blue-50 text-blue-700 border-blue-100 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300';
const TONE_RED = 'bg-red-50 text-red-700 border-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300';
const TONE_AMBER = 'bg-amber-50 text-amber-700 border-amber-100 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300';
const TONE_ORANGE = 'bg-orange-50 text-orange-700 border-orange-100 dark:border-orange-900/40 dark:bg-orange-900/20 dark:text-orange-300';

function linkStatusTone(status: LabSafetyCenterLinkRequest['link_status']): string {
  if (status === 'approved') return TONE_EMERALD;
  if (status === 'requested') return TONE_BLUE;
  if (status === 'rejected') return TONE_RED;
  return 'bg-slate-100 text-slate-600 border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200';
}

function requestStatusTone(status: SafetyCenterRequestStatus): string {
  if (status === 'resolved') return TONE_EMERALD;
  if (status === 'submitted') return TONE_BLUE;
  if (status === 'in_progress') return TONE_AMBER;
  return 'bg-slate-50 text-slate-700 border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200';
}

function priorityTone(priority: LabSafetyCenterRequest['priority']): string {
  if (priority === 'urgent') return TONE_RED;
  if (priority === 'high') return TONE_ORANGE;
  if (priority === 'low') return 'bg-slate-50 text-slate-500 border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400';
  return TONE_BLUE;
}

export function LabSafetyCenterPanel() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US';
  const currentLabId = useLabStore((state) => state.currentLabId);
  const myLabs = useLabStore((state) => state.myLabs);
  const currentLab = myLabs.find((lab) => lab.lab_id === currentLabId);
  const isAdmin = currentLab?.role === 'admin';

  const [links, setLinks] = useState<LabSafetyCenterLinkRequest[]>([]);
  const [requests, setRequests] = useState<LabSafetyCenterRequest[]>([]);
  // When requests were loaded: "today" for the D-day chips.
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [updating, setUpdating] = useState<UpdatingState>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTextByRequestId, setReplyTextByRequestId] = useState<Record<string, string>>({});
  const [isLabSettingsOpen, setIsLabSettingsOpen] = useState(false);
  const institutionName = currentLab?.lab?.institution_name?.trim() ?? '';
  // Only the latest load may commit, so a slow load for the previous lab never shows here.
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    loadSeqRef.current += 1;
    const seq = loadSeqRef.current;
    const isCurrentLoad = () => loadSeqRef.current === seq;

    if (!currentLabId) {
      setLinks([]);
      setRequests([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [nextLinks, nextRequests] = await Promise.all([
        isAdmin ? safetyCenterService.getLabLinkRequests(currentLabId) : Promise.resolve([]),
        safetyCenterService.getLabRequests(currentLabId),
      ]);
      if (!isCurrentLoad()) return;
      setLinks(nextLinks);
      setRequests(nextRequests);
      setLoadedAt(Date.now());
    } catch (err) {
      console.error(err);
      if (isCurrentLoad()) setError(t('cmp_lsc_load_error', '통합센터 요청을 불러오지 못했습니다.'));
    } finally {
      if (isCurrentLoad()) setIsLoading(false);
    }
  }, [currentLabId, isAdmin, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingLinks = useMemo(() => links.filter((link) => link.link_status === 'requested'), [links]);
  const approvedLinkCount = useMemo(() => links.filter((link) => link.link_status === 'approved').length, [links]);
  const openRequests = useMemo(() => requests.filter((request) => request.status !== 'resolved'), [requests]);
  // Unresolved first, nearest due date first, so overdue work sits at the top.
  const sortedRequests = useMemo(() => sortLabSafetyRequests(requests), [requests]);
  // Nothing has ever reached this lab: show one line instead of zero counters and empty inboxes.
  const isEmpty = links.length === 0 && requests.length === 0;

  const respondLink = async (linkId: string, status: 'approved' | 'rejected' | 'revoked') => {
    setUpdating({ type: 'link', id: linkId });
    setError(null);
    try {
      await safetyCenterService.respondLabLink(linkId, status);
      if (currentLabId) invalidateLabAdminAttention(currentLabId);
      await load();
    } catch (err) {
      console.error(err);
      setError(t('cmp_lsc_link_update_error', '센터 연결 상태를 변경하지 못했습니다.'));
    } finally {
      setUpdating(null);
    }
  };

  /** Moves a request on (start, reply, close) or, without a status, only sends the note. */
  const updateRequest = async (requestId: string, nextStatus: SafetyCenterRequestStatus | undefined) => {
    const body = replyTextByRequestId[requestId]?.trim();
    if (!nextStatus && !body) return;
    setUpdating({ type: 'request', id: requestId });
    setError(null);
    try {
      await safetyCenterService.addRequestEvent(requestId, body || undefined, nextStatus);
      setReplyTextByRequestId((current) => ({ ...current, [requestId]: '' }));
      if (currentLabId) invalidateLabAdminAttention(currentLabId);
      await load();
    } catch (err) {
      console.error(err);
      setError(t('cmp_lsc_reply_save_error', '점검 요청 회신을 저장하지 못했습니다.'));
    } finally {
      setUpdating(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:gap-5 sm:p-5" style={{ paddingBottom: '100px' }}>
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {isEmpty ? (
        <div className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-800">
          <Building2 className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm font-medium text-slate-600 dark:text-slate-300">
            {t('cmp_lsc_empty')}
          </p>
          {isAdmin && !institutionName ? (
            <button
              type="button"
              onClick={() => setIsLabSettingsOpen(true)}
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {t('cmp_lsc_set_institution')}
            </button>
          ) : institutionName ? (
            <span className="max-w-[40%] shrink-0 truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">
              {institutionName}
            </span>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {([
              { key: 'pending', label: t('cmp_lsc_center_link_requests', '센터 연결 요청'), value: pendingLinks.length, Icon: Building2, tone: 'text-blue-500' },
              { key: 'linked', label: t('cmp_lsc_linked_centers', '연결된 센터'), value: approvedLinkCount, Icon: ShieldCheck, tone: 'text-emerald-500' },
              { key: 'open', label: t('cmp_lsc_open_check_requests', '미완료 점검 요청'), value: openRequests.length, Icon: MessageSquare, tone: 'text-violet-500' },
            ]).map(({ key, label, value, Icon, tone }) => (
              <div key={key} className="min-w-0 rounded-xl border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <div className="flex min-w-0 items-center gap-2 text-2xs font-semibold text-slate-500 md:text-sm">
                  <Icon className={`hidden h-4 w-4 shrink-0 md:block ${tone}`} aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </div>
                <div className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white md:mt-2 md:text-2xl">{value}</div>
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('cmp_lsc_center_link_inbox', '센터 연결 요청함')}</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('cmp_lsc_center_link_inbox_desc', '연구실 admin이 승인한 센터만 이 연구실의 단계형 공개 데이터에 접근할 수 있습니다.')}
              </p>
            </div>

            {!isAdmin ? (
              <div className="p-5 text-sm text-slate-500">{t('cmp_lsc_admin_only', '센터 연결 승인/철회는 연구실 admin만 할 수 있습니다.')}</div>
            ) : links.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">{t('cmp_lsc_no_link_requests', '받은 센터 연결 요청이 없습니다.')}</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {links.map((link) => {
                  const isWorking = updating?.type === 'link' && updating.id === link.link_id;
                  return (
                    <div key={link.link_id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-slate-900 dark:text-white">{link.center_name}</h3>
                          <span className={`rounded border px-2 py-0.5 text-xs font-bold ${linkStatusTone(link.link_status)}`}>
                            {linkStatusLabel(link.link_status, t)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                          {link.institution_name} · {link.institution_domain} · {t('cmp_lsc_requested_at', { date: formatDateTime(link.requested_at, locale), defaultValue: '요청 {{date}}' })}
                        </p>
                        <p className="mt-2 text-xs font-semibold text-slate-500">{t('cmp_lsc_link_scope', { scope: link.link_scope.map(getLinkScopeLabel).join(', '), defaultValue: '공개 범위: {{scope}}' })}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {link.link_status === 'requested' && (
                          <>
                            <button
                              type="button"
                              disabled={isWorking}
                              onClick={() => void respondLink(link.link_id, 'approved')}
                              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                              {t('cmp_lsc_approve', '승인')}
                            </button>
                            <button
                              type="button"
                              disabled={isWorking}
                              onClick={() => void respondLink(link.link_id, 'rejected')}
                              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              {t('cmp_lsc_reject', '거절')}
                            </button>
                          </>
                        )}
                        {link.link_status === 'approved' && (
                          <button
                            type="button"
                            disabled={isWorking}
                            onClick={() => void respondLink(link.link_id, 'revoked')}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                          >
                            {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                            {t('cmp_lsc_revoke_link', '연결 철회')}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('cmp_lsc_center_check_requests', '센터 점검 요청')}</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('cmp_lsc_center_requests_desc', '센터가 보낸 확인 요청에 처리 상태와 회신 내용을 남깁니다.')}
              </p>
            </div>

            {requests.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">{t('cmp_lsc_no_check_requests', '센터 점검 요청이 없습니다.')}</div>
            ) : (
              <div className="grid gap-3 p-4 lg:grid-cols-2">
                {sortedRequests.map((request) => {
                  const isWorking = updating?.type === 'request' && updating.id === request.id;
                  const dueState = request.status !== 'resolved' && loadedAt !== null
                    ? getRequestDueState(request.due_date, loadedAt)
                    : null;
                  // The lab replies up to "submitted"; the center reviews and closes the request.
                  const nextStatus = nextLabRequestStatus(request.status);
                  const isWaitingForCenter = nextStatus === null && request.status === 'submitted';
                  // Only when the center can no longer see the request (link ended, paused, or center not approved).
                  const canCloseHere = canLabCloseRequest(request, isAdmin ? links : null);
                  const replyText = replyTextByRequestId[request.id] ?? '';
                  return (
                    <article key={request.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-bold text-slate-900 dark:text-white">{request.title}</h3>
                          <p className="mt-1 text-xs text-slate-500">{request.center_name} · {formatDateTime(request.created_at, locale)}</p>
                        </div>
                        <span className={`rounded border px-2 py-0.5 text-xs font-bold ${priorityTone(request.priority)}`}>
                          {getPriorityLabel(request.priority)}
                        </span>
                      </div>
                      {request.description && (
                        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{request.description}</p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className={`rounded border px-2 py-0.5 text-xs font-bold ${requestStatusTone(request.status)}`}>
                          {getRequestStatusLabel(request.status)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <Clock className="h-3.5 w-3.5" />
                          {t('cmp_lsc_due', { date: formatDueDate(request.due_date, locale), defaultValue: '마감 {{date}}' })}
                        </span>
                        {dueState && (
                          <span className={`rounded border px-2 py-0.5 text-xs font-bold ${dueChipTone(dueState.tone)}`}>
                            {dueChipLabel(dueState, t)}
                          </span>
                        )}
                      </div>
                      {isWaitingForCenter && !canCloseHere && (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                          <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {t('cmp_lsc_waiting_center')}
                        </p>
                      )}
                      {canCloseHere && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                          <Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {t('cmp_lsc_center_unlinked')}
                        </p>
                      )}
                      {request.status !== 'resolved' && (
                        <div className="mt-4 space-y-2">
                          <label htmlFor={`lab-request-reply-${request.id}`} className="sr-only">
                            {t('cmp_lsc_reply_placeholder', '처리 내용 또는 회신 메모를 입력하세요.')}
                          </label>
                          <textarea
                            id={`lab-request-reply-${request.id}`}
                            value={replyText}
                            onChange={(event) => setReplyTextByRequestId((current) => ({
                              ...current,
                              [request.id]: event.target.value,
                            }))}
                            rows={3}
                            placeholder={t('cmp_lsc_reply_placeholder', '처리 내용 또는 회신 메모를 입력하세요.')}
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-blue-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:text-sm"
                          />
                          <div className="flex flex-wrap gap-2">
                            {nextStatus ? (
                              <button
                                type="button"
                                disabled={isWorking}
                                onClick={() => void updateRequest(request.id, nextStatus)}
                                className={REQUEST_PRIMARY_BUTTON}
                              >
                                {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                                {nextStatus === 'in_progress' ? t('cmp_lsc_start', '처리 시작') : t('cmp_lsc_submit_reply', '회신 제출')}
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isWorking || !replyText.trim()}
                                onClick={() => void updateRequest(request.id, undefined)}
                                className={REQUEST_PRIMARY_BUTTON}
                              >
                                {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageSquare className="h-4 w-4" aria-hidden="true" />}
                                {t('cmp_lsc_send_comment')}
                              </button>
                            )}
                            {canCloseHere && (
                              <button
                                type="button"
                                disabled={isWorking}
                                onClick={() => void updateRequest(request.id, 'resolved')}
                                className={REQUEST_SECONDARY_BUTTON}
                              >
                                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                                {t('cmp_lsc_close_unlinked')}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {isLabSettingsOpen && <LabManagementModal onClose={() => setIsLabSettingsOpen(false)} />}
    </div>
  );
}
