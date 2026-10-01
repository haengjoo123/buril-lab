import { useEffect, useState } from 'react';
import { cabinetService, type CabinetTrashEntry } from '../../../services/cabinetService';
import { useFridgeStore } from '../../../store/fridgeStore';

export function CabinetTrash() {
    const cabinetId = useFridgeStore(s => s.cabinetId);
    const [open, setOpen] = useState(false);
    const [entries, setEntries] = useState<CabinetTrashEntry[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!open || !cabinetId) return;
        let active = true;
        setBusy(true); setError('');
        cabinetService.getTrash(cabinetId).then(rows => { if (active) setEntries(rows); })
            .catch(() => { if (active) setError('휴지통을 불러오지 못했습니다. 다시 열어 주세요.'); })
            .finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [open, cabinetId]);
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
            setError(reason instanceof Error ? reason.message : '복원할 공간이 부족하거나 캐비넷이 변경되었습니다. 다시 불러와 주세요.');
        } finally { setBusy(false); }
    }
    return <div className="absolute right-3 top-3 z-20">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 shadow dark:bg-slate-900 dark:text-slate-100">휴지통</button>
        {open && <section aria-label="캐비넷 휴지통" className="mt-2 max-h-[60vh] w-72 overflow-auto rounded-xl border bg-white p-3 text-sm text-slate-800 shadow-xl dark:bg-slate-900 dark:text-slate-100">
            <p className="mb-3">삭제한 선반과 시약은 10일 동안 복원할 수 있습니다. 삭제 후 240시간이 지나면 자동으로 완전히 삭제됩니다.</p>
            {error && <p role="alert" className="mb-2 text-red-600">{error}</p>}
            {busy && <p role="status">처리 중…</p>}
            {!busy && !error && entries.length === 0 && <p>휴지통이 비어 있습니다.</p>}
            {entries.map(entry => <div key={entry.id} className="mb-2 rounded-lg border p-2">
                <p>선반 {entry.payload.shelves.length}개 · 시약 {entry.payload.items.length}개</p>
                {entry.payload.items.length > 0 && <p className="mt-1 truncate text-xs">{entry.payload.items.slice(0, 3).map(item => item.name).join(', ')}{entry.payload.items.length > 3 ? '…' : ''}</p>}
                <p className="text-xs text-slate-500">완전 삭제: {new Date(entry.expires_at).toLocaleString()}</p>
                <button type="button" disabled={busy} onClick={() => void restore(entry.id)} className="mt-2 rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">복원</button>
            </div>)}
        </section>}
    </div>;
}
