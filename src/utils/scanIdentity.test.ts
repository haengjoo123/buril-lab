import { describe, expect, it } from 'vitest';
import type { ReagentScanResult } from '../services/aiReagentScanService';
import { scanIdentityMatchesChemical } from './scanIdentity';

const field = (
    value: string | null,
    validation: 'valid' | 'missing' | 'invalid' | 'review_required' = value ? 'valid' : 'missing',
) => ({ value, confidence: value ? 0.95 : 0, validation });

const scan = (name: string | null, casNumber: string | null): ReagentScanResult => ({
    name: name ?? '',
    casNumber: casNumber ?? undefined,
    suggestedContainerType: null,
    success: true,
    fieldSnapshots: {
        name: field(name),
        casNumber: field(casNumber),
        capacity: field(null),
        expiryDate: field(null),
        brand: field(null),
        productNumber: field(null),
        containerType: { value: null, confidence: 0, validation: 'missing' },
    },
});

describe('scanIdentityMatchesChemical', () => {
    it('accepts an exact normalized name when CAS is absent', () => {
        expect(scanIdentityMatchesChemical(
            scan('Sodium cyanide', null),
            'name',
            { name: 'sodium-cyanide', casNumber: '143-33-9' },
        )).toBe(true);
    });

    it('does not verify an unrelated fuzzy search result from a selected name', () => {
        expect(scanIdentityMatchesChemical(
            scan('Acetone', null),
            'name',
            { name: 'Acetonitrile', casNumber: '75-05-8' },
        )).toBe(false);
    });

    it('does not ignore a second checksum-valid CAS that conflicts with the result', () => {
        expect(scanIdentityMatchesChemical(
            scan('Acetone', '75-05-8'),
            'name',
            { name: 'Acetone', casNumber: '67-64-1' },
        )).toBe(false);
    });

    it('requires the selected CAS to be valid and equal to the result', () => {
        expect(scanIdentityMatchesChemical(
            scan('Acetone', '67-64-1'),
            'casNumber',
            { name: 'Acetone', casNumber: '67-64-1' },
        )).toBe(true);

        const invalid = scan('Acetone', '67-64-2');
        invalid.fieldSnapshots!.casNumber.validation = 'invalid';
        expect(scanIdentityMatchesChemical(
            invalid,
            'casNumber',
            { name: 'Acetone', casNumber: '67-64-1' },
        )).toBe(false);
    });
});
