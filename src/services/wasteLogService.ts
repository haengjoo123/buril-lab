/**
 * Waste log service.
 *
 * V2 mutations are intentionally RPC-only: authorization, idempotency and the
 * waste-log/item transaction are enforced by the database. Legacy rows remain
 * readable through the same paginated query used by existing screens.
 */

import { supabase } from './supabaseClient';
import type {
    CartItem,
    HandlingAction,
    PhPredictionSnapshot,
    WasteBatchDraft,
    WasteConcentrationBasis,
    WasteDecision,
    WasteHazardFlag,
    WasteLog,
    WasteMatrix,
    WasteSolutionVolumeUnit,
    WasteStreamCode,
} from '../types';
import { useLabStore } from '../store/useLabStore';
import { getMeasuredBatchPh, validateWasteAmount } from '../utils/wasteBatch';

export type WasteLogDecisionStatus = WasteDecision['decisionStatus'] | 'legacy_unverified';

/** Superset of the legacy WasteLog type returned by the additive V2 schema. */
export interface WasteLogRecord extends WasteLog {
    user_id?: string;
    lab_id?: string | null;
    schema_version?: 1 | 2;
    record_origin?: string;
    handling_action?: HandlingAction | null;
    decision_status?: WasteLogDecisionStatus;
    stream_code?: WasteStreamCode | null;
    matrix_code?: WasteMatrix | null;
    policy_version_id?: string | null;
    rule_version?: string | null;
    total_amount_value?: number | null;
    total_amount_unit?: 'mL' | 'L' | 'mg' | 'g' | null;
    normalized_amount_value?: number | null;
    normalized_amount_unit?: 'mL' | 'mg' | null;
    amount_is_approximate?: boolean;
    amount_is_unknown?: boolean;
    decision_snapshot?: Record<string, unknown>;
    stream_snapshot?: Record<string, unknown>;
    confirmation_snapshot?: Record<string, unknown>;
    /** Informational client calculation; never a routing basis. */
    ph_prediction_snapshot?: Record<string, unknown>;
    request_id?: string | null;
    voided_at?: string | null;
    voided_by?: string | null;
    void_reason?: string | null;
}

export interface WasteLogItemDataSource {
    sourceType: string;
    sourceRef: string | null;
    capturedAt: string | null;
}

/** Canonical V2 component row. Read-only access is scoped by waste_log_items RLS. */
export interface WasteLogItemRecord {
    id: string;
    wasteLogId: string;
    lineNumber: number;
    cartLineId: string;
    sourceType: 'search' | 'scan' | 'inventory' | 'cabinet' | 'manual' | 'import';
    sourceRef: string | null;
    inventoryItemId: string | null;
    cabinetItemId: string | null;
    chemicalName: string;
    casNumber: string | null;
    formula: string | null;
    molecularWeight: number | null;
    pubchemCid: number | null;
    koshaChemId: string | null;
    identityConfidence: number | null;
    ghsDataStatus: 'verified' | 'lookup_failed' | 'not_checked' | null;
    concentrationValue: number | null;
    concentrationUnit: 'M' | 'mM' | '%' | 'mg/mL' | null;
    solutionVolumeValue: number | null;
    solutionVolumeUnit: WasteSolutionVolumeUnit | null;
    solutionVolumeNormalizedMl: number | null;
    solutionVolumeIsEstimate: boolean;
    concentrationBasis: WasteConcentrationBasis | null;
    densityValue: number | null;
    densityUnit: 'g/mL' | null;
    densityKind: 'solution' | 'solute' | null;
    densityTemperatureC: number | null;
    densitySource: 'catalog' | 'user' | null;
    densityIsEstimate: boolean;
    phCatalogId: string | null;
    hazardFlags: WasteHazardFlag[];
    dataSources: WasteLogItemDataSource[];
    analysisSnapshot: Record<string, unknown>;
    createdAt: string;
}

export interface RecordWasteHandlingV2Params {
    batch: WasteBatchDraft;
    decision: WasteDecision;
    handlingAction: HandlingAction;
    memo?: string;
    confirmationSnapshot?: {
        alreadyMixed?: boolean;
        mixingState?: WasteBatchDraft['mixingState'];
        predictedPhAuthorizationId?: string;
    };
    /** Immutable, non-authoritative snapshot captured when the record is finalized. */
    phPredictionSnapshot?: PhPredictionSnapshot;
    /** Reuse this UUID when retrying the same user action. */
    requestId?: string;
}

export interface WasteHandlingReceipt {
    id: string;
    createdAt: string;
    requestId: string;
    schemaVersion: 2;
    handlingAction: HandlingAction;
    decisionStatus: WasteDecision['decisionStatus'];
    streamCode: WasteStreamCode;
    streamSnapshot: {
        streamCode: WasteStreamCode;
        displayNameKo: string;
        displayNameEn: string;
        containerLabel: string | null;
        location: string | null;
    };
}

export interface VoidWasteLogReceipt {
    id: string;
    voidedAt: string | null;
    voidedBy: string | null;
    reason: string;
}

export interface WasteHandlingRpcBatchPayload {
    components: Array<{
        cartLineId: string;
        sourceType: string;
        sourceRef: string | null;
        inventoryItemId: string | null;
        cabinetItemId: string | null;
        chemicalName: string;
        casNumber: string | null;
        formula: string | null;
        molecularWeight: number | null;
        pubchemCid: number | null;
        koshaChemId: number | null;
        identityConfidence: number;
        ghsDataStatus: string;
        concentration: {
            value: number;
            unit: string;
        } | null;
        hazardFlags: string[];
        dataSources: Array<{
            sourceType: string;
            sourceRef: string | null;
            capturedAt: string;
        }>;
        analysisSnapshot: Record<string, unknown>;
    }>;
    handlingAction: HandlingAction;
    decisionStatus: WasteDecision['decisionStatus'];
    streamCode: WasteDecision['streamCode'];
    matrix: WasteBatchDraft['matrix'];
    totalAmount: {
        value: number | null;
        unit: WasteBatchDraft['totalAmount']['unit'];
        approximate: boolean;
        unknown: boolean;
    };
    decisionSnapshot: {
        hazardFlags: string[];
        allowedActions: HandlingAction[];
        blockingReasons: WasteDecision['blockingReasons'];
        missingFields: WasteDecision['missingFields'];
        legalWastePhClass: WasteDecision['legalWastePhClass'];
        corrosivityPhScreen: WasteDecision['corrosivityPhScreen'];
        routingBasis: WasteDecision['routingBasis'];
        policyVersion: string;
        ruleVersion: string;
    };
        confirmationSnapshot: Record<string, unknown>;
    memo: string | null;
}

export type WasteHandlingRpcComponent = WasteHandlingRpcBatchPayload['components'][number];

/**
 * The exact, server-bindable input for a predicted-pH authorization. It uses
 * the same normalized component payload that is later sent to the write RPC.
 */
export interface WastePhPredictionAuthorizationContext {
    components: WasteHandlingRpcComponent[];
    matrix: WasteBatchDraft['matrix'];
    totalAmount: WasteHandlingRpcBatchPayload['totalAmount'];
    confirmationSnapshot: Pick<
        WasteBatchDraft,
        'matrixSource' | 'mixingState' | 'additionalComponentsStatus' | 'incidentContext'
    >;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WASTE_HAZARD_FLAGS = new Set<WasteHazardFlag>([
    'FLAMMABLE',
    'OXIDIZER',
    'EXPLOSIVE',
    'SELF_REACTIVE',
    'WATER_REACTIVE',
    'PYROPHORIC',
    'CORROSIVE',
    'ACUTE_TOXIC',
    'CMR',
    'ENVIRONMENTAL_HAZARD',
    'CYANIDE',
    'SULFIDE',
    'HEAVY_METAL',
    'HYDROFLUORIC_ACID',
    'FLUORIDE',
    'REACTIVE',
    'UNKNOWN_COMPONENT',
]);

function createRequestId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    throw new Error('This environment cannot create an idempotency key.');
}

function assertUuid(value: string, fieldName: string): void {
    if (!UUID_PATTERN.test(value)) {
        throw new Error(`${fieldName} must be a valid UUID.`);
    }
}

function normalizeWasteLogChemicals(value: unknown): CartItem[] {
    if (!Array.isArray(value)) return [];

    return value.filter((item): item is CartItem => (
        item !== null &&
        typeof item === 'object' &&
        !Array.isArray(item)
    ));
}

function asNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

export function normalizeWasteLogRow(row: unknown): WasteLogRecord {
    const log = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;

    return {
        ...(log as unknown as WasteLogRecord),
        id: String(log.id || ''),
        created_at: String(log.created_at || ''),
        chemicals: normalizeWasteLogChemicals(log.chemicals),
        disposal_category: String(log.disposal_category || log.stream_code || 'UNKNOWN'),
        total_volume_ml: asNullableNumber(log.total_volume_ml) ?? undefined,
        schema_version: log.schema_version === 2 || Number(log.schema_version) === 2 ? 2 : 1,
        decision_status: log.decision_status === 'ready'
            || log.decision_status === 'needs_input'
            || log.decision_status === 'blocked'
            ? log.decision_status
            : 'legacy_unverified',
        total_amount_value: asNullableNumber(log.total_amount_value),
        normalized_amount_value: asNullableNumber(log.normalized_amount_value),
        amount_is_approximate: Boolean(log.amount_is_approximate),
        amount_is_unknown: Boolean(log.amount_is_unknown),
        confirmation_snapshot: asRecord(log.confirmation_snapshot) ?? {},
        ph_prediction_snapshot: asRecord(log.ph_prediction_snapshot) ?? {},
        voided_at: typeof log.voided_at === 'string' ? log.voided_at : null,
        voided_by: typeof log.voided_by === 'string' ? log.voided_by : null,
        void_reason: typeof log.void_reason === 'string' ? log.void_reason : null,
    };
}

export function isLegacyWasteLog(log: Pick<WasteLogRecord, 'schema_version' | 'decision_status'>): boolean {
    return log.schema_version !== 2 || log.decision_status === 'legacy_unverified';
}

function asNullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeWasteLogItemDataSources(value: unknown): WasteLogItemDataSource[] {
    if (!Array.isArray(value)) return [];

    return value.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const source = candidate as Record<string, unknown>;
        const sourceType = asNullableString(source.sourceType ?? source.source_type);
        if (!sourceType) return [];
        return [{
            sourceType,
            sourceRef: asNullableString(source.sourceRef ?? source.source_ref),
            capturedAt: asNullableString(source.capturedAt ?? source.captured_at),
        }];
    });
}

export function normalizeWasteLogItemRow(row: unknown): WasteLogItemRecord {
    const item = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const sourceTypeValue = asNullableString(item.source_type);
    const sourceType = sourceTypeValue === 'scan'
        || sourceTypeValue === 'inventory'
        || sourceTypeValue === 'cabinet'
        || sourceTypeValue === 'manual'
        || sourceTypeValue === 'import'
        ? sourceTypeValue
        : 'search';
    const ghsStatusValue = asNullableString(item.ghs_data_status);
    const ghsDataStatus = ghsStatusValue === 'verified'
        || ghsStatusValue === 'lookup_failed'
        || ghsStatusValue === 'not_checked'
        ? ghsStatusValue
        : null;
    const concentrationUnitValue = asNullableString(item.concentration_unit);
    const concentrationUnit = concentrationUnitValue === 'M'
        || concentrationUnitValue === 'mM'
        || concentrationUnitValue === '%'
        || concentrationUnitValue === 'mg/mL'
        ? concentrationUnitValue
        : null;
    const solutionVolumeUnitValue = asNullableString(item.solution_volume_unit);
    const solutionVolumeUnit = solutionVolumeUnitValue === 'uL'
        || solutionVolumeUnitValue === 'mL'
        || solutionVolumeUnitValue === 'L'
        ? solutionVolumeUnitValue
        : null;
    const concentrationBasisValue = asNullableString(item.concentration_basis);
    const concentrationBasis = concentrationBasisValue === 'w_w'
        || concentrationBasisValue === 'w_v'
        || concentrationBasisValue === 'v_v'
        ? concentrationBasisValue
        : null;
    const densityKindValue = asNullableString(item.density_kind);
    const densityKind = densityKindValue === 'solution' || densityKindValue === 'solute'
        ? densityKindValue
        : null;
    const densitySourceValue = asNullableString(item.density_source);
    const densitySource = densitySourceValue === 'catalog' || densitySourceValue === 'user'
        ? densitySourceValue
        : null;
    const hazardFlags = Array.isArray(item.hazard_flags)
        ? item.hazard_flags.filter((flag): flag is WasteHazardFlag => (
            typeof flag === 'string' && WASTE_HAZARD_FLAGS.has(flag as WasteHazardFlag)
        ))
        : [];
    const analysisSnapshot = item.analysis_snapshot
        && typeof item.analysis_snapshot === 'object'
        && !Array.isArray(item.analysis_snapshot)
        ? item.analysis_snapshot as Record<string, unknown>
        : {};

    return {
        id: String(item.id || ''),
        wasteLogId: String(item.waste_log_id || ''),
        lineNumber: asNullableNumber(item.line_number) ?? 0,
        cartLineId: String(item.cart_line_id || ''),
        sourceType,
        sourceRef: asNullableString(item.source_ref),
        inventoryItemId: asNullableString(item.inventory_item_id),
        cabinetItemId: asNullableString(item.cabinet_item_id),
        chemicalName: String(item.chemical_name || ''),
        casNumber: asNullableString(item.cas_number),
        formula: asNullableString(item.formula),
        molecularWeight: asNullableNumber(item.molecular_weight),
        pubchemCid: asNullableNumber(item.pubchem_cid),
        koshaChemId: asNullableString(item.kosha_chem_id),
        identityConfidence: asNullableNumber(item.identity_confidence),
        ghsDataStatus,
        concentrationValue: asNullableNumber(item.concentration_value),
        concentrationUnit,
        solutionVolumeValue: asNullableNumber(item.solution_volume_value),
        solutionVolumeUnit,
        solutionVolumeNormalizedMl: asNullableNumber(item.solution_volume_normalized_ml),
        solutionVolumeIsEstimate: Boolean(item.solution_volume_is_estimate),
        concentrationBasis,
        densityValue: asNullableNumber(item.density_value),
        densityUnit: item.density_unit === 'g/mL' ? 'g/mL' : null,
        densityKind,
        densityTemperatureC: asNullableNumber(item.density_temperature_c),
        densitySource,
        densityIsEstimate: Boolean(item.density_is_estimate),
        phCatalogId: asNullableString(item.ph_catalog_id),
        hazardFlags,
        dataSources: normalizeWasteLogItemDataSources(item.data_sources),
        analysisSnapshot,
        createdAt: String(item.created_at || ''),
    };
}

function identityConfidenceToNumber(value: WasteBatchDraft['components'][number]['identityConfidence']): number {
    if (value === 'verified') return 1;
    if (value === 'review_required') return 0.5;
    return 0;
}

function buildComponentDataSources(
    component: WasteBatchDraft['components'][number],
): WasteHandlingRpcBatchPayload['components'][number]['dataSources'] {
    const sources: WasteHandlingRpcBatchPayload['components'][number]['dataSources'] = [{
        sourceType: component.sourceType,
        sourceRef: component.sourceRef ?? null,
        capturedAt: component.capturedAt,
    }];
    if (/^\d+$/.test(component.chemical.id)) {
        sources.push({
            sourceType: 'pubchem',
            sourceRef: `CID:${component.chemical.id}`,
            capturedAt: component.capturedAt,
        });
    }
    if (component.chemical.koshaId) {
        sources.push({
            sourceType: 'kosha',
            sourceRef: `chemId:${component.chemical.koshaId}`,
            capturedAt: component.capturedAt,
        });
    }
    return sources;
}

function buildPhPredictionInput(
    component: WasteBatchDraft['components'][number],
): Record<string, unknown> | null {
    const input: Record<string, unknown> = {};
    const volume = component.solutionVolume;
    if (volume) {
        if (!Number.isFinite(volume.value) || volume.value <= 0
            || !Number.isFinite(volume.normalizedMl) || volume.normalizedMl <= 0
            || !['uL', 'mL', 'L'].includes(volume.unit)) {
            throw new Error('Solution volume must be a positive finite value with a supported unit.');
        }
        const expectedMl = volume.unit === 'L'
            ? volume.value * 1_000
            : volume.unit === 'uL' ? volume.value / 1_000 : volume.value;
        if (Math.abs(volume.normalizedMl - expectedMl) > Math.max(1e-9, expectedMl * 1e-9)) {
            throw new Error('Normalized solution volume does not match its value and unit.');
        }
        input.solutionVolume = {
            value: volume.value,
            unit: volume.unit,
            normalizedMl: volume.normalizedMl,
            isEstimate: Boolean(volume.isEstimate),
        };
    }

    const { concentration } = component;
    if (concentration?.basis) input.concentrationBasis = concentration.basis;
    if (concentration?.density) {
        const density = concentration.density;
        if (!Number.isFinite(density.value) || density.value <= 0
            || density.unit !== 'g/mL'
            || !['solution', 'solute'].includes(density.kind)
            || (density.temperatureC !== undefined
                && (!Number.isFinite(density.temperatureC)
                    || density.temperatureC < -100 || density.temperatureC > 300))) {
            throw new Error('Density metadata is invalid.');
        }
        input.density = {
            value: density.value,
            unit: density.unit,
            kind: density.kind,
            ...(density.temperatureC === undefined ? {} : { temperatureC: density.temperatureC }),
            ...(density.source ? { source: density.source } : {}),
            isEstimate: Boolean(density.isEstimate),
        };
    }

    if (component.phCatalogId) {
        const phCatalogId = component.phCatalogId.trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(phCatalogId) || phCatalogId.length > 200) {
            throw new Error('The pH catalog identifier is invalid.');
        }
        input.phCatalogId = phCatalogId;
    }

    return Object.keys(input).length > 0 ? input : null;
}

function buildSolutionContextSnapshot(
    component: WasteBatchDraft['components'][number],
): Record<string, unknown> | null {
    const context = component.solutionContext;
    if (!context) return null;

    const solventCasNumber = context.solventCasNumber?.trim();
    return {
        physicalForm: context.physicalForm,
        solventClass: context.solventClass,
        isSolventVerified: context.isSolventVerified === true,
        solventResolution: context.solventResolution ?? 'unresolved',
        ...(solventCasNumber ? { solventCasNumber } : {}),
    };
}

function validatePhPredictionSnapshot(snapshot: PhPredictionSnapshot): PhPredictionSnapshot {
    const hasNumericResult = snapshot.status === 'available' || snapshot.status === 'approximate';
    if (snapshot.origin !== 'client_generated'
        || !Number.isFinite(Date.parse(snapshot.capturedAt))
        || !['available', 'approximate', 'unsupported', 'blocked', 'failed'].includes(snapshot.status)
        || !['good', 'approximate', 'unavailable'].includes(snapshot.confidence)
        || !snapshot.modelVersion.trim() || snapshot.modelVersion.length > 100
        || !snapshot.catalogVersion.trim() || snapshot.catalogVersion.length > 100
        || !/^[A-Za-z0-9:_-]{8,128}$/.test(snapshot.inputHash)
        || snapshot.issueCodes.length > 32 || snapshot.issueCodes.some((value) => value.length > 100)
        || snapshot.assumptions.length > 32 || snapshot.assumptions.some((value) => value.length > 500)) {
        throw new Error('The pH prediction snapshot is invalid.');
    }
    if (hasNumericResult) {
        if (snapshot.value === undefined || !Number.isFinite(snapshot.value)
            || snapshot.value < 0 || snapshot.value > 14
            || snapshot.displayValue === undefined || !Number.isFinite(snapshot.displayValue)
            || snapshot.displayValue < 0 || snapshot.displayValue > 14
            || snapshot.ionicStrength === undefined || !Number.isFinite(snapshot.ionicStrength)
            || snapshot.ionicStrength < 0 || snapshot.ionicStrength > 0.1) {
            throw new Error('Available pH predictions require bounded numeric results.');
        }
    } else if (snapshot.value !== undefined || snapshot.displayValue !== undefined) {
        throw new Error('Unavailable pH predictions cannot contain a pH result.');
    } else if (snapshot.ionicStrength !== undefined
        && (!Number.isFinite(snapshot.ionicStrength)
            || snapshot.ionicStrength < 0 || snapshot.ionicStrength > 100)) {
        throw new Error('Unavailable pH prediction ionic strength is invalid.');
    }
    return {
        ...snapshot,
        issueCodes: [...snapshot.issueCodes],
        assumptions: [...snapshot.assumptions],
    };
}

function validateHandlingAction(decision: WasteDecision, handlingAction: HandlingAction): void {
    if (!decision.allowedActions.includes(handlingAction)) {
        throw new Error('The selected handling action is not allowed by the waste decision.');
    }

    if (decision.decisionStatus === 'ready' && handlingAction !== 'container_deposit') {
        throw new Error('A ready batch must be recorded as a container deposit.');
    }

    if (decision.decisionStatus !== 'ready' && handlingAction === 'container_deposit') {
        throw new Error('A blocked or incomplete batch cannot be deposited into a waste container.');
    }
}

export function buildWasteHandlingComponents(
    components: WasteBatchDraft['components'],
    phPredictionSnapshot?: PhPredictionSnapshot,
): WasteHandlingRpcComponent[] {
    return components.map((component, index) => {
        const phPredictionInput = buildPhPredictionInput(component);
        const solutionContextSnapshot = buildSolutionContextSnapshot(component);
        return {
            cartLineId: component.cartLineId,
            sourceType: component.sourceType,
            sourceRef: component.sourceRef ?? null,
            inventoryItemId: component.inventoryId ?? null,
            cabinetItemId: component.cabinetId ?? null,
            chemicalName: component.chemical.name,
            casNumber: component.chemical.casNumber || null,
            formula: component.chemical.molecularFormula || null,
            molecularWeight: component.chemical.molecularWeight ?? null,
            pubchemCid: /^\d+$/.test(component.chemical.id) ? Number(component.chemical.id) : null,
            koshaChemId: component.chemical.koshaId ?? null,
            identityConfidence: identityConfidenceToNumber(component.identityConfidence),
            ghsDataStatus: component.ghsDataStatus,
            concentration: component.concentration ? {
                value: component.concentration.value,
                unit: component.concentration.unit,
            } : null,
            hazardFlags: [...component.hazardFlags],
            dataSources: buildComponentDataSources(component),
            analysisSnapshot: {
                category: component.category,
                label: component.label,
                reason: component.reason,
                reasonParams: component.reasonParams ?? null,
                isAiEstimated: Boolean(component.isAiEstimated),
                identityConfirmedByUser: Boolean(component.identityConfirmedByUser),
                ghs: component.chemical.ghs ?? null,
                hazardDataConfirmedByUser: Boolean(component.hazardDataConfirmedByUser),
                scanSnapshot: component.scanSnapshot ?? null,
                physicalProperties: component.chemical.physicalProperties ?? null,
                referencePh: component.chemical.properties?.referencePh ?? component.chemical.properties?.ph ?? null,
                referencePhSource: component.chemical.properties?.phSource ?? null,
                inventorySnapshot: component.inventorySnapshot ?? null,
                inventoryDisposalQuantity: component.inventoryDisposalQuantity ?? null,
                ...(solutionContextSnapshot ? { solutionContext: solutionContextSnapshot } : {}),
                ...(phPredictionInput ? { phPredictionInput } : {}),
                ...(index === 0 && phPredictionSnapshot
                    ? { phPredictionSnapshot: validatePhPredictionSnapshot(phPredictionSnapshot) }
                    : {}),
            },
        };
    });
}

export function buildWastePhPredictionAuthorizationContext(
    batch: WasteBatchDraft,
): WastePhPredictionAuthorizationContext {
    return {
        components: buildWasteHandlingComponents(batch.components),
        matrix: batch.matrix,
        totalAmount: {
            value: batch.totalAmount.value,
            unit: batch.totalAmount.unit,
            approximate: batch.totalAmount.isApproximate,
            unknown: batch.totalAmount.isUnknown,
        },
        confirmationSnapshot: {
            matrixSource: batch.matrixSource,
            mixingState: batch.mixingState,
            additionalComponentsStatus: batch.additionalComponentsStatus,
            incidentContext: batch.incidentContext,
        },
    };
}

export function buildWasteHandlingRpcPayload(
    params: Pick<RecordWasteHandlingV2Params, 'batch' | 'decision' | 'handlingAction' | 'memo' | 'confirmationSnapshot' | 'phPredictionSnapshot'>,
): WasteHandlingRpcBatchPayload {
    const { batch, decision, handlingAction } = params;

    if (batch.components.length === 0) {
        throw new Error('At least one waste component is required.');
    }
    if (batch.components.length > 100) {
        throw new Error('A waste batch can contain at most 100 components.');
    }

    const amountValidation = validateWasteAmount(batch.totalAmount, batch.matrix);
    if (!amountValidation.valid) {
        throw new Error(`Invalid waste amount: ${amountValidation.error}.`);
    }

    const measuredBatchPh = getMeasuredBatchPh(batch);
    if (batch.measuredPhStatus === 'measured' && (
        measuredBatchPh === undefined || !Number.isFinite(measuredBatchPh) ||
        measuredBatchPh < 0 || measuredBatchPh > 14
    )) {
        throw new Error('Measured pH must be between 0 and 14.');
    }

    validateHandlingAction(decision, handlingAction);

    return {
        components: buildWasteHandlingComponents(batch.components, params.phPredictionSnapshot),
        handlingAction,
        decisionStatus: decision.decisionStatus,
        streamCode: decision.streamCode,
        matrix: batch.matrix,
        totalAmount: {
            value: batch.totalAmount.value,
            unit: batch.totalAmount.unit,
            approximate: batch.totalAmount.isApproximate,
            unknown: batch.totalAmount.isUnknown,
        },
        decisionSnapshot: {
            hazardFlags: [...decision.hazardFlags],
            allowedActions: [...decision.allowedActions],
            blockingReasons: decision.blockingReasons,
            missingFields: [...decision.missingFields],
            legalWastePhClass: decision.legalWastePhClass,
            corrosivityPhScreen: decision.corrosivityPhScreen,
            routingBasis: decision.routingBasis,
            policyVersion: decision.policyVersion,
            ruleVersion: decision.ruleVersion,
        },
        confirmationSnapshot: {
            batchId: batch.id,
            scopeKey: batch.scopeKey,
            matrixSource: batch.matrixSource,
            incidentContext: batch.incidentContext,
            measuredBatchPh: batch.measuredPhStatus === 'measured' ? measuredBatchPh ?? null : null,
            measuredPh: batch.measuredPhStatus === 'measured' ? measuredBatchPh ?? null : null,
            measuredPhStatus: batch.measuredPhStatus,
            mixingState: batch.mixingState,
            ...(batch.mixingState === 'unknown'
                ? {}
                : { alreadyMixed: batch.mixingState === 'already_mixed' }),
            ...(batch.additionalComponentsStatus
                ? { additionalComponentsStatus: batch.additionalComponentsStatus }
                : {}),
            ...(batch.fluorideContainerStatus
                ? { fluorideContainerStatus: batch.fluorideContainerStatus }
                : {}),
            ...(params.confirmationSnapshot || {}),
        },
        memo: params.memo?.trim() || null,
    };
}

function unwrapRpcResult(data: unknown): Record<string, unknown> {
    const first = Array.isArray(data) ? data[0] : data;
    if (typeof first === 'string') return { id: first };
    if (!first || typeof first !== 'object') return {};

    const row = first as Record<string, unknown>;
    const nested = row.waste_log || row.record || row.result;
    return nested && typeof nested === 'object'
        ? { ...row, ...(nested as Record<string, unknown>) }
        : row;
}

function validateInventoryDisposalReceipt(
    row: Record<string, unknown>,
    expectedItems: Array<{
        item_id: string;
        item_source: 'inventory' | 'cabinet_item';
        quantity_to_remove: number;
    }>,
): void {
    const recordOrigin = row.record_origin ?? row.recordOrigin;
    const removedCountValue = row.removed_count ?? row.removedCount;
    const removedItemsValue = row.removed_items ?? row.removedItems;
    const removedCount = typeof removedCountValue === 'number'
        ? removedCountValue
        : Number.NaN;
    const removedItems = Array.isArray(removedItemsValue)
        ? removedItemsValue.flatMap((value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
            const item = value as Record<string, unknown>;
            const itemId = item.item_id ?? item.itemId;
            const itemSource = item.item_source ?? item.itemSource;
            const quantity = item.quantity_to_remove ?? item.quantityToRemove;
            return typeof itemId === 'string'
                && (itemSource === 'inventory' || itemSource === 'cabinet_item')
                && typeof quantity === 'number'
                && Number.isInteger(quantity)
                && quantity > 0
                ? [{ item_id: itemId, item_source: itemSource, quantity_to_remove: quantity }]
                : [];
        })
        : [];

    const expectedKeys = new Set(
        expectedItems.map((item) => `${item.item_source}:${item.item_id}:${item.quantity_to_remove}`),
    );
    const removedKeys = new Set(
        removedItems.map((item) => `${item.item_source}:${item.item_id}:${item.quantity_to_remove}`),
    );
    const matchesExpected = expectedKeys.size === removedKeys.size
        && [...expectedKeys].every((key) => removedKeys.has(key));

    if (
        recordOrigin !== 'inventory_disposal'
        || removedCount !== expectedItems.length
        || removedItems.length !== expectedItems.length
        || !matchesExpected
    ) {
        throw new Error('The inventory-disposal RPC returned an invalid atomic receipt.');
    }
}

/** Record one physical handling action through the atomic V2 RPC. */
export async function recordWasteHandlingV2(
    params: RecordWasteHandlingV2Params,
): Promise<WasteHandlingReceipt> {
    const requestId = params.requestId || createRequestId();
    assertUuid(requestId, 'requestId');

    const pBatch = buildWasteHandlingRpcPayload(params);
    const currentLabId = useLabStore.getState().currentLabId;
    const labId = params.batch.labId || null;

    if (labId !== (currentLabId || null)) {
        throw new Error('The waste batch does not belong to the selected lab.');
    }

    const inventoryItems: Array<{
        item_id: string;
        item_source: 'inventory' | 'cabinet_item';
        quantity_to_remove: number;
        available_quantity?: number;
    }> = [];
    for (const component of params.batch.components) {
        let linkedItem: (typeof inventoryItems)[number] | null = null;
        if (component.inventoryId) {
            const quantity = component.inventoryDisposalQuantity;
            if (!Number.isInteger(quantity) || quantity === undefined || quantity < 1) {
                throw new Error('A positive integer inventory disposal quantity is required.');
            }
            linkedItem = {
                item_id: component.inventoryId,
                item_source: 'inventory',
                quantity_to_remove: quantity,
                available_quantity: component.inventorySnapshot?.quantity ?? undefined,
            };
        } else if (component.sourceType === 'cabinet' && component.cabinetId) {
            linkedItem = {
                item_id: component.cabinetId,
                item_source: 'cabinet_item',
                quantity_to_remove: 1,
            };
        }
        if (linkedItem) {
            const existing = inventoryItems.find((candidate) => (
                candidate.item_id === linkedItem.item_id && candidate.item_source === linkedItem.item_source
            ));
            if (existing) {
                existing.quantity_to_remove += linkedItem.quantity_to_remove;
                if (
                    linkedItem.available_quantity !== undefined
                    && existing.available_quantity !== undefined
                    && linkedItem.available_quantity !== existing.available_quantity
                ) {
                    throw new Error('Linked inventory components have inconsistent available quantities.');
                }
            } else {
                inventoryItems.push(linkedItem);
            }
        }
    }

    for (const item of inventoryItems) {
        if (
            item.available_quantity !== undefined
            && (
                !Number.isInteger(item.available_quantity)
                || item.available_quantity < 1
                || item.quantity_to_remove > item.available_quantity
            )
        ) {
            throw new Error('The inventory disposal quantity exceeds the available inventory quantity.');
        }
        delete item.available_quantity;
    }

    const { data, error } = inventoryItems.length > 0
        ? await supabase.rpc('record_inventory_disposal_v2', {
            p_request_id: requestId,
            p_items: inventoryItems,
            p_batch: pBatch,
            p_lab_id: labId,
            p_actor_name: null,
        })
        : await supabase.rpc('record_waste_handling_v2', {
            p_request_id: requestId,
            p_batch: pBatch,
            p_lab_id: labId,
        });

    if (error) {
        console.error('Failed to record V2 waste handling:', error);
        throw error;
    }

    const row = unwrapRpcResult(data);
    const id = String(row.id || row.waste_log_id || '');
    const createdAt = String(row.created_at || row.createdAt || '');
    const returnedRequestIdValue = row.request_id ?? row.requestId;
    const returnedRequestId = typeof returnedRequestIdValue === 'string'
        ? returnedRequestIdValue
        : '';
    const returnedSchemaVersion = Number(row.schema_version ?? row.schemaVersion);
    const returnedRecordOrigin = row.record_origin ?? row.recordOrigin;
    const returnedHandlingAction = row.handling_action ?? row.handlingAction;
    const returnedDecisionStatus = row.decision_status ?? row.decisionStatus;
    const returnedStreamCode = row.stream_code ?? row.streamCode;
    const rawStreamSnapshot = row.stream_snapshot ?? row.streamSnapshot;
    const streamSnapshot = rawStreamSnapshot && typeof rawStreamSnapshot === 'object' && !Array.isArray(rawStreamSnapshot)
        ? rawStreamSnapshot as Record<string, unknown>
        : null;
    const expectedRecordOrigin = inventoryItems.length > 0
        ? 'inventory_disposal'
        : 'waste_batch';
    if (!id ||
        !createdAt ||
        returnedRequestId !== requestId ||
        returnedSchemaVersion !== 2 ||
        returnedRecordOrigin !== expectedRecordOrigin ||
        returnedHandlingAction !== params.handlingAction ||
        returnedDecisionStatus !== params.decision.decisionStatus ||
        returnedStreamCode !== params.decision.streamCode ||
        !streamSnapshot ||
        (streamSnapshot.streamCode ?? streamSnapshot.stream_code) !== returnedStreamCode) {
        throw new Error('The waste handling RPC returned an invalid receipt.');
    }
    if (inventoryItems.length > 0) {
        validateInventoryDisposalReceipt(row, inventoryItems);
    }

    const validatedHandlingAction = returnedHandlingAction as HandlingAction;
    const validatedDecisionStatus = returnedDecisionStatus as WasteDecision['decisionStatus'];
    const validatedStreamCode = returnedStreamCode as WasteStreamCode;
    const displayNameKo = streamSnapshot.displayNameKo ?? streamSnapshot.display_name_ko;
    const displayNameEn = streamSnapshot.displayNameEn ?? streamSnapshot.display_name_en;
    if (typeof displayNameKo !== 'string' || typeof displayNameEn !== 'string') {
        throw new Error('The waste handling RPC returned an invalid stream snapshot.');
    }

    return {
        id,
        createdAt,
        requestId: returnedRequestId,
        schemaVersion: 2,
        handlingAction: validatedHandlingAction,
        decisionStatus: validatedDecisionStatus,
        streamCode: validatedStreamCode,
        streamSnapshot: {
            streamCode: validatedStreamCode,
            displayNameKo,
            displayNameEn,
            containerLabel: typeof (streamSnapshot.containerLabel ?? streamSnapshot.container_label) === 'string'
                ? (streamSnapshot.containerLabel ?? streamSnapshot.container_label) as string
                : null,
            location: typeof streamSnapshot.location === 'string' ? streamSnapshot.location : null,
        },
    };
}

/** Mark a record as corrected without deleting its original audit trail. */
export async function voidWasteLogV2(id: string, reason: string): Promise<VoidWasteLogReceipt> {
    assertUuid(id, 'wasteLogId');
    const normalizedReason = reason.replace(/\s+/g, ' ').trim();
    if (normalizedReason.length < 3) {
        throw new Error('A correction reason of at least 3 characters is required.');
    }
    if (normalizedReason.length > 500) {
        throw new Error('The correction reason must be 500 characters or fewer.');
    }

    const { data, error } = await supabase.rpc('void_waste_log_v2', {
        p_waste_log_id: id,
        p_reason: normalizedReason,
    });

    if (error) {
        console.error('Failed to void waste log:', error);
        throw error;
    }

    const row = unwrapRpcResult(data);
    const returnedId = String(row.id || row.waste_log_id || '');
    const voidedAt = typeof row.voided_at === 'string'
        ? row.voided_at
        : typeof row.voidedAt === 'string' ? row.voidedAt : null;
    const voidedBy = typeof row.voided_by === 'string'
        ? row.voided_by
        : typeof row.voidedBy === 'string' ? row.voidedBy : null;
    const returnedReason = typeof row.void_reason === 'string'
        ? row.void_reason
        : typeof row.voidReason === 'string' ? row.voidReason : null;
    if (returnedId !== id || !voidedAt || !voidedBy || !returnedReason) {
        throw new Error('The waste-log correction RPC returned an invalid receipt.');
    }

    return {
        id: returnedId,
        voidedAt,
        voidedBy,
        reason: returnedReason,
    };
}

/** 정렬 기준 */
export type WasteLogSortBy = 'created_at' | 'disposal_category' | 'handler_name';

/** 검색/정렬 파라미터 */
export interface FetchWasteLogsParams {
    limit?: number;
    offset?: number;
    search?: string;
    sortBy?: WasteLogSortBy;
    sortOrder?: 'asc' | 'desc';
    createdAfter?: string;
    createdBefore?: string;
}

/** Fetch legacy and V2 records with the existing paging/search contract. */
export async function fetchWasteLogs(
    limit: number = 20,
    offset: number = 0,
    params?: Partial<FetchWasteLogsParams>,
): Promise<{ logs: WasteLogRecord[]; count: number }> {
    const { currentLabId } = useLabStore.getState();
    const search = params?.search?.trim();
    const sortBy = params?.sortBy ?? 'created_at';
    const sortOrder = params?.sortOrder ?? 'desc';
    const createdAfter = params?.createdAfter;
    const createdBefore = params?.createdBefore;

    let query = supabase
        .from('waste_logs')
        .select('*', { count: 'exact' });

    if (currentLabId) {
        query = query.eq('lab_id', currentLabId);
    } else {
        query = query.is('lab_id', null);
    }

    if (search && search.length > 0) {
        const escaped = search.replace(/[%_\\]/g, '\\$&');
        const pattern = `%${escaped}%`;
        query = query.or(
            `disposal_category.ilike.${pattern},handler_name.ilike.${pattern},memo.ilike.${pattern},stream_code.ilike.${pattern}`,
        );
    }

    if (createdAfter) query = query.gte('created_at', createdAfter);
    if (createdBefore) query = query.lte('created_at', createdBefore);

    const { data, error, count } = await query
        .order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false })
        .range(offset, offset + limit - 1);

    if (error) {
        const status = (error as { status?: number }).status;
        const code = (error as { code?: string }).code;
        if (status === 416 || code === 'PGRST103') {
            return {
                logs: [],
                count: typeof count === 'number' ? count : offset,
            };
        }

        console.error('Failed to fetch waste logs:', error);
        throw error;
    }

    return {
        logs: (data || []).map(normalizeWasteLogRow),
        count: count || 0,
    };
}

/**
 * Read the canonical component rows for one V2 waste log.
 *
 * The query deliberately targets only waste_log_items. Its database RLS policy
 * derives access from the parent waste log, so the client cannot widen scope by
 * supplying a different user or lab identifier.
 */
export async function fetchWasteLogItemsV2(wasteLogId: string): Promise<WasteLogItemRecord[]> {
    assertUuid(wasteLogId, 'wasteLogId');

    const { data, error } = await supabase
        .from('waste_log_items')
        .select([
            'id',
            'waste_log_id',
            'line_number',
            'cart_line_id',
            'source_type',
            'source_ref',
            'inventory_item_id',
            'cabinet_item_id',
            'chemical_name',
            'cas_number',
            'formula',
            'molecular_weight',
            'pubchem_cid',
            'kosha_chem_id',
            'identity_confidence',
            'ghs_data_status',
            'concentration_value',
            'concentration_unit',
            'solution_volume_value',
            'solution_volume_unit',
            'solution_volume_normalized_ml',
            'solution_volume_is_estimate',
            'concentration_basis',
            'density_value',
            'density_unit',
            'density_kind',
            'density_temperature_c',
            'density_source',
            'density_is_estimate',
            'ph_catalog_id',
            'hazard_flags',
            'data_sources',
            'analysis_snapshot',
            'created_at',
        ].join(','))
        .eq('waste_log_id', wasteLogId)
        .order('line_number', { ascending: true });

    if (error) {
        console.error('Failed to fetch V2 waste log items:', error);
        throw error;
    }

    return (data || []).map(normalizeWasteLogItemRow);
}
