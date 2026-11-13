import React from 'react';
import { AlertTriangle, Info, Loader2, ShieldAlert } from 'lucide-react';
import type { ContainerContentCheck } from './useContainerContentCheck';
import { containerContentRuleMessage, containerCopy } from './copy';

interface ContainerContentCheckNoticeProps {
    check: ContainerContentCheck;
    language: string;
}

const MAX_LISTED = 4;

/** Shows how the waste being poured compares with the selected container's recorded contents. */
export const ContainerContentCheckNotice: React.FC<ContainerContentCheckNoticeProps> = ({ check, language }) => {
    const copy = containerCopy(language);
    if (check.status === 'off') return null;

    if (check.status === 'loading') {
        return (
            <div className="flex items-center gap-2 rounded-xl bg-white/60 p-3 text-sm dark:bg-slate-900/30" role="status">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                {copy.contentCheckLoading}
            </div>
        );
    }

    if (check.status === 'unavailable') {
        return (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100" role="status">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="break-keep">{copy.contentCheckUnavailable}</span>
            </div>
        );
    }

    // Nothing recorded yet: there is nothing to compare, so stay out of the way.
    if (check.recordedCount === 0) return null;

    if (check.warnings.length === 0) {
        return (
            <div className="rounded-xl bg-white/60 p-3 text-sm dark:bg-slate-900/30" role="status">
                <p className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
                    <span className="break-keep">{copy.contentCheckNoConflict(check.recordedCount)}</span>
                </p>
                <p className="mt-1 break-keep pl-6 text-xs opacity-70">
                    {check.truncated ? `${copy.contentCheckTruncated} ` : ''}{copy.contentCheckLimits}
                </p>
            </div>
        );
    }

    const hasDanger = check.warnings.some((warning) => warning.severity === 'DANGER');
    const listed = check.warnings.slice(0, MAX_LISTED);
    const remaining = check.warnings.length - listed.length;
    const tone = hasDanger
        ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-100'
        : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100';

    return (
        <div className={`rounded-xl border p-3 text-sm ${tone}`} role="alert">
            <p className="flex items-start gap-2 font-bold">
                {hasDanger
                    ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="break-keep">{hasDanger ? copy.contentCheckDangerTitle : copy.contentCheckWarningTitle}</span>
            </p>
            <ul className="mt-2 space-y-2 pl-6">
                {listed.map((warning) => (
                    <li key={`${warning.ruleId}:${warning.incoming}:${warning.inContainer}`}>
                        <p className="break-words font-semibold">
                            {copy.contentCheckPair(warning.incoming, warning.inContainer)}
                        </p>
                        <p className="break-keep text-xs opacity-90">{containerContentRuleMessage(warning.ruleId, language)}</p>
                    </li>
                ))}
            </ul>
            {remaining > 0 && <p className="mt-2 pl-6 text-xs font-semibold">{copy.contentCheckMore(remaining)}</p>}
            <p className="mt-2 break-keep pl-6 text-xs opacity-80">
                {check.truncated ? `${copy.contentCheckTruncated} ` : ''}{copy.contentCheckLimits}
            </p>
        </div>
    );
};
