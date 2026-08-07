/**
 * Expiry Date Utility
 * Shared helper for computing expiry status across the app.
 */

import { calendarDateToUtcMs, parseCalendarDate } from './dateValidation';

export type ExpiryLevel = 'expired' | 'critical' | 'warning' | 'ok' | null;

export interface ExpiryStatus {
    /** Visual level for color coding */
    level: ExpiryLevel;
    /** Number of days remaining (negative = past due) */
    daysLeft: number;
    /** i18n key for badge label */
    labelKey: string;
    /** Dynamic params for the i18n key */
    labelParams: Record<string, string | number>;
}

/**
 * Calculate expiry status from an ISO date string.
 * Returns null if no expiry date is provided.
 *
 * Thresholds:
 *  - expired:  daysLeft < 0
 *  - critical: daysLeft <= 7
 *  - warning:  daysLeft <= 30
 *  - ok:       daysLeft > 30
 */
export function getExpiryStatus(expiryDate?: string | null): ExpiryStatus | null {
    const parsedExpiryDate = parseCalendarDate(expiryDate);
    if (!parsedExpiryDate) return null;

    const today = new Date();
    const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const expiryMs = calendarDateToUtcMs(parsedExpiryDate);

    const diffMs = expiryMs - todayMs;
    const daysLeft = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (daysLeft < 0) {
        return {
            level: 'expired',
            daysLeft,
            labelKey: 'expiry_expired',
            labelParams: { days: Math.abs(daysLeft) },
        };
    }

    if (daysLeft === 0) {
        return {
            level: 'expired',
            daysLeft: 0,
            labelKey: 'expiry_today',
            labelParams: {},
        };
    }

    if (daysLeft <= 7) {
        return {
            level: 'critical',
            daysLeft,
            labelKey: 'expiry_days_left',
            labelParams: { days: daysLeft },
        };
    }

    if (daysLeft <= 30) {
        return {
            level: 'warning',
            daysLeft,
            labelKey: 'expiry_days_left',
            labelParams: { days: daysLeft },
        };
    }

    return {
        level: 'ok',
        daysLeft,
        labelKey: 'expiry_days_left',
        labelParams: { days: daysLeft },
    };
}

/**
 * CSS class mapping for expiry badges (Tailwind).
 * Use these for consistent styling across views.
 */
export function getExpiryBadgeClasses(level: ExpiryLevel): string {
    switch (level) {
        case 'expired':
            return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
        case 'critical':
            return 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 animate-pulse';
        case 'warning':
            return 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
        case 'ok':
            return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400';
        default:
            return '';
    }
}

/**
 * Get a border highlight class for cards containing expiring items.
 */
export function getExpiryCardBorderClass(level: ExpiryLevel): string {
    switch (level) {
        case 'expired':
            return 'border-red-300 dark:border-red-800';
        case 'critical':
            return 'border-red-200 dark:border-red-900/50';
        case 'warning':
            return 'border-amber-200 dark:border-amber-800/50';
        default:
            return '';
    }
}
