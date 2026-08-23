import type { ChemicalEnrichmentResult } from '../types';
import { enrichChemicals } from './chemicalEnrichmentService';

export const INVENTORY_HAZARD_BATCH_SIZE = 25;

export interface InventoryHazardRequestEntry {
    cas: string;
    key: string;
}

export type InventoryHazardBatchOutcome =
    | { chunk: InventoryHazardRequestEntry[]; results: ChemicalEnrichmentResult[] }
    | { chunk: InventoryHazardRequestEntry[]; error: unknown };

type EnrichFunction = typeof enrichChemicals;

export async function enrichInventoryHazardBatches(
    entries: InventoryHazardRequestEntry[],
    options: { labId?: string | null; signal?: AbortSignal },
    enrich: EnrichFunction = enrichChemicals,
): Promise<InventoryHazardBatchOutcome[]> {
    const chunks: InventoryHazardRequestEntry[][] = [];
    for (let start = 0; start < entries.length; start += INVENTORY_HAZARD_BATCH_SIZE) {
        chunks.push(entries.slice(start, start + INVENTORY_HAZARD_BATCH_SIZE));
    }

    return Promise.all(chunks.map(async (chunk) => {
        try {
            const results = await enrich(
                chunk.map((entry) => ({
                    requestId: `inventory-ghs:${entry.cas}`,
                    casNumber: entry.cas,
                })),
                {
                    labId: options.labId,
                    profile: 'inventory_hazard',
                    signal: options.signal,
                },
            );
            return { chunk, results };
        } catch (error) {
            return { chunk, error };
        }
    }));
}
