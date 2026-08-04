/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    fetchWasteLogItemsV2,
    fetchWasteLogs,
    isLegacyWasteLog,
    voidWasteLogV2,
    type WasteLogItemRecord,
    type WasteLogRecord,
} from '../services/wasteLogService';
import type { DisposalCategory, WasteStreamCode } from '../types';
import { useTranslation } from 'react-i18next';
import { PencilLine, ChevronDown, ChevronUp, Loader2, AlertCircle, Search, History, X, FileText, FileSpreadsheet, Download, CheckCircle2 } from 'lucide-react';
import { useLabStore } from '../store/useLabStore';
import type { WasteLogSortBy } from '../services/wasteLogService';
import { auditService, type AuditLog } from '../services/auditService';
import { EmptyState } from './EmptyState';
import { OnboardingGuideCard } from './onboarding/OnboardingGuideCard';
import { useOnboardingStore } from '../store/useOnboardingStore';
import { AppSelect } from './AppSelect';
import { translateLocationName } from '../utils/i18nUtils';
import { useIsDesktop } from '../hooks/useIsDesktop';
import {
    buildAuditEventDescription,
    formatAuditActionName,
    getAuditChangeRows,
    getAuditDetailSections,
} from '../utils/auditLogFormatting';
import { getCategoryDetails } from '../utils/chemicalAnalyzer';
import { useAuth } from '../hooks/useAuth';
import { formatGhsStatementList } from '../data/ghsCodes';

type LogDateRange = '7d' | '30d' | '90d' | 'all';
type LogGroupMode = 'day' | 'week' | 'month';
type LogViewTab = 'recent' | 'archive';
type ExportFormat = 'pdf' | 'excel';
type ExportScope = 'today' | '7d' | '30d' | '90d' | 'archive' | 'all' | 'custom';

interface GroupedLogSection {
    key: string;
    mode: LogGroupMode;
    title: string;
    subtitle: string;
    logs: WasteLogRecord[];
    totalVolumeMl: number;
    latestCreatedAt: number;
}

const PAGE_SIZE = 20;
const AUTHOR_CORRECTION_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_CUTOFF_DAYS = 90;
const DISPOSAL_CATEGORY_VALUES = new Set<string>([
    'ACID',
    'ALKALI',
    'NEUTRAL',
    'ORGANIC_HALOGEN',
    'ORGANIC_NON_HALOGEN',
    'HEAVY_METAL',
    'CYANIDE',
    'REACTIVE',
    'SOLID_WASTE',
    'SPECIAL_HAZARD',
    'UNKNOWN',
]);

const WASTE_STREAM_LABELS: Record<WasteStreamCode, { ko: string; en: string }> = {
    ACID_AQUEOUS: { ko: '산성 수계 폐액', en: 'Acidic aqueous waste' },
    ALKALI_AQUEOUS: { ko: '알칼리성 수계 폐액', en: 'Alkaline aqueous waste' },
    ORGANIC_HALOGENATED: { ko: '할로겐 유기 폐액', en: 'Halogenated organic waste' },
    ORGANIC_NON_HALOGENATED: { ko: '비할로겐 유기 폐액', en: 'Non-halogenated organic waste' },
    HEAVY_METAL: { ko: '중금속 함유 폐기물', en: 'Heavy-metal waste' },
    CYANIDE_SULFIDE: { ko: '시안·황화물 계열', en: 'Cyanide or sulfide waste' },
    REACTIVE_OXIDIZER: { ko: '반응성·산화성 폐기물', en: 'Reactive or oxidizing waste' },
    SOLID_CONTAMINATED: { ko: '오염 고체·슬러리', en: 'Contaminated solid or slurry' },
    AQUEOUS_OTHER: { ko: '기타 수계 폐액', en: 'Other aqueous waste' },
    SPECIAL_REVIEW: { ko: '분리 보관·특별 검토', en: 'Isolate and review' },
};

function formatWasteStream(code: WasteLogRecord['stream_code'], language: string): string | null {
    if (!code) return null;
    const labels = WASTE_STREAM_LABELS[code];
    return labels ? (language.startsWith('ko') ? labels.ko : labels.en) : code;
}

function formatDecisionStatus(status: WasteLogRecord['decision_status'], language: string): string {
    const korean = language.startsWith('ko');
    if (status === 'ready') return korean ? '폐액통 안내 가능' : 'Container guidance ready';
    if (status === 'needs_input') return korean ? '정보 확인 필요' : 'More information needed';
    if (status === 'blocked') return korean ? '분리 처리' : 'Isolate and handle separately';
    return korean ? '분류 확인 불가' : 'Classification unavailable';
}

function formatHandlingAction(action: WasteLogRecord['handling_action'], language: string): string {
    const korean = language.startsWith('ko');
    if (action === 'container_deposit') return korean ? '폐액통 입고' : 'Container deposit';
    if (action === 'isolated') return korean ? '분리 보관' : 'Isolated';
    if (action === 'handover') return korean ? '담당자·위탁처 인계' : 'Handed over';
    return '-';
}

function getWasteChemicalName(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const component = value as Record<string, unknown>;
    const nestedChemical = component.chemical && typeof component.chemical === 'object'
        ? component.chemical as Record<string, unknown>
        : null;
    const candidate = nestedChemical?.name || component.chemicalName || component.chemical_name || component.name;
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function getWasteChemicalConcentration(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const component = value as Record<string, unknown>;
    const concentration = component.concentration && typeof component.concentration === 'object'
        ? component.concentration as Record<string, unknown>
        : null;
    if (concentration?.value !== undefined && concentration.unit) {
        return `${String(concentration.value)} ${String(concentration.unit)}`;
    }

    const legacyVolume = typeof component.volume === 'string' ? component.volume : '';
    const legacyMolarity = typeof component.molarity === 'string' ? component.molarity : '';
    if (!legacyVolume && !legacyMolarity) return null;
    return [legacyVolume, legacyMolarity].filter(Boolean).join(' • ');
}

const HAZARD_FLAG_LABELS: Record<string, { ko: string; en: string }> = {
    FLAMMABLE: { ko: '인화성', en: 'Flammable' },
    OXIDIZER: { ko: '산화성', en: 'Oxidizer' },
    EXPLOSIVE: { ko: '폭발성', en: 'Explosive' },
    SELF_REACTIVE: { ko: '자기반응성', en: 'Self-reactive' },
    WATER_REACTIVE: { ko: '수반응성', en: 'Water-reactive' },
    PYROPHORIC: { ko: '자연발화성', en: 'Pyrophoric' },
    CORROSIVE: { ko: '부식성', en: 'Corrosive' },
    ACUTE_TOXIC: { ko: '급성독성', en: 'Acute toxicity' },
    CMR: { ko: '발암성·생식독성', en: 'CMR hazard' },
    ENVIRONMENTAL_HAZARD: { ko: '환경유해성', en: 'Environmental hazard' },
    CYANIDE: { ko: '시안', en: 'Cyanide' },
    SULFIDE: { ko: '황화물', en: 'Sulfide' },
    HEAVY_METAL: { ko: '중금속', en: 'Heavy metal' },
    HYDROFLUORIC_ACID: { ko: '불산(HF)', en: 'Hydrofluoric acid (HF)' },
    FLUORIDE: { ko: '불화물', en: 'Fluoride' },
    REACTIVE: { ko: '반응성', en: 'Reactive' },
    UNKNOWN_COMPONENT: { ko: '미상 성분', en: 'Unknown component' },
};

function formatHazardFlag(flag: string, language: string): string {
    const label = HAZARD_FLAG_LABELS[flag];
    return label ? (language.startsWith('ko') ? label.ko : label.en) : flag;
}

function formatGhsDataStatus(status: WasteLogItemRecord['ghsDataStatus'], language: string): string {
    const korean = language.startsWith('ko');
    if (status === 'verified') return korean ? '확인됨' : 'Verified';
    if (status === 'lookup_failed') return korean ? '조회 실패' : 'Lookup failed';
    if (status === 'not_checked') return korean ? '확인하지 않음' : 'Not checked';
    return korean ? '상태 미기록' : 'Not recorded';
}

function formatGhsSignal(signal: string, language: string): string {
    if (!language.startsWith('ko')) return signal;
    const normalized = signal.trim().toLowerCase();
    if (normalized === 'danger') return '위험';
    if (normalized === 'warning') return '경고';
    return signal;
}

type AnalysisSnapshotRow = {
    label: string;
    value: string | string[];
};

function formatStoredPhysicalValue(value: unknown, language: string): unknown {
    if (!language.startsWith('ko') || typeof value !== 'string') return value;

    const trimmed = value.trim();
    const normalized = trimmed.toLowerCase();
    if (normalized.startsWith('miscible')) {
        return `혼화성${trimmed.slice('Miscible'.length)}`;
    }
    if (normalized === 'stable under recommended storage conditions.') {
        return '권장 보관 조건에서 안정함';
    }
    return value;
}

function getAnalysisSnapshotRows(
    snapshot: Record<string, unknown>,
    language: string,
    translate: (key: string) => string,
): AnalysisSnapshotRow[] {
    const korean = language.startsWith('ko');
    const rows: AnalysisSnapshotRow[] = [];
    const addPrimitive = (labelKo: string, labelEn: string, value: unknown) => {
        if (typeof value === 'string' && value.trim()) {
            rows.push({ label: korean ? labelKo : labelEn, value: value.trim() });
        } else if (typeof value === 'number' && Number.isFinite(value)) {
            rows.push({ label: korean ? labelKo : labelEn, value: String(value) });
        } else if (typeof value === 'boolean') {
            rows.push({ label: korean ? labelKo : labelEn, value: value ? (korean ? '예' : 'Yes') : (korean ? '아니요' : 'No') });
        }
    };

    if (typeof snapshot.category === 'string' && snapshot.category.trim()) {
        const category = snapshot.category.trim();
        const categoryLabel = DISPOSAL_CATEGORY_VALUES.has(category)
            ? translate(getCategoryDetails(category as DisposalCategory).label)
            : category;
        rows.push({ label: korean ? '분류' : 'Category', value: categoryLabel });
    }
    if (typeof snapshot.reason === 'string' && snapshot.reason.trim()) {
        const reason = snapshot.reason.trim();
        const translatedReason = translate(reason);
        rows.push({
            label: korean ? '판정 근거' : 'Decision reason',
            value: translatedReason === reason ? reason : translatedReason,
        });
    }
    addPrimitive('AI 추정', 'AI estimated', snapshot.isAiEstimated);

    const ghs = snapshot.ghs && typeof snapshot.ghs === 'object' && !Array.isArray(snapshot.ghs)
        ? snapshot.ghs as Record<string, unknown>
        : null;
    if (ghs) {
        if (typeof ghs.signal === 'string' && ghs.signal.trim()) {
            rows.push({
                label: korean ? 'GHS 신호어' : 'GHS signal word',
                value: formatGhsSignal(ghs.signal.trim(), language),
            });
        }
        const statements = Array.isArray(ghs.hazardStatements)
            ? ghs.hazardStatements.filter((statement): statement is string => typeof statement === 'string' && Boolean(statement.trim()))
            : [];
        if (statements.length > 0) {
            rows.push({
                label: korean ? 'GHS 위험 문구' : 'GHS hazard statements',
                value: formatGhsStatementList(statements, korean ? 'ko' : 'en'),
            });
        }
    }

    const physical = snapshot.physicalProperties
        && typeof snapshot.physicalProperties === 'object'
        && !Array.isArray(snapshot.physicalProperties)
        ? snapshot.physicalProperties as Record<string, unknown>
        : null;
    if (physical) {
        addPrimitive('인화점', 'Flash point', physical.flashPoint);
        addPrimitive('끓는점', 'Boiling point', physical.boilingPoint);
        addPrimitive('용해도', 'Solubility', formatStoredPhysicalValue(physical.solubility, language));
        addPrimitive('안정성', 'Stability', formatStoredPhysicalValue(physical.stability, language));
    }

    return rows;
}

interface WasteLogItemsPanelProps {
    items: WasteLogItemRecord[] | undefined;
    isLoading: boolean;
    error: string | null;
    onRetry: () => void;
    onViewAudit: (id: string) => void;
}

export const WasteLogItemsPanel: React.FC<WasteLogItemsPanelProps> = ({
    items,
    isLoading,
    error,
    onRetry,
    onViewAudit,
}) => {
    const { t, i18n } = useTranslation();
    const korean = i18n.language.startsWith('ko');

    if (isLoading && items === undefined) {
        return (
            <div role="status" className="flex min-h-20 items-center justify-center gap-2 rounded-lg bg-slate-50 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {korean ? '성분 상세 기록을 불러오는 중입니다.' : 'Loading component details.'}
            </div>
        );
    }

    if (error) {
        return (
            <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                <p>{error}</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-2 min-h-11 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200"
                >
                    {korean ? '다시 불러오기' : 'Try again'}
                </button>
            </div>
        );
    }

    if (items && items.length === 0) {
        return (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                {korean
                    ? 'V2 성분 상세 행이 없습니다. 배치 요약은 보존되어 있지만 성분별 근거는 확인할 수 없습니다.'
                    : 'No V2 component rows were found. The batch summary remains available, but per-component evidence cannot be verified.'}
            </div>
        );
    }

    if (!items) return null;

    return (
        <div className="space-y-3">
            {items.map((item) => {
                const snapshotRows = getAnalysisSnapshotRows(
                    item.analysisSnapshot,
                    i18n.language,
                    (key) => t(key as never),
                );
                const originId = item.inventoryItemId || item.cabinetItemId;
                return (
                    <article key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/80">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="font-semibold text-slate-800 dark:text-slate-100">
                                    <span className="mr-1 text-xs font-normal text-slate-400">#{item.lineNumber}</span>
                                    {item.chemicalName || (korean ? '이름 미기록' : 'Name not recorded')}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                    {item.casNumber && <span>CAS {item.casNumber}</span>}
                                    {item.formula && <span>{item.formula}</span>}
                                    {item.molecularWeight !== null && <span>MW {item.molecularWeight}</span>}
                                    {item.pubchemCid !== null && <span>PubChem CID {item.pubchemCid}</span>}
                                    {item.koshaChemId && <span>KOSHA {item.koshaChemId}</span>}
                                </div>
                            </div>
                            {item.concentrationValue !== null && item.concentrationUnit && (
                                <span className="rounded-md bg-white px-2 py-1 font-mono text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                                    {item.concentrationValue} {item.concentrationUnit}
                                </span>
                            )}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.hazardFlags.length > 0 ? item.hazardFlags.map((flag) => (
                                <span key={flag} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                                    {formatHazardFlag(flag, i18n.language)}
                                </span>
                            )) : (
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {korean ? '기록된 위험 플래그 없음' : 'No recorded hazard flags'}
                                </span>
                            )}
                        </div>

                        <dl className="mt-3 grid gap-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-700 sm:grid-cols-2">
                            <div>
                                <dt className="text-slate-500 dark:text-slate-400">{korean ? '식별 신뢰도' : 'Identity confidence'}</dt>
                                <dd className="mt-0.5 font-medium text-slate-700 dark:text-slate-200">
                                    {item.identityConfidence === null ? '-' : `${Math.round(item.identityConfidence * 100)}%`}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-slate-500 dark:text-slate-400">GHS</dt>
                                <dd className="mt-0.5 font-medium text-slate-700 dark:text-slate-200">{formatGhsDataStatus(item.ghsDataStatus, i18n.language)}</dd>
                            </div>
                            <div className="sm:col-span-2">
                                <dt className="text-slate-500 dark:text-slate-400">{korean ? '유입 경로' : 'Source'}</dt>
                                <dd className="mt-0.5 break-all font-medium text-slate-700 dark:text-slate-200">
                                    {item.sourceType}{item.sourceRef ? ` · ${item.sourceRef}` : ''}
                                </dd>
                            </div>
                        </dl>

                        {item.dataSources.length > 0 && (
                            <div className="mt-3 rounded-md bg-white p-2.5 text-xs dark:bg-slate-900/70">
                                <div className="font-semibold text-slate-700 dark:text-slate-200">{korean ? '데이터 출처' : 'Data sources'}</div>
                                <ul className="mt-1.5 space-y-1 text-slate-500 dark:text-slate-400">
                                    {item.dataSources.map((source, index) => (
                                        <li key={`${source.sourceType}-${source.capturedAt || index}`} className="break-all">
                                            {source.sourceType}
                                            {source.sourceRef ? ` · ${source.sourceRef}` : ''}
                                            {source.capturedAt ? ` · ${new Date(source.capturedAt).toLocaleString(korean ? 'ko-KR' : 'en-US')}` : ''}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {snapshotRows.length > 0 && (
                            <details className="mt-3 rounded-md bg-white p-2.5 text-xs dark:bg-slate-900/70">
                                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-slate-700 dark:text-slate-200">
                                    {korean ? '저장된 분석 근거 보기' : 'View stored analysis evidence'}
                                </summary>
                                <dl className="space-y-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                                    {snapshotRows.map((row) => (
                                        <div key={`${row.label}-${Array.isArray(row.value) ? row.value.join('|') : row.value}`}>
                                            <dt className="text-slate-500 dark:text-slate-400">{row.label}</dt>
                                            {Array.isArray(row.value) ? (
                                                <dd className="mt-1">
                                                    <ul className="space-y-1.5">
                                                        {row.value.map((value) => (
                                                            <li
                                                                key={value}
                                                                className="rounded-md bg-slate-50 px-2 py-1.5 leading-5 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                                            >
                                                                {value}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </dd>
                                            ) : (
                                                <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-200">{row.value}</dd>
                                            )}
                                        </div>
                                    ))}
                                </dl>
                            </details>
                        )}

                        {originId && (
                            <button
                                type="button"
                                onClick={() => onViewAudit(originId)}
                                className="mt-3 flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30"
                            >
                                <History className="h-3.5 w-3.5" aria-hidden="true" />
                                {korean ? '연결된 재고 이력 보기' : 'View linked inventory history'}
                            </button>
                        )}
                    </article>
                );
            })}
        </div>
    );
};

const HTML_ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] || char);
}

function safeSpreadsheetCell(value: unknown): string {
    const text = String(value ?? '');
    return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
}

interface WasteLogViewProps {
    initialWasteLogId?: string | null;
    openCorrection?: boolean;
}

export const WasteLogView: React.FC<WasteLogViewProps> = ({
    initialWasteLogId,
    openCorrection = false,
}) => {
    const { t, i18n } = useTranslation();
    const { user } = useAuth();
    const isDesktop = useIsDesktop();
    const showOnboardingGuide = useOnboardingStore((state) => state.hasCompletedWelcome && !state.hasSkippedOnboarding && !state.seenGuides.logs);
    const markGuideSeen = useOnboardingStore((state) => state.markGuideSeen);
    const currentLabId = useLabStore(state => state.currentLabId);
    const myLabs = useLabStore(state => state.myLabs);
    const currentRole = myLabs.find(m => m.lab_id === currentLabId)?.role;
    const canManageLabLogs = !currentLabId || currentRole === 'admin';
    const [logs, setLogs] = useState<WasteLogRecord[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [page, setPage] = useState(0);
    const [voidId, setVoidId] = useState<string | null>(null);
    const [voidReason, setVoidReason] = useState('');
    const [isVoiding, setIsVoiding] = useState(false);
    const [voidError, setVoidError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const voidDialogRef = useRef<HTMLDivElement>(null);
    const initialRecordHandledRef = useRef(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [activeTab, setActiveTab] = useState<LogViewTab>('recent');
    const [dateRange, setDateRange] = useState<LogDateRange>('30d');
    const [sortBy, setSortBy] = useState<WasteLogSortBy>('created_at');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [viewingAuditLogForId, setViewingAuditLogForId] = useState<string | null>(null);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [isLoadingAudit, setIsLoadingAudit] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState<ExportFormat>('excel');
    const [exportScope, setExportScope] = useState<ExportScope>('30d');
    const [customExportStartDate, setCustomExportStartDate] = useState('');
    const [customExportEndDate, setCustomExportEndDate] = useState('');
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
    const [selectedDesktopLogId, setSelectedDesktopLogId] = useState<string | null>(null);
    const [v2ItemsByLogId, setV2ItemsByLogId] = useState<Record<string, WasteLogItemRecord[]>>({});
    const [v2ItemsLoading, setV2ItemsLoading] = useState<Record<string, boolean>>({});
    const [v2ItemsError, setV2ItemsError] = useState<Record<string, string | null>>({});
    const v2ItemsCacheRef = useRef<Record<string, WasteLogItemRecord[]>>({});
    const v2ItemsRequestsRef = useRef<Set<string>>(new Set());
    const v2ItemsGenerationRef = useRef(0);
    const exportOptionsContainerRef = useRef<HTMLDivElement>(null);
    const customExportSectionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!viewingAuditLogForId) {
            setAuditLogs([]);
            return;
        }

        let targetId = viewingAuditLogForId;
        // Some items from cart might have a prefixed ID like 'cabinet:UUID'
        if (targetId.includes(':')) {
            targetId = targetId.split(':').pop() || targetId;
        }

        const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/i.test(targetId);

        if (!isUUID) {
            console.warn('Invalid UUID format for audit log search:', targetId);
            setAuditLogs([]);
            return;
        }

        setIsLoadingAudit(true);
        auditService.getLogs({ entity_id: targetId, limit: 10 })
            .then(setAuditLogs)
            .catch(console.error)
            .finally(() => setIsLoadingAudit(false));
    }, [viewingAuditLogForId]);

    useEffect(() => {
        v2ItemsGenerationRef.current += 1;
        v2ItemsCacheRef.current = {};
        v2ItemsRequestsRef.current.clear();
        setV2ItemsByLogId({});
        setV2ItemsLoading({});
        setV2ItemsError({});
    }, [currentLabId]);

    const loadV2Items = useCallback(async (wasteLogId: string, force = false) => {
        if (!force && Object.prototype.hasOwnProperty.call(v2ItemsCacheRef.current, wasteLogId)) return;
        if (v2ItemsRequestsRef.current.has(wasteLogId)) return;

        if (force) {
            delete v2ItemsCacheRef.current[wasteLogId];
        }
        const generation = v2ItemsGenerationRef.current;
        v2ItemsRequestsRef.current.add(wasteLogId);
        setV2ItemsLoading((current) => ({ ...current, [wasteLogId]: true }));
        setV2ItemsError((current) => ({ ...current, [wasteLogId]: null }));

        try {
            const items = await fetchWasteLogItemsV2(wasteLogId);
            if (generation !== v2ItemsGenerationRef.current) return;
            v2ItemsCacheRef.current[wasteLogId] = items;
            setV2ItemsByLogId((current) => ({ ...current, [wasteLogId]: items }));
        } catch {
            if (generation !== v2ItemsGenerationRef.current) return;
            setV2ItemsError((current) => ({
                ...current,
                [wasteLogId]: i18n.language.startsWith('ko')
                    ? '성분 상세 기록을 불러오지 못했습니다. 배치 요약은 그대로 유지됩니다.'
                    : 'Could not load component details. The batch summary is still available.',
            }));
        } finally {
            v2ItemsRequestsRef.current.delete(wasteLogId);
            if (generation === v2ItemsGenerationRef.current) {
                setV2ItemsLoading((current) => ({ ...current, [wasteLogId]: false }));
            }
        }
    }, [i18n.language]);

    useEffect(() => {
        if (!isExportDialogOpen || exportScope !== 'custom') {
            return;
        }

        requestAnimationFrame(() => {
            const container = exportOptionsContainerRef.current;
            const customSection = customExportSectionRef.current;

            if (!container || !customSection) {
                return;
            }

            customSection.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
            });
        });
    }, [exportScope, isExportDialogOpen]);

    useEffect(() => {
        if (!voidId || isVoiding) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setVoidId(null);
                setVoidReason('');
                setVoidError(null);
                return;
            }

            if (event.key === 'Tab') {
                const focusable = Array.from(voidDialogRef.current?.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ) || []);
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isVoiding, voidId]);

    const { createdAfter, createdBefore } = useMemo(
        () => getLogDateFilters(activeTab, dateRange),
        [activeTab, dateRange]
    );

    const loadLogs = useCallback(async (reset: boolean = false) => {
        setIsLoading(true);
        setError(null);
        try {
            const offset = reset ? 0 : page * PAGE_SIZE;
            const result = await fetchWasteLogs(PAGE_SIZE, offset, {
                search: searchQuery || undefined,
                sortBy,
                sortOrder,
                createdAfter,
                createdBefore,
            });
            if (reset) {
                setLogs(result.logs);
                setPage(0);
            } else {
                setLogs(prev => [...prev, ...result.logs]);
            }
            setTotalCount(result.count);
        } catch {
            setError(t('log_fetch_error'));
        } finally {
            setIsLoading(false);
        }
    }, [createdAfter, createdBefore, page, searchQuery, sortBy, sortOrder, t]);

    // 실험실/검색/정렬/기간 변경 시 재조회
    useEffect(() => {
        loadLogs(true);
        setExpandedSections({});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, currentLabId, dateRange, searchQuery, sortBy, sortOrder]);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSearchQuery(searchInput.trim());
    };

    const handleLoadMore = async () => {
        if (isLoading || !hasMoreLogs) {
            return;
        }

        const nextPage = page + 1;
        setIsLoading(true);
        setError(null);

        try {
            const result = await fetchWasteLogs(PAGE_SIZE, nextPage * PAGE_SIZE, {
                search: searchQuery || undefined,
                sortBy,
                sortOrder,
                createdAfter,
                createdBefore,
            });

            if (result.logs.length === 0) {
                setTotalCount(result.count);
                return;
            }

            setLogs(prev => [...prev, ...result.logs]);
            setTotalCount(result.count);
            setPage(nextPage);
        } catch {
            setError(t('log_fetch_error'));
        } finally {
            setIsLoading(false);
        }
    };

    // 시약명 포함 클라이언트 필터 (서버는 분류/처리자/메모만 검색)
    const filteredLogs = searchQuery
        ? logs.filter(log => {
            const q = searchQuery.toLowerCase();
            const matchText =
                log.disposal_category?.toLowerCase().includes(q) ||
                log.stream_code?.toLowerCase().includes(q) ||
                formatWasteStream(log.stream_code, i18n.language)?.toLowerCase().includes(q) ||
                log.handler_name?.toLowerCase().includes(q) ||
                log.memo?.toLowerCase().includes(q) ||
                log.void_reason?.toLowerCase().includes(q);
            const matchChemical = log.chemicals?.some(
                c =>
                    getWasteChemicalName(c)?.toLowerCase().includes(q) ||
                    (c as any).deleted_location?.toLowerCase().includes(q)
            );
            return matchText || matchChemical;
        })
        : logs;

    const groupedSections = useMemo(
        () => sortBy === 'created_at'
            ? groupWasteLogsByAge(filteredLogs, sortOrder, t, i18n.language)
            : [],
        [filteredLogs, sortOrder, sortBy, t, i18n.language]
    );
    const hasMoreLogs = logs.length < totalCount;
    const selectedDesktopLog = useMemo(
        () => filteredLogs.find((log) => log.id === selectedDesktopLogId) || filteredLogs[0] || null,
        [filteredLogs, selectedDesktopLogId]
    );

    useEffect(() => {
        if (filteredLogs.length === 0) {
            setSelectedDesktopLogId(null);
            return;
        }
        if (!selectedDesktopLogId || !filteredLogs.some((log) => log.id === selectedDesktopLogId)) {
            setSelectedDesktopLogId(filteredLogs[0].id);
        }
    }, [filteredLogs, selectedDesktopLogId]);

    useEffect(() => {
        const expandedLog = expandedId
            ? filteredLogs.find((log) => log.id === expandedId)
            : null;
        if (expandedLog?.schema_version === 2) {
            void loadV2Items(expandedLog.id);
        }
        if (isDesktop && selectedDesktopLog?.schema_version === 2) {
            void loadV2Items(selectedDesktopLog.id);
        }
    }, [expandedId, filteredLogs, isDesktop, loadV2Items, selectedDesktopLog]);

    const sortOptions = useMemo(() => ([
        { value: 'created_at-desc', label: t('log_sort_date_desc') },
        { value: 'created_at-asc', label: t('log_sort_date_asc') },
        { value: 'disposal_category-asc', label: t('log_sort_category_asc') },
        { value: 'disposal_category-desc', label: t('log_sort_category_desc') },
        { value: 'handler_name-asc', label: t('log_sort_handler_asc') },
        { value: 'handler_name-desc', label: t('log_sort_handler_desc') },
    ]), [t]);

    const canVoidLog = useCallback((log: WasteLogRecord) => {
        if (log.voided_at) return false;

        const createdAt = new Date(log.created_at).getTime();
        if (!Number.isFinite(createdAt)) return false;

        const age = Date.now() - createdAt;
        const isAuthor = Boolean(user?.id && log.user_id === user.id);
        if (isAuthor && age <= AUTHOR_CORRECTION_WINDOW_MS) return true;
        return Boolean(currentLabId && canManageLabLogs && age <= ADMIN_CORRECTION_WINDOW_MS);
    }, [canManageLabLogs, currentLabId, user?.id]);

    const openVoidDialog = useCallback((log: WasteLogRecord) => {
        if (!canVoidLog(log)) return;
        setVoidId(log.id);
        setVoidReason('');
        setVoidError(null);
        setStatusMessage(null);
    }, [canVoidLog]);

    useEffect(() => {
        if (initialRecordHandledRef.current || !initialWasteLogId || logs.length === 0) return;
        const target = logs.find((log) => log.id === initialWasteLogId);
        if (!target) return;

        initialRecordHandledRef.current = true;
        setSelectedDesktopLogId(target.id);
        setExpandedId(target.id);
        if (openCorrection) openVoidDialog(target);
    }, [initialWasteLogId, logs, openCorrection, openVoidDialog]);

    const closeVoidDialog = useCallback(() => {
        if (isVoiding) return;
        setVoidId(null);
        setVoidReason('');
        setVoidError(null);
    }, [isVoiding]);

    const handleVoid = async () => {
        if (!voidId || isVoiding) return;
        const targetLog = logs.find((log) => log.id === voidId);
        if (!targetLog || !canVoidLog(targetLog)) {
            setVoidError(i18n.language.startsWith('ko')
                ? '이 기록은 정정할 수 있는 시간이 지났거나 권한이 없습니다.'
                : 'The correction window has expired or you do not have permission.');
            return;
        }

        const normalizedReason = voidReason.replace(/\s+/g, ' ').trim();
        if (normalizedReason.length < 3) {
            setVoidError(i18n.language.startsWith('ko')
                ? '정정 사유를 3자 이상 입력해 주세요.'
                : 'Enter a correction reason of at least 3 characters.');
            return;
        }

        setIsVoiding(true);
        setVoidError(null);
        try {
            const receipt = await voidWasteLogV2(voidId, normalizedReason);
            setLogs((current) => current.map((log) => log.id === voidId
                ? {
                    ...log,
                    voided_at: receipt.voidedAt || new Date().toISOString(),
                    voided_by: receipt.voidedBy,
                    void_reason: receipt.reason,
                }
                : log));
            setStatusMessage(i18n.language.startsWith('ko')
                ? '기록이 삭제되지 않고 정정 상태로 보존되었습니다.'
                : 'The original record was preserved and marked as corrected.');
            setVoidId(null);
            setVoidReason('');
        } catch (voidFailure) {
            setVoidError(voidFailure instanceof Error
                ? voidFailure.message
                : (i18n.language.startsWith('ko') ? '기록을 정정하지 못했습니다.' : 'Could not correct the record.'));
        } finally {
            setIsVoiding(false);
        }
    };

    const formatDate = useCallback((dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }, [i18n.language]);

    // V2 uses one batch amount; legacy records fall back to their historical volume fields.
    const computeTotalVolume = useCallback((log: WasteLogRecord): string | null => {
        if (log.schema_version === 2) {
            if (log.amount_is_unknown) {
                return i18n.language.startsWith('ko') ? '양 모름' : 'Amount unknown';
            }
            if (log.total_amount_value !== null && log.total_amount_value !== undefined && log.total_amount_unit) {
                const approximate = log.amount_is_approximate
                    ? (i18n.language.startsWith('ko') ? '약 ' : 'Approx. ')
                    : '';
                return `${approximate}${log.total_amount_value.toLocaleString()} ${log.total_amount_unit}`;
            }
        }
        if (log.total_volume_ml) return `${log.total_volume_ml} mL`;
        // Try summing individual volumes
        const total = log.chemicals.reduce((sum, c) => {
            if (c.volume) {
                const num = parseFloat(c.volume.replace(/[^0-9.]/g, ''));
                return sum + (isNaN(num) ? 0 : num);
            }
            return sum;
        }, 0);
        return total > 0 ? `${total} mL` : null;
    }, [i18n.language]);

    const getPrimaryChemicalName = (log: WasteLogRecord): string | null => {
        return getWasteChemicalName(log.chemicals?.[0]);
    };

    const getDeletedLocation = useCallback((log: WasteLogRecord): string | null => {
        const first = log.chemicals?.[0] as any;
        let locName: string | null = null;
        if (first?.deleted_location) {
            locName = String(first.deleted_location);
        } else {
            const memo = log.memo || '';
            const match = memo.match(/삭제 위치:\s*([^|]+)/);
            locName = match?.[1]?.trim() || null;
        }
        
        return locName ? translateLocationName(locName, t) : null;
    }, [t]);

    const getDeleteReason = (log: WasteLogRecord): string | null => {
        const memo = (log.memo || '').trim();
        if (!memo) return null;

        // 과거 데이터 호환: "사유 | 삭제 위치: ..." 형태에서 사유만 사용
        const reasonPart = memo.split('|')[0]?.trim() || '';
        const cleaned = reasonPart.replace(/^📝\s*/, '').trim();
        return cleaned || null;
    };

    const formatDisposalCategory = useCallback((category: string): string => {
        if (!DISPOSAL_CATEGORY_VALUES.has(category)) return category;
        return t(getCategoryDetails(category as DisposalCategory).label);
    }, [t]);

    const renderLogCard = useCallback((log: WasteLogRecord) => {
        const isExpanded = expandedId === log.id;
        const totalVol = computeTotalVolume(log);
        const primaryChemicalName = getPrimaryChemicalName(log);
        const deletedLocation = getDeletedLocation(log);
        const deleteReason = getDeleteReason(log);
        const locationBadgeClass = getLocationBadgeClass(deletedLocation);
        const legacyRecord = isLegacyWasteLog(log);
        const streamLabel = formatWasteStream(log.stream_code, i18n.language);
        const displayTitle = streamLabel || (log.disposal_category.startsWith('기타')
            ? (primaryChemicalName || log.disposal_category)
            : formatDisposalCategory(log.disposal_category));
        const canVoidThisLog = canVoidLog(log);
        const v2Items = log.schema_version === 2 ? v2ItemsByLogId[log.id] : undefined;
        const componentCount = v2Items?.length ?? log.chemicals.length;
        const firstChemical = log.chemicals?.[0] as any;
        const firstChemicalName = getWasteChemicalName(firstChemical);
        const shouldCompactSingleDeleteLog = Boolean(
            legacyRecord &&
            deleteReason &&
            log.chemicals.length === 1 &&
            firstChemicalName &&
            firstChemicalName === displayTitle
        );

        return (
            <div
                key={log.id}
                className={`bg-white dark:bg-slate-800 border rounded-xl shadow-sm overflow-hidden transition-all ${
                    log.voided_at
                        ? 'border-slate-300 opacity-80 dark:border-slate-600'
                        : 'border-gray-100 dark:border-slate-700'
                }`}
            >
                <button
                    onClick={() => {
                        if (isDesktop) {
                            setSelectedDesktopLogId(log.id);
                        }
                        setExpandedId(isExpanded ? null : log.id);
                    }}
                    className="w-full p-4 text-left flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-slate-750 transition-colors"
                >
                    <div className={`mt-1.5 w-3 h-3 rounded-full flex-shrink-0 ${getCategoryColor(log.disposal_category)}`} />

                    <div className="flex-1 min-w-0">
                        <div className="flex flex-col gap-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="min-w-0 break-words text-sm font-semibold leading-5 text-slate-800 dark:text-slate-200">
                                    {displayTitle}
                                </span>
                                {legacyRecord && (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600">
                                        {i18n.language.startsWith('ko') ? '기존 기록 · 분류 확인 불가' : 'Legacy record · classification unavailable'}
                                    </span>
                                )}
                                {log.voided_at && (
                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/60">
                                        {i18n.language.startsWith('ko') ? '기록 정정됨' : 'Corrected record'}
                                    </span>
                                )}
                                {deletedLocation && (
                                    <span className={`text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap ${locationBadgeClass}`}>
                                        {deletedLocation}
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                <span className="whitespace-nowrap">{t('log_chemicals_count', { count: componentCount })}</span>
                                {totalVol && <span className="whitespace-nowrap">• {totalVol}</span>}
                                {log.handler_name && <span className="min-w-0 break-words">• {log.handler_name}</span>}
                                <span className="whitespace-nowrap text-slate-400 dark:text-slate-500 sm:ml-auto">
                                    {formatDate(log.created_at)}
                                </span>
                            </div>
                        </div>
                    </div>

                    {isExpanded
                        ? <ChevronUp className="mt-1 w-4 h-4 text-slate-400 flex-shrink-0" />
                        : <ChevronDown className="mt-1 w-4 h-4 text-slate-400 flex-shrink-0" />
                    }
                </button>

                {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 dark:border-slate-700">
                        {log.schema_version === 2 ? (
                            <div className="mt-3">
                                <WasteLogItemsPanel
                                    items={v2Items}
                                    isLoading={Boolean(v2ItemsLoading[log.id])}
                                    error={v2ItemsError[log.id] || null}
                                    onRetry={() => void loadV2Items(log.id, true)}
                                    onViewAudit={setViewingAuditLogForId}
                                />
                            </div>
                        ) : !shouldCompactSingleDeleteLog && (
                            <div className="space-y-2 mt-3">
                                {log.chemicals.map((chem, idx) => (
                                    <div
                                        key={idx}
                                        className="flex justify-between items-center p-2.5 bg-gray-50 dark:bg-slate-750 rounded-lg text-sm"
                                    >
                                        <div>
                                            <div className="font-medium text-slate-700 dark:text-slate-300">
                                                {getWasteChemicalName(chem) || 'Unknown'}
                                            </div>
                                            <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                                {chem.label && t(chem.label as any)}
                                            </div>
                                        </div>
                                        {getWasteChemicalConcentration(chem) && (
                                            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                                {getWasteChemicalConcentration(chem)}
                                            </div>
                                        )}
                                        {(chem as any).id && (
                                            <button
                                                onClick={() => setViewingAuditLogForId((chem as any).id)}
                                                className="mt-1.5 flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-600 transition-colors"
                                            >
                                                <History className="w-3 h-3" /> {t('log_view_diff')}
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {deleteReason && (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 dark:bg-slate-700/30 rounded-lg text-sm text-slate-700 dark:text-slate-300">
                                <div className="min-w-0">
                                    <span className="font-medium">{t('log_disposal_reason')}:</span> {deleteReason}
                                </div>
                                {shouldCompactSingleDeleteLog && firstChemical?.id && (
                                    <button
                                        onClick={() => setViewingAuditLogForId(firstChemical.id)}
                                        className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-blue-500 hover:text-blue-600 transition-colors"
                                    >
                                        <History className="w-3 h-3" /> {t('log_view_diff')}
                                    </button>
                                )}
                            </div>
                        )}

                        {log.schema_version === 2 && (
                            <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900/50 sm:grid-cols-2">
                                <div>
                                    <div className="text-slate-500 dark:text-slate-400">{i18n.language.startsWith('ko') ? '처리 행동' : 'Handling action'}</div>
                                    <div className="mt-0.5 font-semibold text-slate-800 dark:text-slate-100">{formatHandlingAction(log.handling_action, i18n.language)}</div>
                                </div>
                                <div>
                                    <div className="text-slate-500 dark:text-slate-400">{i18n.language.startsWith('ko') ? '판정 상태' : 'Decision status'}</div>
                                    <div className="mt-0.5 font-semibold text-slate-800 dark:text-slate-100">{formatDecisionStatus(log.decision_status, i18n.language)}</div>
                                </div>
                                <div className="sm:col-span-2">
                                    <div className="text-slate-500 dark:text-slate-400">{i18n.language.startsWith('ko') ? '폐기 분류' : 'Waste classification'}</div>
                                    <div className="mt-0.5 break-all font-semibold text-slate-800 dark:text-slate-100">
                                        {streamLabel || '-'}
                                    </div>
                                </div>
                            </div>
                        )}

                        {log.voided_at && (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                                <div className="flex items-center gap-1.5 font-semibold">
                                    <CheckCircle2 className="h-4 w-4" />
                                    {i18n.language.startsWith('ko') ? '원본을 보존하고 정정 처리한 기록입니다.' : 'The original record is preserved and marked as corrected.'}
                                </div>
                                {log.void_reason && <p className="mt-1.5 break-words">{log.void_reason}</p>}
                                <p className="mt-1 text-xs opacity-75">{formatDate(log.voided_at)}</p>
                            </div>
                        )}

                        {!deleteReason && shouldCompactSingleDeleteLog && firstChemical?.id && (
                            <div className="mt-3 flex justify-end">
                                <button
                                    onClick={() => setViewingAuditLogForId(firstChemical.id)}
                                    className="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-600 transition-colors"
                                >
                                    <History className="w-3 h-3" /> {t('log_view_diff')}
                                </button>
                            </div>
                        )}

                        {canVoidThisLog && (
                            <button
                                onClick={() => openVoidDialog(log)}
                                className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/20"
                            >
                                <PencilLine className="w-4 h-4" />
                                {i18n.language.startsWith('ko') ? '기록 정정' : 'Correct record'}
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    }, [
        canVoidLog,
        computeTotalVolume,
        expandedId,
        formatDate,
        formatDisposalCategory,
        getDeletedLocation,
        i18n.language,
        isDesktop,
        loadV2Items,
        openVoidDialog,
        t,
        v2ItemsByLogId,
        v2ItemsError,
        v2ItemsLoading,
    ]);
    const openExportDialog = (format: ExportFormat) => {
        setIsExportMenuOpen(false);
        setExportFormat(format);
        setExportScope(activeTab === 'archive' ? 'archive' : dateRange);
        setCustomExportStartDate('');
        setCustomExportEndDate('');
        setIsExportDialogOpen(true);
    };

    const getExportScopeOptions = useCallback((): Array<{ value: ExportScope; label: string; description: string }> => [
        {
            value: 'today',
            label: t('log_export_scope_today'),
            description: t('log_export_scope_today_desc'),
        },
        {
            value: '7d',
            label: t('log_export_scope_7d'),
            description: t('log_export_scope_7d_desc'),
        },
        {
            value: '30d',
            label: t('log_export_scope_30d'),
            description: t('log_export_scope_30d_desc'),
        },
        {
            value: '90d',
            label: t('log_export_scope_90d'),
            description: t('log_export_scope_90d_desc'),
        },
        {
            value: 'archive',
            label: t('log_export_scope_archive'),
            description: t('log_export_scope_archive_desc'),
        },
        {
            value: 'all',
            label: t('log_export_scope_all'),
            description: t('log_export_scope_all_desc'),
        },
        {
            value: 'custom',
            label: t('log_export_scope_custom'),
            description: t('log_export_scope_custom_desc'),
        },
    ], [t]);

    const fetchLogsForExport = useCallback(async (scope: ExportScope) => {
        const filters = getExportDateFilters(
            scope,
            customExportStartDate,
            customExportEndDate
        );
        const result = await fetchWasteLogs(5000, 0, {
            search: searchQuery || undefined,
            sortBy,
            sortOrder,
            createdAfter: filters.createdAfter,
            createdBefore: filters.createdBefore,
        });

        return result.logs;
    }, [customExportEndDate, customExportStartDate, searchQuery, sortBy, sortOrder]);

    const handleExportExcel = async (scope: ExportScope) => {
        setIsExporting(true);
        try {
            const { downloadRowsAsXlsx } = await import('../utils/excelFiles');
            const allLogs = await fetchLogsForExport(scope);

            const data = allLogs.map((log) => ({
                'Disposed At': formatDate(log.created_at),
                'Category': log.disposal_category,
                'Chemicals': log.chemicals.map(c => getWasteChemicalName(c) || 'Unknown').join(', '),
                'Total Volume': computeTotalVolume(log) || '',
                'Deleted Location': getDeletedLocation(log) || '',
                'Handler': log.handler_name || '',
                'Reason': getDeleteReason(log) || '',
            })).map((row) => Object.fromEntries(
                Object.entries(row).map(([key, value]) => [key, safeSpreadsheetCell(value)])
            ));

            await downloadRowsAsXlsx(
                data,
                'Waste Logs',
                `waste_logs_${getExportFilenameSuffix(scope)}_${new Date().toISOString().slice(0, 10)}.xlsx`,
            );
        } catch (e) {
            console.error(e);
            setError(t('dispose_error'));
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPDF = async (scope: ExportScope) => {
        setIsExporting(true);
        try {
            const html2pdf = (await import('html2pdf.js')).default;
            const allLogs = await fetchLogsForExport(scope);

            const container = document.createElement('div');
            container.style.padding = '20px';
            container.style.fontFamily = 'sans-serif';
            container.style.color = '#000';

            let html = `
                <h2 style="text-align: center; margin-bottom: 20px;">폐기 기록 목록</h2>
                <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
                    <thead>
                        <tr style="background-color: #f3f4f6;">
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">폐기일시</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">폐기구분</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">시약명</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">용량</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">삭제 위치</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">처리자</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">사유</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            allLogs.forEach(log => {
                const chemicals = escapeHtml(log.chemicals.map(c => getWasteChemicalName(c) || 'Unknown').join(', '));
                html += `
                    <tr>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${escapeHtml(formatDate(log.created_at))}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${escapeHtml(log.disposal_category)}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${chemicals}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${escapeHtml(computeTotalVolume(log) || '')}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${escapeHtml(getDeletedLocation(log) || '')}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${escapeHtml(log.handler_name || '')}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${escapeHtml(getDeleteReason(log) || '')}</td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
            container.innerHTML = html;

            const opt = {
                margin: 10,
                filename: `폐기기록_${getExportFilenameSuffix(scope)}_${new Date().toISOString().slice(0, 10)}.pdf`,
                image: { type: 'jpeg' as const, quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'landscape' as const }
            };

            await html2pdf().set(opt).from(container).save();
        } catch (e) {
            console.error(e);
            setError(t('dispose_error'));
        } finally {
            setIsExporting(false);
        }
    };

    const handleConfirmExport = async () => {
        if (exportScope === 'custom') {
            if (!customExportStartDate || !customExportEndDate) {
                setError(t('log_export_custom_required'));
                return;
            }

            if (customExportStartDate > customExportEndDate) {
                setError(t('log_export_custom_invalid_range'));
                return;
            }
        }

        setIsExportDialogOpen(false);

        if (exportFormat === 'pdf') {
            await handleExportPDF(exportScope);
            return;
        }

        await handleExportExcel(exportScope);
    };

    return (
        <div className="p-5 lg:p-8" style={{ paddingBottom: '100px' }}>
            <div className="mx-auto grid w-full max-w-[1320px] grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8">
                <div className="flex min-w-0 flex-col gap-4">
            {showOnboardingGuide && (
                <OnboardingGuideCard
                    icon={<History className="h-5 w-5" />}
                    title={t('onboarding_logs_title')}
                    description={t('onboarding_logs_desc')}
                    points={[
                        t('onboarding_logs_point_1'),
                        t('onboarding_logs_point_2'),
                        t('onboarding_logs_point_3'),
                    ]}
                    onDismiss={() => markGuideSeen('logs')}
                />
            )}

            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3 shrink-0">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {t('log_title')}
                    </h2>
                    {totalCount > 0 && (
                        <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {t('log_records_count', { count: totalCount })}
                        </span>
                    )}
                </div>

                {totalCount > 0 && (
                    <div className="relative ml-auto">
                        <button
                            onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                            disabled={isExporting}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-slate-700 bg-white border border-gray-200 hover:bg-gray-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm whitespace-nowrap shrink-0"
                        >
                            {isExporting ? (
                                <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                            ) : (
                                <Download className="w-4 h-4 shrink-0" />
                            )}
                            <span className="mx-0.5">{isExporting ? t('log_exporting') : t('log_export', '내보내기')}</span>
                            <ChevronDown className="w-3.5 h-3.5 ml-0.5 opacity-60" />
                        </button>

                        {isExportMenuOpen && (
                            <>
                                <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setIsExportMenuOpen(false)}
                                />
                                <div className="absolute right-0 top-full mt-2 w-44 bg-white dark:bg-slate-800 rounded-xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.3)] border border-gray-100 dark:border-slate-700 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                                    <button
                                        onClick={() => {
                                            openExportDialog('pdf');
                                        }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                                    >
                                        <div className="w-6 h-6 rounded-md flex items-center justify-center bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 shrink-0">
                                            <FileText className="w-3.5 h-3.5" />
                                        </div>
                                        <span className="text-slate-700 dark:text-slate-200">{t('log_export_pdf', 'PDF로 내보내기')}</span>
                                    </button>
                                    <button
                                        onClick={() => {
                                            openExportDialog('excel');
                                        }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors mt-0.5"
                                    >
                                        <div className="w-6 h-6 rounded-md flex items-center justify-center bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 shrink-0">
                                            <FileSpreadsheet className="w-3.5 h-3.5" />
                                        </div>
                                        <span className="text-slate-700 dark:text-slate-200">{t('log_export_excel', 'Excel로 내보내기')}</span>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            <div className="flex flex-wrap gap-2">
                {([
                    ['recent', t('log_tab_recent')],
                    ['archive', t('log_tab_archive')],
                ] as Array<[LogViewTab, string]>).map(([value, label]) => {
                    const isActive = activeTab === value;
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setActiveTab(value)}
                            className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${isActive
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                    : 'bg-white text-slate-600 border border-gray-200 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700'
                                }`}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>

            <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-slate-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-slate-200">
                <div className="font-medium">{t('log_management_policy_title')}</div>
                <div className="mt-1 text-slate-600 dark:text-slate-300">
                    {activeTab === 'recent'
                        ? t('log_management_policy_desc_recent')
                        : t('log_management_policy_desc_archive')}
                </div>
            </div>

            {/* 검색 & 정렬 */}
            <div className="flex flex-col gap-2">
                {activeTab === 'recent' && (
                    <div className="flex flex-wrap gap-2">
                        {([
                            ['7d', t('log_range_7d')],
                            ['30d', t('log_range_30d')],
                            ['90d', t('log_range_90d')],
                        ] as Array<[LogDateRange, string]>).map(([value, label]) => {
                            const isActive = dateRange === value;
                            return (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setDateRange(value)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isActive
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-white text-slate-600 border border-gray-200 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700'
                                        }`}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            placeholder={t('log_search_placeholder')}
                            className="w-full h-[42px] pl-9 pr-4 py-2.5 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                    </form>
                    <AppSelect
                        value={`${sortBy}-${sortOrder}`}
                        onChange={(value) => {
                            const [by, order] = value.split('-') as [WasteLogSortBy, 'asc' | 'desc'];
                            setSortBy(by);
                            setSortOrder(order);
                        }}
                        options={sortOptions}
                        className="flex-shrink-0 min-w-[148px]"
                        buttonClassName="flex-shrink-0 min-w-[148px] bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600"
                        align="right"
                    />
                </div>
            </div>

            {/* Error */}
            {error && (
                <div role="alert" className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg text-sm border border-red-100 dark:border-red-900/30">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                </div>
            )}

            {statusMessage && (
                <div aria-live="polite" className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    {statusMessage}
                </div>
            )}

            {/* Empty State */}
            {!isLoading && logs.length === 0 && !error && (
                <EmptyState variant={searchQuery ? 'logs_search' : 'logs'} />
            )}

            {/* Log Cards */}
            <div className="lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-5">
                {sortBy === 'created_at' && groupedSections.length > 0 && (
                    <aside className="hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:block">
                        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('log_tab_recent')}</div>
                        <div className="relative mt-4 space-y-1 border-l border-slate-200 pl-4 dark:border-slate-700">
                            {groupedSections.slice(0, 8).map((section) => {
                                const isExpanded = expandedSections[section.key] ?? false;
                                return (
                                    <button
                                        key={section.key}
                                        type="button"
                                        onClick={() => setExpandedSections(prev => ({
                                            ...prev,
                                            [section.key]: true,
                                        }))}
                                        className={`relative w-full rounded-lg px-3 py-3 text-left transition-colors ${
                                            isExpanded
                                                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        <span className={`absolute -left-[21px] top-4 h-2.5 w-2.5 rounded-full ${
                                            isExpanded ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'
                                        }`} />
                                        <span className="block text-sm font-bold">{section.title}</span>
                                        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{section.subtitle}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </aside>
                )}

                <div className="space-y-3">
                    {sortBy === 'created_at' ? groupedSections.map(section => {
                        const isExpanded = expandedSections[section.key] ?? false;

                        return (
                            <div
                                key={section.key}
                                className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/60"
                            >
                                <button
                                    type="button"
                                    onClick={() => setExpandedSections(prev => ({
                                        ...prev,
                                        [section.key]: !isExpanded,
                                    }))}
                                    className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 text-left dark:border-slate-700"
                                >
                                    <div>
                                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                            {section.title}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                            {section.subtitle}
                                            {section.totalVolumeMl > 0 && ` • ${section.totalVolumeMl} mL`}
                                        </div>
                                    </div>
                                    {isExpanded
                                        ? <ChevronUp className="h-4 w-4 text-slate-400" />
                                        : <ChevronDown className="h-4 w-4 text-slate-400" />
                                    }
                                </button>

                                {isExpanded && (
                                    <div className="space-y-3 p-3">
                                        {section.logs.map(renderLogCard)}
                                    </div>
                                )}
                            </div>
                        );
                    }) : filteredLogs.map(renderLogCard)}
                </div>
            </div>

            {/* Load More */}
            {logs.length > 0 && hasMoreLogs && (
                <button
                    onClick={handleLoadMore}
                    disabled={isLoading}
                    className="w-full py-3 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-colors font-medium"
                >
                    {isLoading
                        ? <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                        : `${t('log_view_more')} (${logs.length}/${totalCount})`
                    }
                </button>
            )}

            {/* Initial Loading */}
            {isLoading && logs.length === 0 && (
                <div className="flex justify-center py-10">
                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                </div>
            )}
                </div>

                <aside className="hidden rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:block">
                    <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t('log_title')}</h3>
                            {selectedDesktopLog && (
                                <p className="mt-1 text-xs font-semibold text-blue-600 dark:text-blue-300">ID: {selectedDesktopLog.id.slice(0, 12)}</p>
                            )}
                        </div>
                    </div>

                    {selectedDesktopLog ? (
                        <div className="space-y-5 py-5">
                            <div>
                                 <div className="flex items-center gap-2">
                                     <span className={`h-3 w-3 rounded-full ${getCategoryColor(selectedDesktopLog.disposal_category)}`} />
                                     <h4 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                                         {formatWasteStream(selectedDesktopLog.stream_code, i18n.language) || formatDisposalCategory(selectedDesktopLog.disposal_category)}
                                     </h4>
                                 </div>
                                 <div className="mt-2 flex flex-wrap gap-1.5">
                                     {isLegacyWasteLog(selectedDesktopLog) && (
                                         <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                                             {i18n.language.startsWith('ko') ? '기존 기록 · 분류 확인 불가' : 'Legacy record · classification unavailable'}
                                         </span>
                                     )}
                                     {selectedDesktopLog.voided_at && (
                                         <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                                             {i18n.language.startsWith('ko') ? '기록 정정됨' : 'Corrected record'}
                                         </span>
                                     )}
                                 </div>
                                 <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{formatDate(selectedDesktopLog.created_at)}</p>
                             </div>

                            <div className="space-y-3 rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800">
                                {[
                                    [t('log_handler_label', '작업자'), selectedDesktopLog.handler_name || t('common_unknown')],
                                     [i18n.language.startsWith('ko') ? '폐액 전체량' : 'Total waste amount', computeTotalVolume(selectedDesktopLog) || '-'],
                                     ...(selectedDesktopLog.schema_version === 2 ? [
                                         [i18n.language.startsWith('ko') ? '폐기 분류' : 'Waste classification', selectedDesktopLog.stream_code || '-'],
                                         [i18n.language.startsWith('ko') ? '판정 상태' : 'Decision status', formatDecisionStatus(selectedDesktopLog.decision_status, i18n.language)],
                                         [i18n.language.startsWith('ko') ? '처리 행동' : 'Handling action', formatHandlingAction(selectedDesktopLog.handling_action, i18n.language)],
                                     ] : []),
                                     [
                                         t('log_chemicals_count', {
                                             count: selectedDesktopLog.schema_version === 2
                                                 ? (v2ItemsByLogId[selectedDesktopLog.id]?.length ?? selectedDesktopLog.chemicals.length)
                                                 : selectedDesktopLog.chemicals.length,
                                         }),
                                         selectedDesktopLog.schema_version === 2
                                             ? (v2ItemsByLogId[selectedDesktopLog.id]?.length ?? selectedDesktopLog.chemicals.length)
                                             : selectedDesktopLog.chemicals.length,
                                     ],
                                    [t('log_disposal_reason'), getDeleteReason(selectedDesktopLog) || '-'],
                                ].map(([label, value]) => (
                                    <div key={String(label)} className="flex items-start justify-between gap-4">
                                        <span className="shrink-0 text-slate-500 dark:text-slate-400">{label}</span>
                                        <span className="text-right font-semibold text-slate-800 dark:text-slate-100">{value}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                    {t('log_chemicals_count', {
                                        count: selectedDesktopLog.schema_version === 2
                                            ? (v2ItemsByLogId[selectedDesktopLog.id]?.length ?? selectedDesktopLog.chemicals.length)
                                            : selectedDesktopLog.chemicals.length,
                                    })}
                                </h4>
                                <div className="mt-3 space-y-2">
                                    {selectedDesktopLog.schema_version === 2 ? (
                                        <WasteLogItemsPanel
                                            items={v2ItemsByLogId[selectedDesktopLog.id]}
                                            isLoading={Boolean(v2ItemsLoading[selectedDesktopLog.id])}
                                            error={v2ItemsError[selectedDesktopLog.id] || null}
                                            onRetry={() => void loadV2Items(selectedDesktopLog.id, true)}
                                            onViewAudit={setViewingAuditLogForId}
                                        />
                                    ) : selectedDesktopLog.chemicals.map((chemical, index) => (
                                        <div key={index} className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                                            <div className="font-semibold text-slate-800 dark:text-slate-100">
                                                {getWasteChemicalName(chemical) || 'Unknown'}
                                            </div>
                                            {getWasteChemicalConcentration(chemical) && (
                                                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                    {getWasteChemicalConcentration(chemical)}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('audit_item_origin_history')}</h4>
                                <button
                                    type="button"
                                    onClick={() => setViewingAuditLogForId((selectedDesktopLog.chemicals?.[0] as any)?.id || selectedDesktopLog.id)}
                                    className="mt-3 w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300"
                                >
                                    {t('log_view_diff')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex min-h-[20rem] items-center justify-center text-center text-sm text-slate-400">
                            {t('log_empty')}
                        </div>
                    )}
                </aside>
            </div>

            {voidId && (
                <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
                    <button
                        type="button"
                        aria-label={i18n.language.startsWith('ko') ? '정정 창 닫기' : 'Close correction dialog'}
                        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
                        onClick={closeVoidDialog}
                    />
                    <div
                        ref={voidDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="void-waste-log-title"
                        aria-describedby="void-waste-log-description"
                        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 dark:border-slate-800">
                            <div>
                                <h3 id="void-waste-log-title" className="font-bold text-slate-900 dark:text-white">
                                    {i18n.language.startsWith('ko') ? '폐기 기록 정정' : 'Correct waste record'}
                                </h3>
                                <p id="void-waste-log-description" className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">
                                    {i18n.language.startsWith('ko')
                                        ? '원본 기록은 삭제되지 않고 정정 상태와 사유가 함께 보존됩니다.'
                                        : 'The original record will not be deleted. Its corrected status and reason are preserved.'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeVoidDialog}
                                disabled={isVoiding}
                                aria-label={i18n.language.startsWith('ko') ? '닫기' : 'Close'}
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-5">
                            <label htmlFor="void-waste-log-reason" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                                {i18n.language.startsWith('ko') ? '정정 사유' : 'Correction reason'}
                            </label>
                            <textarea
                                id="void-waste-log-reason"
                                autoFocus
                                rows={4}
                                maxLength={500}
                                value={voidReason}
                                onChange={(event) => {
                                    setVoidReason(event.target.value);
                                    if (voidError) setVoidError(null);
                                }}
                                placeholder={i18n.language.startsWith('ko')
                                    ? '예: 폐액통 입고 전 잘못 기록하여 실제 처리하지 않음'
                                    : 'Example: Recorded by mistake before the waste was deposited'}
                                className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                            <div className="mt-1 flex items-start justify-between gap-3 text-xs">
                                <span className="text-slate-500 dark:text-slate-400">
                                    {i18n.language.startsWith('ko') ? '3자 이상 입력해 주세요.' : 'Enter at least 3 characters.'}
                                </span>
                                <span className="shrink-0 text-slate-400">{voidReason.length}/500</span>
                            </div>
                            {voidError && (
                                <div role="alert" className="mt-3 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                                    {voidError}
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/50">
                            <button
                                type="button"
                                onClick={closeVoidDialog}
                                disabled={isVoiding}
                                className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            >
                                {t('btn_cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handleVoid}
                                disabled={isVoiding || voidReason.trim().length < 3}
                                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isVoiding && <Loader2 className="h-4 w-4 animate-spin" />}
                                {i18n.language.startsWith('ko') ? '정정 처리' : 'Mark corrected'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isExportDialogOpen && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                        onClick={() => setIsExportDialogOpen(false)}
                    />
                    <div className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
                        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                        {t('log_export_dialog_title')}
                                    </h3>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                        {t(
                                            exportFormat === 'pdf'
                                                ? 'log_export_dialog_desc_pdf'
                                                : 'log_export_dialog_desc_excel'
                                        )}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsExportDialogOpen(false)}
                                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div
                            ref={exportOptionsContainerRef}
                            className="space-y-2 overflow-y-auto p-4"
                        >
                            {getExportScopeOptions().map(option => {
                                const isSelected = exportScope === option.value;

                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setExportScope(option.value)}
                                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${isSelected
                                                ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30'
                                                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                                            }`}
                                    >
                                        <div className="text-sm font-medium text-slate-900 dark:text-white">
                                            {option.label}
                                        </div>
                                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                            {option.description}
                                        </div>
                                    </button>
                                );
                            })}

                            {exportScope === 'custom' && (
                                <div
                                    ref={customExportSectionRef}
                                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"
                                >
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <label className="flex flex-col gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                                            <span>{t('log_export_custom_start')}</span>
                                            <input
                                                type="date"
                                                value={customExportStartDate}
                                                onChange={(e) => setCustomExportStartDate(e.target.value)}
                                                lang={i18n.language.startsWith('ko') ? 'ko' : 'en-US'}
                                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                                            <span>{t('log_export_custom_end')}</span>
                                            <input
                                                type="date"
                                                value={customExportEndDate}
                                                onChange={(e) => setCustomExportEndDate(e.target.value)}
                                                lang={i18n.language.startsWith('ko') ? 'ko' : 'en-US'}
                                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                                            />
                                        </label>
                                    </div>
                                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                        {t('log_export_custom_hint')}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
                            <button
                                type="button"
                                onClick={() => setIsExportDialogOpen(false)}
                                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                            >
                                {t('btn_cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmExport}
                                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                            >
                                {t('log_export_confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Audit Log Modal */}
            {viewingAuditLogForId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setViewingAuditLogForId(null)} />
                    <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                            <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                <History className="w-4 h-4" /> {t('audit_item_origin_history')}
                            </h3>
                            <button onClick={() => setViewingAuditLogForId(null)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded">
                                <X className="w-4 h-4 text-slate-500" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {isLoadingAudit ? (
                                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
                            ) : auditLogs.length === 0 ? (
                                <p className="text-center text-sm text-slate-500 py-8">{t('audit_no_logs')}</p>
                            ) : (
                                auditLogs.map(log => {
                                    const auditLocale = i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US';
                                    const actionLabel = formatAuditActionName(log.action, t, log);
                                    const changeRows = getAuditChangeRows(log, t, i18n.language);
                                    const detailSections = getAuditDetailSections(log, t, i18n.language);
                                    const deletedSection = detailSections.find((section) => section.key === 'before');
                                    const actionTone = log.action === 'delete'
                                        ? 'bg-red-50 text-red-700 ring-red-100 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/50'
                                        : log.action === 'update'
                                            ? 'bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900/50'
                                            : 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50';

                                    return (
                                        <div key={log.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800">
                                            <div className="flex flex-col gap-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${actionTone}`}>
                                                                {actionLabel}
                                                            </span>
                                                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                                                {new Date(log.created_at).toLocaleString(auditLocale)}
                                                            </span>
                                                        </div>
                                                        <p className="mt-2 break-words font-medium leading-5 text-slate-800 dark:text-slate-100">
                                                            {buildAuditEventDescription(log, t, i18n.language)}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                                    <span>{t('audit_actor_label')} {log.actor_name || t('audit_unknown')}</span>
                                                </div>

                                                {changeRows.length > 0 && (
                                                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60">
                                                        <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                            {t('audit_change_summary')}
                                                        </div>
                                                        <div className="space-y-2">
                                                            {changeRows.map((row) => (
                                                                <div key={row.key} className="grid gap-1 text-xs sm:grid-cols-[96px_1fr]">
                                                                    <span className="font-medium text-slate-500 dark:text-slate-400">{row.label}</span>
                                                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                                                        <span className="min-w-0 break-words rounded bg-red-50 px-1.5 py-0.5 text-red-600 line-through dark:bg-red-950/40 dark:text-red-300">
                                                                            {row.fromText}
                                                                        </span>
                                                                        <span className="text-slate-400">→</span>
                                                                        <span className="min-w-0 break-words rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                                                            {row.toText}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {log.action === 'delete' && deletedSection && (
                                                    <div className="rounded-lg border border-red-100 bg-red-50/70 p-3 dark:border-red-900/50 dark:bg-red-950/20">
                                                        <div className="mb-2 text-xs font-semibold text-red-700 dark:text-red-300">
                                                            {t('audit_deleted_data')}
                                                        </div>
                                                        <div className="grid gap-2">
                                                            {deletedSection.rows.map((row) => (
                                                                <div key={row.key} className="grid gap-1 text-xs sm:grid-cols-[96px_1fr]">
                                                                    <span className="font-medium text-slate-500 dark:text-slate-400">{row.label}</span>
                                                                    <span className="break-words text-slate-800 dark:text-slate-100">{row.value}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/** Map disposal category label to a color dot */
function getCategoryColor(category: string): string {
    const lower = category.toLowerCase();
    if (lower.includes('할로겐') || lower.includes('halogen')) return 'bg-purple-500';
    if (lower.includes('유기') || lower.includes('organic')) return 'bg-orange-500';
    if (lower.includes('산') || lower.includes('acid')) return 'bg-red-500';
    if (lower.includes('알칼리') || lower.includes('alkali')) return 'bg-blue-500';
    if (lower.includes('주의') || lower.includes('warn')) return 'bg-yellow-500';
    return 'bg-gray-400';
}

function getLocationBadgeClass(location?: string | null): string {
    const lower = (location || '').toLowerCase();
    if (lower.includes('시약장') || lower.includes('cabinet')) {
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    }
    if (lower.includes('냉장고') || lower.includes('fridge')) {
        return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300';
    }
    if (lower.includes('냉동') || lower.includes('freezer')) {
        return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
    }
    if (lower.includes('후드') || lower.includes('hood')) {
        return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    }
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
}

function getCreatedAfterIso(range: Exclude<LogDateRange, 'all'>): string {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - 1));
    return date.toISOString();
}

function getArchiveCreatedBeforeIso(): string {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (ARCHIVE_CUTOFF_DAYS - 1));
    cutoff.setMilliseconds(cutoff.getMilliseconds() - 1);
    return cutoff.toISOString();
}

function getLogDateFilters(activeTab: LogViewTab, dateRange: LogDateRange): {
    createdAfter?: string;
    createdBefore?: string;
} {
    if (activeTab === 'archive') {
        return {
            createdBefore: getArchiveCreatedBeforeIso(),
        };
    }

    const normalizedRange: Exclude<LogDateRange, 'all'> = dateRange === 'all' ? '30d' : dateRange;
    return {
        createdAfter: getCreatedAfterIso(normalizedRange),
    };
}

function getTodayRange(): { createdAfter: string; createdBefore: string } {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);

    return {
        createdAfter: start.toISOString(),
        createdBefore: end.toISOString(),
    };
}

function getExportDateFilters(
    scope: ExportScope,
    customStartDate?: string,
    customEndDate?: string
): { createdAfter?: string; createdBefore?: string } {
    if (scope === 'today') {
        return getTodayRange();
    }

    if (scope === '7d' || scope === '30d' || scope === '90d') {
        return {
            createdAfter: getCreatedAfterIso(scope),
        };
    }

    if (scope === 'archive') {
        return {
            createdBefore: getArchiveCreatedBeforeIso(),
        };
    }

    if (scope === 'custom' && customStartDate && customEndDate) {
        return {
            createdAfter: toStartOfDayIso(customStartDate),
            createdBefore: toEndOfDayIso(customEndDate),
        };
    }

    return {};
}

function getExportFilenameSuffix(scope: ExportScope): string {
    if (scope === 'today') return 'today';
    if (scope === '7d') return '7days';
    if (scope === '30d') return '30days';
    if (scope === '90d') return '90days';
    if (scope === 'archive') return 'archive';
    if (scope === 'custom') return 'custom';
    return 'all';
}

function toStartOfDayIso(dateString: string): string {
    const date = new Date(`${dateString}T00:00:00`);
    return date.toISOString();
}

function toEndOfDayIso(dateString: string): string {
    const date = new Date(`${dateString}T23:59:59.999`);
    return date.toISOString();
}

function groupWasteLogsByAge(
    logs: WasteLogRecord[],
    sortOrder: 'asc' | 'desc',
    t: (key: string, options?: Record<string, unknown>) => string,
    lang: string
): GroupedLogSection[] {
    const now = Date.now();
    const sections = new Map<string, GroupedLogSection>();

    for (const log of logs) {
        const createdAt = new Date(log.created_at);
        const ageInDays = Math.floor((now - createdAt.getTime()) / (24 * 60 * 60 * 1000));
        const mode: LogGroupMode = ageInDays <= 7 ? 'day' : ageInDays <= 90 ? 'week' : 'month';
        const bucketDate = mode === 'day'
            ? startOfDay(createdAt)
            : mode === 'week'
                ? startOfWeek(createdAt)
                : startOfMonth(createdAt);
        const key = `${mode}:${bucketDate.toISOString()}`;

        const current = sections.get(key);
        const totalVolumeMl = sumLogVolume(log);
        if (current) {
            current.logs.push(log);
            current.totalVolumeMl += totalVolumeMl;
            current.latestCreatedAt = Math.max(current.latestCreatedAt, createdAt.getTime());
            continue;
        }

        sections.set(key, {
            key,
            mode,
            title: formatGroupTitle(mode, bucketDate, lang),
            subtitle: formatGroupSubtitle(mode, bucketDate, createdAt, 1, t, lang),
            logs: [log],
            totalVolumeMl,
            latestCreatedAt: createdAt.getTime(),
        });
    }

    const grouped = Array.from(sections.values()).map(section => ({
        ...section,
        subtitle: formatGroupSubtitle(
            section.mode,
            getGroupBaseDate(section.key),
            new Date(section.latestCreatedAt),
            section.logs.length,
            t,
            lang
        ),
        logs: [...section.logs].sort((a, b) => {
            const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            return sortOrder === 'asc' ? diff : -diff;
        }),
    }));

    return grouped.sort((a, b) => {
        const diff = a.latestCreatedAt - b.latestCreatedAt;
        return sortOrder === 'asc' ? diff : -diff;
    });
}

function sumLogVolume(log: WasteLogRecord): number {
    if (typeof log.total_volume_ml === 'number' && !Number.isNaN(log.total_volume_ml)) {
        return log.total_volume_ml;
    }

    return log.chemicals.reduce((sum, chemical) => {
        if (!chemical.volume) {
            return sum;
        }

        const parsed = parseFloat(chemical.volume.replace(/[^0-9.]/g, ''));
        return Number.isNaN(parsed) ? sum : sum + parsed;
    }, 0);
}

function formatGroupTitle(mode: LogGroupMode, baseDate: Date, lang: string): string {
    const locale = lang.startsWith('ko') ? 'ko-KR' : 'en-US';
    if (mode === 'day') {
        return baseDate.toLocaleDateString(locale, {
            month: 'long',
            day: 'numeric',
            weekday: 'short',
        });
    }

    if (mode === 'week') {
        const endDate = new Date(baseDate);
        endDate.setDate(baseDate.getDate() + 6);
        return `${baseDate.toLocaleDateString(locale, {
            month: 'numeric',
            day: 'numeric',
        })} - ${endDate.toLocaleDateString(locale, {
            month: 'numeric',
            day: 'numeric',
        })}`;
    }

    return baseDate.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
    });
}

function formatGroupSubtitle(
    mode: LogGroupMode,
    baseDate: Date,
    latestDate: Date,
    count: number,
    t: (key: string, options?: Record<string, unknown>) => string,
    lang: string
): string {
    const locale = lang.startsWith('ko') ? 'ko-KR' : 'en-US';
    if (mode === 'day') {
        return t('log_group_day_count', { count });
    }

    if (mode === 'week') {
        return t('log_group_week_summary', {
            count,
            latest: latestDate.toLocaleDateString(locale),
        });
    }

    return t('log_group_month_summary', {
        count,
        month: baseDate.toLocaleDateString(locale, {
            year: 'numeric',
            month: 'long',
        }),
    });
}

function getGroupBaseDate(sectionKey: string): Date {
    const iso = sectionKey.slice(sectionKey.indexOf(':') + 1);
    return new Date(iso);
}

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
    const start = startOfDay(date);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    return start;
}

function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

