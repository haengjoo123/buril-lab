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
 * 4. Assess Neutralization Safety
 * Returns TRUE if allowed, FALSE if prohibited
 */
export const assessNeutralization = (chemical: Chemical): boolean => {
    const props = chemical.physicalProperties || {};
    const ghs = chemical.ghs || { hazardStatements: [], signal: '' };
    const stability = (props.stability || '').toLowerCase();

    // 4.1 Section 10 Hazards (Reactivity)
    const hazardStatements = ghs.hazardStatements.map(s => s.toLowerCase());

    // Debug Log
    console.log(`[Neutralization Debug] ${chemical.name}`, {
        stability,
        hazardStatements,
        flashPoint: props.flashPoint,
        boilingPoint: props.boilingPoint
    });

    // Keywords for prohibition
    // Removed 'violent reaction' because standard amine descriptions mention "may cause violent reaction" (referring to heat).
    // We rely on "Dilute & Neutralize" instructions to handle heat.
    // Removed 'peroxide' because it catches "Incompatible with peroxides" (common for amines), which is irrelevant for Acid Neutralization.
    const dangerKeywords = [
        'unstable', 'explosive', 'spontaneous', 'shock sensitive'
    ];

    const foundKeyword = dangerKeywords.find(k => stability.includes(k));
    if (foundKeyword) {
        console.warn(`[Neutralization] Prohibited due to keyword: "${foundKeyword}"`);
        return false;
    }

    // 4.2 Exothermic / Flash Point Risks
    // Prompt says "Judged as High Heat Risk", but NOT "Prohibited" immediately.
    // Prohibition comes from 4.1 or 4.3 (2+ matches).
    // So we treat FP < 23 as a risk that necessitates "Controlled conditions", which fits Case 1.

    // if (props.flashPoint !== undefined && props.flashPoint < 23) return false;

    // BP < 70C -> Risk of boiling over -> PROHIBITED
    if (props.boilingPoint !== undefined && props.boilingPoint < 70) {
        console.warn(`[Neutralization] Prohibited due to Low Boiling Point: ${props.boilingPoint}°C`);
        return false;
    }

    // 4.3 GHS / Handling Signals
    // Count risk factors
    let riskCount = 0;

    // Section 7/5/11 heuristics mapped to GHS codes/keywords
    // "May intensify fire" -> H270, H271, H272
    if (hazardStatements.some(h => h.includes('intensify fire') || h.includes('oxidiz'))) riskCount++;

    // "Corrosive / Severe burns" -> H314
    if (hazardStatements.some(h => h.includes('severe skin burns') || h.includes('corrosive'))) {
        // Corrosivity itself isn't a ban (Acids/Alkalis are corrosive), but implies care.
        // The prompt says "Section 11: Corrosive, Severe burns" counts as a risk factor for MIXTURE safety?
        // Actually typical acids/alkalis have this.
        // Let's assume this applies to the ORGANIC component specifically having these strict attributes unrelated to pH?
        // If the ORGANIC part is corrosive, it might mean reactive.
        if (chemical.properties?.isOrganic) riskCount++;
    }

    // "Avoid uncontrolled reactions" -> usually implied by Self-reactive codes
    if (hazardStatements.some(h => h.includes('self-reactive') || h.includes('heating may cause'))) riskCount++;

    if (riskCount >= 2) {
        console.warn(`[Neutralization] ${chemical.name} Prohibited. RiskCount: ${riskCount}`);
        return false;
    }

    return true;
};

/**
 * 5. Main Decision Logic for Alkali + Organic Mixture
 */
export const determineDisposal = (cart: Chemical[]): DisposalResult => {
    // const alkali = cart.filter(c => c.properties?.ph !== undefined && c.properties.ph >= 8);
    // Unused for now as we just check organic properties

    const organics = cart.filter(c => c.properties?.isOrganic);

    // 1. Solubility Check
    // If ANY organic is insoluble, the phase is mixed/insoluble -> Case 3
    const isAllSoluble = organics.every(c => assessSolubility(c) === 'SOLUBLE');
    const solubilityStatus = isAllSoluble ? 'SOLUBLE' : 'INSOLUBLE';

    // 2. Neutralization Check
    // If ANY organic is unsafe to neutralize -> Prohibited
    const isAllNeutralizable = organics.every(c => assessNeutralization(c));
    const neutralizationStatus = isAllNeutralizable ? 'ALLOWED' : 'PROHIBITED';

    let disposalMethod = '';

    // Case Logic
    if (solubilityStatus === 'SOLUBLE') {
        if (neutralizationStatus === 'ALLOWED') {
            // Case 1
            disposalMethod = 'disposal_method_case1'; // "Dilute & Neutralize (pH 6-8) -> Aqueous Disposal"
        } else {
            // Case 2
            disposalMethod = 'disposal_method_case2'; // "Neutralization Prohibited -> Reactive Organic Waste"
        }
    } else {
        // Case 3 (Insoluble) - Neutralization irrelevant (don't mix phases)
        disposalMethod = 'disposal_method_case3'; // "Neutralization Prohibited -> Mixed Organic Waste (Seal & Label)"
    }

    // Override Neutralization Status if Insoluble (Case 3) because it's effectively prohibited
    // regardless of chemical safety.
    const finalNeutralizationStatus = solubilityStatus === 'INSOLUBLE' ? 'PROHIBITED' : neutralizationStatus;

    return {
        solubilityStatus,
        neutralizationStatus: finalNeutralizationStatus,
        disposalMethod
    };
};
