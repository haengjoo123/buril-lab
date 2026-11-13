/**
 * Low-stock forecast for the inventory. Rows of the same product (CAS number,
 * else brand and product number, else the name) are pooled; the stock on hand
 * counts sealed bottles as whole and the open one by its recorded remaining
 * percent. When bottles of the product were used up recently, the pace gives
 * an estimate of the days left; otherwise only the remaining percent of a last
 * bottle can flag it. Fully used rows are removed from the inventory, so their
 * history is not counted: the estimate is a hint, never a promise.
 */

export const USAGE_WINDOW_DAYS = 180;
/** Days of stock left at or below which a product is "low" / "soon". */
export const LOW_DAYS = 30;
export const SOON_DAYS = 60;
/** Remaining percent of a single last bottle at or below which it is "low" / "soon". */
export const LOW_PERCENT = 20;
export const SOON_PERCENT = 40;
/** A suggested order covers this many days at the recent pace. */
export const ORDER_COVER_DAYS = 90;

export interface ForecastItem {
    id: string;
    name: string;
    brand: string | null;
    product_number: string | null;
    cas_number: string | null;
    quantity: number;
    capacity: string | null;
    remaining_percent: number | null;
}

export interface UsageCount {
    usedCount: number;
    lastUsedAt: string | null;
}

export type ForecastLevel = 'low' | 'soon';
export type ForecastReason = 'pace' | 'last_bottle';

export interface StockForecast {
    key: string;
    name: string;
    brand: string | null;
    productNumber: string | null;
    casNumber: string | null;
    capacity: string | null;
    /** Inventory rows pooled into this product; the first one is the request's source. */
    itemIds: string[];
    bottles: number;
    /** Bottles on hand, the open one counted by its remaining percent. */
    onHand: number;
    /** Bottles used up in the usage window. */
    usedInWindow: number;
    /** Days of stock left at the recent pace; null without recent use. */
    daysLeft: number | null;
    level: ForecastLevel;
    reason: ForecastReason;
    /** Remaining percent of the only bottle; null with more than one. */
    lastBottlePercent: number | null;
    suggestedQuantity: number;
}

const norm = (value: string | null | undefined): string => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function productKeyOf(item: Pick<ForecastItem, 'name' | 'brand' | 'product_number' | 'cas_number'>): string {
    const cas = norm(item.cas_number);
    if (cas) return `cas:${cas}`;
    const product = norm(item.product_number);
    if (product) return `pn:${norm(item.brand)}|${product}`;
    return `name:${norm(item.name)}`;
}

function clampPercent(value: number | null): number {
    if (value === null || !Number.isFinite(value)) return 100;
    return Math.min(100, Math.max(0, value));
}

function bottlesOnHand(item: ForecastItem): number {
    const quantity = Math.max(0, Math.floor(item.quantity || 0));
    if (quantity === 0) return 0;
    return quantity - 1 + clampPercent(item.remaining_percent) / 100;
}

/** Products running low, most urgent first. */
export function forecastStock(
    items: readonly ForecastItem[],
    usage: ReadonlyMap<string, UsageCount>,
): StockForecast[] {
    const groups = new Map<string, ForecastItem[]>();
    for (const item of items) {
        if (!item.name?.trim()) continue;
        const key = productKeyOf(item);
        const group = groups.get(key);
        if (group) group.push(item);
        else groups.set(key, [item]);
    }

    const forecasts: StockForecast[] = [];
    for (const [key, rows] of groups) {
        const bottles = rows.reduce((sum, row) => sum + Math.max(0, Math.floor(row.quantity || 0)), 0);
        const onHand = rows.reduce((sum, row) => sum + bottlesOnHand(row), 0);
        const usedInWindow = rows.reduce((sum, row) => sum + (usage.get(row.id)?.usedCount ?? 0), 0);
        const perDay = usedInWindow / USAGE_WINDOW_DAYS;
        const daysLeft = perDay > 0 ? Math.floor(onHand / perDay) : null;

        let level: ForecastLevel | null = null;
        let reason: ForecastReason = 'pace';
        let lastBottlePercent: number | null = null;
        if (daysLeft !== null && daysLeft <= SOON_DAYS) {
            level = daysLeft <= LOW_DAYS ? 'low' : 'soon';
        }
        if (bottles === 1) {
            const percent = clampPercent(rows.find((row) => row.quantity > 0)?.remaining_percent ?? null);
            lastBottlePercent = Math.round(percent);
            const byPercent: ForecastLevel | null = percent <= LOW_PERCENT ? 'low' : percent <= SOON_PERCENT ? 'soon' : null;
            if (byPercent && (level === null || (byPercent === 'low' && level === 'soon'))) {
                level = byPercent;
                reason = 'last_bottle';
            }
        }
        if (!level) continue;

        const first = rows[0];
        forecasts.push({
            key,
            name: first.name.trim(),
            brand: rows.find((row) => row.brand?.trim())?.brand?.trim() ?? null,
            productNumber: rows.find((row) => row.product_number?.trim())?.product_number?.trim() ?? null,
            casNumber: rows.find((row) => row.cas_number?.trim())?.cas_number?.trim() ?? null,
            capacity: rows.find((row) => row.capacity?.trim())?.capacity?.trim() ?? null,
            itemIds: rows.map((row) => row.id),
            bottles,
            onHand: Math.round(onHand * 10) / 10,
            usedInWindow,
            daysLeft,
            level,
            reason,
            lastBottlePercent,
            suggestedQuantity: Math.min(99, Math.max(1, Math.ceil(perDay * ORDER_COVER_DAYS - onHand))),
        });
    }

    const rank = (forecast: StockForecast) => (forecast.level === 'low' ? 0 : 1);
    return forecasts.sort((a, b) => rank(a) - rank(b)
        || (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY)
        || a.onHand - b.onHand
        || a.name.localeCompare(b.name, 'ko'));
}
