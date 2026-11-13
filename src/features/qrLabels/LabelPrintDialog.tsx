import React, { useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import { ContainerDialog, dialogInput, dialogPrimaryButton, dialogSecondaryButton } from '../wasteContainers/ContainerDialog';
import { qrCopy } from './copy';
import {
    LABELS_PER_SHEET,
    MAX_LABELS,
    buildLabelSheetModel,
    downloadLabelSheetPdf,
    type LabelSheetItem,
} from './labelSheet';

interface LabelPrintDialogProps {
    items: LabelSheetItem[];
    labId: string | null;
    language: string;
    onClose: () => void;
}

export const LabelPrintDialog: React.FC<LabelPrintDialogProps> = ({ items, labId, language, onClose }) => {
    const copy = qrCopy(language);
    const [start, setStart] = useState(1);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const tooMany = items.length > MAX_LABELS;
    const pages = Math.ceil((items.length + start - 1) / LABELS_PER_SHEET);

    const create = async () => {
        if (tooMany || working || items.length === 0) return;
        setWorking(true);
        setError(null);
        try {
            await downloadLabelSheetPdf(buildLabelSheetModel(items, { labId, skip: start - 1 }));
            onClose();
        } catch (caught) {
            console.error('Failed to create QR labels:', caught);
            setError(copy.printFailed);
        } finally {
            setWorking(false);
        }
    };

    return (
        <ContainerDialog
            titleId="qr-label-print-title"
            title={copy.printTitle}
            subtitle={copy.printSubtitle}
            closeLabel={copy.close}
            onClose={onClose}
            footer={(
                <>
                    <button type="button" onClick={onClose} disabled={working} className={dialogSecondaryButton}>{copy.cancel}</button>
                    <button type="button" onClick={() => void create()} disabled={working || tooMany || items.length === 0} className={dialogPrimaryButton}>
                        {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Printer className="h-4 w-4" aria-hidden="true" />}
                        {working ? copy.printWorking : copy.printDownload}
                    </button>
                </>
            )}
        >
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {copy.printCount(items.length)} · {copy.printPages(Math.max(pages, 1))}
            </p>
            {tooMany && <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{copy.printTooMany(MAX_LABELS)}</p>}
            <label className="mt-4 block text-sm text-slate-700 dark:text-slate-200">
                <span className="font-medium">{copy.printStart}</span>
                <select
                    value={start}
                    onChange={(event) => setStart(Number(event.target.value))}
                    disabled={working}
                    className={`${dialogInput} mt-1`}
                    data-autofocus
                >
                    {Array.from({ length: LABELS_PER_SHEET }, (_, index) => index + 1).map((cell) => (
                        <option key={cell} value={cell}>{cell}</option>
                    ))}
                </select>
            </label>
            <p className="mt-1 break-keep text-xs text-slate-500 dark:text-slate-400">{copy.printStartHelp}</p>
            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </ContainerDialog>
    );
};
