import type {
    AmountUnit,
    AnalysisResult,
    CartItem,
    WasteAmount,
    WasteBatchDraft,
    WasteComponent,
    WasteDecision,
    WasteDecisionReason,
    WasteHazardFlag,
    WasteLegalPhClass,
    WasteMatrix,
    WasteMissingField,
    WasteRoutingBasis,
    WasteStreamCode,
} from '../types';
import { checkCompatibility } from './compatibilityChecker';
import { isValidCasNumber } from './casNumber';
import {
    detectChemicalHazards,
    extractHCodes,
    isCorrosiveAcidByNameAndHCodes,
    parseFormula,
} from './chemicalAnalyzer';

export const WASTE_RULE_VERSION = '2.6.0';
export const DEFAULT_WASTE_POLICY_VERSION = 'KR-2026.3';

export interface NormalizedWasteAmount {
    normalizedValue: number;
    normalizedUnit: 'mL' | 'mg';
}

export type WasteAmountValidationError =
    | 'amount_required'
    | 'amount_must_be_positive'
    | 'amount_unit_mismatch'
    | 'unknown_amount_conflict'
    | 'normalized_amount_mismatch';

export type WasteAmountValidationResult =
    | { valid: true }
    | { valid: false; error: WasteAmountValidationError };

export interface CreateWasteBatchOptions {
    id?: string;
    scopeKey?: string;
    userId?: string;
    labId?: string;
    now?: string;
}

export interface AnalyzeWasteBatchOptions {
    policyVersion?: string;
    ruleVersion?: string;
    /** Server-authorized, high-confidence pH prediction for this exact batch. */
    approvedPredictedBatchPh?: number;
    policy?: {
        streamAvailable: boolean;
        allowedHazardFlags?: WasteHazardFlag[];
        blockedHazardFlags?: WasteHazardFlag[];
    };
}

const HALOGENATED_SOLVENT_CAS = new Set([
    '75-09-2', // dichloromethane
    '67-66-3', // chloroform
    '56-23-5', // carbon tetrachloride
    '79-01-6', // trichloroethylene
    '127-18-4', // tetrachloroethylene
    '107-06-2', // 1,2-dichloroethane
    '108-90-7', // chlorobenzene
]);

const NON_HALOGENATED_SOLVENT_CAS = new Set([
    '67-68-5', // dimethyl sulfoxide
    '67-64-1', // acetone
    '64-17-5', // ethanol
    '67-56-1', // methanol
    '75-05-8', // acetonitrile
    '108-88-3', // toluene
    '110-54-3', // hexane
    '142-82-5', // heptane
    '1330-20-7', // xylene
    '71-43-2', // benzene
    '60-29-7', // diethyl ether
    '109-99-9', // tetrahydrofuran
    '68-12-2', // dimethylformamide
    '67-63-0', // isopropanol
    '141-78-6', // ethyl acetate
]);

type OrganicSolventMatrix = Extract<
    WasteMatrix,
    'organic_halogenated' | 'organic_non_halogenated'
>;

/**
 * A disposal category describes the solute's chemistry, not the presence of an
 * organic solvent phase. Only an exact solvent allowlist match or an explicitly
 * verified solution context is strong enough evidence for biphasic routing.
 */
const getOrganicSolventMatrixEvidence = (
    component: WasteComponent,
): OrganicSolventMatrix | null => {
    if (component.identityConfidence !== 'verified') return null;

    const chemicalCas = component.chemical.casNumber?.trim() ?? '';
    const context = component.solutionContext;
    const solventCas = context?.solventCasNumber?.trim() ?? '';
    const hasVerifiedContext = context?.isSolventVerified === true
        && context.physicalForm === 'organic_solvent';
    const hasHalogenatedEvidence = HALOGENATED_SOLVENT_CAS.has(chemicalCas) || (
        hasVerifiedContext
        && context.solventClass === 'organic_halogen'
        && HALOGENATED_SOLVENT_CAS.has(solventCas)
    );
    const hasNonHalogenatedEvidence = NON_HALOGENATED_SOLVENT_CAS.has(chemicalCas) || (
        hasVerifiedContext
        && context.solventClass === 'organic_non_halogen'
        && NON_HALOGENATED_SOLVENT_CAS.has(solventCas)
    );

    // Any verified halogenated carrier wins over non-halogenated evidence. A
    // solute identity must never downgrade a halogenated solvent phase.
    if (hasHalogenatedEvidence) {
        return 'organic_halogenated';
    }
    if (hasNonHalogenatedEvidence) {
        return 'organic_non_halogenated';
    }
    return null;
};

const getOrganicSolventMatrixEvidenceSet = (
    components: readonly WasteComponent[],
): Set<OrganicSolventMatrix> => new Set(
    components
        .map(getOrganicSolventMatrixEvidence)
        .filter((matrix): matrix is OrganicSolventMatrix => matrix !== null),
);

const HYDROFLUORIC_ACID_CAS = '7664-39-3';
const ACID_IDENTITY_CAS = new Set([
    '7647-01-0', // hydrochloric acid
    '7664-93-9', // sulfuric acid
    '7697-37-2', // nitric acid
    '7664-38-2', // phosphoric acid
    '7601-90-3', // perchloric acid
    '64-19-7', // acetic acid
    '64-18-6', // formic acid
    HYDROFLUORIC_ACID_CAS,
]);
const ALKALI_IDENTITY_CAS = new Set([
    '1310-73-2', // sodium hydroxide
    '1310-58-3', // potassium hydroxide
    '1310-65-2', // lithium hydroxide
    '1305-62-0', // calcium hydroxide
    '1336-21-6', // ammonium hydroxide solution
    '7664-41-7', // ammonia
]);
const ACID_IDENTITY_FORMULAS = new Set([
    'HCL', 'HBR', 'HI', 'HF', 'H2SO4', 'HNO3', 'H3PO4', 'HCLO4', 'CH3COOH', 'HCOOH',
]);
const ALKALI_IDENTITY_FORMULAS = new Set([
    'NAOH', 'KOH', 'LIOH', 'CA(OH)2', 'BA(OH)2', 'NH3', 'NH4OH',
]);
const ROUTING_SALT_CATIONS = new Set([
    'Li', 'Na', 'K', 'Rb', 'Cs', 'Mg', 'Ca', 'Sr', 'Ba', 'Al', 'Fe', 'Ga',
    'In', 'Tl', 'Zr', 'Hf', 'La', 'Ce', 'Y', 'Sc', 'Ag', 'Cd', 'Pb', 'Hg',
    'Cr', 'As', 'Ni', 'Cu', 'Zn', 'Be', 'Co', 'Mn', 'Sn', 'Sb', 'Mo', 'V',
]);
const normalizedFormula = (formula: string | undefined): string =>
    (formula ?? '')
        .replace(/\s+/g, '')
        .replace(/\((?:aq|s|l|g)\)$/i, '')
        .toUpperCase();

const isLikelyMetalSaltFormula = (formula: string | undefined): boolean => {
    try {
        const elements = parseFormula(formula ?? '');
        return [...ROUTING_SALT_CATIONS].some((element) => Boolean(elements[element]));
    } catch {
        return false;
    }
};

const hasOrganicHalogenContent = (component: WasteComponent): boolean => {
    if (component.category === 'ORGANIC_HALOGEN') return true;
    try {
        const elements = parseFormula(component.chemical.molecularFormula ?? '');
        return Boolean(elements.C && (elements.F || elements.Cl || elements.Br || elements.I));
    } catch {
        // External and migrated formula strings are not routing authority. A
        // malformed value must remain unresolved instead of crashing analysis.
        return false;
    }
};

const getReferencePh = (analysis: AnalysisResult): number | undefined =>
    analysis.chemical.properties?.referencePh ?? analysis.chemical.properties?.ph;

const hasAcidRoutingIdentity = (analysis: AnalysisResult): boolean => {
    const { name, casNumber, molecularFormula } = analysis.chemical;
    const isExplicitAcid = analysis.category === 'ACID' ||
        ACID_IDENTITY_CAS.has(casNumber?.trim() ?? '') ||
        ACID_IDENTITY_FORMULAS.has(normalizedFormula(molecularFormula)) ||
        isCorrosiveAcidByNameAndHCodes(
            name,
            extractHCodes(analysis.chemical.ghs?.hazardStatements),
        );
    // Names such as "sulfuric acid, cesium salt" are supplier aliases for a
    // salt, not free-acid evidence. Keep an explicit acid category/formula or
    // corrosivity proof authoritative, then reject the alias-only route.
    if (isExplicitAcid) return true;
    if (isLikelyMetalSaltFormula(molecularFormula)) return false;
    return analysis.category === 'ACID' ||
        ACID_IDENTITY_CAS.has(casNumber?.trim() ?? '') ||
        ACID_IDENTITY_FORMULAS.has(normalizedFormula(molecularFormula)) ||
        isCorrosiveAcidByNameAndHCodes(
            name,
            extractHCodes(analysis.chemical.ghs?.hazardStatements),
        ) ||
        /\b(?:hydrochloric|sulfuric|sulphuric|nitric|phosphoric|perchloric|hydrofluoric|acetic|formic)\s+acid\b|염산|황산|질산|인산|과염소산|불산|아세트산|개미산/i.test(name);
};

const hasAlkaliRoutingIdentity = (analysis: AnalysisResult): boolean => {
    const { name, casNumber, molecularFormula } = analysis.chemical;
    return analysis.category === 'ALKALI' ||
        ALKALI_IDENTITY_CAS.has(casNumber?.trim() ?? '') ||
        ALKALI_IDENTITY_FORMULAS.has(normalizedFormula(molecularFormula)) ||
        /\b(?:sodium|potassium|lithium|calcium|barium|ammonium)\s+hydroxide\b|\bammonia\b|수산화\s*(?:나트륨|칼륨|리튬|칼슘|바륨|암모늄)|암모니아/i.test(name);
};

const hasAcidMixingRole = (analysis: AnalysisResult): boolean => {
    const referencePh = getReferencePh(analysis);
    return hasAcidRoutingIdentity(analysis) || referencePh !== undefined && referencePh < 4;
};

const hasAlkaliMixingRole = (analysis: AnalysisResult): boolean => {
    const referencePh = getReferencePh(analysis);
    return hasAlkaliRoutingIdentity(analysis) || referencePh !== undefined && referencePh > 10;
};

export const getWasteAcidBasePresence = (
    components: readonly AnalysisResult[],
): { hasAcid: boolean; hasAlkali: boolean } => ({
    hasAcid: components.some(hasAcidMixingRole),
    hasAlkali: components.some(hasAlkaliMixingRole),
});

export const getMeasuredBatchPh = (batch: WasteBatchDraft): number | undefined =>
    batch.measuredBatchPh ?? batch.measuredPh;

const hasValidMeasuredBatchPh = (batch: WasteBatchDraft): boolean => {
    const measuredBatchPh = getMeasuredBatchPh(batch);
    return batch.measuredPhStatus === 'measured' &&
        measuredBatchPh !== undefined &&
        Number.isFinite(measuredBatchPh) &&
        measuredBatchPh >= 0 &&
        measuredBatchPh <= 14;
};

const hasApprovedPredictedBatchPh = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value) && value > 2.2 && value < 12.3;

const getLegalWastePhClass = (batch: WasteBatchDraft): WasteLegalPhClass => {
    if (batch.matrix !== 'aqueous' || !hasValidMeasuredBatchPh(batch)) return 'unknown';
    const measuredBatchPh = getMeasuredBatchPh(batch)!;
    if (measuredBatchPh <= 2) return 'waste_acid';
    if (measuredBatchPh >= 12.5) return 'waste_alkali';
    return 'none';
};

/** Infer a batch matrix only from evidence that is strong enough to show as editable. */
export function inferWasteMatrixFromComponent(component: WasteComponent): WasteMatrix | null {
    const capacity = component.inventorySnapshot?.nominalCapacity?.trim() ?? '';
    const hasMassCapacity = /(?:^|\s|\d)(?:kg|mg|g)\s*$/i.test(capacity);
    const formula = component.chemical.molecularFormula?.replace(/\s+/g, '').toUpperCase();
    const name = component.chemical.name?.trim();

    if (hasMassCapacity || component.category === 'SOLID_WASTE') return 'solid_slurry';
    if (formula === 'H2O' || /^(?:water|distilled water|deionized water|물|증류수|탈이온수)$/i.test(name)) {
        return 'aqueous';
    }
    return getOrganicSolventMatrixEvidence(component);
}

/**
 * Re-evaluate an automatic matrix from all strong component evidence. Organic
 * solvent evidence determines the liquid stream even when water is also
 * present; a trace of a halogenated organic solvent keeps that stream
 * halogenated. Conflicting physical dimensions remain unresolved for the user.
 */
export function inferWasteMatrixFromComponents(
    components: WasteComponent[],
): WasteMatrix | null {
    const inferred = new Set(
        components
            .map(inferWasteMatrixFromComponent)
            .filter((matrix): matrix is WasteMatrix => matrix !== null),
    );

    if (inferred.size === 0) return null;
    if (inferred.size === 1) return [...inferred][0];

    if (inferred.has('solid_slurry')) return null;

    const hasHalogenated = inferred.has('organic_halogenated');
    const hasNonHalogenated = inferred.has('organic_non_halogenated');

    if (hasHalogenated) return 'organic_halogenated';
    if (hasNonHalogenated) return 'organic_non_halogenated';
    if (inferred.has('aqueous')) return 'aqueous';

    return null;
}

const generateId = (): string => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    return `waste-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Derive V2 flags from lossless evidence, recomputing legacy results from their chemical data. */
export function deriveWasteHazardFlags(analysis: AnalysisResult): WasteHazardFlag[] {
    const profile = analysis.hazardProfile ?? detectChemicalHazards(analysis.chemical);
    const flags = new Set<WasteHazardFlag>(profile.flags);

    // UNKNOWN_COMPONENT is a data-quality sentinel, not a chemical hazard. It
    // remains category-backed only for compatibility with legacy records.
    if (analysis.category === 'UNKNOWN') flags.add('UNKNOWN_COMPONENT');

    return [...flags];
}

type ComponentOverrides = Partial<
    Omit<WasteComponent, keyof AnalysisResult | 'hazardFlags'>
> & { hazardFlags?: WasteHazardFlag[] };

/** Convert the existing analyzer result into a V2 batch component. */
export function createWasteComponentFromAnalysis(
    analysis: AnalysisResult,
    overrides: ComponentOverrides = {},
): WasteComponent {
    const now = new Date().toISOString();
    const legacyItem = analysis as Partial<CartItem>;
    const automaticHazardFlags = overrides.automaticHazardFlags ?? deriveWasteHazardFlags(analysis);
    const manualHazardFlags = overrides.manualHazardFlags ?? [];
    const hazardLookupStatus = analysis.chemical.hazardLookup?.status;
    const ghsDataStatus = hazardLookupStatus === 'classified' || hazardLookupStatus === 'not_classified'
        ? 'verified'
        : hazardLookupStatus === 'transient_error'
            ? 'not_checked'
            : hazardLookupStatus === 'source_absent' || hazardLookupStatus === 'identity_ambiguous'
                ? 'lookup_failed'
                : analysis.chemical.ghs ? 'verified' : 'lookup_failed';
    return {
        ...analysis,
        cartLineId: overrides.cartLineId ?? generateId(),
        sourceType: overrides.sourceType ?? 'search',
        sourceRef: overrides.sourceRef,
        sourceSearchEventId: overrides.sourceSearchEventId,
        inventoryId: overrides.inventoryId,
        cabinetId: overrides.cabinetId,
        identityConfidence: overrides.identityConfidence ?? (
            analysis.category === 'UNKNOWN' ||
            analysis.isAiEstimated ||
            !isValidCasNumber(analysis.chemical.casNumber)
                ? 'review_required'
                : 'verified'
        ),
        identityConfirmedByUser: overrides.identityConfirmedByUser,
        ghsDataStatus: overrides.ghsDataStatus ?? ghsDataStatus,
        hazardDataConfirmedByUser: overrides.hazardDataConfirmedByUser,
        capturedAt: overrides.capturedAt ?? now,
        hazardFlags: overrides.hazardFlags ?? [...new Set([...automaticHazardFlags, ...manualHazardFlags])],
        automaticHazardFlags,
        manualHazardFlags,
        enrichmentVersion: analysis.chemical.hazardLookup?.algorithmVersion ?? 0,
        phCatalogId: overrides.phCatalogId,
        phCatalogMatch: overrides.phCatalogMatch,
        scanSnapshot: overrides.scanSnapshot,
        concentration: overrides.concentration,
        inventorySnapshot: overrides.inventorySnapshot,
        volume: overrides.volume ?? legacyItem.volume,
        molarity: overrides.molarity ?? legacyItem.molarity,
        solutionContext: overrides.solutionContext ?? legacyItem.solutionContext,
    };
}

export function createEmptyWasteBatch(
    options: CreateWasteBatchOptions = {},
): WasteBatchDraft {
    const now = options.now ?? new Date().toISOString();
    const scopeKey = options.scopeKey ?? (options.labId
        ? `${options.userId ?? 'anonymous'}:${options.labId}`
        : `${options.userId ?? 'anonymous'}:personal`);

    return {
        id: options.id ?? generateId(),
        scopeKey,
        userId: options.userId,
        labId: options.labId,
        components: [],
        matrix: 'unknown',
        matrixSource: 'unresolved',
        totalAmount: {
            value: null,
            unit: null,
            normalizedValue: null,
            normalizedUnit: null,
            isApproximate: false,
            isUnknown: false,
        },
        measuredPhStatus: 'not_required',
        mixingState: 'unknown',
        incidentContext: 'none',
        createdAt: now,
        updatedAt: now,
    };
}

/** Normalize within the same physical dimension only. */
export function normalizeWasteAmount(
    value: number,
    unit: AmountUnit,
): NormalizedWasteAmount | null {
    if (!Number.isFinite(value) || value <= 0) return null;

    switch (unit) {
        case 'mL':
            return { normalizedValue: value, normalizedUnit: 'mL' };
        case 'L':
            return { normalizedValue: value * 1_000, normalizedUnit: 'mL' };
        case 'mg':
            return { normalizedValue: value, normalizedUnit: 'mg' };
        case 'g':
            return { normalizedValue: value * 1_000, normalizedUnit: 'mg' };
        default:
            return null;
    }
}

const roundDerivedAmount = (value: number): number => Number(value.toPrecision(12));

/**
 * Derive a liquid batch amount only when every component has a valid solution
 * volume. The arithmetic sum is always approximate as a physical final volume
 * because mixing can be non-additive.
 */
export function deriveWasteAmountFromComponentVolumes(
    components: readonly WasteComponent[],
): WasteAmount | null {
    if (components.length === 0) return null;

    let totalMl = 0;
    for (const component of components) {
        const volume = component.solutionVolume;
        if (!volume || !Number.isFinite(volume.value) || volume.value <= 0) return null;
        const expectedMl = volume.unit === 'L'
            ? volume.value * 1_000
            : volume.unit === 'uL' ? volume.value / 1_000 : volume.value;
        if (!Number.isFinite(expectedMl) || expectedMl <= 0 ||
            !Number.isFinite(volume.normalizedMl) || volume.normalizedMl <= 0) return null;
        const tolerance = Math.max(1e-9, expectedMl * 1e-9);
        if (Math.abs(volume.normalizedMl - expectedMl) > tolerance) return null;
        totalMl += expectedMl;
    }

    if (!Number.isFinite(totalMl) || totalMl <= 0) return null;
    const normalizedValue = roundDerivedAmount(totalMl);
    const useLiters = normalizedValue >= 1_000;
    return {
        value: useLiters ? roundDerivedAmount(normalizedValue / 1_000) : normalizedValue,
        unit: useLiters ? 'L' : 'mL',
        normalizedValue,
        normalizedUnit: 'mL',
        isApproximate: true,
        isUnknown: false,
        source: 'component_sum',
    };
}

export function getAllowedAmountUnits(matrix: WasteMatrix): readonly AmountUnit[] {
    if (matrix === 'solid_slurry') return ['mg', 'g'];
    if (matrix === 'unknown') return ['mL', 'L', 'mg', 'g'];
    return ['mL', 'L'];
}

export function validateWasteAmount(
    amount: WasteAmount,
    matrix: WasteMatrix,
): WasteAmountValidationResult {
    if (amount.isUnknown) {
        const hasConflictingValue = amount.value !== null || amount.unit !== null ||
            amount.normalizedValue !== null || amount.normalizedUnit !== null;
        return hasConflictingValue
            ? { valid: false, error: 'unknown_amount_conflict' }
            : { valid: true };
    }

    if (amount.value === null || amount.unit === null) {
        return { valid: false, error: 'amount_required' };
    }

    const normalized = normalizeWasteAmount(amount.value, amount.unit);
    if (!normalized) return { valid: false, error: 'amount_must_be_positive' };

    if (!getAllowedAmountUnits(matrix).includes(amount.unit)) {
        return { valid: false, error: 'amount_unit_mismatch' };
    }

    if (amount.normalizedValue !== normalized.normalizedValue ||
        amount.normalizedUnit !== normalized.normalizedUnit) {
        return { valid: false, error: 'normalized_amount_mismatch' };
    }

    return { valid: true };
}

interface WasteRoutingSelection {
    streamCode: WasteStreamCode;
    routingBasis: WasteRoutingBasis;
}

const selectRouting = (
    batch: WasteBatchDraft,
    hazards: Set<WasteHazardFlag>,
    hasAcidMixingRole: boolean,
    hasAlkaliMixingRole: boolean,
    hasAcidIdentity: boolean,
    hasAlkaliIdentity: boolean,
    approvedPredictedBatchPh: number | undefined,
): WasteRoutingSelection => {
    if (batch.incidentContext === 'broken' || batch.incidentContext === 'leak') {
        return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'special_rule' };
    }
    if (hazards.has('HYDROFLUORIC_ACID') || hazards.has('FLUORIDE')) {
        return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'special_rule' };
    }
    const categories = new Set(batch.components.map((component) => component.category));
    const organicSolventEvidence = getOrganicSolventMatrixEvidenceSet(batch.components);
    const containsOrganicHalogen = batch.components.some(hasOrganicHalogenContent);

    if (categories.has('SPECIAL_HAZARD')) {
        return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'special_rule' };
    }
    if (categories.has('REACTIVE') || hazards.has('REACTIVE') ||
        hazards.has('OXIDIZER') || hazards.has('EXPLOSIVE') ||
        hazards.has('SELF_REACTIVE') || hazards.has('PYROPHORIC')) {
        return { streamCode: 'REACTIVE_OXIDIZER', routingBasis: 'special_rule' };
    }
    // Cyanide remains the most restrictive dedicated stream.  A metal
    // sulfide, however, must not lose its heavy-metal route just because its
    // formula also contains sulfur; the separate flags retain both facts for
    // compatibility checks and institutional policy.
    if (hazards.has('CYANIDE') || (categories.has('CYANIDE') && !hazards.has('SULFIDE'))) {
        return { streamCode: 'CYANIDE_SULFIDE', routingBasis: 'special_rule' };
    }
    if (hazards.has('HEAVY_METAL') || categories.has('HEAVY_METAL')) {
        return { streamCode: 'HEAVY_METAL', routingBasis: 'special_rule' };
    }
    if (hazards.has('SULFIDE') || categories.has('CYANIDE')) {
        return { streamCode: 'CYANIDE_SULFIDE', routingBasis: 'special_rule' };
    }
    if (hasAcidMixingRole && hasAlkaliMixingRole && batch.matrix !== 'aqueous') {
        return {
            streamCode: 'SPECIAL_REVIEW',
            routingBasis: batch.mixingState === 'already_mixed' && batch.matrix !== 'unknown'
                ? 'special_rule'
                : 'unresolved',
        };
    }
    if (batch.matrix === 'mixed_biphasic') {
        const hasVerifiedOrganicPhase = organicSolventEvidence.size > 0;
        if (!hasVerifiedOrganicPhase) {
            return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'unresolved' };
        }
        if (organicSolventEvidence.has('organic_halogenated') || containsOrganicHalogen) {
            return { streamCode: 'ORGANIC_HALOGENATED', routingBasis: 'matrix' };
        }
        if (organicSolventEvidence.has('organic_non_halogenated')) {
            return { streamCode: 'ORGANIC_NON_HALOGENATED', routingBasis: 'matrix' };
        }
        return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'unresolved' };
    }
    // A known halogenated component keeps the conservative halogen stream,
    // except for a confirmed aqueous acid/alkali batch. In that case the
    // measured final-batch pH is the legal routing authority.
    if (batch.matrix === 'organic_halogenated' || (
        categories.has('ORGANIC_HALOGEN') && !(
            batch.matrix === 'aqueous' && hasAcidMixingRole && hasAlkaliMixingRole
        )
    )) {
        return { streamCode: 'ORGANIC_HALOGENATED', routingBasis: 'matrix' };
    }
    if (batch.matrix === 'organic_non_halogenated') {
        return { streamCode: 'ORGANIC_NON_HALOGENATED', routingBasis: 'matrix' };
    }
    if (batch.matrix === 'solid_slurry') {
        return { streamCode: 'SOLID_CONTAMINATED', routingBasis: 'matrix' };
    }

    if (batch.matrix === 'aqueous') {
        if (hasAcidMixingRole && hasAlkaliMixingRole) {
            if (batch.mixingState !== 'already_mixed') {
                return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'unresolved' };
            }
            if (hasValidMeasuredBatchPh(batch)) {
                const measuredBatchPh = getMeasuredBatchPh(batch)!;
                if (measuredBatchPh <= 2) {
                    return { streamCode: 'ACID_AQUEOUS', routingBasis: 'measured_batch_ph' };
                }
                if (measuredBatchPh >= 12.5) {
                    return { streamCode: 'ALKALI_AQUEOUS', routingBasis: 'measured_batch_ph' };
                }
                return { streamCode: 'AQUEOUS_OTHER', routingBasis: 'measured_batch_ph' };
            }
            if (hasApprovedPredictedBatchPh(approvedPredictedBatchPh)) {
                return { streamCode: 'AQUEOUS_OTHER', routingBasis: 'predicted_batch_ph' };
            }
            return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'unresolved' };
        }
        if (hasAcidIdentity) {
            return { streamCode: 'ACID_AQUEOUS', routingBasis: 'identity' };
        }
        if (hasAlkaliIdentity) {
            return { streamCode: 'ALKALI_AQUEOUS', routingBasis: 'identity' };
        }
        return { streamCode: 'AQUEOUS_OTHER', routingBasis: 'matrix' };
    }

    return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'unresolved' };
};

const pushReason = (
    target: WasteDecisionReason[],
    reason: WasteDecisionReason,
): void => {
    const key = `${reason.code}:${reason.ruleId ?? ''}`;
    if (!target.some((item) => `${item.code}:${item.ruleId ?? ''}` === key)) {
        target.push(reason);
    }
};

const pushMissing = (
    target: WasteMissingField[],
    field: WasteMissingField,
): void => {
    if (!target.includes(field)) target.push(field);
};

/**
 * A verified solid matrix is enough to use the common contaminated-solid
 * stream only after all hazardous precedence rules have run. This intentionally
 * applies to UNKNOWN components only: a known cyanide, metal, fluoride,
 * reactive, or special hazard retains its more specific route or hold.
 */
const isSafeVerifiedSolidFallback = (component: WasteComponent): boolean => (
    component.category === 'UNKNOWN' &&
    component.identityConfidence === 'verified' &&
    (component.ghsDataStatus === 'verified' || component.hazardDataConfirmedByUser === true) &&
    !component.hazardFlags.some((flag) => (
        flag === 'REACTIVE' ||
        flag === 'OXIDIZER' ||
        flag === 'EXPLOSIVE' ||
        flag === 'SELF_REACTIVE' ||
        flag === 'PYROPHORIC' ||
        flag === 'WATER_REACTIVE' ||
        flag === 'HYDROFLUORIC_ACID' ||
        flag === 'FLUORIDE'
    ))
);

/**
 * Deterministic V2 decision engine. Compatibility DANGER rules always win,
 * while a GHS "Danger" signal word by itself never blocks a batch.
 */
export function analyzeWasteBatch(
    batch: WasteBatchDraft,
    options: AnalyzeWasteBatchOptions = {},
): WasteDecision {
    const hazards = new Set<WasteHazardFlag>();
    for (const component of batch.components) {
        for (const flag of [...component.hazardFlags, ...deriveWasteHazardFlags(component)]) {
            hazards.add(flag);
        }
    }

    const blockingReasons: WasteDecisionReason[] = [];
    const missingFields: WasteMissingField[] = [];
    const compatibilityWarnings = checkCompatibility(batch.components as CartItem[], { matrix: batch.matrix });
    const { hasAcid, hasAlkali } = getWasteAcidBasePresence(batch.components);
    const hasAcidIdentity = batch.components.some(hasAcidRoutingIdentity);
    const hasAlkaliIdentity = batch.components.some(hasAlkaliRoutingIdentity);
    const hasAcidAlkaliPair = hasAcid && hasAlkali;

    if (batch.incidentContext === 'broken' || batch.incidentContext === 'leak') {
        pushReason(blockingReasons, {
            code: 'incident_response',
            messageKey: batch.incidentContext === 'broken'
                ? 'waste_block_broken_container'
                : 'waste_block_leak',
        });
    }

    for (const compatibility of compatibilityWarnings.filter(({ severity }) => severity === 'DANGER')) {
        pushReason(blockingReasons, {
            code: 'dangerous_compatibility',
            messageKey: compatibility.messageKey,
            ruleId: compatibility.ruleId,
            chemicals: [compatibility.chemicalA, compatibility.chemicalB],
        });
    }

    // Keep this batch-level guard in addition to the pairwise compatibility
    // checker. An organic but corrosive acid can carry an acid identity in its
    // CAS/formula or GHS evidence without the legacy single-value category
    // being ACID; it must still never be combined with cyanide or sulfide.
    if (hasAcid && hazards.has('CYANIDE')) {
        pushReason(blockingReasons, {
            code: 'dangerous_compatibility',
            messageKey: 'compat_acid_cyanide',
            ruleId: 'acid_cyanide',
        });
    }
    if (hasAcid && hazards.has('SULFIDE')) {
        pushReason(blockingReasons, {
            code: 'dangerous_compatibility',
            messageKey: 'compat_acid_sulfide',
            ruleId: 'acid_sulfide',
        });
    }

    const approvedPredictedBatchPh = hasApprovedPredictedBatchPh(options.approvedPredictedBatchPh)
        ? options.approvedPredictedBatchPh
        : undefined;

    if (hasAcidAlkaliPair) {
        if (batch.mixingState === 'separate') {
            pushReason(blockingReasons, {
                code: 'acid_alkali_separate',
                messageKey: 'waste_block_acid_alkali_separate',
                ruleId: 'acid_base',
            });
        } else if (batch.mixingState !== 'already_mixed') {
            pushMissing(missingFields, 'mixing_state');
        } else if (batch.matrix === 'aqueous' && !hasValidMeasuredBatchPh(batch) && !approvedPredictedBatchPh) {
            pushMissing(missingFields, 'measured_ph');
        } else if (batch.matrix !== 'aqueous' && batch.matrix !== 'unknown') {
            pushReason(blockingReasons, {
                code: 'acid_alkali_non_aqueous_mixed',
                messageKey: 'waste_block_acid_alkali_non_aqueous_mixed',
                ruleId: 'acid_base',
            });
        }
    }

    if (batch.components.some(({ category }) => category === 'SPECIAL_HAZARD')) {
        pushReason(blockingReasons, {
            code: 'special_hazard',
            messageKey: 'waste_block_special_hazard',
        });
    }
    if (batch.components.some(({ category }) => category === 'REACTIVE')) {
        pushReason(blockingReasons, {
            code: 'reactive_waste',
            messageKey: 'waste_block_reactive',
        });
    }
    if (hazards.has('EXPLOSIVE') || hazards.has('SELF_REACTIVE')) {
        pushReason(blockingReasons, {
            code: 'explosive_or_self_reactive',
            messageKey: 'waste_block_explosive_self_reactive',
        });
    }
    if (hazards.has('PYROPHORIC')) {
        pushReason(blockingReasons, {
            code: 'pyrophoric',
            messageKey: 'waste_block_pyrophoric',
        });
    }
    if (hazards.has('WATER_REACTIVE') &&
        (batch.matrix === 'aqueous' || batch.matrix === 'mixed_biphasic')) {
        pushReason(blockingReasons, {
            code: 'water_reactive_aqueous',
            messageKey: 'waste_block_water_reactive_aqueous',
        });
    }

    const requiresFluorideCompatibleContainer =
        hazards.has('HYDROFLUORIC_ACID') || hazards.has('FLUORIDE');
    if (requiresFluorideCompatibleContainer) {
        if (batch.fluorideContainerStatus === 'incompatible') {
            pushReason(blockingReasons, {
                code: 'hf_fluoride_incompatible_container',
                messageKey: 'waste_block_hf_fluoride_container',
            });
        } else if (batch.fluorideContainerStatus !== 'compatible') {
            pushMissing(missingFields, 'fluoride_container');
        }
    }

    const policyBlockedHazards = options.policy?.blockedHazardFlags?.filter((flag) => hazards.has(flag)) ?? [];
    if (policyBlockedHazards.length > 0) {
        pushReason(blockingReasons, {
            code: 'policy_blocked_hazard',
            messageKey: 'waste_block_policy_hazard',
            chemicals: policyBlockedHazards,
        });
    }

    const allowedHazards = options.policy?.allowedHazardFlags ?? [];
    const disallowedHazards = allowedHazards.length > 0
        ? [...hazards].filter((flag) => !allowedHazards.includes(flag))
        : [];
    if (disallowedHazards.length > 0) {
        pushReason(blockingReasons, {
            code: 'policy_disallowed_hazard',
            messageKey: 'waste_block_policy_not_allowed',
            chemicals: disallowedHazards,
        });
    }

    if (batch.components.length === 0) pushMissing(missingFields, 'components');
    if (batch.matrix === 'unknown') {
        if (batch.matrixSource === 'user') {
            pushReason(blockingReasons, {
                code: 'unknown_matrix_review',
                messageKey: 'waste_block_unknown_matrix_review',
            });
        } else {
            pushMissing(missingFields, 'matrix');
        }
    }
    if (!validateWasteAmount(batch.totalAmount, batch.matrix).valid) {
        pushMissing(missingFields, 'total_amount');
    }
    if (batch.components.some(({ identityConfidence }) => identityConfidence !== 'verified')) {
        pushMissing(missingFields, 'identity');
    }
    if (batch.components.some(({ ghsDataStatus, hazardDataConfirmedByUser }) => (
        ghsDataStatus !== 'verified' && !hazardDataConfirmedByUser
    ))) {
        pushMissing(missingFields, 'hazard_data');
    }
    const unknownCategoryComponents = batch.components.filter(({ category }) => category === 'UNKNOWN');
    const canUseSolidFallback = batch.matrix === 'solid_slurry' &&
        unknownCategoryComponents.length > 0 &&
        unknownCategoryComponents.every(isSafeVerifiedSolidFallback);
    if (unknownCategoryComponents.length > 0 && !canUseSolidFallback) {
        pushMissing(missingFields, 'classification');
    }
    if (batch.components.some((component) => {
        if (component.sourceType !== 'inventory' || !component.inventoryId) return false;
        const available = component.inventorySnapshot?.quantity ?? 1;
        const selected = component.inventoryDisposalQuantity;
        return !Number.isInteger(selected) || selected === undefined || selected < 1 || selected > available;
    })) {
        pushMissing(missingFields, 'inventory_quantity');
    }

    const hasOrganicSolventEvidence = getOrganicSolventMatrixEvidenceSet(batch.components).size > 0;
    if (batch.additionalComponentsStatus === 'present' || (
        batch.matrix === 'mixed_biphasic' &&
        !hasOrganicSolventEvidence
    )) {
        pushMissing(missingFields, 'additional_components');
    }
    if (options.policy && !options.policy.streamAvailable) {
        pushMissing(missingFields, 'policy_stream');
    }

    const decisionStatus = blockingReasons.length > 0
        ? 'blocked'
        : missingFields.length > 0
            ? 'needs_input'
            : 'ready';
    const routing = selectRouting(
        batch,
        hazards,
        hasAcid,
        hasAlkali,
        hasAcidIdentity,
        hasAlkaliIdentity,
        approvedPredictedBatchPh,
    );
    const measuredBatchPh = getMeasuredBatchPh(batch);
    const corrosivityPhScreen = batch.matrix !== 'aqueous' || !hasValidMeasuredBatchPh(batch)
        ? 'unknown' as const
        : measuredBatchPh! <= 2 || measuredBatchPh! >= 11.5
            ? 'review_required' as const
            : 'not_indicated' as const;

    return {
        decisionStatus,
        streamCode: routing.streamCode,
        hazardFlags: [...hazards],
        allowedActions: decisionStatus === 'blocked'
            ? ['isolated', 'handover']
            : decisionStatus === 'ready'
                ? ['container_deposit']
                : [],
        blockingReasons,
        missingFields,
        legalWastePhClass: getLegalWastePhClass(batch),
        corrosivityPhScreen,
        routingBasis: routing.routingBasis,
        policyVersion: options.policyVersion ?? DEFAULT_WASTE_POLICY_VERSION,
        ruleVersion: options.ruleVersion ?? WASTE_RULE_VERSION,
    };
}
