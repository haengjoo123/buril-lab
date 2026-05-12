export interface ShelfSection {
    index: number;
    start: number;
    end: number;
}

export function normalizeShelfDividers(rawDividers: unknown): number[] {
    let dividers: unknown = rawDividers;

    if (typeof rawDividers === 'string') {
        try {
            dividers = JSON.parse(rawDividers);
        } catch {
            dividers = [];
        }
    }

    if (!Array.isArray(dividers)) return [];

    return [...new Set(
        dividers
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0 && value < 100)
            .map((value) => Math.round(value * 100) / 100),
    )].sort((a, b) => a - b);
}

export function getShelfSections(rawDividers: unknown): ShelfSection[] {
    const boundaries = [0, ...normalizeShelfDividers(rawDividers), 100];

    return boundaries.slice(0, -1).map((start, index) => ({
        index: index + 1,
        start,
        end: boundaries[index + 1],
    }));
}

export function getShelfSectionCount(rawDividers: unknown): number {
    return getShelfSections(rawDividers).length;
}

export function getShelfSectionByIndex(rawDividers: unknown, sectionIndex: number): ShelfSection | null {
    if (!Number.isInteger(sectionIndex) || sectionIndex < 1) return null;
    return getShelfSections(rawDividers).find((section) => section.index === sectionIndex) || null;
}
