import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { buildQrLink, labIdFromSpace, parseQrLink, qrTargetRoute, spaceFor } from './qrPayload';
import { qrSvg } from './qrSvg';
import { LABELS_PER_SHEET, MAX_LABELS, buildLabelSheetModel } from './labelSheet';
import { locationKeyOf, recordScan, setManualConfirmation, startStocktake, summarizeStocktake, type StocktakeItem } from './stocktake';

const ITEM = '11111111-1111-4111-8111-111111111111';
const LAB = '22222222-2222-4222-8222-222222222222';

/** Renders text the way the label does and decodes it the way the scanner does. */
function roundTrip(text: string): string | null {
    const code = qrcode(0, 'M');
    code.addData(text, 'Byte');
    code.make();
    const modules = code.getModuleCount();
    const scale = 4;
    const quiet = 4;
    const size = (modules + quiet * 2) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let row = 0; row < modules; row += 1) {
        for (let col = 0; col < modules; col += 1) {
            if (!code.isDark(row, col)) continue;
            for (let dy = 0; dy < scale; dy += 1) {
                for (let dx = 0; dx < scale; dx += 1) {
                    const offset = (((row + quiet) * scale + dy) * size + (col + quiet) * scale + dx) * 4;
                    pixels[offset] = 0;
                    pixels[offset + 1] = 0;
                    pixels[offset + 2] = 0;
                }
            }
        }
    }
    return jsQR(pixels, size, size)?.data ?? null;
}

describe('QR links', () => {
    it('builds an app link that parses back to the same target', () => {
        const link = buildQrLink({ kind: 'inventory', id: ITEM.toUpperCase(), space: LAB });
        expect(link).toBe(`https://burillab.com/app/inventory?item=${ITEM}&space=${LAB}`);
        expect(parseQrLink(link)).toEqual({ kind: 'inventory', id: ITEM, space: LAB });
        const container = buildQrLink({ kind: 'container', id: ITEM, space: 'personal' });
        expect(parseQrLink(container)).toEqual({ kind: 'container', id: ITEM, space: 'personal' });
        expect(qrTargetRoute({ kind: 'container', id: ITEM, space: 'personal' })).toBe(`/app/logs?container=${ITEM}&space=personal`);
    });

    it('survives printing and scanning', () => {
        const link = buildQrLink({ kind: 'inventory', id: ITEM, space: LAB });
        expect(roundTrip(link)).toBe(link);
        expect(qrSvg(link)).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    });

    it('ignores codes that are not Buril Lab links', () => {
        expect(parseQrLink('hello')).toBeNull();
        expect(parseQrLink(`https://evil.example/app/inventory?item=${ITEM}`)).toBeNull();
        expect(parseQrLink('https://burillab.com/app/inventory?item=not-a-uuid')).toBeNull();
        expect(parseQrLink(`https://burillab.com/app/search?item=${ITEM}`)).toBeNull();
        expect(parseQrLink(`https://burillab.com/app/inventory?item=${ITEM}&space=../x`)).toBeNull();
        expect(parseQrLink(`http://localhost:5173/app/inventory?item=${ITEM}`)).toBeNull();
        expect(parseQrLink(`http://localhost:5173/app/inventory?item=${ITEM}`, ['http://localhost:5173'])?.id).toBe(ITEM);
        expect(parseQrLink(`https://staging.burillab.com/app/inventory?item=${ITEM}`)?.space).toBe('personal');
    });

    it('rejects ids that would put arbitrary text in a label', () => {
        expect(() => buildQrLink({ kind: 'inventory', id: 'abc', space: 'personal' })).toThrow();
        expect(() => buildQrLink({ kind: 'inventory', id: ITEM, space: 'team-a' })).toThrow();
        expect(spaceFor(null)).toBe('personal');
        expect(labIdFromSpace(spaceFor(LAB))).toBe(LAB);
    });
});

describe('label sheet', () => {
    const items = Array.from({ length: 23 }, (_, index) => ({
        id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
        name: index === 0 ? 'A'.repeat(80) : `Reagent ${index}`,
        casNumber: index % 2 ? '67-64-1' : null,
        location: 'Cabinet A (Shelf 2)',
    }));

    it('fills 21 cells per sheet, honouring a partly used first sheet', () => {
        const model = buildLabelSheetModel(items, { labId: LAB, skip: 5, printedAt: new Date(2026, 10, 13) });
        expect(model.pages).toHaveLength(2);
        expect(model.pages.every((page) => page.length === LABELS_PER_SHEET)).toBe(true);
        expect(model.pages[0].slice(0, 5)).toEqual([null, null, null, null, null]);
        expect(model.pages[0][5]?.name.endsWith('…')).toBe(true);
        expect(model.pages[0][6]?.detail).toBe('CAS 67-64-1');
        expect(model.pages[1].filter(Boolean)).toHaveLength(23 - 16);
        expect(model.fileName).toBe('buril-qr-labels-20261113.pdf');
        expect(parseQrLink(model.pages[0][5]!.link)).toEqual({ kind: 'inventory', id: items[0].id, space: LAB });
    });

    it('refuses an empty or oversized batch', () => {
        expect(() => buildLabelSheetModel([], { labId: null })).toThrow();
        expect(() => buildLabelSheetModel(Array.from({ length: MAX_LABELS + 1 }, () => items[1]), { labId: null })).toThrow();
    });
});

describe('stocktake', () => {
    const items: StocktakeItem[] = [
        { id: 'a', name: 'Acetone', casNumber: '67-64-1', locationKey: 'cabinet:1', locationLabel: 'Cabinet 1' },
        { id: 'b', name: 'Benzene', casNumber: null, locationKey: 'cabinet:1', locationLabel: 'Cabinet 1' },
        { id: 'c', name: 'Chloroform', casNumber: null, locationKey: 'cabinet:2', locationLabel: 'Cabinet 2' },
    ];

    it('derives the location key the same way for every storage kind', () => {
        expect(locationKeyOf({ storage_type: 'cabinet', cabinet_id: 'x' })).toBe('cabinet:x');
        expect(locationKeyOf({ storage_type: 'other', storage_location_id: 'y' })).toBe('location:y');
        expect(locationKeyOf({ storage_type: 'other' })).toBe('other');
    });

    it('matches scans, reports bottles recorded elsewhere and unknown labels', () => {
        let state = startStocktake('cabinet:1');
        state = recordScan(state, 'A', items, new Date('2026-11-13T00:00:00Z')).state;
        state = recordScan(state, 'c', items).state;
        const unknown = recordScan(state, 'zzz', items);
        expect(unknown.item).toBeNull();
        state = recordScan(unknown.state, 'zzz', items).state;

        const summary = summarizeStocktake(state, items);
        expect(summary).toMatchObject({ expected: 2, confirmed: 1, missing: 1, elsewhere: 1, unknown: 1 });
        expect(summary.rows.map((row) => [row.item.id, row.status])).toEqual([['b', 'missing'], ['c', 'elsewhere'], ['a', 'confirmed']]);
        expect(summary.rows[2].confirmation).toEqual({ via: 'scan', at: '2026-11-13T00:00:00.000Z' });
    });

    it('lets a bottle without a readable label be confirmed and undone by hand', () => {
        let state = setManualConfirmation(startStocktake('cabinet:1'), 'b', true);
        expect(summarizeStocktake(state, items).confirmed).toBe(1);
        expect(state.confirmations.b.via).toBe('manual');
        state = setManualConfirmation(state, 'b', false);
        expect(summarizeStocktake(state, items).confirmed).toBe(0);
    });
});
