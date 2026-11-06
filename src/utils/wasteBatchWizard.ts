import type {
    SolutionContext,
    WasteBatchDraft,
    WasteComponent,
    WasteMatrix,
    WasteMissingField,
} from '../types';
import {
    getWasteAcidBasePresence,
    inferWasteMatrixFromComponents,
    validateWasteAmount,
} from './wasteBatch';

export type WasteBatchWizardStep = 'components' | 'amounts' | 'solution' | 'batch' | 'result';

export const WASTE_BATCH_WIZARD_STEPS: readonly WasteBatchWizardStep[] = [
    'components',
    'amounts',
    'solution',
    'batch',
    'result',
];

export interface WizardMatrixResolution {
    matrix: WasteMatrix | null;
    requiresBatchConfirmation: boolean;
    hasExplicitOrganic: boolean;
    hasUnknownSolution: boolean;
}

export interface WasteBatchWizardState {
    relevantSteps: WasteBatchWizardStep[];
    completedSteps: WasteBatchWizardStep[];
    firstIncompleteStep: WasteBatchWizardStep;
    componentStepComplete: boolean;
    amountsStepComplete: boolean;
    solutionStepRelevant: boolean;
    solutionStepComplete: boolean;
    batchStepComplete: boolean;
    matrixResolution: WizardMatrixResolution;
}

export interface WasteBatchWizardOptions {
    /** Server-authorized, high-confidence predicted pH for this exact draft. */
    approvedPredictedBatchPh?: number;
}

const hasApprovedPredictedBatchPh = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value) && value > 2.2 && value < 12.3;

export const componentHasSolutionConcentration = (component: WasteComponent): boolean =>
    component.concentration !== undefined;

export const componentNeedsAmountInput = (component: WasteComponent): boolean => {
    // A solid is measured as the batch's total mass; a neat liquid has no solution concentration.
    if (component.materialForm === 'solid') return false;
    if (component.materialForm === 'neat') return component.solutionVolume === undefined;
    return component.solutionVolume === undefined || component.concentration === undefined;
};

export const isSolutionContextAnswered = (component: WasteComponent): boolean => {
    if (!componentHasSolutionConcentration(component)) return true;
    const context = component.solutionContext;
    if (!context) return false;
    if (context.solventResolution === 'unresolved' || !context.solventResolution) return false;
    return context.solventClass === 'aqueous'
        || context.solventClass === 'organic_non_halogen'
        || context.solventClass === 'organic_halogen'
        || context.solventClass === 'mixed_or_unknown'
        || context.solventClass === 'organic_unknown';
};

export const getSolutionQuestionComponents = (components: WasteComponent[]): WasteComponent[] =>
    components.filter(componentHasSolutionConcentration);

export const getUnansweredSolutionComponents = (components: WasteComponent[]): WasteComponent[] =>
    getSolutionQuestionComponents(components).filter((component) => !isSolutionContextAnswered(component));

export const deriveWizardMatrixFromComponents = (
    components: WasteComponent[],
): WizardMatrixResolution => {
    const relevant = getSolutionQuestionComponents(components);
    const answeredContexts = relevant
        .filter(isSolutionContextAnswered)
        .map((component) => component.solutionContext!);
    const strongComponentMatrix = inferWasteMatrixFromComponents(components);
    const hasUnknownSolution = answeredContexts.some(({ solventClass }) =>
        solventClass === 'mixed_or_unknown' || solventClass === 'organic_unknown');
    const hasHalogen = strongComponentMatrix === 'organic_halogenated'
        || answeredContexts.some(({ solventClass }) => solventClass === 'organic_halogen');
    const hasNonHalogen = strongComponentMatrix === 'organic_non_halogenated'
        || answeredContexts.some(({ solventClass }) => solventClass === 'organic_non_halogen');
    const hasAqueous = answeredContexts.some(({ solventClass }) => solventClass === 'aqueous');
    const hasExplicitOrganic = hasHalogen || hasNonHalogen;
    const allRelevantAnswered = relevant.every(isSolutionContextAnswered);

    let matrix: WasteMatrix | null = null;
    if (hasHalogen) matrix = 'organic_halogenated';
    else if (hasNonHalogen) matrix = 'organic_non_halogenated';
    else if (hasAqueous && allRelevantAnswered && !hasUnknownSolution) matrix = 'aqueous';
    else if (relevant.length === 0) matrix = strongComponentMatrix;

    return {
        matrix,
        requiresBatchConfirmation: hasUnknownSolution || (!matrix && allRelevantAnswered),
        hasExplicitOrganic,
        hasUnknownSolution,
    };
};

export const createUserSolutionContext = (
    solventClass: 'aqueous' | 'organic_non_halogen' | 'organic_halogen' | 'mixed_or_unknown',
    exactSolvent?: {
        name: string;
        casNumber?: string;
        molecularFormula?: string;
        preset?: string;
    },
): SolutionContext => {
    if (solventClass === 'aqueous') {
        return {
            physicalForm: 'aqueous',
            solventClass: 'aqueous',
            solventName: 'Water',
            solventPreset: 'water',
            isCustomSolvent: false,
            isSolventVerified: true,
            solventResolution: 'user',
            solventCasNumber: '7732-18-5',
            solventMolecularFormula: 'H2O',
        };
    }
    if (solventClass === 'mixed_or_unknown') {
        return {
            physicalForm: 'mixed_or_unknown',
            solventClass,
            isSolventVerified: false,
            solventResolution: 'user',
        };
    }
    return {
        physicalForm: 'organic_solvent',
        solventClass,
        ...(exactSolvent ? {
            solventName: exactSolvent.name,
            solventPreset: exactSolvent.preset,
            isCustomSolvent: exactSolvent.preset === undefined,
            solventCasNumber: exactSolvent.casNumber,
            solventMolecularFormula: exactSolvent.molecularFormula,
        } : {}),
        isSolventVerified: Boolean(exactSolvent?.casNumber && exactSolvent?.molecularFormula),
        solventResolution: 'user',
    };
};

const hasValidStoredNumber = (value: number | undefined): boolean =>
    value === undefined || (Number.isFinite(value) && value > 0);

const hasInvalidInventoryQuantity = (component: WasteComponent): boolean => {
    if (component.sourceType !== 'inventory' || !component.inventoryId) return false;
    const available = component.inventorySnapshot?.quantity ?? 1;
    const selected = component.inventoryDisposalQuantity;
    return !Number.isInteger(selected) || selected === undefined || selected < 1 || selected > available;
};

const isComponentReadyForNextStep = (component: WasteComponent): boolean =>
    component.identityConfidence === 'verified'
    && hasValidStoredNumber(component.concentration?.value)
    && hasValidStoredNumber(component.solutionVolume?.value)
    && !hasInvalidInventoryQuantity(component);

const isComponentStepComplete = (batch: WasteBatchDraft): boolean =>
    batch.components.length > 0 && batch.components.every(isComponentReadyForNextStep);

const shouldAskAdditionalComponents = (batch: WasteBatchDraft): boolean =>
    batch.components.length > 1 || batch.matrix === 'unknown';

/** Batch-step questions in the order the batch step shows them. */
export type WizardBatchSection =
    | 'matrix'
    | 'additional_components'
    | 'fluoride_container'
    | 'total_amount'
    | 'mixing_state'
    | 'measured_ph';

/** Where an unanswered question or a missing detail is answered in the wizard. */
export type WizardFocusTarget =
    | { step: 'components'; cartLineId?: string; openPanel?: boolean }
    | { step: 'amounts'; cartLineId: string }
    | { step: 'solution'; cartLineId: string }
    | { step: 'batch'; section: WizardBatchSection };

const needsMeasuredPhAnswer = (batch: WasteBatchDraft, options: WasteBatchWizardOptions): boolean => {
    const { hasAcid, hasAlkali } = getWasteAcidBasePresence(batch.components);
    return hasAcid && hasAlkali && batch.matrix === 'aqueous'
        && !hasApprovedPredictedBatchPh(options.approvedPredictedBatchPh)
        && (batch.measuredPhStatus !== 'measured'
            || batch.measuredBatchPh === undefined
            || !Number.isFinite(batch.measuredBatchPh)
            || batch.measuredBatchPh < 0
            || batch.measuredBatchPh > 14);
};

const getFirstUnansweredBatchSection = (
    batch: WasteBatchDraft,
    resolution: WizardMatrixResolution,
    options: WasteBatchWizardOptions,
): WizardBatchSection | null => {
    const matrixAnswered = resolution.requiresBatchConfirmation
        ? batch.matrixSource === 'user'
        : batch.matrix !== 'unknown';
    if (!matrixAnswered) return 'matrix';
    if (shouldAskAdditionalComponents(batch)
        && (batch.additionalComponentsStatus === undefined || batch.additionalComponentsStatus === 'present')) {
        return 'additional_components';
    }
    const hasFluoride = batch.components.some((component) =>
        component.hazardFlags.includes('HYDROFLUORIC_ACID') || component.hazardFlags.includes('FLUORIDE'));
    if (hasFluoride && batch.fluorideContainerStatus === undefined) return 'fluoride_container';
    if (!validateWasteAmount(batch.totalAmount, batch.matrix).valid) return 'total_amount';
    if (batch.mixingState === 'separate') return 'mixing_state';
    if (needsMeasuredPhAnswer(batch, options)) return 'measured_ph';
    return null;
};

const isBatchStepComplete = (
    batch: WasteBatchDraft,
    resolution: WizardMatrixResolution,
    options: WasteBatchWizardOptions,
): boolean => getFirstUnansweredBatchSection(batch, resolution, options) === null;

export const resolveWasteBatchWizard = (
    batch: WasteBatchDraft,
    options: WasteBatchWizardOptions = {},
): WasteBatchWizardState => {
    const componentStepComplete = isComponentStepComplete(batch);
    const amountsStepComplete = batch.components.length > 0
        && batch.components.every((component) => !componentNeedsAmountInput(component));
    const solutionStepRelevant = getSolutionQuestionComponents(batch.components).length > 0;
    const solutionStepComplete = !solutionStepRelevant || getUnansweredSolutionComponents(batch.components).length === 0;
    const matrixResolution = deriveWizardMatrixFromComponents(batch.components);
    const batchStepComplete = componentStepComplete && solutionStepComplete
        && isBatchStepComplete(batch, matrixResolution, options);
    const relevantSteps: WasteBatchWizardStep[] = solutionStepRelevant
        ? [...WASTE_BATCH_WIZARD_STEPS]
        : WASTE_BATCH_WIZARD_STEPS.filter((step) => step !== 'solution');
    const completedSteps: WasteBatchWizardStep[] = [];
    if (componentStepComplete) completedSteps.push('components');
    if (amountsStepComplete) completedSteps.push('amounts');
    if (solutionStepComplete) completedSteps.push('solution');
    if (batchStepComplete) completedSteps.push('batch');
    const firstIncompleteStep: WasteBatchWizardStep = !componentStepComplete
        ? 'components'
        : !solutionStepComplete
            ? 'solution'
            : !batchStepComplete
                ? 'batch'
                : 'result';
    return {
        relevantSteps,
        completedSteps,
        firstIncompleteStep,
        componentStepComplete,
        amountsStepComplete,
        solutionStepRelevant,
        solutionStepComplete,
        batchStepComplete,
        matrixResolution,
    };
};

export const getWizardEntryStep = (
    batch: WasteBatchDraft,
    options: WasteBatchWizardOptions = {},
): WasteBatchWizardStep => {
    if (batch.components.some(componentNeedsAmountInput)) return 'components';
    return resolveWasteBatchWizard(batch, options).firstIncompleteStep;
};

export const getNextWizardStep = (
    current: WasteBatchWizardStep,
    wizard: WasteBatchWizardState,
): WasteBatchWizardStep => {
    if (current === 'components') return 'amounts';
    if (current === 'amounts') return wizard.solutionStepRelevant ? 'solution' : 'batch';
    if (current === 'solution') return 'batch';
    if (current === 'batch') return wizard.batchStepComplete ? 'result' : 'batch';
    return 'result';
};

export const getPreviousWizardStep = (
    current: WasteBatchWizardStep,
    wizard: WasteBatchWizardState,
): WasteBatchWizardStep => {
    if (current === 'result') return 'batch';
    if (current === 'batch') return wizard.solutionStepRelevant ? 'solution' : 'amounts';
    if (current === 'solution') return 'amounts';
    if (current === 'amounts') return 'components';
    return 'components';
};

/**
 * The first question, in screen order, that keeps the wizard from reaching
 * the result. A blocked "Next" points here instead of doing nothing.
 */
export const getFirstIncompleteWizardTarget = (
    batch: WasteBatchDraft,
    options: WasteBatchWizardOptions = {},
): WizardFocusTarget | null => {
    if (batch.components.length === 0) return { step: 'components' };
    const notReady = batch.components.find((component) => !isComponentReadyForNextStep(component));
    if (notReady) return { step: 'components', cartLineId: notReady.cartLineId };
    const unanswered = getUnansweredSolutionComponents(batch.components)[0];
    if (unanswered) return { step: 'solution', cartLineId: unanswered.cartLineId };
    const section = getFirstUnansweredBatchSection(
        batch,
        deriveWizardMatrixFromComponents(batch.components),
        options,
    );
    return section ? { step: 'batch', section } : null;
};

/**
 * Where the user supplies a detail the decision engine reports as missing.
 * Policy gaps are not answerable in the wizard and return null.
 */
export const getMissingFieldTarget = (
    field: WasteMissingField,
    batch: WasteBatchDraft,
): WizardFocusTarget | null => {
    switch (field) {
        case 'components':
            return { step: 'components' };
        case 'identity':
            return {
                step: 'components',
                cartLineId: batch.components.find(({ identityConfidence }) => identityConfidence !== 'verified')
                    ?.cartLineId,
            };
        case 'hazard_data': {
            const component = batch.components.find(({ ghsDataStatus, hazardDataConfirmedByUser }) => (
                ghsDataStatus !== 'verified' && !hazardDataConfirmedByUser
            ));
            return { step: 'components', cartLineId: component?.cartLineId, openPanel: Boolean(component) };
        }
        case 'inventory_quantity':
            return {
                step: 'components',
                cartLineId: batch.components.find(hasInvalidInventoryQuantity)?.cartLineId,
            };
        case 'classification': {
            const component = batch.components.find(({ category }) => category === 'UNKNOWN');
            return component
                ? { step: 'amounts', cartLineId: component.cartLineId }
                : { step: 'components' };
        }
        case 'matrix':
        case 'additional_components':
        case 'fluoride_container':
        case 'total_amount':
        case 'mixing_state':
        case 'measured_ph':
            return { step: 'batch', section: field };
        case 'policy_stream':
        case 'policy_destination':
            return null;
    }
};
