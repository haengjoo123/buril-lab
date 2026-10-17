import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ContainerDialogProps {
    titleId: string;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    closeLabel: string;
    onClose: () => void;
    footer?: React.ReactNode;
    children: React.ReactNode;
    /** Tailwind max-width class for the panel. */
    widthClass?: string;
    as?: 'div' | 'form';
    onSubmit?: (event: React.FormEvent) => void;
}

/**
 * Same frame as the waste-log export dialog: centered card, blurred backdrop,
 * header and footer bars. Escape closes it and focus returns to the opener.
 */
export const ContainerDialog: React.FC<ContainerDialogProps> = ({
    titleId,
    title,
    subtitle,
    closeLabel,
    onClose,
    footer,
    children,
    widthClass = 'max-w-md',
    as = 'div',
    onSubmit,
}) => {
    const panelRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const panel = panelRef.current;
        const firstField = panel?.querySelector<HTMLElement>('[data-autofocus]');
        (firstField ?? panel)?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onCloseRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            opener?.focus();
        };
    }, []);

    const Panel = as;
    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => onCloseRef.current()} aria-hidden="true" />
            <Panel
                ref={panelRef as never}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onSubmit={onSubmit}
                className={`relative flex max-h-[85vh] w-full ${widthClass} flex-col overflow-hidden rounded-2xl bg-white shadow-xl outline-none dark:bg-slate-900`}
            >
                <div className="border-b border-slate-100 p-4 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 id={titleId} className="break-words text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
                            {subtitle && <div className="mt-1 text-sm text-slate-500 break-keep dark:text-slate-400">{subtitle}</div>}
                        </div>
                        <button
                            type="button"
                            onClick={() => onCloseRef.current()}
                            className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                            aria-label={closeLabel}
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4">{children}</div>
                {footer && (
                    <div className="flex gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
                        {footer}
                    </div>
                )}
            </Panel>
        </div>
    );
};

/** Footer button styles taken from the export dialog. */
export const dialogSecondaryButton = 'inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';
export const dialogPrimaryButton = 'inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
export const dialogInput = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
