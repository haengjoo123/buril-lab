/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import type { AnalysisResult } from '../types';
import { AlertTriangle, Plus, FileText, Sparkles, ChevronDown, PackagePlus } from 'lucide-react';
import { useWasteStore } from '../store/useWasteStore';
import { useTranslation } from 'react-i18next';
import { getPictogramCode, getPictogramUrl, translateGHS } from '../data/ghsCodes';
import { MsdsModal } from './MsdsModal';
import { ChemicalRegulationPanel } from './ChemicalRegulationPanel';
import { SdsLinkList } from './SdsLinkList';
import { isValidCasNumber } from '../utils/casNumber';
import { scanIdentityMatchesChemical } from '../utils/scanIdentity';
import type { ScannerSelectionMeta } from './Scanner';

interface ResultCardProps {
    result: AnalysisResult;
    onReset: () => void;
    onAddConfirmed?: () => void;
    /** 비로그인 시 폐기 목록 담기 대신 호출 */
    onRequireAuth?: () => void;
    /** 닫기 버튼 텍스트. 지정한 경우에만 액션 바에 닫기 버튼을 둔다 (검색 화면은 뒤로가기/검색창으로 충분). */
    secondaryBtnText?: string;
    /** 지정하면 액션 바에 '재고 등록' 보조 액션을 표시한다. */
    onRegisterInventory?: () => void;
    /** 헤더 아래 표시할 보조 요소 (예: 이미 보관 중인 시약장 위치). */
    headerAccessory?: React.ReactNode;
    scanSelectionMeta?: ScannerSelectionMeta;
    sourceSearchEventId?: string;
}

const compactReasonKeyByCategory: Partial<Record<AnalysisResult['category'], string>> = {
    ORGANIC_NON_HALOGEN: 'result_reason_compact_organic_non_halogen',
    ORGANIC_HALOGEN: 'result_reason_compact_organic_halogen',
};

const HANGUL_PATTERN = /[ㄱ-ㆎ가-힣]/;

const hasBalancedParentheses = (value: string) => {
    let depth = 0;
    for (const char of value) {
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        if (depth < 0) return false;
    }
    return depth === 0;
};

/** Search returns "국문명 (English name)"; show them on two lines instead of truncating one. */
const splitChemicalDisplayName = (name: string): { primary: string; secondary: string | null } => {
    const trimmed = name.trim();
    if (!trimmed.endsWith(')')) return { primary: trimmed, secondary: null };

    let searchFrom = 0;
    for (;;) {
        const index = trimmed.indexOf(' (', searchFrom);
        if (index <= 0) break;
        const primary = trimmed.slice(0, index).trim();
        const secondary = trimmed.slice(index + 2, -1).trim();
        if (
            HANGUL_PATTERN.test(primary) &&
            secondary &&
            !HANGUL_PATTERN.test(secondary) &&
            hasBalancedParentheses(secondary)
        ) {
            return { primary, secondary };
        }
        searchFrom = index + 2;
    }
    return { primary: trimmed, secondary: null };
};

export const ResultCard: React.FC<ResultCardProps> = ({
    result,
    onReset,
    onAddConfirmed,
    onRequireAuth,
    secondaryBtnText,
    onRegisterInventory,
    headerAccessory,
    scanSelectionMeta,
    sourceSearchEventId,
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
            sourceSearchEventId,
        } : { sourceSearchEventId });

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
    const ghsPictogramSources = chemical.ghs?.pictograms?.length
        ? chemical.ghs.pictograms
        : chemical.hazardLookup?.pictograms;
    const ghsPictograms = React.useMemo(() => {
        const seen = new Set<string>();
        return (ghsPictogramSources ?? []).flatMap((source) => {
            const code = getPictogramCode(source);
            const url = getPictogramUrl(source);
            if (!code || !url || seen.has(code)) return [];
            seen.add(code);
            return [{ code, url }];
        });
    }, [ghsPictogramSources]);
    const ghsSignal = chemical.ghs?.signal?.trim() ?? '';
    const isDangerSignal = ghsSignal.toLowerCase() === 'danger';
    const ghsSignalLabel = isDangerSignal
        ? t('ghs_signal_danger' as any)
        : ghsSignal.toLowerCase() === 'warning'
            ? t('ghs_signal_warning' as any)
            : ghsSignal;
    const displayName = React.useMemo(() => splitChemicalDisplayName(chemical.name), [chemical.name]);
    const hazardLookupPresentation = React.useMemo(() => {
        const status = chemical.hazardLookup?.status;
        if (!status) return null;

        switch (status) {
            case 'classified':
            case 'not_classified':
                // Completed lookup states are internal metadata. Classified
                // hazards are already rendered in the GHS panel below, while
                // not_classified must not be presented as a safety claim.
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
    return (
        <div
            data-onboarding-target="result-card"
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg overflow-clip border border-gray-100 dark:border-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
            {/* Header: Chemical Info */}
            <div className="p-5 bg-slate-50 dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700">
                <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <h3 className="break-words text-xl font-bold leading-snug text-slate-900 [word-break:keep-all] dark:text-white">{displayName.primary}</h3>
                        {displayName.secondary && (
                            <p className="mt-0.5 break-words text-sm font-medium leading-snug text-slate-500 dark:text-slate-400">
                                {displayName.secondary}
                            </p>
                        )}
                        <p className="text-slate-500 dark:text-slate-400 text-xs font-mono mt-1.5 truncate">
                            {chemical.molecularFormula} {chemical.casNumber ? `• CAS: ${chemical.casNumber}` : ''}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsMsdsOpen(true)}
                        aria-label={`${chemical.name} ${t('msds_view')}`}
                        data-onboarding-target="msds-button"
                        className="min-h-11 shrink-0 flex items-center gap-1 px-3 py-2 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
                    >
                        <FileText className="w-3.5 h-3.5" />
                        {t('msds_view')}
                    </button>
                </div>
                {headerAccessory}
            </div>

            {/* Body: Disposal Guide */}
            <div className="p-5 flex flex-col items-center text-center">

                {(identityAutomaticallyVerified || identityConfirmedByUser) && (
                    <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
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
                )}

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
                    </div>
                )}

                {referencePh !== undefined && (
                    <p className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {t('result_reference_ph' as any, { ph: referencePh })}
                    </p>
                )}

                {/* AI badge for model-assisted classification */}
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
                            {ghsPictograms.length > 0 ? (
                                <span className="flex shrink-0 items-center -space-x-1">
                                    {ghsPictograms.slice(0, 5).map(({ code, url }) => (
                                        <img
                                            key={code}
                                            src={url}
                                            alt={t(`ghs_pictogram_${code}` as any)}
                                            className="h-8 w-8 shrink-0 object-contain"
                                        />
                                    ))}
                                    {ghsPictograms.length > 5 && (
                                        <span className="pl-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                            +{ghsPictograms.length - 5}
                                        </span>
                                    )}
                                </span>
                            ) : (
                                <>
                                    <AlertTriangle className={`h-4 w-4 shrink-0 ${isDangerSignal ? 'text-red-600 dark:text-red-500' : 'text-orange-500'}`} />
                                    <span className={`text-sm font-bold ${isDangerSignal ? 'text-red-600 dark:text-red-500' : 'text-orange-600 dark:text-orange-400'}`}>
                                        {t('safety_ghs_short' as any)}
                                    </span>
                                </>
                            )}
                            {ghsSignalLabel && (
                                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-bold ${isDangerSignal ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'}`}>
                                    {ghsSignalLabel}
                                </span>
                            )}
                            {ghsPictograms.length === 0 && ghsCodes.length > 0 ? (
                                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                                    {ghsCodes.slice(0, 4).join(', ')}
                                    {ghsCodes.length > 4 ? ` +${ghsCodes.length - 4}` : ''}
                                </span>
                            ) : (
                                <span className="min-w-0 flex-1" />
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

                <ChemicalRegulationPanel casNumber={chemical.casNumber} className="mb-4 w-full" />

                <SdsLinkList variant="manufacturers" casNumber={chemical.casNumber} className="mb-4 w-full" />

                {/* Safety Warning if needed */}
                {!isSafe && (
                    <div className="w-full bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 p-3 rounded-lg flex items-start gap-2 text-sm text-left mb-4 border border-red-100 dark:border-red-900/50">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                        <span>
                            {t('safety_uncertain')}
                        </span>
                    </div>
                )}

            </div>

            {/* Sticky action bar: stays at the bottom of the scrolling pane/modal so the main
                action is always one tap away. overflow-clip (not hidden) on the card keeps sticky working. */}
            <div className="sticky bottom-0 z-10 border-t border-gray-100 bg-white/95 px-3 py-3 shadow-[0_-10px_24px_-18px_rgba(15,23,42,0.35)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
                <div className="flex w-full items-stretch gap-2">
                    {secondaryBtnText && (
                        <button
                            type="button"
                            onClick={onReset}
                            className="min-h-12 shrink-0 rounded-xl bg-gray-100 px-4 py-2.5 text-center text-sm font-medium leading-snug text-gray-700 transition-colors hover:bg-gray-200 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700"
                        >
                            {secondaryBtnText}
                        </button>
                    )}
                    {onRegisterInventory && (
                        <button
                            type="button"
                            onClick={onRegisterInventory}
                            className="inline-flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 text-sm font-semibold leading-snug text-emerald-700 transition-colors hover:bg-emerald-50 active:bg-emerald-100 dark:border-emerald-900/60 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                        >
                            <PackagePlus className="h-4 w-4 shrink-0" aria-hidden="true" />
                            {t('add_to_inventory')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleAddClick}
                        data-onboarding-target="add-to-list-button"
                        className="flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-center text-sm font-bold leading-snug text-white shadow-lg shadow-blue-200 transition-colors hover:bg-blue-700 active:bg-blue-800 dark:shadow-blue-900/20"
                    >
                        <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
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
