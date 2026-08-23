import { describe, expect, it } from 'vitest';
import type { ChemicalEnrichmentResult } from '../types';
import { getPictogramCode, getPictogramUrl } from '../data/ghsCodes';
import {
    buildInventoryHazardEntryKey,
    createInventoryHazardSnapshot,
    isInventoryHazardSnapshotFresh,
    pruneInventoryHazardSnapshots,
} from './useInventoryHazardStore';

const enrichmentResult = (overrides: Partial<ChemicalEnrichmentResult> = {}): ChemicalEnrichmentResult => ({
    requestId: 'acetone',
    overallStatus: 'complete',
    identity: {
        status: 'verified',
        casNumber: '67-64-1',
        pubchemCid: 180,
        equivalentPubchemCids: [180],
        evidence: [],
    },
    hazard: {
        status: 'classified',
        hCodes: ['H225', 'H225'],
        hazardStatements: ['H225'],
        pictograms: [
            'https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS02.svg',
            'GHS07.gif',
        ],
        signalWord: 'Danger',
        hazardFlags: ['FLAMMABLE'],
        sources: [{ source: 'pubchem', sourceId: '180' }],
        fetchedAt: '2026-08-17T00:00:00.000Z',
        expiresAt: '2026-08-24T00:00:00.000Z',
    },
    referencePh: { status: 'not_requested' },
    phCatalog: { status: 'unmatched', candidateIds: [], catalogVersion: 'test' },
    enrichmentVersion: 3,
    ...overrides,
});

describe('inventory hazard persisted snapshots', () => {
    it('scopes records by user and lab and normalizes the CAS', () => {
        expect(buildInventoryHazardEntryKey('user-a', 'lab-a', ' 67-64-1 ')).toBe('user-a:lab-a|67-64-1');
        expect(buildInventoryHazardEntryKey('user-a', 'lab-b', '67-64-1')).not.toBe(
            buildInventoryHazardEntryKey('user-a', 'lab-a', '67-64-1'),
        );
    });

    it('stores compact local pictogram codes instead of external URLs', () => {
        const snapshot = createInventoryHazardSnapshot('67-64-1', enrichmentResult());
        expect(snapshot).toMatchObject({
            hCodes: ['H225'],
            pictogramCodes: ['GHS02', 'GHS07'],
            enrichmentVersion: 3,
        });
        expect(getPictogramCode('https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS08.svg')).toBe('GHS08');
        expect(getPictogramUrl('https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS08.svg')).toBe('/ghs/GHS08.svg');
    });

    it('keeps expired evidence but treats it as stale, including version-2 snapshots', () => {
        const snapshot = createInventoryHazardSnapshot('67-64-1', enrichmentResult())!;
        expect(isInventoryHazardSnapshotFresh(snapshot, Date.parse('2026-08-20T00:00:00.000Z'))).toBe(true);
        expect(isInventoryHazardSnapshotFresh(snapshot, Date.parse('2026-08-25T00:00:00.000Z'))).toBe(false);
        expect(isInventoryHazardSnapshotFresh({ ...snapshot, enrichmentVersion: 2 }, Date.parse('2026-08-20T00:00:00.000Z'))).toBe(false);
    });

    it('does not persist transient errors as terminal evidence', () => {
        const transient = enrichmentResult({
            overallStatus: 'retryable',
            hazard: {
                ...enrichmentResult().hazard,
                status: 'transient_error',
                expiresAt: undefined,
            },
        });
        expect(createInventoryHazardSnapshot('67-64-1', transient)).toBeNull();
    });

    it('limits persisted entries per user without evicting another user', () => {
        const base = createInventoryHazardSnapshot('67-64-1', enrichmentResult())!;
        const userA = Array.from({ length: 1_001 }, (_, index) => ({
            key: `user-a:lab-a|cas-${index}`,
            snapshot: {
                ...base,
                casNumber: `cas-${index}`,
                lastAccessedAt: new Date(Date.UTC(2026, 7, 17, 0, 0, index)).toISOString(),
            },
        }));
        const snapshots = pruneInventoryHazardSnapshots(Object.fromEntries([
            ['user-b:lab-b|67-64-1', base],
            ...userA.map(({ key, snapshot }) => [key, snapshot] as const),
        ]));
        const keys = Object.keys(snapshots);
        expect(keys.filter((key) => key.startsWith('user-a:'))).toHaveLength(1_000);
        expect(keys).toContain('user-b:lab-b|67-64-1');
        expect(keys).not.toContain('user-a:lab-a|cas-0');
    });
});
