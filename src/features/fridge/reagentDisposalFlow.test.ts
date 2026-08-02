import { describe, expect, it, vi } from 'vitest';
import {
    executeReagentDisposalAction,
    requiresSolidSlurryWasteBatch,
    type ReagentDisposalReason,
} from './reagentDisposalFlow';

describe('reagent disposal action routing', () => {
    it.each(['used', 'empty_container'] as const)(
        'routes %s to inventory usage completion without a waste batch',
        async (reason) => {
            const receipt = { requestId: 'request-id' };
            const completeUsage = vi.fn().mockResolvedValue(receipt);
            const startWasteBatch = vi.fn();

            await expect(executeReagentDisposalAction({
                reason,
                completeUsage,
                startWasteBatch,
            })).resolves.toEqual({ kind: 'inventory_usage_completed', receipt });

            expect(completeUsage).toHaveBeenCalledWith(reason);
            expect(startWasteBatch).not.toHaveBeenCalled();
        },
    );

    it.each([
        'expired',
        'broken',
        'contaminated_container',
        'other',
    ] as const)('routes %s to the common waste-batch flow', async (reason) => {
        const completeUsage = vi.fn();
        const startWasteBatch = vi.fn().mockResolvedValue(undefined);

        await expect(executeReagentDisposalAction({
            reason,
            completeUsage,
            startWasteBatch,
        })).resolves.toEqual({ kind: 'waste_batch_started' });

        expect(startWasteBatch).toHaveBeenCalledWith(reason);
        expect(completeUsage).not.toHaveBeenCalled();
    });

    it('forces broken and contaminated-container starts to solid/slurry only', () => {
        const reasons: ReagentDisposalReason[] = [
            'used',
            'empty_container',
            'contaminated_container',
            'expired',
            'broken',
            'other',
        ];

        expect(reasons.filter((reason) =>
            reason !== 'used' &&
            reason !== 'empty_container' &&
            requiresSolidSlurryWasteBatch(reason)
        )).toEqual(['contaminated_container', 'broken']);
    });
});
