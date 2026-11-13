import type { PurchaseRequest, PurchaseRequestAction } from '../../services/purchaseRequestService';

/** The admin's next steps for a request, primary first. */
export function adminActionsFor(status: PurchaseRequest['status']): PurchaseRequestAction[] {
    if (status === 'requested') return ['approved', 'rejected'];
    if (status === 'approved') return ['ordered', 'cancelled'];
    if (status === 'ordered') return ['received', 'cancelled'];
    return [];
}
