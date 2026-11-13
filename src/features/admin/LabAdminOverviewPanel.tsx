import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    AlertCircle,
    Archive,
    BellOff,
    Building2,
    CheckCircle2,
    ChevronDown,
    FlaskConical,
    KeyRound,
    Loader2,
    Lock,
    MapPin,
    MessageSquare,
    RefreshCw,
    Send,
    Trash2,
    Users,
    XCircle,
} from 'lucide-react';
import { InboxQuietState, InboxRow } from '../../components/admin/InboxRow';
import { StatTile } from '../../components/admin/StatTile';
import { useActionToast } from '../../components/admin/ActionToast';
import { CustomDialog } from '../../components/CustomDialog';
import { LabManagementModal } from '../../components/LabManagementModal';
import { useAdaptiveDialog } from '../../hooks/useAdaptiveDialog';
import { useAdaptiveLayout } from '../../hooks/useAdaptiveLayout';
import { useLabStore } from '../../store/useLabStore';
import { invalidateLabAdminAttention, primeLabAdminAttention } from '../../store/useLabAdminAttentionStore';
import { safetyCenterService } from '../../services/safetyCenterService';
import { setWasteContainerStatus, toWasteContainerError } from '../../services/wasteContainerService';
import type { InventoryItem } from '../../services/inventoryService';
import { focusCabinetItem } from '../../services/cabinetFocusService';
import {
    createLabAdminOverviewLoader,
    getLabAdminSourceKeys,
    type LabAdminSourceKey,
    type LabAdminSourceResult,
    type LabAdminSourceValues,
} from '../../services/labAdminOverviewService';
import { labAppRoute } from '../../utils/appRoutes';
import type { InventoryExpiryFilter } from '../inventory/inventoryExpiryFilter';
import { wasteStreamLabel } from '../../utils/wasteLabels';
import { containerCopy, containerErrorMessage } from '../wasteContainers/copy';
import { getLinkScopeLabel, getRequestStatusLabel } from '../safety-center/safetyCenterUtils';
import {
    EXPIRY_NAME_PREVIEW,
    buildLabAdminTasks,
    countLabAdminAttention,
    expiryListFilter,
    readLabAdminSnoozes,
    snoozeLabAdminTask,
    unsnoozeLabAdminTask,
    type LabAdminTask,
} from './labAdminTasks';

/** Content width from which tasks and status sit side by side. */
const WIDE_MIN_WIDTH = 900;
const SEAL_UNDO_MS = 8000;

type SourceState<K extends LabAdminSourceKey> =
    | { status: 'loading' }
    | { status: 'ready'; value: LabAdminSourceValues[K] }
    | { status: 'error' };
type SourceStates = { [K in LabAdminSourceKey]?: SourceState<K> };

type TaskOf<K extends LabAdminTask['kind']> = Extract<LabAdminTask, { kind: K }>;

/** Where focus goes once a card leaves its list: the first target that still has an enabled action wins. */
type FocusTarget = { list: 'active' | 'snoozed'; key: string };

type ConfirmState =
    | { kind: 'link_approve' | 'link_reject'; task: TaskOf<'link_request'> }
    | { kind: 'collect'; task: TaskOf<'waste_container'> }
    | null;

const SOURCE_LABEL_KEYS: Record<LabAdminSourceKey, string> = {
    centerRequests: 'admin_overview_source_center_requests',
    linkRequests: 'admin_overview_source_link_requests',
    inventory: 'admin_overview_source_inventory',
    dangerWarnings: 'admin_overview_source_danger',
    wasteContainers: 'admin_overview_source_waste',
    members: 'admin_overview_source_members',
};

/** What a link scope lets a center see, in plain words (falls back to the short scope label). */
const SCOPE_PLAIN_KEYS: Record<string, string> = {
    summary: 'admin_overview_scope_summary',
    risk_detail: 'admin_overview_scope_risk_detail',
    exports: 'admin_overview_scope_exports',
};

const PRIMARY_BUTTON = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white';
const SECONDARY_BUTTON = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';
const APPROVE_BUTTON = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50';
const REJECT_BUTTON = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50';
const QUIET_BUTTON = 'inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

function readyValue<K extends LabAdminSourceKey>(states: SourceStates, key: K): LabAdminSourceValues[K] | null {
    const state = states[key] as SourceState<K> | undefined;
    return state?.status === 'ready' ? state.value : null;
}

function dueLabel(daysLeft: number, t: TFunction): string {
    if (daysLeft > 0) return t('cmp_lsc_due_in_days', { days: daysLeft });
    if (daysLeft === 0) return t('cmp_lsc_due_today');
    return t('cmp_lsc_overdue_days', { days: -daysLeft });
}

function joinNames(names: string[], total: number, t: TFunction): string {
    const shown = names.slice(0, EXPIRY_NAME_PREVIEW).join(', ');
    const rest = total - Math.min(names.length, EXPIRY_NAME_PREVIEW);
    return rest > 0 ? t('admin_overview_names_more', { names: shown, count: rest }) : shown;
}

/** The card after `key` in `tasks`, else the one before it (null when it was the only one). */
function neighbourKey(tasks: readonly LabAdminTask[], key: string): string | null {
    const index = tasks.findIndex((task) => task.key === key);
    if (index < 0) return null;
    return tasks[index + 1]?.key ?? tasks[index - 1]?.key ?? null;
}

interface TaskText {
    title: string;
    meta?: string;
    detail?: string;
}

function describeTask(task: LabAdminTask, t: TFunction, language: string): TaskText {
    switch (task.kind) {
        case 'center_request':
            return {
                title: t('cmp_lsc_center_check_requests'),
                meta: [dueLabel(task.daysLeft, t), task.centerName].filter(Boolean).join(' · '),
                detail: task.title,
            };
        case 'expiry':
            return {
                title: t('admin_overview_task_expiry'),
                meta: [
                    task.expiredCount > 0 ? t('expiry_summary_expired', { count: task.expiredCount }) : null,
                    task.within7Count > 0 ? t('admin_overview_expiry_within7', { count: task.within7Count }) : null,
                    // Cumulative ("30일 이내", like the inventory banner): shown when it adds reagents past 7 days.
                    task.within30Count > task.within7Count ? t('admin_overview_expiry_within30', { count: task.within30Count }) : null,
                ].filter(Boolean).join(' · '),
                detail: joinNames(task.items.map((item) => item.name), task.items.length, t),
            };
        case 'danger_warning':
            return {
                title: t('admin_overview_task_danger'),
                meta: t('admin_overview_danger_meta', { count: task.count }),
                detail: task.latest
                    ? [
                        [task.latest.primaryName, task.latest.secondaryName].filter(Boolean).join(' + '),
                        task.latest.cabinetName,
                    ].filter(Boolean).join(' · ')
                    : undefined,
            };
        case 'link_request':
            return {
                title: t('cmp_lsc_center_link_requests'),
                meta: task.centerName,
                detail: task.scope.length > 0
                    ? t('cmp_lsc_link_scope', { scope: task.scope.map(getLinkScopeLabel).join(', ') })
                    : undefined,
            };
        case 'waste_container': {
            const detail = [task.label, wasteStreamLabel(task.streamCode, language), task.location].filter(Boolean).join(' · ');
            if (task.reason === 'pickup') {
                return {
                    title: t('admin_overview_task_container_pickup'),
                    meta: t('admin_overview_container_pickup_days', { days: task.pickupDays ?? 0 }),
                    detail,
                };
            }
            if (task.reason === 'sealed') {
                return {
                    title: t('admin_overview_task_container_sealed'),
                    meta: t('admin_overview_container_sealed_days', { days: task.sealedDays ?? 0 }),
                    detail,
                };
            }
            return {
                title: (task.fillPercent ?? 0) > 100
                    ? t('admin_overview_task_container_over')
                    : t('admin_overview_task_container_full'),
                meta: t('admin_overview_container_percent', { percent: task.fillPercent ?? 0 }),
                detail,
            };
        }
        case 'new_members':
            return {
                title: t('admin_overview_task_new_members', { count: task.count }),
                meta: t('admin_overview_new_members_meta'),
            };
        case 'join_password':
            return {
                title: t('admin_overview_task_join_password'),
                detail: t('admin_overview_join_password_detail'),
            };
    }
}

interface ReplyDialogProps {
    task: TaskOf<'center_request'> | null;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onClose: () => void;
    isSubmitting: boolean;
}

/** Small sheet to answer a center request in place (phones: from the bottom). */
function ReplyDialog({ task, value, onChange, onSubmit, onClose, isSubmitting }: ReplyDialogProps) {
    const { t } = useTranslation();
    const dialogRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const isOpen = task !== null;
    useAdaptiveDialog(dialogRef, () => { if (!isSubmitting) onClose(); }, isOpen);
    // Runs after the dialog hook focused the sheet: start in the text box, the only thing to fill in.
    useEffect(() => {
        if (isOpen) textareaRef.current?.focus({ preventScroll: true });
    }, [isOpen]);
    if (!task) return null;
    const canSubmit = value.trim().length > 0 && !isSubmitting;

    return (
        <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="lab-admin-reply-title"
            tabIndex={-1}
            className="adaptive-overlay fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
        >
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => { if (!isSubmitting) onClose(); }} />
            <div className="relative w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl dark:bg-slate-900 sm:rounded-2xl">
                <h3 id="lab-admin-reply-title" className="text-lg font-bold text-slate-900 dark:text-white">
                    {t('admin_overview_reply_title')}
                </h3>
                <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">
                    {[task.centerName, task.title].filter(Boolean).join(' · ')}
                </p>
                <label htmlFor="lab-admin-reply-body" className="sr-only">{t('admin_overview_reply_title')}</label>
                <textarea
                    ref={textareaRef}
                    id="lab-admin-reply-body"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    rows={4}
                    placeholder={t('cmp_lsc_reply_placeholder')}
                    className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 sm:text-sm"
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t('admin_overview_reply_hint', { status: getRequestStatusLabel('submitted') })}
                </p>
                <div className="mt-4 flex gap-2">
                    <button type="button" onClick={onClose} disabled={isSubmitting} className={`${SECONDARY_BUTTON} flex-1 justify-center`}>
                        {t('btn_cancel')}
                    </button>
                    <button type="button" onClick={onSubmit} disabled={!canSubmit} className={`${PRIMARY_BUTTON} flex-1 justify-center`}>
                        {isSubmitting
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <Send className="h-4 w-4" aria-hidden="true" />}
                        {t('cmp_lsc_submit_reply')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function SkeletonRow() {
    return (
        <li aria-hidden="true" className="flex items-start gap-3 py-3">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700" />
            <span className="flex-1 space-y-2">
                <span className="block h-4 w-2/3 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <span className="block h-3 w-1/3 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            </span>
        </li>
    );
}

export interface LabAdminOverviewPanelProps {
    /** Starts a waste batch for one reagent; the "dispose" shortcut is hidden without it. */
    onStartWasteBatch?: (item: InventoryItem) => Promise<void>;
    /** Opens the members tab on the new members. */
    onOpenNewMembers: () => void;
    /** Changes after a disposal is recorded (e.g. from "폐기 시작"): reagents and containers reload in place. */
    refreshKey?: number;
}

/**
 * "이번 주 확인할 일": what needs the admin this week across center requests, reagents,
 * storage warnings, waste containers and members, each handled in place. Mount it with
 * `key={labId}` so a lab switch starts clean.
 */
export function LabAdminOverviewPanel({ onStartWasteBatch, onOpenNewMembers, refreshKey }: LabAdminOverviewPanelProps) {
    const { t, i18n } = useTranslation();
    const language = i18n.language;
    const locale = language.startsWith('ko') ? 'ko-KR' : 'en-US';
    const copy = containerCopy(language);
    const navigate = useNavigate();
    const layout = useAdaptiveLayout();
    const isWide = layout.bounds.width >= WIDE_MIN_WIDTH;
    const labId = useLabStore((state) => state.currentLabId);
    const myLabs = useLabStore((state) => state.myLabs);
    const joinPasswordNeedsChange = Boolean(myLabs.find((membership) => membership.lab_id === labId)?.lab?.join_password_needs_change);
    const { showToast, toastElement } = useActionToast();

    const [sourceKeys] = useState(() => getLabAdminSourceKeys());
    const [loader] = useState(() => createLabAdminOverviewLoader());
    const [states, setStates] = useState<SourceStates>(() => (
        Object.fromEntries(sourceKeys.map((key) => [key, { status: 'loading' }])) as SourceStates
    ));
    const [checkedAt, setCheckedAt] = useState<number | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [snoozes, setSnoozes] = useState(() => (labId ? readLabAdminSnoozes(labId) : {}));
    const [showSnoozed, setShowSnoozed] = useState(false);
    // Tasks with an action in flight (several cards can be working at once).
    const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set());
    const [replyTask, setReplyTask] = useState<TaskOf<'center_request'> | null>(null);
    const [replyText, setReplyText] = useState('');
    const [confirm, setConfirm] = useState<ConfirmState>(null);
    const [isLabSettingsOpen, setIsLabSettingsOpen] = useState(false);
    const tasksHeadingRef = useRef<HTMLHeadingElement>(null);
    const activeListRef = useRef<HTMLUListElement>(null);
    const snoozedListRef = useRef<HTMLUListElement>(null);
    // Set when a card is about to leave its list; applied after the next render (and after a
    // closing dialog has restored its own focus), so keyboard users are not dropped on <body>.
    const pendingFocusRef = useRef<FocusTarget[] | null>(null);
    const [focusRequest, setFocusRequest] = useState(0);

    const applyResult = useCallback(<K extends LabAdminSourceKey>(key: K, result: LabAdminSourceResult<K>) => {
        if (result.status === 'rejected') console.error(`[LabAdminOverview] ${key} failed to load`, result.reason);
        setStates((current) => ({
            ...current,
            [key]: result.status === 'fulfilled' ? { status: 'ready', value: result.value } : { status: 'error' },
        }));
        setCheckedAt(Date.now());
    }, []);

    const setBusy = useCallback((key: string, busy: boolean) => {
        setBusyKeys((current) => {
            if (current.has(key) === busy) return current;
            const next = new Set(current);
            if (busy) next.add(key);
            else next.delete(key);
            return next;
        });
    }, []);
    const isTaskBusy = (key: string) => busyKeys.has(key);

    useEffect(() => {
        if (!labId) return;
        void loader.load(labId, sourceKeys, applyResult);
        return () => loader.invalidate();
    }, [applyResult, labId, loader, sourceKeys]);

    /** Reloads sources; `background` keeps the current rows on screen (after an action). */
    const reloadSources = useCallback((keys: readonly LabAdminSourceKey[], background = false) => {
        if (!labId) return Promise.resolve();
        const available = keys.filter((key) => sourceKeys.includes(key));
        if (available.length === 0) return Promise.resolve();
        if (!background) {
            setStates((current) => ({
                ...current,
                ...Object.fromEntries(available.map((key) => [key, { status: 'loading' }])),
            }));
        }
        return loader.load(labId, available, applyResult).then(() => undefined);
    }, [applyResult, labId, loader, sourceKeys]);

    // A disposal recorded in the cart: drop the disposed reagent and update container fill
    // without remounting (no skeleton rows, the toast stays). Skips the value it mounted with.
    const lastRefreshKeyRef = useRef(refreshKey);
    useEffect(() => {
        if (lastRefreshKeyRef.current === refreshKey) return;
        lastRefreshKeyRef.current = refreshKey;
        void reloadSources(['inventory', 'wasteContainers'], true);
    }, [refreshKey, reloadSources]);

    const refreshAll = () => {
        setIsRefreshing(true);
        void reloadSources(sourceKeys, true).finally(() => setIsRefreshing(false));
    };

    const inventory = readyValue(states, 'inventory');
    const members = readyValue(states, 'members');
    const linkRequests = readyValue(states, 'linkRequests');

    const taskList = useMemo(() => {
        if (checkedAt === null) return { active: [], snoozed: [] };
        return buildLabAdminTasks({
            centerRequests: readyValue(states, 'centerRequests'),
            linkRequests: readyValue(states, 'linkRequests'),
            inventory: readyValue(states, 'inventory')?.datedItems ?? null,
            dangerWarnings: readyValue(states, 'dangerWarnings'),
            wasteContainers: readyValue(states, 'wasteContainers'),
            members: readyValue(states, 'members'),
            joinPasswordNeedsChange,
        }, checkedAt, snoozes);
    }, [checkedAt, joinPasswordNeedsChange, snoozes, states]);

    // Keep the admin tab's red count in step with what this overview shows, without a request of
    // its own: once center requests are in (and containers, when this build loads them).
    const centerRequestsState = states.centerRequests;
    const wasteContainersState = states.wasteContainers;
    useEffect(() => {
        if (!labId || centerRequestsState?.status !== 'ready' || wasteContainersState?.status === 'loading') return;
        const now = Date.now();
        primeLabAdminAttention(labId, countLabAdminAttention({
            centerRequests: centerRequestsState.value,
            wasteContainers: wasteContainersState?.status === 'ready' ? wasteContainersState.value : null,
        }, now, snoozes), now);
    }, [centerRequestsState, labId, snoozes, wasteContainersState]);

    const loadingKeys = sourceKeys.filter((key) => states[key]?.status === 'loading');
    const failedKeys = sourceKeys.filter((key) => states[key]?.status === 'error');
    const isAllLoaded = loadingKeys.length === 0 && failedKeys.length === 0;
    const isQuiet = isAllLoaded && taskList.active.length === 0;
    const checkedLabel = checkedAt !== null
        ? new Date(checkedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
        : undefined;

    // --- focus after a card leaves -------------------------------------------------

    /** Queues focus for after the next render: the first target with an enabled action, else the heading. */
    const requestFocus = (targets: FocusTarget[]) => {
        pendingFocusRef.current = targets;
        setFocusRequest((count) => count + 1);
    };
    /** The card is leaving the list (snoozed, approved, sealed...): focus the next card's first action. */
    const focusPastActiveTask = (key: string) => {
        const next = neighbourKey(taskList.active, key);
        requestFocus(next ? [{ list: 'active', key: next }] : []);
    };

    // A passive effect, so it runs after a closing dialog has put focus back on its opener.
    useEffect(() => {
        const targets = pendingFocusRef.current;
        if (!targets) return;
        pendingFocusRef.current = null;
        for (const target of targets) {
            const tasks = target.list === 'active' ? taskList.active : taskList.snoozed;
            const listElement = target.list === 'active' ? activeListRef.current : snoozedListRef.current;
            const index = tasks.findIndex((task) => task.key === target.key);
            // Rows are rendered in task order, ahead of any loading or error rows.
            const action = index >= 0
                ? listElement?.children[index]?.querySelector<HTMLButtonElement>('button:not(:disabled)')
                : null;
            if (action) {
                action.focus();
                return;
            }
        }
        tasksHeadingRef.current?.focus();
    }, [focusRequest, taskList]);

    // --- actions -----------------------------------------------------------------

    const snooze = (task: LabAdminTask) => {
        if (!labId) return;
        const taskLabId = labId;
        focusPastActiveTask(task.key);
        setSnoozes(snoozeLabAdminTask(taskLabId, task.key));
        // A hidden red card leaves the badge; the effect above primes the new count right away.
        invalidateLabAdminAttention(taskLabId);
        showToast(t('admin_overview_snoozed_toast'), {
            tone: 'info',
            onUndo: () => {
                setSnoozes(unsnoozeLabAdminTask(taskLabId, task.key));
                invalidateLabAdminAttention(taskLabId);
                // The undo button goes away with the toast: land on the card that came back.
                requestFocus([{ list: 'active', key: task.key }]);
            },
        });
    };

    const unsnooze = (task: LabAdminTask) => {
        if (!labId) return;
        // Next hidden card, or the card itself (now in the list) when it was the last one hidden.
        const next = neighbourKey(taskList.snoozed, task.key);
        requestFocus([...(next ? [{ list: 'snoozed' as const, key: next }] : []), { list: 'active', key: task.key }]);
        setSnoozes(unsnoozeLabAdminTask(labId, task.key));
        invalidateLabAdminAttention(labId);
    };

    const closeReply = () => {
        setReplyTask(null);
        setReplyText('');
    };

    const submitReply = async () => {
        const task = replyTask;
        const body = replyText.trim();
        if (!task || !body) return;
        setBusy(task.key, true);
        try {
            await safetyCenterService.addRequestEvent(task.requestId, body, 'submitted');
            if (labId) invalidateLabAdminAttention(labId);
            closeReply();
            focusPastActiveTask(task.key);
            showToast(t('admin_overview_reply_sent'));
            void reloadSources(['centerRequests'], true);
        } catch (error) {
            console.error(error);
            showToast(t('cmp_lsc_reply_save_error'), { tone: 'error' });
        } finally {
            setBusy(task.key, false);
        }
    };

    const respondLink = async (task: TaskOf<'link_request'>, status: 'approved' | 'rejected') => {
        setBusy(task.key, true);
        try {
            await safetyCenterService.respondLabLink(task.linkId, status);
            if (labId) invalidateLabAdminAttention(labId);
            focusPastActiveTask(task.key);
            showToast(status === 'approved'
                ? t('admin_overview_link_approved', { center: task.centerName })
                : t('admin_overview_link_rejected', { center: task.centerName }));
            void reloadSources(['linkRequests'], true);
        } catch (error) {
            console.error(error);
            showToast(t('cmp_lsc_link_update_error'), { tone: 'error' });
        } finally {
            setConfirm(null);
            setBusy(task.key, false);
        }
    };

    const showContainerError = (error: unknown) => {
        console.error(error);
        showToast(containerErrorMessage(toWasteContainerError(error).code, language), { tone: 'error' });
    };

    const sealContainer = async (task: TaskOf<'waste_container'>) => {
        // No dialog holds focus while this runs: move on only if the admin is still on this card.
        const opener = document.activeElement;
        setBusy(task.key, true);
        try {
            await setWasteContainerStatus(task.containerId, 'sealed');
            if (labId) invalidateLabAdminAttention(labId);
            if (document.activeElement === opener || document.activeElement === document.body) focusPastActiveTask(task.key);
            showToast(t('admin_overview_container_sealed_toast', { label: task.label }), {
                durationMs: SEAL_UNDO_MS,
                // Sealed -> active is allowed by set_waste_container_status_v1 ("다시 사용").
                onUndo: async () => {
                    try {
                        await setWasteContainerStatus(task.containerId, 'active');
                        if (labId) invalidateLabAdminAttention(labId);
                        showToast(t('admin_overview_container_reopened_toast'), { tone: 'info' });
                    } catch (error) {
                        showContainerError(error);
                    } finally {
                        void reloadSources(['wasteContainers'], true);
                    }
                },
            });
            void reloadSources(['wasteContainers'], true);
        } catch (error) {
            showContainerError(error);
        } finally {
            setBusy(task.key, false);
        }
    };

    const collectContainer = async (task: TaskOf<'waste_container'>) => {
        setBusy(task.key, true);
        try {
            await setWasteContainerStatus(task.containerId, 'collected');
            if (labId) invalidateLabAdminAttention(labId);
            focusPastActiveTask(task.key);
            showToast(t('admin_overview_container_collected_toast', { label: task.label }));
            void reloadSources(['wasteContainers'], true);
        } catch (error) {
            showContainerError(error);
        } finally {
            setConfirm(null);
            setBusy(task.key, false);
        }
    };

    const startDisposal = async (task: TaskOf<'expiry'>, item: InventoryItem) => {
        if (!onStartWasteBatch) return;
        setBusy(task.key, true);
        try {
            await onStartWasteBatch(item);
            showToast(t('admin_overview_disposal_started'));
        } catch (error) {
            console.error(error);
            const message = error instanceof Error && error.message ? error.message : t('inventory_start_waste_batch_failed');
            showToast(message, { tone: 'error' });
        } finally {
            setBusy(task.key, false);
        }
    };

    const openInventory = (filter: InventoryExpiryFilter) => {
        navigate(`${labAppRoute('/inventory')}?filter=${filter}`);
    };

    const openCabinet = (task: TaskOf<'danger_warning'>) => {
        const warning = task.latest;
        if (!warning?.cabinetId) return;
        const { cabinetId, itemId, shelfId } = warning;
        navigate(labAppRoute(`/cabinet?id=${cabinetId}`), itemId ? { state: { cabinetId, itemId } } : undefined);
        if (itemId) void focusCabinetItem({ cabinetId, itemId, shelfId });
    };

    const renderActions = (task: LabAdminTask): React.ReactNode => {
        const isBusy = isTaskBusy(task.key);
        const busyIcon = <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;
        const snoozeButton = (
            <button type="button" onClick={() => snooze(task)} disabled={isBusy} className={QUIET_BUTTON}>
                <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
                {t('lab_admin_snooze_week')}
            </button>
        );
        let primary: React.ReactNode = null;

        switch (task.kind) {
            case 'center_request':
                primary = (
                    <button type="button" onClick={() => { setReplyText(''); setReplyTask(task); }} disabled={isBusy} className={PRIMARY_BUTTON}>
                        <MessageSquare className="h-4 w-4" aria-hidden="true" />
                        {t('admin_overview_reply_write')}
                    </button>
                );
                break;
            case 'expiry': {
                const single = task.items.length === 1 && task.items[0].level !== 'warning' ? task.items[0] : null;
                const item = single ? inventory?.datedItems.find((row) => row.id === single.id) : undefined;
                primary = item && onStartWasteBatch ? (
                    <button type="button" onClick={() => void startDisposal(task, item)} disabled={isBusy} className={PRIMARY_BUTTON}>
                        {isBusy ? busyIcon : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                        {t('inventory_start_waste_batch')}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => openInventory(expiryListFilter(task))}
                        className={SECONDARY_BUTTON}
                    >
                        {t('admin_overview_open_list')}
                    </button>
                );
                break;
            }
            case 'danger_warning':
                primary = task.latest?.cabinetId ? (
                    <button type="button" onClick={() => openCabinet(task)} className={SECONDARY_BUTTON}>
                        <MapPin className="h-4 w-4" aria-hidden="true" />
                        {t('admin_overview_view_location')}
                    </button>
                ) : null;
                break;
            case 'link_request':
                primary = (
                    <>
                        <button type="button" onClick={() => setConfirm({ kind: 'link_approve', task })} disabled={isBusy} className={APPROVE_BUTTON}>
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            {t('cmp_lsc_approve')}
                        </button>
                        <button type="button" onClick={() => setConfirm({ kind: 'link_reject', task })} disabled={isBusy} className={REJECT_BUTTON}>
                            <XCircle className="h-4 w-4" aria-hidden="true" />
                            {t('cmp_lsc_reject')}
                        </button>
                    </>
                );
                break;
            case 'waste_container':
                primary = task.reason === 'fill' ? (
                    <button type="button" onClick={() => void sealContainer(task)} disabled={isBusy} className={PRIMARY_BUTTON}>
                        {isBusy ? busyIcon : <Lock className="h-4 w-4" aria-hidden="true" />}
                        {copy.seal}
                    </button>
                ) : (
                    <button type="button" onClick={() => setConfirm({ kind: 'collect', task })} disabled={isBusy} className={SECONDARY_BUTTON}>
                        <Archive className="h-4 w-4" aria-hidden="true" />
                        {copy.collect}
                    </button>
                );
                break;
            case 'new_members':
                primary = (
                    <button type="button" onClick={onOpenNewMembers} className={SECONDARY_BUTTON}>
                        <Users className="h-4 w-4" aria-hidden="true" />
                        {t('admin_overview_check_roles')}
                    </button>
                );
                break;
            case 'join_password':
                primary = (
                    <button type="button" onClick={() => setIsLabSettingsOpen(true)} className={SECONDARY_BUTTON}>
                        <KeyRound className="h-4 w-4" aria-hidden="true" />
                        {t('admin_overview_open_settings')}
                    </button>
                );
                break;
        }

        return (
            <>
                {primary}
                {snoozeButton}
            </>
        );
    };

    const scopePlainText = (scope: string[]) => (
        scope.map((value) => (SCOPE_PLAIN_KEYS[value] ? t(SCOPE_PLAIN_KEYS[value]) : getLinkScopeLabel(value))).join(', ')
    );

    const approvedCenters = (linkRequests ?? []).filter((link) => link.link_status === 'approved');
    const statValue = (key: LabAdminSourceKey, value: React.ReactNode) => {
        const state = states[key]?.status;
        if (state === 'loading') {
            // The task list already announces loading once; the placeholder itself is decoration.
            return <span className="inline-block h-7 w-10 animate-pulse rounded bg-slate-200 align-middle dark:bg-slate-700" aria-hidden="true" />;
        }
        return state === 'ready' ? value : '–';
    };

    if (!labId) return null;

    return (
        <div ref={layout.attachContainer} className="p-4 sm:p-5" style={{ paddingBottom: '100px' }}>
            {toastElement}
            <div className={isWide ? 'grid grid-cols-[minmax(0,1fr)_minmax(15rem,20rem)] items-start gap-5' : 'flex flex-col gap-5'}>
                <section
                    aria-labelledby="lab-admin-tasks-heading"
                    className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"
                >
                    <div className="flex min-h-11 items-center gap-2">
                        <h2
                            ref={tasksHeadingRef}
                            id="lab-admin-tasks-heading"
                            tabIndex={-1}
                            className="text-base font-bold text-slate-900 outline-none dark:text-white"
                        >
                            {t('admin_overview_tasks_title')}
                        </h2>
                        {loadingKeys.length === 0 && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-sm font-semibold tabular-nums text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                {taskList.active.length}
                            </span>
                        )}
                        <div className="ml-auto flex items-center gap-1">
                            {/* The quiet state already says when it was checked; phones keep the row to one line. */}
                            {!isQuiet && checkedLabel && (
                                <span className="hidden whitespace-nowrap text-xs text-slate-500 dark:text-slate-400 sm:inline">
                                    {t('admin_inbox_last_checked', { time: checkedLabel })}
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={refreshAll}
                                disabled={isRefreshing || loadingKeys.length > 0}
                                aria-label={t('admin_overview_refresh')}
                                title={checkedLabel ? t('admin_inbox_last_checked', { time: checkedLabel }) : t('admin_overview_refresh')}
                                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                            >
                                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    {loadingKeys.length > 0 && <span role="status" className="sr-only">{t('loading')}</span>}

                    {(taskList.active.length > 0 || loadingKeys.length > 0 || failedKeys.length > 0) && (
                        <ul ref={activeListRef} className="divide-y divide-slate-100 dark:divide-slate-700">
                            {taskList.active.map((task) => {
                                const text = describeTask(task, t, language);
                                return (
                                    <InboxRow
                                        key={task.key}
                                        severity={task.severity}
                                        title={text.title}
                                        meta={text.meta}
                                        detail={text.detail}
                                        actions={renderActions(task)}
                                    />
                                );
                            })}
                            {loadingKeys.map((key) => <SkeletonRow key={`loading:${key}`} />)}
                            {failedKeys.map((key) => (
                                <li key={`error:${key}`} className="flex flex-wrap items-center gap-2 py-3">
                                    <AlertCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
                                    <p className="min-w-0 flex-1 text-sm text-slate-600 dark:text-slate-300">
                                        {t('admin_overview_source_error', { source: t(SOURCE_LABEL_KEYS[key]) })}
                                    </p>
                                    <button type="button" onClick={() => void reloadSources([key])} className={SECONDARY_BUTTON}>
                                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                                        {t('search_retry')}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {isQuiet && <InboxQuietState message={t('admin_overview_quiet')} lastCheckedLabel={checkedLabel} />}

                    {taskList.snoozed.length > 0 && (
                        <div className="border-t border-slate-100 dark:border-slate-700">
                            <button
                                type="button"
                                aria-expanded={showSnoozed}
                                aria-controls="lab-admin-snoozed"
                                onClick={() => setShowSnoozed((open) => !open)}
                                className="flex min-h-11 w-full items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                            >
                                <ChevronDown className={`h-4 w-4 transition-transform ${showSnoozed ? 'rotate-180' : ''}`} aria-hidden="true" />
                                {t('admin_overview_snoozed_count', { count: taskList.snoozed.length })}
                            </button>
                            {showSnoozed && (
                                <ul ref={snoozedListRef} id="lab-admin-snoozed" className="divide-y divide-slate-100 dark:divide-slate-700">
                                    {taskList.snoozed.map((task) => {
                                        const text = describeTask(task, t, language);
                                        return (
                                            <InboxRow
                                                key={task.key}
                                                severity={task.severity}
                                                title={text.title}
                                                meta={text.meta}
                                                actions={(
                                                    <button type="button" onClick={() => unsnooze(task)} className={SECONDARY_BUTTON}>
                                                        {t('admin_overview_unsnooze')}
                                                    </button>
                                                )}
                                            />
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    )}
                </section>

                <section aria-labelledby="lab-admin-status-heading" className="min-w-0">
                    <h2 id="lab-admin-status-heading" className="mb-3 text-base font-bold text-slate-900 dark:text-white">
                        {t('admin_overview_status_title')}
                    </h2>
                    <div className={`grid gap-3 ${isWide ? 'grid-cols-1' : 'grid-cols-2'}`}>
                        <StatTile
                            label={t('admin_overview_stat_members')}
                            value={statValue('members', members?.length ?? 0)}
                            Icon={Users}
                        />
                        <StatTile
                            label={t('admin_overview_stat_reagents')}
                            value={statValue('inventory', inventory?.totalCount ?? 0)}
                            caption={inventory && inventory.casMissingCount > 0
                                ? t('admin_overview_stat_cas_missing', { count: inventory.casMissingCount })
                                : undefined}
                            tone={inventory && inventory.casMissingCount > 0 ? 'attention' : 'neutral'}
                            Icon={FlaskConical}
                        />
                        <div className={isWide ? '' : 'col-span-2'}>
                            <StatTile
                                label={t('cmp_lsc_linked_centers')}
                                value={statValue('linkRequests', approvedCenters.length)}
                                caption={linkRequests
                                    ? (approvedCenters.length > 0
                                        ? approvedCenters.map((link) => link.center_name).join(', ')
                                        : t('admin_overview_stat_no_center'))
                                    : undefined}
                                Icon={Building2}
                            />
                        </div>
                    </div>
                </section>
            </div>

            <ReplyDialog
                task={replyTask}
                value={replyText}
                onChange={setReplyText}
                onSubmit={() => void submitReply()}
                onClose={closeReply}
                isSubmitting={replyTask !== null && isTaskBusy(replyTask.key)}
            />

            <CustomDialog
                isOpen={confirm?.kind === 'link_approve'}
                onClose={() => setConfirm(null)}
                type="confirm"
                title={t('admin_overview_link_approve_title')}
                description={confirm?.kind === 'link_approve'
                    ? t('admin_overview_link_approve_body', { center: confirm.task.centerName, scope: scopePlainText(confirm.task.scope) })
                    : undefined}
                confirmText={t('cmp_lsc_approve')}
                onConfirm={() => { if (confirm?.kind === 'link_approve') void respondLink(confirm.task, 'approved'); }}
                isConfirmLoading={confirm?.kind === 'link_approve' && isTaskBusy(confirm.task.key)}
                preventCloseWhileLoading
            />

            <CustomDialog
                isOpen={confirm?.kind === 'link_reject'}
                onClose={() => setConfirm(null)}
                type="confirm"
                title={t('admin_overview_link_reject_title')}
                description={confirm?.kind === 'link_reject'
                    ? t('admin_overview_link_reject_body', { center: confirm.task.centerName })
                    : undefined}
                confirmText={t('cmp_lsc_reject')}
                onConfirm={() => { if (confirm?.kind === 'link_reject') void respondLink(confirm.task, 'rejected'); }}
                isDestructive
                isConfirmLoading={confirm?.kind === 'link_reject' && isTaskBusy(confirm.task.key)}
                preventCloseWhileLoading
            />

            <CustomDialog
                isOpen={confirm?.kind === 'collect'}
                onClose={() => setConfirm(null)}
                type="confirm"
                title={copy.collect}
                description={confirm?.kind === 'collect'
                    ? `${confirm.task.label} · ${copy.collectConfirm} ${t('admin_overview_collect_irreversible')}`
                    : undefined}
                confirmText={copy.collect}
                onConfirm={() => { if (confirm?.kind === 'collect') void collectContainer(confirm.task); }}
                isDestructive
                isConfirmLoading={confirm?.kind === 'collect' && isTaskBusy(confirm.task.key)}
                preventCloseWhileLoading
            />

            {isLabSettingsOpen && <LabManagementModal onClose={() => setIsLabSettingsOpen(false)} />}
        </div>
    );
}
