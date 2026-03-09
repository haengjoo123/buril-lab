import React, { useMemo, useState } from 'react';
import { Upload, Download, X, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { inventoryService, type CreateInventoryInput, type InventoryItem, type StorageLocation } from '../../services/inventoryService';
import { type Cabinet, cabinetService } from '../../services/cabinetService';
import { useFridgeStore } from '../../store/fridgeStore';
import { supabase } from '../../services/supabaseClient';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';

interface InventoryCsvImportModalProps {
    isOpen: boolean;
    items: InventoryItem[];
    locations: StorageLocation[];
    cabinets: Cabinet[];
    onClose: () => void;
    onImported: () => void;
}

type RowStatus = 'valid' | 'invalid' | 'imported' | 'failed';

interface ParsedCsvRow {
    rowNumber: number;
    source: Record<string, string>;
    input: CreateInventoryInput | null;
    status: RowStatus;
    reasons: string[];
    matchedCabinetId?: string;
}

type CsvStep = 'upload' | 'mapping' | 'preview';

interface RawCsvData {
    headers: string[];
    rows: Array<{ rowNumber: number; values: string[] }>;
}

type ColumnMapping = Record<string, string>;

const EXPECTED_HEADERS = [
    'name',
    'brand',
    'product_number',
    'cas_number',
    'quantity',
    'capacity',
    'storage_type',
    'storage_location',
    'expiry_date',
    'memo',
];

const TEMPLATE_HEADERS_KO = [
    '시약명',
    '브랜드',
    '제품번호',
    'CAS번호',
    '수량',
    '용량',
    '보관유형',
    '보관위치',
    '유효기간',
    '메모',
];

const REQUIRED_MAPPING_KEYS = ['name', 'quantity', 'storage_type', 'storage_location'] as const;
const OPTIONAL_MAPPING_KEYS = EXPECTED_HEADERS.filter(
    key => !REQUIRED_MAPPING_KEYS.includes(key as (typeof REQUIRED_MAPPING_KEYS)[number])
);

const HEADER_ALIASES: Record<string, string[]> = {
    name: ['name', '이름', '시약명'],
    brand: ['brand', '브랜드'],
    product_number: ['product_number', 'product no', 'product_no', '제품번호', 'pn'],
    cas_number: ['cas_number', 'cas', 'cas no', 'cas_no', 'cas번호', 'cas 번호'],
    quantity: ['quantity', 'qty', '수량'],
    capacity: ['capacity', '용량'],
    storage_type: ['storage_type', 'storage type', '보관유형', '보관 유형', '보관타입', '보관 타입'],
    storage_location: ['storage_location', 'storage location', '보관위치', '보관 위치', '보관장소', '보관 장소', '위치'],
    expiry_date: ['expiry_date', 'expiry', '유효기간', '만료일'],
    memo: ['memo', '메모', '비고'],
};

const normalize = (value: string) => value.trim().toLowerCase();

const STORAGE_TYPE_ALIAS_MAP: Record<string, 'other' | 'cabinet'> = {
    other: 'other',
    '기타': 'other',
    '기타보관': 'other',
    '기타 보관': 'other',
    '기타위치': 'other',
    '기타 위치': 'other',
    cabinet: 'cabinet',
    '시약장': 'cabinet',
    '캐비넷': 'cabinet',
};

const parseStorageType = (raw: string): 'other' | 'cabinet' | null => {
    const normalized = normalize(raw);
    if (!normalized) return 'other';
    return STORAGE_TYPE_ALIAS_MAP[raw.trim()] || STORAGE_TYPE_ALIAS_MAP[normalized] || null;
};

const parseCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        const next = line[i + 1];

        if (ch === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === ',' && !inQuotes) {
            out.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }

    out.push(current.trim());
    return out;
};

const toIsoDate = (raw: string): string | null => {
    const value = raw.trim();
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return value;
};

export const InventoryCsvImportModal: React.FC<InventoryCsvImportModalProps> = ({
    isOpen,
    items,
    locations,
    cabinets,
    onClose,
    onImported,
}) => {
    const { t } = useTranslation();
    const [step, setStep] = useState<CsvStep>('upload');
    const [rawCsvData, setRawCsvData] = useState<RawCsvData | null>(null);
    const [mapping, setMapping] = useState<ColumnMapping>({});
    const [rows, setRows] = useState<ParsedCsvRow[]>([]);
    const [isParsing, setIsParsing] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [globalError, setGlobalError] = useState<string | null>(null);
    const [lastFileName, setLastFileName] = useState('');

    const summary = useMemo(() => {
        const validCount = rows.filter(r => r.status === 'valid').length;
        const invalidCount = rows.filter(r => r.status === 'invalid').length;
        const importedCount = rows.filter(r => r.status === 'imported').length;
        const failedCount = rows.filter(r => r.status === 'failed').length;
        return { validCount, invalidCount, importedCount, failedCount };
    }, [rows]);

    const resetState = () => {
        setStep('upload');
        setRawCsvData(null);
        setMapping({});
        setRows([]);
        setIsDragOver(false);
        setGlobalError(null);
        setLastFileName('');
    };

    const closeModal = () => {
        if (isParsing || isImporting) return;
        resetState();
        onClose();
    };

    const getHeaderIndex = (headers: string[], key: string): number => {
        const aliases = HEADER_ALIASES[key] || [key];
        const normalizedHeaders = headers.map(normalize);
        for (const alias of aliases) {
            const idx = normalizedHeaders.indexOf(normalize(alias));
            if (idx >= 0) return idx;
        }
        return -1;
    };

    const buildDefaultMapping = (headers: string[]): ColumnMapping => {
        const next: ColumnMapping = {};
        EXPECTED_HEADERS.forEach((key) => {
            const idx = getHeaderIndex(headers, key);
            next[key] = idx >= 0 ? headers[idx] : '';
        });
        return next;
    };

    const valueByMapping = (values: string[], headers: string[], key: string): string => {
        const headerName = mapping[key];
        if (!headerName) return '';
        const idx = headers.findIndex((h) => h === headerName);
        if (idx < 0) return '';
        return (values[idx] || '').trim();
    };

    const matchLocationId = (rawLocation: string): string | null => {
        const target = normalize(rawLocation);
        if (!target) return null;
        const exact = locations.find(loc => normalize(loc.name) === target);
        if (exact) return exact.id;
        const compact = target.replace(/[^a-z0-9가-힣]/gi, '');
        const fuzzy = locations.find((loc) => {
            const normalizedName = normalize(loc.name).replace(/[^a-z0-9가-힣]/gi, '');
            return normalizedName === compact;
        });
        return fuzzy?.id || null;
    };

    const matchCabinetId = (rawCabinet: string): string | null => {
        const target = normalize(rawCabinet);
        if (!target) return null;
        const exact = cabinets.find(cab => normalize(cab.name) === target);
        if (exact) return exact.id;
        const compact = target.replace(/[^a-z0-9가-힣]/gi, '');
        const fuzzy = cabinets.find((cab) => {
            const normalizedName = normalize(cab.name).replace(/[^a-z0-9가-힣]/gi, '');
            return normalizedName === compact;
        });
        return fuzzy?.id || null;
    };

    const buildRow = (rowNumber: number, source: Record<string, string>): ParsedCsvRow => {
        const reasons: string[] = [];

        const name = (source.name || '').trim();
        const brand = (source.brand || '').trim();
        const productNumber = (source.product_number || '').trim();
        const casNumber = (source.cas_number || '').trim();
        const quantityRaw = (source.quantity || '').trim();
        const capacity = (source.capacity || '').trim();
        const storageTypeRaw = (source.storage_type || '').trim();
        const storageLocationRaw = (source.storage_location || '').trim();
        const expiryDateRaw = (source.expiry_date || '').trim();
        const memo = (source.memo || '').trim();

        if (!name) reasons.push(t('inventory_csv_reason_name_required'));

        const quantity = quantityRaw ? Number.parseInt(quantityRaw, 10) : 1;
        if (!Number.isInteger(quantity) || quantity < 1) {
            reasons.push(t('inventory_csv_reason_quantity_invalid'));
        }

        const storageType = parseStorageType(storageTypeRaw);
        if (!storageType) {
            reasons.push(t('inventory_csv_reason_storage_type_invalid'));
        }

        const locationId = storageType === 'other' ? matchLocationId(storageLocationRaw) : null;
        const cabinetId = storageType === 'cabinet' ? matchCabinetId(storageLocationRaw) : null;
        if (storageType === 'other' && !locationId) reasons.push(t('inventory_csv_reason_other_location_not_found'));
        if (storageType === 'cabinet' && !cabinetId) reasons.push(t('inventory_csv_reason_cabinet_not_found'));

        const expiryDate = toIsoDate(expiryDateRaw);
        if (expiryDateRaw && !expiryDate) {
            reasons.push(t('inventory_csv_reason_expiry_invalid'));
        }

        const input: CreateInventoryInput | null = reasons.length === 0
            ? {
                name,
                brand: brand || undefined,
                product_number: productNumber || undefined,
                cas_number: casNumber || undefined,
                quantity,
                capacity: capacity || undefined,
                storage_type: storageType || 'other',
                storage_location_id: storageType === 'other' ? (locationId || undefined) : undefined,
                cabinet_id: storageType === 'cabinet' ? (cabinetId || undefined) : undefined,
                expiry_date: expiryDate || undefined,
                memo: memo || undefined,
            }
            : null;

        return {
            rowNumber,
            source,
            input,
            status: reasons.length === 0 ? 'valid' : 'invalid',
            reasons,
            matchedCabinetId: cabinetId || undefined,
        };
    };

    const handleTemplateDownload = () => {
        const content = [
            '# ============================================',
            '# Buril-lab Inventory CSV Import Template',
            '# ============================================',
            '# [안내]',
            '# 1) 아래 "입력 영역" 헤더와 순서를 유지해서 작성하세요.',
            '# 2) 필수 컬럼: **name, quantity, storage_type, storage_location**',
            '# 3) storage_type: 기타 또는 시약장 (영문 other/cabinet도 허용)',
            '# 4) storage_location:',
            '#    - storage_type=기타     -> 앱에 등록된 보관 위치 이름',
            '#    - storage_type=시약장   -> 앱에 등록된 시약장 이름',
            '# 5) expiry_date 형식: YYYY-MM-DD (예: 2026-12-31), 비워도 됩니다.',
            '#',
            '# ---------------- [입력 영역] ----------------',
            TEMPLATE_HEADERS_KO.join(','),
            'Acetone,Sigma,A123,67-64-1,1,500mL,기타,냉장고,2026-12-31,샘플 메모',
            'Ethanol,Daejung,E100,64-17-5,2,1L,기타,냉장고,,',
            'HCl,Junsei,HCL500,7647-01-0,1,500mL,시약장,A421,,시약장 테스트',
        ].join('\n');

        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'inventory_import_template.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleInventoryExcelDownload = () => {
        const rowsForExport = items.map((item) => {
            const storageLabel = item.storage_type === 'cabinet'
                ? (item.cabinet_name || '')
                : (item.storage_location_name || '');

            return {
                시약명: item.name || '',
                브랜드: item.brand || '',
                제품번호: item.product_number || '',
                CAS번호: item.cas_number || '',
                수량: item.quantity ?? '',
                용량: item.capacity || '',
                보관유형: item.storage_type === 'cabinet' ? '시약장' : '기타',
                보관위치: storageLabel,
                유효기간: item.expiry_date || '',
                메모: item.memo || '',
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(rowsForExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');

        const today = new Date();
        const dateToken = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
        XLSX.writeFile(workbook, `inventory_list_${dateToken}.xlsx`);
    };

    const parseCsvFile = async (file: File) => {
        const lowerName = file.name.toLowerCase();
        if (!lowerName.endsWith('.csv')) {
            setGlobalError(t('inventory_csv_error_only_csv'));
            return;
        }

        setIsParsing(true);
        setGlobalError(null);
        setRows([]);
        setLastFileName(file.name);

        try {
            const text = await file.text();
            const lines = text
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .filter(line => !line.startsWith('#'));

            if (lines.length < 2) {
                setGlobalError(t('inventory_csv_error_need_header_and_data'));
                return;
            }

            const headers = parseCsvLine(lines[0]);
            const rawRows: Array<{ rowNumber: number; values: string[] }> = [];
            for (let i = 1; i < lines.length; i += 1) {
                rawRows.push({
                    rowNumber: i + 1,
                    values: parseCsvLine(lines[i]),
                });
            }

            setRawCsvData({ headers, rows: rawRows });
            setMapping(buildDefaultMapping(headers));
            setStep('mapping');
        } catch (error) {
            console.error('Failed to parse CSV:', error);
            setGlobalError(t('inventory_csv_error_parse_failed'));
        } finally {
            setIsParsing(false);
        }
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        await parseCsvFile(file);
        event.target.value = '';
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (isParsing || isImporting) return;
        setIsDragOver(true);
    };

    const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (isParsing || isImporting) return;
        setIsDragOver(false);
    };

    const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (isParsing || isImporting) return;
        setIsDragOver(false);

        const droppedFile = event.dataTransfer.files?.[0];
        if (!droppedFile) return;

        await parseCsvFile(droppedFile);
    };

    const handleRunValidation = () => {
        if (!rawCsvData) return;

        const required = ['name', 'quantity', 'storage_type', 'storage_location'];
        const missingRequired = required.filter((key) => !mapping[key]);
        if (missingRequired.length > 0) {
            setGlobalError(t('inventory_csv_error_missing_required_mapping', { columns: missingRequired.join(', ') }));
            return;
        }

        const parsedRows: ParsedCsvRow[] = rawCsvData.rows.map(({ rowNumber, values }) => {
            const source: Record<string, string> = {};
            EXPECTED_HEADERS.forEach((key) => {
                source[key] = valueByMapping(values, rawCsvData.headers, key);
            });
            return buildRow(rowNumber, source);
        });

        setRows(parsedRows);
        setGlobalError(null);
        setStep('preview');
    };

    const handleImportValidRows = async () => {
        if (isImporting) return;
        const validRows = rows.filter(row => row.status === 'valid' && row.input);
        if (validRows.length === 0) return;

        setIsImporting(true);
        setGlobalError(null);

        let importedCount = 0;
        const nextRows = [...rows];

        for (const row of validRows) {
            try {
                const input = row.input as CreateInventoryInput;
                const created = await inventoryService.createItem(input);
                if (!created) {
                    throw new Error(t('inventory_csv_error_create_empty_result'));
                }

                if (input.storage_type === 'cabinet' && input.cabinet_id) {
                    const template = guessTemplate(input.capacity || '');
                    const width = getWidthForTemplate(template);
                    const store = useFridgeStore.getState();
                    await store.loadCabinet(input.cabinet_id);
                    const placed = store.autoPlaceReagent({
                        id: '',
                        reagentId: created.id,
                        name: input.name,
                        width,
                        template,
                        isAcidic: false,
                        isBasic: false,
                        hCodes: [],
                        notes: input.memo || undefined,
                        casNo: input.cas_number || undefined,
                        capacity: input.capacity || undefined,
                        productNumber: input.product_number || undefined,
                        brand: input.brand || undefined,
                        expiryDate: input.expiry_date || undefined,
                    });
                    if (!placed) {
                        await supabase.from('inventory').delete().eq('id', created.id);
                        throw new Error(t('inventory_csv_error_no_cabinet_space'));
                    }
                    try {
                        await persistLoadedCabinetStateStrict(input.cabinet_id);
                    } catch (persistError) {
                        await rollbackPlacedItem(input.cabinet_id, placed.itemId);
                        await supabase.from('inventory').delete().eq('id', created.id);
                        throw new Error(t('inventory_csv_error_cabinet_sync_failed_with_reason', { reason: toReasonText(persistError, t) }));
                    }
                    cabinetService.logActivity(input.cabinet_id, 'add', input.name, t('inventory_csv_log_reason'), input.memo || undefined)
                        .catch(console.error);
                }

                const idx = nextRows.findIndex(r => r.rowNumber === row.rowNumber);
                if (idx >= 0) {
                    nextRows[idx] = { ...nextRows[idx], status: 'imported', reasons: [] };
                }
                importedCount += 1;
            } catch (error) {
                console.error('Failed to import CSV row:', row.rowNumber, error);
                const idx = nextRows.findIndex(r => r.rowNumber === row.rowNumber);
                if (idx >= 0) {
                    nextRows[idx] = {
                        ...nextRows[idx],
                        status: 'failed',
                        reasons: [toReasonText(error, t)],
                    };
                }
            }
        }

        setRows(nextRows);
        setIsImporting(false);

        if (importedCount > 0) {
            onImported();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeModal} />
            <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{t('inventory_csv_title')}</h2>
                    <button
                        onClick={closeModal}
                        disabled={isParsing || isImporting}
                        className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                    <button
                        onClick={handleInventoryExcelDownload}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                    >
                        <Download className="w-4 h-4" />
                        {t('inventory_excel_download')}
                    </button>

                    <button
                        onClick={handleTemplateDownload}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                    >
                        <Download className="w-4 h-4" />
                        {t('inventory_csv_download_template')}
                    </button>

                    <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 cursor-pointer">
                        <Upload className="w-4 h-4" />
                        {t('inventory_csv_upload')}
                        <input
                            type="file"
                            accept=".csv,text/csv"
                            className="hidden"
                            onChange={handleFileChange}
                            disabled={isParsing || isImporting}
                        />
                    </label>

                    {lastFileName && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">{t('inventory_csv_file_label', { fileName: lastFileName })}</span>
                    )}
                </div>

                {step === 'mapping' && rawCsvData && (
                    <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3">
                            <div className="text-sm font-bold text-slate-700 dark:text-slate-100">
                                {t('inventory_csv_mapping_title')}
                            </div>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                {t('inventory_csv_mapping_desc')}
                            </p>
                        </div>

                        <div className="mt-4">
                            <div className="text-xs font-bold text-rose-600 dark:text-rose-400 mb-2">{t('inventory_csv_mapping_required')}</div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {REQUIRED_MAPPING_KEYS.map((key) => (
                                    <label key={key} className="rounded-lg border-2 border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 px-3 py-2 flex flex-col gap-1">
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-100">
                                            {key} <span className="text-rose-500">*</span>
                                        </span>
                                        <select
                                            value={mapping[key] || ''}
                                            onChange={(e) => setMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                                            className="px-2 py-1.5 rounded-md text-xs border border-rose-200 dark:border-rose-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold"
                                        >
                                            <option value="">(none)</option>
                                            {rawCsvData.headers.map((header) => (
                                                <option key={header} value={header}>{header}</option>
                                            ))}
                                        </select>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="mt-4">
                            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">{t('inventory_csv_mapping_optional')}</div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                {OPTIONAL_MAPPING_KEYS.map((key) => (
                                <label key={key} className="flex flex-col gap-1">
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400">{key}</span>
                                    <select
                                        value={mapping[key] || ''}
                                        onChange={(e) => setMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                                        className="px-2 py-1.5 rounded-md text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                                    >
                                        <option value="">(none)</option>
                                        {rawCsvData.headers.map((header) => (
                                            <option key={header} value={header}>{header}</option>
                                        ))}
                                    </select>
                                </label>
                            ))}
                            </div>
                        </div>

                        <div className="mt-3 flex justify-end">
                            <button
                                onClick={handleRunValidation}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white"
                            >
                                {t('inventory_csv_run_validation')}
                            </button>
                        </div>
                    </div>
                )}

                <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap gap-3">
                    <span>{t('inventory_csv_summary_valid', { count: summary.validCount })}</span>
                    <span>{t('inventory_csv_summary_invalid', { count: summary.invalidCount })}</span>
                    <span>{t('inventory_csv_summary_imported', { count: summary.importedCount })}</span>
                    <span>{t('inventory_csv_summary_failed', { count: summary.failedCount })}</span>
                </div>

                {globalError && (
                    <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm inline-flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {globalError}
                    </div>
                )}

                <div className="flex-1 overflow-auto px-5 py-4">
                    {isParsing ? (
                        <div className="h-full min-h-[240px] flex items-center justify-center text-slate-500">
                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                            {t('inventory_csv_parsing')}
                        </div>
                    ) : (step !== 'preview' || rows.length === 0) ? (
                        <div
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            className={`h-full min-h-[240px] rounded-xl border-2 border-dashed flex items-center justify-center text-sm transition-colors ${isDragOver
                                ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                                : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400'
                                }`}
                        >
                            {isDragOver
                                ? t('inventory_csv_drop_here')
                                : t('inventory_csv_drop_hint')}
                        </div>
                    ) : (
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                    <th className="text-left px-2 py-2 border border-slate-200 dark:border-slate-700">{t('inventory_csv_table_row')}</th>
                                    <th className="text-left px-2 py-2 border border-slate-200 dark:border-slate-700">{t('inventory_csv_table_name')}</th>
                                    <th className="text-left px-2 py-2 border border-slate-200 dark:border-slate-700">{t('inventory_csv_table_qty')}</th>
                                    <th className="text-left px-2 py-2 border border-slate-200 dark:border-slate-700">{t('inventory_csv_table_type')}</th>
                                    <th className="text-left px-2 py-2 border border-slate-200 dark:border-slate-700">{t('inventory_csv_table_storage')}</th>
                                    <th className="text-left px-2 py-2 border border-slate-200 dark:border-slate-700">{t('inventory_csv_table_status')}</th>
                                    <th className="text-left px-2 py-2 border border-slate-200 dark:border-slate-700">{t('inventory_csv_table_reason')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.rowNumber} className="text-slate-700 dark:text-slate-200">
                                        <td className="px-2 py-2 border border-slate-200 dark:border-slate-700">{row.rowNumber}</td>
                                        <td className="px-2 py-2 border border-slate-200 dark:border-slate-700">{row.source.name || '-'}</td>
                                        <td className="px-2 py-2 border border-slate-200 dark:border-slate-700">{row.source.quantity || '-'}</td>
                                        <td className="px-2 py-2 border border-slate-200 dark:border-slate-700">{row.source.storage_type || '-'}</td>
                                        <td className="px-2 py-2 border border-slate-200 dark:border-slate-700">{row.source.storage_location || '-'}</td>
                                        <td className="px-2 py-2 border border-slate-200 dark:border-slate-700">
                                            {row.status === 'imported' ? (
                                                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                                                    <CheckCircle2 className="w-3 h-3" />
                                                    {t('inventory_csv_status_imported')}
                                                </span>
                                            ) : getStatusLabel(row.status, t)}
                                        </td>
                                        <td className="px-2 py-2 border border-slate-200 dark:border-slate-700">
                                            {row.reasons.length > 0 ? row.reasons.join('; ') : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                    <button
                        onClick={closeModal}
                        disabled={isImporting || isParsing}
                        className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold"
                    >
                        {t('btn_close')}
                    </button>
                    <button
                        onClick={handleImportValidRows}
                        disabled={isImporting || isParsing || step !== 'preview' || summary.validCount === 0}
                        className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2"
                    >
                        {isImporting && <Loader2 className="w-4 h-4 animate-spin" />}
                        {t('inventory_csv_import_valid_only')}
                    </button>
                </div>
            </div>
        </div>
    );
};

function guessTemplate(capacity: string): 'A' | 'B' | 'C' | 'D' {
    if (!capacity) return 'A';
    const lower = capacity.toLowerCase();
    const numMatch = lower.match(/(\d+)/);
    const num = numMatch ? Number.parseInt(numMatch[1], 10) : 0;
    if (lower.includes('kg') || num >= 2500) return 'D';
    if (lower.includes('l') && !lower.includes('ml')) return 'C';
    if (num >= 500) return 'C';
    if (num >= 100) return 'A';
    return 'B';
}

function getWidthForTemplate(template: 'A' | 'B' | 'C' | 'D'): number {
    switch (template) {
        case 'A': return 8;
        case 'B': return 6;
        case 'C': return 12;
        case 'D': return 14;
        default: return 8;
    }
}

async function persistLoadedCabinetStateStrict(expectedCabinetId: string): Promise<void> {
    const state = useFridgeStore.getState();
    if (!state.cabinetId || state.cabinetId !== expectedCabinetId) {
        throw new Error('cabinet state mismatch');
    }
    await cabinetService.saveCabinetState(expectedCabinetId, state.shelves);
    await cabinetService.updateCabinet(expectedCabinetId, {
        width: state.cabinetWidth,
        height: state.cabinetHeight,
        depth: state.cabinetDepth,
    });
}

async function rollbackPlacedItem(cabinetId: string, placedItemId: string): Promise<void> {
    const store = useFridgeStore.getState();
    await store.loadCabinet(cabinetId);
    store.removeReagent(placedItemId);
    await persistLoadedCabinetStateStrict(cabinetId);
}

function toReasonText(error: unknown, t: (key: string, options?: Record<string, unknown>) => string): string {
    if (error instanceof Error && error.message) return error.message;
    return t('inventory_csv_error_create_failed');
}

function getStatusLabel(status: RowStatus, t: (key: string) => string): string {
    if (status === 'valid') return t('inventory_csv_status_valid');
    if (status === 'invalid') return t('inventory_csv_status_invalid');
    if (status === 'failed') return t('inventory_csv_status_failed');
    return status;
}
