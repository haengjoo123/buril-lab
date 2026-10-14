import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cabinetService, type CabinetTrashEntry } from '../../../services/cabinetService';
import { useFridgeStore } from '../../../store/fridgeStore';

export function CabinetTrash() {
    const { t, i18n } = useTranslation();
    const cabinetId = useFridgeStore(s => s.cabinetId);
    const [open, setOpen] = useState(false);
    const [entries, setEntries] = useState<CabinetTrashEntry[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);
    useEffect(() => {
        if (!open || !cabinetId) return;
        let active = true;
        setBusy(true); setError('');
        cabinetService.getTrash(cabinetId).then(rows => { if (active) setEntries(rows); })
            .catch(() => { if (active) setError(t('cabinet_trash_load_failed')); })
            .finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [open, cabinetId, t]);
    async function restore(id: string) {
        if (!cabinetId || busy) return;
        setBusy(true); setError('');
        try {
            await useFridgeStore.getState().saveCabinetStrict();
            await cabinetService.restoreTrash(cabinetId, id);
            if (useFridgeStore.getState().cabinetId !== cabinetId) return;
            await useFridgeStore.getState().loadCabinet(cabinetId);
            setEntries(await cabinetService.getTrash(cabinetId));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t('cabinet_trash_restore_failed'));
        } finally { setBusy(false); }
    }
    return <div ref={rootRef} className="relative">
        <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-haspopup="true"
            title={t('cabinet_trash')}
            aria-label={t('cabinet_trash')}
            className={`rounded-lg p-2 transition-colors ${open
                ? 'bg-blue-50 text-blue-600 dark:bg-slate-800 dark:text-blue-300'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
        >
            <Trash2 className="h-4 w-4" />
        </button>
        {open && <section aria-label={t('cabinet_trash_aria')} className="absolute right-0 top-full z-40 mt-2 max-h-[60vh] w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-2xl border border-gray-200 bg-white/95 p-3 text-sm text-slate-800 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100">
            <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('cabinet_trash_notice')}</p>
            {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
            {busy && <p role="status" className="text-xs">{t('cabinet_processing')}</p>}
            {!busy && !error && entries.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">{t('cabinet_trash_empty')}</p>}
            {entries.map(entry => <div key={entry.id} className="mb-2 rounded-xl border border-gray-200 p-2 dark:border-slate-700">
                <p className="text-xs font-medium">{t('cabinet_trash_summary', { shelves: entry.payload.shelves.length, items: entry.payload.items.length })}</p>
                {entry.payload.items.length > 0 && <p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-300">{entry.payload.items.slice(0, 3).map(item => item.name).join(', ')}{entry.payload.items.length > 3 ? '…' : ''}</p>}
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('cabinet_trash_expires', { date: new Date(entry.expires_at).toLocaleString(i18n.language) })}</p>
                <button type="button" disabled={busy} onClick={() => void restore(entry.id)} className="mt-2 rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50">{t('cabinet_trash_restore')}</button>
            </div>)}
        </section>}
    </div>;
}
