/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import type { AnalysisResult } from '../types';
import { AlertTriangle, Plus, FileText, Sparkles, ChevronDown } from 'lucide-react';
import { useWasteStore } from '../store/useWasteStore';
import { useTranslation } from 'react-i18next';
import { translateGHS } from '../data/ghsCodes';
import { MsdsModal } from './MsdsModal';
import { isValidCasNumber } from '../utils/casNumber';
import { scanIdentityMatchesChemical } from '../utils/scanIdentity';
import type { ScannerSelectionMeta } from './Scanner';

interface ResultCardProps {
    result: AnalysisResult;
    onReset: () => void;
    onAddConfirmed?: () => void;
    /** 비로그인 시 폐기 목록 담기 대신 호출 */
    onRequireAuth?: () => void;
    /** 커스텀 취소/닫기 버튼 텍스트 (기본값: btn_reset) */
    secondaryBtnText?: string;
    scanSelectionMeta?: ScannerSelectionMeta;
}

const compactReasonKeyByCategory: Partial<Record<AnalysisResult['category'], string>> = {
    ORGANIC_NON_HALOGEN: 'result_reason_compact_organic_non_halogen',
    ORGANIC_HALOGEN: 'result_reason_compact_organic_halogen',
};

export const ResultCard: React.FC<ResultCardProps> = ({
    result,
    onReset,
    onAddConfirmed,
    onRequireAuth,
    secondaryBtnText,
    scanSelectionMeta,
}) => {
    const { chemical, reason, isSafe, category, label } = result;
    const addToCart = useWasteStore((state) => state.addToCart);
    const hasActiveBatch = useWasteStore((state) => state.batch.components.length > 0);
    const { t, i18n } = useTranslation();
    const [isGhsExpanded, setIsGhsExpanded] = React.useState(false);

    const [isMsdsOpen, setIsMsdsOpen] = React.useState(false);
    const scanIdentityMatchesResult = scanSelectionMeta
        ? scanIdentityMatchesChemical(
            scanSelectionMeta.scanSnapshot,
            scanSelectionMeta.selectedField,
            chemical,
        )
        : false;
    const scanIdentityConfirmed = Boolean(
        scanSelectionMeta &&
        scanIdentityMatchesResult &&
        (scanSelectionMeta.autoVerifiedIdentity || scanSelectionMeta.userConfirmed)
    );
    const identityAutomaticallyVerified = scanSelectionMeta
        ? scanSelectionMeta.autoVerifiedIdentity && scanIdentityMatchesResult
        : !result.isAiEstimated && isValidCasNumber(chemical.casNumber);
    const identityConfirmedByUser = Boolean(
        scanSelectionMeta?.userConfirmed && scanIdentityMatchesResult
    );

    const handleAddClick = () => {
        if (onRequireAuth) {
            onRequireAuth();
            return;
        }
        addToCart({ ...result }, scanSelectionMeta ? {
            sourceType: 'scan',
            sourceRef: scanSelectionMeta.selectedField === 'casNumber'
                ? scanSelectionMeta.scanSnapshot.casNumber
                : scanSelectionMeta.scanSnapshot.name,
            identityConfidence: scanIdentityConfirmed ? 'verified' : 'review_required',
            identityConfirmedByUser,
            scanSnapshot: {
                ...scanSelectionMeta.scanSnapshot,
                selectedField: scanSelectionMeta.selectedField,
                userConfirmed: scanSelectionMeta.userConfirmed,
                autoVerifiedIdentity: scanSelectionMeta.autoVerifiedIdentity,
                matchedResultIdentity: scanIdentityMatchesResult,
            },
        } : undefined);

        onAddConfirmed?.();
        onReset(); // Clear current view
    };

    const reasonKey = compactReasonKeyByCategory[category] || reason;
    const referencePh = chemical.properties?.referencePh ?? chemical.properties?.ph;
    const hazardStatements = chemical.ghs?.hazardStatements;
    const ghsStatements = React.useMemo(() => {
        if (!hazardStatements) return [];
        return Array.from(new Set(
            hazardStatements.map(h => translateGHS(h, i18n.language as any))
        ));
    }, [hazardStatements, i18n.language]);
    const ghsCodes = React.useMemo(() => {
        if (!hazardStatements) return [];
        return Array.from(new Set(
            hazardStatements.flatMap(statement => statement.match(/H\d{3}/g) || [])
        ));
    }, [hazardStatements]);
    const hazardLookupPresentation = React.useMemo(() => {
        const status = chemical.hazardLookup?.status;
        if (!status) return null;

        switch (status) {
            case 'classified':
                return {
                    translationKey: 'waste_component_hazard_classified',
                    className: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100',
                };
            case 'not_classified':
                // This is a completed internal lookup state, not an actionable
                // safety message. Keep it out of the primary search result to
                // avoid implying that the product or mixture is safe.
                return null;
            case 'transient_error':
                return {
                    translationKey: 'waste_component_hazard_pending',
                    className: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100',
                };
            case 'identity_ambiguous':
                return {
                    translationKey: 'waste_component_hazard_identity_ambiguous',
                    className: 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-100',
                };
            case 'source_absent':
                return {
                    translationKey: 'waste_component_hazard_source_absent',
                    className: 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-100',
                };
            default:
                return null;
        }
    }, [chemical.hazardLookup?.status]);
    const hazardLookupSources = React.useMemo(() => (
        chemical.hazardLookup?.sources.map(source => (
            source.source === 'pubchem'
                ? `PubChem CID ${source.sourceId}`
                : `KOSHA ${source.sourceId}`
        )).join(' · ') || ''
    ), [chemical.hazardLookup?.sources]);

    return (
        <div
            data-onboarding-target="result-card"
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg overflow-hidden border border-gray-100 dark:border-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-5"
        >
            {/* Header: Chemical Info */}
            <div className="p-5 bg-slate-50 dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center gap-3">
                <div className="min-w-0 flex-1">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white truncate">{chemical.name}</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm font-mono mt-1 truncate">
                        {chemical.molecularFormula} {chemical.casNumber ? `• CAS: ${chemical.casNumber}` : ''}
                    </p>
                </div>
                <button
                    onClick={() => setIsMsdsOpen(true)}
                    aria-label={`${chemical.name} ${t('msds_view')}`}
                    data-onboarding-target="msds-button"
                    className="min-h-11 shrink-0 flex items-center gap-1 px-3 py-2 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
                >
                    <FileText className="w-3.5 h-3.5" />
                    {t('msds_view')}
                </button>
            </div>

            {/* Body: Disposal Guide */}
            <div className="p-5 flex flex-col items-center text-center">

                <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {t('result_basis_badge' as any)}
                    </span>
                    {identityAutomaticallyVerified && (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">
                            {t('result_auto_verified' as any)}
                        </span>
                    )}
                    {identityConfirmedByUser && (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200">
                            {t('result_user_verified' as any)}
                        </span>
                    )}
                </div>

                {scanSelectionMeta && !scanIdentityConfirmed && (
                    <p className="mb-4 w-full rounded-xl border border-orange-200 bg-orange-50 p-3 text-left text-sm font-medium text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-100">
                        {t('result_scan_identity_review' as any)}
                    </p>
                )}

                <h4 className="mb-1 text-2xl font-bold text-slate-800 [text-wrap:balance] dark:text-slate-100">
                    {label === 'label_ionic_organic_salt' ? (
                        <>
                            <span className="block sm:inline">{t('label_ionic_organic_salt_name' as any)}</span>{' '}
                            <span className="block whitespace-nowrap sm:inline">{t('label_ionic_organic_salt_note' as any)}</span>
                        </>
                    ) : t(label as any)}
                </h4>

                <p className="mb-4 max-w-xl break-keep text-sm leading-relaxed text-slate-600 [text-wrap:pretty] dark:text-slate-300">
                    {t(reasonKey as any, result.reasonParams)}
                </p>

                <p className="mb-4 text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t('result_solution_notice_short' as any)}
                </p>

                {hazardLookupPresentation && (
                    <div className={`mb-4 w-full rounded-xl border p-3 text-left text-sm font-medium ${hazardLookupPresentation.className}`}>
                        <p>{t(hazardLookupPresentation.translationKey as any)}</p>
                        {hazardLookupSources && (
                            <p className="mt-1 text-xs font-normal opacity-75">{hazardLookupSources}</p>
                        )}
                    </div>
                )}

                {referencePh !== undefined && (
                    <p className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {t('result_reference_ph' as any, { ph: referencePh })}
                    </p>
                )}

                {/* AI Badge if inferred by Gemini */}
                {result.isAiEstimated && (
                    <div className="flex items-center gap-1.5 justify-center w-full mb-4 animate-in fade-in duration-300 delay-200">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-bold border border-purple-200 dark:border-purple-800/50">
                            <Sparkles className="w-3.5 h-3.5" />
                            {t('label_ai_classified')}
                        </span>
                    </div>
                )}

                {/* MSDS / GHS Information */}
                {chemical.ghs && (
                    <div className="w-full mb-4 rounded-xl border border-orange-100 bg-orange-50 p-3 text-left dark:border-orange-900/30 dark:bg-orange-900/10 animate-in zoom-in-95 duration-300">
                        <button
                            type="button"
                            onClick={() => setIsGhsExpanded(!isGhsExpanded)}
                            className="flex w-full items-center gap-2 text-left"
                            aria-expanded={isGhsExpanded}
                            aria-label={t('safety_ghs' as any)}
                        >
                            <AlertTriangle className={`h-4 w-4 shrink-0 ${chemical.ghs.signal === 'Danger' ? 'text-red-600 dark:text-red-500' : 'text-orange-500'}`} />
                            <span className={`text-sm font-bold ${chemical.ghs.signal === 'Danger' ? 'text-red-600 dark:text-red-500' : 'text-orange-600 dark:text-orange-400'}`}>
                                {t('safety_ghs_short' as any)}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${chemical.ghs.signal === 'Danger' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'}`}>
                                {chemical.ghs.signal.toUpperCase()}
                            </span>
                            {ghsCodes.length > 0 && (
                                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                                    {ghsCodes.slice(0, 4).join(', ')}
                                    {ghsCodes.length > 4 ? ` +${ghsCodes.length - 4}` : ''}
                                </span>
                            )}
                            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isGhsExpanded ? 'rotate-180' : ''}`} />
                        </button>
                        {isGhsExpanded && (
                            <ul className="mt-3 space-y-1 border-t border-orange-100 pt-3 text-xs text-slate-700 dark:border-orange-900/30 dark:text-slate-300">
                                {ghsStatements.map((statement, idx) => (
                                    <li key={`${statement}-${idx}`} className="flex items-start gap-2">
                                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                                        <span>{statement}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {/* Safety Warning if needed */}
                {!isSafe && (
                    <div className="w-full bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 p-3 rounded-lg flex items-start gap-2 text-sm text-left mb-4 border border-red-100 dark:border-red-900/50">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                        <span>
                            {t('safety_uncertain')}
                        </span>
                    </div>
                )}

                <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                        type="button"
                        onClick={onReset}
                        className="min-h-11 py-2.5 px-3 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                    >
                        {secondaryBtnText || t('btn_reset')}
                    </button>
                    <button
                        type="button"
                        onClick={handleAddClick}
                        data-onboarding-target="add-to-list-button"
                        className="min-h-11 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-200 dark:shadow-blue-900/20 whitespace-nowrap"
                    >
                        <Plus className="w-4 h-4" aria-hidden="true" />
                        {t(hasActiveBatch
                            ? 'result_add_to_current_batch_cta' as any
                            : 'result_start_waste_batch_cta' as any)}
                    </button>
                </div>
            </div>

            {/* MSDS Modal */}
            <MsdsModal
                chemical={chemical}
                isOpen={isMsdsOpen}
                onClose={() => setIsMsdsOpen(false)}
            />
        </div>
    );
};
