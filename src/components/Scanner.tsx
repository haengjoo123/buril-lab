import React, { useRef, useState, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import {
    X,
    Loader2,
    Image as ImageIcon,
    RotateCcw,
    Check,
    Search,
    Sparkles,
    AlertTriangle,
} from 'lucide-react';
import {
    getAutoVerifiedReagentScanIdentity,
    getReagentScanIdentityCandidates,
    scanReagentLabel,
    type ReagentScanFieldSnapshot,
    type ReagentScanIdentityField,
    type ReagentScanResult,
    type ReagentScanValidation,
} from '../services/geminiReagentScanService';
import type { ManufacturerDateType } from '../utils/manufacturerDate';
import { useTranslation } from 'react-i18next';

export interface ScannerSelectionMeta {
    scanSnapshot: ReagentScanResult;
    selectedField: ReagentScanIdentityField;
    userConfirmed: boolean;
    autoVerifiedIdentity: boolean;
}

interface ScannerProps {
    onScan: (searchTerm: string, selectionMeta: ScannerSelectionMeta) => void;
    onClose: () => void;
}

type ScannerState = 'camera' | 'preview' | 'processing' | 'result';

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled]):not([tabindex="-1"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export const Scanner: React.FC<ScannerProps> = ({ onScan, onClose }) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const resultPanelRef = useRef<HTMLDivElement>(null);
    const webcamRef = useRef<Webcam>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { t } = useTranslation();

    const [state, setState] = useState<ScannerState>('camera');
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [scanResult, setScanResult] = useState<ReagentScanResult | null>(null);
    const [selectedField, setSelectedField] = useState<ReagentScanIdentityField | null>(null);
    const [userConfirmedSelection, setUserConfirmedSelection] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false);
    const [showFlash, setShowFlash] = useState(false);

    // Stop all camera tracks helper
    const stopCamera = useCallback(() => {
        const video = webcamRef.current?.video;
        if (video?.srcObject) {
            const stream = video.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
    }, []);

    // Cleanup camera on unmount
    useEffect(() => {
        return () => stopCamera();
    }, [stopCamera]);

    const closeScanner = useCallback(() => {
        stopCamera();
        onClose();
    }, [onClose, stopCamera]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const initialFocus = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]');
        (initialFocus ?? dialog).focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeScanner();
                return;
            }

            if (event.key !== 'Tab') return;
            const focusable = Array.from(
                dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
            ).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');

            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const activeElement = document.activeElement;
            if (!dialog.contains(activeElement)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            } else if (event.shiftKey && activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus();
        };
    }, [closeScanner]);

    useEffect(() => {
        if (state !== 'result' || !scanResult) return;
        resultPanelRef.current?.focus();
    }, [scanResult, state]);

    const resetToCamera = useCallback(() => {
        setState('camera');
        setCapturedImage(null);
        setScanResult(null);
        setSelectedField(null);
        setUserConfirmedSelection(false);
        setError(null);
        setCameraPermissionDenied(false);
    }, []);

    const processImage = useCallback(async (imageSrc: string) => {
        setState('processing');
        setError(null);

        try {
            const result = await scanReagentLabel(imageSrc);
            const identityCandidates = getReagentScanIdentityCandidates(result);

            if (result.success && identityCandidates.length > 0) {
                const autoVerifiedField = getAutoVerifiedReagentScanIdentity(result);
                setScanResult(result);
                setSelectedField(autoVerifiedField);
                setUserConfirmedSelection(false);
                setState('result');
            } else {
                setScanResult(result.success ? result : null);
                setError(result.error || t('scanner_error_cas'));
                setState('result');
            }
        } catch (err) {
            setError(t('scanner_error_cam'));
            console.error(err);
            setState('result');
        }
    }, [t]);

    const capture = useCallback(() => {
        console.log('[Scanner] Capture button clicked');

        const video = webcamRef.current?.video;
        if (video) {
            const canvas = document.createElement('canvas');

            // Limit max dimension to reduce upload size and processing time
            const MAX_SIZE = 1024;
            let width = video.videoWidth;
            let height = video.videoHeight;

            if (width > height) {
                if (width > MAX_SIZE) {
                    height = Math.round((height * MAX_SIZE) / width);
                    width = MAX_SIZE;
                }
            } else {
                if (height > MAX_SIZE) {
                    width = Math.round((width * MAX_SIZE) / height);
                    height = MAX_SIZE;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            if (ctx) {
                ctx.drawImage(video, 0, 0, width, height);
                // Compress JPEG to 80% quality
                const imageSrc = canvas.toDataURL('image/jpeg', 0.8);
                console.log(`[Scanner] Captured resolution: ${width}x${height}`);

                setShowFlash(true);
                setTimeout(() => setShowFlash(false), 150);

                setCapturedImage(imageSrc);
                setState('preview');
                return;
            }
        }

        setError(t('scanner_error_cam'));
        console.error('[Scanner] Failed to capture screenshot');
    }, [t]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_SIZE = 1024;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_SIZE) {
                            height = Math.round((height * MAX_SIZE) / width);
                            width = MAX_SIZE;
                        }
                    } else {
                        if (height > MAX_SIZE) {
                            width = Math.round((width * MAX_SIZE) / height);
                            height = MAX_SIZE;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, width, height);
                        setCapturedImage(canvas.toDataURL('image/jpeg', 0.8));
                    } else {
                        // Fallback if canvas context fails
                        setCapturedImage(reader.result as string);
                    }
                    setState('preview');
                };
                img.src = reader.result;
            }
        };
        reader.readAsDataURL(file);
    };

    const confirmAndProcess = () => {
        if (capturedImage) {
            processImage(capturedImage);
        }
    };

    const identityCandidates = scanResult
        ? getReagentScanIdentityCandidates(scanResult)
        : [];
    const autoVerifiedField = scanResult
        ? getAutoVerifiedReagentScanIdentity(scanResult)
        : null;
    const selectedCandidate = identityCandidates.find(({ field }) => field === selectedField);
    const canUseSelection = Boolean(
        scanResult
        && selectedCandidate
        && (autoVerifiedField === selectedField || userConfirmedSelection),
    );

    const selectIdentity = (field: ReagentScanIdentityField) => {
        setSelectedField(field);
        setUserConfirmedSelection(true);
    };

    const useSearchTerm = () => {
        if (!scanResult || !selectedCandidate || !canUseSelection || !selectedField) return;

        stopCamera();
        onScan(selectedCandidate.value, {
            scanSnapshot: scanResult,
            selectedField,
            userConfirmed: userConfirmedSelection,
            autoVerifiedIdentity: autoVerifiedField === selectedField,
        });
    };

    const resultFields: Array<{
        key: Exclude<keyof NonNullable<ReagentScanResult['fieldSnapshots']>, 'containerType'>;
        label: string;
        snapshot?: ReagentScanFieldSnapshot<string | ManufacturerDateType>;
    }> = scanResult ? [
        { key: 'name', label: t('scanner_field_name'), snapshot: scanResult.fieldSnapshots?.name },
        { key: 'casNumber', label: t('scanner_field_cas'), snapshot: scanResult.fieldSnapshots?.casNumber },
        { key: 'capacity', label: t('scanner_field_capacity'), snapshot: scanResult.fieldSnapshots?.capacity },
        { key: 'expiryDate', label: t('scanner_field_expiry'), snapshot: scanResult.fieldSnapshots?.expiryDate },
        { key: 'manufacturerDateType', label: t('manufacturer_date_type_label'), snapshot: scanResult.fieldSnapshots?.manufacturerDateType },
        { key: 'brand', label: t('scanner_field_brand'), snapshot: scanResult.fieldSnapshots?.brand },
        { key: 'productNumber', label: t('scanner_field_product_number'), snapshot: scanResult.fieldSnapshots?.productNumber },
    ] : [];

    const validationLabel = (validation: ReagentScanValidation | undefined, confidence = 0) => {
        if (validation === 'valid' && confidence >= 0.8) return t('scanner_validation_verified');
        if (validation === 'valid' || validation === 'review_required') return t('scanner_validation_review');
        if (validation === 'invalid') return t('scanner_validation_invalid');
        return t('scanner_validation_missing');
    };

    const validationClasses = (validation: ReagentScanValidation | undefined, confidence = 0) => {
        if (validation === 'valid' && confidence >= 0.8) {
            return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
        }
        if (validation === 'valid' || validation === 'review_required') {
            return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
        }
        if (validation === 'invalid') {
            return 'border-red-400/30 bg-red-400/10 text-red-100';
        }
        return 'border-slate-500/30 bg-slate-700/50 text-slate-300';
    };

    const confidencePercent = (confidence: number) => (
        Number.isFinite(confidence)
            ? Math.round(Math.min(Math.max(confidence, 0), 1) * 100)
            : 0
    );

    return (
        <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scanner-dialog-title"
            tabIndex={-1}
            className="fixed inset-0 z-50 bg-black flex flex-col justify-center items-center"
        >
            {/* Flash Effect */}
            {showFlash && (
                <div className="absolute inset-0 bg-white z-50 animate-pulse" />
            )}

            {/* Close Button */}
            <button
                type="button"
                onClick={closeScanner}
                aria-label={t('btn_close')}
                data-dialog-initial-focus
                className="absolute right-5 top-[calc(1.25rem+env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center text-white/80 hover:text-white z-30"
            >
                <X className="w-8 h-8" />
            </button>

            {/* State-based Header */}
            <div id="scanner-dialog-title" className="absolute top-[calc(4rem+env(safe-area-inset-top))] text-center text-white/90 text-sm px-4 bg-black/50 p-2 rounded z-20">
                {state === 'camera' && t('scanner_guide')}
                {state === 'preview' && t('scanner_preview')}
                {state === 'processing' && t('scanner_processing')}
                {state === 'result' && t('scanner_result')}
            </div>

            {/* Main View Area */}
            <div className="relative w-full max-w-[430px] aspect-[3/4] bg-black overflow-hidden rounded-lg shadow-2xl flex-shrink-0">
                {/* Camera View */}
                {state === 'camera' && (
                    <>
                        <Webcam
                            audio={false}
                            ref={webcamRef}
                            screenshotFormat="image/jpeg"
                            screenshotQuality={1}
                            videoConstraints={{
                                facingMode: 'environment',
                                width: { ideal: 3840 },
                                height: { ideal: 2160 },
                            }}
                            className="w-full h-full object-cover"
                            onUserMedia={(stream) => {
                                setCameraPermissionDenied(false);
                                setError(null);
                                const track = stream.getVideoTracks()[0];
                                const settings = track.getSettings();
                                console.log(`[Scanner] Camera initialized: ${settings.width}x${settings.height}`);
                            }}
                            onUserMediaError={(err) => {
                                console.error('[Scanner] Camera error:', err);
                                const errorName = typeof err === 'object' && err && 'name' in err
                                    ? String((err as { name?: string }).name)
                                    : '';
                                const denied = ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(errorName);
                                setCameraPermissionDenied(denied);
                                setError(denied ? t('scanner_permission_denied') : t('scanner_error_cam'));
                            }}
                        />
                        {/* Viewfinder Overlay */}
                        <div className="absolute inset-0 border-2 border-white/30 pointer-events-none flex items-center justify-center">
                            <div className="w-80 h-48 border-2 border-yellow-400/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"></div>
                        </div>
                    </>
                )}

                {/* Preview / Processing / Result Image View */}
                {(state === 'preview' || state === 'processing' || state === 'result') && capturedImage && (
                    <img
                        src={capturedImage}
                        alt={t('common_captured_image_alt')}
                        className={`w-full h-full object-cover transition-opacity duration-300 ${state === 'processing' ? 'opacity-50 blur-sm' : 'opacity-100'}`}
                    />
                )}

                {/* Processing Overlay */}
                {state === 'processing' && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white z-10 transition-opacity">
                        <Loader2 className="w-12 h-12 animate-spin mb-4 text-purple-400" />
                        <div className="flex items-center gap-2 text-purple-200 font-medium">
                            <Sparkles className="w-4 h-4" />
                            <span>{t('scanner_ai_analyzing')}</span>
                        </div>
                    </div>
                )}

                {/* Structured Result Overlay */}
                {state === 'result' && scanResult && identityCandidates.length > 0 && (
                    <div
                        ref={resultPanelRef}
                        tabIndex={-1}
                        aria-live="polite"
                        className="absolute inset-0 overflow-y-auto bg-slate-950/95 px-4 pb-5 pt-14 text-white backdrop-blur-sm"
                    >
                        <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
                            <div>
                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-purple-300">
                                    <Sparkles aria-hidden="true" className="h-4 w-4" />
                                    <span>{t('scanner_structured_result')}</span>
                                </div>
                                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                                    {t('scanner_structured_result_help')}
                                </p>
                            </div>

                            <fieldset className="rounded-xl border border-purple-400/30 bg-purple-400/10 p-3">
                                <legend className="px-1 text-sm font-semibold text-white">
                                    {identityCandidates.length > 1 || !autoVerifiedField
                                        ? t('scanner_choose_identity')
                                        : t('scanner_selected_identity')}
                                </legend>
                                <div className="mt-1 space-y-2">
                                    {identityCandidates.map((candidate) => {
                                        const checked = selectedField === candidate.field;
                                        const needsConfirmation = identityCandidates.length > 1
                                            || autoVerifiedField !== candidate.field;
                                        return (
                                            <label
                                                key={candidate.field}
                                                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${checked
                                                    ? 'border-purple-300 bg-purple-500/20'
                                                    : 'border-slate-600 bg-slate-900/70 hover:border-slate-400'}`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="scanner-identity"
                                                    value={candidate.field}
                                                    checked={checked}
                                                    onChange={() => selectIdentity(candidate.field)}
                                                    className="h-5 w-5 shrink-0 accent-purple-500"
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-xs text-slate-400">
                                                        {candidate.field === 'name'
                                                            ? t('scanner_field_name')
                                                            : t('scanner_field_cas')}
                                                    </span>
                                                    <span className="block break-words text-sm font-semibold text-white">
                                                        {candidate.value}
                                                    </span>
                                                </span>
                                                <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-medium ${needsConfirmation
                                                    ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
                                                    : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'}`}
                                                >
                                                    {needsConfirmation
                                                        ? t('scanner_selection_required')
                                                        : t('scanner_identity_auto_verified')}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                                {(identityCandidates.length > 1 || !autoVerifiedField) && !userConfirmedSelection && (
                                    <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-amber-100">
                                        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                                        <span>{t('scanner_identity_confirmation_help')}</span>
                                    </p>
                                )}
                            </fieldset>

                            <section aria-labelledby="scanner-field-results-title">
                                <h2 id="scanner-field-results-title" className="mb-2 text-sm font-semibold text-white">
                                    {t('scanner_detected_fields')}
                                </h2>
                                <dl className="space-y-2">
                                    {resultFields.map(({ key, label, snapshot }) => (
                                        <div
                                            key={key}
                                            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <dt className="text-xs font-medium text-slate-400">{label}</dt>
                                                <dd className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${validationClasses(snapshot?.validation, snapshot?.confidence)}`}>
                                                    {validationLabel(snapshot?.validation, snapshot?.confidence)}
                                                </dd>
                                            </div>
                                            <dd className="mt-1 break-words text-sm font-medium text-white">
                                                {snapshot?.value || t('scanner_value_not_detected')}
                                            </dd>
                                            {snapshot && snapshot.validation !== 'missing' && (
                                                <dd className="mt-1 text-[11px] text-slate-400">
                                                    {t('scanner_confidence', {
                                                        value: confidencePercent(snapshot.confidence),
                                                    })}
                                                </dd>
                                            )}
                                        </div>
                                    ))}
                                </dl>
                            </section>

                            <button
                                type="button"
                                onClick={useSearchTerm}
                                disabled={!canUseSelection}
                                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 font-bold text-white shadow-lg shadow-purple-900/50 transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
                            >
                                {canUseSelection ? (
                                    <Check aria-hidden="true" className="h-5 w-5" />
                                ) : (
                                    <Search aria-hidden="true" className="h-5 w-5" />
                                )}
                                <span>{canUseSelection
                                    ? t('scanner_search_selected_identity')
                                    : t('scanner_select_identity_first')}</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer Controls */}
            <div className="absolute bottom-[calc(2.5rem+env(safe-area-inset-bottom))] flex flex-col items-center gap-4 w-full px-5">
                {error && state === 'camera' && (
                    <div role="alert" className="max-w-sm rounded-xl bg-red-500/95 px-4 py-3 text-center text-sm text-white shadow-lg">
                        <p className="font-semibold">{error}</p>
                        {cameraPermissionDenied && <p className="mt-1 text-xs text-red-50">{t('scanner_permission_help')}</p>}
                    </div>
                )}

                {/* Camera Mode Controls */}
                {state === 'camera' && (
                    <>
                        <div className="flex items-center justify-center gap-8 w-full relative">
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                accept="image/*"
                                tabIndex={-1}
                                className="hidden"
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="flex h-12 w-12 items-center justify-center bg-white/20 hover:bg-white/30 rounded-full backdrop-blur-sm transition-colors text-white"
                                title={t('scanner_upload_photo')}
                                aria-label={t('scanner_upload_photo')}
                            >
                                <ImageIcon className="w-6 h-6" />
                            </button>

                            <button
                                onClick={capture}
                                disabled={cameraPermissionDenied}
                                aria-label={t('scanner_capture')}
                                className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <div className="w-16 h-16 bg-white border-4 border-slate-300 rounded-full"></div>
                            </button>

                            <div className="w-12"></div>
                        </div>
                        <div className="text-white text-xs opacity-70">{t('scanner_capture_guide')}</div>
                    </>
                )}

                {/* Preview / Error Mode Controls */}
                {(state === 'preview' || (state === 'result' && error)) && (
                    <div className="flex items-center justify-center gap-6">
                        <button
                            onClick={resetToCamera}
                            className="min-h-11 flex items-center gap-2 px-5 py-3 bg-slate-600 hover:bg-slate-500 text-white rounded-full transition-colors font-medium shadow-lg"
                        >
                            <RotateCcw className="w-5 h-5" />
                            <span>{t('scanner_retake')}</span>
                        </button>
                        {!error && (
                            <button
                                onClick={confirmAndProcess}
                                className="min-h-11 flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-full transition-colors font-bold shadow-lg shadow-green-900/40"
                            >
                                <Sparkles className="w-5 h-5" />
                                <span>{t('scanner_ai_detect')}</span>
                            </button>
                        )}
                    </div>
                )}

                {/* Status Notice for error without preview logic handling it correctly */}
                {state === 'result' && error && (
                    <div role="alert" className="absolute top-[-40px] bg-red-500/90 text-white px-4 py-2 rounded-lg text-sm animate-bounce w-max mx-auto left-0 right-0 text-center">
                        {error}
                    </div>
                )}

                {/* The "다시 촬영" button for result with searchTerm is now located above the input/bottom controls natively via the flex container, but actually it's better to add a small UI for it near the top left corner */}
            </div>

            {/* Top Left Retry Button for Result Mode */}
            {state === 'result' && !error && (
                <button
                    type="button"
                    onClick={resetToCamera}
                    className="absolute left-5 top-[calc(1.25rem+env(safe-area-inset-top))] z-30 flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-black/60 px-3 py-2 text-white/80 backdrop-blur-md hover:text-white"
                >
                    <RotateCcw aria-hidden="true" className="w-4 h-4" />
                    <span className="text-xs font-medium px-1">{t('scanner_retake')}</span>
                </button>
            )}
        </div>
    );
};

export default Scanner;
