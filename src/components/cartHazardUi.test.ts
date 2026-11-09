import { describe, expect, it } from 'vitest';
import { createWasteComponentFromAnalysis } from '../utils/wasteBatch';
import { getHazardLookupMessageKey, isHazardLookupPending, needsHazardLabelCheck, shouldShowManualHazardPanel } from './cartHazardUi';
import type { ChemicalHazardLookup, WasteComponent } from '../types';

function component(status?: ChemicalHazardLookup['status'], patch: Partial<WasteComponent> = {}): WasteComponent {
    return {
        ...createWasteComponentFromAnalysis({
            chemical: { id: 'hcl', name: 'Hydrochloric Acid', casNumber: '7647-01-0', molecularFormula: 'HCl' },
            category: 'ACID', binColor: 'bg-red-500', label: 'label_acid', reason: '', isSafe: false,
        }),
        ...(status ? { chemical: {
            id: 'hcl', name: 'Hydrochloric Acid', casNumber: '7647-01-0', molecularFormula: 'HCl',
            hazardLookup: { status, hCodes: [], hazardStatements: [], pictograms: [], hazardFlags: [], sources: [], fetchedAt: '2026-11-09T00:00:00Z', algorithmVersion: 2 },
        } } : {}),
        ...patch,
    };
}

describe('automatic hazard lookup UI', () => {
    it('waits for the initial automatic lookup instead of asking for manual checks', () => {
        const input = component();
        expect(isHazardLookupPending(input, true)).toBe(true);
        expect(needsHazardLabelCheck(input, true)).toBe(false);
        expect(shouldShowManualHazardPanel(input, true)).toBe(false);
    });

    it.each(['classified', 'not_classified'] as const)('requires no checklist after an automatic %s result, including old manual confirmations', (status) => {
        const input = component(status, { ghsDataStatus: 'verified', hazardDataConfirmedByUser: true });
        expect(isHazardLookupPending(input, true)).toBe(false);
        expect(needsHazardLabelCheck(input, true)).toBe(false);
        expect(shouldShowManualHazardPanel(input, true)).toBe(false);
    });

    it('shows manual checks only after the automatic network retry is exhausted', () => {
        const retrying = component('transient_error', { ghsDataStatus: 'lookup_failed', enrichmentRetryCount: 1 });
        expect(isHazardLookupPending(retrying, true)).toBe(true);
        expect(shouldShowManualHazardPanel(retrying, true)).toBe(false);
        const exhausted = { ...retrying, enrichmentRetryCount: 2 };
        expect(isHazardLookupPending(exhausted, true)).toBe(false);
        expect(shouldShowManualHazardPanel(exhausted, true)).toBe(true);
    });

    it.each(['identity_ambiguous', 'source_absent'] as const)('explains %s rather than leaving an empty warning after identity confirmation', (status) => {
        const input = component(status, { identityConfidence: 'verified', identityConfirmedByUser: true });
        expect(needsHazardLabelCheck(input, true)).toBe(true);
        expect(getHazardLookupMessageKey(input)).toBe(`waste_component_hazard_${status}`);
    });

    it('keeps the manual fallback accessible when automatic enrichment is disabled', () => {
        const input = component();
        expect(isHazardLookupPending(input, false)).toBe(false);
        expect(shouldShowManualHazardPanel(input, false)).toBe(true);
    });
});
