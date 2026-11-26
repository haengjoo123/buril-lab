import type { TFunction } from 'i18next';
import { wasteStreamLabel } from '../../utils/wasteLabels';
import { getLinkScopeLabel } from '../safety-center/safetyCenterUtils';
import { EXPIRY_NAME_PREVIEW, type LabAdminTask } from './labAdminTasks';

/**
 * The words for one "확인할 일" card. Shared by the lab admin overview and the
 * search-bar agent, so both describe the same task the same way.
 */
export interface LabAdminTaskText {
    title: string;
    meta?: string;
    detail?: string;
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

/** "2026-11-13" → "11/13" in either language; the card only needs month and day. */
export function formatMonthDay(date: string): string {
    const [, month, day] = date.split('-').map(Number);
    return month && day ? `${month}/${day}` : date;
}

export function describeLabAdminTask(task: LabAdminTask, t: TFunction, language: string): LabAdminTaskText {
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
        case 'purchase_request':
            return {
                title: t('admin_overview_task_purchase', { count: task.count }),
                meta: t('admin_overview_purchase_days', { days: task.oldestDays }),
            };
        case 'join_password':
            return {
                title: t('admin_overview_task_join_password'),
                detail: t('admin_overview_join_password_detail'),
            };
        case 'daily_inspection_missing':
            return {
                title: t('admin_overview_task_inspection_missing', { count: task.missingDates.length }),
                meta: t('admin_overview_inspection_missing_meta'),
                detail: task.missingDates.map(formatMonthDay).join(', '),
            };
        case 'cabinet_locks':
            return task.reason === 'unlocked'
                ? {
                    title: t('admin_overview_task_cabinet_unlocked', { count: task.reagentCount }),
                    meta: task.cabinetCount > 1
                        ? t('admin_overview_cabinets_more', { name: task.cabinetName, count: task.cabinetCount - 1 })
                        : task.cabinetName,
                    detail: t('admin_overview_cabinet_lock_basis'),
                }
                : {
                    title: t('admin_overview_task_cabinet_lock_unset', { count: task.cabinetCount }),
                    meta: t('admin_overview_cabinet_lock_unset_meta', { count: task.reagentCount }),
                    detail: task.cabinetCount > 1
                        ? t('admin_overview_cabinets_more', { name: task.cabinetName, count: task.cabinetCount - 1 })
                        : task.cabinetName,
                };
    }
}
