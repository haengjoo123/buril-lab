import { describe, expect, it, vi } from 'vitest';
import type { ChemicalEnrichmentResult } from '../types';
import { enrichInventoryHazardBatches } from './inventoryHazardService';

const resultFor = (requestId: string): ChemicalEnrichmentResult => ({
    requestId,
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
        hCodes: ['H225'],
        hazardStatements: ['H225'],
        pictograms: ['GHS02'],
        hazardFlags: ['FLAMMABLE'],
        sources: [{ source: 'pubchem', sourceId: '180' }],
        fetchedAt: '2026-08-17T00:00:00.000Z',
        expiresAt: '2026-08-24T00:00:00.000Z',
    },
    referencePh: { status: 'not_requested' },
    phCatalog: { status: 'unmatched', candidateIds: [], catalogVersion: 'test' },
    enrichmentVersion: 3,
});

describe('inventory hazard batch service', () => {
    it('sends 70 distinct identities in no more than three 25-item requests', async () => {
        const enrich = vi.fn(async (
            items: Array<{ requestId: string }>,
            options?: { profile?: string },
        ) => {
            void options;
            return items.map((item) => resultFor(item.requestId));
        });
        const entries = Array.from({ length: 70 }, (_, index) => ({
            cas: `inventory-cas-${index}`,
            key: `scope|inventory-cas-${index}`,
        }));

        const outcomes = await enrichInventoryHazardBatches(entries, { labId: 'lab-a' }, enrich as never);

        expect(enrich).toHaveBeenCalledTimes(3);
        expect(enrich.mock.calls.map((call) => call[0].length)).toEqual([25, 25, 20]);
        expect(enrich.mock.calls.every((call) => call[1]?.profile === 'inventory_hazard')).toBe(true);
        expect(outcomes.flatMap((outcome) => outcome.chunk)).toHaveLength(70);
    });

    it('keeps a failed chunk separate so successful chunks can still be stored', async () => {
        const enrich = vi.fn(async (items: Array<{ requestId: string }>) => {
            if (items[0]?.requestId.includes('25')) throw new Error('temporary');
            return items.map((item) => resultFor(item.requestId));
        });
        const entries = Array.from({ length: 30 }, (_, index) => ({ cas: String(index), key: `key-${index}` }));

        const outcomes = await enrichInventoryHazardBatches(entries, {}, enrich as never);

        expect(outcomes).toHaveLength(2);
        expect(outcomes[0]).toHaveProperty('results');
        expect(outcomes[1]).toHaveProperty('error');
    });
});
