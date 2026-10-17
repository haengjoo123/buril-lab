import type { WasteHazardFlag } from '../../types';
import type {
    WasteContainer,
    WasteContainerDeposit,
    WasteContainerStatus,
} from '../../services/wasteContainerService';

export interface ContainerComponentSummary {
    key: string;
    chemicalName: string;
    casNumber: string | null;
    depositCount: number;
    /** Sum of item-level solution volumes; null when no deposit recorded one. */
    recordedVolumeMl: number | null;
    hazardFlags: WasteHazardFlag[];
    firstAt: string;
    lastAt: string;
}

export interface ContainerSummary {
    depositCount: number;
    voidedCount: number;
    totalMl: number;
    totalMg: number;
    /** Some deposits have no amount, so totals are lower bounds. */
    hasUnknownAmounts: boolean;
    hasApproximateAmounts: boolean;
    /** totalMl / capacity, or null without a capacity. Not capped at 1. */
    fillRatio: number | null;
    firstDepositAt: string | null;
    lastDepositAt: string | null;
    components: ContainerComponentSummary[];
    hazardFlags: WasteHazardFlag[];
}

export const FILL_WARNING_RATIO = 0.8;

const HAZARD_ORDER: WasteHazardFlag[] = [
    'EXPLOSIVE', 'SELF_REACTIVE', 'PYROPHORIC', 'WATER_REACTIVE', 'OXIDIZER', 'REACTIVE',
    'HYDROFLUORIC_ACID', 'CYANIDE', 'SULFIDE', 'ACUTE_TOXIC', 'CMR', 'CORROSIVE',
    'FLAMMABLE', 'HEAVY_METAL', 'FLUORIDE', 'ENVIRONMENTAL_HAZARD', 'UNKNOWN_COMPONENT',
];

function sortHazards(flags: Iterable<WasteHazardFlag>): WasteHazardFlag[] {
    const unique = Array.from(new Set(flags));
    return unique.sort((a, b) => {
        const ai = HAZARD_ORDER.indexOf(a);
        const bi = HAZARD_ORDER.indexOf(b);
        return (ai === -1 ? HAZARD_ORDER.length : ai) - (bi === -1 ? HAZARD_ORDER.length : bi) || a.localeCompare(b);
    });
}

function componentKey(name: string, cas: string | null): string {
    const normalizedCas = cas?.trim();
    return normalizedCas ? `cas:${normalizedCas}` : `name:${name.trim().toLowerCase()}`;
}

/** Aggregates the deposits of one container. Voided deposits are counted but excluded. */
export function summarizeContainer(
    container: Pick<WasteContainer, 'capacityMl'>,
    deposits: WasteContainerDeposit[],
): ContainerSummary {
    const live = deposits.filter((deposit) => !deposit.voidedAt);
    const components = new Map<string, ContainerComponentSummary>();
    let totalMl = 0;
    let totalMg = 0;
    let hasUnknownAmounts = false;
    let hasApproximateAmounts = false;

    for (const deposit of live) {
        if (deposit.amountIsUnknown || deposit.amountValue === null || deposit.amountUnit === null) {
            hasUnknownAmounts = true;
        } else if (deposit.amountUnit === 'mL') {
            totalMl += deposit.amountValue;
        } else {
            totalMg += deposit.amountValue;
        }
        if (deposit.amountIsApproximate) hasApproximateAmounts = true;

        for (const item of deposit.items) {
            const name = item.chemicalName.trim();
            if (!name) continue;
            const key = componentKey(name, item.casNumber);
            const existing = components.get(key);
            if (existing) {
                existing.depositCount += 1;
                if (item.solutionVolumeMl !== null) {
                    existing.recordedVolumeMl = (existing.recordedVolumeMl ?? 0) + item.solutionVolumeMl;
                }
                existing.hazardFlags = sortHazards([...existing.hazardFlags, ...item.hazardFlags]);
                if (deposit.createdAt < existing.firstAt) existing.firstAt = deposit.createdAt;
                if (deposit.createdAt > existing.lastAt) existing.lastAt = deposit.createdAt;
            } else {
                components.set(key, {
                    key,
                    chemicalName: name,
                    casNumber: item.casNumber?.trim() || null,
                    depositCount: 1,
                    recordedVolumeMl: item.solutionVolumeMl,
                    hazardFlags: sortHazards(item.hazardFlags),
                    firstAt: deposit.createdAt,
                    lastAt: deposit.createdAt,
                });
            }
        }
    }

    // A chemical recorded once with a CAS and once without is still one chemical.
    const casNameKeys = new Map<string, string>();
    components.forEach((component, key) => {
        if (component.casNumber) casNameKeys.set(component.chemicalName.trim().toLowerCase(), key);
    });
    components.forEach((component, key) => {
        if (component.casNumber) return;
        const target = casNameKeys.get(component.chemicalName.trim().toLowerCase());
        const merged = target ? components.get(target) : undefined;
        if (!merged) return;
        merged.depositCount += component.depositCount;
        if (component.recordedVolumeMl !== null) {
            merged.recordedVolumeMl = (merged.recordedVolumeMl ?? 0) + component.recordedVolumeMl;
        }
        merged.hazardFlags = sortHazards([...merged.hazardFlags, ...component.hazardFlags]);
        if (component.firstAt < merged.firstAt) merged.firstAt = component.firstAt;
        if (component.lastAt > merged.lastAt) merged.lastAt = component.lastAt;
        components.delete(key);
    });

    const sortedComponents = Array.from(components.values()).sort((a, b) => (
        (b.recordedVolumeMl ?? -1) - (a.recordedVolumeMl ?? -1)
        || b.depositCount - a.depositCount
        || a.chemicalName.localeCompare(b.chemicalName)
    ));
    const dates = live.map((deposit) => deposit.createdAt).filter(Boolean).sort();

    return {
        depositCount: live.length,
        voidedCount: deposits.length - live.length,
        totalMl,
        totalMg,
        hasUnknownAmounts,
        hasApproximateAmounts,
        fillRatio: container.capacityMl ? totalMl / container.capacityMl : null,
        firstDepositAt: dates[0] ?? null,
        lastDepositAt: dates[dates.length - 1] ?? null,
        components: sortedComponents,
        hazardFlags: sortHazards(sortedComponents.flatMap((component) => component.hazardFlags)),
    };
}

const STATUS_ORDER: Record<WasteContainerStatus, number> = { active: 0, sealed: 1, collected: 2 };

/** Active first, then sealed, then collected; newest start date first within a status. */
export function sortContainers<T extends Pick<WasteContainer, 'status' | 'startedAt' | 'label'>>(containers: T[]): T[] {
    return [...containers].sort((a, b) => (
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        || b.startedAt.localeCompare(a.startedAt)
        || a.label.localeCompare(b.label)
    ));
}

/** Formats a volume in mL as "850 mL" or "4.2 L". */
export function formatVolumeMl(value: number): string {
    if (value >= 1000) {
        const liters = value / 1000;
        return `${Number.isInteger(liters) ? liters : liters.toFixed(liters >= 10 ? 1 : 2).replace(/0+$/, '').replace(/\.$/, '')} L`;
    }
    return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, '')} mL`;
}

export function formatMassMg(value: number): string {
    if (value >= 1000) {
        const grams = value / 1000;
        return `${Number.isInteger(grams) ? grams : grams.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} g`;
    }
    return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, '')} mg`;
}

/**
 * Pick the container a deposit should go to: the explicit choice if it is still
 * available, the only active one when there is exactly one, otherwise none.
 */
export function chooseDefaultContainer<T extends Pick<WasteContainer, 'id'>>(
    candidates: T[],
    previousChoice: string | null,
): string | null {
    if (previousChoice && candidates.some((candidate) => candidate.id === previousChoice)) {
        return previousChoice;
    }
    return candidates.length === 1 ? candidates[0].id : null;
}

/**
 * The deposit list can be partial (see MAX_CONTAINER_DEPOSITS). Database totals
 * cover every live deposit, so they replace the list-based totals when present.
 */
export function withDatabaseTotals(
    summary: ContainerSummary,
    capacityMl: number | null,
    totals: { depositCount: number; totalMl: number; hasUnknownAmounts: boolean } | null | undefined,
): ContainerSummary {
    if (!totals) return summary;
    return {
        ...summary,
        depositCount: totals.depositCount,
        totalMl: totals.totalMl,
        hasUnknownAmounts: summary.hasUnknownAmounts || totals.hasUnknownAmounts,
        fillRatio: capacityMl ? totals.totalMl / capacityMl : null,
    };
}
