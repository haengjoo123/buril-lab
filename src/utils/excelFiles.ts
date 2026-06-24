type RowValue = string | number | boolean | Date | null | undefined;

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function toSafeWorkbookValue(value: unknown): RowValue {
    if (value instanceof Date) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;

    const text = String(value ?? '');
    return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
}

function fromWorkbookValue(value: unknown): unknown {
    if (value == null) return '';
    if (value instanceof Date) return value;
    if (typeof value !== 'object') return value;

    const candidate = value as {
        text?: unknown;
        result?: unknown;
        richText?: Array<{ text?: unknown }>;
        hyperlink?: unknown;
    };

    if (candidate.result != null) return fromWorkbookValue(candidate.result);
    if (candidate.text != null) return candidate.text;
    if (Array.isArray(candidate.richText)) {
        return candidate.richText.map((part) => String(part.text ?? '')).join('');
    }

    return String(value);
}

export async function downloadRowsAsXlsx(
    rows: Array<Record<string, unknown>>,
    sheetName: string,
    fileName: string,
): Promise<void> {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet(sheetName);
    const headers = rows[0] ? Object.keys(rows[0]) : [];

    worksheet.columns = headers.map((header) => ({
        header,
        key: header,
        width: Math.max(12, Math.min(32, header.length + 4)),
    }));

    rows.forEach((row) => {
        worksheet.addRow(
            Object.fromEntries(headers.map((header) => [header, toSafeWorkbookValue(row[header])])),
        );
    });

    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    const workbookBuffer = await workbook.xlsx.writeBuffer();
    const workbookBytes = Uint8Array.from(workbookBuffer as unknown as ArrayLike<number>);
    const { exportBlobPartAsFile } = await import('./fileExport');
    await exportBlobPartAsFile(workbookBytes.buffer, {
        fileName,
        mimeType: XLSX_MIME_TYPE,
    });
}

export async function readFirstWorksheetRows(file: File): Promise<unknown[][]> {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    const workbookBuffer = await file.arrayBuffer();
    await workbook.xlsx.load(workbookBuffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];

    const rows: unknown[][] = [];
    const columnCount = Math.max(worksheet.columnCount, 1);
    worksheet.eachRow({ includeEmpty: true }, (row) => {
        const values: unknown[] = [];
        for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
            values.push(fromWorkbookValue(row.getCell(columnIndex).value));
        }
        rows.push(values);
    });

    return rows;
}
