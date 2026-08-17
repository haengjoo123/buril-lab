import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertOctagon,
    AlertTriangle,
    Check,
    ChevronDown,
    Edit3,
    ExternalLink,
    Info,
    Loader2,
    MapPin,
    PackageCheck,
    RotateCcw,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MAX_PARKED_WASTE_BATCHES, useWasteStore } from '../store/useWasteStore';
import { useLabStore } from '../store/useLabStore';
import {
    deriveWasteAmountFromComponentVolumes,
    getAllowedAmountUnits,
    getWasteAcidBasePresence,
} from '../utils/wasteBatch';
import {
    getWastePolicyEscalationDetails,
    hasWastePolicyContextChanged,
    resolveWasteDecisionAgainstPolicy,
} from '../utils/wastePolicyGuard';
import { checkCompatibility } from '../utils/compatibilityChecker';
import { parseCapacityMeasurement } from '../utils/capacityParser';
import { getAIDisposalGuide, type DisposalGuideResult } from '../services/geminiDisposalGuideService';
import { getActiveWastePolicyV2, type ActiveWastePolicy } from '../services/wastePolicyService';
import { recordWasteHandlingV2, type WasteHandlingReceipt } from '../services/wasteLogService';
import { translateGHS } from '../data/ghsCodes';
import { isPhPredictionEnabled } from '../config/featureFlags';
import {
    getPredictedPhForRouting,
    hashPredictionInput,
    predictAqueousPh,
} from '../features/phPrediction';
import {
    authorizePredictedPhForWasteBatch,
    type PredictedPhAuthorization,
} from '../services/wastePhAuthorizationService';
import {
    createUserSolutionContext,
    getNextWizardStep,
    getPreviousWizardStep,
    getSolutionQuestionComponents,
    getWizardEntryStep,
    isSolutionContextAnswered,
    resolveWasteBatchWizard,
    WASTE_BATCH_WIZARD_STEPS,
    type WasteBatchWizardStep,
} from '../utils/wasteBatchWizard';
import {
    REPRESENTATIVE_SOLVENT_PRESETS,
    resolveCustomOrganicSolvent,
    resolveLocalOrganicSolvent,
    type CustomSolventResolution,
} from '../utils/solventClassifier';
import {
    canDisplayPhPredictionNumber,
    createPhPredictionAuditSnapshot,
    getApprovedPhCatalogOptions,
    shouldAskPhPredictionCompleteness,
    shouldShowPhPredictionMatrixNotice,
} from './cartPhPredictionUi';
import { AppSelect } from './AppSelect';
import type {
    AmountUnit,
    ConcentrationUnit,
    HandlingAction,
    PhPredictionResult,
    WasteConcentrationBasis,
    WasteMatrix,
    WasteHazardFlag,
    WasteMissingField,
    WasteSolutionVolumeUnit,
    WasteStreamCode,
} from '../types';

interface CartViewProps {
    onClose: () => void;
    onDisposed?: () => void;
    onOpenLogs?: (wasteLogId?: string, openCorrection?: boolean) => void;
    onAddComponent?: () => void;
}

const MATRIX_OPTIONS: WasteMatrix[] = [
    'aqueous',
    'organic_non_halogenated',
    'organic_halogenated',
    'solid_slurry',
    'unknown',
];

const CONCENTRATION_UNITS: ConcentrationUnit[] = ['M', 'mM', '%', 'mg/mL'];
const SOLUTION_VOLUME_UNITS: WasteSolutionVolumeUnit[] = ['uL', 'mL', 'L'];
const CONCENTRATION_BASES: WasteConcentrationBasis[] = ['w_w', 'w_v', 'v_v'];

const MANUAL_HAZARD_OPTIONS: WasteHazardFlag[] = [
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
];

const MISSING_FIELD_KEYS: Record<WasteMissingField, string> = {
    components: 'waste_missing_components',
    matrix: 'waste_missing_matrix',
    total_amount: 'waste_missing_total_amount',
    mixing_state: 'waste_missing_mixing_state',
    identity: 'waste_missing_identity',
    hazard_data: 'waste_missing_hazard_data',
    classification: 'waste_missing_classification',
    additional_components: 'waste_missing_additional_components',
    fluoride_container: 'waste_missing_fluoride_container',
    measured_ph: 'waste_missing_measured_ph',
    inventory_quantity: 'waste_missing_inventory_quantity',
    policy_stream: 'waste_missing_policy_stream',
    policy_destination: 'waste_missing_policy_destination',
};

const STREAM_NAMES_KO: Record<WasteStreamCode, string> = {
    ACID_AQUEOUS: '산성 수계 폐액',
    ALKALI_AQUEOUS: '알칼리성 수계 폐액',
    ORGANIC_HALOGENATED: '할로겐 유기용매 폐액',
    ORGANIC_NON_HALOGENATED: '비할로겐 유기용매 폐액',
    HEAVY_METAL: '중금속 폐액',
    CYANIDE_SULFIDE: '시안·황화물계 폐액',
    REACTIVE_OXIDIZER: '반응성·산화성 폐기물',
    SOLID_CONTAMINATED: '오염 고체·슬러리',
    AQUEOUS_OTHER: '기타 수계 폐액',
    SPECIAL_REVIEW: '별도 검토 폐기물',
};

const STREAM_NAMES_EN: Record<WasteStreamCode, string> = {
    ACID_AQUEOUS: 'Acidic aqueous waste',
    ALKALI_AQUEOUS: 'Alkaline aqueous waste',
    ORGANIC_HALOGENATED: 'Halogenated organic waste',
    ORGANIC_NON_HALOGENATED: 'Non-halogenated organic waste',
    HEAVY_METAL: 'Heavy-metal waste',
    CYANIDE_SULFIDE: 'Cyanide / sulfide waste',
    REACTIVE_OXIDIZER: 'Reactive / oxidizing waste',
    SOLID_CONTAMINATED: 'Contaminated solid / slurry',
    AQUEOUS_OTHER: 'Other aqueous waste',
    SPECIAL_REVIEW: 'Special-review waste',
};

const createRequestId = (): string => {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `00000000-0000-4000-8000-${Date.now().toString().padStart(12, '0').slice(-12)}`;
};

const extractHCodes = (statements: string[] | undefined): string[] =>
    Array.from(new Set((statements ?? []).flatMap((statement) => statement.match(/H\d{3}/g) ?? [])));

const isInvalidConcentrationText = (rawValue: string | undefined): boolean => {
    if (rawValue === undefined || rawValue.trim() === '') return false;
    const value = Number(rawValue);
    return !Number.isFinite(value) || value <= 0;
};

const normalizeSolutionVolumeMl = (value: number, unit: WasteSolutionVolumeUnit): number => {
    if (unit === 'L') return value * 1_000;
    if (unit === 'uL') return value / 1_000;
    return value;
};

const normalizePolicyPhrase = (value: string): string =>
    value.toLocaleLowerCase().replace(/[\s·•:：,./()_-]/g, '');

const STANDARD_LABEL_REQUIREMENTS = new Set([
    '성분명',
    '주요성분명',
    '성분과양',
    '주요위험',
    '폐액전체량',
    '대략적인양또는양모름',
    'componentname',
    'componentnames',
    'componentsandamount',
    'mainhazard',
    'mainhazards',
    'majorhazard',
    'majorhazards',
    'totalwasteamount',
    'approximateamountorunknown',
]);

const isStandardLabelRequirement = (value: string): boolean =>
    STANDARD_LABEL_REQUIREMENTS.has(normalizePolicyPhrase(value));

const splitHazardLabel = (value: string): { code: string | null; description: string } => {
    const match = /^(H\d{3})\s*:\s*(.+)$/i.exec(value.trim());
    return match
        ? { code: match[1].toUpperCase(), description: match[2] }
        : { code: null, description: value };
};

const focusableSelector = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

const WIZARD_STEP_NUMBER: Record<WasteBatchWizardStep, number> = {
    components: 1,
    amounts: 2,
    solution: 3,
    batch: 4,
    result: 5,
};

interface SolventClassConflict {
    cartLineId: string;
    requestedClass: 'organic_non_halogen' | 'organic_halogen';
    resolution: CustomSolventResolution;
}

export const CartView: React.FC<CartViewProps> = ({
    onClose,
    onDisposed,
    onOpenLogs,
    onAddComponent,
}) => {
    const { t, i18n } = useTranslation();
    const currentLabId = useLabStore((state) => state.currentLabId);
    const currentLabName = useLabStore((state) =>
        state.myLabs.find((membership) => membership.lab_id === state.currentLabId)?.lab?.name
    );
    const {
        batch,
        removeFromCart,
        updateComponent,
        setMatrix,
        setTotalAmount,
        setMeasuredPh,
        confirmSingleContainer,
        setAdditionalComponentsStatus,
        setFluorideContainerStatus,
        parkedBatches,
        parkCurrentBatch,
        restoreParkedBatch,
        deleteParkedBatch,
        previousMatrix,
        rememberCurrentMatrix,
        applyPreviousMatrix,
        clearCart,
    } = useWasteStore();

    const dialogRef = useRef<HTMLDivElement>(null);
    const openerRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    const requestIdRef = useRef<string | null>(null);
    const requestFingerprintRef = useRef<string | null>(null);
    const aiRequestSequenceRef = useRef(0);
    const wizardScrollRef = useRef<HTMLElement>(null);
    const wizardTitleRef = useRef<HTMLHeadingElement>(null);
    const [editingLineId, setEditingLineId] = useState<string | null>(null);
    const [isMatrixEditing, setIsMatrixEditing] = useState(false);
    const [concentrationInputs, setConcentrationInputs] = useState<Record<string, string>>({});
    const [concentrationUnits, setConcentrationUnits] = useState<Record<string, ConcentrationUnit>>({});
    const [solutionVolumeInputs, setSolutionVolumeInputs] = useState<Record<string, string>>({});
    const [solutionVolumeUnits, setSolutionVolumeUnits] = useState<Record<string, WasteSolutionVolumeUnit>>({});
    const [densityInputs, setDensityInputs] = useState<Record<string, string>>({});
    const [memo, setMemo] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [policyGuardMessage, setPolicyGuardMessage] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<WasteHandlingReceipt | null>(null);
    const [policy, setPolicy] = useState<ActiveWastePolicy | null>(null);
    const [policyLoading, setPolicyLoading] = useState(true);
    const [aiResult, setAiResult] = useState<DisposalGuideResult | null>(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState(false);
    const [batchMessage, setBatchMessage] = useState<string | null>(null);
    const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
    const [activeStep, setActiveStep] = useState<WasteBatchWizardStep>(() =>
        getWizardEntryStep(batch)
    );
    const [solutionQuestionIndex, setSolutionQuestionIndex] = useState(0);
    const [amountQuestionIndex, setAmountQuestionIndex] = useState(0);
    const [showAiDetail, setShowAiDetail] = useState(false);
    const [solventSearchInputs, setSolventSearchInputs] = useState<Record<string, string>>({});
    const [solventSearchLoading, setSolventSearchLoading] = useState(false);
    const [solventSearchError, setSolventSearchError] = useState<string | null>(null);
    const [solventClassConflict, setSolventClassConflict] = useState<SolventClassConflict | null>(null);
    const [predictedPhAuthorization, setPredictedPhAuthorization] = useState<{
        inputHash: string;
        authorization: PredictedPhAuthorization;
    } | null>(null);

    const activeBatchHasContent = batch.components.length > 0
        || batch.matrix !== 'unknown'
        || batch.totalAmount.value !== null
        || batch.totalAmount.isUnknown
        || batch.measuredPhStatus !== 'not_required'
        || batch.mixingState !== 'unknown'
        || batch.additionalComponentsStatus !== undefined
        || batch.fluorideContainerStatus !== undefined
        || batch.incidentContext !== 'none';

    const parkBatchAndStartNew = () => {
        if (parkedBatches.length >= MAX_PARKED_WASTE_BATCHES) {
            setBatchMessage(t('waste_park_limit_reached', { count: MAX_PARKED_WASTE_BATCHES }));
            return;
        }
        const parked = parkCurrentBatch();
        setBatchMessage(t(parked ? 'waste_park_success' : 'waste_park_failed'));
    };

    const discardAndStartNew = () => {
        if (!window.confirm(t('cart_confirm_clear'))) return;
        clearCart();
        setBatchMessage(null);
    };

    const restoreDraft = (id: string) => {
        const restored = restoreParkedBatch(id);
        setBatchMessage(t(restored ? 'waste_restore_success' : 'waste_restore_requires_empty'));
    };

    const removeParkedDraft = (id: string) => {
        if (!window.confirm(t('waste_delete_parked_confirm'))) return;
        if (deleteParkedBatch(id)) setBatchMessage(t('waste_delete_parked_done'));
    };

    const compatibilityWarnings = useMemo(
        () => checkCompatibility(batch.components, { matrix: batch.matrix }),
        [batch.components, batch.matrix],
    );
    const allowedUnits = getAllowedAmountUnits(batch.matrix);
    const componentVolumeTotal = useMemo(
        () => batch.matrix !== 'unknown' && batch.matrix !== 'solid_slurry'
            ? deriveWasteAmountFromComponentVolumes(batch.components)
            : null,
        [batch.components, batch.matrix],
    );
    const hasComponentVolumeTotal = componentVolumeTotal !== null;
    const hasManualTotalOverride = hasComponentVolumeTotal && batch.totalAmount.source === 'manual';
    const amountValueInvalid = batch.totalAmount.value !== null && (
        !Number.isFinite(batch.totalAmount.value) || batch.totalAmount.value <= 0
    );
    const hasInvalidConcentration = batch.components.some((component) =>
        isInvalidConcentrationText(concentrationInputs[component.cartLineId])
    );
    const hasInvalidSolutionVolume = batch.components.some((component) =>
        isInvalidConcentrationText(solutionVolumeInputs[component.cartLineId])
    );
    const hasInvalidNumericInput = hasInvalidConcentration || hasInvalidSolutionVolume;
    const requestClose = useCallback(() => {
        if (hasInvalidConcentration && !window.confirm(t('waste_discard_invalid_concentration_confirm'))) return;
        onClose();
    }, [hasInvalidConcentration, onClose, t]);
    const inventoryAmountSuggestion = useMemo(() => {
        if (batch.matrix === 'unknown' || batch.components.length === 0) return null;
        const expectedDimension = batch.matrix === 'solid_slurry' ? 'mass' : 'volume';
        let normalizedTotal = 0;
        let found = false;
        for (const component of batch.components) {
            const snapshot = component.inventorySnapshot;
            if (!snapshot?.nominalCapacity) continue;
            const parsed = parseCapacityMeasurement(snapshot.nominalCapacity);
            if (parsed.numericValue === null || !parsed.unit) continue;
            const availableQuantity = snapshot.quantity == null
                ? 1
                : Number.isFinite(snapshot.quantity) && snapshot.quantity > 0
                    ? snapshot.quantity
                    : null;
            const quantity = component.sourceType === 'inventory' && component.inventoryId
                ? component.inventoryDisposalQuantity
                : availableQuantity;
            if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) continue;
            const remainingRatio = snapshot.remainingPercent == null
                ? 1
                : Number.isFinite(snapshot.remainingPercent)
                    && snapshot.remainingPercent >= 0
                    && snapshot.remainingPercent <= 100
                    ? snapshot.remainingPercent / 100
                    : null;
            if (remainingRatio === null) continue;
            const normalized = expectedDimension === 'volume' ? parsed.volumeMl : parsed.massMg;
            if (normalized === null) continue;
            const adjusted = normalized * quantity * remainingRatio;
            if (!Number.isFinite(adjusted) || adjusted <= 0) continue;
            normalizedTotal += adjusted;
            found = true;
        }
        if (!found || normalizedTotal <= 0) return null;
        if (expectedDimension === 'volume') {
            return normalizedTotal >= 1_000
                ? { value: Number((normalizedTotal / 1_000).toFixed(3)), unit: 'L' as const }
                : { value: Number(normalizedTotal.toFixed(3)), unit: 'mL' as const };
        }
        return normalizedTotal >= 1_000
            ? { value: Number((normalizedTotal / 1_000).toFixed(3)), unit: 'g' as const }
            : { value: Number(normalizedTotal.toFixed(3)), unit: 'mg' as const };
    }, [batch.components, batch.matrix]);
    const acidBasePresence = getWasteAcidBasePresence(batch.components);
    const requiresMixingState = acidBasePresence.hasAcid && acidBasePresence.hasAlkali;
    const shouldShowPhPrediction = isPhPredictionEnabled && batch.matrix === 'aqueous' &&
        batch.components.length > 0 && batch.mixingState === 'already_mixed';
    const shouldShowPhPredictionMatrixUnavailable = shouldShowPhPredictionMatrixNotice(
        isPhPredictionEnabled,
        batch.matrix,
        batch.components.length,
    );
    const phPrediction = useMemo<PhPredictionResult | null>(() => {
        if (!shouldShowPhPrediction) return null;
        try {
            return predictAqueousPh(batch);
        } catch {
            return {
                status: 'failed',
                confidence: 'unavailable',
                issueCodes: ['engine_error'],
                assumptions: [],
                modelVersion: 'unknown',
                catalogVersion: 'unknown',
                inputHash: hashPredictionInput(batch),
            };
        }
    }, [batch, shouldShowPhPrediction]);
    const locallyRoutablePredictedPh = getPredictedPhForRouting(phPrediction);
    const activePredictedPhAuthorization = predictedPhAuthorization
        && phPrediction?.inputHash === predictedPhAuthorization.inputHash
        && Date.parse(predictedPhAuthorization.authorization.expiresAt) > Date.now()
        && getPredictedPhForRouting(predictedPhAuthorization.authorization.prediction) !== undefined
        ? predictedPhAuthorization.authorization
        : null;
    const approvedPredictedBatchPh = activePredictedPhAuthorization
        ? getPredictedPhForRouting(activePredictedPhAuthorization.prediction)
        : undefined;
    const policyResolution = useMemo(
        () => resolveWasteDecisionAgainstPolicy(batch, policy, { approvedPredictedBatchPh }),
        [approvedPredictedBatchPh, batch, policy],
    );
    const { decision, matchedStream, policyStream } = policyResolution;
    const escalationDetails = useMemo(
        () => getWastePolicyEscalationDetails(policyStream),
        [policyStream],
    );
    const hasAmountConfirmation = !decision.missingFields.includes('total_amount');
    const needsMeasuredPh = requiresMixingState && batch.matrix === 'aqueous' &&
        batch.mixingState === 'already_mixed' && approvedPredictedBatchPh === undefined;
    const shouldAskAdditionalComponents = batch.matrix === 'mixed_biphasic' ||
        batch.matrix === 'unknown' || batch.components.length > 1 ||
        shouldAskPhPredictionCompleteness(
            isPhPredictionEnabled,
            batch.matrix,
            batch.components.length,
        );
    const requiresFluorideCompatibleContainer =
        decision.hazardFlags.includes('HYDROFLUORIC_ACID') ||
        decision.hazardFlags.includes('FLUORIDE');
    const isKorean = i18n.language.toLowerCase().startsWith('ko');
    const streamName = matchedStream
        ? (isKorean ? matchedStream.displayNameKo : matchedStream.displayNameEn)
        : (isKorean ? STREAM_NAMES_KO[decision.streamCode] : STREAM_NAMES_EN[decision.streamCode]);
    const labelComponentNames = Array.from(new Set(
        batch.components
            .map((component) => component.chemical.name.trim())
            .filter(Boolean),
    )).join(', ');
    const wasteHazardLabels = Array.from(new Set(decision.hazardFlags))
        .map((flag) => t(`waste_hazard_${flag}` as never));
    const rawGhsHazardStatements = batch.components
        .flatMap((component) => component.chemical.ghs?.hazardStatements ?? []);
    const ghsHazardCodes = extractHCodes(rawGhsHazardStatements);
    const ghsHazardLabels = (ghsHazardCodes.length > 0
        ? ghsHazardCodes
        : Array.from(new Set(rawGhsHazardStatements))
    ).map((statement) => translateGHS(statement, isKorean ? 'ko' : 'en'));
    const labelHazardItems = (wasteHazardLabels.length > 0 ? wasteHazardLabels : ghsHazardLabels)
        .map(splitHazardLabel);
    const hasUnconfirmedHazardData = batch.components.some((component) =>
        component.ghsDataStatus !== 'verified' && !component.hazardDataConfirmedByUser
    );
    const labelAmount = batch.totalAmount.isUnknown
        ? t('waste_amount_unknown')
        : batch.totalAmount.value !== null && batch.totalAmount.unit
            ? batch.totalAmount.isApproximate
                ? t('waste_label_amount_approximate_value', {
                    value: batch.totalAmount.value,
                    unit: batch.totalAmount.unit,
                })
                : `${batch.totalAmount.value} ${batch.totalAmount.unit}`
            : t('waste_label_value_not_entered');
    const additionalLabelRequirements = (matchedStream?.labelRequirements ?? [])
        .filter((requirement) => !isStandardLabelRequirement(requirement));
    const receiptStreamName = receipt
        ? receipt.streamSnapshot.containerLabel
            || (isKorean ? receipt.streamSnapshot.displayNameKo : receipt.streamSnapshot.displayNameEn)
            || (isKorean ? STREAM_NAMES_KO[receipt.streamCode] : STREAM_NAMES_EN[receipt.streamCode])
        : streamName;
    const receiptStreamClassification = receipt
        ? (isKorean ? receipt.streamSnapshot.displayNameKo : receipt.streamSnapshot.displayNameEn)
            || (isKorean ? STREAM_NAMES_KO[receipt.streamCode] : STREAM_NAMES_EN[receipt.streamCode])
        : streamName;
    const requestPayloadFingerprint = useMemo(() => JSON.stringify({
        batch,
        decision,
        memo: memo.trim(),
    }), [batch, decision, memo]);
    const aiContextFingerprint = useMemo(() => JSON.stringify({
        language: i18n.language,
        batch,
        decision,
        compatibilityWarnings,
        matchedStream,
    }), [batch, compatibilityWarnings, decision, i18n.language, matchedStream]);
    const wizard = useMemo(
        () => resolveWasteBatchWizard(batch, { approvedPredictedBatchPh }),
        [approvedPredictedBatchPh, batch],
    );
    const solutionQuestionComponents = useMemo(
        () => getSolutionQuestionComponents(batch.components),
        [batch.components],
    );
    const safeSolutionQuestionIndex = solutionQuestionComponents.length === 0
        ? 0
        : Math.min(solutionQuestionIndex, solutionQuestionComponents.length - 1);
    const activeSolutionComponent = solutionQuestionComponents[safeSolutionQuestionIndex];
    const safeAmountQuestionIndex = batch.components.length === 0
        ? 0
        : Math.min(amountQuestionIndex, batch.components.length - 1);
    const activeAmountComponent = batch.components[safeAmountQuestionIndex];

    useEffect(() => {
        let active = true;
        setPredictedPhAuthorization(null);
        if (!requiresMixingState || !phPrediction || locallyRoutablePredictedPh === undefined) {
            return () => {
                active = false;
            };
        }

        void authorizePredictedPhForWasteBatch(batch)
            .then((authorization) => {
                if (!active || getPredictedPhForRouting(authorization.prediction) === undefined) return;
                setPredictedPhAuthorization({
                    inputHash: phPrediction.inputHash,
                    authorization,
                });
            })
            .catch((error) => {
                // Failing closed leaves the measured-pH field visible.
                console.warn('Predicted pH could not be server-authorized:', error);
            });

        return () => {
            active = false;
        };
    }, [batch, locallyRoutablePredictedPh, phPrediction, requiresMixingState]);

    useEffect(() => {
        const currentBatch = useWasteStore.getState().batch;
        setEditingLineId(null);
        setIsMatrixEditing(false);
        setConcentrationInputs({});
        setConcentrationUnits({});
        setSolutionVolumeInputs({});
        setSolutionVolumeUnits({});
        setDensityInputs({});
        setMemo('');
        requestIdRef.current = null;
        requestFingerprintRef.current = null;
        setActiveStep(getWizardEntryStep(currentBatch));
        const firstUnanswered = getSolutionQuestionComponents(currentBatch.components)
            .findIndex((component) => !isSolutionContextAnswered(component));
        setSolutionQuestionIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
        const firstMissingAmount = currentBatch.components.findIndex((component) =>
            component.solutionVolume === undefined || component.concentration === undefined);
        setAmountQuestionIndex(firstMissingAmount >= 0 ? firstMissingAmount : 0);
        setShowAiDetail(false);
        setSolventSearchInputs({});
        setSolventSearchError(null);
        setSolventClassConflict(null);
        setPredictedPhAuthorization(null);
    }, [batch.id]);

    useEffect(() => {
        wizardScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        window.setTimeout(() => wizardTitleRef.current?.focus(), 0);
    }, [activeStep, safeAmountQuestionIndex, safeSolutionQuestionIndex, showAiDetail]);

    useEffect(() => {
        aiRequestSequenceRef.current += 1;
        setAiResult(null);
        setAiError(false);
        setAiLoading(false);
    }, [aiContextFingerprint]);

    useEffect(() => {
        const onOnline = () => setIsOnline(true);
        const onOffline = () => setIsOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, []);

    useEffect(() => {
        let active = true;
        setPolicyLoading(true);
        getActiveWastePolicyV2(currentLabId)
            .then((result) => {
                if (active) setPolicy(result);
            })
            .catch(() => {
                if (active) setPolicy(null);
            })
            .finally(() => {
                if (active) setPolicyLoading(false);
            });
        return () => {
            active = false;
        };
    }, [currentLabId]);

    useEffect(() => {
        onCloseRef.current = requestClose;
    }, [requestClose]);

    useEffect(() => {
        openerRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        return () => {
            openerRef.current?.focus();
        };
    }, []);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const initial = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]');
        (initial ?? dialog).focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [receipt]);

    const changeAmount = (rawValue: string) => {
        const value = rawValue.trim() === '' ? null : Number(rawValue);
        const unit = batch.totalAmount.unit ?? allowedUnits[0] ?? null;
        setTotalAmount({
            value,
            unit,
            isApproximate: batch.totalAmount.isApproximate,
            source: 'manual',
        });
    };

    const changeUnit = (unit: AmountUnit) => {
        setTotalAmount({
            value: batch.totalAmount.value,
            unit,
            isApproximate: batch.totalAmount.isApproximate,
            source: 'manual',
        });
    };

    const selectSolutionClass = (
        cartLineId: string,
        solventClass: 'aqueous' | 'organic_non_halogen' | 'organic_halogen' | 'mixed_or_unknown',
    ) => {
        updateComponent(cartLineId, { solutionContext: createUserSolutionContext(solventClass) });
        setSolventSearchError(null);
        setSolventClassConflict(null);
    };

    const selectSolventPreset = (
        cartLineId: string,
        solventClass: 'organic_non_halogen' | 'organic_halogen',
        preset: string,
    ) => {
        const exact = resolveLocalOrganicSolvent(preset);
        if (!exact || exact.solventClass !== solventClass) return;
        updateComponent(cartLineId, {
            solutionContext: createUserSolutionContext(solventClass, {
                name: exact.name,
                casNumber: exact.casNumber,
                molecularFormula: exact.molecularFormula,
                preset,
            }),
        });
        setSolventSearchError(null);
        setSolventClassConflict(null);
    };

    const searchCustomSolvent = async (
        componentId: string,
        requestedClass: 'organic_non_halogen' | 'organic_halogen',
    ) => {
        const query = solventSearchInputs[componentId]?.trim() ?? '';
        if (!query || solventSearchLoading) return;
        setSolventSearchLoading(true);
        setSolventSearchError(null);
        try {
            const resolution = await resolveCustomOrganicSolvent(query);
            if (!resolution.isSolventVerified || !resolution.solventName
                || (resolution.solventClass !== 'organic_non_halogen'
                    && resolution.solventClass !== 'organic_halogen')) {
                setSolventSearchError(t('waste_solution_search_unresolved'));
                return;
            }
            if (resolution.solventClass !== requestedClass) {
                setSolventClassConflict({ cartLineId: componentId, requestedClass, resolution });
                return;
            }
            updateComponent(componentId, {
                solutionContext: createUserSolutionContext(requestedClass, {
                    name: resolution.solventName,
                    casNumber: resolution.solventCasNumber,
                    molecularFormula: resolution.solventMolecularFormula,
                }),
            });
        } finally {
            setSolventSearchLoading(false);
        }
    };

    const moveWizardBack = () => {
        if (showAiDetail) {
            setShowAiDetail(false);
            return;
        }
        if (activeStep === 'solution' && safeSolutionQuestionIndex > 0) {
            setSolutionQuestionIndex((index) => Math.max(0, index - 1));
            return;
        }
        if (activeStep === 'amounts' && safeAmountQuestionIndex > 0) {
            setAmountQuestionIndex((index) => Math.max(0, index - 1));
            return;
        }
        setActiveStep(getPreviousWizardStep(activeStep, wizard));
    };

    const moveWizardNext = () => {
        if (activeStep === 'components') {
            if (!wizard.componentStepComplete || hasInvalidNumericInput) return;
        }
        if (activeStep === 'amounts') {
            if (!activeAmountComponent || hasInvalidNumericInput) return;
            if (safeAmountQuestionIndex < batch.components.length - 1) {
                setAmountQuestionIndex((index) => index + 1);
                return;
            }
        }
        if (activeStep === 'solution') {
            if (!activeSolutionComponent || !isSolutionContextAnswered(activeSolutionComponent)) return;
            if (safeSolutionQuestionIndex < solutionQuestionComponents.length - 1) {
                setSolutionQuestionIndex((index) => index + 1);
                return;
            }
            if (!wizard.solutionStepComplete) {
                const firstUnanswered = solutionQuestionComponents.findIndex(
                    (component) => !isSolutionContextAnswered(component),
                );
                if (firstUnanswered >= 0) setSolutionQuestionIndex(firstUnanswered);
                return;
            }
        }
        if (activeStep === 'batch' && !wizard.batchStepComplete) return;
        setActiveStep(getNextWizardStep(activeStep, wizard));
    };

    const requestAIGuide = async () => {
        const requestedBatchId = batch.id;
        const requestSequence = ++aiRequestSequenceRef.current;
        setAiLoading(true);
        setAiError(false);
        try {
            const result = await getAIDisposalGuide(
                batch.components.map((component) => ({
                    name: component.chemical.name,
                    casNumber: component.chemical.casNumber,
                    molecularFormula: component.chemical.molecularFormula,
                    pubchemCid: /^\d+$/.test(component.chemical.id) ? Number(component.chemical.id) : undefined,
                    koshaChemId: component.chemical.koshaId,
                    category: component.category,
                    hazardFlags: component.hazardFlags,
                    concentration: component.concentration,
                    solutionVolume: component.solutionVolume,
                    solutionContext: component.solutionContext,
                    phCatalogId: component.phCatalogId,
                    ghs: {
                        signalWord: component.chemical.ghs?.signal,
                        hCodes: extractHCodes(component.chemical.ghs?.hazardStatements),
                        hazardStatements: component.chemical.ghs?.hazardStatements,
                        pictograms: component.chemical.ghs?.pictograms,
                        dataStatus: component.ghsDataStatus,
                    },
                    source: component.sourceType,
                })),
                {
                    sourceScreen: 'waste_batch',
                    triggerSource: 'waste_batch_ai_guide',
                    batch: {
                        batchId: batch.id,
                        matrix: batch.matrix,
                        amount: {
                            value: batch.totalAmount.value ?? undefined,
                            unit: batch.totalAmount.unit ?? undefined,
                            approximate: batch.totalAmount.isApproximate,
                            unknown: batch.totalAmount.isUnknown,
                        },
                        measuredBatchPh: batch.measuredBatchPh,
                        mixingState: batch.mixingState,
                        ...(phPrediction ? {
                            predictedPh: {
                                status: phPrediction.status,
                                value: phPrediction.value,
                                ionicStrength: phPrediction.ionicStrength,
                                confidence: phPrediction.confidence,
                                issueCodes: phPrediction.issueCodes,
                                modelVersion: phPrediction.modelVersion,
                                catalogVersion: phPrediction.catalogVersion,
                                inputHash: phPrediction.inputHash,
                            },
                        } : {}),
                        hazardFlags: decision.hazardFlags,
                        compatibilityWarnings: compatibilityWarnings.map((warning) => ({
                            severity: warning.severity,
                            code: warning.ruleId,
                            message: t(warning.messageKey as never),
                        })),
                    },
                    decision: {
                        decisionStatus: decision.decisionStatus,
                        streamCode: decision.streamCode,
                        allowedActions: decision.allowedActions,
                        blockingReasons: decision.blockingReasons.map(({ messageKey }) => messageKey),
                        missingFields: decision.missingFields,
                        policyVersion: decision.policyVersion,
                        ruleVersion: decision.ruleVersion,
                    },
                    policy: matchedStream ? {
                        version: matchedStream.policyVersionId ?? decision.policyVersion,
                        stream: {
                            streamCode: matchedStream.streamCode,
                            name: streamName,
                            location: matchedStream.location ?? undefined,
                            containerLabel: matchedStream.containerLabel ?? undefined,
                            labelInstructions: matchedStream.labelRequirements,
                            handlerContact: matchedStream.handlerContact ?? undefined,
                            sopUrl: matchedStream.sopUrl ?? undefined,
                            prohibitions: matchedStream.prohibitions,
                            allowedHazardFlags: matchedStream.allowedHazardFlags,
                            blockedHazardFlags: matchedStream.blockedHazardFlags,
                            evidence: matchedStream.sourceRefs.map((reference, index) => ({
                                id: `policy-${index}`,
                                sourceType: 'policy' as const,
                                title: reference.title,
                                reference: reference.url ?? undefined,
                            })),
                        },
                    } : { version: decision.policyVersion },
                    ruleVersion: decision.ruleVersion,
                },
            );
            if (
                aiRequestSequenceRef.current !== requestSequence ||
                useWasteStore.getState().batch.id !== requestedBatchId
            ) return;
            setAiResult(result);
        } catch {
            if (
                aiRequestSequenceRef.current === requestSequence &&
                useWasteStore.getState().batch.id === requestedBatchId
            ) setAiError(true);
        } finally {
            if (
                aiRequestSequenceRef.current === requestSequence &&
                useWasteStore.getState().batch.id === requestedBatchId
            ) setAiLoading(false);
        }
    };

    const recordAction = async (handlingAction: HandlingAction) => {
        if (!isOnline || isSaving || hasInvalidConcentration) return;
        const batchSnapshot = batch;
        const policySnapshot = policy;
        setIsSaving(true);
        setSaveError(null);
        setPolicyGuardMessage(null);
        try {
            let authorizationForRecord: PredictedPhAuthorization | null = null;
            let approvedPredictedPhForRecord: number | undefined;
            let resolutionSnapshot = policyResolution;
            if (resolutionSnapshot.decision.routingBasis === 'predicted_batch_ph') {
                // Always obtain a fresh single-use authorization for the final
                // write. This prevents a retry from reusing an authorization
                // that a prior RPC may already have consumed.
                authorizationForRecord = await authorizePredictedPhForWasteBatch(batchSnapshot);
                approvedPredictedPhForRecord = getPredictedPhForRouting(authorizationForRecord.prediction);
                if (approvedPredictedPhForRecord === undefined) {
                    throw new Error('The server did not approve this predicted pH for routing.');
                }
                resolutionSnapshot = resolveWasteDecisionAgainstPolicy(batchSnapshot, policySnapshot, {
                    approvedPredictedBatchPh: approvedPredictedPhForRecord,
                });
            }

            let latestPolicy: ActiveWastePolicy;
            try {
                latestPolicy = await getActiveWastePolicyV2(currentLabId);
            } catch (error) {
                console.error('Failed to recheck the active waste policy before recording:', error);
                setPolicyGuardMessage(t('waste_policy_recheck_failed'));
                return;
            }

            const currentBatch = useWasteStore.getState().batch;
            if (
                currentBatch.id !== batchSnapshot.id ||
                currentBatch.updatedAt !== batchSnapshot.updatedAt
            ) {
                setPolicy(latestPolicy);
                setPolicyGuardMessage(t('waste_batch_changed_retry'));
                return;
            }

            const latestResolution = resolveWasteDecisionAgainstPolicy(batchSnapshot, latestPolicy, {
                approvedPredictedBatchPh: approvedPredictedPhForRecord,
            });
            setPolicy(latestPolicy);
            if (hasWastePolicyContextChanged(
                policySnapshot,
                resolutionSnapshot,
                latestPolicy,
                latestResolution,
            )) {
                setPolicyGuardMessage(t('waste_policy_changed_refresh'));
                requestIdRef.current = null;
                requestFingerprintRef.current = null;
                return;
            }

            const attemptFingerprint = `${handlingAction}:${requestPayloadFingerprint}`;
            if (requestFingerprintRef.current !== attemptFingerprint) {
                requestIdRef.current = createRequestId();
                requestFingerprintRef.current = attemptFingerprint;
            }
            const requestId = requestIdRef.current ?? createRequestId();
            requestIdRef.current = requestId;
            const predictionForAudit = authorizationForRecord?.prediction ?? phPrediction;
            const result = await recordWasteHandlingV2({
                batch: batchSnapshot,
                decision: resolutionSnapshot.decision,
                handlingAction,
                memo,
                requestId,
                ...(predictionForAudit ? {
                    phPredictionSnapshot: createPhPredictionAuditSnapshot(
                        predictionForAudit,
                        batchSnapshot.updatedAt,
                    ),
                } : {}),
                confirmationSnapshot: {
                    mixingState: batchSnapshot.mixingState,
                    ...(batchSnapshot.mixingState === 'unknown'
                        ? {}
                        : { alreadyMixed: batchSnapshot.mixingState === 'already_mixed' }),
                    ...(authorizationForRecord && resolutionSnapshot.decision.routingBasis === 'predicted_batch_ph'
                        ? { predictedPhAuthorizationId: authorizationForRecord.authorizationId }
                        : {}),
                },
            });
            setReceipt(result);
            rememberCurrentMatrix();
            clearCart();
            requestIdRef.current = null;
            requestFingerprintRef.current = null;
            onDisposed?.();
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : t('waste_record_failed'));
        } finally {
            setIsSaving(false);
        }
    };

    const statusConfig = decision.decisionStatus === 'ready'
        ? {
            title: t('waste_decision_ready'),
            classes: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-100',
            icon: <PackageCheck className="h-5 w-5 text-blue-600" aria-hidden="true" />,
        }
        : decision.decisionStatus === 'blocked'
            ? {
                title: t('waste_decision_blocked'),
                classes: 'border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100',
                icon: <AlertOctagon className="h-5 w-5 text-red-600" aria-hidden="true" />,
            }
            : {
                title: t('waste_decision_needs_input', { count: decision.missingFields.length }),
                classes: 'border-orange-200 bg-orange-50 text-orange-950 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100',
                icon: <Info className="h-5 w-5 text-orange-600" aria-hidden="true" />,
            };

    const phPredictionSummary = (phPrediction || shouldShowPhPredictionMatrixUnavailable) ? (
        <div
            className="rounded-xl border border-cyan-200 bg-cyan-50/85 p-2.5 text-cyan-950 dark:border-cyan-900/70 dark:bg-cyan-950/35 dark:text-cyan-100 lg:p-3"
            aria-label={t('waste_ph_prediction_title')}
        >
            <div className="min-w-0">
                    {phPrediction && canDisplayPhPredictionNumber(phPrediction) ? (
                        <>
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="text-lg font-black">
                                    {t('waste_ph_prediction_value', {
                                        value: (phPrediction.displayValue ?? phPrediction.value)?.toFixed(1),
                                    })}
                                </p>
                                <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-bold text-cyan-800 dark:bg-cyan-900/70 dark:text-cyan-100">
                                    {t(`waste_ph_prediction_confidence_${phPrediction.confidence}` as never)}
                                </span>
                            </div>
                            <p className="mt-2 text-xs font-semibold leading-5">
                                {t('waste_ph_prediction_safety')}
                            </p>
                            {activePredictedPhAuthorization && (
                                <p className="mt-1 text-xs font-bold leading-5 text-cyan-800 dark:text-cyan-200">
                                    {t('waste_ph_prediction_authorized')}
                                </p>
                            )}
                        </>
                    ) : phPrediction ? (
                        <p className="text-xs font-semibold leading-5">
                            {phPrediction.issueCodes[0]
                                ? t(`waste_ph_prediction_issue_${phPrediction.issueCodes[0]}` as never, {
                                    defaultValue: t('waste_ph_prediction_no_detail'),
                                })
                                : t(`waste_ph_prediction_status_${phPrediction.status}` as never, {
                                    defaultValue: t('waste_ph_prediction_no_detail'),
                                })}
                        </p>
                    ) : (
                        <>
                            <p className="text-xs font-semibold leading-5">
                                {t('waste_ph_prediction_issue_matrix_not_aqueous')}
                            </p>
                            <p className="mt-1 text-xs leading-5 opacity-75">
                                {t('waste_ph_prediction_matrix_notice_help')}
                            </p>
                        </>
                    )}
            </div>
        </div>
    ) : null;

    if (receipt) {
        return (
            <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center">
                <button className="absolute inset-0 bg-black/50" onClick={onClose} aria-label={t('close')} />
                <div
                    ref={dialogRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="waste-receipt-title"
                    tabIndex={-1}
                    className="relative z-10 w-full max-w-lg rounded-t-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 lg:rounded-3xl"
                >
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        <Check className="h-7 w-7" aria-hidden="true" />
                    </div>
                    <h2 id="waste-receipt-title" className="text-center text-xl font-bold text-slate-950 dark:text-white">
                        {t('waste_record_success')}
                    </h2>
                    <dl className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-800">
                        <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">{t('waste_receipt_handling_action')}</dt>
                            <dd className="text-right font-semibold text-slate-900 dark:text-white">
                                {t(`waste_action_${receipt.handlingAction}` as never)}
                            </dd>
                        </div>
                        <div className="mt-2 flex justify-between gap-4">
                            <dt className="text-slate-500">
                                {receipt.handlingAction === 'container_deposit'
                                    ? t('waste_destination')
                                    : t('waste_receipt_stream_classification')}
                            </dt>
                            <dd className="text-right font-semibold text-slate-900 dark:text-white">
                                <span className="block">
                                    {receipt.handlingAction === 'container_deposit'
                                        ? receiptStreamName
                                        : receiptStreamClassification}
                                </span>
                                {receipt.handlingAction === 'container_deposit' && receipt.streamSnapshot.location && (
                                    <span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-slate-400">
                                        {receipt.streamSnapshot.location}
                                    </span>
                                )}
                            </dd>
                        </div>
                    </dl>
                    <div aria-live="polite" className="sr-only">{t('waste_record_success')}</div>
                    <div className="mt-5 grid grid-cols-2 gap-3">
                        <button
                            data-dialog-initial-focus
                            onClick={() => {
                                if (onAddComponent) onAddComponent();
                                else onClose();
                            }}
                            className="min-h-11 rounded-xl border border-slate-200 px-4 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                            {t('waste_receipt_continue')}
                        </button>
                        <button
                            onClick={() => {
                                onClose();
                                onOpenLogs?.(receipt.id, false);
                            }}
                            className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-700"
                        >
                            {t('waste_receipt_view')}
                        </button>
                        <button
                            onClick={() => {
                                onClose();
                                onOpenLogs?.(receipt.id, true);
                            }}
                            className="col-span-2 min-h-11 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                            {t('waste_receipt_correct')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-stretch lg:justify-end">
            <button className="absolute inset-0 bg-black/50" onClick={requestClose} aria-label={t('close')} />
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="waste-batch-title"
                tabIndex={-1}
                className="relative z-10 flex max-h-[96dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-950 lg:h-full lg:max-h-none lg:w-[min(760px,70vw)] lg:rounded-none lg:border-l lg:border-slate-200 dark:lg:border-slate-800"
            >
                <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] dark:border-slate-800 dark:bg-slate-950 lg:px-4 lg:pb-3 lg:pt-3">
                    <div>
                        <h2 id="waste-batch-title" className="text-base font-bold text-slate-950 dark:text-white lg:text-lg">
                            {t('cart_title')} <span className="text-blue-600">({batch.components.length})</span>
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-500">
                            {batch.scopeKey.endsWith(':personal')
                                ? t('lab_personal_space')
                                : currentLabName || t('lab_default_name')}
                        </p>
                    </div>
                    <button
                        data-dialog-initial-focus
                        onClick={requestClose}
                        aria-label={t('close')}
                        className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </header>

                <main
                    ref={wizardScrollRef}
                    className={`min-h-0 flex-1 overflow-y-auto bg-slate-100 p-2 dark:bg-slate-900 lg:p-6 ${
                        activeStep === 'result' && decision.decisionStatus === 'blocked'
                            ? 'pb-60 lg:pb-60'
                            : 'pb-24 lg:pb-32'
                    }`}
                >
                    <div className="mx-auto w-full max-w-2xl space-y-4 rounded-xl bg-white p-3 shadow-sm dark:bg-slate-950 lg:space-y-5 lg:rounded-2xl lg:p-6">
                        <div className="flex items-start justify-between gap-2 lg:gap-3">
                            <div>
                                <p className="text-xs font-bold text-blue-600">
                                    {t('waste_wizard_progress', {
                                        current: WIZARD_STEP_NUMBER[activeStep],
                                        total: WASTE_BATCH_WIZARD_STEPS.length,
                                    })}
                                </p>
                                <h3
                                    ref={wizardTitleRef}
                                    tabIndex={-1}
                                    className="mt-0.5 text-lg font-black text-slate-950 outline-none dark:text-white lg:mt-1 lg:text-xl"
                                >
                                    {showAiDetail
                                        ? t('waste_wizard_ai_title')
                                        : t(`waste_wizard_step_${activeStep}` as never)}
                                </h3>
                            </div>
                            {!showAiDetail && (
                                <div className="flex gap-1" aria-label={t('waste_wizard_steps')}>
                                    {WASTE_BATCH_WIZARD_STEPS.map((step) => {
                                        const current = step === activeStep;
                                        const completed = wizard.completedSteps.includes(step)
                                            || step === 'result' && wizard.batchStepComplete;
                                        const relevant = wizard.relevantSteps.includes(step);
                                        const prior = WIZARD_STEP_NUMBER[step] < WIZARD_STEP_NUMBER[activeStep];
                                        return (
                                            <button
                                                key={step}
                                                type="button"
                                                aria-current={current ? 'step' : undefined}
                                                aria-label={t(`waste_wizard_step_${step}` as never)}
                                                disabled={!relevant || (!completed && !current && !prior)}
                                                onClick={() => {
                                                    if (completed || current || prior) setActiveStep(step);
                                                }}
                                                className={`h-2 w-7 rounded-full lg:h-2.5 lg:w-8 ${current
                                                    ? 'bg-blue-600'
                                                    : prior && relevant
                                                        ? 'bg-blue-300 hover:bg-blue-400'
                                                        : 'bg-slate-200 dark:bg-slate-700'
                                                } disabled:cursor-not-allowed`}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                    {(activeStep === 'components' || activeStep === 'amounts') && !showAiDetail && (
                        <>
                    <section aria-labelledby="waste-components-title">
                        {activeStep === 'components' && (
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <h3 id="waste-components-title" className="font-bold text-slate-900 dark:text-white">
                                {t('waste_components_title', { defaultValue: '성분' })}
                            </h3>
                            {batch.components.length > 0 && (
                                <div className="flex flex-wrap justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={parkBatchAndStartNew}
                                        className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
                                    >
                                        {t('waste_park_batch')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={discardAndStartNew}
                                        className="min-h-11 rounded-lg px-3 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                                    >
                                        {t('waste_clear_batch')}
                                    </button>
                                </div>
                            )}
                        </div>
                        )}
                        {activeStep === 'amounts' && (
                            <p className="mb-2 text-xs font-bold text-blue-600">
                                {t('waste_amount_question_progress', {
                                    current: safeAmountQuestionIndex + 1,
                                    total: batch.components.length,
                                })}
                            </p>
                        )}
                        {activeStep === 'components' && (
                        <div aria-live="polite" className="mb-2 text-sm font-medium text-blue-700 dark:text-blue-300">
                            {batchMessage}
                        </div>
                        )}
                        {batch.components.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                                {t('cart_empty')}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {batch.components
                                    .filter((component) => activeStep === 'components'
                                        || component.cartLineId === activeAmountComponent?.cartLineId)
                                    .map((component) => (
                                    <article key={component.cartLineId} className="rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900 lg:rounded-2xl lg:p-3">
                                        <div className="flex items-start gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h4 className="font-semibold text-slate-900 dark:text-white">{component.chemical.name}</h4>
                                                    {component.identityConfidence === 'verified' && component.identityConfirmedByUser && (
                                                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                                            {t('waste_component_user_verified')}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="mt-0.5 text-xs text-slate-500">
                                                    {component.chemical.casNumber ? `CAS ${component.chemical.casNumber}` : t(component.label as never)}
                                                </p>
                                                {activeStep === 'components' && component.inventorySnapshot && (
                                                    <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                                        {[
                                                            component.inventorySnapshot.brand,
                                                            component.inventorySnapshot.productNumber,
                                                            component.inventorySnapshot.location,
                                                            component.inventorySnapshot.nominalCapacity,
                                                            component.inventorySnapshot.remainingPercent !== null && component.inventorySnapshot.remainingPercent !== undefined
                                                                ? `${t('inventory_remaining')}: ${component.inventorySnapshot.remainingPercent}%`
                                                                : null,
                                                        ].filter(Boolean).join(' · ')}
                                                    </p>
                                                )}
                                                {activeStep === 'components' && (component.solutionVolume || component.concentration) && (
                                                    <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                                                        {[
                                                            component.solutionVolume
                                                                ? `${component.solutionVolume.value} ${component.solutionVolume.unit}`
                                                                : null,
                                                            component.concentration
                                                                ? `${component.concentration.value} ${component.concentration.unit}${component.concentration.unit === '%' && component.concentration.basis
                                                                    ? ` (${component.concentration.basis.replace('_', '/')})`
                                                                    : ''}`
                                                                : null,
                                                        ].filter(Boolean).join(' · ')}
                                                    </p>
                                                )}
                                                {activeStep === 'components' && isPhPredictionEnabled && (
                                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                        {t('waste_component_ph_form_summary', {
                                                            value: component.phCatalogId ?? t('waste_ph_catalog_form_unmatched'),
                                                        })}
                                                    </p>
                                                )}
                                                {activeStep === 'components' && component.concentration && (
                                                    <p className={`mt-1 text-xs font-semibold ${isSolutionContextAnswered(component)
                                                        ? 'text-blue-700 dark:text-blue-300'
                                                        : 'text-orange-700 dark:text-orange-300'
                                                    }`}>
                                                        {isSolutionContextAnswered(component)
                                                            ? t('waste_component_solution_summary', {
                                                                value: component.solutionContext?.solventName
                                                                    ?? t(`waste_solution_${component.solutionContext?.solventClass === 'aqueous'
                                                                        ? 'water'
                                                                        : component.solutionContext?.solventClass === 'organic_halogen'
                                                                            ? 'halogen'
                                                                            : component.solutionContext?.solventClass === 'organic_non_halogen'
                                                                                ? 'non_halogen'
                                                                                : 'unknown'}` as never),
                                                            })
                                                            : t('waste_component_solution_unanswered')}
                                                    </p>
                                                )}
                                                {activeStep === 'components' && component.identityConfidence !== 'verified' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => updateComponent(component.cartLineId, {
                                                            identityConfidence: 'verified',
                                                            identityConfirmedByUser: true,
                                                        })}
                                                        className="mt-2 min-h-11 rounded-lg border border-orange-300 bg-orange-50 px-3 text-xs font-bold text-orange-800 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200"
                                                    >
                                                        {t('waste_confirm_component_identity')}
                                                    </button>
                                                )}
                                                {activeStep === 'components' && component.chemical.hazardLookup?.status === 'classified' && (
                                                    <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" role="status">
                                                        {t('waste_component_hazard_classified')}
                                                    </p>
                                                )}
                                                {activeStep === 'components' && component.chemical.hazardLookup?.status === 'transient_error' && (component.enrichmentRetryCount ?? 0) < 2 && (
                                                    <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900 dark:bg-blue-950/40 dark:text-blue-100" role="status">
                                                        {t('waste_component_hazard_pending')}
                                                    </p>
                                                )}
                                                {activeStep === 'components' && !component.chemical.hazardLookup && !component.hazardDataConfirmedByUser && (
                                                    <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900 dark:bg-blue-950/40 dark:text-blue-100" role="status">
                                                        {t('waste_component_hazard_pending')}
                                                    </p>
                                                )}
                                                {activeStep === 'components' && component.ghsDataStatus === 'lookup_failed' && Boolean(component.chemical.hazardLookup) && !component.hazardDataConfirmedByUser && (
                                                    <p className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-xs font-medium text-orange-900 dark:bg-orange-950/40 dark:text-orange-100" role="status">
                                                        {component.chemical.hazardLookup?.status === 'identity_ambiguous'
                                                            ? t('waste_component_hazard_identity_ambiguous')
                                                            : component.chemical.hazardLookup?.status === 'source_absent'
                                                                ? t('waste_component_hazard_source_absent')
                                                                : t('waste_component_hazard_lookup_failed')}
                                                    </p>
                                                )}
                                            </div>
                                            {activeStep === 'components' && (
                                            <>
                                            <button
                                                onClick={() => {
                                                    const isClosing = editingLineId === component.cartLineId;
                                                    setEditingLineId(isClosing ? null : component.cartLineId);
                                                    if (!isClosing) {
                                                        setConcentrationInputs((current) => ({
                                                            ...current,
                                                            [component.cartLineId]: component.concentration?.value.toString() ?? '',
                                                        }));
                                                        setConcentrationUnits((current) => ({
                                                            ...current,
                                                            [component.cartLineId]: component.concentration?.unit ?? 'M',
                                                        }));
                                                        setSolutionVolumeInputs((current) => ({
                                                            ...current,
                                                            [component.cartLineId]: component.solutionVolume?.value.toString() ?? '',
                                                        }));
                                                        setSolutionVolumeUnits((current) => ({
                                                            ...current,
                                                            [component.cartLineId]: component.solutionVolume?.unit ?? 'mL',
                                                        }));
                                                        setDensityInputs((current) => ({
                                                            ...current,
                                                            [component.cartLineId]: component.concentration?.density?.value.toString() ?? '',
                                                        }));
                                                    }
                                                }}
                                                aria-label={`${component.chemical.name} ${t('waste_component_edit')}`}
                                                aria-expanded={editingLineId === component.cartLineId}
                                                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${editingLineId === component.cartLineId
                                                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200'
                                                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                                }`}
                                            >
                                                <Edit3 className="h-4 w-4" aria-hidden="true" />
                                            </button>
                                            <button
                                                onClick={() => removeFromCart(component.cartLineId)}
                                                aria-label={`${component.chemical.name} ${t('waste_component_remove')}`}
                                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                                            >
                                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                                            </button>
                                            </>
                                            )}
                                        </div>
                                        {activeStep === 'components' && component.sourceType === 'inventory' && component.inventoryId && (
                                            <label className="mt-3 block rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs font-semibold text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
                                                <span className="flex flex-wrap items-center justify-between gap-2">
                                                    <span>{t('waste_inventory_disposal_quantity')}</span>
                                                    <span className="font-normal opacity-75">
                                                        {t('waste_inventory_available_quantity', {
                                                            count: component.inventorySnapshot?.quantity ?? 1,
                                                        })}
                                                    </span>
                                                </span>
                                                <input
                                                    type="number"
                                                    inputMode="numeric"
                                                    min={1}
                                                    max={component.inventorySnapshot?.quantity ?? 1}
                                                    step={1}
                                                    value={component.inventoryDisposalQuantity ?? ''}
                                                    aria-invalid={component.inventoryDisposalQuantity === undefined}
                                                    onChange={(event) => {
                                                        const parsed = Number(event.target.value);
                                                        const available = component.inventorySnapshot?.quantity ?? 1;
                                                        updateComponent(component.cartLineId, {
                                                            inventoryDisposalQuantity: event.target.value &&
                                                                Number.isInteger(parsed) && parsed >= 1 && parsed <= available
                                                                ? parsed
                                                                : undefined,
                                                        });
                                                    }}
                                                    className="mt-2 h-11 w-full rounded-xl border border-blue-200 bg-white px-3 text-base text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-blue-800 dark:bg-slate-950 dark:text-white"
                                                />
                                            </label>
                                        )}
                                        {(activeStep === 'amounts' || editingLineId === component.cartLineId) && (
                                            <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                                                {activeStep === 'amounts' && (
                                                <>
                                                <div className="grid grid-cols-[1fr_110px] gap-2">
                                                    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                                        {t('waste_component_solution_volume')}
                                                        <input
                                                            type="number"
                                                            inputMode="decimal"
                                                            min="0.000001"
                                                            step="any"
                                                            value={solutionVolumeInputs[component.cartLineId] ?? component.solutionVolume?.value ?? ''}
                                                            aria-invalid={isInvalidConcentrationText(solutionVolumeInputs[component.cartLineId])}
                                                            aria-describedby={isInvalidConcentrationText(solutionVolumeInputs[component.cartLineId])
                                                                ? `solution-volume-error-${component.cartLineId}`
                                                                : undefined}
                                                            onChange={(event) => {
                                                                const rawValue = event.target.value;
                                                                const value = Number(rawValue);
                                                                const unit = solutionVolumeUnits[component.cartLineId]
                                                                    ?? component.solutionVolume?.unit
                                                                    ?? 'mL';
                                                                setSolutionVolumeInputs((current) => ({
                                                                    ...current,
                                                                    [component.cartLineId]: rawValue,
                                                                }));
                                                                updateComponent(component.cartLineId, {
                                                                    solutionVolume: rawValue && Number.isFinite(value) && value > 0
                                                                        ? {
                                                                            value,
                                                                            unit,
                                                                            normalizedMl: normalizeSolutionVolumeMl(value, unit),
                                                                        }
                                                                        : undefined,
                                                                });
                                                            }}
                                                            className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base aria-[invalid=true]:border-red-500 dark:border-slate-700 dark:bg-slate-950"
                                                        />
                                                    </label>
                                                    <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                                        <span>{t('unit', { defaultValue: '단위' })}</span>
                                                        <AppSelect
                                                            value={solutionVolumeUnits[component.cartLineId] ?? component.solutionVolume?.unit ?? 'mL'}
                                                            onChange={(value) => {
                                                                const unit = value as WasteSolutionVolumeUnit;
                                                                setSolutionVolumeUnits((current) => ({
                                                                    ...current,
                                                                    [component.cartLineId]: unit,
                                                                }));
                                                                if (component.solutionVolume) {
                                                                    updateComponent(component.cartLineId, {
                                                                        solutionVolume: {
                                                                            ...component.solutionVolume,
                                                                            unit,
                                                                            normalizedMl: normalizeSolutionVolumeMl(component.solutionVolume.value, unit),
                                                                        },
                                                                    });
                                                                }
                                                            }}
                                                            options={SOLUTION_VOLUME_UNITS.map((unit) => ({ value: unit, label: unit }))}
                                                            ariaLabel={t('unit', { defaultValue: '단위' })}
                                                            className="mt-1 w-full"
                                                            buttonClassName="!min-h-11 !rounded-xl !border-slate-300 !bg-white !px-2 dark:!border-slate-700 dark:!bg-slate-950"
                                                        />
                                                    </div>
                                                </div>
                                                {isInvalidConcentrationText(solutionVolumeInputs[component.cartLineId]) && (
                                                    <p id={`solution-volume-error-${component.cartLineId}`} className="text-xs font-medium text-red-600 dark:text-red-300">
                                                        {t('waste_component_volume_positive')}
                                                    </p>
                                                )}
                                                <div className="grid grid-cols-[1fr_110px] gap-2">
                                                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                                    {t('waste_component_concentration')}
                                                    <input
                                                        type="number"
                                                        min="0.000001"
                                                        step="any"
                                                        value={concentrationInputs[component.cartLineId] ?? component.concentration?.value ?? ''}
                                                        aria-invalid={isInvalidConcentrationText(concentrationInputs[component.cartLineId])}
                                                        aria-describedby={isInvalidConcentrationText(concentrationInputs[component.cartLineId])
                                                            ? `concentration-error-${component.cartLineId}`
                                                            : undefined}
                                                        onChange={(event) => {
                                                            const rawValue = event.target.value;
                                                            const value = Number(rawValue);
                                                            setConcentrationInputs((current) => ({
                                                                ...current,
                                                                [component.cartLineId]: rawValue,
                                                            }));
                                                            updateComponent(component.cartLineId, {
                                                                concentration: rawValue && Number.isFinite(value) && value > 0
                                                                    ? {
                                                                        ...component.concentration,
                                                                        value,
                                                                        unit: concentrationUnits[component.cartLineId]
                                                                            ?? component.concentration?.unit
                                                                            ?? 'M',
                                                                    }
                                                                    : undefined,
                                                            });
                                                        }}
                                                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base aria-[invalid=true]:border-red-500 dark:border-slate-700 dark:bg-slate-950"
                                                    />
                                                </label>
                                                <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                                    <span>{t('unit', { defaultValue: '단위' })}</span>
                                                    <AppSelect
                                                        value={concentrationUnits[component.cartLineId] ?? component.concentration?.unit ?? 'M'}
                                                        onChange={(value) => {
                                                            const unit = value as ConcentrationUnit;
                                                            setConcentrationUnits((current) => ({
                                                                ...current,
                                                                [component.cartLineId]: unit,
                                                            }));
                                                            if (component.concentration) {
                                                                updateComponent(component.cartLineId, {
                                                                    concentration: unit === '%'
                                                                        ? {
                                                                            ...component.concentration,
                                                                            unit,
                                                                        }
                                                                        : {
                                                                            value: component.concentration.value,
                                                                            unit,
                                                                        },
                                                                });
                                                            }
                                                        }}
                                                        options={CONCENTRATION_UNITS.map((unit) => ({ value: unit, label: unit }))}
                                                        ariaLabel={t('unit', { defaultValue: '단위' })}
                                                        className="mt-1 w-full"
                                                        buttonClassName="!min-h-11 !rounded-xl !border-slate-300 !bg-white !px-2 dark:!border-slate-700 dark:!bg-slate-950"
                                                    />
                                                </div>
                                                </div>
                                                {isInvalidConcentrationText(concentrationInputs[component.cartLineId]) && (
                                                    <p id={`concentration-error-${component.cartLineId}`} className="text-xs font-medium text-red-600 dark:text-red-300">
                                                        {t('waste_concentration_positive')}
                                                    </p>
                                                )}
                                                {(concentrationUnits[component.cartLineId] ?? component.concentration?.unit) === '%' && component.concentration && (
                                                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-950/40">
                                                        <div className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                                                            <span>{t('waste_concentration_percent_basis')}</span>
                                                            <AppSelect
                                                                value={component.concentration.basis ?? ''}
                                                                onChange={(value) => {
                                                                    const basis = value as WasteConcentrationBasis;
                                                                    const requiredDensityKind = basis === 'w_w' ? 'solution'
                                                                        : basis === 'v_v' ? 'solute'
                                                                            : null;
                                                                    const retainedDensity = requiredDensityKind &&
                                                                        component.concentration?.density?.kind === requiredDensityKind
                                                                        ? component.concentration.density
                                                                        : undefined;
                                                                    updateComponent(component.cartLineId, {
                                                                        concentration: {
                                                                            ...component.concentration!,
                                                                            basis,
                                                                            density: retainedDensity,
                                                                        },
                                                                    });
                                                                    if (!retainedDensity) {
                                                                        setDensityInputs((current) => ({
                                                                            ...current,
                                                                            [component.cartLineId]: '',
                                                                        }));
                                                                    }
                                                                }}
                                                                options={CONCENTRATION_BASES.map((basis) => ({
                                                                    value: basis,
                                                                    label: t(`waste_concentration_basis_${basis}` as never),
                                                                }))}
                                                                placeholder={t('waste_concentration_percent_basis')}
                                                                ariaLabel={t('waste_concentration_percent_basis')}
                                                                className="mt-1 w-full"
                                                                buttonClassName="!min-h-11 !rounded-xl !border-slate-300 !bg-white !px-3 dark:!border-slate-700 dark:!bg-slate-950"
                                                            />
                                                        </div>
                                                        {(component.concentration.basis === 'w_w' || component.concentration.basis === 'v_v') && (
                                                            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                                                                {t(component.concentration.basis === 'w_w'
                                                                    ? 'waste_concentration_solution_density'
                                                                    : 'waste_concentration_solute_density')}
                                                                <input
                                                                    type="number"
                                                                    inputMode="decimal"
                                                                    min="0.000001"
                                                                    step="any"
                                                                    value={densityInputs[component.cartLineId] ?? component.concentration.density?.value ?? ''}
                                                                    onChange={(event) => {
                                                                        const rawValue = event.target.value;
                                                                        const value = Number(rawValue);
                                                                        setDensityInputs((current) => ({
                                                                            ...current,
                                                                            [component.cartLineId]: rawValue,
                                                                        }));
                                                                        updateComponent(component.cartLineId, {
                                                                            concentration: {
                                                                                ...component.concentration!,
                                                                                density: rawValue && Number.isFinite(value) && value > 0
                                                                                    ? {
                                                                                        value,
                                                                                        unit: 'g/mL',
                                                                                        kind: component.concentration!.basis === 'w_w' ? 'solution' : 'solute',
                                                                                        source: 'user',
                                                                                        isEstimate: true,
                                                                                    }
                                                                                    : undefined,
                                                                            },
                                                                        });
                                                                    }}
                                                                    className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-950"
                                                                />
                                                            </label>
                                                        )}
                                                        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                                            {t('waste_concentration_density_help')}
                                                        </p>
                                                    </div>
                                                )}
                                                </>
                                                )}
                                                {activeStep === 'components' && isPhPredictionEnabled && (
                                                    <div className="block border-t border-slate-100 pt-3 text-xs font-medium text-slate-600 dark:border-slate-800 dark:text-slate-300">
                                                        <span>{t('waste_ph_catalog_form')}</span>
                                                        <AppSelect
                                                            value={component.phCatalogId && getApprovedPhCatalogOptions(component)
                                                                .some((record) => record.id === component.phCatalogId)
                                                                ? component.phCatalogId
                                                                : ''}
                                                            onChange={(value) => updateComponent(component.cartLineId, {
                                                                phCatalogId: value || undefined,
                                                                phCatalogMatch: value ? {
                                                                    status: 'matched',
                                                                    id: value,
                                                                    candidateIds: component.phCatalogMatch?.candidateIds ?? [value],
                                                                    matchedBy: component.phCatalogMatch?.matchedBy,
                                                                    catalogVersion: component.phCatalogMatch?.catalogVersion ?? '',
                                                                    selection: 'manual',
                                                                } : undefined,
                                                            })}
                                                            options={[
                                                                { value: '', label: t('waste_ph_catalog_form_unmatched') },
                                                                ...getApprovedPhCatalogOptions(component).map((record) => ({
                                                                    value: record.id,
                                                                    label: `${record.exactFormLabel}${record.casNumber ? ` · CAS ${record.casNumber}` : ''}`,
                                                                })),
                                                            ]}
                                                            ariaLabel={t('waste_ph_catalog_form')}
                                                            className="mt-1 w-full"
                                                            buttonClassName="!min-h-11 !rounded-xl !border-slate-200 !bg-white !px-3 !text-sm !text-slate-900 focus:!border-blue-500 focus:!ring-blue-500 dark:!border-slate-700 dark:!bg-slate-950 dark:!text-white"
                                                            menuClassName="w-full"
                                                        />
                                                        <span className="mt-1 block leading-relaxed text-slate-500 dark:text-slate-400">
                                                            {component.phCatalogMatch?.status === 'matched' && component.phCatalogMatch.selection === 'automatic'
                                                                ? t('waste_ph_catalog_auto_matched')
                                                                : component.phCatalogMatch?.status === 'ambiguous' && component.phCatalogMatch.candidateIds.length > 0
                                                                    ? t('waste_ph_catalog_candidates_only')
                                                                    : t('waste_ph_catalog_form_help')}
                                                        </span>
                                                    </div>
                                                )}
                                                {activeStep === 'components' &&
                                                    (component.ghsDataStatus === 'lookup_failed' || component.hazardDataConfirmedByUser) && (
                                                    <fieldset className="rounded-xl border border-orange-200 bg-orange-50/70 p-3 dark:border-orange-900 dark:bg-orange-950/30">
                                                        <legend className="px-1 text-xs font-bold text-orange-950 dark:text-orange-100">
                                                            {t('waste_manual_hazard_title')}
                                                        </legend>
                                                        <p className="mb-2 text-xs leading-relaxed text-orange-900 dark:text-orange-200">
                                                            {t('waste_manual_hazard_help')}
                                                        </p>
                                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                                            {MANUAL_HAZARD_OPTIONS.map((flag) => {
                                                                const selected = (component.manualHazardFlags ?? []).includes(flag);
                                                                return (
                                                                    <button
                                                                        key={flag}
                                                                        type="button"
                                                                        aria-pressed={selected}
                                                                        onClick={() => {
                                                                            const manualHazardFlags = selected
                                                                                ? (component.manualHazardFlags ?? []).filter((item) => item !== flag)
                                                                                : [...(component.manualHazardFlags ?? []), flag];
                                                                            updateComponent(component.cartLineId, {
                                                                                manualHazardFlags,
                                                                                hazardFlags: [...new Set([
                                                                                    ...(component.automaticHazardFlags ?? []),
                                                                                    ...manualHazardFlags,
                                                                                ])],
                                                                                hazardDataConfirmedByUser: false,
                                                                            });
                                                                        }}
                                                                        className={`min-h-11 rounded-lg border px-2 py-1.5 text-left text-xs font-semibold ${selected
                                                                            ? 'border-orange-500 bg-orange-100 text-orange-950 dark:bg-orange-900/60 dark:text-orange-50'
                                                                            : 'border-orange-200 bg-white text-slate-700 dark:border-orange-900 dark:bg-slate-950 dark:text-slate-200'
                                                                        }`}
                                                                    >
                                                                        {t(`waste_hazard_${flag}` as never)}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => updateComponent(component.cartLineId, {
                                                                hazardDataConfirmedByUser: true,
                                                            })}
                                                            className="mt-3 min-h-11 w-full rounded-lg bg-orange-600 px-3 text-sm font-bold text-white hover:bg-orange-700"
                                                        >
                                                            {t('waste_manual_hazard_confirm')}
                                                        </button>
                                                    </fieldset>
                                                )}
                                            </div>
                                        )}
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>

                    {activeStep === 'components' && parkedBatches.length > 0 && (
                        <section aria-labelledby="waste-parked-title" className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
                            <h3 id="waste-parked-title" className="font-bold text-slate-900 dark:text-white">
                                {t('waste_parked_title')} ({parkedBatches.length})
                            </h3>
                            {activeBatchHasContent && (
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {t('waste_restore_requires_empty')}
                                </p>
                            )}
                            <div className="mt-3 space-y-2">
                                {parkedBatches.map((parked) => (
                                    <article key={parked.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="font-semibold text-slate-900 dark:text-white">
                                                    {parked.displayName || t('waste_parked_unnamed')}
                                                </p>
                                                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                                    {t('waste_parked_summary', {
                                                        count: parked.components.length,
                                                        date: new Date(parked.parkedAt ?? parked.updatedAt).toLocaleString(
                                                            i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US',
                                                        ),
                                                    })}
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => restoreDraft(parked.id)}
                                                    disabled={activeBatchHasContent}
                                                    className="min-h-11 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {t('waste_restore_batch')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => removeParkedDraft(parked.id)}
                                                    aria-label={`${parked.displayName || t('waste_parked_unnamed')} ${t('waste_delete_parked')}`}
                                                    className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                                                >
                                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                                </button>
                                            </div>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section>
                    )}

                    {activeStep === 'components' && compatibilityWarnings.length > 0 && (
                        <section aria-labelledby="component-compatibility-title" className="space-y-2">
                            <h3 id="component-compatibility-title" className="font-bold text-slate-900 dark:text-white">
                                {t('compat_title')}
                            </h3>
                            {compatibilityWarnings.map((warning, index) => (
                                <div
                                    key={`early-${warning.ruleId}-${index}`}
                                    className={`rounded-xl border p-3 text-sm ${warning.severity === 'DANGER'
                                        ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100'
                                        : 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100'
                                    }`}
                                >
                                    <p className="font-semibold">{warning.chemicalA} + {warning.chemicalB}</p>
                                    <p className="mt-1">{t(warning.messageKey as never)}</p>
                                </div>
                            ))}
                        </section>
                    )}
                        </>
                    )}

                    {activeStep === 'solution' && !showAiDetail && activeSolutionComponent && (
                        <section aria-labelledby="waste-solution-question-title" className="space-y-3 lg:space-y-4">
                            <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900 lg:p-3">
                                <p className="text-xs font-bold text-blue-600">
                                    {t('waste_solution_question_progress', {
                                        current: safeSolutionQuestionIndex + 1,
                                        total: solutionQuestionComponents.length,
                                    })}
                                </p>
                                <h4 id="waste-solution-question-title" className="mt-1 text-lg font-bold text-slate-950 dark:text-white">
                                    {t('waste_solution_question', { name: activeSolutionComponent.chemical.name })}
                                </h4>
                                <p className="mt-1 text-sm text-slate-500">
                                    {[activeSolutionComponent.chemical.casNumber
                                        ? `CAS ${activeSolutionComponent.chemical.casNumber}`
                                        : null,
                                    activeSolutionComponent.concentration
                                        ? `${activeSolutionComponent.concentration.value} ${activeSolutionComponent.concentration.unit}`
                                        : null,
                                    ].filter(Boolean).join(' · ')}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                {([
                                    ['aqueous', 'waste_solution_water'],
                                    ['organic_non_halogen', 'waste_solution_non_halogen'],
                                    ['organic_halogen', 'waste_solution_halogen'],
                                    ['mixed_or_unknown', 'waste_solution_unknown'],
                                ] as const).map(([solventClass, labelKey]) => {
                                    const selected = activeSolutionComponent.solutionContext?.solventClass === solventClass;
                                    return (
                                        <button
                                            key={solventClass}
                                            type="button"
                                            aria-pressed={selected}
                                            onClick={() => selectSolutionClass(activeSolutionComponent.cartLineId, solventClass)}
                                            className={`min-h-12 rounded-xl border px-3 py-2 text-sm font-bold lg:min-h-14 ${selected
                                                ? 'border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-600 dark:bg-blue-950/40 dark:text-blue-100'
                                                : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                                            }`}
                                        >
                                            {t(labelKey)}
                                        </button>
                                    );
                                })}
                            </div>

                            {(activeSolutionComponent.concentration?.unit === 'M'
                                || activeSolutionComponent.concentration?.unit === 'mM') && (
                                <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
                                    {t('waste_solution_molarity_help')}
                                </p>
                            )}

                            {(activeSolutionComponent.solutionContext?.solventClass === 'organic_non_halogen'
                                || activeSolutionComponent.solutionContext?.solventClass === 'organic_halogen') && (() => {
                                const selectedClass = activeSolutionComponent.solutionContext!.solventClass as
                                    'organic_non_halogen' | 'organic_halogen';
                                return (
                                    <div className="space-y-2.5 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700 lg:space-y-3 lg:rounded-2xl lg:p-3">
                                        <div>
                                            <h5 className="text-sm font-bold text-slate-900 dark:text-white">
                                                {t('waste_solution_exact_solvent_optional')}
                                            </h5>
                                            <p className="mt-1 text-xs leading-5 text-slate-500">
                                                {t('waste_solution_exact_solvent_help')}
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                            {REPRESENTATIVE_SOLVENT_PRESETS[selectedClass].map((preset) => {
                                                const selected = activeSolutionComponent.solutionContext?.solventPreset === preset;
                                                return (
                                                    <button
                                                        key={preset}
                                                        type="button"
                                                        aria-pressed={selected}
                                                        onClick={() => selectSolventPreset(
                                                            activeSolutionComponent.cartLineId,
                                                            selectedClass,
                                                            preset,
                                                        )}
                                                        className={`min-h-11 rounded-lg border px-2 text-xs font-semibold ${selected
                                                            ? 'border-blue-600 bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-100'
                                                            : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                                                        }`}
                                                    >
                                                        {preset}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div className="flex gap-2">
                                            <input
                                                type="search"
                                                value={solventSearchInputs[activeSolutionComponent.cartLineId] ?? ''}
                                                onChange={(event) => setSolventSearchInputs((current) => ({
                                                    ...current,
                                                    [activeSolutionComponent.cartLineId]: event.target.value,
                                                }))}
                                                placeholder={t('waste_solution_search_placeholder')}
                                                className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => searchCustomSolvent(activeSolutionComponent.cartLineId, selectedClass)}
                                                disabled={solventSearchLoading || !(solventSearchInputs[activeSolutionComponent.cartLineId]?.trim())}
                                                className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950"
                                            >
                                                {solventSearchLoading ? t('loading') : t('search')}
                                            </button>
                                        </div>
                                        {solventSearchError && (
                                            <p className="text-xs font-semibold text-red-700 dark:text-red-300" role="alert">
                                                {solventSearchError}
                                            </p>
                                        )}
                                    </div>
                                );
                            })()}

                            {solventClassConflict?.cartLineId === activeSolutionComponent.cartLineId && (
                                <div className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-950 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100" role="alert">
                                    <p className="font-bold">{t('waste_solution_class_conflict_title')}</p>
                                    <p className="mt-1 leading-5">
                                        {t('waste_solution_class_conflict_help', {
                                            solvent: solventClassConflict.resolution.solventName,
                                            selected: t(solventClassConflict.requestedClass === 'organic_halogen'
                                                ? 'waste_solution_halogen'
                                                : 'waste_solution_non_halogen'),
                                            found: t(solventClassConflict.resolution.solventClass === 'organic_halogen'
                                                ? 'waste_solution_halogen'
                                                : 'waste_solution_non_halogen'),
                                        })}
                                    </p>
                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                selectSolutionClass(
                                                    activeSolutionComponent.cartLineId,
                                                    solventClassConflict.requestedClass,
                                                );
                                                setSolventClassConflict(null);
                                            }}
                                            className="min-h-11 rounded-lg border border-orange-400 bg-white px-2 text-xs font-bold text-orange-900 dark:bg-slate-950 dark:text-orange-100"
                                        >
                                            {t('waste_solution_keep_class_only')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const resolution = solventClassConflict.resolution;
                                                if (resolution.solventName && (resolution.solventClass === 'organic_halogen'
                                                    || resolution.solventClass === 'organic_non_halogen')) {
                                                    updateComponent(activeSolutionComponent.cartLineId, {
                                                        solutionContext: createUserSolutionContext(resolution.solventClass, {
                                                            name: resolution.solventName,
                                                            casNumber: resolution.solventCasNumber,
                                                            molecularFormula: resolution.solventMolecularFormula,
                                                        }),
                                                    });
                                                }
                                                setSolventClassConflict(null);
                                            }}
                                            className="min-h-11 rounded-lg bg-orange-600 px-2 text-xs font-bold text-white"
                                        >
                                            {t('waste_solution_use_search_class')}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {activeSolutionComponent.solutionContext?.solventName && (
                                <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900 dark:bg-blue-950/35 dark:text-blue-100">
                                    {t('waste_solution_selected_exact', {
                                        solvent: activeSolutionComponent.solutionContext.solventName,
                                        cas: activeSolutionComponent.solutionContext.solventCasNumber ?? t('waste_solution_cas_unverified'),
                                    })}
                                </p>
                            )}
                        </section>
                    )}

                    {activeStep === 'batch' && !showAiDetail && batch.components.length > 0 && (
                        <>
                            <section aria-labelledby="waste-matrix-title">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <h3 id="waste-matrix-title" className="font-bold text-slate-900 dark:text-white">
                                        {t('waste_matrix_title')}
                                    </h3>
                                </div>
                                {batch.matrixSource === 'automatic' && !isMatrixEditing ? (
                                    <div className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-blue-950 dark:border-blue-900 dark:bg-blue-950/35 dark:text-blue-100 lg:min-h-14 lg:gap-3 lg:px-4 lg:py-3">
                                        <p className="font-semibold">
                                            {t('waste_matrix_auto', {
                                                matrix: t(`waste_matrix_${batch.matrix}` as never),
                                            })}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => setIsMatrixEditing(true)}
                                            className="min-h-11 shrink-0 rounded-lg border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-slate-950 dark:text-blue-200"
                                        >
                                            {t('waste_matrix_change')}
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        {batch.matrix === 'unknown' && previousMatrix && !wizard.matrixResolution.hasExplicitOrganic && (
                                            <button
                                                type="button"
                                                onClick={applyPreviousMatrix}
                                                className="mb-2 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-sm font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                            >
                                                {t('waste_matrix_same_as_previous', {
                                                    matrix: t(`waste_matrix_${previousMatrix}` as never),
                                                })}
                                            </button>
                                        )}
                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                            {MATRIX_OPTIONS.map((matrix) => {
                                                const selected = batch.matrix === matrix;
                                                const inferredOrganicMatrix = wizard.matrixResolution.matrix;
                                                const disabledByExplicitOrganic = wizard.matrixResolution.hasExplicitOrganic
                                                    && matrix !== inferredOrganicMatrix
                                                    && matrix !== 'unknown';
                                                return (
                                                    <button
                                                        key={matrix}
                                                        type="button"
                                                        onClick={() => {
                                                            if (disabledByExplicitOrganic) return;
                                                            setMatrix(matrix);
                                                            setIsMatrixEditing(false);
                                                        }}
                                                        disabled={disabledByExplicitOrganic}
                                                        aria-pressed={selected}
                                                        className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${selected
                                                            ? 'border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-600 dark:bg-blue-950/50 dark:text-blue-200'
                                                            : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                                                        }`}
                                                    >
                                                        {t(`waste_matrix_${matrix}` as never)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}
                            </section>

                            {shouldAskAdditionalComponents && (
                                <section aria-labelledby="additional-components-title">
                                    <h3 id="additional-components-title" className="mb-2 text-sm font-bold leading-relaxed text-slate-900 dark:text-white">
                                        {t('waste_additional_components_question')}
                                    </h3>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(['none', 'present', 'unknown'] as const).map((value) => (
                                            <button
                                                key={value}
                                                type="button"
                                                aria-pressed={batch.additionalComponentsStatus === value}
                                                onClick={() => {
                                                    setAdditionalComponentsStatus(value);
                                                    if (value === 'present') {
                                                        if (onAddComponent) onAddComponent();
                                                        else onClose();
                                                    }
                                                }}
                                                className={`min-h-11 rounded-xl border px-2 py-2 text-xs font-semibold ${batch.additionalComponentsStatus === value
                                                    ? 'border-blue-600 bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200'
                                                    : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200'
                                                }`}
                                            >
                                                {t(`waste_additional_${value}` as never)}
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {requiresFluorideCompatibleContainer && (
                                <section
                                    aria-labelledby="fluoride-container-title"
                                    className="rounded-xl border border-red-200 bg-red-50/70 p-3 dark:border-red-900 dark:bg-red-950/30 lg:rounded-2xl lg:p-4"
                                >
                                    <h3 id="fluoride-container-title" className="text-sm font-bold leading-5 text-red-950 dark:text-red-100">
                                        {t('waste_fluoride_container_question')}
                                    </h3>
                                    <p className="mt-1 text-xs leading-5 text-red-800 dark:text-red-200">
                                        {t('waste_fluoride_container_help')}
                                    </p>
                                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                        {(['compatible', 'incompatible', 'unknown'] as const).map((value) => (
                                            <button
                                                key={value}
                                                type="button"
                                                aria-pressed={batch.fluorideContainerStatus === value}
                                                onClick={() => setFluorideContainerStatus(value)}
                                                className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-semibold ${batch.fluorideContainerStatus === value
                                                    ? value === 'compatible'
                                                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-200'
                                                        : 'border-red-600 bg-white text-red-800 ring-1 ring-red-600 dark:bg-red-950/60 dark:text-red-100'
                                                    : 'border-red-200 bg-white text-slate-700 dark:border-red-900 dark:bg-slate-950 dark:text-slate-200'
                                                }`}
                                            >
                                                {t(`waste_fluoride_container_${value}` as never)}
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            )}

                            <section aria-labelledby="waste-amount-title">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <h3 id="waste-amount-title" className="font-bold text-slate-900 dark:text-white">
                                            {t('waste_total_amount')}
                                        </h3>
                                        {hasComponentVolumeTotal && componentVolumeTotal ? (
                                            <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                                <input
                                                    type="checkbox"
                                                    checked={hasManualTotalOverride}
                                                    onChange={(event) => setTotalAmount(event.target.checked
                                                        ? {
                                                            value: componentVolumeTotal.value,
                                                            unit: componentVolumeTotal.unit,
                                                            isApproximate: false,
                                                            source: 'manual',
                                                        }
                                                        : componentVolumeTotal)}
                                                    className="h-5 w-5 rounded border-slate-300"
                                                />
                                                {t('waste_total_amount_override')}
                                            </label>
                                        ) : (
                                            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                                <input
                                                    type="checkbox"
                                                    checked={batch.totalAmount.isUnknown}
                                                    onChange={(event) => setTotalAmount({
                                                        value: null,
                                                        unit: null,
                                                        isUnknown: event.target.checked,
                                                        source: 'manual',
                                                    })}
                                                    className="h-5 w-5 rounded border-slate-300"
                                                />
                                                {t('waste_amount_unknown')}
                                            </label>
                                        )}
                                    </div>
                                    {inventoryAmountSuggestion && !hasComponentVolumeTotal && !batch.totalAmount.isUnknown && (
                                        <button
                                            type="button"
                                            onClick={() => setTotalAmount({
                                                ...inventoryAmountSuggestion,
                                                isApproximate: true,
                                                source: 'manual',
                                            })}
                                            className="mb-2 min-h-11 w-full rounded-xl border border-blue-200 bg-blue-50 px-3 text-left text-sm font-medium text-blue-800 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
                                        >
                                            {t('waste_inventory_amount_suggestion', {
                                                value: inventoryAmountSuggestion.value,
                                                unit: inventoryAmountSuggestion.unit,
                                            })}
                                        </button>
                                    )}
                                    {batch.matrix === 'unknown' && !batch.totalAmount.isUnknown && (
                                        <p className="rounded-xl bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950/40 dark:text-orange-100">
                                            {t('waste_missing_matrix')}
                                        </p>
                                    )}
                                    {hasComponentVolumeTotal && componentVolumeTotal && !hasManualTotalOverride && (
                                        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-950 dark:border-blue-900 dark:bg-blue-950/35 dark:text-blue-100" aria-live="polite">
                                            <p className="text-lg font-bold">
                                                {componentVolumeTotal.value} {componentVolumeTotal.unit}
                                            </p>
                                            <p className="mt-1 text-xs leading-5 text-blue-800 dark:text-blue-200">
                                                {t('waste_total_amount_auto_help')}
                                            </p>
                                        </div>
                                    )}
                                    {batch.matrix !== 'unknown' && !batch.totalAmount.isUnknown &&
                                        (!hasComponentVolumeTotal || hasManualTotalOverride) && (
                                        <div className="grid grid-cols-[1fr_100px] gap-2">
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                min="0.000001"
                                                step="any"
                                                value={batch.totalAmount.value ?? ''}
                                                onChange={(event) => changeAmount(event.target.value)}
                                                aria-label={t('waste_total_amount')}
                                                aria-invalid={amountValueInvalid}
                                                aria-describedby={amountValueInvalid ? 'waste-amount-error' : undefined}
                                                className="h-12 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base aria-[invalid=true]:border-red-500 dark:border-slate-700 dark:bg-slate-900"
                                            />
                                            <AppSelect
                                                value={batch.totalAmount.unit ?? allowedUnits[0]}
                                                onChange={(value) => changeUnit(value as AmountUnit)}
                                                options={allowedUnits.map((unit) => ({ value: unit, label: unit }))}
                                                ariaLabel={t('unit', { defaultValue: '단위' })}
                                                buttonClassName="!min-h-12 !rounded-xl !border-slate-300 !bg-white !px-3 dark:!border-slate-700 dark:!bg-slate-900"
                                            />
                                            {!hasComponentVolumeTotal && (
                                                <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                                    <input
                                                        type="checkbox"
                                                        checked={batch.totalAmount.isApproximate}
                                                        onChange={(event) => setTotalAmount({
                                                            value: batch.totalAmount.value,
                                                            unit: batch.totalAmount.unit ?? allowedUnits[0],
                                                            isApproximate: event.target.checked,
                                                            source: 'manual',
                                                        })}
                                                        className="h-5 w-5 rounded border-slate-300"
                                                    />
                                                    {t('waste_amount_approximate')}
                                                </label>
                                            )}
                                            {amountValueInvalid && (
                                                <p id="waste-amount-error" className="col-span-2 text-xs font-medium text-red-600 dark:text-red-300">
                                                    {t('waste_amount_invalid')}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    {hasManualTotalOverride && (
                                        <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                                            {t('waste_total_amount_override_help')}
                                        </p>
                                    )}
                                    {!hasComponentVolumeTotal && batch.components.length > 0 &&
                                        batch.matrix !== 'unknown' && batch.matrix !== 'solid_slurry' && (
                                        <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                                            {t('waste_total_amount_component_volume_missing_help')}
                                        </p>
                                    )}
                            </section>

                            {batch.components.length > 0 && batch.mixingState === 'separate' && (
                                <section
                                    aria-labelledby="waste-legacy-separate-title"
                                    className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-orange-950 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100 lg:rounded-2xl lg:p-4"
                                >
                                    <h3 id="waste-legacy-separate-title" className="font-bold">
                                        {t('waste_legacy_separate_title')}
                                    </h3>
                                    <p className="mt-2 text-xs leading-5">
                                        {t('waste_legacy_separate_help')}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={confirmSingleContainer}
                                        className="mt-3 min-h-11 rounded-xl border border-orange-500 bg-white px-4 text-sm font-semibold text-orange-900 hover:bg-orange-100 dark:bg-slate-950 dark:text-orange-100"
                                    >
                                        {t('waste_confirm_single_container')}
                                    </button>
                                </section>
                            )}

                            {needsMeasuredPh && (
                                <section aria-labelledby="waste-ph-title">
                                    <h3 id="waste-ph-title" className="mb-2 font-bold text-slate-900 dark:text-white">
                                        {t('waste_ph_title')}
                                    </h3>
                                    <p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-300">
                                        {t('waste_ph_measured_only_help')}
                                    </p>
                                    <div className="grid grid-cols-[1fr_auto] gap-3">
                                        <input
                                            type="number"
                                            min="0"
                                            max="14"
                                            step="0.1"
                                            value={batch.measuredBatchPh ?? ''}
                                            placeholder={t('waste_ph_placeholder')}
                                            onChange={(event) => setMeasuredPh(event.target.value ? Number(event.target.value) : null)}
                                            className="h-12 min-w-0 rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                                        />
                                        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <input
                                                type="checkbox"
                                                checked={batch.measuredPhStatus === 'unknown'}
                                                onChange={(event) => setMeasuredPh(null, event.target.checked)}
                                                className="h-5 w-5 rounded border-slate-300"
                                            />
                                            {t('waste_ph_unknown')}
                                        </label>
                                    </div>
                                </section>
                            )}
                        </>
                    )}

                    {activeStep === 'result' && !showAiDetail && (
                        <>
                    <section className={`rounded-xl border p-3 lg:rounded-2xl lg:p-4 ${statusConfig.classes}`} aria-live="polite">
                        <div className="flex items-center gap-2">
                            {statusConfig.icon}
                            <h3 className="font-bold">{statusConfig.title}</h3>
                        </div>

                        {decision.decisionStatus !== 'ready' && phPredictionSummary && (
                            <div className="mt-3">{phPredictionSummary}</div>
                        )}

                        {batch.measuredPhStatus === 'measured' && batch.measuredBatchPh !== undefined && (
                            <div className="mt-3 rounded-xl bg-white/65 p-3 text-sm dark:bg-slate-950/30">
                                <p className="mb-2 font-bold">{t('waste_ph_assessment_title')}</p>
                                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                                    <dt className="font-medium opacity-70">{t('waste_measured_batch_ph')}</dt>
                                    <dd>{batch.measuredBatchPh}</dd>
                                    <dt className="font-medium opacity-70">{t('waste_legal_ph_class')}</dt>
                                    <dd>{t(`waste_legal_${decision.legalWastePhClass}` as never)}</dd>
                                    <dt className="font-medium opacity-70">{t('waste_corrosivity_ph_screen')}</dt>
                                    <dd>{t(`waste_corrosivity_${decision.corrosivityPhScreen}` as never)}</dd>
                                    <dt className="font-medium opacity-70">{t('waste_routing_basis')}</dt>
                                    <dd>{t(`waste_routing_${decision.routingBasis}` as never)}</dd>
                                </dl>
                            </div>
                        )}

                        {decision.decisionStatus === 'ready' && (
                            <div className="mt-4 space-y-3 text-sm">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide opacity-65">
                                        {matchedStream?.containerLabel?.trim() ? t('waste_destination') : t('mixture_final_stream_label')}
                                    </p>
                                    <p className="mt-1 text-lg font-bold">{matchedStream?.containerLabel || streamName}</p>
                                </div>
                                {matchedStream?.location?.trim() && (
                                    <div className="flex items-start gap-2">
                                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                        <span>{matchedStream.location}</span>
                                    </div>
                                )}
                                <div className="rounded-xl bg-white/60 p-3 dark:bg-slate-900/30">
                                    <dl className="grid gap-2 sm:grid-cols-[auto_1fr] sm:gap-x-4">
                                        <dt className="font-semibold text-slate-600 dark:text-slate-300">{t('waste_label_component_names')}</dt>
                                        <dd className="break-words">{labelComponentNames || t('waste_label_value_not_entered')}</dd>
                                        <dt className="font-semibold text-slate-600 dark:text-slate-300">{t('waste_label_total_amount')}</dt>
                                        <dd>{labelAmount}</dd>
                                    </dl>
                                    {additionalLabelRequirements.length > 0 && (
                                        <div className="mt-3 border-t border-current/10 pt-3">
                                            <p className="font-semibold">{t('waste_label_additional_requirements')}</p>
                                            <ul className="mt-1 space-y-1">
                                                {additionalLabelRequirements.map((item) => <li key={item}>• {item}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                                {phPredictionSummary}
                                <div className="rounded-xl border border-orange-200 bg-orange-50/80 p-3 text-slate-900 dark:border-orange-900/70 dark:bg-orange-950/25 dark:text-slate-100">
                                    <p className="font-bold">{t('waste_hazard_reference_title')}</p>
                                    {labelHazardItems.length > 0 ? (
                                        <ul className="mt-2 flex flex-wrap gap-2">
                                            {labelHazardItems.map(({ code, description }) => (
                                                <li
                                                    key={`${code ?? 'hazard'}-${description}`}
                                                    className={code
                                                        ? 'flex w-full items-start gap-2 rounded-lg bg-white/75 px-2.5 py-1.5 dark:bg-slate-950/30'
                                                        : 'inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-sm dark:bg-slate-950/30'}
                                                >
                                                    {code ? (
                                                        <span className="mt-0.5 inline-flex min-w-12 shrink-0 justify-center rounded-md bg-orange-100 px-2 py-0.5 font-mono text-xs font-bold text-orange-800 dark:bg-orange-950/70 dark:text-orange-200">
                                                            {code}
                                                        </span>
                                                    ) : (
                                                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" aria-hidden="true" />
                                                    )}
                                                    <span className={code ? 'leading-5' : 'leading-4'}>{description}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="mt-2 text-sm font-medium">{t(hasUnconfirmedHazardData
                                            ? 'waste_label_hazards_need_review'
                                            : 'waste_label_no_known_hazards')}</p>
                                    )}
                                </div>
                                {matchedStream?.handlerContact && (
                                    <p className="text-sm font-medium">{t('waste_policy_handler_contact')}: {matchedStream.handlerContact}</p>
                                )}
                                {matchedStream?.sopUrl?.startsWith('https://') && (
                                    <a
                                        href={matchedStream.sopUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex min-h-11 items-center gap-1 font-semibold underline"
                                    >
                                        {t('waste_policy_sop_url')}<ExternalLink className="h-4 w-4" aria-hidden="true" />
                                    </a>
                                )}
                            </div>
                        )}

                        {decision.decisionStatus === 'needs_input' && (
                            <ul className="mt-3 space-y-2 text-sm">
                                {decision.missingFields.map((field) => (
                                    <li key={field} className="flex items-start gap-2">
                                        <span aria-hidden="true">•</span>
                                        <span>{t(MISSING_FIELD_KEYS[field] as never)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {decision.decisionStatus === 'blocked' && (
                            <div className="mt-3 space-y-3 text-sm">
                                <p className="font-semibold">{t('waste_blocking_reason')}</p>
                                <ul className="space-y-2">
                                    {decision.blockingReasons.map((reason, index) => (
                                        <li key={`${reason.code}-${reason.ruleId ?? index}`} className="flex items-start gap-2">
                                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                            <span>{t(reason.messageKey as never)}</span>
                                        </li>
                                    ))}
                                </ul>
                                {requiresMixingState && batch.mixingState !== 'unknown' && (
                                    <p className="font-medium">{batch.mixingState === 'already_mixed'
                                        ? t('waste_blocked_already_mixed')
                                        : t('waste_blocked_before_mix')}</p>
                                )}
                                {!hasAmountConfirmation && (
                                    <p className="rounded-lg bg-white/70 p-2 font-semibold dark:bg-slate-950/30">
                                        {t('waste_missing_total_amount')}
                                    </p>
                                )}
                                {(escalationDetails.handlerContact || escalationDetails.sopUrl) && (
                                    <div className="rounded-xl border border-red-200 bg-white/80 p-3 dark:border-red-800 dark:bg-slate-950/40">
                                        {escalationDetails.handlerContact && (
                                            <p className="font-semibold">
                                                {t('waste_policy_handler_contact')}: {escalationDetails.handlerContact}
                                            </p>
                                        )}
                                        {escalationDetails.sopUrl && (
                                            <a
                                                href={escalationDetails.sopUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="mt-2 inline-flex min-h-11 items-center gap-1 font-semibold underline"
                                            >
                                                {t('waste_policy_sop_url')}
                                                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                                            </a>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                    </section>

                    {compatibilityWarnings.length > 0 && (
                        <section aria-labelledby="compatibility-title" className="space-y-2">
                            <h3 id="compatibility-title" className="font-bold text-slate-900 dark:text-white">{t('compat_title')}</h3>
                            {compatibilityWarnings.map((warning, index) => (
                                <div
                                    key={`${warning.ruleId}-${index}`}
                                    className={`rounded-xl border p-3 text-sm ${warning.severity === 'DANGER'
                                        ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100'
                                        : 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100'
                                    }`}
                                >
                                    <p className="font-semibold">{warning.chemicalA} + {warning.chemicalB}</p>
                                    <p className="mt-1">{t(warning.messageKey as never)}</p>
                                </div>
                            ))}
                        </section>
                    )}

                    {batch.components.length > 0 && (
                        <section className="rounded-xl border border-purple-200 bg-purple-50 p-3 dark:border-purple-900/60 dark:bg-purple-950/30 lg:rounded-2xl lg:p-4">
                            <button
                                onClick={() => {
                                    setShowAiDetail(true);
                                    if (!aiResult && !aiLoading) void requestAIGuide();
                                }}
                                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 font-semibold text-white hover:bg-purple-700"
                            >
                                <Sparkles className="h-4 w-4" aria-hidden="true" />
                                {t('waste_ai_button')}
                            </button>
                            {showAiDetail && aiError && (
                                <div className="mt-3 text-sm text-purple-950 dark:text-purple-100">
                                    <p>{t('waste_ai_unavailable')}</p>
                                    <button onClick={requestAIGuide} className="mt-2 min-h-11 font-semibold underline">
                                        {t('waste_record_retry')}
                                    </button>
                                </div>
                            )}
                            {showAiDetail && aiResult && (
                                <div className="mt-3 space-y-4 text-sm text-purple-950 dark:text-purple-100">
                                    {aiResult.availability === 'unavailable' && (
                                        <p className="rounded-xl bg-white/60 p-3 font-medium dark:bg-slate-950/30">{t('waste_ai_unavailable')}</p>
                                    )}
                                    {(aiResult.availability !== 'unavailable' ||
                                        aiResult.summary.trim() !== t('waste_ai_unavailable').trim()) && (
                                        <p className="font-medium leading-relaxed">{aiResult.summary}</p>
                                    )}
                                    {aiResult.steps.length > 0 && (
                                        <ol className="space-y-2">
                                            {aiResult.steps.map((step, index) => (
                                                <li key={`${step}-${index}`} className="flex gap-2">
                                                    <span className="font-bold">{index + 1}.</span><span>{step}</span>
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                    {aiResult.prohibitions.length > 0 && (
                                        <div>
                                            <h4 className="font-bold">{t('waste_ai_prohibitions')}</h4>
                                            <ul className="mt-1 space-y-1">
                                                {aiResult.prohibitions.map((item) => <li key={item}>• {item}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                    {aiResult.evidence.length > 0 && (
                                        <details>
                                            <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
                                                {t('waste_ai_evidence')} <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                            </summary>
                                            <ul className="space-y-1 text-xs">
                                                {aiResult.evidence.map((evidence) => (
                                                    <li key={evidence.id}>
                                                        {evidence.reference?.startsWith('https://') ? (
                                                            <a href={evidence.reference} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                                                                {evidence.title}<ExternalLink className="h-3 w-3" aria-hidden="true" />
                                                            </a>
                                                        ) : evidence.title}
                                                    </li>
                                                ))}
                                            </ul>
                                        </details>
                                    )}
                                </div>
                            )}
                        </section>
                    )}

                    <details className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
                        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-slate-700 dark:text-slate-200">
                            {t('waste_additional_memo')}
                        </summary>
                        <textarea
                            value={memo}
                            onChange={(event) => setMemo(event.target.value)}
                            maxLength={1000}
                            className="mt-2 min-h-24 w-full resize-y rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                        />
                    </details>
                        </>
                    )}

                    {showAiDetail && (
                        <section className="rounded-xl border border-purple-200 bg-purple-50 p-3 dark:border-purple-900/60 dark:bg-purple-950/30 lg:rounded-2xl lg:p-4">
                            <div className="flex items-center gap-2 text-purple-900 dark:text-purple-100">
                                <Sparkles className="h-5 w-5" aria-hidden="true" />
                                <h4 className="font-bold">{t('waste_ai_button')}</h4>
                            </div>
                            {aiLoading && (
                                <div className="flex min-h-32 items-center justify-center gap-2 text-sm font-semibold text-purple-900 dark:text-purple-100">
                                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                                    {t('loading')}
                                </div>
                            )}
                            {aiError && !aiLoading && (
                                <div className="mt-3 text-sm text-purple-950 dark:text-purple-100">
                                    <p>{t('waste_ai_unavailable')}</p>
                                    <button onClick={requestAIGuide} className="mt-2 min-h-11 font-semibold underline">
                                        {t('waste_record_retry')}
                                    </button>
                                </div>
                            )}
                            {aiResult && !aiLoading && (
                                <div className="mt-3 space-y-4 text-sm text-purple-950 dark:text-purple-100">
                                    {aiResult.availability === 'unavailable' && (
                                        <p className="rounded-xl bg-white/60 p-3 font-medium dark:bg-slate-950/30">{t('waste_ai_unavailable')}</p>
                                    )}
                                    {(aiResult.availability !== 'unavailable'
                                        || aiResult.summary.trim() !== t('waste_ai_unavailable').trim()) && (
                                        <p className="font-medium leading-relaxed">{aiResult.summary}</p>
                                    )}
                                    {aiResult.steps.length > 0 && (
                                        <ol className="space-y-2">
                                            {aiResult.steps.map((step, index) => (
                                                <li key={`${step}-${index}`} className="flex gap-2">
                                                    <span className="font-bold">{index + 1}.</span><span>{step}</span>
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                    {aiResult.prohibitions.length > 0 && (
                                        <div>
                                            <h5 className="font-bold">{t('waste_ai_prohibitions')}</h5>
                                            <ul className="mt-1 space-y-1">
                                                {aiResult.prohibitions.map((item) => <li key={item}>· {item}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}
                        </section>
                    )}
                    </div>
                </main>

                <footer className="absolute inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:p-4">
                    {activeStep === 'result' && !showAiDetail ? (
                        <>
                    {!isOnline && (
                        <p className="mb-2 rounded-lg bg-orange-50 px-3 py-2 text-xs font-medium text-orange-900 dark:bg-orange-950/50 dark:text-orange-100" role="status">
                            {t('waste_offline_blocked')}
                        </p>
                    )}
                    {policyGuardMessage && (
                        <p className="mb-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold leading-5 text-orange-950 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-100" role="alert">
                            {policyGuardMessage}
                        </p>
                    )}
                    {saveError && (
                        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-900 dark:bg-red-950/50 dark:text-red-100" role="alert">
                            <span>{t('waste_record_failed')}</span>
                            <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
                        </div>
                    )}
                    {hasInvalidNumericInput && (
                        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-900 dark:bg-red-950/50 dark:text-red-100" role="alert">
                            {t('waste_invalid_concentration_block')}
                        </p>
                    )}
                    {decision.decisionStatus === 'blocked' && (
                        <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-950 dark:border-red-800 dark:bg-red-950/60 dark:text-red-100" role="alert">
                            <p className="font-bold">
                                {t('waste_blocking_reason')}: {decision.blockingReasons[0]
                                    ? t(decision.blockingReasons[0].messageKey as never)
                                    : t('waste_decision_blocked')}
                            </p>
                            {requiresMixingState && batch.mixingState !== 'unknown' && (
                                <p className="mt-0.5 font-medium">
                                    {batch.mixingState === 'already_mixed'
                                        ? t('waste_blocked_already_mixed')
                                        : t('waste_blocked_before_mix')}
                                </p>
                            )}
                            {!hasAmountConfirmation && (
                                <p className="mt-0.5 font-semibold">{t('waste_missing_total_amount')}</p>
                            )}
                        </div>
                    )}
                    {decision.decisionStatus === 'ready' ? (
                        <button
                            onClick={() => recordAction('container_deposit')}
                            disabled={!isOnline || isSaving || policyLoading || hasInvalidNumericInput}
                            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-12"
                        >
                            {isSaving && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
                            {t('waste_action_container_deposit')}
                        </button>
                    ) : decision.decisionStatus === 'blocked' ? (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => recordAction('isolated')}
                                disabled={!isOnline || isSaving || policyLoading || !hasAmountConfirmation || hasInvalidNumericInput}
                                className="min-h-11 rounded-xl border border-red-300 bg-white px-3 font-bold text-red-700 disabled:opacity-50 dark:border-red-800 dark:bg-slate-950 dark:text-red-300 lg:min-h-12"
                            >
                                {t('waste_action_isolated')}
                            </button>
                            <button
                                onClick={() => recordAction('handover')}
                                disabled={!isOnline || isSaving || policyLoading || !hasAmountConfirmation || hasInvalidNumericInput}
                                className="min-h-11 rounded-xl bg-red-600 px-3 font-bold text-white hover:bg-red-700 disabled:opacity-50 lg:min-h-12"
                            >
                                {t('waste_action_handover')}
                            </button>
                        </div>
                    ) : (
                        <button disabled className="min-h-11 w-full rounded-xl bg-orange-100 px-4 font-bold text-orange-800 dark:bg-orange-950/60 dark:text-orange-200 lg:min-h-12">
                            {statusConfig.title}
                        </button>
                    )}
                        </>
                    ) : (
                        <div className="mx-auto grid w-full max-w-2xl grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={moveWizardBack}
                                disabled={!showAiDetail && activeStep === 'components'}
                                className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 lg:min-h-12"
                            >
                                {t('waste_wizard_previous')}
                            </button>
                            {showAiDetail ? (
                                <button
                                    type="button"
                                    onClick={() => setShowAiDetail(false)}
                                    className="min-h-11 rounded-xl bg-blue-600 px-4 font-bold text-white hover:bg-blue-700 lg:min-h-12"
                                >
                                    {t('waste_ai_back_to_result')}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={moveWizardNext}
                                    disabled={activeStep === 'components'
                                        ? !wizard.componentStepComplete || hasInvalidNumericInput
                                        : activeStep === 'amounts'
                                            ? !activeAmountComponent || hasInvalidNumericInput
                                        : activeStep === 'solution'
                                            ? !activeSolutionComponent || !isSolutionContextAnswered(activeSolutionComponent)
                                            : activeStep === 'batch'
                                                ? !wizard.batchStepComplete
                                                : false}
                                    className="min-h-11 rounded-xl bg-blue-600 px-4 font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800 lg:min-h-12"
                                >
                                    {activeStep === 'amounts' && safeAmountQuestionIndex < batch.components.length - 1
                                        ? t('waste_amount_next_component')
                                        : activeStep === 'solution' && safeSolutionQuestionIndex < solutionQuestionComponents.length - 1
                                        ? t('waste_solution_next_component')
                                        : t('waste_wizard_next')}
                                </button>
                            )}
                        </div>
                    )}
                </footer>
            </div>
        </div>
    );
};
