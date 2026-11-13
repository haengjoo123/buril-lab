import type { WasteBatchDraft, WasteHazardFlag } from '../../types';
import { deriveWasteHazardFlags, getWasteAcidBasePresence } from '../../utils/wasteBatch';
import type { ContainerComponentSummary } from './containerSummary';

/**
 * Cross-checks the waste about to be poured against what a container's
 * deposit records already hold.
 *
 * The batch analyzer only sees the components of one deposit. Two deposits
 * that are each fine alone can still be a dangerous pair inside the same
 * container, so this compares across that boundary.
 *
 * Container records keep only names and coarse hazard flags (no H-codes, pH or
 * formula), so the rules are deliberately few and never state that a pour is
 * safe: an empty result means "no known conflict in the records", nothing more.
 */
export type ContainerContentSeverity = 'DANGER' | 'WARNING';

export type ContainerContentRuleId =
    | 'pyrophoric'
    | 'self_reactive'
    | 'explosive'
    | 'oxidizer_flammable'
    | 'oxidizer_reactive'
    | 'water_reactive_aqueous'
    | 'water_reactive_unknown_matrix'
    | 'acid_cyanide'
    | 'acid_sulfide'
    | 'corrosive_cyanide_sulfide';

export interface IncomingWasteComponent {
    name: string;
    hazardFlags: readonly WasteHazardFlag[];
    /** The analyzer identified this component as an acid (from CAS, formula, GHS or pH evidence). */
    isAcid: boolean;
}

export interface IncomingWaste {
    components: IncomingWasteComponent[];
    /** The batch being poured contains water. */
    isAqueous: boolean;
}

export interface ContainerContentWarning {
    severity: ContainerContentSeverity;
    ruleId: ContainerContentRuleId;
    /** Component of the waste being poured. */
    incoming: string;
    /** Component already recorded in the container. */
    inContainer: string;
}

type RecordedComponent = Pick<ContainerComponentSummary, 'chemicalName' | 'hazardFlags'>;

const ALWAYS_DANGEROUS: ReadonlyArray<[WasteHazardFlag, ContainerContentRuleId]> = [
    ['PYROPHORIC', 'pyrophoric'],
    ['SELF_REACTIVE', 'self_reactive'],
    ['EXPLOSIVE', 'explosive'],
];

const sameSubstance = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function toIncomingWaste(batch: Pick<WasteBatchDraft, 'components' | 'matrix'>): IncomingWaste {
    return {
        components: batch.components
            .map((component) => ({
                name: component.chemical.name?.trim() ?? '',
                hazardFlags: [...new Set([...component.hazardFlags, ...deriveWasteHazardFlags(component)])],
                isAcid: getWasteAcidBasePresence([component]).hasAcid,
            }))
            .filter((component) => component.name),
        isAqueous: batch.matrix === 'aqueous' || batch.matrix === 'mixed_biphasic',
    };
}

export function checkContainerContents(
    incoming: IncomingWaste,
    recorded: readonly RecordedComponent[],
): ContainerContentWarning[] {
    const warnings: ContainerContentWarning[] = [];
    const seen = new Set<string>();
    const push = (
        severity: ContainerContentSeverity,
        ruleId: ContainerContentRuleId,
        a: IncomingWasteComponent,
        b: RecordedComponent,
    ) => {
        const key = `${ruleId}|${a.name.trim().toLowerCase()}|${b.chemicalName.trim().toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        warnings.push({ severity, ruleId, incoming: a.name, inContainer: b.chemicalName });
    };

    for (const a of incoming.components) {
        for (const b of recorded) {
            // More of a substance the container already holds is not a new pairing.
            if (sameSubstance(a.name, b.chemicalName)) continue;
            const inA = (flag: WasteHazardFlag) => a.hazardFlags.includes(flag);
            const inB = (flag: WasteHazardFlag) => b.hazardFlags.includes(flag);
            const across = (x: WasteHazardFlag, y: WasteHazardFlag) => (inA(x) && inB(y)) || (inA(y) && inB(x));

            for (const [flag, ruleId] of ALWAYS_DANGEROUS) {
                if (inA(flag) || inB(flag)) push('DANGER', ruleId, a, b);
            }
            if (across('OXIDIZER', 'FLAMMABLE')) push('DANGER', 'oxidizer_flammable', a, b);
            if (across('OXIDIZER', 'REACTIVE') || across('OXIDIZER', 'WATER_REACTIVE')) {
                push('WARNING', 'oxidizer_reactive', a, b);
            }
            if (inB('WATER_REACTIVE') && incoming.isAqueous) push('DANGER', 'water_reactive_aqueous', a, b);
            // Records do not say whether the container holds water, so this stays a prompt to check.
            if (inA('WATER_REACTIVE')) push('WARNING', 'water_reactive_unknown_matrix', a, b);
            if (a.isAcid && inB('CYANIDE')) push('DANGER', 'acid_cyanide', a, b);
            if (a.isAcid && inB('SULFIDE')) push('DANGER', 'acid_sulfide', a, b);
            // A recorded corrosive may be an acid or a base; the records cannot tell which.
            if ((inA('CYANIDE') || inA('SULFIDE')) && inB('CORROSIVE')) {
                push('WARNING', 'corrosive_cyanide_sulfide', a, b);
            }
        }
    }

    return warnings.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'DANGER' ? -1 : 1));
}
