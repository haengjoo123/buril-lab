import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WasteBatchDraft, WasteDecision } from '../types';

const mocks = vi.hoisted(() => ({
    rpc: vi.fn(),
    from: vi.fn(),
    labState: { currentLabId: '11111111-1111-4111-8111-111111111111' as string | null },
}));

vi.mock('./supabaseClient', () => ({
    supabase: {
        rpc: mocks.rpc,
        from: mocks.from,
    },
}));

vi.mock('../store/useLabStore', () => ({
    useLabStore: {
        getState: () => mocks.labState,
    },
}));

import {
    buildWastePhPredictionAuthorizationContext,
    buildWasteHandlingRpcPayload,
    fetchWasteLogById,
    fetchWasteLogItemsV2,
    isLegacyWasteLog,
    normalizeWasteLogItemRow,
    normalizeWasteLogRow,
    recordWasteHandlingV2,
    voidWasteLogV2,
} from './wasteLogService';

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const LOG_ID = '33333333-3333-4333-8333-333333333333';

function createBatch(): WasteBatchDraft {
    return {
        id: 'batch-1',
        scopeKey: `user-1:${mocks.labState.currentLabId}`,
        userId: 'user-1',
        labId: mocks.labState.currentLabId || undefined,
        components: [{
            chemical: {
                id: 'acetone',
                name: 'Acetone',
                casNumber: '67-64-1',
                molecularFormula: 'C3H6O',
                molecularWeight: 58.08,
                ghs: {
                    signal: 'Danger',
                    hazardStatements: ['H225: Highly flammable liquid and vapour'],
                },
            },
            category: 'ORGANIC_NON_HALOGEN',
            binColor: 'bg-orange-500',
            label: 'waste_organic_non_halogen',
            reason: 'organic_non_halogen',
            isSafe: true,
            cartLineId: 'line-1',
            sourceType: 'search',
            identityConfidence: 'verified',
            ghsDataStatus: 'verified',
            capturedAt: '2026-08-02T00:00:00.000Z',
            hazardFlags: ['FLAMMABLE'],
        }],
        matrix: 'organic_non_halogenated',
        matrixSource: 'user',
        totalAmount: {
            value: 500,
            unit: 'mL',
            normalizedValue: 500,
            normalizedUnit: 'mL',
            isApproximate: true,
            isUnknown: false,
        },
        measuredPhStatus: 'not_required',
        mixingState: 'unknown',
        additionalComponentsStatus: 'none',
        incidentContext: 'none',
        createdAt: '2026-08-02T00:00:00.000Z',
        updatedAt: '2026-08-02T00:01:00.000Z',
    };
}

function createDecision(): WasteDecision {
    return {
        decisionStatus: 'ready',
        streamCode: 'ORGANIC_NON_HALOGENATED',
        hazardFlags: ['FLAMMABLE'],
        allowedActions: ['container_deposit'],
        blockingReasons: [],
        missingFields: [],
        legalWastePhClass: 'unknown',
        corrosivityPhScreen: 'unknown',
        routingBasis: 'matrix',
        policyVersion: 'kr-default-2026.1',
        ruleVersion: '2.0.0',
    };
}

describe('wasteLogService V2 mutations', () => {
    beforeEach(() => {
        mocks.rpc.mockReset();
        mocks.from.mockReset();
        mocks.labState.currentLabId = '11111111-1111-4111-8111-111111111111';
    });

    it('builds the database camelCase payload without legacy direct-insert fields', () => {
        const batch = createBatch();
        batch.mixingState = 'already_mixed';
        batch.totalAmount.source = 'component_sum';
        batch.components[0].sourceSearchEventId = '55555555-5555-4555-8555-555555555555';
        batch.components[0].solutionContext = {
            physicalForm: 'organic_solvent',
            solventClass: 'organic_non_halogen',
            isSolventVerified: true,
            solventResolution: 'local_dictionary',
            solventCasNumber: '67-64-1',
        };
        const payload = buildWasteHandlingRpcPayload({
            batch,
            decision: createDecision(),
            handlingAction: 'container_deposit',
            memo: '  fume hood batch  ',
            confirmationSnapshot: { mixingState: 'already_mixed', alreadyMixed: true },
        });

        expect(payload).toMatchObject({
            handlingAction: 'container_deposit',
            decisionStatus: 'ready',
            streamCode: 'ORGANIC_NON_HALOGENATED',
            matrix: 'organic_non_halogenated',
            totalAmount: {
                value: 500,
                unit: 'mL',
                approximate: true,
                unknown: false,
            },
            decisionSnapshot: {
                legalWastePhClass: 'unknown',
                corrosivityPhScreen: 'unknown',
                routingBasis: 'matrix',
                policyVersion: 'kr-default-2026.1',
                ruleVersion: '2.0.0',
            },
            confirmationSnapshot: {
                batchId: 'batch-1',
                incidentContext: 'none',
                mixingState: 'already_mixed',
                alreadyMixed: true,
            },
            memo: 'fume hood batch',
        });
        expect(payload.components[0]).toMatchObject({
            cartLineId: 'line-1',
            chemicalName: 'Acetone',
            casNumber: '67-64-1',
            identityConfidence: 1,
            hazardFlags: ['FLAMMABLE'],
            pubchemCid: null,
            koshaChemId: null,
            analysisSnapshot: {
                sourceSearchEventId: '55555555-5555-4555-8555-555555555555',
                solutionContext: {
                    physicalForm: 'organic_solvent',
                    solventClass: 'organic_non_halogen',
                    isSolventVerified: true,
                    solventResolution: 'local_dictionary',
                    solventCasNumber: '67-64-1',
                },
            },
        });
        expect(payload.confirmationSnapshot).toHaveProperty('additionalComponentsStatus', 'none');
        expect(payload.totalAmount).not.toHaveProperty('source');
        expect(payload).not.toHaveProperty('handling_action');
        expect(payload).not.toHaveProperty('decision');
    });

    it('omits an unanswered additional-component status instead of serializing JSON null', () => {
        const batch = createBatch();
        delete batch.additionalComponentsStatus;

        const payload = buildWasteHandlingRpcPayload({
            batch,
            decision: createDecision(),
            handlingAction: 'container_deposit',
        });

        expect(payload.confirmationSnapshot).not.toHaveProperty('additionalComponentsStatus');
    });

    it('binds a predicted-pH authorization to the same normalized batch payload used for recording', () => {
        const batch = createBatch();
        batch.matrix = 'aqueous';
        batch.mixingState = 'already_mixed';
        batch.components[0].solutionVolume = {
            value: 100,
            unit: 'mL',
            normalizedMl: 100,
        };
        batch.components[0].concentration = { value: 0.1, unit: 'M' };
        batch.components[0].phCatalogId = 'usgs:acetate:acetic-acid';
        const context = buildWastePhPredictionAuthorizationContext(batch);
        const payload = buildWasteHandlingRpcPayload({
            batch,
            decision: {
                ...createDecision(),
                streamCode: 'AQUEOUS_OTHER',
                routingBasis: 'predicted_batch_ph',
            },
            handlingAction: 'container_deposit',
            confirmationSnapshot: {
                predictedPhAuthorizationId: '44444444-4444-4444-8444-444444444444',
            },
        });

        expect(context).toMatchObject({
            matrix: 'aqueous',
            totalAmount: { value: 500, unit: 'mL', approximate: true, unknown: false },
            confirmationSnapshot: {
                matrixSource: 'user',
                mixingState: 'already_mixed',
                additionalComponentsStatus: 'none',
                incidentContext: 'none',
            },
            components: [{
                cartLineId: 'line-1',
                analysisSnapshot: {
                    phPredictionInput: { phCatalogId: 'usgs:acetate:acetic-acid' },
                },
            }],
        });
        expect(payload.components).toEqual(context.components);
        expect(payload.confirmationSnapshot).toHaveProperty(
            'predictedPhAuthorizationId',
            '44444444-4444-4444-8444-444444444444',
        );
    });

    it('preserves a user-confirmed solution context in the audit snapshot', () => {
        const batch = createBatch();
        batch.components[0].solutionContext = {
            physicalForm: 'aqueous',
            solventClass: 'aqueous',
            solventName: 'Water',
            isSolventVerified: true,
            solventResolution: 'user',
            solventCasNumber: '7732-18-5',
            solventMolecularFormula: 'H2O',
        };
        const payload = buildWasteHandlingRpcPayload({
            batch,
            decision: createDecision(),
            handlingAction: 'container_deposit',
        });
        expect(payload.components[0]?.analysisSnapshot).toMatchObject({
            solutionContext: {
                physicalForm: 'aqueous',
                solventClass: 'aqueous',
                isSolventVerified: true,
                solventResolution: 'user',
                solventCasNumber: '7732-18-5',
            },
        });
    });

    it('serializes structured pH inputs and an informational prediction into the audited component envelope', () => {
        const batch = createBatch();
        batch.matrix = 'aqueous';
        batch.mixingState = 'already_mixed';
        batch.components[0].solutionVolume = {
            value: 0.1,
            unit: 'L',
            normalizedMl: 100,
        };
        batch.components[0].concentration = {
            value: 5,
            unit: '%',
            basis: 'w_w',
            density: {
                value: 1.006,
                unit: 'g/mL',
                kind: 'solution',
                temperatureC: 25,
                source: 'catalog',
            },
        };
        batch.components[0].phCatalogId = 'usgs:acetate:acetic-acid';

        const payload = buildWasteHandlingRpcPayload({
            batch,
            decision: createDecision(),
            handlingAction: 'container_deposit',
            phPredictionSnapshot: {
                origin: 'client_generated',
                capturedAt: '2026-08-04T12:00:00.000Z',
                status: 'approximate',
                value: 2.381,
                displayValue: 2.4,
                ionicStrength: 0.025,
                confidence: 'approximate',
                issueCodes: ['volume_additivity_assumed'],
                assumptions: ['aqueous_25c_closed_system'],
                modelVersion: 'buril-ph-1.0.0',
                catalogVersion: 'usgs-phreeqc-3.8.8-buril-1',
                inputHash: 'fnv1a:1234abcd',
            },
        });

        expect(payload.components[0].concentration).toEqual({ value: 5, unit: '%' });
        expect(payload.components[0].analysisSnapshot).toMatchObject({
            phPredictionInput: {
                solutionVolume: {
                    value: 0.1,
                    unit: 'L',
                    normalizedMl: 100,
                    isEstimate: false,
                },
                concentrationBasis: 'w_w',
                density: {
                    value: 1.006,
                    unit: 'g/mL',
                    kind: 'solution',
                    temperatureC: 25,
                    source: 'catalog',
                    isEstimate: false,
                },
                phCatalogId: 'usgs:acetate:acetic-acid',
            },
            phPredictionSnapshot: expect.objectContaining({
                origin: 'client_generated',
                status: 'approximate',
                value: 2.381,
            }),
        });
        expect(payload.confirmationSnapshot).not.toHaveProperty('phPredictionSnapshot');
    });

    it('keeps a failed non-authoritative pH prediction from invalidating the waste record payload', () => {
        const batch = createBatch();
        const payload = buildWasteHandlingRpcPayload({
            batch,
            decision: createDecision(),
            handlingAction: 'container_deposit',
            phPredictionSnapshot: {
                origin: 'client_generated',
                capturedAt: '2026-08-05T00:00:00.000Z',
                status: 'failed',
                confidence: 'unavailable',
                issueCodes: ['engine_error'],
                assumptions: [],
                modelVersion: 'unknown',
                catalogVersion: 'unknown',
                inputHash: 'fnv1a64:1234567890abcdef',
            },
        });

        expect(payload.components[0].analysisSnapshot).toMatchObject({
            phPredictionSnapshot: {
                status: 'failed',
                inputHash: 'fnv1a64:1234567890abcdef',
            },
        });
    });

    it('serializes the HF/fluoride compatible-container confirmation into the audited snapshot', () => {
        const batch = createBatch();
        batch.fluorideContainerStatus = 'compatible';
        batch.components[0].hazardFlags = ['HYDROFLUORIC_ACID'];
        const decision: WasteDecision = {
            ...createDecision(),
            streamCode: 'SPECIAL_REVIEW',
            hazardFlags: ['HYDROFLUORIC_ACID'],
        };

        const payload = buildWasteHandlingRpcPayload({
            batch,
            decision,
            handlingAction: 'container_deposit',
        });

        expect(payload.confirmationSnapshot).toHaveProperty(
            'fluorideContainerStatus',
            'compatible',
        );
        expect(payload.decisionSnapshot.hazardFlags).toEqual(['HYDROFLUORIC_ACID']);
    });

    it('uses record_waste_handling_v2 and preserves a retry request id', async () => {
        mocks.rpc.mockResolvedValue({
            data: {
                id: LOG_ID,
                createdAt: '2026-08-02T01:00:00.000Z',
                request_id: REQUEST_ID,
                schemaVersion: 2,
                recordOrigin: 'waste_batch',
                handlingAction: 'container_deposit',
                decisionStatus: 'ready',
                streamCode: 'ORGANIC_NON_HALOGENATED',
                streamSnapshot: {
                    streamCode: 'ORGANIC_NON_HALOGENATED',
                    displayNameKo: '비할로겐 유기용매 폐액',
                    displayNameEn: 'Non-halogenated organic waste',
                    containerLabel: '유기계 폐액통 A',
                    location: '폐기물 보관실',
                },
            },
            error: null,
        });
        const params = {
            batch: createBatch(),
            decision: createDecision(),
            handlingAction: 'container_deposit' as const,
            requestId: REQUEST_ID,
        };

        const first = await recordWasteHandlingV2(params);
        const retry = await recordWasteHandlingV2(params);

        expect(first).toMatchObject({
            id: LOG_ID,
            createdAt: '2026-08-02T01:00:00.000Z',
            requestId: REQUEST_ID,
            schemaVersion: 2,
        });
        expect(retry.requestId).toBe(REQUEST_ID);
        expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'record_waste_handling_v2', {
            p_request_id: REQUEST_ID,
            p_batch: expect.objectContaining({ handlingAction: 'container_deposit' }),
            p_lab_id: mocks.labState.currentLabId,
        });
        expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'record_waste_handling_v2', expect.objectContaining({
            p_request_id: REQUEST_ID,
        }));
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('rejects a container deposit when the deterministic decision is blocked', async () => {
        const blocked: WasteDecision = {
            ...createDecision(),
            decisionStatus: 'blocked',
            allowedActions: ['isolated', 'handover'],
            blockingReasons: [{
                code: 'dangerous_compatibility',
                messageKey: 'acid_cyanide',
            }],
        };

        await expect(recordWasteHandlingV2({
            batch: createBatch(),
            decision: blocked,
            handlingAction: 'container_deposit',
            requestId: REQUEST_ID,
        })).rejects.toThrow('not allowed');
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('uses the inventory-disposal transaction when a component is linked to inventory', async () => {
        const batch = createBatch();
        batch.components[0] = {
            ...batch.components[0],
            sourceType: 'inventory',
            sourceRef: '44444444-4444-4444-8444-444444444444',
            inventoryId: '44444444-4444-4444-8444-444444444444',
            inventoryDisposalQuantity: 2,
        };
        mocks.rpc.mockResolvedValue({
            data: {
                id: LOG_ID,
                createdAt: '2026-08-02T01:00:00.000Z',
                requestId: REQUEST_ID,
                schemaVersion: 2,
                recordOrigin: 'inventory_disposal',
                handlingAction: 'container_deposit',
                decisionStatus: 'ready',
                streamCode: 'ORGANIC_NON_HALOGENATED',
                streamSnapshot: {
                    streamCode: 'ORGANIC_NON_HALOGENATED',
                    displayNameKo: '비할로겐 유기용매 폐액',
                    displayNameEn: 'Non-halogenated organic waste',
                    containerLabel: '유기계 폐액통 A',
                    location: '폐기물 보관실',
                },
                removed_count: 1,
                removed_items: [{
                    item_id: '44444444-4444-4444-8444-444444444444',
                    item_source: 'inventory',
                    quantity_to_remove: 2,
                }],
            },
            error: null,
        });

        await recordWasteHandlingV2({
            batch,
            decision: createDecision(),
            handlingAction: 'container_deposit',
            requestId: REQUEST_ID,
        });

        expect(mocks.rpc).toHaveBeenCalledWith('record_inventory_disposal_v2', {
            p_request_id: REQUEST_ID,
            p_items: [{
                item_id: '44444444-4444-4444-8444-444444444444',
                item_source: 'inventory',
                quantity_to_remove: 2,
            }],
            p_batch: expect.objectContaining({
                components: [expect.objectContaining({
                    inventoryItemId: '44444444-4444-4444-8444-444444444444',
                })],
            }),
            p_lab_id: mocks.labState.currentLabId,
            p_actor_name: null,
        });
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('rejects an inventory-disposal receipt that does not cover every requested record', async () => {
        const batch = createBatch();
        batch.components[0] = {
            ...batch.components[0],
            sourceType: 'inventory',
            inventoryId: '44444444-4444-4444-8444-444444444444',
            inventoryDisposalQuantity: 1,
        };
        mocks.rpc.mockResolvedValue({
            data: {
                id: LOG_ID,
                createdAt: '2026-08-02T01:00:00.000Z',
                requestId: REQUEST_ID,
                schemaVersion: 2,
                recordOrigin: 'inventory_disposal',
                handlingAction: 'container_deposit',
                decisionStatus: 'ready',
                streamCode: 'ORGANIC_NON_HALOGENATED',
                streamSnapshot: {
                    streamCode: 'ORGANIC_NON_HALOGENATED',
                    displayNameKo: '비할로겐 유기용매 폐액',
                    displayNameEn: 'Non-halogenated organic waste',
                    containerLabel: '유기폐액통 A',
                    location: '폐기물 보관실',
                },
                removed_count: 0,
                removed_items: [],
            },
            error: null,
        });

        await expect(recordWasteHandlingV2({
            batch,
            decision: createDecision(),
            handlingAction: 'container_deposit',
            requestId: REQUEST_ID,
        })).rejects.toThrow('invalid atomic receipt');
    });

    it('rejects a base receipt that reports a different decision or stream', async () => {
        mocks.rpc.mockResolvedValue({
            data: {
                id: LOG_ID,
                createdAt: '2026-08-02T01:00:00.000Z',
                requestId: REQUEST_ID,
                schemaVersion: 2,
                recordOrigin: 'waste_batch',
                handlingAction: 'container_deposit',
                decisionStatus: 'blocked',
                streamCode: 'SPECIAL_REVIEW',
            },
            error: null,
        });

        await expect(recordWasteHandlingV2({
            batch: createBatch(),
            decision: createDecision(),
            handlingAction: 'container_deposit',
            requestId: REQUEST_ID,
        })).rejects.toThrow('invalid receipt');
    });

    it('requires an explicit disposal count for grouped inventory before any RPC', async () => {
        const batch = createBatch();
        batch.components[0] = {
            ...batch.components[0],
            sourceType: 'inventory',
            inventoryId: '44444444-4444-4444-8444-444444444444',
            inventorySnapshot: { quantity: 10 },
            inventoryDisposalQuantity: undefined,
        };

        await expect(recordWasteHandlingV2({
            batch,
            decision: createDecision(),
            handlingAction: 'container_deposit',
            requestId: REQUEST_ID,
        })).rejects.toThrow('inventory disposal quantity');
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('rejects a disposal count above the linked inventory snapshot before any RPC', async () => {
        const batch = createBatch();
        batch.components[0] = {
            ...batch.components[0],
            sourceType: 'inventory',
            inventoryId: '44444444-4444-4444-8444-444444444444',
            inventorySnapshot: { quantity: 2 },
            inventoryDisposalQuantity: 3,
        };

        await expect(recordWasteHandlingV2({
            batch,
            decision: createDecision(),
            handlingAction: 'container_deposit',
            requestId: REQUEST_ID,
        })).rejects.toThrow('exceeds the available inventory quantity');
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('voids through RPC, trims the reason and never deletes the row directly', async () => {
        mocks.rpc.mockResolvedValue({
            data: {
                id: LOG_ID,
                voidedAt: '2026-08-02T01:10:00.000Z',
                voidedBy: 'user-1',
                voidReason: '잘못 기록함',
            },
            error: null,
        });

        const receipt = await voidWasteLogV2(LOG_ID, '  잘못   기록함  ');

        expect(mocks.rpc).toHaveBeenCalledWith('void_waste_log_v2', {
            p_waste_log_id: LOG_ID,
            p_reason: '잘못 기록함',
        });
        expect(receipt).toEqual({
            id: LOG_ID,
            voidedAt: '2026-08-02T01:10:00.000Z',
            voidedBy: 'user-1',
            reason: '잘못 기록함',
        });
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('rejects an incomplete correction receipt instead of assuming the requested record was voided', async () => {
        mocks.rpc.mockResolvedValue({
            data: { id: LOG_ID, idempotent: false },
            error: null,
        });

        await expect(voidWasteLogV2(LOG_ID, '잘못 기록함')).rejects.toThrow(
            'correction RPC returned an invalid receipt',
        );
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('normalizes legacy rows without assigning a V2 classification', () => {
        const legacy = normalizeWasteLogRow({
            id: LOG_ID,
            created_at: '2026-01-01T00:00:00.000Z',
            chemicals: [],
            disposal_category: '기타 기록',
            schema_version: 1,
        });

        expect(legacy.decision_status).toBe('legacy_unverified');
        expect(isLegacyWasteLog(legacy)).toBe(true);

        const v2 = normalizeWasteLogRow({
            ...legacy,
            schema_version: 2,
            decision_status: 'ready',
            stream_code: 'AQUEOUS_OTHER',
            total_amount_value: '250',
            total_amount_unit: 'mL',
            confirmation_snapshot: { measuredBatchPh: 7.1 },
            ph_prediction_snapshot: {
                status: 'available',
                displayValue: 7.2,
                modelVersion: 'buril-ph-1.0.0',
            },
        });
        expect(v2.decision_status).toBe('ready');
        expect(v2.total_amount_value).toBe(250);
        expect(v2.confirmation_snapshot).toEqual({ measuredBatchPh: 7.1 });
        expect(v2.ph_prediction_snapshot).toMatchObject({ status: 'available', displayValue: 7.2 });
        expect(isLegacyWasteLog(v2)).toBe(false);
    });

    it('reads canonical V2 component rows in line order through the RLS-scoped table', async () => {
        const order = vi.fn().mockResolvedValue({
            data: [{
                id: '55555555-5555-4555-8555-555555555555',
                waste_log_id: LOG_ID,
                line_number: 1,
                cart_line_id: 'line-1',
                source_type: 'inventory',
                source_ref: 'inventory-ref',
                source_search_event_id: '66666666-6666-4666-8666-666666666666',
                inventory_item_id: '44444444-4444-4444-8444-444444444444',
                cabinet_item_id: null,
                chemical_name: 'Acetone',
                cas_number: '67-64-1',
                formula: 'C3H6O',
                molecular_weight: '58.08',
                pubchem_cid: '180',
                kosha_chem_id: '1234',
                identity_confidence: '1',
                ghs_data_status: 'verified',
                concentration_value: '10',
                concentration_unit: '%',
                solution_volume_value: '0.1',
                solution_volume_unit: 'L',
                solution_volume_normalized_ml: '100',
                solution_volume_is_estimate: false,
                concentration_basis: 'w_w',
                density_value: '1.006',
                density_unit: 'g/mL',
                density_kind: 'solution',
                density_temperature_c: '25',
                density_source: 'catalog',
                density_is_estimate: false,
                ph_catalog_id: 'usgs:acetate:acetic-acid',
                hazard_flags: ['FLAMMABLE', 'NOT_A_SCHEMA_FLAG'],
                data_sources: [{
                    sourceType: 'inventory',
                    sourceRef: 'inventory-ref',
                    capturedAt: '2026-08-02T00:00:00.000Z',
                }],
                analysis_snapshot: {
                    category: 'ORGANIC_NON_HALOGEN',
                    reason: 'organic_non_halogen',
                },
                created_at: '2026-08-02T01:00:00.000Z',
            }],
            error: null,
        });
        const eq = vi.fn().mockReturnValue({ order });
        const select = vi.fn().mockReturnValue({ eq });
        mocks.from.mockReturnValue({ select });

        const rows = await fetchWasteLogItemsV2(LOG_ID);

        expect(mocks.from).toHaveBeenCalledWith('waste_log_items');
        expect(eq).toHaveBeenCalledWith('waste_log_id', LOG_ID);
        expect(order).toHaveBeenCalledWith('line_number', { ascending: true });
        expect(rows).toEqual([expect.objectContaining({
            wasteLogId: LOG_ID,
            sourceSearchEventId: '66666666-6666-4666-8666-666666666666',
            lineNumber: 1,
            chemicalName: 'Acetone',
            casNumber: '67-64-1',
            molecularWeight: 58.08,
            pubchemCid: 180,
            concentrationValue: 10,
            concentrationUnit: '%',
            solutionVolumeValue: 0.1,
            solutionVolumeUnit: 'L',
            solutionVolumeNormalizedMl: 100,
            concentrationBasis: 'w_w',
            densityValue: 1.006,
            densityKind: 'solution',
            densityTemperatureC: 25,
            densitySource: 'catalog',
            phCatalogId: 'usgs:acetate:acetic-acid',
            hazardFlags: ['FLAMMABLE'],
            dataSources: [{
                sourceType: 'inventory',
                sourceRef: 'inventory-ref',
                capturedAt: '2026-08-02T00:00:00.000Z',
            }],
        })]);
    });

    it('fetches an old direct-link record by id inside the active lab scope', async () => {
        const maybeSingle = vi.fn().mockResolvedValue({
            data: {
                id: LOG_ID,
                lab_id: mocks.labState.currentLabId,
                user_id: '77777777-7777-4777-8777-777777777777',
                chemicals: [],
                disposal_category: 'SPECIAL_HAZARD',
                handler_name: 'Recovery verifier',
                created_at: '2025-01-01T00:00:00.000Z',
            },
            error: null,
        });
        const labEq = vi.fn().mockReturnValue({ maybeSingle });
        const idEq = vi.fn().mockReturnValue({ eq: labEq });
        const select = vi.fn().mockReturnValue({ eq: idEq });
        mocks.from.mockReturnValue({ select });

        const row = await fetchWasteLogById(LOG_ID);

        expect(mocks.from).toHaveBeenCalledWith('waste_logs');
        expect(idEq).toHaveBeenCalledWith('id', LOG_ID);
        expect(labEq).toHaveBeenCalledWith('lab_id', mocks.labState.currentLabId);
        expect(maybeSingle).toHaveBeenCalledOnce();
        expect(row).toMatchObject({ id: LOG_ID, disposal_category: 'SPECIAL_HAZARD' });
    });

    it('rejects an invalid direct-link id before issuing a table query', async () => {
        await expect(fetchWasteLogById('not-a-uuid')).rejects.toThrow('valid UUID');
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('rejects an invalid V2 log id before issuing a table query', async () => {
        await expect(fetchWasteLogItemsV2('not-a-uuid')).rejects.toThrow('valid UUID');
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('normalizes malformed optional V2 item evidence to safe empty values', () => {
        const item = normalizeWasteLogItemRow({
            id: '55555555-5555-4555-8555-555555555555',
            waste_log_id: LOG_ID,
            line_number: 2,
            cart_line_id: 'line-2',
            source_type: 'unexpected',
            chemical_name: 'Unknown sample',
            hazard_flags: 'FLAMMABLE',
            data_sources: [{ sourceRef: 'missing-type' }],
            analysis_snapshot: [],
        });

        expect(item).toMatchObject({
            sourceType: 'search',
            hazardFlags: [],
            dataSources: [],
            analysisSnapshot: {},
            concentrationValue: null,
            concentrationUnit: null,
        });
    });
});
