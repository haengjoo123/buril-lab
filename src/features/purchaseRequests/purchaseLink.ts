/** Inventory URL parameter that opens the low-stock and purchase request dialog. */
export const PURCHASES_PARAM = 'purchases';

/** The inventory route that opens the dialog (used by the lab admin inbox). */
export const PURCHASES_ROUTE = `/app/inventory?${PURCHASES_PARAM}=1`;
