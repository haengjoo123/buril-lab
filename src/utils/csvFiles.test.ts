import { describe, expect, it } from 'vitest';
import { parseCsvText } from './csvFiles';

describe('CSV parsing', () => {
    it('keeps quoted commas, escaped quotes, and blank cells intact', () => {
        expect(parseCsvText('\uFEFFname,memo\r\nAcetone,"opened, today"\r\nEthanol,"He said ""check label""",\r\n'))
            .toEqual([
                ['name', 'memo'],
                ['Acetone', 'opened, today'],
                ['Ethanol', 'He said "check label"', ''],
            ]);
    });
});
