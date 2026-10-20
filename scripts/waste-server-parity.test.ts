import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GoldenConcentrationScenario, WasteGoldenSetV2Row } from '../src/features/wasteGoldenSet/schema';
import { buildServerParityCases, renderServerParityPgTap } from './wasteServerParity';

// buildWasteHandlingComponents lives in the service module, which creates a
// Supabase client on import. No request is made here.
vi.mock('../src/services/supabaseClient', () => ({ supabase: {} }));

const dataDirectory = path.resolve(process.cwd(), 'data', 'waste-golden-set-v2');
const pgTapPath = path.resolve(process.cwd(), 'supabase', 'tests', 'waste_golden_server_parity.sql');
const rows = JSON.parse(readFileSync(path.join(dataDirectory, 'materials.json'), 'utf8')) as WasteGoldenSetV2Row[];
const scenarios = JSON.parse(
    readFileSync(path.join(dataDirectory, 'concentration-scenarios.json'), 'utf8'),
) as GoldenConcentrationScenario[];

describe('client/server waste analyzer parity fixture', () => {
    it('keeps the generated pgTAP parity test in step with the client analyzer', () => {
        const expected = renderServerParityPgTap(buildServerParityCases(rows, scenarios));
        if (process.env.WASTE_SERVER_PARITY_WRITE === '1') {
            writeFileSync(pgTapPath, expected, 'utf8');
        }
        // A stale file means a client rule changed: regenerate it, and the
        // database quality job then shows whether the server still agrees.
        const committed = readFileSync(pgTapPath, 'utf8').replace(/\r\n?/gu, '\n');
        expect(committed === expected, 'supabase/tests/waste_golden_server_parity.sql is stale; regenerate it with WASTE_SERVER_PARITY_WRITE=1').toBe(true);
    });

    it('covers every golden row and concentration scenario', () => {
        const cases = buildServerParityCases(rows, scenarios);
        expect(cases).toHaveLength(rows.length + scenarios.length);
        expect(new Set(cases.map(({ id }) => id)).size).toBe(cases.length);
    });
});
