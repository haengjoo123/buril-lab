import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Layers3,
  Loader2,
  LockKeyhole,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import {
  SAFETY_CENTER_VERIFICATION_ACCEPT,
  safetyCenterService,
  validateSafetyCenterVerificationDocument,
} from '../../services/safetyCenterService';
import {
  assessRiskItem,
  buildSafetyCenterDashboardSummary,
  filterRiskItems,
  getPriorityLabel,
  getRequestStatusLabel,
  getRiskFlagLabel,
  type SafetyCenterRiskFlag,
} from './safetyCenterUtils';
import type {
  SafetyCenter,
  SafetyCenterAuditLog,
  SafetyCenterExportFormat,
  SafetyCenterExportLog,
  SafetyCenterLabCandidate,
  SafetyCenterMember,
  SafetyCenterRequest,
  SafetyCenterRequestPriority,
  SafetyCenterRiskItem,
  SafetyCenterWasteLog,
} from './types';
import { getSafetyCenterSectionFromPath } from './safetyCenterNavigation';
import { WastePolicyDistributionPanel } from './WastePolicyDistributionPanel';
import { isWasteV2Enabled } from '../../config/featureFlags';
import { hasManufacturerDate } from '../../utils/manufacturerDate';

type DatasetKey = 'risks' | 'waste' | 'audit';

const getManufacturerDateTypeLabel = (type: SafetyCenterRiskItem['manufacturer_date_type']) => {
  if (type === 'minimum_shelf_life') return '최소 보증기한';
  if (type === 'expiry') return '유효기한';
  return '미표기';
};

const getTrackedManufacturerDate = (item: SafetyCenterRiskItem) => (
  hasManufacturerDate(item.manufacturer_date_type) ? item.expiry_date : null
);

interface ExportOptions {
  labIds?: string[];
  dateFrom?: string;
  dateTo?: string;
}

interface RequestDraft {
  labId: string;
  labName: string;
  title: string;
  description: string;
  priority: SafetyCenterRequestPriority;
  dueDate: string;
  targetType?: string | null;
  targetId?: string | null;
}

type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string;
};

const VERIFICATION_REQUIREMENTS = [
  '기관명',
  '신청자 이름, 소속 부서, 직책',
  '신청자가 통합 안전관리센터를 개설하거나 운영할 권한이 있다는 내용',
  '요청하는 센터명 또는 서비스 이용 목적',
  '기관 도메인 또는 공식 홈페이지',
  '발행일',
  '부서장/기관 담당자/안전관리 책임자 등의 이름, 서명, 직인, 또는 확인 가능한 연락처',
];

const DATASET_LABELS: Record<DatasetKey, string> = {
  risks: '위험 재고 목록',
  waste: '폐기 기록',
  audit: '감사 로그',
};

function normalizeInstitutionDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase();
}

function getCreateCenterErrorMessage(error: unknown): string {
  const err = error as SupabaseLikeError | null | undefined;
  const message = [err?.message, err?.details].filter(Boolean).join('\n');

  if (err?.code === 'PGRST202' || err?.code === '42883' || message.includes('Could not find the function')) {
    return '센터 개설 기능의 DB 마이그레이션이 아직 적용되지 않았습니다. Supabase 마이그레이션을 적용한 뒤 다시 시도해 주세요.';
  }

  if (message.includes('Bucket not found') || message.includes('safety-center-verifications')) {
    return '증빙 문서 저장소가 아직 준비되지 않았습니다. Supabase 마이그레이션과 Storage 버킷 설정을 확인해 주세요.';
  }

  if (err?.code === '42501') {
    return '센터 개설 요청을 처리할 권한이 없습니다. 다시 로그인한 뒤 시도해 주세요.';
  }

  if (err?.code === '22023') {
    return '기관명, 기관 도메인, 센터명을 모두 입력해 주세요.';
  }

  return '센터 개설 요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('ko-KR');
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function statusTone(status: SafetyCenterRequest['status']): string {
  if (status === 'resolved') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (status === 'submitted') return 'bg-blue-50 text-blue-700 border-blue-100';
  if (status === 'in_progress') return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function priorityTone(priority: SafetyCenterRequestPriority): string {
  if (priority === 'urgent') return 'bg-red-50 text-red-700 border-red-100';
  if (priority === 'high') return 'bg-orange-50 text-orange-700 border-orange-100';
  if (priority === 'low') return 'bg-slate-50 text-slate-500 border-slate-200';
  return 'bg-blue-50 text-blue-700 border-blue-100';
}

function linkStatusLabel(status: SafetyCenterLabCandidate['link_status']): string {
  if (status === 'approved') return '승인됨';
  if (status === 'requested') return '요청중';
  if (status === 'rejected') return '거절됨';
  if (status === 'revoked') return '철회됨';
  return '미연결';
}

function linkStatusTone(status: SafetyCenterLabCandidate['link_status']): string {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (status === 'requested') return 'bg-blue-50 text-blue-700 border-blue-100';
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-100';
  if (status === 'revoked') return 'bg-slate-100 text-slate-600 border-slate-200';
  return 'bg-white text-slate-500 border-slate-200';
}

function riskFlagTone(flag: SafetyCenterRiskFlag): string {
  if (flag === 'hazard_special_high') return 'bg-red-50 text-red-700 border-red-100';
  if (flag.startsWith('hazard_')) return 'bg-orange-50 text-orange-700 border-orange-100';
  if (flag === 'hazard') return 'bg-red-50 text-red-700 border-red-100';
  if (flag === 'expired') return 'bg-rose-50 text-rose-700 border-rose-100';
  if (flag === 'expiring') return 'bg-amber-50 text-amber-700 border-amber-100';
  if (flag === 'missing_cas') return 'bg-violet-50 text-violet-700 border-violet-100';
  if (flag === 'ghs_data_review') return 'bg-violet-50 text-violet-700 border-violet-100';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function sanitizeCell(value: unknown): string {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function MetricCard({
  label,
  value,
  Icon,
  tone,
}: {
  label: string;
  value: string | number;
  Icon: typeof ShieldCheck;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-normal text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-medium text-slate-950 dark:text-white">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
      <p className="text-base font-medium text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{body}</p>
    </div>
  );
}

export function SafetyCenterWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSection = getSafetyCenterSectionFromPath(location.pathname);

  const [centers, setCenters] = useState<SafetyCenter[]>([]);
  const [activeCenterId, setActiveCenterId] = useState<string>('');
  const [candidates, setCandidates] = useState<SafetyCenterLabCandidate[]>([]);
  const [riskItems, setRiskItems] = useState<SafetyCenterRiskItem[]>([]);
  const [wasteLogs, setWasteLogs] = useState<SafetyCenterWasteLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<SafetyCenterAuditLog[]>([]);
  const [requests, setRequests] = useState<SafetyCenterRequest[]>([]);
  const [members, setMembers] = useState<SafetyCenterMember[]>([]);
  const [exportLogs, setExportLogs] = useState<SafetyCenterExportLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestDraft, setRequestDraft] = useState<RequestDraft | null>(null);

  const activeCenter = centers.find((center) => center.id === activeCenterId) ?? centers[0] ?? null;
  const canManageCenter = activeCenter?.member_role === 'owner' || activeCenter?.member_role === 'manager';
  const canExport = canManageCenter;

  const loadCenters = useCallback(async () => {
    const nextCenters = await safetyCenterService.getMyCenters();
    setCenters(nextCenters);
    setActiveCenterId((current) => {
      if (current && nextCenters.some((center) => center.id === current)) return current;
      return nextCenters[0]?.id ?? '';
    });
  }, []);

  const loadCenterData = useCallback(async (center: SafetyCenter | null) => {
    if (!center) {
      setCandidates([]);
      setRiskItems([]);
      setWasteLogs([]);
      setAuditLogs([]);
      setRequests([]);
      setMembers([]);
      setExportLogs([]);
      return;
    }

    const [nextMembers, nextExportLogs] = await Promise.all([
      safetyCenterService.getCenterMembers(center.id),
      safetyCenterService.getExportLogs(center.id),
    ]);
    setMembers(nextMembers);
    setExportLogs(nextExportLogs);

    if (center.status !== 'approved') {
      setCandidates([]);
      setRiskItems([]);
      setWasteLogs([]);
      setAuditLogs([]);
      setRequests([]);
      return;
    }

    const [nextCandidates, nextRiskItems, nextWasteLogs, nextAuditLogs, nextRequests] = await Promise.all([
      safetyCenterService.getLabCandidates(center.id),
      safetyCenterService.getRiskItems(center.id),
      safetyCenterService.getWasteLogs(center.id),
      safetyCenterService.getAuditLogs(center.id, 120),
      safetyCenterService.getRequests(center.id),
    ]);

    setCandidates(nextCandidates);
    setRiskItems(nextRiskItems);
    setWasteLogs(nextWasteLogs);
    setAuditLogs(nextAuditLogs);
    setRequests(nextRequests);
  }, []);

  const reloadAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await loadCenters();
    } catch (err) {
      console.error(err);
      setError('통합센터 정보를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [loadCenters]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    setError(null);
    setIsLoading(true);
    loadCenterData(activeCenter)
      .catch((err) => {
        console.error(err);
        setError('센터 데이터를 불러오지 못했습니다.');
      })
      .finally(() => setIsLoading(false));
  }, [activeCenter, loadCenterData]);

  const dashboardSummary = useMemo(() => (
    buildSafetyCenterDashboardSummary({ candidates, riskItems, requests, wasteLogs })
  ), [candidates, requests, riskItems, wasteLogs]);

  const approvedLabs = useMemo(() => (
    candidates.filter((candidate) => candidate.link_status === 'approved')
  ), [candidates]);

  const openRequestDraft = useCallback((draft: RequestDraft) => {
    setRequestDraft(draft);
  }, []);

  const createRequest = useCallback(async () => {
    if (!activeCenter || !requestDraft) return;
    setIsActionLoading(true);
    setError(null);
    try {
      await safetyCenterService.createRequest({
        centerId: activeCenter.id,
        labId: requestDraft.labId,
        title: requestDraft.title,
        description: requestDraft.description,
        priority: requestDraft.priority,
        dueDate: requestDraft.dueDate || null,
        targetType: requestDraft.targetType,
        targetId: requestDraft.targetId,
      });
      setRequestDraft(null);
      await loadCenterData(activeCenter);
      navigate('/center/requests');
    } catch (err) {
      console.error(err);
      setError('점검 요청을 만들지 못했습니다.');
    } finally {
      setIsActionLoading(false);
    }
  }, [activeCenter, loadCenterData, navigate, requestDraft]);

  const buildExportRows = useCallback((datasets: DatasetKey[], options: ExportOptions = {}) => {
    const rows: Array<Record<string, unknown>> = [];
    const selectedLabIds = new Set(options.labIds ?? []);
    const includesLab = (labId: string) => selectedLabIds.size === 0 || selectedLabIds.has(labId);
    const includesDate = (value?: string | null) => {
      if (!value) return true;
      const time = new Date(value).getTime();
      if (options.dateFrom && time < new Date(`${options.dateFrom}T00:00:00`).getTime()) return false;
      if (options.dateTo && time > new Date(`${options.dateTo}T23:59:59`).getTime()) return false;
      return true;
    };

    if (datasets.includes('risks')) {
      riskItems.filter((item) => includesLab(item.lab_id) && includesDate(item.updated_at ?? item.created_at)).forEach((item) => {
        const assessment = assessRiskItem(item);
        rows.push({
          Dataset: DATASET_LABELS.risks,
          Lab: item.lab_name,
          Name: item.inventory_name,
          CAS: item.cas_number ?? '',
          Flags: assessment.flags.map(getRiskFlagLabel).join(', '),
          Location: item.cabinet_name ?? item.storage_location_name ?? '-',
          ManufacturerDateType: getManufacturerDateTypeLabel(item.manufacturer_date_type),
          ManufacturerDate: getTrackedManufacturerDate(item) ?? '',
          ReceivedDate: item.received_date ?? '',
          OpenedDate: item.opened_date ?? '',
          Remaining: item.remaining_percent ?? '',
          Source: item.source_type,
        });
      });
    }

    if (datasets.includes('waste')) {
      wasteLogs.filter((log) => includesLab(log.lab_id) && includesDate(log.created_at)).forEach((log) => {
        rows.push({
          Dataset: DATASET_LABELS.waste,
          Lab: log.lab_name,
          CreatedAt: formatDateTime(log.created_at),
          Category: log.disposal_category,
          Handler: log.handler_name ?? '',
          VolumeMl: log.total_volume_ml ?? '',
          Memo: log.memo ?? '',
        });
      });
    }

    if (datasets.includes('audit')) {
      auditLogs.filter((log) => includesLab(log.lab_id) && includesDate(log.created_at)).forEach((log) => {
        rows.push({
          Dataset: DATASET_LABELS.audit,
          Lab: log.lab_name,
          CreatedAt: formatDateTime(log.created_at),
          Actor: log.actor_name ?? '',
          Entity: log.entity_type,
          Action: log.action,
          Location: log.location_context ?? '',
          Source: log.source ?? '',
        });
      });
    }

    return rows.map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, sanitizeCell(value)])
    ));
  }, [auditLogs, riskItems, wasteLogs]);

  const exportDatasets = useCallback(async (
    format: SafetyCenterExportFormat,
    datasets: DatasetKey[],
    options: ExportOptions = {}
  ) => {
    if (!activeCenter || datasets.length === 0) return;
    setIsActionLoading(true);
    setError(null);
    try {
      const exportableLabIds = approvedLabs
        .filter((lab) => lab.link_scope?.includes('exports'))
        .map((lab) => lab.lab_id);
      const requestedLabIds = options.labIds?.length ? options.labIds : exportableLabIds;
      const exportLabIds = requestedLabIds.filter((labId) => exportableLabIds.includes(labId));

      if (exportLabIds.length === 0) {
        setError('내보내기 권한이 있는 연구실이 없습니다.');
        return;
      }

      const exportOptions = { ...options, labIds: exportLabIds };
      const rows = buildExportRows(datasets, exportOptions);
      const timestamp = new Date().toISOString().slice(0, 10);

      if (format === 'xlsx') {
        const { downloadRowsAsXlsx } = await import('../../utils/excelFiles');
        await downloadRowsAsXlsx(rows, 'Safety Center', `safety_center_${timestamp}.xlsx`);
      } else {
        const html2pdf = (await import('html2pdf.js')).default;
        const container = document.createElement('div');
        container.style.padding = '24px';
        container.style.fontFamily = 'system-ui, sans-serif';
        container.innerHTML = `
          <h1 style="font-size:20px;margin:0 0 8px;">${escapeHtml(activeCenter.center_name)} 안전 리포트</h1>
          <p style="font-size:12px;color:#64748b;margin:0 0 20px;">${escapeHtml(formatDateTime(new Date().toISOString()))}</p>
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead>
              <tr>${Object.keys(rows[0] ?? { Notice: 'No rows' }).map((header) => `<th style="border:1px solid #cbd5e1;padding:6px;text-align:left;background:#f8fafc;">${escapeHtml(header)}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows.map((row) => `<tr>${Object.values(row).map((value) => `<td style="border:1px solid #e2e8f0;padding:6px;">${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        `;
        await html2pdf().set({
          margin: 0.4,
          filename: `safety_center_${timestamp}.pdf`,
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' },
        }).from(container).save();
      }

      await safetyCenterService.logExport({
        centerId: activeCenter.id,
        format,
        datasets,
        labIds: exportLabIds,
        filters: { section: activeSection, dateFrom: exportOptions.dateFrom ?? null, dateTo: exportOptions.dateTo ?? null },
        rowCount: rows.length,
      });
      await loadCenterData(activeCenter);
    } catch (err) {
      console.error(err);
      setError('내보내기를 완료하지 못했습니다.');
    } finally {
      setIsActionLoading(false);
    }
  }, [activeCenter, activeSection, approvedLabs, buildExportRows, loadCenterData]);

  if (isLoading && centers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-normal text-slate-500 dark:text-slate-400">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              통합 안전관리센터
            </div>
            <h1 className="mt-1 text-2xl font-medium tracking-tight text-slate-950 dark:text-white">
              {activeCenter?.center_name ?? '센터 개설'}
            </h1>
            {activeCenter && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {activeCenter.institution_name} · {activeCenter.institution_domain} · {activeCenter.status === 'approved' ? '승인됨' : activeCenter.status === 'pending' ? '승인 대기' : '거절됨'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {centers.length > 1 && (
              <select
                value={activeCenter?.id ?? ''}
                onChange={(event) => setActiveCenterId(event.target.value)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {centers.map((center) => (
                  <option key={center.id} value={center.id}>{center.center_name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => void loadCenterData(activeCenter)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-4 w-4" />
              새로고침
            </button>
          </div>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-normal text-red-700">
            {error}
          </div>
        )}

        {!activeCenter ? (
          <CreateCenterPanel onCreated={() => void reloadAll()} />
        ) : activeCenter.status !== 'approved' ? (
          <PendingCenterPanel center={activeCenter} members={members} />
        ) : activeSection === 'labs' ? (
          <LabsPage
            candidates={candidates}
            canManage={canManageCenter}
            isActionLoading={isActionLoading}
            onSearch={async (query) => {
              setCandidates(await safetyCenterService.getLabCandidates(activeCenter.id, query));
            }}
            onRequestLink={async (labId) => {
              setIsActionLoading(true);
              try {
                await safetyCenterService.requestLabLink(activeCenter.id, labId);
                await loadCenterData(activeCenter);
              } catch (err) {
                console.error(err);
                setError('연구실 연결 요청을 보내지 못했습니다.');
              } finally {
                setIsActionLoading(false);
              }
            }}
          />
        ) : activeSection === 'risks' ? (
          <RisksPage
            items={riskItems}
            approvedLabs={approvedLabs}
            canCreateRequest={canManageCenter}
            canExport={canExport}
            onOpenRequest={openRequestDraft}
            onExport={(format) => void exportDatasets(format, ['risks'])}
          />
        ) : activeSection === 'requests' ? (
          <RequestsPage
            requests={requests}
            approvedLabs={approvedLabs}
            canCreate={canManageCenter}
            onOpenRequest={openRequestDraft}
          />
        ) : activeSection === 'exports' ? (
          <ExportsPage
            approvedLabs={approvedLabs}
            canExport={canExport}
            isActionLoading={isActionLoading}
            exportLogs={exportLogs}
            onExport={(format, datasets, options) => void exportDatasets(format, datasets, options)}
          />
        ) : activeSection === 'settings' ? (
          <SettingsPage
            center={activeCenter}
            members={members}
            exportLogs={exportLogs}
            canManage={canManageCenter}
          />
        ) : (
          <DashboardPage
            summary={dashboardSummary}
            riskItems={riskItems}
            requests={requests}
            auditLogs={auditLogs}
            canCreateRequest={canManageCenter}
            onOpenRequest={openRequestDraft}
          />
        )}
      </main>

      {requestDraft && (
        <RequestDraftModal
          draft={requestDraft}
          isLoading={isActionLoading}
          onChange={setRequestDraft}
          onClose={() => setRequestDraft(null)}
          onSubmit={createRequest}
        />
      )}
    </div>
  );
}

function CreateCenterPanel({ onCreated }: { onCreated: () => void }) {
  const [institutionName, setInstitutionName] = useState('');
  const [institutionDomain, setInstitutionDomain] = useState('');
  const [centerName, setCenterName] = useState('');
  const [verificationDocument, setVerificationDocument] = useState<File | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerificationDocumentChange = (file: File | null) => {
    setError(null);

    if (!file) {
      setVerificationDocument(null);
      return;
    }

    const validationError = validateSafetyCenterVerificationDocument(file);
    if (validationError) {
      setVerificationDocument(null);
      setError(validationError);
      return;
    }

    setVerificationDocument(file);
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);
    const normalizedInstitutionDomain = normalizeInstitutionDomain(institutionDomain);

    if (!verificationDocument) {
      setError('관장/부서장 명의의 센터 개설 요청 공문 또는 담당자 지정서를 업로드해 주세요.');
      setIsCreating(false);
      return;
    }

    try {
      await safetyCenterService.createCenter({
        institutionName: institutionName.trim(),
        institutionDomain: normalizedInstitutionDomain,
        centerName: centerName.trim(),
        verificationDocument,
      });
      onCreated();
    } catch (err) {
      console.error(err);
      setError(getCreateCenterErrorMessage(err));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <Building2 className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-xl font-medium text-slate-950 dark:text-white">기관 안전관리센터 개설</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            기관 도메인과 센터 정보를 제출하면 버릴랩 운영자 승인 후 같은 기관 소속으로 승인된 연구실과 연결할 수 있습니다.
          </p>
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-normal text-red-700">{error}</div>}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <label className="text-sm font-normal text-slate-700 dark:text-slate-200">
          기관명
          <input
            value={institutionName}
            onChange={(event) => setInstitutionName(event.target.value)}
            placeholder="예: 릴랩대학교"
            className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        <label className="text-sm font-normal text-slate-700 dark:text-slate-200">
          기관 도메인
          <input
            value={institutionDomain}
            onChange={(event) => setInstitutionDomain(event.target.value)}
            placeholder="예: rillab.ac.kr"
            className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        <label className="text-sm font-normal text-slate-700 dark:text-slate-200">
          센터명
          <input
            value={centerName}
            onChange={(event) => setCenterName(event.target.value)}
            placeholder="예: 릴랩대학교 안전관리센터"
            className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <h3 className="text-sm font-medium text-slate-950 dark:text-white">승인 증빙 문서</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              관장/부서장 명의의 센터 개설 요청 공문 또는 담당자 지정서를 업로드해 주세요. 기관별 양식은 달라도 괜찮지만 아래 항목이 확인되어야 합니다.
            </p>
            <ul className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-2">
              {VERIFICATION_REQUIREMENTS.map((requirement) => (
                <li key={requirement} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{requirement}</span>
                </li>
              ))}
            </ul>
          </div>

          <label className="flex min-h-44 cursor-pointer flex-col justify-center rounded-lg border border-dashed border-slate-300 px-4 py-5 text-center transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-slate-700 dark:hover:border-blue-500/60 dark:hover:bg-blue-950/20">
            <input
              type="file"
              accept={SAFETY_CENTER_VERIFICATION_ACCEPT}
              onChange={(event) => handleVerificationDocumentChange(event.target.files?.[0] ?? null)}
              className="sr-only"
            />
            <FileText className="mx-auto h-8 w-8 text-blue-600" />
            <span className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
              {verificationDocument ? verificationDocument.name : '증빙 문서 선택'}
            </span>
            <span className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {verificationDocument
                ? `${formatFileSize(verificationDocument.size)} · 다시 선택하려면 클릭`
                : 'PDF, HWP, HWPX, DOC, DOCX, PNG, JPG · 최대 10MB'}
            </span>
          </label>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={handleCreate}
          disabled={isCreating || !institutionName.trim() || !institutionDomain.trim() || !centerName.trim() || !verificationDocument}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
          승인 요청 보내기
        </button>
      </div>
    </div>
  );
}

function PendingCenterPanel({ center, members }: { center: SafetyCenter; members: SafetyCenterMember[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-lg border border-amber-100 bg-amber-50 p-6 text-amber-900">
        <div className="flex items-start gap-4">
          <Clock className="mt-1 h-6 w-6" />
          <div>
            <h2 className="text-xl font-medium">운영자 승인 대기 중입니다</h2>
            <p className="mt-2 text-sm leading-6">
              {center.center_name}은 기관 승인 전 상태입니다. 승인 전에는 연구실 후보, 위험 상세, 내보내기 데이터가 열리지 않습니다.
            </p>
          </div>
        </div>
      </div>
      <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">센터 기본 정보</h3>
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><span className="text-slate-500">기관</span><span className="font-normal">{center.institution_name}</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">도메인</span><span className="font-normal">{center.institution_domain}</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">멤버</span><span className="font-normal">{members.length}명</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">요청일</span><span className="font-normal">{formatDate(center.created_at)}</span></div>
        </div>
      </aside>
    </div>
  );
}

function DashboardPage({
  summary,
  riskItems,
  requests,
  auditLogs,
  canCreateRequest,
  onOpenRequest,
}: {
  summary: ReturnType<typeof buildSafetyCenterDashboardSummary>;
  riskItems: SafetyCenterRiskItem[];
  requests: SafetyCenterRequest[];
  auditLogs: SafetyCenterAuditLog[];
  canCreateRequest: boolean;
  onOpenRequest: (draft: RequestDraft) => void;
}) {
  const topRisks = [...riskItems]
    .map((item) => ({ item, assessment: assessRiskItem(item) }))
    .sort((left, right) => right.assessment.score - left.assessment.score)
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="연결 연구실" value={summary.approvedLabCount} Icon={Building2} tone="bg-blue-50 text-blue-600" />
        <MetricCard label="고위험 재고" value={summary.highRiskCount} Icon={AlertTriangle} tone="bg-red-50 text-red-600" />
        <MetricCard label="만료/임박" value={summary.expiredOrExpiringCount} Icon={CalendarDays} tone="bg-amber-50 text-amber-600" />
        <MetricCard label="미응답 요청" value={summary.openRequestCount} Icon={MessageSquare} tone="bg-violet-50 text-violet-600" />
        <MetricCard label="최근 폐기" value={summary.recentWasteCount} Icon={Archive} tone="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="관리 위험 품목" value={summary.hazardCount} Icon={ShieldCheck} tone="bg-orange-50 text-orange-600" />
        <MetricCard label="인화성" value={summary.flammableCount} Icon={AlertTriangle} tone="bg-orange-50 text-orange-600" />
        <MetricCard label="부식성" value={summary.corrosiveCount} Icon={AlertTriangle} tone="bg-amber-50 text-amber-600" />
        <MetricCard label="독성" value={summary.toxicCount} Icon={AlertTriangle} tone="bg-red-50 text-red-600" />
        <MetricCard label="기타 관리 위험" value={summary.otherManagedCount} Icon={ShieldCheck} tone="bg-slate-50 text-slate-600" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <h2 className="text-base font-medium text-slate-950 dark:text-white">연구실별 위험 heatmap</h2>
              <p className="mt-1 text-xs text-slate-500">승인된 연구실의 위험 신호를 같은 기준으로 비교합니다.</p>
            </div>
          </div>
          {summary.labSummaries.length === 0 ? (
            <div className="p-5">
              <EmptyPanel title="연결된 연구실 데이터가 없습니다" body="연구실 연결 승인 후 통합 위험 현황이 표시됩니다." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">연구실</th>
                    <th className="px-4 py-3">위험 점수</th>
                    <th className="px-4 py-3">부담량</th>
                    <th className="px-4 py-3">고위험</th>
                    <th className="px-4 py-3">관리 위험</th>
                    <th className="px-4 py-3">만료</th>
                    <th className="px-4 py-3">CAS 누락</th>
                    <th className="px-4 py-3 text-right">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {summary.labSummaries.map((lab) => (
                    <tr key={lab.labId} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <td className="px-4 py-3 font-normal text-slate-900 dark:text-slate-100">{lab.labName}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.min(100, lab.riskScore)}%` }} />
                          </div>
                          <span className="font-medium">{lab.evaluationStatus === 'no_items' ? '-' : lab.riskScore}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {lab.evaluationStatus === 'no_items' ? (
                          <div className="text-xs text-slate-400">데이터 없음</div>
                        ) : (
                          <>
                            <div className="text-xs text-slate-500">부담량 {lab.riskBurden}</div>
                            <div className="text-[11px] text-slate-400">평균 {lab.averageRiskScore} · 상위5 {lab.topFiveAverage}</div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3">{lab.highRiskCount}</td>
                      <td className="px-4 py-3">{lab.hazardCount}</td>
                      <td className="px-4 py-3">{lab.expiredCount + lab.expiringCount}</td>
                      <td className="px-4 py-3">{lab.missingCasCount}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={!canCreateRequest}
                          onClick={() => onOpenRequest({
                            labId: lab.labId,
                            labName: lab.labName,
                            title: `${lab.labName} 위험 재고 확인 요청`,
                            description: `고위험 ${lab.highRiskCount}건, 만료/임박 ${lab.expiredCount + lab.expiringCount}건을 확인해 주세요.`,
                            priority: lab.riskScore >= 60 || lab.highRiskCount > 0 ? 'high' : 'normal',
                            dueDate: '',
                          })}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" />
                          조치 요청
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-medium text-slate-950 dark:text-white">우선 확인 큐</h2>
            <div className="mt-4 space-y-3">
              {topRisks.length === 0 ? (
                <p className="text-sm text-slate-500">현재 표시할 위험 항목이 없습니다.</p>
              ) : topRisks.map(({ item, assessment }) => (
                <div key={item.item_id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.inventory_name}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.lab_name} · {item.cabinet_name ?? item.storage_location_name ?? '-'}</p>
                    </div>
                    <span className="text-xs font-medium text-red-600">{assessment.score}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {assessment.flags.filter((flag) => flag !== 'hazard').map((flag) => (
                      <span key={flag} className={`rounded border px-2 py-0.5 text-[11px] font-medium ${riskFlagTone(flag)}`}>
                        {getRiskFlagLabel(flag)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-medium text-slate-950 dark:text-white">최근 감사 이벤트</h2>
            <div className="mt-4 space-y-3">
              {auditLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-sm font-normal text-slate-800 dark:text-slate-100">{log.lab_name} · {log.entity_type}</p>
                  <p className="mt-1 text-xs text-slate-500">{log.action} · {log.actor_name ?? '알 수 없음'} · {formatDateTime(log.created_at)}</p>
                </div>
              ))}
              {auditLogs.length === 0 && <p className="text-sm text-slate-500">감사 이벤트가 없습니다.</p>}
            </div>
          </section>
        </aside>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium text-slate-950 dark:text-white">진행 중인 점검 요청</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {requests.filter((request) => request.status !== 'resolved').slice(0, 6).map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
          {requests.filter((request) => request.status !== 'resolved').length === 0 && (
            <p className="text-sm text-slate-500">미해결 요청이 없습니다.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function LabsPage({
  candidates,
  canManage,
  isActionLoading,
  onSearch,
  onRequestLink,
}: {
  candidates: SafetyCenterLabCandidate[];
  canManage: boolean;
  isActionLoading: boolean;
  onSearch: (query: string) => Promise<void>;
  onRequestLink: (labId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const selectedLab = candidates[0] ?? null;
  const approvedCount = candidates.filter((candidate) => candidate.link_status === 'approved').length;
  const requestedCount = candidates.filter((candidate) => candidate.link_status === 'requested').length;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium text-slate-950 dark:text-white">연구실 연결/관리</h2>
              <p className="mt-1 text-xs text-slate-500">기관 소속 연구실만 후보로 표시하고, 연구실 admin 승인 후 상세 데이터가 열립니다.</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-medium">
              <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">승인 {approvedCount}</span>
              <span className="rounded-lg bg-blue-50 px-3 py-2 text-blue-700">요청 {requestedCount}</span>
              <span className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">후보 {candidates.length}</span>
            </div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onSearch(query);
            }}
            className="mt-4 flex gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="연구실명, 분야 검색"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-normal outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <button className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white">검색</button>
          </form>
        </div>

        {candidates.length === 0 ? (
          <div className="p-5">
            <EmptyPanel title="기관 소속 연구실 후보가 없습니다" body="연구실 설정의 기관명이 센터 기관명과 일치해야 후보로 표시됩니다." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">연구실명</th>
                  <th className="px-4 py-3">소속/분야</th>
                  <th className="px-4 py-3">연결 상태</th>
                  <th className="px-4 py-3">공개 범위</th>
                  <th className="px-4 py-3">최근 업데이트</th>
                  <th className="px-4 py-3 text-right">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {candidates.map((candidate) => (
                  <tr key={candidate.lab_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3 font-normal text-slate-900 dark:text-slate-100">{candidate.lab_name}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {candidate.institution_name ?? '-'} · {candidate.research_field ?? candidate.institution_type ?? '분야 미입력'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded border px-2 py-1 text-xs font-medium ${linkStatusTone(candidate.link_status)}`}>
                        {linkStatusLabel(candidate.link_status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{(candidate.link_scope ?? ['summary']).join(', ')}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(candidate.responded_at ?? candidate.requested_at ?? candidate.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {candidate.link_status === 'approved' ? (
                        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          연결됨
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!canManage || isActionLoading || candidate.link_status === 'requested'}
                          onClick={() => onRequestLink(candidate.lab_id)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                        >
                          {isActionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          {candidate.link_status === 'requested' ? '요청중' : '연결 요청'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-base font-medium text-slate-950 dark:text-white">연결 원칙</h3>
          <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p className="flex gap-2"><LockKeyhole className="mt-0.5 h-4 w-4 text-slate-400" />기관명이 일치하는 연구실만 후보로 노출됩니다.</p>
            <p className="flex gap-2"><Users className="mt-0.5 h-4 w-4 text-slate-400" />연구실 admin 승인 전에는 상세 데이터가 열리지 않습니다.</p>
            <p className="flex gap-2"><Layers3 className="mt-0.5 h-4 w-4 text-slate-400" />V1 공개 범위는 요약, 위험 상세, 내보내기입니다.</p>
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-base font-medium text-slate-950 dark:text-white">선택 연구실</h3>
          {selectedLab ? (
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><span className="text-slate-500">연구실</span><span className="text-right font-normal">{selectedLab.lab_name}</span></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">상태</span><span className="font-normal">{linkStatusLabel(selectedLab.link_status)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">분야</span><span className="text-right font-normal">{selectedLab.research_field ?? '-'}</span></div>
              <div className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                승인 후 센터는 원본 데이터를 수정하지 않고 위험 신호 조회, 점검 요청, 내보내기만 수행합니다.
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">후보 연구실이 없습니다.</p>
          )}
        </section>
      </aside>
    </div>
  );
}

function RisksPage({
  items,
  approvedLabs,
  canCreateRequest,
  canExport,
  onOpenRequest,
  onExport,
}: {
  items: SafetyCenterRiskItem[];
  approvedLabs: SafetyCenterLabCandidate[];
  canCreateRequest: boolean;
  canExport: boolean;
  onOpenRequest: (draft: RequestDraft) => void;
  onExport: (format: SafetyCenterExportFormat) => void;
}) {
  const [labId, setLabId] = useState('all');
  const [riskFlag, setRiskFlag] = useState('all');
  const [casState, setCasState] = useState('all');
  const [expiryState, setExpiryState] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filteredItems = useMemo(() => filterRiskItems({
    items,
    labId,
    riskFlag,
    casState,
    expiryState,
    query,
  }), [casState, expiryState, items, labId, query, riskFlag]);

  const selectedItem = filteredItems.find((item) => item.item_id === selectedId) ?? filteredItems[0] ?? null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium text-slate-950 dark:text-white">위험 상세</h2>
              <p className="mt-1 text-xs text-slate-500">고위험, 만료, CAS 누락, 잔량 부족 항목을 연구실별로 추적합니다.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canExport}
                onClick={() => onExport('xlsx')}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Excel
              </button>
              <button
                type="button"
                disabled={!canExport}
                onClick={() => onExport('pdf')}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <FileText className="h-4 w-4" />
                PDF
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-5">
            <select value={labId} onChange={(event) => setLabId(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950">
              <option value="all">모든 연구실</option>
              {approvedLabs.map((lab) => <option key={lab.lab_id} value={lab.lab_id}>{lab.lab_name}</option>)}
            </select>
            <select value={riskFlag} onChange={(event) => setRiskFlag(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950">
              <option value="all">모든 위험</option>
              <option value="hazard">관리 위험 전체</option>
              <option value="hazard_special_high">특수 고위험</option>
              <option value="hazard_flammable">인화성</option>
              <option value="hazard_corrosive">부식성</option>
              <option value="hazard_toxic">독성</option>
              <option value="hazard_other_managed">기타 관리 위험</option>
              <option value="expired">만료/긴급</option>
              <option value="expiring">만료 임박</option>
              <option value="missing_cas">CAS 누락</option>
              <option value="low_remaining">잔량 부족</option>
            </select>
            <select value={casState} onChange={(event) => setCasState(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950">
              <option value="all">CAS 전체</option>
              <option value="missing">CAS 누락</option>
              <option value="present">CAS 있음</option>
            </select>
            <select value={expiryState} onChange={(event) => setExpiryState(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950">
              <option value="all">제조사 날짜 전체</option>
              <option value="expired">만료</option>
              <option value="warning">임박</option>
              <option value="none">미입력</option>
            </select>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="시약명, CAS, 위치 검색" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950" />
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="p-5">
            <EmptyPanel title="조건에 맞는 위험 항목이 없습니다" body="필터를 조정하거나 연구실 연결 상태를 확인해 주세요." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-3">연구실</th>
                  <th className="px-3 py-3">시약명</th>
                  <th className="px-3 py-3">CAS</th>
                  <th className="px-3 py-3">위험 신호</th>
                  <th className="px-3 py-3">보관 위치</th>
                  <th className="px-3 py-3">제조사 날짜</th>
                  <th className="px-3 py-3 text-right">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredItems.map((item) => {
                  const assessment = assessRiskItem(item);
                  const isSelected = selectedItem?.item_id === item.item_id;
                  return (
                    <tr
                      key={item.item_id}
                      onClick={() => setSelectedId(item.item_id)}
                      className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 ${isSelected ? 'bg-blue-50/60 dark:bg-blue-950/20' : ''}`}
                    >
                      <td className="px-3 py-3 text-xs font-normal text-slate-600 dark:text-slate-300">{item.lab_name}</td>
                      <td className="px-3 py-3 font-normal text-slate-900 dark:text-slate-100">{item.inventory_name}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">{item.cas_number || '-'}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {assessment.flags.map((flag) => (
                            <span key={flag} className={`rounded border px-2 py-0.5 text-[11px] font-medium ${riskFlagTone(flag)}`}>{getRiskFlagLabel(flag)}</span>
                          ))}
                          {assessment.flags.length === 0 && <span className="text-xs text-slate-400">낮음</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">{item.cabinet_name ?? item.storage_location_name ?? '-'}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {getTrackedManufacturerDate(item)
                          ? `${getManufacturerDateTypeLabel(item.manufacturer_date_type)}: ${getTrackedManufacturerDate(item)}`
                          : '-'}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          disabled={!canCreateRequest}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenRequest({
                              labId: item.lab_id,
                              labName: item.lab_name,
                              title: `${item.inventory_name} 확인 요청`,
                              description: `${assessment.flags.map(getRiskFlagLabel).join(', ') || '위험 신호'} 항목입니다. 보관 상태와 처리 계획을 확인해 주세요.`,
                              priority: assessment.riskBand === 'critical' || assessment.riskBand === 'high' ? 'high' : 'normal',
                              dueDate: '',
                              targetType: item.source_type,
                              targetId: item.item_id,
                            });
                          }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" />
                          요청
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RiskDetailPanel item={selectedItem} canCreateRequest={canCreateRequest} onOpenRequest={onOpenRequest} />
    </div>
  );
}

function RiskDetailPanel({
  item,
  canCreateRequest,
  onOpenRequest,
}: {
  item: SafetyCenterRiskItem | null;
  canCreateRequest: boolean;
  onOpenRequest: (draft: RequestDraft) => void;
}) {
  if (!item) {
    return (
      <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <EmptyPanel title="선택된 항목이 없습니다" body="왼쪽 표에서 위험 항목을 선택하세요." />
      </aside>
    );
  }

  const assessment = assessRiskItem(item);

  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium text-slate-950 dark:text-white">{item.inventory_name}</h3>
          <p className="mt-1 text-sm text-slate-500">{item.lab_name}</p>
        </div>
        <span className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">점수 {assessment.score}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {assessment.flags.filter((flag) => flag !== 'hazard').map((flag) => (
          <span key={flag} className={`rounded border px-2 py-0.5 text-xs font-medium ${riskFlagTone(flag)}`}>
            {getRiskFlagLabel(flag)}
          </span>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px]">
        <div className="rounded-lg bg-red-50 p-2 text-red-700"><div>위험성</div><strong>{assessment.hazardScore}</strong></div>
        <div className="rounded-lg bg-amber-50 p-2 text-amber-700"><div>운영상태</div><strong>{assessment.operationalScore}</strong></div>
        <div className="rounded-lg bg-violet-50 p-2 text-violet-700"><div>데이터 보완</div><strong>{assessment.dataQualityScore}</strong></div>
      </div>
      <div className="mt-5 space-y-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
        <div className="flex justify-between gap-4"><span className="text-slate-500">제조사 날짜 유형</span><span className="font-normal">{getManufacturerDateTypeLabel(item.manufacturer_date_type)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">제조사 날짜</span><span className="font-normal">{getTrackedManufacturerDate(item) || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">입고일</span><span className="font-normal">{item.received_date || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">개봉일</span><span className="font-normal">{item.opened_date || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">CAS</span><span className="font-normal">{item.cas_number || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">브랜드</span><span className="font-normal">{item.brand || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">규격</span><span className="font-normal">{item.capacity || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">위치</span><span className="text-right font-normal">{item.cabinet_name ?? item.storage_location_name ?? '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">잔량</span><span className="font-normal">{item.remaining_percent ?? 100}%</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">GHS 상태</span><span className="font-normal">{item.ghs_data_status ?? '미조회'}</span></div>
      </div>
      <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
        센터는 이 항목을 직접 수정하지 않습니다. 연구실에 확인 요청을 보내고 연구실이 보관 상태, CAS 보완, 폐기 계획을 회신합니다.
      </div>
      <button
        type="button"
        disabled={!canCreateRequest}
        onClick={() => onOpenRequest({
          labId: item.lab_id,
          labName: item.lab_name,
          title: `${item.inventory_name} 위험 항목 확인`,
          description: `${assessment.flags.map(getRiskFlagLabel).join(', ')} 신호가 있습니다. 보관/폐기 계획을 회신해 주세요.`,
          priority: assessment.riskBand === 'critical' || assessment.riskBand === 'high' ? 'high' : 'normal',
          dueDate: '',
          targetType: item.source_type,
          targetId: item.item_id,
        })}
        className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
      >
        <Send className="h-4 w-4" />
        점검 요청 만들기
      </button>
    </aside>
  );
}

function RequestsPage({
  requests,
  approvedLabs,
  canCreate,
  onOpenRequest,
}: {
  requests: SafetyCenterRequest[];
  approvedLabs: SafetyCenterLabCandidate[];
  canCreate: boolean;
  onOpenRequest: (draft: RequestDraft) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRequest = requests.find((request) => request.id === selectedId) ?? requests[0] ?? null;
  const columns: Array<{ status: SafetyCenterRequest['status']; label: string }> = [
    { status: 'open', label: '요청됨' },
    { status: 'in_progress', label: '처리 중' },
    { status: 'submitted', label: '제출됨' },
    { status: 'resolved', label: '완료' },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-slate-950 dark:text-white">점검 협업</h2>
            <p className="mt-1 text-xs text-slate-500">센터 요청과 연구실 응답 상태를 요청됨 → 처리 중 → 제출됨 → 완료 흐름으로 추적합니다.</p>
          </div>
          <button
            type="button"
            disabled={!canCreate || approvedLabs.length === 0}
            onClick={() => {
              const lab = approvedLabs[0];
              if (!lab) return;
              onOpenRequest({
                labId: lab.lab_id,
                labName: lab.lab_name,
                title: '월간 안전 점검 확인 요청',
                description: '위험 재고와 폐기 기록을 확인하고 특이사항을 회신해 주세요.',
                priority: 'normal',
                dueDate: '',
              });
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            새 요청
          </button>
        </div>

        {requests.length === 0 ? (
          <div className="mt-5">
            <EmptyPanel title="점검 요청이 없습니다" body="위험 상세 또는 연구실 화면에서 요청을 만들 수 있습니다." />
          </div>
        ) : (
          <div className="mt-5 grid gap-3 xl:grid-cols-4">
            {columns.map((column) => {
              const columnRequests = requests.filter((request) => request.status === column.status);
              return (
                <div key={column.status} className="min-h-[460px] rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">{column.label}</h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500 shadow-sm dark:bg-slate-900">{columnRequests.length}</span>
                  </div>
                  <div className="space-y-3">
                    {columnRequests.map((request) => (
                      <RequestCard
                        key={request.id}
                        request={request}
                        selected={selectedRequest?.id === request.id}
                        onClick={() => setSelectedId(request.id)}
                      />
                    ))}
                    {columnRequests.length === 0 && (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-xs font-normal text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                        해당 상태 요청 없음
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-base font-medium text-slate-950 dark:text-white">요청 상세</h3>
        {selectedRequest ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-950 dark:text-white">{selectedRequest.title}</p>
              <p className="mt-1 text-xs text-slate-500">{selectedRequest.lab_name}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={`rounded border px-2 py-1 text-xs font-medium ${priorityTone(selectedRequest.priority)}`}>{getPriorityLabel(selectedRequest.priority)}</span>
              <span className={`rounded border px-2 py-1 text-xs font-medium ${statusTone(selectedRequest.status)}`}>{getRequestStatusLabel(selectedRequest.status)}</span>
            </div>
            {selectedRequest.description && (
              <p className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                {selectedRequest.description}
              </p>
            )}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><span className="text-slate-500">마감일</span><span className="font-normal">{formatDate(selectedRequest.due_date)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">대상</span><span className="text-right font-normal">{selectedRequest.target_type ?? '-'}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">생성일</span><span className="text-right font-normal">{formatDateTime(selectedRequest.created_at)}</span></div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">선택된 요청이 없습니다.</p>
        )}
      </aside>
    </div>
  );
}

function RequestCard({
  request,
  selected = false,
  onClick,
}: {
  request: SafetyCenterRequest;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <article
      onClick={onClick}
      className={[
        'rounded-lg border bg-white p-4 shadow-sm transition-colors dark:bg-slate-900',
        onClick ? 'cursor-pointer hover:border-blue-200 hover:bg-blue-50/40' : '',
        selected ? 'border-blue-300 ring-2 ring-blue-100 dark:border-blue-700' : 'border-slate-200 dark:border-slate-800',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-950 dark:text-white">{request.title}</p>
          <p className="mt-1 text-xs text-slate-500">{request.lab_name} · {formatDateTime(request.created_at)}</p>
        </div>
        <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${priorityTone(request.priority)}`}>{getPriorityLabel(request.priority)}</span>
      </div>
      {request.description && <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{request.description}</p>}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className={`rounded border px-2 py-1 text-xs font-medium ${statusTone(request.status)}`}>{getRequestStatusLabel(request.status)}</span>
        <span className="text-xs text-slate-500">마감 {formatDate(request.due_date)}</span>
      </div>
    </article>
  );
}

function ExportsPage({
  approvedLabs,
  canExport,
  isActionLoading,
  exportLogs,
  onExport,
}: {
  approvedLabs: SafetyCenterLabCandidate[];
  canExport: boolean;
  isActionLoading: boolean;
  exportLogs: SafetyCenterExportLog[];
  onExport: (format: SafetyCenterExportFormat, datasets: DatasetKey[], options: ExportOptions) => void;
}) {
  const [format, setFormat] = useState<SafetyCenterExportFormat>('xlsx');
  const [datasets, setDatasets] = useState<DatasetKey[]>(['risks', 'waste', 'audit']);
  const [selectedLabIds, setSelectedLabIds] = useState<string[] | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const exportableLabs = useMemo(() => (
    approvedLabs.filter((lab) => lab.link_scope?.includes('exports'))
  ), [approvedLabs]);
  const exportableLabIds = useMemo(() => exportableLabs.map((lab) => lab.lab_id), [exportableLabs]);
  const visibleSelectedLabIds = useMemo(() => {
    if (selectedLabIds === null) return exportableLabIds;

    const validIds = new Set(exportableLabIds);
    return selectedLabIds.filter((id) => validIds.has(id));
  }, [exportableLabIds, selectedLabIds]);

  const toggleDataset = (dataset: DatasetKey) => {
    setDatasets((current) => (
      current.includes(dataset)
        ? current.filter((item) => item !== dataset)
        : [...current, dataset]
    ));
  };

  const toggleLab = (labId: string) => {
    setSelectedLabIds((current) => {
      const base = current ?? exportableLabIds;
      const validIds = new Set(exportableLabIds);
      const next = base.filter((id) => validIds.has(id));

      return next.includes(labId)
        ? next.filter((id) => id !== labId)
        : [...next, labId];
    });
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-medium text-slate-950 dark:text-white">데이터 내보내기</h2>
        <p className="mt-1 text-sm text-slate-500">승인된 연구실, 선택 기간, 데이터셋 범위만 파일로 생성하고 감사 이력에 남깁니다.</p>
        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">데이터셋</p>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {(Object.keys(DATASET_LABELS) as DatasetKey[]).map((dataset) => (
                <label key={dataset} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-3 text-sm font-normal dark:border-slate-800">
                  <span>{DATASET_LABELS[dataset]}</span>
                  <input
                    type="checkbox"
                    checked={datasets.includes(dataset)}
                    onChange={() => toggleDataset(dataset)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                </label>
              ))}
            </div>
            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">연구실 범위</p>
                <button
                  type="button"
                  onClick={() => setSelectedLabIds(exportableLabIds)}
                  className="text-xs font-medium text-blue-600"
                >
                  전체 선택
                </button>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {exportableLabs.map((lab) => (
                  <label key={lab.lab_id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal dark:border-slate-800">
                    <span className="truncate pr-3">{lab.lab_name}</span>
                    <input
                      type="checkbox"
                      checked={visibleSelectedLabIds.includes(lab.lab_id)}
                      onChange={() => toggleLab(lab.lab_id)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                  </label>
                ))}
                {exportableLabs.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-sm font-normal text-slate-400 dark:border-slate-800">
                    내보내기 공개 범위가 승인된 연구실이 없습니다.
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <label className="text-sm font-medium text-slate-800 dark:text-slate-100">
                시작일
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="text-sm font-medium text-slate-800 dark:text-slate-100">
                종료일
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">파일 형식</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormat('xlsx')}
                className={`flex h-24 flex-col items-center justify-center gap-2 rounded-lg border text-sm font-medium ${format === 'xlsx' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 dark:border-slate-800'}`}
              >
                <FileSpreadsheet className="h-6 w-6" />
                Excel
              </button>
              <button
                type="button"
                onClick={() => setFormat('pdf')}
                className={`flex h-24 flex-col items-center justify-center gap-2 rounded-lg border text-sm font-medium ${format === 'pdf' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 dark:border-slate-800'}`}
              >
                <FileText className="h-6 w-6" />
                PDF
              </button>
            </div>
            <button
              type="button"
              disabled={!canExport || isActionLoading || datasets.length === 0 || visibleSelectedLabIds.length === 0}
              onClick={() => onExport(format, datasets, { labIds: visibleSelectedLabIds, dateFrom, dateTo })}
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              {isActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              내보내기 실행
            </button>
          </div>
        </div>
      </section>

      <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-base font-medium text-slate-950 dark:text-white">내보내기 이력</h3>
        <div className="mt-4 space-y-3">
          {exportLogs.map((log) => (
            <div key={log.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium uppercase text-slate-900 dark:text-slate-100">{log.format}</span>
                <span className="text-xs text-slate-500">{formatDateTime(log.created_at)}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{log.datasets.map((dataset) => DATASET_LABELS[dataset as DatasetKey] ?? dataset).join(', ')}</p>
              <p className="mt-1 text-xs font-normal text-slate-700 dark:text-slate-300">{log.row_count}행 · {log.lab_ids.length}개 연구실</p>
            </div>
          ))}
          {exportLogs.length === 0 && <p className="text-sm text-slate-500">아직 내보내기 이력이 없습니다.</p>}
        </div>
      </aside>
    </div>
  );
}

function SettingsPage({
  center,
  members,
  exportLogs,
  canManage,
}: {
  center: SafetyCenter;
  members: SafetyCenterMember[];
  exportLogs: SafetyCenterExportLog[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-5">
      {isWasteV2Enabled && (
        <WastePolicyDistributionPanel centerId={center.id} canManage={canManage} />
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-medium text-slate-950 dark:text-white">센터 설정</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {[
            ['센터명', center.center_name],
            ['기관명', center.institution_name],
            ['기관 도메인', center.institution_domain],
            ['승인 상태', center.status],
            ['개설일', formatDate(center.created_at)],
            ['승인일', formatDate(center.approved_at)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <p className="mt-2 text-sm font-normal text-slate-900 dark:text-slate-100">{value}</p>
            </div>
          ))}
        </div>
      </section>
      <aside className="space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-base font-medium text-slate-950 dark:text-white">센터 멤버</h3>
          <div className="mt-4 space-y-2">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                <span className="font-mono text-xs text-slate-500">{member.user_id.slice(0, 8)}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{member.role}</span>
              </div>
            ))}
            {members.length === 0 && <p className="text-sm text-slate-500">멤버 정보를 불러오지 못했습니다.</p>}
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-base font-medium text-slate-950 dark:text-white">보안 기록</h3>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            내보내기는 센터 멤버, 데이터셋, 연구실 범위, 행 수가 기록됩니다. 최근 기록 {exportLogs.length}건이 보관되어 있습니다.
          </p>
        </section>
      </aside>
      </div>
    </div>
  );
}

function RequestDraftModal({
  draft,
  isLoading,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: RequestDraft;
  isLoading: boolean;
  onChange: (draft: RequestDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-slate-950 dark:text-white">점검 요청 만들기</h2>
            <p className="mt-1 text-sm text-slate-500">{draft.labName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            제목
            <input
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            요청 내용
            <textarea
              value={draft.description}
              onChange={(event) => onChange({ ...draft, description: event.target.value })}
              rows={4}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              우선순위
              <select
                value={draft.priority}
                onChange={(event) => onChange({ ...draft, priority: event.target.value as SafetyCenterRequestPriority })}
                className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="low">낮음</option>
                <option value="normal">보통</option>
                <option value="high">높음</option>
                <option value="urgent">긴급</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              마감일
              <input
                type="date"
                value={draft.dueDate}
                onChange={(event) => onChange({ ...draft, dueDate: event.target.value })}
                className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            취소
          </button>
          <button
            type="button"
            disabled={isLoading || !draft.title.trim()}
            onClick={onSubmit}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            요청 보내기
          </button>
        </div>
      </div>
    </div>
  );
}
