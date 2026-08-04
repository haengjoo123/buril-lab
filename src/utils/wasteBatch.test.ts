import { describe, expect, it } from 'vitest';
import type {
    AnalysisResult,
    DisposalCategory,
    WasteAmount,
    WasteBatchDraft,
    WasteMatrix,
} from '../types';
import {
    analyzeWasteBatch,
    createEmptyWasteBatch,
    createWasteComponentFromAnalysis,
    getAllowedAmountUnits,
    inferWasteMatrixFromComponent,
    inferWasteMatrixFromComponents,
    normalizeWasteAmount,
    validateWasteAmount,
} from './wasteBatch';

function analysis(
    name: string,
    formula: string,
    category: DisposalCategory,
    options: {
        hCodes?: string[];
        signal?: string;
        isOrganic?: boolean;
        isHalogenated?: boolean;
        referencePh?: number;
    } = {},
): AnalysisResult {
    return {
        chemical: {
            id: name,
            name,
            casNumber: '7732-18-5',
            molecularFormula: formula,
            properties: {
                isOrganic: options.isOrganic ?? false,
                isHalogenated: options.isHalogenated ?? false,
                referencePh: options.referencePh,
            },
            ghs: {
                signal: options.signal ?? 'Warning',
                hazardStatements: options.hCodes ?? [],
            },
        },
        category,
        binColor: 'bg-gray-400',
        label: category,
        reason: category,
        isSafe: category !== 'UNKNOWN',
    };
}

function knownAmount(value: number, unit: 'mL' | 'L' | 'mg' | 'g'): WasteAmount {
    const normalized = normalizeWasteAmount(value, unit);
    if (!normalized) throw new Error('test amount must be valid');
    return {
        value,
        unit,
        ...normalized,
        isApproximate: false,
        isUnknown: false,
    };
}

function batch(
    inputs: AnalysisResult[],
    matrix: WasteMatrix,
    amount = knownAmount(500, matrix === 'solid_slurry' ? 'g' : 'mL'),
): WasteBatchDraft {
    return {
        ...createEmptyWasteBatch({ id: 'batch-1', now: '2026-08-02T00:00:00.000Z' }),
        components: inputs.map((input, index) =>
            createWasteComponentFromAnalysis(input, { cartLineId: `line-${index}` })
        ),
        matrix,
        matrixSource: 'user',
        totalAmount: amount,
        measuredPhStatus: matrix === 'aqueous' ? 'unknown' : 'not_required',
    };
}

describe('analyzeWasteBatch', () => {
    it('auto-infers only strong matrix evidence and leaves ambiguous acids unresolved', () => {
        const acetone = createWasteComponentFromAnalysis(
            analysis('Acetone', 'C3H6O', 'ORGANIC_NON_HALOGEN', { isOrganic: true }),
        );
        acetone.chemical.casNumber = '67-64-1';
        expect(inferWasteMatrixFromComponent(acetone)).toBe('organic_non_halogenated');

        const dcm = createWasteComponentFromAnalysis(
            analysis('Dichloromethane', 'CH2Cl2', 'ORGANIC_HALOGEN', { isOrganic: true }),
        );
        dcm.chemical.casNumber = '75-09-2';
        expect(inferWasteMatrixFromComponent(dcm)).toBe('organic_halogenated');

        const acid = createWasteComponentFromAnalysis(
            analysis('Hydrochloric acid', 'HCl', 'ACID'),
        );
        expect(inferWasteMatrixFromComponent(acid)).toBeNull();
    });

    it('recomputes automatic matrix evidence without keeping an unsafe stale solvent default', () => {
        const acetone = createWasteComponentFromAnalysis(
            analysis('Acetone', 'C3H6O', 'ORGANIC_NON_HALOGEN', { isOrganic: true }),
        );
        acetone.chemical.casNumber = '67-64-1';
        const dcm = createWasteComponentFromAnalysis(
            analysis('Dichloromethane', 'CH2Cl2', 'ORGANIC_HALOGEN', { isOrganic: true }),
        );
        dcm.chemical.casNumber = '75-09-2';
        const water = createWasteComponentFromAnalysis(
            analysis('Water', 'H2O', 'NEUTRAL'),
        );
        water.chemical.casNumber = '7732-18-5';
        const solid = createWasteComponentFromAnalysis(
            analysis('Contaminated absorbent', '', 'SOLID_WASTE'),
        );

        expect(inferWasteMatrixFromComponents([acetone, dcm])).toBe('organic_halogenated');
        expect(inferWasteMatrixFromComponents([water, acetone])).toBe('mixed_biphasic');
        expect(inferWasteMatrixFromComponents([solid, acetone])).toBeNull();
    });

    it('preserves legacy cart fields while migrating an existing draft', () => {
        const legacy = {
            ...analysis('Acetone', 'C3H6O', 'ORGANIC_NON_HALOGEN'),
            volume: '500 mL',
            molarity: '0.1 M',
            solutionContext: {
                physicalForm: 'organic_solvent' as const,
                solventClass: 'organic_non_halogen' as const,
            },
        };

        const component = createWasteComponentFromAnalysis(legacy);

        expect(component.volume).toBe('500 mL');
        expect(component.molarity).toBe('0.1 M');
        expect(component.solutionContext?.solventClass).toBe('organic_non_halogen');
    });

    it('requires identity confirmation for AI-estimated or CAS-unverified results', () => {
        const aiEstimated = analysis('Estimated substance', 'C2H6O', 'ORGANIC_NON_HALOGEN');
        aiEstimated.isAiEstimated = true;
        const aiComponent = createWasteComponentFromAnalysis(aiEstimated);
        expect(aiComponent.identityConfidence).toBe('review_required');

        const invalidCas = analysis('Unverified substance', 'C2H6O', 'ORGANIC_NON_HALOGEN');
        invalidCas.chemical.casNumber = '123-45-6';
        const invalidComponent = createWasteComponentFromAnalysis(invalidCas);
        expect(invalidComponent.identityConfidence).toBe('review_required');
    });

    it('does not interpret an unavailable hazard lookup as no hazard', () => {
        const withoutGhs = analysis('Known solvent', 'C2H6O', 'ORGANIC_NON_HALOGEN');
        withoutGhs.chemical.ghs = undefined;
        const draft = batch([withoutGhs], 'organic_non_halogenated');

        const unresolved = analyzeWasteBatch(draft);
        expect(unresolved.decisionStatus).toBe('needs_input');
        expect(unresolved.missingFields).toContain('hazard_data');

        draft.components[0].hazardDataConfirmedByUser = true;
        const confirmed = analyzeWasteBatch(draft);
        expect(confirmed.missingFields).not.toContain('hazard_data');
        expect(confirmed.decisionStatus).toBe('ready');
        expect(draft.components[0].ghsDataStatus).toBe('lookup_failed');
    });

    it('blocks acid + sodium cyanide and permits only isolation or handover', () => {
        const draft = batch([
            analysis('Hydrochloric acid', 'HCl', 'ACID'),
            analysis('Sodium cyanide', 'NaCN', 'CYANIDE'),
        ], 'aqueous');
        draft.measuredBatchPh = 7;
        draft.measuredPhStatus = 'measured';
        const decision = analyzeWasteBatch(draft);

        expect(decision.decisionStatus).toBe('blocked');
        expect(decision.streamCode).toBe('CYANIDE_SULFIDE');
        expect(decision.allowedActions).toEqual(['isolated', 'handover']);
        expect(decision.blockingReasons).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'dangerous_compatibility',
                ruleId: 'acid_cyanide',
            }),
        ]));
        expect(decision.blockingReasons.some(({ ruleId }) => ruleId === 'acid_metal')).toBe(false);
    });

    it('requires an explicit mixing state before handling acidic and alkaline aqueous components', () => {
        const draft = batch([
            analysis('Hydrochloric acid', 'HCl', 'ACID'),
            analysis('Sodium hydroxide', 'NaOH', 'ALKALI'),
        ], 'aqueous');

        const unknownState = analyzeWasteBatch(draft);
        expect(unknownState.decisionStatus).toBe('needs_input');
        expect(unknownState.streamCode).toBe('SPECIAL_REVIEW');
        expect(unknownState.missingFields).toContain('mixing_state');

        draft.mixingState = 'separate';
        const separate = analyzeWasteBatch(draft);
        expect(separate.decisionStatus).toBe('blocked');
        expect(separate.allowedActions).toEqual(['isolated', 'handover']);
        expect(separate.blockingReasons).toContainEqual(expect.objectContaining({
            code: 'acid_alkali_separate',
        }));

        draft.mixingState = 'already_mixed';
        const alreadyMixed = analyzeWasteBatch(draft);
        expect(alreadyMixed.decisionStatus).toBe('needs_input');
        expect(alreadyMixed.missingFields).toContain('measured_ph');
    });

    it('requires the mixing state for acid/alkali in every matrix and escalates an already-mixed non-aqueous batch', () => {
        const draft = batch([
            analysis('Hydrochloric acid', 'HCl', 'ACID'),
            analysis('Sodium hydroxide', 'NaOH', 'ALKALI'),
        ], 'mixed_biphasic');

        const unknownState = analyzeWasteBatch(draft);
        expect(unknownState.decisionStatus).toBe('needs_input');
        expect(unknownState.streamCode).toBe('SPECIAL_REVIEW');
        expect(unknownState.missingFields).toContain('mixing_state');

        draft.mixingState = 'separate';
        expect(analyzeWasteBatch(draft).blockingReasons).toContainEqual(
            expect.objectContaining({ code: 'acid_alkali_separate' }),
        );

        draft.mixingState = 'already_mixed';
        draft.measuredBatchPh = 7;
        draft.measuredPhStatus = 'measured';
        const alreadyMixed = analyzeWasteBatch(draft);
        expect(alreadyMixed.decisionStatus).toBe('blocked');
        expect(alreadyMixed.streamCode).toBe('SPECIAL_REVIEW');
        expect(alreadyMixed.blockingReasons).toContainEqual(expect.objectContaining({
            code: 'acid_alkali_non_aqueous_mixed',
        }));
        expect(alreadyMixed.missingFields).not.toContain('measured_ph');
        expect(alreadyMixed.legalWastePhClass).toBe('unknown');
        expect(alreadyMixed.corrosivityPhScreen).toBe('unknown');
        expect(alreadyMixed.routingBasis).toBe('special_rule');
    });

    it.each([
        [2, 'ACID_AQUEOUS', 'waste_acid', 'review_required'],
        [2.01, 'AQUEOUS_OTHER', 'none', 'not_indicated'],
        [7, 'AQUEOUS_OTHER', 'none', 'not_indicated'],
        [11, 'AQUEOUS_OTHER', 'none', 'not_indicated'],
        [11.5, 'AQUEOUS_OTHER', 'none', 'review_required'],
        [12.49, 'AQUEOUS_OTHER', 'none', 'review_required'],
        [12.5, 'ALKALI_AQUEOUS', 'waste_alkali', 'review_required'],
    ] as const)(
        'routes an already-mixed acid/alkali batch at measured pH %s',
        (measuredBatchPh, streamCode, legalWastePhClass, corrosivityPhScreen) => {
            const draft = batch([
                analysis('Hydrochloric acid', 'HCl', 'ACID'),
                analysis('Sodium hydroxide', 'NaOH', 'ALKALI'),
            ], 'aqueous');
            draft.mixingState = 'already_mixed';
            draft.measuredBatchPh = measuredBatchPh;
            draft.measuredPhStatus = 'measured';

            const decision = analyzeWasteBatch(draft);

            expect(decision.decisionStatus).toBe('ready');
            expect(decision.streamCode).toBe(streamCode);
            expect(decision.legalWastePhClass).toBe(legalWastePhClass);
            expect(decision.corrosivityPhScreen).toBe(corrosivityPhScreen);
            expect(decision.routingBasis).toBe('measured_batch_ph');
        },
    );

    it('uses reference pH only as a conservative mixing warning, never as a single-component route', () => {
        const referenceAcid = analysis('Reference-only acidic material', 'X', 'NEUTRAL', {
            referencePh: 3,
        });
        const referenceAlkali = analysis('Reference-only alkaline material', 'Y', 'NEUTRAL', {
            referencePh: 11,
        });

        const singleDecision = analyzeWasteBatch(batch([referenceAcid], 'aqueous'));
        expect(singleDecision.streamCode).toBe('AQUEOUS_OTHER');
        expect(singleDecision.routingBasis).toBe('matrix');

        const mixedDraft = batch([referenceAcid, referenceAlkali], 'aqueous');
        expect(analyzeWasteBatch(mixedDraft).missingFields).toContain('mixing_state');
        mixedDraft.mixingState = 'already_mixed';
        mixedDraft.measuredBatchPh = 7;
        mixedDraft.measuredPhStatus = 'measured';
        expect(analyzeWasteBatch(mixedDraft).streamCode).toBe('AQUEOUS_OTHER');
    });

    it('always blocks broken-container and leak-response batches from ordinary deposit', () => {
        for (const incidentContext of ['broken', 'leak'] as const) {
            const draft = batch([
                analysis('Low-hazard test material', 'H2O', 'NEUTRAL'),
            ], incidentContext === 'broken' ? 'solid_slurry' : 'aqueous');
            draft.incidentContext = incidentContext;

            const decision = analyzeWasteBatch(draft);

            expect(decision.decisionStatus).toBe('blocked');
            expect(decision.streamCode).toBe('SPECIAL_REVIEW');
            expect(decision.allowedActions).toEqual(['isolated', 'handover']);
            expect(decision.blockingReasons).toEqual(expect.arrayContaining([
                expect.objectContaining({ code: 'incident_response' }),
            ]));
        }
    });

    it('keeps acetone ready in a non-halogenated organic matrix', () => {
        const decision = analyzeWasteBatch(batch([
            analysis('Acetone', 'C3H6O', 'ORGANIC_NON_HALOGEN', {
                hCodes: ['H225'],
                signal: 'Danger',
                isOrganic: true,
            }),
        ], 'organic_non_halogenated'));

        expect(decision.decisionStatus).toBe('ready');
        expect(decision.streamCode).toBe('ORGANIC_NON_HALOGENATED');
        expect(decision.hazardFlags).toContain('FLAMMABLE');
        expect(decision.allowedActions).toEqual(['container_deposit']);
    });

    it('routes HF to special review and requires an approved compatible container', () => {
        const hydrofluoricAcid = analysis('Hydrofluoric acid', 'HF', 'ACID', {
            hCodes: ['H300', 'H310', 'H330', 'H314'],
            signal: 'Danger',
        });
        hydrofluoricAcid.chemical.casNumber = '7664-39-3';
        const draft = batch([hydrofluoricAcid], 'aqueous');

        const unanswered = analyzeWasteBatch(draft);
        expect(unanswered).toMatchObject({
            decisionStatus: 'needs_input',
            streamCode: 'SPECIAL_REVIEW',
        });
        expect(unanswered.hazardFlags).toContain('HYDROFLUORIC_ACID');
        expect(unanswered.missingFields).toContain('fluoride_container');

        draft.fluorideContainerStatus = 'compatible';
        const compatible = analyzeWasteBatch(draft);
        expect(compatible.decisionStatus).toBe('ready');
        expect(compatible.allowedActions).toEqual(['container_deposit']);

        draft.fluorideContainerStatus = 'incompatible';
        const incompatible = analyzeWasteBatch(draft);
        expect(incompatible.decisionStatus).toBe('blocked');
        expect(incompatible.allowedActions).toEqual(['isolated', 'handover']);
        expect(incompatible.blockingReasons).toContainEqual(expect.objectContaining({
            code: 'hf_fluoride_incompatible_container',
        }));
    });

    it('flags explicit fluoride compounds without treating every fluoro-organic name as free fluoride', () => {
        const ammoniumFluoride = analysis('Ammonium fluoride', 'NH4F', 'NEUTRAL');
        ammoniumFluoride.chemical.casNumber = '12125-01-8';
        const fluorideDecision = analyzeWasteBatch(batch([ammoniumFluoride], 'aqueous'));
        expect(fluorideDecision.hazardFlags).toContain('FLUORIDE');
        expect(fluorideDecision.missingFields).toContain('fluoride_container');

        const tfa = analysis('Trifluoroacetic acid', 'C2HF3O2', 'ACID');
        tfa.chemical.casNumber = '76-05-1';
        const tfaDecision = analyzeWasteBatch(batch([tfa], 'aqueous'));
        expect(tfaDecision.hazardFlags).not.toContain('FLUORIDE');
        expect(tfaDecision.hazardFlags).not.toContain('HYDROFLUORIC_ACID');
        expect(tfaDecision.missingFields).not.toContain('fluoride_container');
    });

    it('allows deposit from the active policy category without local container metadata', () => {
        const decision = analyzeWasteBatch(batch([
            analysis('Acetone', 'C3H6O', 'ORGANIC_NON_HALOGEN', {
                hCodes: ['H225'],
                isOrganic: true,
            }),
        ], 'organic_non_halogenated'), {
            policy: {
                streamAvailable: true,
                allowedHazardFlags: [],
                blockedHazardFlags: [],
            },
        });

        expect(decision.decisionStatus).toBe('ready');
        expect(decision.missingFields).not.toContain('policy_destination');
        expect(decision.allowedActions).toEqual(['container_deposit']);
    });

    it('enforces policy blocked and allowed hazard flags', () => {
        const acetoneBatch = batch([
            analysis('Acetone', 'C3H6O', 'ORGANIC_NON_HALOGEN', {
                hCodes: ['H225'],
                isOrganic: true,
            }),
        ], 'organic_non_halogenated');

        const explicitlyBlocked = analyzeWasteBatch(acetoneBatch, {
            policy: {
                streamAvailable: true,
                allowedHazardFlags: [],
                blockedHazardFlags: ['FLAMMABLE'],
            },
        });
        expect(explicitlyBlocked.decisionStatus).toBe('blocked');
        expect(explicitlyBlocked.blockingReasons).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'policy_blocked_hazard' }),
        ]));

        const outsideAllowList = analyzeWasteBatch(acetoneBatch, {
            policy: {
                streamAvailable: true,
                allowedHazardFlags: ['CORROSIVE'],
                blockedHazardFlags: [],
            },
        });
        expect(outsideAllowList.decisionStatus).toBe('blocked');
        expect(outsideAllowList.blockingReasons).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'policy_disallowed_hazard' }),
        ]));

        const explicitlyAllowed = analyzeWasteBatch(acetoneBatch, {
            policy: {
                streamAvailable: true,
                allowedHazardFlags: ['FLAMMABLE'],
                blockedHazardFlags: [],
            },
        });
        expect(explicitlyAllowed.decisionStatus).toBe('ready');
    });

    it('does not block a chemical for the GHS Danger signal word alone', () => {
        const decision = analyzeWasteBatch(batch([
            analysis('Known organic solvent', 'C4H10O', 'ORGANIC_NON_HALOGEN', {
                signal: 'Danger',
                isOrganic: true,
            }),
        ], 'organic_non_halogenated'));

        expect(decision.decisionStatus).toBe('ready');
        expect(decision.blockingReasons).toEqual([]);
    });

    it('routes DCM to the halogenated stream', () => {
        const decision = analyzeWasteBatch(batch([
            analysis('Dichloromethane', 'CH2Cl2', 'ORGANIC_HALOGEN', {
                hCodes: ['H351'],
                isOrganic: true,
                isHalogenated: true,
            }),
        ], 'organic_halogenated'));

        expect(decision.decisionStatus).toBe('ready');
        expect(decision.streamCode).toBe('ORGANIC_HALOGENATED');
        expect(decision.hazardFlags).toContain('CMR');
    });

    it('does not let an organic matrix downgrade heavy-metal waste', () => {
        const decision = analyzeWasteBatch(batch([
            analysis('Copper sulfate', 'CuSO4', 'HEAVY_METAL'),
        ], 'organic_non_halogenated'));

        expect(decision.streamCode).toBe('HEAVY_METAL');
        expect(decision.hazardFlags).toContain('HEAVY_METAL');
    });

    it('blocks oxidizer + flammable instead of merely recommending an organic bin', () => {
        const decision = analyzeWasteBatch(batch([
            analysis('Hydrogen peroxide', 'H2O2', 'NEUTRAL', { hCodes: ['H271'] }),
            analysis('Acetone', 'C3H6O', 'ORGANIC_NON_HALOGEN', {
                hCodes: ['H225'],
                isOrganic: true,
            }),
        ], 'organic_non_halogenated'));

        expect(decision.decisionStatus).toBe('blocked');
        expect(decision.blockingReasons).toEqual(expect.arrayContaining([
            expect.objectContaining({ ruleId: 'oxidizer_flammable' }),
        ]));
    });

    it('requests only missing batch-level information', () => {
        const draft = createEmptyWasteBatch({ id: 'empty' });
        const decision = analyzeWasteBatch(draft);

        expect(decision.decisionStatus).toBe('needs_input');
        expect(decision.missingFields).toEqual(expect.arrayContaining([
            'components',
            'matrix',
            'total_amount',
        ]));
    });

    it('keeps an unknown extra component as missing when it changes mixed-phase classification', () => {
        const draft = batch([
            analysis('Known aqueous component', 'H2O', 'NEUTRAL'),
        ], 'mixed_biphasic');
        draft.additionalComponentsStatus = 'unknown';

        const decision = analyzeWasteBatch(draft);

        expect(decision.decisionStatus).toBe('needs_input');
        expect(decision.missingFields).toContain('additional_components');

        draft.additionalComponentsStatus = 'none';
        expect(analyzeWasteBatch(draft).missingFields).not.toContain('additional_components');
    });

    it('keeps an explicitly present but not-yet-added component pending for every matrix', () => {
        const draft = batch([
            analysis('Acetone', 'C3H6O', 'ORGANIC_NON_HALOGEN', {
                hCodes: ['H225'],
                isOrganic: true,
            }),
        ], 'organic_non_halogenated');
        draft.additionalComponentsStatus = 'present';

        expect(analyzeWasteBatch(draft).missingFields).toContain('additional_components');
    });

    it('requires a valid container count only for linked grouped inventory', () => {
        const draft = batch([
            analysis('Acetone', 'C3H6O', 'ORGANIC_NON_HALOGEN', {
                hCodes: ['H225'],
                isOrganic: true,
            }),
        ], 'organic_non_halogenated');
        draft.components[0] = {
            ...draft.components[0],
            sourceType: 'inventory',
            inventoryId: 'inventory-1',
            inventorySnapshot: { quantity: 10 },
        };

        expect(analyzeWasteBatch(draft).missingFields).toContain('inventory_quantity');

        draft.components[0].inventoryDisposalQuantity = 1;
        expect(analyzeWasteBatch(draft).missingFields).not.toContain('inventory_quantity');

        draft.components[0].inventoryDisposalQuantity = 11;
        expect(analyzeWasteBatch(draft).missingFields).toContain('inventory_quantity');
    });
});

describe('waste amount validation', () => {
    it('normalizes L to mL and g to mg', () => {
        expect(normalizeWasteAmount(1.25, 'L')).toEqual({
            normalizedValue: 1_250,
            normalizedUnit: 'mL',
        });
        expect(normalizeWasteAmount(2.5, 'g')).toEqual({
            normalizedValue: 2_500,
            normalizedUnit: 'mg',
        });
    });

    it('uses mL/L for liquid matrices and mg/g for solid or slurry', () => {
        expect(getAllowedAmountUnits('aqueous')).toEqual(['mL', 'L']);
        expect(getAllowedAmountUnits('organic_halogenated')).toEqual(['mL', 'L']);
        expect(getAllowedAmountUnits('solid_slurry')).toEqual(['mg', 'g']);
    });

    it('rejects zero, negative and non-finite values', () => {
        expect(normalizeWasteAmount(0, 'mL')).toBeNull();
        expect(normalizeWasteAmount(-1, 'g')).toBeNull();
        expect(normalizeWasteAmount(Number.NaN, 'mL')).toBeNull();
        expect(normalizeWasteAmount(Number.POSITIVE_INFINITY, 'mg')).toBeNull();
    });

    it('rejects mass units for a liquid and volume units for a solid', () => {
        expect(validateWasteAmount(knownAmount(5, 'g'), 'aqueous')).toEqual({
            valid: false,
            error: 'amount_unit_mismatch',
        });
        expect(validateWasteAmount(knownAmount(5, 'mL'), 'solid_slurry')).toEqual({
            valid: false,
            error: 'amount_unit_mismatch',
        });
    });

    it('never performs a mass-volume conversion', () => {
        const mass = normalizeWasteAmount(1, 'g');
        const volume = normalizeWasteAmount(1, 'L');

        expect(mass?.normalizedUnit).toBe('mg');
        expect(volume?.normalizedUnit).toBe('mL');
        expect(mass?.normalizedUnit).not.toBe(volume?.normalizedUnit);
    });

    it('accepts an explicit unknown amount without storing a hidden value', () => {
        expect(validateWasteAmount({
            value: null,
            unit: null,
            normalizedValue: null,
            normalizedUnit: null,
            isApproximate: false,
            isUnknown: true,
        }, 'aqueous')).toEqual({ valid: true });
    });
});
