import React, { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, Container, History, ListChecks, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { WastePolicySettingsPanel } from '../../components/WastePolicySettingsPanel';
import { isWasteV2Enabled } from '../../config/featureFlags';
import type { InventoryItem } from '../../services/inventoryService';
import { useLabStore } from '../../store/useLabStore';
import { GlobalAuditLogsView } from './GlobalAuditLogsView';
import { LabAdminOverviewPanel } from './LabAdminOverviewPanel';
import { LabSafetyCenterPanel } from './LabSafetyCenterPanel';
import { MemberManagementPanel } from './MemberManagementPanel';

type LabAdminTab = 'overview' | 'members' | 'center' | 'activity' | 'waste';

const TAB_PARAM = 'tab';
const TAB_PANEL_ID = 'lab-admin-tabpanel';
/** Tab-specific view params (e.g. ?filter=new on members) that must not follow the user to another tab. */
const TAB_SCOPED_PARAMS = ['filter'];

interface TabDefinition {
    id: LabAdminTab;
    /** Short label that fits five tabs at 320px. */
    labelKey: string;
    /** Longer name shown as a tooltip where one exists. */
    titleKey?: string;
    Icon: LucideIcon;
}

const TABS: TabDefinition[] = [
    { id: 'overview', labelKey: 'admin_tab_overview', Icon: ListChecks },
    { id: 'members', labelKey: 'admin_tab_members_short', titleKey: 'admin_tab_members', Icon: Users },
    { id: 'center', labelKey: 'admin_tab_center_short', titleKey: 'admin_tab_center', Icon: Building2 },
    { id: 'activity', labelKey: 'admin_tab_activity_short', titleKey: 'admin_tab_audit', Icon: History },
    { id: 'waste', labelKey: 'admin_tab_waste_short', titleKey: 'admin_tab_waste_settings', Icon: Container },
];

function resolveTab(raw: string | null, showWasteTab: boolean): LabAdminTab {
    const match = TABS.find((tab) => tab.id === raw);
    if (!match) return 'overview';
    if (match.id === 'waste' && !showWasteTab) return 'overview';
    return match.id;
}

// One accent for the whole admin area, matching the mobile bottom-nav admin tab.
const adminTabClassName = (isActive: boolean) => `flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 border-b-2 px-1.5 py-2.5 text-xs font-medium transition-colors sm:gap-1.5 sm:px-3 sm:text-sm lg:min-w-28 lg:flex-none lg:px-4 ${
    isActive
        ? 'border-red-500 text-red-600 dark:text-red-400'
        : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
}`;

interface LabAdminViewProps {
    /** Starts a waste batch for one reagent (only when waste v2 is on). */
    onStartWasteBatch?: (item: InventoryItem) => Promise<void>;
    /** Changes after a disposal is recorded elsewhere: the overview reloads reagents and containers. */
    refreshKey?: number;
}

const tabElementId = (tab: LabAdminTab) => `lab-admin-tab-${tab}`;

/**
 * Lab admin area (/app/admin): overview first on every device, then members, center,
 * activity log and waste settings. The open tab lives in ?tab= so links and refreshes keep it.
 */
export const LabAdminView: React.FC<LabAdminViewProps> = ({ onStartWasteBatch, refreshKey }) => {
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const currentLabId = useLabStore((state) => state.currentLabId);
    const showWasteTab = isWasteV2Enabled && Boolean(currentLabId);
    const rawTab = searchParams.get(TAB_PARAM);
    const activeTab = resolveTab(rawTab, showWasteTab);
    const visibleTabs = TABS.filter((tab) => tab.id !== 'waste' || showWasteTab);

    // An unknown or unavailable tab falls back to the overview; drop it from the URL too.
    useEffect(() => {
        if (rawTab === null || rawTab === activeTab) return;
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete(TAB_PARAM);
            return next;
        }, { replace: true });
    }, [activeTab, rawTab, setSearchParams]);

    const selectTab = useCallback((tab: LabAdminTab, params?: Record<string, string>) => {
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            TAB_SCOPED_PARAMS.forEach((key) => next.delete(key));
            if (tab === 'overview') next.delete(TAB_PARAM);
            else next.set(TAB_PARAM, tab);
            Object.entries(params ?? {}).forEach(([key, value]) => next.set(key, value));
            return next;
        }, { replace: true });
    }, [setSearchParams]);

    const openNewMembers = useCallback(() => selectTab('members', { filter: 'new' }), [selectTab]);

    // Tab pattern: arrows (wrapping), Home and End move between tabs; focus follows the selection.
    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        // Alt+Left is browser back, Ctrl/Cmd+arrows are text or window shortcuts: leave them alone.
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const ids = visibleTabs.map((tab) => tab.id);
        const index = Math.max(0, ids.indexOf(activeTab));
        let next: LabAdminTab;
        switch (event.key) {
            case 'ArrowRight': next = ids[(index + 1) % ids.length]; break;
            case 'ArrowLeft': next = ids[(index - 1 + ids.length) % ids.length]; break;
            case 'Home': next = ids[0]; break;
            case 'End': next = ids[ids.length - 1]; break;
            default: return;
        }
        event.preventDefault();
        if (next !== activeTab) selectTab(next);
        document.getElementById(tabElementId(next))?.focus();
    };

    return (
        <div className="flex flex-col">
            <div
                role="tablist"
                aria-label={t('tab_audit')}
                onKeyDown={handleTabKeyDown}
                className="sticky top-0 z-10 flex w-full border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
            >
                {visibleTabs.map(({ id, labelKey, titleKey, Icon }) => (
                    <button
                        key={id}
                        id={tabElementId(id)}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === id}
                        // Roving tabindex: Tab reaches the open tab only; arrows move between tabs.
                        tabIndex={activeTab === id ? 0 : -1}
                        aria-controls={activeTab === id ? TAB_PANEL_ID : undefined}
                        title={titleKey ? t(titleKey) : undefined}
                        onClick={() => selectTab(id)}
                        className={adminTabClassName(activeTab === id)}
                    >
                        {/* Five tabs share 320px: labels only on phones, icons from sm up. */}
                        <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
                        <span className="truncate whitespace-nowrap">{t(labelKey)}</span>
                    </button>
                ))}
            </div>

            <div id={TAB_PANEL_ID} role="tabpanel" aria-labelledby={tabElementId(activeTab)}>
                {activeTab === 'overview' ? (
                    <LabAdminOverviewPanel
                        // A new lab starts from a clean slate: no data, toasts or dialogs of the previous one.
                        key={currentLabId ?? 'none'}
                        onStartWasteBatch={onStartWasteBatch}
                        onOpenNewMembers={openNewMembers}
                        refreshKey={refreshKey}
                    />
                ) : activeTab === 'members' ? (
                    <MemberManagementPanel />
                ) : activeTab === 'center' ? (
                    <LabSafetyCenterPanel />
                ) : activeTab === 'waste' && currentLabId ? (
                    <section className="space-y-4 p-4 pb-28 sm:p-5" aria-labelledby="waste-settings-heading">
                        <div>
                            <h2 id="waste-settings-heading" className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
                                <Container className="h-5 w-5 text-red-500" aria-hidden="true" />
                                {t('waste_policy_settings_title')}
                            </h2>
                            <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                                {t('waste_policy_settings_desc')}
                            </p>
                        </div>
                        <WastePolicySettingsPanel labId={currentLabId} />
                    </section>
                ) : (
                    <GlobalAuditLogsView />
                )}
            </div>
        </div>
    );
};
