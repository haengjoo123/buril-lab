import React from 'react';
import { useTranslation } from 'react-i18next';

const ROLE_TONE: Record<string, string> = {
    admin: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    pi: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    postdoc: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    graduate: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
};
const DEFAULT_TONE = 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';

/** The single member-role badge used by lab management and the member panel. */
export const LabRoleBadge: React.FC<{ role: string; className?: string }> = ({ role, className }) => {
    const { t } = useTranslation();
    return (
        <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_TONE[role] ?? DEFAULT_TONE} ${className ?? ''}`}>
            {t(`member_role_${role}`, { defaultValue: role })}
        </span>
    );
};
