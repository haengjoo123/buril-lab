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
import { getAllowedAmountUnits } from '../utils/wasteBatch';
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
import type {
    AmountUnit,
    ConcentrationUnit,
    HandlingAction,
    WasteMatrix,
    WasteHazardFlag,
    WasteMissingField,
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
    'mixed_biphasic',
    'solid_slurry',
    'unknown',
];

const CONCENTRATION_UNITS: ConcentrationUnit[] = ['M', 'mM', '%', 'mg/mL'];

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
    'REACTIVE',
];

const MISSING_FIELD_KEYS: Partial<Record<WasteMissingField, string>> = {
    matrix: 'waste_missing_matrix',
    total_amount: 'waste_missing_total_amount',
    identity: 'waste_missing_identity',
    hazard_data: 'waste_missing_hazard_data',
    additional_components: 'waste_missing_additional_components',
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

const focusableSelector = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export const CartView: React.FC<CartViewProps> = ({
    onClose,
    onDisposed,
    onOpenLogs,
    onAddComponent,
}) => {
    const { t, i18n } = useTranslation();
    const currentLabId = useLabStore((state) => state.currentLabId);
    const {
        batch,
        removeFromCart,
        updateComponent,
        setMatrix,
        setTotalAmount,
        setMeasuredPh,
        setAdditionalComponentsStatus,
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
    const [editingLineId, setEditingLineId] = useState<string | null>(null);
    const [concentrationInputs, setConcentrationInputs] = useState<Record<string, string>>({});
    const [concentrationUnits, setConcentrationUnits] = useState<Record<string, ConcentrationUnit>>({});
    const [memo, setMemo] = useState('');
    const [alreadyMixed, setAlreadyMixed] = useState(true);
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

    const activeBatchHasContent = batch.components.length > 0
        || batch.matrix !== 'unknown'
        || batch.totalAmount.value !== null
        || batch.totalAmount.isUnknown
        || batch.measuredPhStatus !== 'not_required'
        || batch.additionalComponentsStatus !== undefined
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

    const policyResolution = useMemo(
        () => resolveWasteDecisionAgainstPolicy(batch, policy),
        [batch, policy],
    );
    const { decision, matchedStream, policyStream } = policyResolution;
    const escalationDetails = useMemo(
        () => getWastePolicyEscalationDetails(policyStream),
        [policyStream],
    );
    const compatibilityWarnings = useMemo(
        () => checkCompatibility(batch.components, { matrix: batch.matrix }),
        [batch.components, batch.matrix],
    );
    const allowedUnits = getAllowedAmountUnits(batch.matrix);
    const amountValueInvalid = batch.totalAmount.value !== null && (
        !Number.isFinite(batch.totalAmount.value) || batch.totalAmount.value <= 0
    );
    const hasInvalidConcentration = batch.components.some((component) =>
        isInvalidConcentrationText(concentrationInputs[component.cartLineId])
    );
    const requestClose = useCallback(() => {
        if (hasInvalidConcentration && !window.confirm(t('waste_discard_invalid_concentration_confirm'))) return;
        onClose();
    }, [hasInvalidConcentration, onClose, t]);
    const hasAmountConfirmation = !decision.missingFields.includes('total_amount');
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
            const availableQuantity = snapshot.quantity && snapshot.quantity > 0 ? snapshot.quantity : 1;
            const quantity = component.sourceType === 'inventory' && component.inventoryId
                ? component.inventoryDisposalQuantity
                : availableQuantity;
            if (!quantity) continue;
            const remainingRatio = snapshot.remainingPercent !== null && snapshot.remainingPercent !== undefined
                ? Math.min(100, Math.max(0, snapshot.remainingPercent)) / 100
                : 1;
            const value = parsed.numericValue * quantity * remainingRatio;
            const volumeMl = parsed.unit === 'L' ? value * 1_000
                : parsed.unit === 'mL' ? value
                    : parsed.unit === 'uL' ? value / 1_000
                        : null;
            const massMg = parsed.unit === 'kg' ? value * 1_000_000
                : parsed.unit === 'g' ? value * 1_000
                    : parsed.unit === 'mg' ? value
                        : parsed.unit === 'ug' ? value / 1_000
                            : null;
            const normalized = expectedDimension === 'volume' ? volumeMl : massMg;
            if (normalized === null) continue;
            normalizedTotal += normalized;
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
    const needsMeasuredPh = batch.matrix === 'aqueous' &&
        batch.components.some(({ category }) => category === 'ACID') &&
        batch.components.some(({ category }) => category === 'ALKALI');
    const shouldAskAdditionalComponents = batch.matrix === 'mixed_biphasic' ||
        batch.matrix === 'unknown' || batch.components.length > 1;
    const isKorean = i18n.language.toLowerCase().startsWith('ko');
    const streamName = matchedStream
        ? (isKorean ? matchedStream.displayNameKo : matchedStream.displayNameEn)
        : (isKorean ? STREAM_NAMES_KO[decision.streamCode] : STREAM_NAMES_EN[decision.streamCode]);
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
        alreadyMixed,
    }), [alreadyMixed, batch, decision, memo]);
    const aiContextFingerprint = useMemo(() => JSON.stringify({
        language: i18n.language,
        batch,
        decision,
        compatibilityWarnings,
        matchedStream,
    }), [batch, compatibilityWarnings, decision, i18n.language, matchedStream]);

    useEffect(() => {
        setEditingLineId(null);
        setConcentrationInputs({});
        setConcentrationUnits({});
        setMemo('');
        setAlreadyMixed(true);
        requestIdRef.current = null;
        requestFingerprintRef.current = null;
    }, [batch.id]);

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
        });
    };

    const changeUnit = (unit: AmountUnit) => {
        setTotalAmount({
            value: batch.totalAmount.value,
            unit,
            isApproximate: batch.totalAmount.isApproximate,
        });
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
                        measuredPh: batch.measuredPh,
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
        const resolutionSnapshot = policyResolution;
        setIsSaving(true);
        setSaveError(null);
        setPolicyGuardMessage(null);
        try {
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

            const latestResolution = resolveWasteDecisionAgainstPolicy(batchSnapshot, latestPolicy);
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
            const result = await recordWasteHandlingV2({
                batch: batchSnapshot,
                decision: resolutionSnapshot.decision,
                handlingAction,
                memo,
                requestId,
                confirmationSnapshot: { alreadyMixed },
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
                        <div className="mt-2 flex justify-between gap-4">
                            <dt className="text-slate-500">ID</dt>
                            <dd className="max-w-[65%] truncate font-mono text-xs text-slate-700 dark:text-slate-300">{receipt.id}</dd>
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
                className="relative z-10 flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-950 lg:h-full lg:max-h-none lg:w-[min(760px,70vw)] lg:rounded-none lg:border-l lg:border-slate-200 dark:lg:border-slate-800"
            >
                <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] dark:border-slate-800 dark:bg-slate-950">
                    <div>
                        <h2 id="waste-batch-title" className="text-lg font-bold text-slate-950 dark:text-white">
                            {t('cart_title')} <span className="text-blue-600">({batch.components.length})</span>
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-500">
                            {batch.scopeKey.endsWith(':personal') ? t('lab_personal_space') : t('lab_default_name')}
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

                <main className={`min-h-0 flex-1 space-y-5 overflow-y-auto p-4 lg:p-6 ${
                    decision.decisionStatus === 'blocked' ? 'pb-60 lg:pb-60' : 'pb-32 lg:pb-32'
                }`}>
                    <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-sm leading-relaxed text-blue-950 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
                        {t('waste_batch_description')}
                    </div>

                    <section aria-labelledby="waste-components-title">
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
                        <div aria-live="polite" className="mb-2 text-sm font-medium text-blue-700 dark:text-blue-300">
                            {batchMessage}
                        </div>
                        {batch.components.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                                {t('cart_empty')}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {batch.components.map((component) => (
                                    <article key={component.cartLineId} className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                                        <div className="flex items-start gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h4 className="font-semibold text-slate-900 dark:text-white">{component.chemical.name}</h4>
                                                    {component.identityConfidence === 'verified' && (
                                                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                                            {t(component.identityConfirmedByUser
                                                                ? 'waste_component_user_verified'
                                                                : 'waste_component_auto_verified')}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="mt-0.5 text-xs text-slate-500">
                                                    {component.chemical.casNumber ? `CAS ${component.chemical.casNumber}` : t(component.label as never)}
                                                </p>
                                                {component.inventorySnapshot && (
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
                                                {component.concentration && (
                                                    <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                                                        {component.concentration.value} {component.concentration.unit}
                                                    </p>
                                                )}
                                                {component.identityConfidence !== 'verified' && (
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
                                                {component.ghsDataStatus !== 'verified' && !component.hazardDataConfirmedByUser && (
                                                    <p className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-xs font-medium text-orange-900 dark:bg-orange-950/40 dark:text-orange-100" role="status">
                                                        {t('waste_component_hazard_lookup_failed')}
                                                    </p>
                                                )}
                                            </div>
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
                                                    }
                                                }}
                                                aria-label={`${component.chemical.name} ${t('waste_component_edit')}`}
                                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                                        </div>
                                        {component.sourceType === 'inventory' && component.inventoryId && (
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
                                        {editingLineId === component.cartLineId && (
                                            <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                                                <div className="grid grid-cols-[1fr_110px] gap-2">
                                                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                                    {t('input_molarity')}
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
                                                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                                    {t('unit', { defaultValue: '단위' })}
                                                    <select
                                                        value={concentrationUnits[component.cartLineId] ?? component.concentration?.unit ?? 'M'}
                                                        onChange={(event) => {
                                                            const unit = event.target.value as ConcentrationUnit;
                                                            setConcentrationUnits((current) => ({
                                                                ...current,
                                                                [component.cartLineId]: unit,
                                                            }));
                                                            if (component.concentration) {
                                                                updateComponent(component.cartLineId, {
                                                                    concentration: {
                                                                        ...component.concentration,
                                                                        unit,
                                                                    },
                                                                });
                                                            }
                                                        }}
                                                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950"
                                                    >
                                                        {CONCENTRATION_UNITS.map((unit) => <option key={unit}>{unit}</option>)}
                                                    </select>
                                                </label>
                                                </div>
                                                {isInvalidConcentrationText(concentrationInputs[component.cartLineId]) && (
                                                    <p id={`concentration-error-${component.cartLineId}`} className="text-xs font-medium text-red-600 dark:text-red-300">
                                                        {t('waste_concentration_positive')}
                                                    </p>
                                                )}
                                                {(component.ghsDataStatus !== 'verified' || component.hazardDataConfirmedByUser) && (
                                                    <fieldset className="rounded-xl border border-orange-200 bg-orange-50/70 p-3 dark:border-orange-900 dark:bg-orange-950/30">
                                                        <legend className="px-1 text-xs font-bold text-orange-950 dark:text-orange-100">
                                                            {t('waste_manual_hazard_title')}
                                                        </legend>
                                                        <p className="mb-2 text-xs leading-relaxed text-orange-900 dark:text-orange-200">
                                                            {t('waste_manual_hazard_help')}
                                                        </p>
                                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                                            {MANUAL_HAZARD_OPTIONS.map((flag) => {
                                                                const selected = component.hazardFlags.includes(flag);
                                                                return (
                                                                    <button
                                                                        key={flag}
                                                                        type="button"
                                                                        aria-pressed={selected}
                                                                        onClick={() => updateComponent(component.cartLineId, {
                                                                            hazardFlags: selected
                                                                                ? component.hazardFlags.filter((item) => item !== flag)
                                                                                : [...component.hazardFlags, flag],
                                                                            hazardDataConfirmedByUser: false,
                                                                            ghsDataStatus: 'not_checked',
                                                                        })}
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

                    {parkedBatches.length > 0 && (
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

                    {batch.components.length > 0 && (
                        <>
                            <section aria-labelledby="waste-matrix-title">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <h3 id="waste-matrix-title" className="font-bold text-slate-900 dark:text-white">
                                        {t('waste_matrix_title')}
                                    </h3>
                                    {batch.matrixSource === 'automatic' && (
                                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">
                                            {t('waste_matrix_auto_estimated')}
                                        </span>
                                    )}
                                </div>
                                {batch.matrix === 'unknown' && previousMatrix && (
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
                                        return (
                                            <button
                                                key={matrix}
                                                type="button"
                                                onClick={() => setMatrix(matrix)}
                                                aria-pressed={selected}
                                                className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${selected
                                                    ? 'border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-600 dark:bg-blue-950/50 dark:text-blue-200'
                                                    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                                                }`}
                                            >
                                                {t(`waste_matrix_${matrix}` as never)}
                                            </button>
                                        );
                                    })}
                                </div>
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

                            <section aria-labelledby="waste-amount-title">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <h3 id="waste-amount-title" className="font-bold text-slate-900 dark:text-white">
                                            {t('waste_total_amount')}
                                        </h3>
                                        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <input
                                                type="checkbox"
                                                checked={batch.totalAmount.isUnknown}
                                                onChange={(event) => setTotalAmount({
                                                    value: null,
                                                    unit: null,
                                                    isUnknown: event.target.checked,
                                                })}
                                                className="h-5 w-5 rounded border-slate-300"
                                            />
                                            {t('waste_amount_unknown')}
                                        </label>
                                    </div>
                                    {inventoryAmountSuggestion && !batch.totalAmount.isUnknown && (
                                        <button
                                            type="button"
                                            onClick={() => setTotalAmount({
                                                ...inventoryAmountSuggestion,
                                                isApproximate: true,
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
                                    {batch.matrix !== 'unknown' && !batch.totalAmount.isUnknown && (
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
                                            <select
                                                value={batch.totalAmount.unit ?? allowedUnits[0]}
                                                onChange={(event) => changeUnit(event.target.value as AmountUnit)}
                                                aria-label={t('unit', { defaultValue: '단위' })}
                                                className="h-12 rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                                            >
                                                {allowedUnits.map((unit) => <option key={unit}>{unit}</option>)}
                                            </select>
                                            <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                                <input
                                                    type="checkbox"
                                                    checked={batch.totalAmount.isApproximate}
                                                    onChange={(event) => setTotalAmount({
                                                        value: batch.totalAmount.value,
                                                        unit: batch.totalAmount.unit ?? allowedUnits[0],
                                                        isApproximate: event.target.checked,
                                                    })}
                                                    className="h-5 w-5 rounded border-slate-300"
                                                />
                                                {t('waste_amount_approximate')}
                                            </label>
                                            {amountValueInvalid && (
                                                <p id="waste-amount-error" className="col-span-2 text-xs font-medium text-red-600 dark:text-red-300">
                                                    {t('waste_amount_invalid')}
                                                </p>
                                            )}
                                        </div>
                                    )}
                            </section>

                            {needsMeasuredPh && (
                                <section aria-labelledby="waste-ph-title">
                                    <h3 id="waste-ph-title" className="mb-2 font-bold text-slate-900 dark:text-white">
                                        {t('waste_ph_title')}
                                    </h3>
                                    <div className="grid grid-cols-[1fr_auto] gap-3">
                                        <input
                                            type="number"
                                            min="0"
                                            max="14"
                                            step="0.1"
                                            disabled={batch.measuredPhStatus === 'unknown'}
                                            value={batch.measuredPh ?? ''}
                                            placeholder={t('waste_ph_placeholder')}
                                            onChange={(event) => setMeasuredPh(event.target.value ? Number(event.target.value) : null)}
                                            className="h-12 min-w-0 rounded-xl border border-slate-300 bg-white px-3 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:disabled:bg-slate-800"
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

                    <section className={`rounded-2xl border p-4 ${statusConfig.classes}`} aria-live="polite">
                        <div className="flex items-center gap-2">
                            {statusConfig.icon}
                            <h3 className="font-bold">{statusConfig.title}</h3>
                        </div>

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
                                    {(matchedStream?.labelRequirements.length
                                        ? matchedStream.labelRequirements
                                        : [t('waste_label_contents')]
                                    ).map((item) => <p key={item}>• {item}</p>)}
                                </div>
                                {matchedStream?.prohibitions.length ? (
                                    <div className="rounded-xl border border-red-200 bg-red-50/80 p-3 text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100">
                                        <p className="font-bold">{t('waste_ai_prohibitions')}</p>
                                        <ul className="mt-1 space-y-1">
                                            {matchedStream.prohibitions.map((item) => <li key={item}>• {item}</li>)}
                                        </ul>
                                    </div>
                                ) : null}
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
                                        <span>{MISSING_FIELD_KEYS[field]
                                            ? t(MISSING_FIELD_KEYS[field] as never)
                                            : field
                                        }</span>
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
                                <fieldset className="rounded-xl border border-red-200 bg-white/70 p-3 dark:border-red-800 dark:bg-slate-950/30">
                                    <legend className="px-1 font-semibold">{t('waste_mixing_state', { defaultValue: '현재 혼합 상태' })}</legend>
                                    <label className="mr-4 inline-flex min-h-11 items-center gap-2">
                                        <input type="radio" checked={!alreadyMixed} onChange={() => setAlreadyMixed(false)} />
                                        {t('waste_not_mixed_yet', { defaultValue: '아직 섞기 전' })}
                                    </label>
                                    <label className="inline-flex min-h-11 items-center gap-2">
                                        <input type="radio" checked={alreadyMixed} onChange={() => setAlreadyMixed(true)} />
                                        {t('waste_already_mixed', { defaultValue: '이미 섞음' })}
                                    </label>
                                </fieldset>
                                <p className="font-medium">{alreadyMixed ? t('waste_blocked_already_mixed') : t('waste_blocked_before_mix')}</p>
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

                        {batch.components.length > 0 && (
                            <div className="mt-3 border-t border-current/15 pt-3 text-xs opacity-75">
                                <p>{t('waste_prohibition_no_neutralize')}</p>
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
                        <section className="rounded-2xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-900/60 dark:bg-purple-950/30">
                            <div className="flex items-center gap-2 text-purple-900 dark:text-purple-100">
                                <Sparkles className="h-5 w-5" aria-hidden="true" />
                                <h3 className="font-bold">AI</h3>
                            </div>
                            {!aiResult && !aiError && (
                                <button
                                    onClick={requestAIGuide}
                                    disabled={aiLoading}
                                    className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
                                >
                                    {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                                    {t('waste_ai_button')}
                                </button>
                            )}
                            {aiError && (
                                <div className="mt-3 text-sm text-purple-950 dark:text-purple-100">
                                    <p>{t('waste_ai_unavailable')}</p>
                                    <button onClick={requestAIGuide} className="mt-2 min-h-11 font-semibold underline">
                                        {t('waste_record_retry')}
                                    </button>
                                </div>
                            )}
                            {aiResult && (
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
                </main>

                <footer className="absolute inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:p-4">
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
                    {hasInvalidConcentration && (
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
                            <p className="mt-0.5 font-medium">
                                {alreadyMixed ? t('waste_blocked_already_mixed') : t('waste_blocked_before_mix')}
                            </p>
                            {!hasAmountConfirmation && (
                                <p className="mt-0.5 font-semibold">{t('waste_missing_total_amount')}</p>
                            )}
                        </div>
                    )}
                    {decision.decisionStatus === 'ready' ? (
                        <button
                            onClick={() => recordAction('container_deposit')}
                            disabled={!isOnline || isSaving || policyLoading || hasInvalidConcentration}
                            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSaving && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
                            {t('waste_action_container_deposit')}
                        </button>
                    ) : decision.decisionStatus === 'blocked' ? (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => recordAction('isolated')}
                                disabled={!isOnline || isSaving || policyLoading || !hasAmountConfirmation || hasInvalidConcentration}
                                className="min-h-12 rounded-xl border border-red-300 bg-white px-3 font-bold text-red-700 disabled:opacity-50 dark:border-red-800 dark:bg-slate-950 dark:text-red-300"
                            >
                                {t('waste_action_isolated')}
                            </button>
                            <button
                                onClick={() => recordAction('handover')}
                                disabled={!isOnline || isSaving || policyLoading || !hasAmountConfirmation || hasInvalidConcentration}
                                className="min-h-12 rounded-xl bg-red-600 px-3 font-bold text-white hover:bg-red-700 disabled:opacity-50"
                            >
                                {t('waste_action_handover')}
                            </button>
                        </div>
                    ) : (
                        <button disabled className="min-h-12 w-full rounded-xl bg-orange-100 px-4 font-bold text-orange-800 dark:bg-orange-950/60 dark:text-orange-200">
                            {statusConfig.title}
                        </button>
                    )}
                </footer>
            </div>
        </div>
    );
};
