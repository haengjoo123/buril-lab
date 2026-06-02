import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { safetyCenterService } from '../../services/safetyCenterService';
import { useLabStore } from '../../store/useLabStore';
import type {
  LabSafetyCenterLinkRequest,
  LabSafetyCenterRequest,
  SafetyCenterRequestStatus,
} from '../safety-center/types';
import {
  getPriorityLabel,
  getRequestStatusLabel,
} from '../safety-center/safetyCenterUtils';

type UpdatingState =
  | { type: 'link'; id: string }
  | { type: 'request'; id: string }
  | null;

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function linkStatusLabel(status: LabSafetyCenterLinkRequest['link_status']): string {
  if (status === 'approved') return '승인됨';
  if (status === 'requested') return '승인 요청';
  if (status === 'rejected') return '거절됨';
  return '철회됨';
}

function linkStatusTone(status: LabSafetyCenterLinkRequest['link_status']): string {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (status === 'requested') return 'bg-blue-50 text-blue-700 border-blue-100';
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-100';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function requestStatusTone(status: SafetyCenterRequestStatus): string {
  if (status === 'resolved') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (status === 'submitted') return 'bg-blue-50 text-blue-700 border-blue-100';
  if (status === 'in_progress') return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function priorityTone(priority: LabSafetyCenterRequest['priority']): string {
  if (priority === 'urgent') return 'bg-red-50 text-red-700 border-red-100';
  if (priority === 'high') return 'bg-orange-50 text-orange-700 border-orange-100';
  if (priority === 'low') return 'bg-slate-50 text-slate-500 border-slate-200';
  return 'bg-blue-50 text-blue-700 border-blue-100';
}

export function LabSafetyCenterPanel() {
  const currentLabId = useLabStore((state) => state.currentLabId);
  const myLabs = useLabStore((state) => state.myLabs);
  const currentLab = myLabs.find((lab) => lab.lab_id === currentLabId);
  const isAdmin = currentLab?.role === 'admin';

  const [links, setLinks] = useState<LabSafetyCenterLinkRequest[]>([]);
  const [requests, setRequests] = useState<LabSafetyCenterRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updating, setUpdating] = useState<UpdatingState>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTextByRequestId, setReplyTextByRequestId] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
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
      setLinks(nextLinks);
      setRequests(nextRequests);
    } catch (err) {
      console.error(err);
      setError('통합센터 요청을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [currentLabId, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingLinks = useMemo(() => links.filter((link) => link.link_status === 'requested'), [links]);
  const openRequests = useMemo(() => requests.filter((request) => request.status !== 'resolved'), [requests]);

  const respondLink = async (linkId: string, status: 'approved' | 'rejected' | 'revoked') => {
    setUpdating({ type: 'link', id: linkId });
    setError(null);
    try {
      await safetyCenterService.respondLabLink(linkId, status);
      await load();
    } catch (err) {
      console.error(err);
      setError('센터 연결 상태를 변경하지 못했습니다.');
    } finally {
      setUpdating(null);
    }
  };

  const updateRequest = async (requestId: string, nextStatus: SafetyCenterRequestStatus) => {
    setUpdating({ type: 'request', id: requestId });
    setError(null);
    try {
      const body = replyTextByRequestId[requestId]?.trim();
      await safetyCenterService.addRequestEvent(requestId, body || undefined, nextStatus);
      setReplyTextByRequestId((current) => ({ ...current, [requestId]: '' }));
      await load();
    } catch (err) {
      console.error(err);
      setError('점검 요청 회신을 저장하지 못했습니다.');
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
    <div className="flex flex-col gap-5 p-5" style={{ paddingBottom: '100px' }}>
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            <Building2 className="h-4 w-4 text-blue-500" />
            센터 연결 요청
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{pendingLinks.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            연결된 센터
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{links.filter((link) => link.link_status === 'approved').length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            <MessageSquare className="h-4 w-4 text-violet-500" />
            미완료 점검 요청
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{openRequests.length}</div>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">센터 연결 요청함</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            연구실 admin이 승인한 센터만 이 연구실의 단계형 공개 데이터에 접근할 수 있습니다.
          </p>
        </div>

        {!isAdmin ? (
          <div className="p-5 text-sm text-slate-500">센터 연결 승인/철회는 연구실 admin만 할 수 있습니다.</div>
        ) : links.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">받은 센터 연결 요청이 없습니다.</div>
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
                        {linkStatusLabel(link.link_status)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {link.institution_name} · {link.institution_domain} · 요청 {formatDateTime(link.requested_at)}
                    </p>
                    <p className="mt-2 text-xs font-semibold text-slate-500">공개 범위: {link.link_scope.join(', ')}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {link.link_status === 'requested' && (
                      <>
                        <button
                          type="button"
                          disabled={isWorking}
                          onClick={() => void respondLink(link.link_id, 'approved')}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          승인
                        </button>
                        <button
                          type="button"
                          disabled={isWorking}
                          onClick={() => void respondLink(link.link_id, 'rejected')}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          거절
                        </button>
                      </>
                    )}
                    {link.link_status === 'approved' && (
                      <button
                        type="button"
                        disabled={isWorking}
                        onClick={() => void respondLink(link.link_id, 'revoked')}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                      >
                        {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                        연결 철회
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
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">센터 점검 요청</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            센터가 보낸 확인 요청에 처리 상태와 회신 내용을 남깁니다.
          </p>
        </div>

        {requests.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">센터 점검 요청이 없습니다.</div>
        ) : (
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {requests.map((request) => {
              const isWorking = updating?.type === 'request' && updating.id === request.id;
              const nextStatus: SafetyCenterRequestStatus = request.status === 'open'
                ? 'in_progress'
                : request.status === 'in_progress'
                  ? 'submitted'
                  : request.status === 'submitted'
                    ? 'resolved'
                    : 'resolved';
              return (
                <article key={request.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white">{request.title}</h3>
                      <p className="mt-1 text-xs text-slate-500">{request.center_name} · {formatDateTime(request.created_at)}</p>
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
                      마감 {request.due_date || '-'}
                    </span>
                  </div>
                  {request.status !== 'resolved' && (
                    <div className="mt-4 space-y-2">
                      <textarea
                        value={replyTextByRequestId[request.id] ?? ''}
                        onChange={(event) => setReplyTextByRequestId((current) => ({
                          ...current,
                          [request.id]: event.target.value,
                        }))}
                        rows={3}
                        placeholder="처리 내용 또는 회신 메모를 입력하세요."
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-slate-600 dark:bg-slate-900"
                      />
                      <button
                        type="button"
                        disabled={isWorking}
                        onClick={() => void updateRequest(request.id, nextStatus)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        {nextStatus === 'in_progress' ? '처리 시작' : nextStatus === 'submitted' ? '회신 제출' : '완료 처리'}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
