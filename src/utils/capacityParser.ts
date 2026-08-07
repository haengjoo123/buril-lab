export interface CapacityParseResult {
    rawText: string | null;
    /** Total amount represented by the measurement, before inventory quantity. */
    numericValue: number | null;
    unit: string | null;
    volumeMl: number | null;
    massMg: number | null;
}

const CAPACITY_PATTERN = /^(?:(\d[\d.,]*)\s*(?:x|×)\s*)?(\d[\d.,]*)\s*(uL|μL|µL|mL|L|ug|μg|µg|mg|g|kg)$/iu;

function emptyResult(rawText: string | null): CapacityParseResult {
    return {
        rawText,
        numericValue: null,
        unit: null,
        volumeMl: null,
        massMg: null,
    };
}

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

/**
 * Parse a number without treating a thousands separator as a decimal point.
 * Commas are treated as grouping when every group after the first has three
 * digits (1,000); otherwise a comma is treated as the decimal separator.
 * A dot remains the decimal separator, so 1.5 is preserved as 1.5.
 */
function parseCapacityNumber(value: string): number | null {
    if (!/^\d[\d.,]*$/.test(value)) return null;

    let normalized = value;
    const commaCount = (value.match(/,/g) || []).length;
    const dotCount = (value.match(/\./g) || []).length;

    if (commaCount > 0 && dotCount > 0) {
        const lastComma = value.lastIndexOf(',');
        const lastDot = value.lastIndexOf('.');
        const decimalSeparator = lastComma > lastDot ? ',' : '.';
        const groupingSeparator = decimalSeparator === ',' ? '.' : ',';
        const decimalIndex = value.lastIndexOf(decimalSeparator);
        const integerPart = value.slice(0, decimalIndex);
        const decimalPart = value.slice(decimalIndex + 1);
        if (!/^\d{1,3}(?:[.,]\d{3})*$/.test(integerPart) || !/^\d+$/.test(decimalPart)) {
            return null;
        }
        normalized = `${integerPart.replaceAll(groupingSeparator, '').replace(decimalSeparator, '.')}.${decimalPart}`;
    } else if (commaCount > 0) {
        if (/^\d{1,3}(,\d{3})+$/.test(value)) {
            normalized = value.replaceAll(',', '');
        } else if (/^\d+,\d+$/.test(value)) {
            normalized = value.replace(',', '.');
        } else {
            return null;
        }
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toDerivedAmounts(numericValue: number, unit: string): Pick<CapacityParseResult, 'volumeMl' | 'massMg'> {
    const volumeMl = unit === 'uL'
        ? numericValue / 1_000
        : unit === 'mL'
            ? numericValue
            : unit === 'L'
                ? numericValue * 1_000
                : null;
    const massMg = unit === 'ug'
        ? numericValue / 1_000
        : unit === 'mg'
            ? numericValue
            : unit === 'g'
                ? numericValue * 1_000
                : unit === 'kg'
                    ? numericValue * 1_000_000
                    : null;

    return {
        volumeMl: volumeMl !== null && Number.isFinite(volumeMl) && volumeMl > 0 ? volumeMl : null,
        massMg: massMg !== null && Number.isFinite(massMg) && massMg > 0 ? massMg : null,
    };
}

export function parseCapacityMeasurement(input?: string | null): CapacityParseResult {
    const rawText = input?.normalize('NFKC').replace(/\s+/g, ' ').trim() || null;
    if (!rawText) return emptyResult(null);

    const match = rawText.match(CAPACITY_PATTERN);
    if (!match) return emptyResult(rawText);

    const multiplier = match[1] ? parseCapacityNumber(match[1]) : 1;
    const baseValue = parseCapacityNumber(match[2]);
    const unit = normalizeUnit(match[3]);
    if (multiplier === null || baseValue === null) return emptyResult(rawText);

    const numericValue = multiplier * baseValue;
    if (!Number.isFinite(numericValue) || numericValue <= 0) return emptyResult(rawText);

    const derived = toDerivedAmounts(numericValue, unit);
    if (derived.volumeMl === null && derived.massMg === null) return emptyResult(rawText);

    return {
        rawText,
        numericValue,
        unit,
        ...derived,
    };
}

export function estimateTotalVolumeMl(capacity?: string | null, quantity?: number | null): number | null {
    const parsed = parseCapacityMeasurement(capacity);
    if (parsed.volumeMl == null) return null;

    const safeQuantity = quantity == null
        ? 1
        : Number.isFinite(quantity) && quantity > 0
            ? quantity
            : null;
    if (safeQuantity === null) return null;

    const total = parsed.volumeMl * safeQuantity;
    return Number.isFinite(total) && total > 0 ? Number(total.toFixed(3)) : null;
}
