import type { DailyInspectionRecord } from '../../services/dailyInspectionService';
import type { LabAdminContainerInput } from '../admin/labAdminTasks';
import { INSPECTION_SECTIONS } from '../dailyInspection/checklist';
import type { CabinetLockSummary } from '../dailyInspection/labSafetySignals';
import { registerColumns, type RegisterRow, type RegisterSheetCopy } from '../hazardRegister/hazardRegister';
import type { InspectionPrepCopy } from './copy';

/**
 * One workbook that gathers what a lab already recorded for a periodic
 * inspection, a detailed safety diagnosis or a survey. Built from data the
 * app holds; parts whose feature is off say so instead of looking empty.
 */

export interface PrepSheet {
    name: string;
    title?: string;
    headers: string[];
    rows: Array<Array<string | number>>;
    widths: number[];
}

export interface InspectionPrepInput {
    labName: string;
    date: Date;
    /** Days of daily inspection records included. */
    periodDays: number;
    register: { rows: RegisterRow[]; copy: Pick<RegisterSheetCopy, 'headers' | 'regulationHeader'> };
    /** 화관법 actions per normalized CAS, joined; null when the lab-wide lookup is off. */
    actionsByCas: Map<string, string> | null;
    regulatedCasCount: number | null;
    accidentCasCount: number | null;
    /** False when SDS attachments are off, so the SDS line is left out. */
    sdsTracked: boolean;
    inspections: DailyInspectionRecord[] | null;
    cabinets: Array<{ id: string; name: string; location: string | null; locked: boolean | null }> | null;
    cabinetLocks: CabinetLockSummary | null;
    containers: { list: LabAdminContainerInput[]; attentionCount: number; streamLabel: (code: string) => string } | null;
}

const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const ITEM_LABELS = new Map(INSPECTION_SECTIONS.flatMap((section) => section.items.map((item) => [item.id, item] as const)));

function issueItems(record: DailyInspectionRecord, language: 'ko' | 'en'): string {
    return Object.entries(record.results)
        .filter(([, result]) => result === 'bad')
        .map(([id]) => ITEM_LABELS.get(id)?.[language] ?? id)
        .join('\n');
}

export function buildInspectionPrepSheets(input: InspectionPrepInput, copy: InspectionPrepCopy, language: 'ko' | 'en'): { sheets: PrepSheet[]; guide: string[] } {
    const date = isoDate(input.date);
    const s = copy.summary;
    const lockCounts = input.cabinets
        ? {
            yes: input.cabinets.filter((cabinet) => cabinet.locked === true).length,
            no: input.cabinets.filter((cabinet) => cabinet.locked === false).length,
            unset: input.cabinets.filter((cabinet) => cabinet.locked === null).length,
        }
        : null;
    const lockRequired = new Map([...(input.cabinetLocks?.unlocked ?? []), ...(input.cabinetLocks?.unset ?? [])]
        .map((group) => [group.cabinetId, group.count] as const));
    const exposed = (input.cabinetLocks?.unlocked ?? []).reduce((sum, group) => sum + group.count, 0);
    const inspections = input.inspections ? [...input.inspections].sort((a, b) => b.inspectionDate.localeCompare(a.inspectionDate)) : null;

    const summaryRows: Array<[string, string | number]> = [
        [s.lab, input.labName],
        [s.date, date],
        [s.reagents, input.register.rows.length],
        [s.regulated, input.regulatedCasCount ?? s.notIncluded],
        [s.accident, input.accidentCasCount ?? s.notIncluded],
        [s.diagnosis, input.regulatedCasCount === null ? s.notIncluded : input.regulatedCasCount > 0 ? s.diagnosisYes : s.diagnosisUnknown],
        [s.inspections(input.periodDays), inspections
            ? s.inspectionsValue(inspections.length, inspections.filter((record) => record.issueCount > 0).length, inspections[0]?.inspectionDate ?? null)
            : s.notIncluded],
        ...(input.sdsTracked
            ? [[s.sds, s.sdsValue(input.register.rows.filter((row) => Boolean(row.sds)).length, input.register.rows.length)] as [string, string]]
            : []),
        [s.locks, lockCounts ? s.locksValue(lockCounts.yes, lockCounts.no, lockCounts.unset, exposed) : s.notIncluded],
        [s.containers, input.containers
            ? s.containersValue(
                input.containers.list.filter((container) => container.status === 'active').length,
                input.containers.list.filter((container) => container.status === 'sealed').length,
                input.containers.attentionCount,
            )
            : s.notIncluded],
    ];

    const register = registerColumns(input.register.rows, input.register.copy);
    const sheets: PrepSheet[] = [
        { name: copy.sheets.summary, title: copy.title(input.labName, date), headers: copy.summaryHeaders, rows: summaryRows, widths: [34, 80] },
        {
            name: copy.sheets.chemicals,
            headers: input.actionsByCas ? [...register.headers, copy.chemicalsActionHeader] : register.headers,
            rows: input.register.rows.map((row) => (input.actionsByCas
                ? [...register.values(row), input.actionsByCas.get(row.casNumber) ?? '']
                : register.values(row))),
            widths: input.actionsByCas ? [...register.widths, 48] : register.widths,
        },
    ];
    if (inspections) {
        sheets.push({
            name: copy.sheets.inspections,
            headers: copy.inspectionHeaders,
            rows: inspections.map((record) => [
                record.inspectionDate, record.inspectorName ?? '', record.issueCount, issueItems(record, language), record.note ?? '', record.checklistVersion,
            ]),
            widths: [12, 14, 8, 60, 40, 12],
        });
    }
    if (input.cabinets) {
        sheets.push({
            name: copy.sheets.cabinets,
            headers: copy.cabinetHeaders,
            rows: input.cabinets.map((cabinet) => [
                cabinet.name,
                cabinet.location ?? '',
                cabinet.locked === true ? copy.lockText.yes : cabinet.locked === false ? copy.lockText.no : copy.lockText.unset,
                cabinet.locked === true ? '' : lockRequired.get(cabinet.id) ?? 0,
            ]),
            widths: [24, 20, 10, 24],
        });
    }
    if (input.containers) {
        const { streamLabel } = input.containers;
        sheets.push({
            name: copy.sheets.containers,
            headers: copy.containerHeaders,
            rows: input.containers.list.map((container) => [
                container.label,
                streamLabel(container.streamCode),
                copy.containerStatus[container.status] ?? container.status,
                container.fillRatio === null ? '' : Math.round(container.fillRatio * 100),
                container.location ?? '',
                container.sealedAt?.slice(0, 10) ?? '',
            ]),
            widths: [16, 24, 10, 10, 18, 12],
        });
    }
    return { sheets, guide: copy.guide };
}

export async function downloadInspectionPrep(
    built: { sheets: PrepSheet[]; guide: string[] },
    meta: { guideSheetName: string; fileName: string },
): Promise<void> {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    for (const prep of built.sheets) {
        const sheet = workbook.addWorksheet(prep.name);
        if (prep.title) {
            sheet.addRow([prep.title]).font = { bold: true, size: 13 };
            sheet.addRow([]);
        }
        const header = sheet.addRow(prep.headers);
        header.font = { bold: true };
        header.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            cell.alignment = { wrapText: true, vertical: 'middle' };
        });
        for (const row of prep.rows) sheet.addRow(row).alignment = { wrapText: true, vertical: 'top' };
        prep.widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
        sheet.views = [{ state: 'frozen', ySplit: prep.title ? 3 : 1 }];
    }
    const guide = workbook.addWorksheet(meta.guideSheetName);
    built.guide.forEach((line, index) => {
        const row = guide.addRow([line]);
        if (index === 0) row.font = { bold: true, size: 13 };
        row.alignment = { wrapText: true };
    });
    guide.getColumn(1).width = 110;

    const buffer = await workbook.xlsx.writeBuffer();
    const { exportBlobPartAsFile } = await import('../../utils/fileExport');
    await exportBlobPartAsFile(Uint8Array.from(buffer as unknown as ArrayLike<number>).buffer, {
        fileName: meta.fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
}
