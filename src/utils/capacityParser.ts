export interface CapacityParseResult {
    rawText: string | null;
    numericValue: number | null;
    unit: string | null;
    volumeMl: number | null;
}

const CAPACITY_PATTERN = /(\d+(?:[.,]\d+)?)\s*(ul|uL|UL|μl|μL|µl|µL|ml|mL|ML|l|L|mg|mG|g|G|kg|kG|KG|ug|uG|UG|μg|µg)\b/;

function normalizeUnit(unit: string): string {
    const lowered = unit.toLowerCase();

    if (lowered === 'ul' || lowered === 'μl' || lowered === 'µl') return 'uL';
    if (lowered === 'ml') return 'mL';
    if (lowered === 'l') return 'L';
    if (lowered === 'ug' || lowered === 'μg' || lowered === 'µg') return 'ug';
    if (lowered === 'mg') return 'mg';
    if (lowered === 'g') return 'g';
    if (lowered === 'kg') return 'kg';

    return unit;
}

export function parseCapacityMeasurement(input?: string | null): CapacityParseResult {
    const rawText = input?.trim() || null;

    if (!rawText) {
        return {
            rawText: null,
            numericValue: null,
            unit: null,
            volumeMl: null,
        };
    }

    const match = rawText.match(CAPACITY_PATTERN);
    if (!match) {
        return {
            rawText,
            numericValue: null,
            unit: null,
            volumeMl: null,
        };
    }

    const numericValue = Number.parseFloat(match[1].replace(',', '.'));
    const unit = normalizeUnit(match[2]);

    if (!Number.isFinite(numericValue)) {
        return {
            rawText,
            numericValue: null,
            unit,
            volumeMl: null,
        };
    }

    let volumeMl: number | null = null;
    if (unit === 'uL') volumeMl = numericValue / 1000;
    if (unit === 'mL') volumeMl = numericValue;
    if (unit === 'L') volumeMl = numericValue * 1000;

    return {
        rawText,
        numericValue,
        unit,
        volumeMl,
    };
}

export function estimateTotalVolumeMl(capacity?: string | null, quantity?: number | null): number | null {
    const parsed = parseCapacityMeasurement(capacity);
    if (parsed.volumeMl == null) return null;

    const safeQuantity = quantity && quantity > 0 ? quantity : 1;
    return Number((parsed.volumeMl * safeQuantity).toFixed(3));
}
