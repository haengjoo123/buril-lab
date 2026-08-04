import type { Chemical } from '../types';

export interface DisposalResult {
    solubilityStatus: 'SOLUBLE' | 'INSOLUBLE';
    neutralizationStatus: 'ALLOWED' | 'PROHIBITED';
    disposalMethod: string;
    warning?: string;
}

/**
 * 3. Evaluate Solubility (Organic Phase)
 * Priority: Explicit Solubility > Chemical Family > Log Kow
 */
export const assessSolubility = (chemical: Chemical): 'SOLUBLE' | 'INSOLUBLE' => {
    const props = chemical.physicalProperties || {};

    // 3.1 Explicit Data
    if (props.solubility) {
        const s = props.solubility.toLowerCase();
        if (s.includes('miscible') || s.includes('soluble')) {
            if (s.includes('insoluble') || s.includes('practically insoluble')) return 'INSOLUBLE';
            if (s.includes('slightly soluble')) return 'INSOLUBLE'; // Conservative
            return 'SOLUBLE';
        }
        if (s.includes('insoluble')) return 'INSOLUBLE';
    }

    // 3.2.1 Chemical Family Check (Heuristic based on name)
    const name = chemical.name.toUpperCase();
    if (name.includes('BENZENE') || name.includes('TOLUENE') || name.includes('HEXANE') || name.includes('ETHER') || name.includes('CHLORO')) {
        return 'INSOLUBLE';
    }
    if (name.includes('OL') || name.includes('AMINE') || name.includes('KETONE') || name.includes('ACETONE')) {
        return 'SOLUBLE';
    }

    // 3.2.2 Log Kow
    if (props.logKow !== undefined) {
        if (props.logKow < 1) return 'SOLUBLE';
        if (props.logKow >= 3) return 'INSOLUBLE';
        // Between 1 and 3? Conservative -> Insoluble
        return 'INSOLUBLE';
    }

    // Default conservative
    return 'INSOLUBLE';
};

/**
 * @deprecated The app never authorizes ad-hoc neutralization. The V2 workflow
 * records an already-mixed batch and requires a directly measured final pH.
 */
export const assessNeutralization = (chemical: Chemical): boolean => {
    void chemical;
    return false;
};

/**
 * 5. Main Decision Logic for Alkali + Organic Mixture
 */
export const determineDisposal = (cart: Chemical[]): DisposalResult => {
    const organics = cart.filter(c => c.properties?.isOrganic);

    // 1. Solubility Check
    // If ANY organic is insoluble, the phase is mixed/insoluble -> Case 3
    const isAllSoluble = organics.every(c => assessSolubility(c) === 'SOLUBLE');
    const solubilityStatus = isAllSoluble ? 'SOLUBLE' : 'INSOLUBLE';

    // This legacy path must never authorize intentional neutralization.
    const neutralizationStatus = 'PROHIBITED' as const;

    let disposalMethod = '';

    // Case Logic
    if (solubilityStatus === 'SOLUBLE') {
        disposalMethod = 'disposal_method_case2';
    } else {
        // Case 3 (Insoluble) - Neutralization irrelevant (don't mix phases)
        disposalMethod = 'disposal_method_case3'; // "Neutralization Prohibited -> Mixed Organic Waste (Seal & Label)"
    }

    return {
        solubilityStatus,
        neutralizationStatus,
        disposalMethod
    };
};
