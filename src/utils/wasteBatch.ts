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

export const WASTE_RULE_VERSION = '2.3.0';
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
]);

const NON_HALOGENATED_SOLVENT_CAS = new Set([
    '67-64-1', // acetone
    '64-17-5', // ethanol
    '67-56-1', // methanol
    '75-05-8', // acetonitrile
    '108-88-3', // toluene
    '110-54-3', // hexane
    '60-29-7', // diethyl ether
    '109-99-9', // tetrahydrofuran
    '141-78-6', // ethyl acetate
]);

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
const FLUORIDE_COMPOUND_CAS = new Set([
    '7681-49-4', // sodium fluoride
    '7789-23-3', // potassium fluoride
    '12125-01-8', // ammonium fluoride
    '1341-49-7', // ammonium bifluoride
    '7789-24-4', // lithium fluoride
    '7789-75-5', // calcium fluoride
    '7783-40-6', // magnesium fluoride
    '7784-18-1', // aluminium fluoride
    '1333-83-1', // sodium bifluoride
    '7789-29-9', // potassium bifluoride
]);
const FLUORIDE_COMPOUND_FORMULAS = new Set([
    'NAF', 'KF', 'NH4F', 'NH4HF2', 'LIF', 'CAF2', 'MGF2', 'ALF3',
    'NAHF2', 'KHF2', 'CSF', 'RBF', 'BAF2', 'ZNF2',
]);

const normalizedFormula = (formula: string | undefined): string =>
    (formula ?? '')
        .replace(/\s+/g, '')
        .replace(/\((?:aq|s|l|g)\)$/i, '')
        .toUpperCase();

const getReferencePh = (analysis: AnalysisResult): number | undefined =>
    analysis.chemical.properties?.referencePh ?? analysis.chemical.properties?.ph;

const hasAcidRoutingIdentity = (analysis: AnalysisResult): boolean => {
    const { name, casNumber, molecularFormula } = analysis.chemical;
    return analysis.category === 'ACID' ||
        ACID_IDENTITY_CAS.has(casNumber?.trim() ?? '') ||
        ACID_IDENTITY_FORMULAS.has(normalizedFormula(molecularFormula)) ||
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

const getLegalWastePhClass = (batch: WasteBatchDraft): WasteLegalPhClass => {
    if (batch.matrix !== 'aqueous' || !hasValidMeasuredBatchPh(batch)) return 'unknown';
    const measuredBatchPh = getMeasuredBatchPh(batch)!;
    if (measuredBatchPh <= 2) return 'waste_acid';
    if (measuredBatchPh >= 12.5) return 'waste_alkali';
    return 'none';
};

const isHydrofluoricAcid = (analysis: AnalysisResult): boolean => {
    const { name, casNumber, molecularFormula } = analysis.chemical;
    return casNumber?.trim() === HYDROFLUORIC_ACID_CAS ||
        normalizedFormula(molecularFormula) === 'HF' ||
        /\b(?:hydrofluoric\s+acid|hydrogen\s+fluoride|fluorhydric\s+acid)\b|불산|불화\s*수소|플루오린화\s*수소/i.test(name);
};

const isFluorideCompound = (analysis: AnalysisResult): boolean => {
    const { name, casNumber, molecularFormula } = analysis.chemical;
    return FLUORIDE_COMPOUND_CAS.has(casNumber?.trim() ?? '') ||
        FLUORIDE_COMPOUND_FORMULAS.has(normalizedFormula(molecularFormula)) ||
        /\b(?:bi)?fluoride\b|\bhydrogen\s+difluoride\b|불화물|불화암모늄|불화나트륨|불화칼륨/i.test(name);
};

/** Infer a batch matrix only from evidence that is strong enough to show as editable. */
export function inferWasteMatrixFromComponent(component: WasteComponent): WasteMatrix | null {
    const capacity = component.inventorySnapshot?.nominalCapacity?.trim() ?? '';
    const hasMassCapacity = /(?:^|\s|\d)(?:kg|mg|g)\s*$/i.test(capacity);
    const hasVolumeCapacity = /(?:mL|µL|uL|L)\s*$/i.test(capacity);
    const cas = component.chemical.casNumber?.trim();
    const formula = component.chemical.molecularFormula?.replace(/\s+/g, '').toUpperCase();
    const name = component.chemical.name?.trim();

    if (hasMassCapacity || component.category === 'SOLID_WASTE') return 'solid_slurry';
    if (formula === 'H2O' || /^(?:water|distilled water|deionized water|물|증류수|탈이온수)$/i.test(name)) {
        return 'aqueous';
    }
    if (cas && HALOGENATED_SOLVENT_CAS.has(cas)) return 'organic_halogenated';
    if (cas && NON_HALOGENATED_SOLVENT_CAS.has(cas)) return 'organic_non_halogenated';
    if (hasVolumeCapacity && component.category === 'ORGANIC_HALOGEN') return 'organic_halogenated';
    if (hasVolumeCapacity && component.category === 'ORGANIC_NON_HALOGEN') return 'organic_non_halogenated';
    return null;
}

/**
 * Re-evaluate an automatic matrix from all strong component evidence. A trace
 * of a halogenated organic solvent keeps the organic stream halogenated, while
 * conflicting physical dimensions are returned as unresolved for the user to
 * confirm instead of preserving a stale automatic default.
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

    const hasAqueous = inferred.has('aqueous');
    const hasHalogenated = inferred.has('organic_halogenated');
    const hasNonHalogenated = inferred.has('organic_non_halogenated');

    if (hasAqueous && (hasHalogenated || hasNonHalogenated)) {
        return 'mixed_biphasic';
    }
    if (hasHalogenated && hasNonHalogenated) {
        return 'organic_halogenated';
    }

    return null;
}

const HAZARD_CODES: Record<Exclude<
    WasteHazardFlag,
    | 'CYANIDE'
    | 'SULFIDE'
    | 'HEAVY_METAL'
    | 'HYDROFLUORIC_ACID'
    | 'FLUORIDE'
    | 'REACTIVE'
    | 'UNKNOWN_COMPONENT'
>, readonly string[]> = {
    FLAMMABLE: ['H220', 'H221', 'H222', 'H223', 'H224', 'H225', 'H226', 'H227', 'H228'],
    OXIDIZER: ['H270', 'H271', 'H272'],
    EXPLOSIVE: ['H200', 'H201', 'H202', 'H203', 'H204', 'H205'],
    SELF_REACTIVE: ['H240', 'H241', 'H242'],
    WATER_REACTIVE: ['H260', 'H261'],
    PYROPHORIC: ['H250'],
    CORROSIVE: ['H290', 'H314'],
    ACUTE_TOXIC: ['H300', 'H301', 'H310', 'H311', 'H330', 'H331'],
    CMR: ['H340', 'H341', 'H350', 'H351', 'H360', 'H361', 'H362'],
    ENVIRONMENTAL_HAZARD: ['H400', 'H410', 'H411', 'H412', 'H413'],
};

const generateId = (): string => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    return `waste-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const extractHCodes = (analysis: AnalysisResult): Set<string> => {
    const statements = analysis.chemical.ghs?.hazardStatements ?? [];
    return new Set(statements.flatMap((statement) =>
        statement.toUpperCase().match(/H\d{3}/g) ?? []
    ));
};

const hasAnyCode = (codes: Set<string>, expected: readonly string[]): boolean =>
    expected.some((code) => codes.has(code));

const isCyanide = (analysis: AnalysisResult): boolean => {
    if (analysis.category === 'CYANIDE') return true;
    const identity = `${analysis.chemical.name} ${analysis.chemical.molecularFormula}`;
    return /\bcyanide\b|\bcyanid\b|\bNaCN\b|\bKCN\b|\bHCN\b|시안화|시안|청산/i.test(identity);
};

const isSulfide = (analysis: AnalysisResult): boolean => {
    const identity = `${analysis.chemical.name} ${analysis.chemical.molecularFormula}`;
    return /\bsulfide\b|\bsulphide\b|\bNa2S\b|\bK2S\b|\bH2S\b|황화/i.test(identity);
};

/** Derive stable V2 hazard flags without relying on the GHS signal word alone. */
export function deriveWasteHazardFlags(analysis: AnalysisResult): WasteHazardFlag[] {
    const hCodes = extractHCodes(analysis);
    const flags = new Set<WasteHazardFlag>();

    for (const [flag, codes] of Object.entries(HAZARD_CODES) as Array<[
        keyof typeof HAZARD_CODES,
        readonly string[],
    ]>) {
        if (hasAnyCode(hCodes, codes)) flags.add(flag);
    }

    if (isCyanide(analysis)) flags.add('CYANIDE');
    if (isSulfide(analysis)) flags.add('SULFIDE');
    if (isHydrofluoricAcid(analysis)) flags.add('HYDROFLUORIC_ACID');
    else if (isFluorideCompound(analysis)) flags.add('FLUORIDE');
    if (analysis.category === 'HEAVY_METAL') flags.add('HEAVY_METAL');
    if (analysis.category === 'REACTIVE') flags.add('REACTIVE');
    if (analysis.category === 'SPECIAL_HAZARD') flags.add('REACTIVE');
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
    return {
        ...analysis,
        cartLineId: overrides.cartLineId ?? generateId(),
        sourceType: overrides.sourceType ?? 'search',
        sourceRef: overrides.sourceRef,
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
        ghsDataStatus: overrides.ghsDataStatus ??
            (analysis.chemical.ghs ? 'verified' : 'lookup_failed'),
        hazardDataConfirmedByUser: overrides.hazardDataConfirmedByUser,
        capturedAt: overrides.capturedAt ?? now,
        hazardFlags: overrides.hazardFlags ?? deriveWasteHazardFlags(analysis),
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

export function getAllowedAmountUnits(matrix: WasteMatrix): readonly AmountUnit[] {
    if (matrix === 'solid_slurry') return ['mg', 'g'];
    if (matrix === 'unknown') return [];
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
): WasteRoutingSelection => {
    if (batch.incidentContext === 'broken' || batch.incidentContext === 'leak') {
        return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'special_rule' };
    }
    if (hazards.has('HYDROFLUORIC_ACID') || hazards.has('FLUORIDE')) {
        return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'special_rule' };
    }
    const categories = new Set(batch.components.map((component) => component.category));

    if (categories.has('SPECIAL_HAZARD')) {
        return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'special_rule' };
    }
    if (categories.has('REACTIVE') || hazards.has('REACTIVE') ||
        hazards.has('OXIDIZER') || hazards.has('EXPLOSIVE') ||
        hazards.has('SELF_REACTIVE') || hazards.has('PYROPHORIC')) {
        return { streamCode: 'REACTIVE_OXIDIZER', routingBasis: 'special_rule' };
    }
    if (hazards.has('CYANIDE') || hazards.has('SULFIDE') || categories.has('CYANIDE')) {
        return { streamCode: 'CYANIDE_SULFIDE', routingBasis: 'special_rule' };
    }
    if (hazards.has('HEAVY_METAL') || categories.has('HEAVY_METAL')) {
        return { streamCode: 'HEAVY_METAL', routingBasis: 'special_rule' };
    }
    if (hasAcidMixingRole && hasAlkaliMixingRole && batch.matrix !== 'aqueous') {
        return {
            streamCode: 'SPECIAL_REVIEW',
            routingBasis: batch.mixingState === 'already_mixed' && batch.matrix !== 'unknown'
                ? 'special_rule'
                : 'unresolved',
        };
    }
    if (batch.matrix === 'organic_halogenated' || categories.has('ORGANIC_HALOGEN')) {
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
            if (batch.mixingState !== 'already_mixed' || !hasValidMeasuredBatchPh(batch)) {
                return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'unresolved' };
            }
            const measuredBatchPh = getMeasuredBatchPh(batch)!;
            if (measuredBatchPh <= 2) {
                return { streamCode: 'ACID_AQUEOUS', routingBasis: 'measured_batch_ph' };
            }
            if (measuredBatchPh >= 12.5) {
                return { streamCode: 'ALKALI_AQUEOUS', routingBasis: 'measured_batch_ph' };
            }
            return { streamCode: 'AQUEOUS_OTHER', routingBasis: 'measured_batch_ph' };
        }
        if (hasAcidIdentity) {
            return { streamCode: 'ACID_AQUEOUS', routingBasis: 'identity' };
        }
        if (hasAlkaliIdentity) {
            return { streamCode: 'ALKALI_AQUEOUS', routingBasis: 'identity' };
        }
        return { streamCode: 'AQUEOUS_OTHER', routingBasis: 'matrix' };
    }

    if (batch.matrix === 'mixed_biphasic') {
        if (categories.has('ORGANIC_NON_HALOGEN')) {
            return { streamCode: 'ORGANIC_NON_HALOGENATED', routingBasis: 'matrix' };
        }
        return { streamCode: 'SPECIAL_REVIEW', routingBasis: 'unresolved' };
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

    if (hasAcidAlkaliPair) {
        if (batch.mixingState === 'separate') {
            pushReason(blockingReasons, {
                code: 'acid_alkali_separate',
                messageKey: 'waste_block_acid_alkali_separate',
                ruleId: 'acid_base',
            });
        } else if (batch.mixingState !== 'already_mixed') {
            pushMissing(missingFields, 'mixing_state');
        } else if (batch.matrix === 'aqueous' && !hasValidMeasuredBatchPh(batch)) {
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
    if (batch.matrix === 'unknown') pushMissing(missingFields, 'matrix');
    if (!validateWasteAmount(batch.totalAmount, batch.matrix).valid) {
        pushMissing(missingFields, 'total_amount');
    }
    if (batch.components.some(({ identityConfidence }) => identityConfidence !== 'verified')) {
        pushMissing(missingFields, 'identity');
    }
    if (batch.components.some(({ category, ghsDataStatus, hazardDataConfirmedByUser }) => (
        category === 'UNKNOWN' ||
        (ghsDataStatus !== 'verified' && !hazardDataConfirmedByUser)
    ))) {
        pushMissing(missingFields, 'hazard_data');
    }
    if (batch.components.some((component) => {
        if (component.sourceType !== 'inventory' || !component.inventoryId) return false;
        const available = component.inventorySnapshot?.quantity ?? 1;
        const selected = component.inventoryDisposalQuantity;
        return !Number.isInteger(selected) || selected === undefined || selected < 1 || selected > available;
    })) {
        pushMissing(missingFields, 'inventory_quantity');
    }

    const categories = new Set(batch.components.map(({ category }) => category));
    if (batch.additionalComponentsStatus === 'present' || (
        batch.matrix === 'mixed_biphasic' &&
        !categories.has('ORGANIC_HALOGEN') &&
        !categories.has('ORGANIC_NON_HALOGEN') &&
        batch.additionalComponentsStatus !== 'none'
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
