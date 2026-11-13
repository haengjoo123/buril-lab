import React, { useState } from 'react';
import { Loader2, Truck, X } from 'lucide-react';
import {
    cancelWasteContainerPickup,
    requestWasteContainerPickup,
    toWasteContainerError,
    type WasteContainer,
} from '../../services/wasteContainerService';
import { formatLabelDate } from './containerLabel';
import { containerCopy, containerErrorMessage } from './copy';
import { dialogInput } from './ContainerDialog';

interface ContainerPickupSectionProps {
    container: WasteContainer;
    language: string;
    disabled?: boolean;
    onChanged: (container: WasteContainer) => void;
}

const actionButton = 'inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/** Lets any member ask for a container to be collected, and shows a pending request. */
export const ContainerPickupSection: React.FC<ContainerPickupSectionProps> = ({ container, language, disabled, onChanged }) => {
    const copy = containerCopy(language);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (container.status === 'collected') return null;

    const requestedAt = container.pickupRequestedAt ?? null;

    const run = async (action: 'request' | 'cancel') => {
        setBusy(true);
        setError(null);
        try {
            const updated = action === 'request'
                ? await requestWasteContainerPickup(container.id, note)
                : await cancelWasteContainerPickup(container.id);
            setNote('');
            onChanged(updated);
        } catch (caught) {
            const code = toWasteContainerError(caught).code;
            // The shared admin_required text is about collection; withdrawing has its own rule.
            setError(action === 'cancel' && code === 'admin_required'
                ? copy.pickupCancelDenied
                : containerErrorMessage(code, language));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
            <h4 className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                <Truck className="h-4 w-4" aria-hidden="true" />
                {copy.pickupTitle}
            </h4>
            {requestedAt ? (
                <>
                    <p className="mt-1 break-keep text-sm text-slate-600 dark:text-slate-300">
                        {copy.pickupRequested(formatLabelDate(requestedAt))}
                    </p>
                    {container.pickupRequestNote && (
                        <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">{container.pickupRequestNote}</p>
                    )}
                    <div className="mt-3">
                        <button
                            type="button"
                            onClick={() => void run('cancel')}
                            disabled={busy || disabled}
                            className={`${actionButton} border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300`}
                        >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
                            {copy.pickupCancel}
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <p className="mt-1 break-keep text-sm text-slate-600 dark:text-slate-300">{copy.pickupHelp}</p>
                    <label className="mt-3 block text-sm text-slate-600 dark:text-slate-300">
                        <span>{copy.pickupNote}</span>
                        <input
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            maxLength={500}
                            placeholder={copy.pickupNotePlaceholder}
                            disabled={busy || disabled}
                            className={`${dialogInput} mt-1`}
                        />
                    </label>
                    <div className="mt-3">
                        <button
                            type="button"
                            onClick={() => void run('request')}
                            disabled={busy || disabled}
                            className={`${actionButton} border-blue-200 bg-white text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-slate-800 dark:text-blue-300`}
                        >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Truck className="h-4 w-4" aria-hidden="true" />}
                            {copy.pickupRequest}
                        </button>
                    </div>
                </>
            )}
            {error && <p className="mt-2 break-keep text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </section>
    );
};
