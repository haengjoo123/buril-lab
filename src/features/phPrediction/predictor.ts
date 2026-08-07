import type {
    PhPredictionResult,
    WasteBatchDraft,
    WasteComponent,
    WasteConcentration,
    WasteSolutionVolume,
} from '../../types';
import { DEFAULT_PH_CATALOG, findPhCatalogRecordByCas } from './catalog';
import type { PhAcidBaseFamily, PhCatalog, PhCatalogRecord } from './catalogTypes';
import { checkCompatibility } from '../../utils/compatibilityChecker';
import { validatePhCatalog } from './catalogValidation';
import { PH_PREDICTION_MODEL_VERSION } from './modelMetadata';
import { DEFAULT_PH_CATALOG_APPROVAL, evaluatePhCatalogApproval } from './catalogApproval';
import { formulaCompositionKey } from '../../utils/chemicalFormula';

export const PH_PREDICTION_ISSUES = Object.freeze({
    MIXING_NOT_COMPLETE: 'mixing_not_complete',
    MIXING_STATE_UNKNOWN: 'mixing_state_unknown',
    ACTIVE_INCIDENT: 'active_incident',
    MATRIX_NOT_AQUEOUS: 'matrix_not_aqueous',
    COMPONENT_SOLVENT_NOT_AQUEOUS: 'component_solvent_not_aqueous',
    COMPONENT_SOLVENT_ASSUMED_AQUEOUS: 'component_solvent_assumed_aqueous',
    ADDITIONAL_COMPONENTS_UNCONFIRMED: 'additional_components_unconfirmed',
    DANGEROUS_HAZARD: 'dangerous_hazard',
    DANGEROUS_COMPATIBILITY: 'dangerous_compatibility',
    HAZARD_DATA_REQUIRED: 'hazard_data_required',
    REACTIVE_CATALOG_ENTRY: 'reactive_catalog_entry',
    IDENTITY_CONFIRMATION_REQUIRED: 'identity_confirmation_required',
    CATALOG_MATCH_REQUIRED: 'catalog_match_required',
    CATALOG_INVALID: 'catalog_invalid',
    CATALOG_VALIDATION_REQUIRED: 'catalog_validation_required',
    VOLUME_REQUIRED: 'component_volume_required',
    CONCENTRATION_REQUIRED: 'component_concentration_required',
    INVALID_INPUT: 'invalid_numeric_input',
    PERCENT_BASIS_REQUIRED: 'percent_basis_required',
    DENSITY_REQUIRED: 'density_required',
    DENSITY_KIND_MISMATCH: 'density_kind_mismatch',
    FINAL_VOLUME_INVALID: 'final_volume_invalid',
    FINAL_VOLUME_ESTIMATED: 'final_volume_estimated',
    VOLUME_ADDITIVITY_ASSUMED: 'volume_additivity_assumed',
    COMPONENT_VOLUME_ESTIMATED: 'component_volume_estimated',
    USER_DENSITY_ASSUMED: 'user_density_assumed',
    DENSITY_TEMPERATURE_ASSUMED: 'density_temperature_assumed',
    CONDITIONAL_PKA_DATA: 'conditional_pka_data',
    GAS_SENSITIVE_CLOSED_SYSTEM: 'gas_sensitive_closed_system',
    ANALYTICAL_CONCENTRATION_OUT_OF_RANGE: 'analytical_concentration_out_of_range',
    IONIC_STRENGTH_APPROXIMATE: 'ionic_strength_approximate',
    PH_EDGE_APPROXIMATE: 'ph_edge_approximate',
    IONIC_STRENGTH_OUT_OF_RANGE: 'ionic_strength_out_of_range',
    PH_OUT_OF_RANGE: 'ph_out_of_range',
    SOLVER_DID_NOT_CONVERGE: 'solver_did_not_converge',
    SOLVER_MASS_BALANCE_FAILED: 'solver_mass_balance_failed',
} as const);

const DANGEROUS_HAZARDS = new Set([
    'CYANIDE',
    'SULFIDE',
    'OXIDIZER',
    'EXPLOSIVE',
    'SELF_REACTIVE',
    'WATER_REACTIVE',
    'PYROPHORIC',
    'REACTIVE',
    'HEAVY_METAL',
]);

const UNSUPPORTED_CATEGORIES = new Set([
    'HEAVY_METAL',
    'CYANIDE',
    'REACTIVE',
    'SPECIAL_HAZARD',
]);

interface AnalyticalFamily {
    family: PhAcidBaseFamily;
    totalMolar: number;
}

interface FixedIon {
    charge: number;
    molar: number;
}

interface PreparedMixture {
    families: AnalyticalFamily[];
    fixedIons: FixedIon[];
    totalAnalyticalMolar: number;
    approximateIssues: string[];
    assumptions: string[];
}

type ConversionResult =
    | { ok: true; molar: number; approximateIssues: string[] }
    | { ok: false; issue: string };

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const makeResult = (
    batch: WasteBatchDraft,
    catalog: PhCatalog,
    status: PhPredictionResult['status'],
    confidence: PhPredictionResult['confidence'],
    issueCodes: readonly string[],
    assumptions: readonly string[],
    values?: Pick<PhPredictionResult, 'value' | 'displayValue' | 'ionicStrength'>,
): PhPredictionResult => ({
    status,
    confidence,
    issueCodes: unique(issueCodes),
    assumptions: unique(assumptions),
    modelVersion: PH_PREDICTION_MODEL_VERSION,
    catalogVersion: catalog.version,
    inputHash: hashPredictionInput(batch),
    ...values,
});

const stableStringify = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
};

const fnv1a32 = (value: string, seed: number): string => {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

/** Stable, non-cryptographic fingerprint used only for stale-result/audit detection. */
export const hashPredictionInput = (batch: WasteBatchDraft): string => {
    const components = batch.components.map((component) => ({
        cartLineId: component.cartLineId,
        phCatalogId: component.phCatalogId,
        category: component.category,
        casNumber: component.chemical.casNumber,
        chemicalName: component.chemical.name,
        molecularFormula: component.chemical.molecularFormula,
        identityConfidence: component.identityConfidence,
        identityConfirmedByUser: component.identityConfirmedByUser,
        ghsDataStatus: component.ghsDataStatus,
        hazardDataConfirmedByUser: component.hazardDataConfirmedByUser,
        ghsHazardStatements: [...(component.chemical.ghs?.hazardStatements ?? [])].sort(),
        compatibilityProperties: {
            isOrganic: component.chemical.properties?.isOrganic,
            referencePh: component.chemical.properties?.referencePh,
            ph: component.chemical.properties?.ph,
        },
        hazardFlags: [...component.hazardFlags].sort(),
        solutionContext: component.solutionContext,
        solutionVolume: component.solutionVolume,
        concentration: component.concentration,
    })).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
    const serialized = stableStringify({
        matrix: batch.matrix,
        matrixSource: batch.matrixSource,
        mixingState: batch.mixingState,
        incidentContext: batch.incidentContext,
        additionalComponentsStatus: batch.additionalComponentsStatus,
        totalAmount: batch.totalAmount,
        components,
    });
    return `fnv1a64:${fnv1a32(serialized, 0x811c9dc5)}${fnv1a32(serialized, 0x9e3779b9)}`;
};

export const normalizeSolutionVolumeMl = (volume: WasteSolutionVolume | undefined): number | undefined => {
    if (!volume || !Number.isFinite(volume.value) || volume.value <= 0) return undefined;
    const normalized = volume.unit === 'uL' ? volume.value / 1_000
        : volume.unit === 'mL' ? volume.value
            : volume.unit === 'L' ? volume.value * 1_000
                : undefined;
    if (normalized === undefined || !Number.isFinite(volume.normalizedMl) || volume.normalizedMl <= 0) return undefined;
    const tolerance = Math.max(1e-9, normalized * 1e-9);
    return Math.abs(volume.normalizedMl - normalized) <= tolerance ? normalized : undefined;
};

export const convertConcentrationToMolar = (
    concentration: WasteConcentration | undefined,
    molecularWeight: number,
): ConversionResult => {
    if (!concentration) return { ok: false, issue: PH_PREDICTION_ISSUES.CONCENTRATION_REQUIRED };
    if (!Number.isFinite(concentration.value) || concentration.value <= 0 || !Number.isFinite(molecularWeight) || molecularWeight <= 0) {
        return { ok: false, issue: PH_PREDICTION_ISSUES.INVALID_INPUT };
    }

    if (concentration.unit === 'M') return { ok: true, molar: concentration.value, approximateIssues: [] };
    if (concentration.unit === 'mM') return { ok: true, molar: concentration.value / 1_000, approximateIssues: [] };
    if (concentration.unit === 'mg/mL') {
        return { ok: true, molar: concentration.value / molecularWeight, approximateIssues: [] };
    }
    if (concentration.unit !== '%') return { ok: false, issue: PH_PREDICTION_ISSUES.INVALID_INPUT };
    if (concentration.value > 100) return { ok: false, issue: PH_PREDICTION_ISSUES.INVALID_INPUT };
    if (!concentration.basis) return { ok: false, issue: PH_PREDICTION_ISSUES.PERCENT_BASIS_REQUIRED };

    if (concentration.basis === 'w_v') {
        return { ok: true, molar: concentration.value * 10 / molecularWeight, approximateIssues: [] };
    }

    const density = concentration.density;
    if (!density || !Number.isFinite(density.value) || density.value <= 0 || density.unit !== 'g/mL') {
        return { ok: false, issue: PH_PREDICTION_ISSUES.DENSITY_REQUIRED };
    }
    const requiredKind = concentration.basis === 'w_w' ? 'solution' : 'solute';
    if (density.kind !== requiredKind) {
        return { ok: false, issue: PH_PREDICTION_ISSUES.DENSITY_KIND_MISMATCH };
    }
    return {
        ok: true,
        molar: concentration.value * 10 * density.value / molecularWeight,
        approximateIssues: [
            ...(density.source !== 'catalog' || density.isEstimate
                ? [PH_PREDICTION_ISSUES.USER_DENSITY_ASSUMED]
                : []),
            ...(density.temperatureC === 25
                ? []
                : [PH_PREDICTION_ISSUES.DENSITY_TEMPERATURE_ASSUMED]),
        ],
    };
};

const findRecord = (component: WasteComponent, catalog: PhCatalog): PhCatalogRecord | undefined => {
    if (component.phCatalogId) {
        const selected = catalog.records.find((entry) => entry.id === component.phCatalogId);
        if (!selected) return undefined;

        const componentCas = component.chemical.casNumber?.trim();
        if (componentCas && selected.casNumber?.trim() !== componentCas) return undefined;

        const componentFormula = formulaCompositionKey(component.chemical.molecularFormula);
        const selectedFormula = formulaCompositionKey(selected.formula);
        if (!componentCas && componentFormula && componentFormula !== selectedFormula) return undefined;
        return selected;
    }
    if (catalog === DEFAULT_PH_CATALOG) {
        return findPhCatalogRecordByCas(component.chemical.casNumber);
    }
    const cas = component.chemical.casNumber?.trim();
    if (cas) {
        const matches = catalog.records.filter((entry) => entry.casNumber === cas);
        if (matches.length === 1) return matches[0];
    }
    return undefined;
};

type BatchVolumeResolution =
    | { kind: 'exact'; liters: number }
    | { kind: 'absent' }
    | { kind: 'invalid' };

const resolveExactBatchVolume = (batch: WasteBatchDraft): BatchVolumeResolution => {
    const amount = batch.totalAmount;
    if (amount.isUnknown || amount.isApproximate) return { kind: 'absent' };
    const hasNoValue = amount.value === null && amount.unit === null
        && amount.normalizedValue === null && amount.normalizedUnit === null;
    if (hasNoValue) return { kind: 'absent' };
    if (amount.value === null || !Number.isFinite(amount.value) || amount.value <= 0
        || (amount.unit !== 'mL' && amount.unit !== 'L')
        || amount.normalizedUnit !== 'mL'
        || amount.normalizedValue === null || !Number.isFinite(amount.normalizedValue)
        || amount.normalizedValue <= 0) {
        return { kind: 'invalid' };
    }
    const expectedMl = amount.unit === 'L' ? amount.value * 1_000 : amount.value;
    const tolerance = Math.max(1e-9, expectedMl * 1e-9);
    if (Math.abs(amount.normalizedValue - expectedMl) > tolerance) return { kind: 'invalid' };
    return { kind: 'exact', liters: expectedMl / 1_000 };
};

const prepareMixture = (
    batch: WasteBatchDraft,
    catalog: PhCatalog,
    approvedRecordIds: ReadonlySet<string>,
): PreparedMixture | PhPredictionResult => {
    const records = new Map<string, PhCatalogRecord>();
    const componentVolumesMl = new Map<string, number>();
    const issues: string[] = [];
    const approximateIssues: string[] = [];
    const assumptions = [
        'aqueous_solution',
        'temperature_25_c',
        'closed_system',
        'water_pkw_14_at_25_c',
        'davies_activity_correction',
    ];

    const hasUnclearSolutionContext = batch.components.some((component) => component.concentration && (
        !component.solutionContext ||
        component.solutionContext.solventClass === 'mixed_or_unknown' ||
        component.solutionContext.solventClass === 'organic_unknown'
    ));
    if (hasUnclearSolutionContext && batch.matrixSource === 'user' && batch.matrix === 'aqueous') {
        approximateIssues.push(PH_PREDICTION_ISSUES.COMPONENT_SOLVENT_ASSUMED_AQUEOUS);
        assumptions.push('component_solvent_assumed_aqueous_from_batch_confirmation');
    }

    if (new Set(batch.components.map((component) => component.cartLineId)).size !== batch.components.length) {
        return makeResult(batch, catalog, 'unsupported', 'unavailable', [PH_PREDICTION_ISSUES.INVALID_INPUT], assumptions);
    }

    for (const component of batch.components) {
        const identityConfirmed = component.identityConfidence === 'verified' || component.identityConfirmedByUser === true;
        if (!identityConfirmed) issues.push(PH_PREDICTION_ISSUES.IDENTITY_CONFIRMATION_REQUIRED);
        const record = findRecord(component, catalog);
        if (!record) {
            issues.push(PH_PREDICTION_ISSUES.CATALOG_MATCH_REQUIRED);
            continue;
        }
        if (record.kind !== 'solvent'
            && component.ghsDataStatus !== 'verified'
            && component.hazardDataConfirmedByUser !== true) {
            issues.push(PH_PREDICTION_ISSUES.HAZARD_DATA_REQUIRED);
        }
        if (record.flags?.includes('unsupported_reactivity') || record.flags?.includes('precipitation_risk') || record.flags?.includes('metal_complexation')) {
            issues.push(PH_PREDICTION_ISSUES.REACTIVE_CATALOG_ENTRY);
        }
        if (record.flags?.includes('gas_sensitive')) {
            issues.push(PH_PREDICTION_ISSUES.GAS_SENSITIVE_CLOSED_SYSTEM);
        }
        if (!approvedRecordIds.has(record.id)) {
            issues.push(PH_PREDICTION_ISSUES.CATALOG_VALIDATION_REQUIRED);
            continue;
        }
        records.set(component.cartLineId, record);
        const volumeMl = normalizeSolutionVolumeMl(component.solutionVolume);
        if (volumeMl === undefined) {
            issues.push(component.solutionVolume
                ? PH_PREDICTION_ISSUES.INVALID_INPUT
                : PH_PREDICTION_ISSUES.VOLUME_REQUIRED);
        }
        else componentVolumesMl.set(component.cartLineId, volumeMl);
        if (component.solutionVolume?.isEstimate) approximateIssues.push(PH_PREDICTION_ISSUES.COMPONENT_VOLUME_ESTIMATED);
    }

    if (issues.length > 0) {
        return makeResult(batch, catalog, 'unsupported', 'unavailable', issues, assumptions);
    }

    const summedVolumeLiters = [...componentVolumesMl.values()].reduce((sum, volumeMl) => sum + volumeMl, 0) / 1_000;
    const batchVolume = resolveExactBatchVolume(batch);
    if (batchVolume.kind === 'invalid') {
        return makeResult(batch, catalog, 'unsupported', 'unavailable', [PH_PREDICTION_ISSUES.FINAL_VOLUME_INVALID], assumptions);
    }
    const exactVolumeLiters = batchVolume.kind === 'exact' ? batchVolume.liters : undefined;
    const finalVolumeLiters = exactVolumeLiters ?? summedVolumeLiters;
    if (!Number.isFinite(finalVolumeLiters) || finalVolumeLiters <= 0) {
        return makeResult(batch, catalog, 'unsupported', 'unavailable', [PH_PREDICTION_ISSUES.FINAL_VOLUME_INVALID], assumptions);
    }
    if (exactVolumeLiters === undefined) {
        approximateIssues.push(PH_PREDICTION_ISSUES.FINAL_VOLUME_ESTIMATED, PH_PREDICTION_ISSUES.VOLUME_ADDITIVITY_ASSUMED);
        assumptions.push('final_volume_is_sum_of_component_volumes');
    } else {
        const largestComponentLiters = Math.max(...componentVolumesMl.values()) / 1_000;
        if (exactVolumeLiters + 1e-12 < largestComponentLiters) {
            return makeResult(batch, catalog, 'unsupported', 'unavailable', [PH_PREDICTION_ISSUES.FINAL_VOLUME_INVALID], assumptions);
        }
        assumptions.push('user_supplied_final_batch_volume');
    }

    const familyMoles = new Map<string, number>();
    const fixedIonMoles = new Map<number, number>();
    let totalSoluteMoles = 0;
    for (const component of batch.components) {
        const record = records.get(component.cartLineId)!;
        if (record.kind === 'solvent') continue;
        const conversion = convertConcentrationToMolar(component.concentration, record.molecularWeight);
        if (!conversion.ok) {
            issues.push(conversion.issue);
            continue;
        }
        approximateIssues.push(...conversion.approximateIssues);
        const stockVolumeLiters = componentVolumesMl.get(component.cartLineId)! / 1_000;
        const moles = conversion.molar * stockVolumeLiters;
        if (!Number.isFinite(moles) || moles <= 0) {
            issues.push(PH_PREDICTION_ISSUES.INVALID_INPUT);
            continue;
        }
        totalSoluteMoles += moles;
        for (const contribution of record.contributions) {
            familyMoles.set(
                contribution.familyId,
                (familyMoles.get(contribution.familyId) ?? 0) + moles * contribution.stoichiometry,
            );
        }
        for (const fixedIon of record.fixedIons) {
            fixedIonMoles.set(
                fixedIon.charge,
                (fixedIonMoles.get(fixedIon.charge) ?? 0) + moles * fixedIon.stoichiometry,
            );
        }
    }

    if (issues.length > 0) {
        return makeResult(batch, catalog, 'unsupported', 'unavailable', issues, assumptions);
    }

    const familyById = new Map(catalog.families.map((entry) => [entry.id, entry]));
    const families: AnalyticalFamily[] = [];
    for (const [familyId, moles] of familyMoles) {
        const acidBaseFamily = familyById.get(familyId);
        if (!acidBaseFamily) {
            return makeResult(batch, catalog, 'failed', 'unavailable', [PH_PREDICTION_ISSUES.CATALOG_MATCH_REQUIRED], assumptions);
        }
        if (acidBaseFamily.pKaMetadata.some((metadata) =>
            metadata.pKaType !== 'thermodynamic' || metadata.approvalStatus !== 'approved')) {
            approximateIssues.push(PH_PREDICTION_ISSUES.CONDITIONAL_PKA_DATA);
        }
        families.push({ family: acidBaseFamily, totalMolar: moles / finalVolumeLiters });
    }
    const fixedIons = [...fixedIonMoles].map(([charge, moles]) => ({ charge, molar: moles / finalVolumeLiters }));
    return {
        families,
        fixedIons,
        totalAnalyticalMolar: totalSoluteMoles / finalVolumeLiters,
        approximateIssues: unique(approximateIssues),
        assumptions: unique([...assumptions, 'dilute_solution_molarity_as_molality']),
    };
};

const activityCoefficient = (charge: number, ionicStrength: number): number => {
    if (charge === 0 || ionicStrength <= 0) return 1;
    const rootI = Math.sqrt(Math.max(0, ionicStrength));
    const logGamma = -0.509 * charge * charge * (rootI / (1 + rootI) - 0.3 * ionicStrength);
    return 10 ** logGamma;
};

const familySpecies = (
    analytical: AnalyticalFamily,
    pH: number,
    ionicStrength: number,
): Array<{ charge: number; molar: number }> => {
    const { family, totalMolar } = analytical;
    const logHydrogenActivity = -pH * Math.LN10;
    const logWeights: number[] = [0];
    for (let index = 0; index < family.pKas.length; index += 1) {
        const previousCharge = family.fullyProtonatedCharge - index;
        const nextCharge = previousCharge - 1;
        const activityAdjustment = family.pKaMetadata[index]?.pKaType === 'thermodynamic'
            ? Math.log(activityCoefficient(previousCharge, ionicStrength)) - Math.log(activityCoefficient(nextCharge, ionicStrength))
            : 0;
        const logRatio = -family.pKas[index]! * Math.LN10 - logHydrogenActivity + activityAdjustment;
        logWeights.push(logWeights[index]! + logRatio);
    }
    const maxLogWeight = Math.max(...logWeights);
    const scaledWeights = logWeights.map((weight) => Math.exp(weight - maxLogWeight));
    const denominator = scaledWeights.reduce((sum, weight) => sum + weight, 0);
    return scaledWeights.map((weight, index) => ({
        charge: family.fullyProtonatedCharge - index,
        molar: totalMolar * weight / denominator,
    }));
};

const mixtureStateAt = (
    mixture: PreparedMixture,
    pH: number,
    ionicStrength: number,
): { chargeBalance: number; ionicStrength: number; massBalanceResidual: number } => {
    const hydrogenActivity = 10 ** (-pH);
    const hydrogen = hydrogenActivity / activityCoefficient(1, ionicStrength);
    const hydroxideActivity = 1e-14 / hydrogenActivity;
    const hydroxide = hydroxideActivity / activityCoefficient(-1, ionicStrength);
    let chargeBalance = hydrogen - hydroxide;
    let calculatedIonicStrength = 0.5 * (hydrogen + hydroxide);
    let massBalanceResidual = 0;

    for (const fixedIon of mixture.fixedIons) {
        chargeBalance += fixedIon.charge * fixedIon.molar;
        calculatedIonicStrength += 0.5 * fixedIon.charge * fixedIon.charge * fixedIon.molar;
    }
    for (const analytical of mixture.families) {
        const speciesDistribution = familySpecies(analytical, pH, ionicStrength);
        const distributedTotal = speciesDistribution.reduce((sum, species) => sum + species.molar, 0);
        massBalanceResidual = Math.max(
            massBalanceResidual,
            Math.abs(distributedTotal - analytical.totalMolar),
        );
        for (const species of speciesDistribution) {
            chargeBalance += species.charge * species.molar;
            calculatedIonicStrength += 0.5 * species.charge * species.charge * species.molar;
        }
    }
    return { chargeBalance, ionicStrength: calculatedIonicStrength, massBalanceResidual };
};

const solveChargeBalance = (
    mixture: PreparedMixture,
): { converged: true; pH: number; ionicStrength: number; massBalanceResidual: number }
    | { converged: false } => {
    let ionicStrength = 0.001;
    let previousPh = 7;
    for (let activityIteration = 0; activityIteration < 80; activityIteration += 1) {
        let lowerPh = -6;
        let upperPh = 20;
        let lowerCharge = mixtureStateAt(mixture, lowerPh, ionicStrength).chargeBalance;
        let upperCharge = mixtureStateAt(mixture, upperPh, ionicStrength).chargeBalance;
        if (!(lowerCharge > 0 && upperCharge < 0)) return { converged: false };

        for (let rootIteration = 0; rootIteration < 120; rootIteration += 1) {
            const middlePh = (lowerPh + upperPh) / 2;
            const middleCharge = mixtureStateAt(mixture, middlePh, ionicStrength).chargeBalance;
            if (Math.abs(middleCharge) < 1e-13) {
                lowerPh = middlePh;
                upperPh = middlePh;
                break;
            }
            if (middleCharge > 0) {
                lowerPh = middlePh;
                lowerCharge = middleCharge;
            } else {
                upperPh = middlePh;
                upperCharge = middleCharge;
            }
            if (upperPh - lowerPh < 1e-11) break;
        }

        const pH = (lowerPh + upperPh) / 2;
        const calculatedIonicStrength = mixtureStateAt(mixture, pH, ionicStrength).ionicStrength;
        if (!Number.isFinite(calculatedIonicStrength) || calculatedIonicStrength < 0) return { converged: false };
        const nextIonicStrength = 0.5 * ionicStrength + 0.5 * calculatedIonicStrength;
        if (Math.abs(nextIonicStrength - ionicStrength) < 1e-10 && Math.abs(pH - previousPh) < 1e-9) {
            const finalState = mixtureStateAt(mixture, pH, ionicStrength);
            return {
                converged: true,
                pH,
                ionicStrength: calculatedIonicStrength,
                massBalanceResidual: finalState.massBalanceResidual,
            };
        }
        ionicStrength = nextIonicStrength;
        previousPh = pH;
    }
    return { converged: false };
};

const preflight = (batch: WasteBatchDraft, catalog: PhCatalog): PhPredictionResult | undefined => {
    if (batch.mixingState === 'separate') {
        return makeResult(batch, catalog, 'blocked', 'unavailable', [PH_PREDICTION_ISSUES.MIXING_NOT_COMPLETE], []);
    }
    if (batch.mixingState !== 'already_mixed') {
        return makeResult(batch, catalog, 'blocked', 'unavailable', [PH_PREDICTION_ISSUES.MIXING_STATE_UNKNOWN], []);
    }
    if (batch.incidentContext !== 'none') {
        return makeResult(batch, catalog, 'blocked', 'unavailable', [PH_PREDICTION_ISSUES.ACTIVE_INCIDENT], []);
    }
    if (batch.matrix !== 'aqueous') {
        return makeResult(batch, catalog, 'unsupported', 'unavailable', [PH_PREDICTION_ISSUES.MATRIX_NOT_AQUEOUS], []);
    }
    if (batch.additionalComponentsStatus !== 'none') {
        return makeResult(batch, catalog, 'unsupported', 'unavailable', [PH_PREDICTION_ISSUES.ADDITIONAL_COMPONENTS_UNCONFIRMED], []);
    }
    if (batch.components.some((component) => component.hazardFlags.some((flag) => DANGEROUS_HAZARDS.has(flag)))) {
        return makeResult(batch, catalog, 'blocked', 'unavailable', [PH_PREDICTION_ISSUES.DANGEROUS_HAZARD], []);
    }
    if (batch.components.some((component) => UNSUPPORTED_CATEGORIES.has(component.category))) {
        return makeResult(batch, catalog, 'blocked', 'unavailable', [PH_PREDICTION_ISSUES.DANGEROUS_HAZARD], []);
    }
    if (checkCompatibility(batch.components, { matrix: batch.matrix })
        .some((warning) => warning.severity === 'DANGER')) {
        return makeResult(batch, catalog, 'blocked', 'unavailable', [PH_PREDICTION_ISSUES.DANGEROUS_COMPATIBILITY], []);
    }
    if (batch.components.some((component) => {
        const solventClass = component.solutionContext?.solventClass;
        return solventClass === 'organic_non_halogen' || solventClass === 'organic_halogen';
    })) {
        return makeResult(batch, catalog, 'unsupported', 'unavailable', [PH_PREDICTION_ISSUES.COMPONENT_SOLVENT_NOT_AQUEOUS], []);
    }
    const hasUnclearSolutionContext = batch.components.some((component) => component.concentration && (
        !component.solutionContext ||
        component.solutionContext.solventClass === 'mixed_or_unknown' ||
        component.solutionContext.solventClass === 'organic_unknown'
    ));
    if (hasUnclearSolutionContext && batch.matrixSource !== 'user') {
        return makeResult(batch, catalog, 'unsupported', 'unavailable', [PH_PREDICTION_ISSUES.COMPONENT_SOLVENT_ASSUMED_AQUEOUS], []);
    }
    return undefined;
};

/**
 * Predicts an informational pH for an already-mixed, homogeneous aqueous batch.
 * The returned value must never be copied into measuredBatchPh or used as a
 * WasteRoutingBasis; unsupported chemistry deliberately returns no number.
 */
export const predictAqueousPh = (
    batch: WasteBatchDraft,
    catalog: PhCatalog = DEFAULT_PH_CATALOG,
): PhPredictionResult => {
    const gate = preflight(batch, catalog);
    if (gate) return gate;
    if (validatePhCatalog(catalog).length > 0) {
        return makeResult(batch, catalog, 'failed', 'unavailable', [PH_PREDICTION_ISSUES.CATALOG_INVALID], []);
    }
    const approval = catalog === DEFAULT_PH_CATALOG
        ? DEFAULT_PH_CATALOG_APPROVAL
        : evaluatePhCatalogApproval(catalog);
    if (!approval.runtimeReady) {
        return makeResult(batch, catalog, 'failed', 'unavailable', [PH_PREDICTION_ISSUES.CATALOG_INVALID], []);
    }
    if (batch.components.length === 0) {
        return makeResult(batch, catalog, 'unsupported', 'unavailable', [PH_PREDICTION_ISSUES.CATALOG_MATCH_REQUIRED], []);
    }

    const prepared = prepareMixture(batch, catalog, new Set(approval.approvedRecordIds));
    if ('status' in prepared) return prepared;
    const solution = solveChargeBalance(prepared);
    if (!solution.converged) {
        return makeResult(
            batch,
            catalog,
            'failed',
            'unavailable',
            [PH_PREDICTION_ISSUES.SOLVER_DID_NOT_CONVERGE],
            prepared.assumptions,
        );
    }
    if (solution.massBalanceResidual > 1e-10) {
        return makeResult(
            batch,
            catalog,
            'failed',
            'unavailable',
            [PH_PREDICTION_ISSUES.SOLVER_MASS_BALANCE_FAILED],
            prepared.assumptions,
        );
    }

    const scopeIssues: string[] = [];
    if (prepared.totalAnalyticalMolar > 0.1 + 1e-12) {
        scopeIssues.push(PH_PREDICTION_ISSUES.ANALYTICAL_CONCENTRATION_OUT_OF_RANGE);
    }
    if (solution.ionicStrength > 0.1) scopeIssues.push(PH_PREDICTION_ISSUES.IONIC_STRENGTH_OUT_OF_RANGE);
    if (solution.pH < 1 || solution.pH > 13) scopeIssues.push(PH_PREDICTION_ISSUES.PH_OUT_OF_RANGE);
    if (scopeIssues.length > 0) {
        return makeResult(
            batch,
            catalog,
            'unsupported',
            'unavailable',
            [...prepared.approximateIssues, ...scopeIssues],
            prepared.assumptions,
            { ionicStrength: solution.ionicStrength },
        );
    }

    const issueCodes = [...prepared.approximateIssues];
    if (solution.ionicStrength > 0.01) issueCodes.push(PH_PREDICTION_ISSUES.IONIC_STRENGTH_APPROXIMATE);
    if (solution.pH < 2 || solution.pH > 12) issueCodes.push(PH_PREDICTION_ISSUES.PH_EDGE_APPROXIMATE);
    const approximate = issueCodes.length > 0;
    return makeResult(
        batch,
        catalog,
        approximate ? 'approximate' : 'available',
        approximate ? 'approximate' : 'good',
        issueCodes,
        prepared.assumptions,
        {
            value: solution.pH,
            displayValue: Math.round(solution.pH * 10) / 10,
            ionicStrength: solution.ionicStrength,
        },
    );
};
