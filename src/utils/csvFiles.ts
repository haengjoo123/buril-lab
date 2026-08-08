import { exportBlobPartAsFile } from './fileExport';

function toSafeCsvValue(value: unknown): string {
    const text = String(value ?? '');
    return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
}

function escapeCsvCell(value: unknown): string {
    const text = toSafeCsvValue(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function parseCsvText(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    const input = text.replace(/^\uFEFF/, '');

    for (let index = 0; index < input.length; index += 1) {
        const character = input[index];
        if (quoted) {
            if (character === '"' && input[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else if (character === '"') {
                quoted = false;
            } else {
                cell += character;
            }
            continue;
        }

        if (character === '"' && cell.length === 0) {
            quoted = true;
        } else if (character === ',') {
            row.push(cell);
            cell = '';
        } else if (character === '\n' || character === '\r') {
            if (character === '\r' && input[index + 1] === '\n') index += 1;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += character;
        }
    }

    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}

export async function downloadRowsAsCsv(
    rows: Array<Record<string, unknown>>,
    fileName: string,
): Promise<void> {
    const headers = rows[0] ? Object.keys(rows[0]) : [];
    const lines = [
        headers.map(escapeCsvCell).join(','),
        ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(',')),
    ];

    await exportBlobPartAsFile(`\uFEFF${lines.join('\r\n')}`, {
        fileName,
        mimeType: 'text/csv;charset=utf-8',
    });
}
