import { supabase } from './supabaseClient';
import { loadChemicalRegulations } from './chemicalRegulationService';
import { isRegulationBatchEnabled } from '../config/featureFlags';
import {
    summarizeCabinetLocks,
    type CabinetLockSummary,
    type LabCabinetItemInput,
    type LabCabinetLockInput,
} from '../features/dailyInspection/labSafetySignals';
import type { ReagentGhsStatus } from '../types/fridge';
import { normalizeCasNumber } from '../utils/casNumber';
import { hasObligation } from '../utils/regulationObligations';

const asStringArray = (value: unknown): string[] => (
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
);

/**
 * Which cabinets of a lab hold reagents that belong behind a lock, split into
 * cabinets recorded as having none and cabinets not recorded yet. Reads
 * cabinets.locked, so it needs the 20261116100000 migration.
 */
export async function loadCabinetLockSummary(labId: string): Promise<CabinetLockSummary> {
    const { data: cabinetRows, error } = await supabase
        .from('cabinets')
        .select('id,name,locked')
        .eq('lab_id', labId);
    if (error) throw error;
    const cabinets: LabCabinetLockInput[] = (cabinetRows ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ''),
        locked: typeof row.locked === 'boolean' ? row.locked : null,
    }));
    // Only cabinets that could produce a signal need their items read.
    const candidates = cabinets.filter((cabinet) => cabinet.locked !== true);
    if (candidates.length === 0) return { unlocked: [], unset: [] };

    const { data: itemRows, error: itemError } = await supabase
        .from('cabinet_items')
        .select('cabinet_id,name,h_codes,cas_no,ghs_status')
        .in('cabinet_id', candidates.map((cabinet) => cabinet.id));
    if (itemError) throw itemError;
    const items: LabCabinetItemInput[] = (itemRows ?? []).map((row) => ({
        cabinetId: String(row.cabinet_id),
        name: String(row.name ?? ''),
        hCodes: asStringArray(row.h_codes),
        casNo: typeof row.cas_no === 'string' ? row.cas_no : null,
        ghsStatus: (row.ghs_status ?? undefined) as ReagentGhsStatus | undefined,
    }));

    let isRegulatedLockRequired: (casNo: string | null) => boolean = () => false;
    if (isRegulationBatchEnabled) {
        const regulations = await loadChemicalRegulations(items.map((item) => item.casNo ?? ''), { maxRounds: 2 })
            .catch(() => new Map());
        isRegulatedLockRequired = (casNo) => {
            const cas = normalizeCasNumber(casNo);
            const lookup = cas ? regulations.get(cas) : undefined;
            return lookup?.status === 'found' && hasObligation(lookup.record.entries, 'store_locked');
        };
    }
    return summarizeCabinetLocks(cabinets, items, isRegulatedLockRequired);
}
