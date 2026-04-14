import React from 'react';
import { CheckCircle2, FlaskConical, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { CasResolveCandidateOption, CasResolveItemResult } from '../services/casSuggestionService';

type CardState = 'checking' | 'suggestion' | 'applied' | 'unavailable';

interface Props {
    state: CardState;
    suggestion: CasResolveItemResult | null;
    inputName: string;
    onApply?: (candidate?: CasResolveCandidateOption) => void;
    onDismiss?: () => void;
    onUndo?: () => void;
    actionSlot?: React.ReactNode;
    className?: string;
}

function getUnavailableText(
    t: ReturnType<typeof useTranslation>['t'],
    suggestion: CasResolveItemResult | null,
): string | null {
    if (!suggestion) return null;
    if (suggestion.status === 'no_match') {
        return t('cas_suggestion_unavailable_no_match', '정확히 확인된 CAS 후보를 찾지 못했어요.');
    }
    if (suggestion.status === 'ambiguous' && (!suggestion.alternatives || suggestion.alternatives.length === 0)) {
        return t('cas_suggestion_unavailable_ambiguous', '비슷한 물질이 여러 개라 자동 제안하지 않았어요.');
    }
    if (suggestion.status === 'conflict') {
        return t('cas_suggestion_unavailable_conflict', '서로 다른 물질로 확인되어 자동 제안하지 않았어요.');
    }
    if (suggestion.status === 'match' && suggestion.confidence === 'low') {
        return t('cas_suggestion_unavailable_low_confidence', '근거가 충분하지 않아 자동 제안하지 않았어요.');
    }
    return null;
}

function renderTopActionGroup(
    t: ReturnType<typeof useTranslation>['t'],
    onDismiss?: () => void,
    onApply?: (candidate?: CasResolveCandidateOption) => void,
) {
    if (!onDismiss && !onApply) return null;

    return (
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
            {onDismiss && (
                <button
                    type="button"
                    onClick={onDismiss}
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 sm:w-auto sm:py-1"
                >
                    <X className="h-3.5 w-3.5" />
                    {t('btn_close', '닫기')}
                </button>
            )}
            {onApply && (
                <button
                    type="button"
                    onClick={() => onApply()}
                    className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700 sm:w-auto sm:py-1"
                >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t('cas_suggestion_apply', '이 후보 적용')}
                </button>
            )}
        </div>
    );
}

export const CasSuggestionCard: React.FC<Props> = ({
    state,
    suggestion,
    inputName,
    onApply,
    onDismiss,
    onUndo,
    actionSlot,
    className,
}) => {
    const { t } = useTranslation();

    if (state === 'checking') {
        return (
            <div className={`mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 ${className || ''}`}>
                <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                    <span>{t('cas_suggestion_loading', '이름과 맞는 CAS 후보를 확인하고 있어요.')}</span>
                </div>
            </div>
        );
    }

    if (state === 'applied' && suggestion?.casNumber) {
        return (
            <div className={`mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-800 ${className || ''}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-semibold">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            <span>{t('cas_suggestion_applied', 'CAS 적용됨')}</span>
                        </div>
                        <p className="mt-1 break-keep break-words text-sm font-semibold leading-5 text-slate-800">
                            {suggestion.canonicalName || inputName}
                        </p>
                        {suggestion.localizedName && suggestion.localizedName !== suggestion.canonicalName && (
                            <p className="mt-0.5 break-keep break-words text-xs leading-5 text-slate-500">
                                {suggestion.localizedName}
                            </p>
                        )}
                        <div className="mt-2 inline-flex rounded-full border border-emerald-200 bg-white px-2 py-0.5 font-mono text-[11px] text-emerald-700">
                            CAS {suggestion.casNumber}
                        </div>
                    </div>
                    {onUndo && (
                        <button
                            type="button"
                            onClick={onUndo}
                            className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-2 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 sm:w-auto sm:shrink-0 sm:justify-start sm:py-1"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t('cas_suggestion_undo', '되돌리기')}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (state === 'unavailable') {
        const unavailableText = getUnavailableText(t, suggestion);
        if (!unavailableText) return null;

        return (
            <div className={`mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 ${className || ''}`}>
                <div className="flex items-start gap-2">
                    <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="break-keep break-words leading-5">{unavailableText}</span>
                </div>
            </div>
        );
    }

    const isSingleSuggestion = state === 'suggestion' && suggestion?.status === 'match' && Boolean(suggestion.casNumber);
    const alternativeCandidates = suggestion?.status === 'ambiguous'
        ? (suggestion.alternatives || []).slice(0, 3)
        : [];
    const isAlternativeSuggestion = state === 'suggestion' && alternativeCandidates.length > 0;

    if (!isSingleSuggestion && !isAlternativeSuggestion) {
        return null;
    }

    const confidenceLabel = suggestion?.confidence === 'high'
        ? t('cas_suggestion_confidence_high', '신뢰 높음')
        : t('cas_suggestion_confidence_medium', '검토 필요');
    const confidenceStyle = suggestion?.confidence === 'high'
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-amber-100 text-amber-700';

    return (
        <div className={`mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 ${className || ''}`}>
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
                                <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                                {t('cas_suggestion_title', 'CAS 제안')}
                            </span>
                            {!isAlternativeSuggestion && (
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${confidenceStyle}`}>
                                    {confidenceLabel}
                                </span>
                            )}
                        </div>
                    </div>
                    {isSingleSuggestion && (actionSlot || renderTopActionGroup(t, onDismiss, onApply))}
                </div>

                {isAlternativeSuggestion ? (
                    <div className="space-y-2">
                        <p className="text-xs leading-5 text-slate-600">
                            {t('cas_suggestion_ambiguous_intro', '비슷한 후보가 있어요. 맞는 물질을 직접 골라주세요.')}
                        </p>
                        {alternativeCandidates.map((candidate) => (
                            <div
                                key={`${candidate.casNumber}:${candidate.canonicalName || candidate.localizedName || ''}`}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-3"
                            >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0 flex-1">
                                        <p className="break-keep break-words text-sm font-semibold leading-5 text-slate-800">
                                            {candidate.canonicalName || inputName}
                                        </p>
                                        {candidate.localizedName && candidate.localizedName !== candidate.canonicalName && (
                                            <p className="mt-0.5 break-keep break-words text-xs leading-5 text-slate-500">
                                                {candidate.localizedName}
                                            </p>
                                        )}
                                        <div className="mt-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700">
                                            CAS {candidate.casNumber}
                                        </div>
                                    </div>
                                    {onApply && (
                                        <button
                                            type="button"
                                            onClick={() => onApply(candidate)}
                                            className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700 sm:w-auto sm:shrink-0 sm:py-1"
                                        >
                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                            {t('cas_suggestion_apply', '이 후보 적용')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {onDismiss && (
                            <div className="pt-1">
                                <button
                                    type="button"
                                    onClick={onDismiss}
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100"
                                >
                                    <X className="h-3.5 w-3.5" />
                                    {t('btn_close', '닫기')}
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="min-w-0">
                        <p className="break-keep break-words text-sm font-semibold leading-5 text-slate-800">
                            {suggestion?.canonicalName || inputName}
                        </p>
                        {suggestion?.localizedName && suggestion.localizedName !== suggestion.canonicalName && (
                            <p className="mt-0.5 break-keep break-words text-xs leading-5 text-slate-500">
                                {suggestion.localizedName}
                            </p>
                        )}
                        <div className="mt-2 inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700">
                            CAS {suggestion?.casNumber}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
