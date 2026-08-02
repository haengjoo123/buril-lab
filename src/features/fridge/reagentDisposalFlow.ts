import type { InventoryUsageCompletionKind } from '../../services/inventoryService';

export type ReagentDisposalReason =
    | 'used'
    | 'empty_container'
    | 'contaminated_container'
    | 'expired'
    | 'broken'
    | 'leak'
    | 'other';

export type WasteBatchDisposalReason = Exclude<
    ReagentDisposalReason,
    InventoryUsageCompletionKind
>;

export type ReagentDisposalActionResult<TReceipt> =
    | { kind: 'inventory_usage_completed'; receipt: TReceipt }
    | { kind: 'waste_batch_started' };

export async function executeReagentDisposalAction<TReceipt>(input: {
    reason: ReagentDisposalReason;
    completeUsage: (kind: InventoryUsageCompletionKind) => Promise<TReceipt>;
    startWasteBatch: (reason: WasteBatchDisposalReason) => Promise<void>;
}): Promise<ReagentDisposalActionResult<TReceipt>> {
    if (input.reason === 'used' || input.reason === 'empty_container') {
        return {
            kind: 'inventory_usage_completed',
            receipt: await input.completeUsage(input.reason),
        };
    }

    await input.startWasteBatch(input.reason);
    return { kind: 'waste_batch_started' };
}

export function requiresSolidSlurryWasteBatch(
    reason: WasteBatchDisposalReason | undefined,
): boolean {
    return reason === 'broken' || reason === 'contaminated_container';
}
