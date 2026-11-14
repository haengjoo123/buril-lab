import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import {
    SDS_ACCEPT,
    deleteSdsDocument,
    fetchSdsDocuments,
    getSdsDocumentUrl,
    matchSdsDocuments,
    toSdsError,
    uploadSdsDocument,
    type SdsDocument,
    type SdsErrorCode,
} from '../../services/inventorySdsService';

interface InventorySdsSectionProps {
    labId: string | null;
    casNumber: string | null;
    brand: string | null;
    productNumber: string | null;
    language: string;
}

const COPY = {
    ko: {
        title: '보관 중인 SDS 파일',
        help: '공급사 SDS를 올려 두면 같은 CAS 번호나 제품번호의 모든 병에서 볼 수 있습니다.',
        empty: '이 제품의 SDS 파일이 아직 없습니다.',
        upload: 'SDS 파일 올리기',
        uploading: '올리는 중',
        open: '열기',
        remove: '삭제',
        confirmRemove: '이 SDS 파일을 삭제할까요? 같은 제품의 다른 병에서도 사라집니다.',
        loadFailed: 'SDS 파일 목록을 불러오지 못했습니다.',
        noKey: 'CAS 번호나 제품번호가 있어야 SDS 파일을 연결할 수 있습니다. 먼저 재고 정보를 수정하세요.',
        added: (date: string) => `${date} 등록`,
        errors: {
            too_large: '20MB 이하 파일만 올릴 수 있습니다.',
            unsupported_type: 'PDF, PNG, JPG 파일만 올릴 수 있습니다.',
            missing_key: 'CAS 번호나 제품번호가 올바르지 않습니다.',
            access_denied: '이 공간에 SDS 파일을 올리거나 지울 권한이 없습니다.',
            admin_required: '다른 사람이 올린 SDS 파일은 연구실 관리자만 지울 수 있습니다.',
            unknown: 'SDS 파일 작업을 완료하지 못했습니다. 잠시 후 다시 시도하세요.',
        } as Record<SdsErrorCode, string>,
    },
    en: {
        title: 'Stored SDS files',
        help: 'An uploaded supplier SDS appears on every bottle with the same CAS number or product number.',
        empty: 'No SDS file for this product yet.',
        upload: 'Upload SDS file',
        uploading: 'Uploading',
        open: 'Open',
        remove: 'Delete',
        confirmRemove: 'Delete this SDS file? It disappears from every bottle of this product.',
        loadFailed: 'Could not load SDS files.',
        noKey: 'A CAS number or product number is needed to attach an SDS. Edit the item first.',
        added: (date: string) => `Added ${date}`,
        errors: {
            too_large: 'Files must be 20 MB or smaller.',
            unsupported_type: 'Only PDF, PNG or JPG files can be uploaded.',
            missing_key: 'The CAS number or product number is not valid.',
            access_denied: 'You cannot upload or delete SDS files in this space.',
            admin_required: 'Only a lab admin can delete an SDS file someone else uploaded.',
            unknown: 'Could not complete the SDS action. Try again shortly.',
        } as Record<SdsErrorCode, string>,
    },
};

const formatSize = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** SDS files for the selected item's product, with upload, open and delete. */
export const InventorySdsSection: React.FC<InventorySdsSectionProps> = ({ labId, casNumber, brand, productNumber, language }) => {
    const copy = language.startsWith('ko') ? COPY.ko : COPY.en;
    const inputRef = useRef<HTMLInputElement>(null);
    const [documents, setDocuments] = useState<{ labId: string | null; rows: SdsDocument[] } | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const hasKey = Boolean(casNumber?.trim() || productNumber?.trim());

    useEffect(() => {
        let cancelled = false;
        fetchSdsDocuments(labId)
            .then((rows) => {
                if (cancelled) return;
                setDocuments({ labId, rows });
                setLoadFailed(false);
            })
            .catch((loadError) => {
                console.error('Failed to load SDS files:', loadError);
                if (!cancelled) setLoadFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [labId]);

    const matches = useMemo(
        () => (documents && documents.labId === labId ? matchSdsDocuments(documents.rows, { casNumber, brand, productNumber }) : []),
        [brand, casNumber, documents, labId, productNumber],
    );

    const fail = (caught: unknown) => setError(copy.errors[toSdsError(caught).code]);

    const upload = async (file: File | undefined) => {
        if (!file) return;
        setBusy('upload');
        setError(null);
        try {
            const created = await uploadSdsDocument(labId, file, { casNumber, brand, productNumber });
            setDocuments((current) => ({ labId, rows: [created, ...(current?.labId === labId ? current.rows : [])] }));
        } catch (caught) {
            fail(caught);
        } finally {
            setBusy(null);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    const open = async (document: SdsDocument) => {
        // Open the window first so pop-up blockers treat it as the click's result.
        // ("noopener" would make window.open return null, so the opener is cut off by hand.)
        const popup = window.open('', '_blank');
        if (popup) popup.opener = null;
        setError(null);
        try {
            const url = await getSdsDocumentUrl(document);
            if (popup) popup.location.href = url;
            else window.location.assign(url);
        } catch (caught) {
            popup?.close();
            fail(caught);
        }
    };

    const remove = async (document: SdsDocument) => {
        if (!window.confirm(copy.confirmRemove)) return;
        setBusy(document.id);
        setError(null);
        try {
            await deleteSdsDocument(document.id);
            setDocuments((current) => (current ? { ...current, rows: current.rows.filter((row) => row.id !== document.id) } : current));
        } catch (caught) {
            fail(caught);
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className="rounded-lg border border-slate-200 p-3 text-left dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <FileText className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    {copy.title}
                </h4>
                {hasKey && (
                    <>
                        <input
                            ref={inputRef}
                            type="file"
                            accept={SDS_ACCEPT}
                            className="sr-only"
                            tabIndex={-1}
                            onChange={(event) => void upload(event.target.files?.[0])}
                        />
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            disabled={busy !== null}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                            {busy === 'upload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
                            {busy === 'upload' ? copy.uploading : copy.upload}
                        </button>
                    </>
                )}
            </div>
            <p className="mt-1 break-keep text-xs text-slate-500 dark:text-slate-400">{hasKey ? copy.help : copy.noKey}</p>
            {loadFailed && <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{copy.loadFailed}</p>}
            {!loadFailed && documents && hasKey && matches.length === 0 && (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{copy.empty}</p>
            )}
            {matches.length > 0 && (
                <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                    {matches.map((document) => (
                        <li key={document.id} className="flex items-center gap-2 py-2">
                            <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{document.fileName}</span>
                                <span className="block text-xs text-slate-500 dark:text-slate-400">
                                    {[document.brand, document.productNumber, formatSize(document.sizeBytes), copy.added(document.createdAt.slice(0, 10))].filter(Boolean).join(' · ')}
                                </span>
                            </span>
                            <button
                                type="button"
                                onClick={() => void open(document)}
                                className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30"
                            >
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                {copy.open}
                            </button>
                            <button
                                type="button"
                                onClick={() => void remove(document)}
                                disabled={busy !== null}
                                aria-label={`${copy.remove} ${document.fileName}`}
                                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30"
                            >
                                {busy === document.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </section>
    );
};
