import { describe, expect, it } from 'vitest';
import type { WasteBatchDraft, WasteComponent } from '../types';
import {
    componentNeedsAmountInput,
    createUserSolutionContext,
    deriveWizardMatrixFromComponents,
    getNextWizardStep,
    getWizardEntryStep,
    resolveWasteBatchWizard,
} from './wasteBatchWizard';

const component = (id: string, concentration = true): WasteComponent => ({
    cartLineId: id,
    sourceType: 'manual',
    identityConfidence: 'verified',
    ghsDataStatus: 'verified',
    capturedAt: '2026-08-05T00:00:00.000Z',
    hazardFlags: [],
    concentration: concentration ? { value: 0.05, unit: 'M' } : undefined,
    solutionVolume: { value: 100, unit: 'mL', normalizedMl: 100 },
    chemical: {
        id,
        name: id,
        casNumber: '',
        molecularFormula: '',
    },
    category: 'NEUTRAL',
    binColor: '',
    label: '',
    reason: '',
    isSafe: true,
});

const batch = (components: WasteComponent[]): WasteBatchDraft => ({
    id: 'batch',
    scopeKey: 'local',
    components,
    matrix: 'unknown',
    matrixSource: 'unresolved',
    totalAmount: {
        value: null,
        unit: null,
        normalizedValue: null,
        normalizedUnit: null,
        isApproximate: false,
        isUnknown: true,
    },
    measuredPhStatus: 'not_required',
    mixingState: 'already_mixed',
    incidentContext: 'none',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
});

describe('waste batch wizard resolver', () => {
    it('opens at component amounts before asking about the solvent', () => {
        const incomplete = component('Acetic Acid');
        incomplete.solutionVolume = undefined;

        expect(componentNeedsAmountInput(incomplete)).toBe(true);
        expect(resolveWasteBatchWizard(batch([incomplete])).firstIncompleteStep).toBe('solution');
        expect(getWizardEntryStep(batch([incomplete]))).toBe('components');
        expect(getNextWizardStep('components', resolveWasteBatchWizard(batch([incomplete])))).toBe('amounts');

        incomplete.solutionVolume = { value: 100, unit: 'mL', normalizedMl: 100 };
        expect(getWizardEntryStep(batch([incomplete]))).toBe('solution');
    });

    it('opens amount entry when both volume and concentration are absent', () => {
        const unmeasured = component('unknown amount', false);
        unmeasured.solutionVolume = undefined;

        expect(getWizardEntryStep(batch([unmeasured]))).toBe('components');
    });

    it('asks sodium acetate and acetic acid for solution context, then derives aqueous', () => {
        const sodiumAcetate = component('Sodium Acetate');
        const aceticAcid = component('Acetic Acid');
        expect(resolveWasteBatchWizard(batch([sodiumAcetate, aceticAcid]))).toMatchObject({
            firstIncompleteStep: 'solution',
            solutionStepRelevant: true,
            solutionStepComplete: false,
        });

        sodiumAcetate.solutionContext = createUserSolutionContext('aqueous');
        aceticAcid.solutionContext = createUserSolutionContext('aqueous');
        expect(deriveWizardMatrixFromComponents([sodiumAcetate, aceticAcid])).toMatchObject({
            matrix: 'aqueous',
            requiresBatchConfirmation: false,
        });
    });

    it('gives halogenated organic solvent precedence when DCM is explicit', () => {
        const aqueous = component('aqueous');
        aqueous.solutionContext = createUserSolutionContext('aqueous');
        const dcm = component('dcm');
        dcm.solutionContext = createUserSolutionContext('organic_halogen', {
            name: 'Dichloromethane',
            casNumber: '75-09-2',
            molecularFormula: 'CH2Cl2',
            preset: 'Dichloromethane',
        });
        expect(deriveWizardMatrixFromComponents([aqueous, dcm])).toMatchObject({
            matrix: 'organic_halogenated',
            hasExplicitOrganic: true,
        });
    });

    it('requires a batch answer for an unknown solution and accepts user-confirmed unknown for review', () => {
        const unknown = component('unknown');
        unknown.solutionContext = createUserSolutionContext('mixed_or_unknown');
        const draft = batch([unknown]);
        const unresolved = resolveWasteBatchWizard(draft);
        expect(unresolved.matrixResolution.requiresBatchConfirmation).toBe(true);
        expect(unresolved.firstIncompleteStep).toBe('batch');

        draft.matrix = 'unknown';
        draft.matrixSource = 'user';
        draft.additionalComponentsStatus = 'none';
        const answered = resolveWasteBatchWizard(draft);
        expect(answered.batchStepComplete).toBe(true);
        expect(answered.firstIncompleteStep).toBe('result');
    });

    it('skips the solution step when no component has a concentration', () => {
        const draft = batch([component('solid', false)]);
        draft.matrix = 'solid_slurry';
        draft.matrixSource = 'automatic';
        const wizard = resolveWasteBatchWizard(draft);
        expect(wizard.relevantSteps).not.toContain('solution');
        expect(getNextWizardStep('components', wizard)).toBe('amounts');
        expect(getNextWizardStep('amounts', wizard)).toBe('batch');
    });
});
