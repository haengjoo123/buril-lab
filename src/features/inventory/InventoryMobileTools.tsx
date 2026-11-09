import { useRef, useState } from 'react';
import { CheckCircle2, Download, MoreHorizontal, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAdaptiveDialog } from '../../hooks/useAdaptiveDialog';

interface Props {
    canExport: boolean;
    canSelect: boolean;
    isSelectMode: boolean;
    onExport: () => void;
    onImport: () => void;
    onSelect: () => void;
}

function ToolsSheet({ canExport, canSelect, isSelectMode, onExport, onImport, onSelect, onClose }: Props & { onClose: () => void }) {
    const { t } = useTranslation();
    const ref = useRef<HTMLElement>(null);
    useAdaptiveDialog(ref, onClose);
    const actions = [
        { label: t('inventory_excel_download_view'), icon: Download, run: onExport, disabled: !canExport },
        { label: t('inventory_csv_manage_button'), icon: Upload, run: onImport, disabled: false },
        { label: t(isSelectMode ? 'inventory_exit_select_mode' : 'inventory_enter_select_mode'), icon: CheckCircle2, run: onSelect, disabled: !canSelect },
    ];
    return <div className="adaptive-overlay fixed z-[80] flex items-end justify-center">
        <div className="absolute inset-0 bg-slate-950/30" onClick={onClose} />
        <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="inventory-tools-title" tabIndex={-1}
            className="inventory-tools-sheet relative w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100">
            <div className="mb-2 flex items-center justify-between pl-3">
                <h2 id="inventory-tools-title" className="text-base font-semibold">{t('inventory_tools_title')}</h2>
                <button type="button" onClick={onClose} aria-label={t('btn_close')} className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20} /></button>
            </div>
            {actions.map(({ label, icon: Icon, run, disabled }) => <button key={label} type="button" disabled={disabled}
                onClick={() => { onClose(); run(); }}
                className="flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800">
                <Icon size={20} className="shrink-0 text-slate-500 dark:text-slate-400" />{label}
            </button>)}
        </section>
    </div>;
}

export function InventoryMobileTools(props: Props) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    return <>
        <button type="button" aria-label={t('inventory_tools_open')} aria-haspopup="dialog" aria-expanded={open}
            onClick={() => setOpen(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">
            <MoreHorizontal size={22} />
        </button>
        {open && <ToolsSheet {...props} onClose={() => setOpen(false)} />}
    </>;
}
