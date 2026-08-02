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
    WasteMatrix,
    WasteMissingField,
    WasteStreamCode,
} from '../types';
import { checkCompatibility } from './compatibilityChecker';
import { isValidCasNumber } from './casNumber';

export const WASTE_RULE_VERSION = '2.0.0';
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
    'CYANIDE' | 'SULFIDE' | 'HEAVY_METAL' | 'REACTIVE' | 'UNKNOWN_COMPONENT'
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

const selectStream = (
    batch: WasteBatchDraft,
    hazards: Set<WasteHazardFlag>,
): WasteStreamCode => {
    if (batch.incidentContext === 'broken' || batch.incidentContext === 'leak') {
        return 'SPECIAL_REVIEW';
    }
    const categories = new Set(batch.components.map((component) => component.category));

    if (categories.has('SPECIAL_HAZARD')) return 'SPECIAL_REVIEW';
    if (categories.has('REACTIVE') || hazards.has('REACTIVE') ||
        hazards.has('OXIDIZER') || hazards.has('EXPLOSIVE') ||
        hazards.has('SELF_REACTIVE') || hazards.has('PYROPHORIC')) {
        return 'REACTIVE_OXIDIZER';
    }
    if (hazards.has('CYANIDE') || hazards.has('SULFIDE') || categories.has('CYANIDE')) {
        return 'CYANIDE_SULFIDE';
    }
    if (hazards.has('HEAVY_METAL') || categories.has('HEAVY_METAL')) return 'HEAVY_METAL';
    if (batch.matrix === 'organic_halogenated' || categories.has('ORGANIC_HALOGEN')) {
        return 'ORGANIC_HALOGENATED';
    }
    if (batch.matrix === 'organic_non_halogenated') return 'ORGANIC_NON_HALOGENATED';
    if (batch.matrix === 'solid_slurry') return 'SOLID_CONTAMINATED';

    if (batch.matrix === 'aqueous') {
        const hasAcid = categories.has('ACID');
        const hasAlkali = categories.has('ALKALI');

        if (hasAcid && hasAlkali && batch.measuredPhStatus === 'measured' &&
            batch.measuredPh !== undefined) {
            if (batch.measuredPh < 7) return 'ACID_AQUEOUS';
            if (batch.measuredPh > 7) return 'ALKALI_AQUEOUS';
            return 'AQUEOUS_OTHER';
        }
        if (hasAcid) return 'ACID_AQUEOUS';
        if (hasAlkali) return 'ALKALI_AQUEOUS';
        return 'AQUEOUS_OTHER';
    }

    if (batch.matrix === 'mixed_biphasic') {
        if (categories.has('ORGANIC_NON_HALOGEN')) return 'ORGANIC_NON_HALOGENATED';
        return 'SPECIAL_REVIEW';
    }

    return 'SPECIAL_REVIEW';
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
    if (batch.matrix === 'aqueous' && categories.has('ACID') && categories.has('ALKALI') &&
        batch.measuredPhStatus !== 'measured') {
        pushMissing(missingFields, 'measured_ph');
    }
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

    return {
        decisionStatus,
        streamCode: selectStream(batch, hazards),
        hazardFlags: [...hazards],
        allowedActions: decisionStatus === 'blocked'
            ? ['isolated', 'handover']
            : decisionStatus === 'ready'
                ? ['container_deposit']
                : [],
        blockingReasons,
        missingFields,
        policyVersion: options.policyVersion ?? DEFAULT_WASTE_POLICY_VERSION,
        ruleVersion: options.ruleVersion ?? WASTE_RULE_VERSION,
    };
}
