import type { LabMember } from '../store/useLabStore';

export type LabSegmentAction =
    | { type: 'switch'; labId: string }
    | { type: 'toggle-menu' }
    | { type: 'open-manage' };

interface LabSegmentInput {
    currentLabId: string | null;
    lastLabId: string | null;
    myLabs: LabMember[];
    labsReady: boolean;
}

/**
 * Decides what pressing the "lab" segment does.
 * - Already in a lab (or labs still loading): toggle the lab list.
 * - No labs yet: open lab management to create or join one.
 * - In personal space: jump straight back to the last lab, falling back to the first one.
 */
export function resolveLabSegmentAction({ currentLabId, lastLabId, myLabs, labsReady }: LabSegmentInput): LabSegmentAction {
    if (currentLabId || !labsReady) return { type: 'toggle-menu' };
    if (myLabs.length === 0) return { type: 'open-manage' };
    const target = myLabs.find(member => member.lab_id === lastLabId) ?? myLabs[0];
    return { type: 'switch', labId: target.lab_id };
}
