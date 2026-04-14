import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    resolveSingleCasSuggestion,
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
    applySuggestion: () => void;
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
    if (!result || result.status !== 'match') return false;
    return result.confidence === 'high' || result.confidence === 'medium';
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
    const [state, setState] = useState<CasSuggestionUiState>('idle');
    const [suggestion, setSuggestion] = useState<CasResolveItemResult | null>(null);
    const [appliedSuggestion, setAppliedSuggestion] = useState<CasResolveItemResult | null>(null);
    const [debouncedLookupVersion, setDebouncedLookupVersion] = useState(0);
    const lastResolvedKeyRef = useRef('');
    const lastDismissedKeyRef = useRef('');
    const lastNameKeyRef = useRef('');

    const nameKey = useMemo(() => normalizeLookupName(inputName), [inputName]);
    const casValue = casNumber.trim();
    const appliedCas = appliedSuggestion?.casNumber?.trim() || '';

    const runLookup = useCallback(async () => {
        if (!enabled) return;
        if (!nameKey || casValue) return;
        if (lastDismissedKeyRef.current === nameKey) return;
        if (lastResolvedKeyRef.current === nameKey && (state === 'suggestion' || state === 'unavailable' || state === 'checking')) return;

        setState('checking');

        try {
            const result = await resolveSingleCasSuggestion({
                id: `${sourceType}:${nameKey}`,
                inputName,
                sourceType,
                brand,
                productNumber,
                capacity,
            });

            lastResolvedKeyRef.current = nameKey;
            setSuggestion(result);

            if (canDisplaySuggestion(result)) {
                setState('suggestion');
                return;
            }

            if (result?.status === 'skipped') {
                setState('idle');
                return;
            }

            setState(result ? 'unavailable' : 'idle');
        } catch (error) {
            console.warn('[CAS Suggestion] Failed to resolve suggestion:', error);
            setSuggestion(null);
            setState('idle');
        }
    }, [brand, capacity, casValue, enabled, inputName, nameKey, productNumber, sourceType, state]);

    useEffect(() => {
        if (!enabled) {
            setSuggestion(null);
            setAppliedSuggestion(null);
            setState('idle');
            return;
        }

        if (lastNameKeyRef.current !== nameKey) {
            lastNameKeyRef.current = nameKey;
            lastResolvedKeyRef.current = '';
            if (state !== 'applied') {
                setSuggestion(null);
                setState('idle');
            }
        }
    }, [enabled, nameKey, state]);

    useEffect(() => {
        if (!enabled) return;
        if (debouncedLookupVersion === 0) return;
        if (!nameKey || casValue) {
            if (state !== 'applied') {
                setSuggestion(null);
                setState('idle');
            }
            return;
        }

        if (lastDismissedKeyRef.current === nameKey) return;

        const timer = window.setTimeout(() => {
            void runLookup();
        }, 500);

        return () => window.clearTimeout(timer);
    }, [casValue, debouncedLookupVersion, enabled, nameKey, runLookup, state]);

    useEffect(() => {
        if (!appliedSuggestion) return;

        if (!casValue || casValue !== appliedCas) {
            setAppliedSuggestion(null);
            if (state === 'applied') {
                setState('idle');
            }
        }
    }, [appliedCas, appliedSuggestion, casValue, state]);

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
        setState('dismissed');
    }, [nameKey]);

    const applySuggestion = useCallback(() => {
        if (!suggestion?.casNumber) return;
        onApplyCasNumber(suggestion.casNumber);
        setAppliedSuggestion(suggestion);
        setState('applied');
    }, [onApplyCasNumber, suggestion]);

    const undoAppliedSuggestion = useCallback(() => {
        onApplyCasNumber('');
        setAppliedSuggestion(null);
        setState('idle');
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
        appliedSuggestion,
        isSuggestedCasApplied: Boolean(appliedSuggestion && casValue && casValue === appliedCas),
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
