import { GHS_KO } from '../../data/ghsCodes';

/**
 * Draft chemical list for a lab's prior hazard analysis (사전유해인자위험분석).
 *
 * Built from the inventory and the GHS data the app already holds, so a lab
 * starts from its real holdings instead of a blank form. It is a draft: the
 * columns a person must judge (daily use, exposure, controls) are left empty
 * and the guide sheet says so. The official form and retention rules are set
 * by the notice in force and the institution.
 */
export interface RegisterItem {
    name: string;
    casNumber: string | null;
    brand: string | null;
    quantity: number | null;
    capacity: string | null;
    location: string;
    expiryDate: string | null;
    /** Loaded GHS data for the item's CAS number, or null when not looked up yet. */
    ghs: { hCodes: string[]; signalWord?: string | null; pictograms: string[]; classified: boolean } | null;
    /** App hazard groups such as flammable or toxic, already translated. */
    hazardGroups: string[];
    hasSds: boolean;
}

export interface RegisterRow {
    index: number;
    name: string;
    casNumber: string;
    brand: string;
    holding: string;
    location: string;
    signalWord: string;
    hazardStatements: string;
    pictograms: string;
    hazardGroups: string;
    ghsStatus: string;
    sds: string;
    expiryDate: string;
}

export interface RegisterCopy {
    language: 'ko' | 'en';
    statusLoaded: string;
    statusNotClassified: string;
    statusNoCas: string;
    statusPending: string;
    sdsYes: string;
    sdsNo: string;
    signalDanger: string;
    signalWarning: string;
}

const signalText = (value: string | null | undefined, copy: RegisterCopy): string => {
    const normalized = (value ?? '').trim().toLowerCase();
    if (normalized === 'danger' || normalized === '위험') return copy.signalDanger;
    if (normalized === 'warning' || normalized === '경고') return copy.signalWarning;
    return value?.trim() ?? '';
};

/** Rows sorted by location then name; the same product in one place is listed once with a summed quantity. */
export function buildRegisterRows(items: readonly RegisterItem[], copy: RegisterCopy): RegisterRow[] {
    const merged = new Map<string, RegisterItem & { count: number; capacities: string[] }>();
    for (const item of items) {
        const key = [item.location, item.casNumber?.trim() || item.name.trim().toLowerCase(), (item.brand ?? '').toLowerCase()].join('|');
        const existing = merged.get(key);
        if (existing) {
            existing.count += item.quantity ?? 1;
            if (item.capacity) existing.capacities.push(item.capacity);
            if (item.expiryDate && (!existing.expiryDate || item.expiryDate < existing.expiryDate)) existing.expiryDate = item.expiryDate;
            existing.hasSds = existing.hasSds || item.hasSds;
        } else {
            merged.set(key, { ...item, count: item.quantity ?? 1, capacities: item.capacity ? [item.capacity] : [] });
        }
    }
    return [...merged.values()]
        .sort((left, right) => left.location.localeCompare(right.location) || left.name.localeCompare(right.name))
        .map((item, index) => {
            const codes = [...new Set(item.ghs?.hCodes ?? [])].sort();
            const statements = codes.map((code) => (copy.language === 'ko' && GHS_KO[code] ? `${code} ${GHS_KO[code]}` : code));
            const status = !item.casNumber
                ? copy.statusNoCas
                : !item.ghs ? copy.statusPending
                    : codes.length > 0 ? copy.statusLoaded : copy.statusNotClassified;
            const capacities = [...new Set(item.capacities)];
            return {
                index: index + 1,
                name: item.name,
                casNumber: item.casNumber ?? '',
                brand: item.brand ?? '',
                holding: `${item.count}${capacities.length ? ` × ${capacities.join(', ')}` : ''}`,
                location: item.location,
                signalWord: signalText(item.ghs?.signalWord, copy),
                hazardStatements: statements.join('\n'),
                pictograms: [...new Set(item.ghs?.pictograms ?? [])].sort().join(', '),
                hazardGroups: item.hazardGroups.join(', '),
                ghsStatus: status,
                sds: item.hasSds ? copy.sdsYes : copy.sdsNo,
                expiryDate: item.expiryDate?.slice(0, 10) ?? '',
            };
        });
}

export interface RegisterSheetCopy {
    sheetName: string;
    guideSheetName: string;
    title: (space: string, date: string) => string;
    headers: string[];
    manualHeaders: string[];
    guide: string[];
    fileName: (date: string) => string;
}

export async function downloadHazardRegister(rows: readonly RegisterRow[], copy: RegisterSheetCopy, meta: { space: string; date: Date }): Promise<void> {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    const date = `${meta.date.getFullYear()}-${String(meta.date.getMonth() + 1).padStart(2, '0')}-${String(meta.date.getDate()).padStart(2, '0')}`;

    const sheet = workbook.addWorksheet(copy.sheetName);
    sheet.addRow([copy.title(meta.space, date)]).font = { bold: true, size: 13 };
    sheet.addRow([]);
    const header = sheet.addRow([...copy.headers, ...copy.manualHeaders]);
    header.font = { bold: true };
    header.eachCell((cell, column) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: column > copy.headers.length ? 'FFFFF7ED' : 'FFF1F5F9' } };
        cell.alignment = { wrapText: true, vertical: 'middle' };
    });
    for (const row of rows) {
        const added = sheet.addRow([
            row.index, row.name, row.casNumber, row.brand, row.holding, row.location, row.signalWord,
            row.hazardStatements, row.pictograms, row.hazardGroups, row.ghsStatus, row.sds, row.expiryDate,
            ...copy.manualHeaders.map(() => ''),
        ]);
        added.alignment = { wrapText: true, vertical: 'top' };
    }
    const widths = [6, 28, 13, 14, 12, 18, 8, 42, 18, 18, 12, 8, 12, ...copy.manualHeaders.map(() => 16)];
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.views = [{ state: 'frozen', ySplit: 3 }];

    const guide = workbook.addWorksheet(copy.guideSheetName);
    copy.guide.forEach((line, index) => {
        const row = guide.addRow([line]);
        if (index === 0) row.font = { bold: true, size: 13 };
        row.alignment = { wrapText: true };
    });
    guide.getColumn(1).width = 110;

    const buffer = await workbook.xlsx.writeBuffer();
    const { exportBlobPartAsFile } = await import('../../utils/fileExport');
    await exportBlobPartAsFile(Uint8Array.from(buffer as unknown as ArrayLike<number>).buffer, {
        fileName: copy.fileName(date),
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
}
