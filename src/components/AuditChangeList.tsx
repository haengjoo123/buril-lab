import { useTranslation } from 'react-i18next';
import type { AuditLog } from '../services/auditService';
import { getAuditChangeRows } from '../utils/auditLogFormatting';

/** Shared user-facing change history; raw database values never render here. */
export function AuditChangeList({ diff }: { diff: AuditLog['diff_data'] | undefined }) {
    const { t, i18n } = useTranslation();
    const rows = getAuditChangeRows({ diff_data: diff ?? null }, t, i18n.language);
    if (rows.length === 0) return null;

    return (
        <dl className="mt-2 space-y-2 border-t border-slate-200 pt-2 text-xs dark:border-slate-700">
            {rows.map((row) => (
                <div key={row.key}>
                    <dt className="font-medium text-slate-500 dark:text-slate-400">{row.label}</dt>
                    <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 break-words">
                        <span className="min-w-0 text-red-600 line-through dark:text-red-400">{row.fromText}</span>
                        <span className="text-slate-400">→</span>
                        <span className="min-w-0 text-emerald-700 dark:text-emerald-400">{row.toText}</span>
                    </dd>
                </div>
            ))}
        </dl>
    );
}
