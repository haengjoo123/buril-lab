import { buildQrLink, spaceFor } from './qrPayload';
import { qrSvgDataUrl } from './qrSvg';

/**
 * A4 sheet of 21 labels (3 columns x 7 rows, 63.5 x 38.1 mm), the layout of
 * common laser label stock. Each label carries a QR link to the inventory
 * item plus enough text to recognise the bottle without scanning.
 */
export const SHEET = {
    columns: 3,
    rows: 7,
    labelWidthMm: 63.5,
    labelHeightMm: 38.1,
    marginTopMm: 15.15,
    marginLeftMm: 7.2,
    columnGapMm: 2.5,
} as const;
export const LABELS_PER_SHEET = SHEET.columns * SHEET.rows;
export const MAX_LABELS = 500;

export interface LabelSheetItem {
    id: string;
    name: string;
    casNumber?: string | null;
    location?: string | null;
}

export interface LabelCell {
    link: string;
    name: string;
    detail: string;
    location: string;
}

export interface LabelSheetModel {
    pages: Array<Array<LabelCell | null>>;
    fileName: string;
    labelCount: number;
}

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/**
 * Builds pages of label cells. `skip` leaves that many cells empty at the start
 * of the first sheet so a partly used sheet can be reused.
 */
export function buildLabelSheetModel(
    items: readonly LabelSheetItem[],
    options: { labId: string | null; skip?: number; printedAt?: Date },
): LabelSheetModel {
    if (items.length === 0) throw new Error('No items to label.');
    if (items.length > MAX_LABELS) throw new Error(`At most ${MAX_LABELS} labels can be printed at once.`);
    const skip = Math.min(Math.max(Math.floor(options.skip ?? 0), 0), LABELS_PER_SHEET - 1);
    const space = spaceFor(options.labId);
    const cells: Array<LabelCell | null> = Array.from({ length: skip }, () => null);
    for (const item of items) {
        cells.push({
            link: buildQrLink({ kind: 'inventory', id: item.id, space }),
            name: clip(item.name.trim() || '-', 60),
            detail: item.casNumber?.trim() ? `CAS ${item.casNumber.trim()}` : '',
            location: clip(item.location?.trim() ?? '', 40),
        });
    }
    const pages: Array<Array<LabelCell | null>> = [];
    for (let start = 0; start < cells.length; start += LABELS_PER_SHEET) {
        const page = cells.slice(start, start + LABELS_PER_SHEET);
        while (page.length < LABELS_PER_SHEET) page.push(null);
        pages.push(page);
    }
    const date = options.printedAt ?? new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    return { pages, fileName: `buril-qr-labels-${stamp}.pdf`, labelCount: items.length };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    Object.assign(node.style, style);
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Builds one element per A4 page with text nodes only, so item text cannot inject markup. */
export function renderLabelSheetPages(model: LabelSheetModel): HTMLElement[] {
    return model.pages.map((page, pageIndex) => {
        const sheet = el('div', {
            position: 'relative',
            width: '210mm',
            height: '296mm',
            background: '#ffffff',
            overflow: 'hidden',
            fontFamily: "'Pretendard Variable', 'Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
            color: '#0f172a',
        });
        sheet.className = pageIndex === 0 ? 'qr-sheet' : 'qr-sheet qr-sheet-next';
        page.forEach((cell, index) => {
            if (!cell) return;
            const column = index % SHEET.columns;
            const row = Math.floor(index / SHEET.columns);
            const label = el('div', {
                position: 'absolute',
                left: `${SHEET.marginLeftMm + column * (SHEET.labelWidthMm + SHEET.columnGapMm)}mm`,
                top: `${SHEET.marginTopMm + row * SHEET.labelHeightMm}mm`,
                width: `${SHEET.labelWidthMm}mm`,
                height: `${SHEET.labelHeightMm}mm`,
                boxSizing: 'border-box',
                padding: '2.5mm',
                display: 'flex',
                gap: '2mm',
                alignItems: 'center',
            });
            const image = el('img', { width: '27mm', height: '27mm', flexShrink: '0' });
            image.src = qrSvgDataUrl(cell.link, { sizePx: 160 });
            image.alt = '';
            const text = el('div', { minWidth: '0', display: 'flex', flexDirection: 'column', gap: '1mm' });
            text.appendChild(el('p', {
                margin: '0', fontSize: '9pt', fontWeight: '700', lineHeight: '1.2', wordBreak: 'break-word',
                maxHeight: '3.6em', overflow: 'hidden',
            }, cell.name));
            if (cell.detail) text.appendChild(el('p', { margin: '0', fontSize: '7pt', color: '#334155' }, cell.detail));
            if (cell.location) text.appendChild(el('p', { margin: '0', fontSize: '7pt', color: '#334155', wordBreak: 'break-word' }, cell.location));
            text.appendChild(el('p', { margin: '0', fontSize: '6pt', color: '#64748b', letterSpacing: '0.04em' }, 'BURIL LAB'));
            label.appendChild(image);
            label.appendChild(text);
            sheet.appendChild(label);
        });
        return sheet;
    });
}

export async function downloadLabelSheetPdf(model: LabelSheetModel): Promise<void> {
    const html2pdf = (await import('html2pdf.js')).default;
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', background: '#ffffff' });
    renderLabelSheetPages(model).forEach((page) => host.appendChild(page));
    document.body.appendChild(host);
    try {
        // html2pdf supports pagebreak at runtime; its bundled types omit it.
        const options = {
            margin: 0,
            filename: model.fileName,
            image: { type: 'png' as const },
            html2canvas: { scale: 3, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const },
            pagebreak: { mode: ['css'], before: '.qr-sheet-next' },
        };
        await html2pdf().set(options as never).from(host).save();
    } finally {
        host.remove();
    }
}
