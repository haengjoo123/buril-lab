import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    resolveSingleCasSuggestion,
    type CasResolveCandidateOption,
    type CasResolveItemResult,
    type CasSuggestionConfidence,
} from '../services/casSuggestionService';

type CasSuggestionUiState = 'idle' | 'checking' | 'suggestion' | 'applied' | 'dismissed' | 'unavailable';

interface UseCasSuggestionParams {
    enabled?: boolean;
    inputName: string;
    casNumber: string;
    sourceType: string;
    brand?: string;
    productNumber?: string;
    capacity?: string;
    onApplyCasNumber: (casNumber: string) => void;
}

interface UseCasSuggestionResult {
    state: CasSuggestionUiState;
    suggestion: CasResolveItemResult | null;
    shouldRenderCard: boolean;
    markNameInputChanged: () => void;
    triggerLookupFromBlur: () => void;
    triggerLookupFromCasFocus: () => void;
    dismissSuggestion: () => void;
    applySuggestion: (candidate?: CasResolveCandidateOption) => void;
    undoAppliedSuggestion: () => void;
    appliedSuggestion: CasResolveItemResult | null;
    isSuggestedCasApplied: boolean;
}

function normalizeLookupName(value?: string | null): string {
    return (value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function canDisplaySuggestion(result: CasResolveItemResult | null): boolean {
    if (!result) return false;
    if (result.status === 'match') {
        return result.confidence === 'high' || result.confidence === 'medium';
    }
    if (result.status === 'ambiguous') {
        return (result.alternatives?.length || 0) > 0;
    }
    return false;
}

function materializeCandidateSuggestion(
    source: CasResolveItemResult,
    candidate: CasResolveCandidateOption,
): CasResolveItemResult {
    return {
        ...source,
        status: 'match',
        casNumber: candidate.casNumber,
        canonicalName: candidate.canonicalName || source.canonicalName,
        localizedName: candidate.localizedName || source.localizedName,
        matchedAlias: candidate.matchedAlias || source.matchedAlias,
        confidence: candidate.confidence,
        alternatives: undefined,
        reason: undefined,
    };
}

export function useCasSuggestion({
    enabled = true,
    inputName,
    casNumber,
    sourceType,
    brand,
    productNumber,
    capacity,
    onApplyCasNumber,
}: UseCasSuggestionParams): UseCasSuggestionResult {
    const [checkingNameKey, setCheckingNameKey] = useState<string | null>(null);
    const [resolvedSuggestionEntry, setResolvedSuggestionEntry] = useState<{
        nameKey: string;
        result: CasResolveItemResult | null;
    } | null>(null);
    const [appliedSuggestion, setAppliedSuggestion] = useState<CasResolveItemResult | null>(null);
    const [debouncedLookupVersion, setDebouncedLookupVersion] = useState(0);
    const lastResolvedKeyRef = useRef('');
    const lastDismissedKeyRef = useRef('');
    const lookupRequestIdRef = useRef(0);

    const nameKey = useMemo(() => normalizeLookupName(inputName), [inputName]);
    const casValue = casNumber.trim();
    const appliedCas = appliedSuggestion?.casNumber?.trim() || '';
    const suggestion = useMemo(() => {
        if (!enabled || !nameKey || casValue) return null;
        if (!resolvedSuggestionEntry || resolvedSuggestionEntry.nameKey !== nameKey) return null;
        return resolvedSuggestionEntry.result;
    }, [casValue, enabled, nameKey, resolvedSuggestionEntry]);
    const activeAppliedSuggestion = useMemo(() => {
        if (!enabled || !appliedSuggestion) return null;
        if (!casValue || casValue !== appliedCas) return null;
        return appliedSuggestion;
    }, [appliedCas, appliedSuggestion, casValue, enabled]);
    const state = useMemo<CasSuggestionUiState>(() => {
        if (!enabled) return 'idle';
        if (activeAppliedSuggestion) return 'applied';
        if (!nameKey || casValue) return 'idle';
        if (lastDismissedKeyRef.current === nameKey) return 'dismissed';
        if (checkingNameKey === nameKey) return 'checking';
        if (canDisplaySuggestion(suggestion)) return 'suggestion';
        if (suggestion?.status === 'skipped') return 'idle';
        return suggestion ? 'unavailable' : 'idle';
    }, [activeAppliedSuggestion, casValue, checkingNameKey, enabled, nameKey, suggestion]);

    const runLookup = useCallback(async () => {
        if (!enabled) return;
        if (!nameKey || casValue) return;
        if (lastDismissedKeyRef.current === nameKey) return;
        if (
            lastResolvedKeyRef.current === nameKey
            && (
                checkingNameKey === nameKey
                || (resolvedSuggestionEntry?.nameKey === nameKey && resolvedSuggestionEntry.result !== null)
            )
        ) {
            return;
        }

        const requestId = lookupRequestIdRef.current + 1;
        lookupRequestIdRef.current = requestId;
        const requestNameKey = nameKey;

        setCheckingNameKey(requestNameKey);

        try {
            const result = await resolveSingleCasSuggestion({
                id: `${sourceType}:${requestNameKey}`,
                inputName,
                sourceType,
                brand,
                productNumber,
                capacity,
            });

            if (lookupRequestIdRef.current !== requestId) {
                return;
            }

            lastResolvedKeyRef.current = requestNameKey;
            setResolvedSuggestionEntry({ nameKey: requestNameKey, result });
        } catch (error) {
            console.warn('[CAS Suggestion] Failed to resolve suggestion:', error);
            if (lookupRequestIdRef.current !== requestId) {
                return;
            }
            setResolvedSuggestionEntry(null);
        } finally {
            if (lookupRequestIdRef.current === requestId) {
                setCheckingNameKey((current) => current === requestNameKey ? null : current);
            }
        }
    }, [brand, capacity, casValue, checkingNameKey, enabled, inputName, nameKey, productNumber, resolvedSuggestionEntry, sourceType]);

    useEffect(() => {
        if (!enabled) return;
        if (debouncedLookupVersion === 0) return;
        if (!nameKey || casValue || state === 'applied') return;
        if (lastDismissedKeyRef.current === nameKey) return;

        const timer = window.setTimeout(() => {
            void runLookup();
        }, 500);

        return () => window.clearTimeout(timer);
    }, [casValue, debouncedLookupVersion, enabled, nameKey, runLookup, state]);

    const markNameInputChanged = useCallback(() => {
        if (!enabled) return;
        setDebouncedLookupVersion((current) => current + 1);
    }, [enabled]);

    const triggerLookupFromBlur = useCallback(() => {
        if (!enabled) return;
        if (!nameKey || casValue || state === 'applied') return;
        void runLookup();
    }, [casValue, enabled, nameKey, runLookup, state]);

    const triggerLookupFromCasFocus = useCallback(() => {
        if (!enabled) return;
        if (!nameKey || casValue || state === 'applied') return;
        void runLookup();
    }, [casValue, enabled, nameKey, runLookup, state]);

    const dismissSuggestion = useCallback(() => {
        lastDismissedKeyRef.current = nameKey;
    }, [nameKey]);

    const applySuggestion = useCallback((candidate?: CasResolveCandidateOption) => {
        if (!suggestion) return;

        const selectedSuggestion = candidate
            ? materializeCandidateSuggestion(suggestion, candidate)
            : suggestion;

        if (!selectedSuggestion.casNumber) return;

        onApplyCasNumber(selectedSuggestion.casNumber);
        setAppliedSuggestion(selectedSuggestion);
    }, [onApplyCasNumber, suggestion]);

    const undoAppliedSuggestion = useCallback(() => {
        onApplyCasNumber('');
        setAppliedSuggestion(null);
        setResolvedSuggestionEntry(null);
        lastResolvedKeyRef.current = '';
    }, [onApplyCasNumber]);

    const shouldRenderCard = state === 'checking'
        || state === 'suggestion'
        || state === 'applied'
        || state === 'unavailable';

    return {
        state,
        suggestion,
        shouldRenderCard,
        markNameInputChanged,
        triggerLookupFromBlur,
        triggerLookupFromCasFocus,
        dismissSuggestion,
        applySuggestion,
        undoAppliedSuggestion,
        appliedSuggestion: activeAppliedSuggestion,
        isSuggestedCasApplied: Boolean(activeAppliedSuggestion),
    };
}

export function getSuggestedCasInputMethod(
    isApplied: boolean,
    fallback: 'manual' | 'catalog' | 'scan' | 'ocr' | 'voice' | 'unknown',
    confidence?: CasSuggestionConfidence,
): 'manual' | 'catalog' | 'scan' | 'ocr' | 'voice' | 'unknown' | 'suggested_confirmed' {
    if (isApplied && (confidence === 'high' || confidence === 'medium')) {
        return 'suggested_confirmed';
    }

    return fallback;
}
