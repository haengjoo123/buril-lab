import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../../locales/i18n';
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
import { AppSelect } from '../../components/AppSelect';

type DatasetKey = 'risks' | 'waste' | 'audit';

const getManufacturerDateTypeLabel = (type: SafetyCenterRiskItem['manufacturer_date_type']) => {
  if (type === 'minimum_shelf_life') return i18n.t('sc_mfg_min_shelf_life');
  if (type === 'expiry') return i18n.t('sc_mfg_expiry');
  return i18n.t('sc_mfg_none');
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
  'sc_req_institution_name',
  'sc_req_applicant',
  'sc_req_authority',
  'sc_req_purpose',
  'sc_req_domain',
  'sc_req_issue_date',
  'sc_req_signer',
];

const DATASET_LABEL_KEYS: Record<DatasetKey, string> = {
  risks: 'sc_dataset_risks',
  waste: 'sc_dataset_waste',
  audit: 'sc_dataset_audit',
};
const getDatasetLabel = (dataset: string): string => (
  dataset in DATASET_LABEL_KEYS ? i18n.t(DATASET_LABEL_KEYS[dataset as DatasetKey]) : dataset
);

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
    return i18n.t('sc_err_migration');
  }

  if (message.includes('Bucket not found') || message.includes('safety-center-verifications')) {
    return i18n.t('sc_err_bucket');
  }

  if (err?.code === '42501') {
    return i18n.t('sc_err_permission');
  }

  if (err?.code === '22023') {
    return i18n.t('sc_err_required');
  }

  return i18n.t('sc_err_save_request');
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
  if (status === 'approved') return i18n.t('sc_link_approved');
  if (status === 'requested') return i18n.t('sc_link_requested');
  if (status === 'rejected') return i18n.t('sc_link_rejected');
  if (status === 'revoked') return i18n.t('sc_link_revoked');
  return i18n.t('sc_link_none');
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
  const { t } = useTranslation();
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
      setError(t('sc_err_load_center'));
    } finally {
      setIsLoading(false);
    }
  }, [loadCenters, t]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    setError(null);
    setIsLoading(true);
    loadCenterData(activeCenter)
      .catch((err) => {
        console.error(err);
        setError(t('sc_err_load_data'));
      })
      .finally(() => setIsLoading(false));
  }, [activeCenter, loadCenterData, t]);

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
      setError(t('sc_err_create_request'));
    } finally {
      setIsActionLoading(false);
    }
  }, [activeCenter, loadCenterData, navigate, requestDraft, t]);

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
          Dataset: getDatasetLabel('risks'),
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
          Dataset: getDatasetLabel('waste'),
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
          Dataset: getDatasetLabel('audit'),
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
        setError(t('sc_err_no_export_lab'));
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
          <h1 style="font-size:20px;margin:0 0 8px;">${escapeHtml(activeCenter.center_name)} ${t('sc_safety_report_suffix')}</h1>
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
      setError(t('sc_err_export'));
    } finally {
      setIsActionLoading(false);
    }
  }, [activeCenter, activeSection, approvedLabs, buildExportRows, loadCenterData, t]);

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
              {t('sc_center_title')}
            </div>
            <h1 className="mt-1 text-2xl font-medium tracking-tight text-slate-950 dark:text-white">
              {activeCenter?.center_name ?? t('sc_open_center')}
            </h1>
            {activeCenter && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {activeCenter.institution_name} · {activeCenter.institution_domain} · {activeCenter.status === 'approved' ? t('sc_link_approved') : activeCenter.status === 'pending' ? t('sc_status_pending_approval') : t('sc_link_rejected')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {centers.length > 1 && (
              <AppSelect
                value={activeCenter?.id ?? ''}
                onChange={setActiveCenterId}
                options={centers.map((center) => ({ value: center.id, label: center.center_name }))}
                className="min-w-[160px]"
                buttonClassName="!min-h-10 !rounded-lg !border-slate-200 !bg-white !px-3 !text-sm !font-normal !text-slate-700 dark:!border-slate-700 dark:!bg-slate-900 dark:!text-slate-100"
              />
            )}
            <button
              type="button"
              onClick={() => void loadCenterData(activeCenter)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-4 w-4" />
              {t('sc_refresh')}
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
                setError(t('sc_err_link_request'));
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
  const { t } = useTranslation();
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
      setError(t('sc_err_upload_doc'));
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
          <h2 className="text-xl font-medium text-slate-950 dark:text-white">{t('sc_create_title')}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {t('sc_create_desc')}
          </p>
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-normal text-red-700">{error}</div>}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <label className="text-sm font-normal text-slate-700 dark:text-slate-200">
          {t('sc_req_institution_name')}
          <input
            value={institutionName}
            onChange={(event) => setInstitutionName(event.target.value)}
            placeholder={t('sc_ph_institution')}
            className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        <label className="text-sm font-normal text-slate-700 dark:text-slate-200">
          {t('sc_institution_domain')}
          <input
            value={institutionDomain}
            onChange={(event) => setInstitutionDomain(event.target.value)}
            placeholder={t('sc_ph_domain')}
            className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        <label className="text-sm font-normal text-slate-700 dark:text-slate-200">
          {t('sc_center_name')}
          <input
            value={centerName}
            onChange={(event) => setCenterName(event.target.value)}
            placeholder={t('sc_ph_center')}
            className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <h3 className="text-sm font-medium text-slate-950 dark:text-white">{t('sc_verification_docs')}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {t('sc_verification_desc')}
            </p>
            <ul className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-2">
              {VERIFICATION_REQUIREMENTS.map((requirement) => (
                <li key={requirement} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{t(requirement)}</span>
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
              {verificationDocument ? verificationDocument.name : t('sc_select_doc')}
            </span>
            <span className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {verificationDocument
                ? `${formatFileSize(verificationDocument.size)} · ${t('sc_reselect_click')}`
                : t('sc_doc_formats')}
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
          {t('sc_send_approval_request')}
        </button>
      </div>
    </div>
  );
}

function PendingCenterPanel({ center, members }: { center: SafetyCenter; members: SafetyCenterMember[] }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-lg border border-amber-100 bg-amber-50 p-6 text-amber-900">
        <div className="flex items-start gap-4">
          <Clock className="mt-1 h-6 w-6" />
          <div>
            <h2 className="text-xl font-medium">{t('sc_pending_title')}</h2>
            <p className="mt-2 text-sm leading-6">
              {t('sc_pending_body', { name: center.center_name })}
            </p>
          </div>
        </div>
      </div>
      <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('sc_center_basic_info')}</h3>
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_institution')}</span><span className="font-normal">{center.institution_name}</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_domain')}</span><span className="font-normal">{center.institution_domain}</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_members')}</span><span className="font-normal">{t('sc_member_count', { n: members.length })}</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_requested_on')}</span><span className="font-normal">{formatDate(center.created_at)}</span></div>
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
  const { t } = useTranslation();
  const topRisks = [...riskItems]
    .map((item) => ({ item, assessment: assessRiskItem(item) }))
    .sort((left, right) => right.assessment.score - left.assessment.score)
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label={t('sc_metric_linked_labs')} value={summary.approvedLabCount} Icon={Building2} tone="bg-blue-50 text-blue-600" />
        <MetricCard label={t('sc_metric_high_risk')} value={summary.highRiskCount} Icon={AlertTriangle} tone="bg-red-50 text-red-600" />
        <MetricCard label={t('sc_metric_expiring')} value={summary.expiredOrExpiringCount} Icon={CalendarDays} tone="bg-amber-50 text-amber-600" />
        <MetricCard label={t('sc_metric_open_requests')} value={summary.openRequestCount} Icon={MessageSquare} tone="bg-violet-50 text-violet-600" />
        <MetricCard label={t('sc_metric_recent_waste')} value={summary.recentWasteCount} Icon={Archive} tone="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label={t('sc_metric_hazard_items')} value={summary.hazardCount} Icon={ShieldCheck} tone="bg-orange-50 text-orange-600" />
        <MetricCard label={t('sc_hazard_flammable')} value={summary.flammableCount} Icon={AlertTriangle} tone="bg-orange-50 text-orange-600" />
        <MetricCard label={t('sc_hazard_corrosive')} value={summary.corrosiveCount} Icon={AlertTriangle} tone="bg-amber-50 text-amber-600" />
        <MetricCard label={t('sc_hazard_toxic')} value={summary.toxicCount} Icon={AlertTriangle} tone="bg-red-50 text-red-600" />
        <MetricCard label={t('sc_hazard_other_managed')} value={summary.otherManagedCount} Icon={ShieldCheck} tone="bg-slate-50 text-slate-600" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <h2 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_heatmap_title')}</h2>
              <p className="mt-1 text-xs text-slate-500">{t('sc_heatmap_desc')}</p>
            </div>
          </div>
          {summary.labSummaries.length === 0 ? (
            <div className="p-5">
              <EmptyPanel title={t('sc_no_linked_data_title')} body={t('sc_no_linked_data_body')} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">{t('sc_col_lab')}</th>
                    <th className="px-4 py-3">{t('sc_col_risk_score')}</th>
                    <th className="px-4 py-3">{t('sc_col_burden')}</th>
                    <th className="px-4 py-3">{t('sc_col_high_risk')}</th>
                    <th className="px-4 py-3">{t('sc_flag_hazard')}</th>
                    <th className="px-4 py-3">{t('sc_col_expired')}</th>
                    <th className="px-4 py-3">{t('sc_flag_missing_cas')}</th>
                    <th className="px-4 py-3 text-right">{t('sc_col_actions')}</th>
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
                          <div className="text-xs text-slate-400">{t('sc_no_data')}</div>
                        ) : (
                          <>
                            <div className="text-xs text-slate-500">{t('sc_burden_value', { value: lab.riskBurden })}</div>
                            <div className="text-[11px] text-slate-400">{t('sc_avg_top5', { avg: lab.averageRiskScore, top: lab.topFiveAverage })}</div>
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
                            title: t('sc_lab_risk_check_title', { name: lab.labName }),
                            description: t('sc_lab_risk_check_desc', { high: lab.highRiskCount, expiring: lab.expiredCount + lab.expiringCount }),
                            priority: lab.riskScore >= 60 || lab.highRiskCount > 0 ? 'high' : 'normal',
                            dueDate: '',
                          })}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {t('sc_request_action')}
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
            <h2 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_priority_queue')}</h2>
            <div className="mt-4 space-y-3">
              {topRisks.length === 0 ? (
                <p className="text-sm text-slate-500">{t('sc_no_risk_items')}</p>
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
            <h2 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_recent_audit')}</h2>
            <div className="mt-4 space-y-3">
              {auditLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-sm font-normal text-slate-800 dark:text-slate-100">{log.lab_name} · {log.entity_type}</p>
                  <p className="mt-1 text-xs text-slate-500">{log.action} · {log.actor_name ?? t('sc_unknown')} · {formatDateTime(log.created_at)}</p>
                </div>
              ))}
              {auditLogs.length === 0 && <p className="text-sm text-slate-500">{t('sc_no_audit_events')}</p>}
            </div>
          </section>
        </aside>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_open_inspections')}</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {requests.filter((request) => request.status !== 'resolved').slice(0, 6).map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
          {requests.filter((request) => request.status !== 'resolved').length === 0 && (
            <p className="text-sm text-slate-500">{t('sc_no_open_requests')}</p>
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
  const { t } = useTranslation();
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
              <h2 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_labs_manage_title')}</h2>
              <p className="mt-1 text-xs text-slate-500">{t('sc_labs_manage_desc')}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-medium">
              <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">{t('sc_approved_count', { n: approvedCount })}</span>
              <span className="rounded-lg bg-blue-50 px-3 py-2 text-blue-700">{t('sc_requested_count', { n: requestedCount })}</span>
              <span className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">{t('sc_candidate_count', { n: candidates.length })}</span>
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
                placeholder={t('sc_ph_search_lab')}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-normal outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <button className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white">{t('sc_search')}</button>
          </form>
        </div>

        {candidates.length === 0 ? (
          <div className="p-5">
            <EmptyPanel title={t('sc_no_candidates_title')} body={t('sc_no_candidates_body')} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">{t('sc_col_lab_name')}</th>
                  <th className="px-4 py-3">{t('sc_col_affiliation_field')}</th>
                  <th className="px-4 py-3">{t('sc_col_link_status')}</th>
                  <th className="px-4 py-3">{t('sc_col_visibility')}</th>
                  <th className="px-4 py-3">{t('sc_col_last_update')}</th>
                  <th className="px-4 py-3 text-right">{t('sc_col_actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {candidates.map((candidate) => (
                  <tr key={candidate.lab_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3 font-normal text-slate-900 dark:text-slate-100">{candidate.lab_name}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {candidate.institution_name ?? '-'} · {candidate.research_field ?? candidate.institution_type ?? t('sc_field_not_entered')}
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
                          {t('sc_linked')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!canManage || isActionLoading || candidate.link_status === 'requested'}
                          onClick={() => onRequestLink(candidate.lab_id)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                        >
                          {isActionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          {candidate.link_status === 'requested' ? t('sc_link_requested') : t('sc_request_link')}
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
          <h3 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_link_principles')}</h3>
          <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p className="flex gap-2"><LockKeyhole className="mt-0.5 h-4 w-4 text-slate-400" />{t('sc_principle_1')}</p>
            <p className="flex gap-2"><Users className="mt-0.5 h-4 w-4 text-slate-400" />{t('sc_principle_2')}</p>
            <p className="flex gap-2"><Layers3 className="mt-0.5 h-4 w-4 text-slate-400" />{t('sc_principle_3')}</p>
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_selected_lab')}</h3>
          {selectedLab ? (
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_col_lab')}</span><span className="text-right font-normal">{selectedLab.lab_name}</span></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_status')}</span><span className="font-normal">{linkStatusLabel(selectedLab.link_status)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_field')}</span><span className="text-right font-normal">{selectedLab.research_field ?? '-'}</span></div>
              <div className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                {t('sc_selected_lab_note')}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{t('sc_no_candidate_labs')}</p>
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
  const { t } = useTranslation();
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
              <h2 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_risk_detail_title')}</h2>
              <p className="mt-1 text-xs text-slate-500">{t('sc_risk_detail_desc')}</p>
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
            <AppSelect
              value={labId}
              onChange={setLabId}
              options={[
                { value: 'all', label: t('sc_all_labs') },
                ...approvedLabs.map((lab) => ({ value: lab.lab_id, label: lab.lab_name })),
              ]}
              buttonClassName="!min-h-10 !rounded-lg !border-slate-200 !bg-white !px-3 !text-sm !font-normal dark:!border-slate-700 dark:!bg-slate-950"
            />
            <AppSelect
              value={riskFlag}
              onChange={setRiskFlag}
              options={[
                { value: 'all', label: t('sc_all_risks') },
                { value: 'hazard', label: t('sc_all_hazards') },
                { value: 'hazard_special_high', label: t('sc_hazard_special_high') },
                { value: 'hazard_flammable', label: t('sc_hazard_flammable') },
                { value: 'hazard_corrosive', label: t('sc_hazard_corrosive') },
                { value: 'hazard_toxic', label: t('sc_hazard_toxic') },
                { value: 'hazard_other_managed', label: t('sc_hazard_other_managed') },
                { value: 'expired', label: t('sc_flag_expired') },
                { value: 'expiring', label: t('sc_flag_expiring') },
                { value: 'missing_cas', label: t('sc_flag_missing_cas') },
                { value: 'low_remaining', label: t('sc_flag_low_remaining') },
              ]}
              buttonClassName="!min-h-10 !rounded-lg !border-slate-200 !bg-white !px-3 !text-sm !font-normal dark:!border-slate-700 dark:!bg-slate-950"
            />
            <AppSelect
              value={casState}
              onChange={setCasState}
              options={[
                { value: 'all', label: t('sc_cas_all') },
                { value: 'missing', label: t('sc_flag_missing_cas') },
                { value: 'present', label: t('sc_cas_present') },
              ]}
              buttonClassName="!min-h-10 !rounded-lg !border-slate-200 !bg-white !px-3 !text-sm !font-normal dark:!border-slate-700 dark:!bg-slate-950"
            />
            <AppSelect
              value={expiryState}
              onChange={setExpiryState}
              options={[
                { value: 'all', label: t('sc_mfg_date_all') },
                { value: 'expired', label: t('sc_col_expired') },
                { value: 'warning', label: t('sc_mfg_warning') },
                { value: 'none', label: t('sc_mfg_not_entered') },
              ]}
              buttonClassName="!min-h-10 !rounded-lg !border-slate-200 !bg-white !px-3 !text-sm !font-normal dark:!border-slate-700 dark:!bg-slate-950"
            />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('sc_ph_search_risk')} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950" />
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="p-5">
            <EmptyPanel title={t('sc_no_matching_risk_title')} body={t('sc_no_matching_risk_body')} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-3">{t('sc_col_lab')}</th>
                  <th className="px-3 py-3">{t('sc_col_reagent')}</th>
                  <th className="px-3 py-3">CAS</th>
                  <th className="px-3 py-3">{t('sc_col_risk_signal')}</th>
                  <th className="px-3 py-3">{t('sc_col_storage')}</th>
                  <th className="px-3 py-3">{t('sc_col_mfg_date')}</th>
                  <th className="px-3 py-3 text-right">{t('sc_col_actions')}</th>
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
                          {assessment.flags.length === 0 && <span className="text-xs text-slate-400">{t('sc_priority_low')}</span>}
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
                              title: t('sc_item_check_title', { name: item.inventory_name }),
                              description: t('sc_item_check_desc', { flags: assessment.flags.map(getRiskFlagLabel).join(', ') || t('sc_col_risk_signal') }),
                              priority: assessment.riskBand === 'critical' || assessment.riskBand === 'high' ? 'high' : 'normal',
                              dueDate: '',
                              targetType: item.source_type,
                              targetId: item.item_id,
                            });
                          }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {t('sc_request')}
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
  const { t } = useTranslation();
  if (!item) {
    return (
      <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <EmptyPanel title={t('sc_no_selected_title')} body={t('sc_no_selected_body')} />
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
        <span className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">{t('sc_score_value', { score: assessment.score })}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {assessment.flags.filter((flag) => flag !== 'hazard').map((flag) => (
          <span key={flag} className={`rounded border px-2 py-0.5 text-xs font-medium ${riskFlagTone(flag)}`}>
            {getRiskFlagLabel(flag)}
          </span>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px]">
        <div className="rounded-lg bg-red-50 p-2 text-red-700"><div>{t('sc_hazard_score')}</div><strong>{assessment.hazardScore}</strong></div>
        <div className="rounded-lg bg-amber-50 p-2 text-amber-700"><div>{t('sc_operational_score')}</div><strong>{assessment.operationalScore}</strong></div>
        <div className="rounded-lg bg-violet-50 p-2 text-violet-700"><div>{t('sc_data_quality_score')}</div><strong>{assessment.dataQualityScore}</strong></div>
      </div>
      <div className="mt-5 space-y-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
        <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_mfg_date_type')}</span><span className="font-normal">{getManufacturerDateTypeLabel(item.manufacturer_date_type)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_col_mfg_date')}</span><span className="font-normal">{getTrackedManufacturerDate(item) || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_received_date')}</span><span className="font-normal">{item.received_date || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_opened_date')}</span><span className="font-normal">{item.opened_date || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">CAS</span><span className="font-normal">{item.cas_number || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_brand')}</span><span className="font-normal">{item.brand || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_spec')}</span><span className="font-normal">{item.capacity || '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_location')}</span><span className="text-right font-normal">{item.cabinet_name ?? item.storage_location_name ?? '-'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_remaining')}</span><span className="font-normal">{item.remaining_percent ?? 100}%</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-500">{t('sc_ghs_status')}</span><span className="font-normal">{item.ghs_data_status ?? t('sc_ghs_not_queried')}</span></div>
      </div>
      <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
        {t('sc_detail_note')}
      </div>
      <button
        type="button"
        disabled={!canCreateRequest}
        onClick={() => onOpenRequest({
          labId: item.lab_id,
          labName: item.lab_name,
          title: t('sc_detail_req_title', { name: item.inventory_name }),
          description: t('sc_detail_req_desc', { flags: assessment.flags.map(getRiskFlagLabel).join(', ') }),
          priority: assessment.riskBand === 'critical' || assessment.riskBand === 'high' ? 'high' : 'normal',
          dueDate: '',
          targetType: item.source_type,
          targetId: item.item_id,
        })}
        className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
      >
        <Send className="h-4 w-4" />
        {t('sc_create_inspection_request')}
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
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRequest = requests.find((request) => request.id === selectedId) ?? requests[0] ?? null;
  const columns: Array<{ status: SafetyCenterRequest['status']; label: string }> = [
    { status: 'open', label: t('sc_status_open') },
    { status: 'in_progress', label: t('sc_status_in_progress') },
    { status: 'submitted', label: t('sc_status_submitted') },
    { status: 'resolved', label: t('sc_status_resolved') },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_inspection_collab')}</h2>
            <p className="mt-1 text-xs text-slate-500">{t('sc_inspection_collab_desc')}</p>
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
                title: t('sc_monthly_check_title'),
                description: t('sc_monthly_check_desc'),
                priority: 'normal',
                dueDate: '',
              });
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {t('sc_new_request')}
          </button>
        </div>

        {requests.length === 0 ? (
          <div className="mt-5">
            <EmptyPanel title={t('sc_no_inspection_title')} body={t('sc_no_inspection_body')} />
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
                        {t('sc_no_requests_in_status')}
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
        <h3 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_request_details')}</h3>
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
              <div className="flex justify-between gap-3"><span className="text-slate-500">{t('sc_due_date')}</span><span className="font-normal">{formatDate(selectedRequest.due_date)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">{t('sc_target')}</span><span className="text-right font-normal">{selectedRequest.target_type ?? '-'}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">{t('sc_created_on')}</span><span className="text-right font-normal">{formatDateTime(selectedRequest.created_at)}</span></div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">{t('sc_no_selected_request')}</p>
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
  const { t } = useTranslation();
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
        <span className="text-xs text-slate-500">{t('sc_due_value', { date: formatDate(request.due_date) })}</span>
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
  const { t } = useTranslation();
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
        <h2 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_export_data')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('sc_export_desc')}</p>
        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('sc_dataset')}</p>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {(Object.keys(DATASET_LABEL_KEYS) as DatasetKey[]).map((dataset) => (
                <label key={dataset} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-3 text-sm font-normal dark:border-slate-800">
                  <span>{getDatasetLabel(dataset)}</span>
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
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('sc_lab_scope')}</p>
                <button
                  type="button"
                  onClick={() => setSelectedLabIds(exportableLabIds)}
                  className="text-xs font-medium text-blue-600"
                >
                  {t('sc_select_all')}
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
                    {t('sc_no_export_labs')}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <label className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {t('sc_start_date')}
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {t('sc_end_date')}
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
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('sc_file_format')}</p>
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
              {t('sc_run_export')}
            </button>
          </div>
        </div>
      </section>

      <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_export_history')}</h3>
        <div className="mt-4 space-y-3">
          {exportLogs.map((log) => (
            <div key={log.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium uppercase text-slate-900 dark:text-slate-100">{log.format}</span>
                <span className="text-xs text-slate-500">{formatDateTime(log.created_at)}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{log.datasets.map((dataset) => getDatasetLabel(dataset)).join(', ')}</p>
              <p className="mt-1 text-xs font-normal text-slate-700 dark:text-slate-300">{t('sc_export_log_counts', { rows: log.row_count, labs: log.lab_ids.length })}</p>
            </div>
          ))}
          {exportLogs.length === 0 && <p className="text-sm text-slate-500">{t('sc_no_export_history')}</p>}
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
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      {isWasteV2Enabled && (
        <WastePolicyDistributionPanel centerId={center.id} canManage={canManage} />
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_center_settings')}</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {[
            [t('sc_center_name'), center.center_name],
            [t('sc_req_institution_name'), center.institution_name],
            [t('sc_institution_domain'), center.institution_domain],
            [t('sc_approval_status'), center.status],
            [t('sc_opened_on'), formatDate(center.created_at)],
            [t('sc_approved_on'), formatDate(center.approved_at)],
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
          <h3 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_center_members')}</h3>
          <div className="mt-4 space-y-2">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                <span className="font-mono text-xs text-slate-500">{member.user_id.slice(0, 8)}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{member.role}</span>
              </div>
            ))}
            {members.length === 0 && <p className="text-sm text-slate-500">{t('sc_no_members')}</p>}
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-base font-medium text-slate-950 dark:text-white">{t('sc_security_log')}</h3>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {t('sc_security_note', { n: exportLogs.length })}
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
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-slate-950 dark:text-white">{t('sc_create_inspection_request')}</h2>
            <p className="mt-1 text-sm text-slate-500">{draft.labName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('sc_title_label')}
            <input
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('sc_request_body')}
            <textarea
              value={draft.description}
              onChange={(event) => onChange({ ...draft, description: event.target.value })}
              rows={4}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              <span>{t('sc_priority')}</span>
              <AppSelect
                value={draft.priority}
                onChange={(value) => onChange({ ...draft, priority: value as SafetyCenterRequestPriority })}
                options={[
                  { value: 'low', label: t('sc_priority_low') },
                  { value: 'normal', label: t('sc_priority_normal') },
                  { value: 'high', label: t('sc_priority_high') },
                  { value: 'urgent', label: t('sc_priority_urgent') },
                ]}
                className="mt-2 w-full"
                buttonClassName="!min-h-10 !rounded-lg !border-slate-200 !bg-white !px-3 !text-sm !font-normal dark:!border-slate-700 dark:!bg-slate-950"
              />
            </div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('sc_due_date')}
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
            {t('sc_cancel')}
          </button>
          <button
            type="button"
            disabled={isLoading || !draft.title.trim()}
            onClick={onSubmit}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t('sc_send_request')}
          </button>
        </div>
      </div>
    </div>
  );
}
