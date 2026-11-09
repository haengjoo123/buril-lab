import { useEffect, useRef } from 'react';
import { isChemicalEnrichmentEnabled } from '../config/featureFlags';
import { useWasteStore } from '../store/useWasteStore';

/** Recheck newly added identities without querying again for amount or hazard-checkbox edits. */
export function useWasteChemicalEnrichment(userId: string | null | undefined, labId: string | null) {
    const identityKey = useWasteStore((state) => JSON.stringify(state.cart.map((component) => [
        component.cartLineId,
        component.chemical.name,
        component.chemical.casNumber,
        component.chemical.molecularFormula,
        component.chemical.externalIdentifiers?.pubchemCid,
        component.chemical.externalIdentifiers?.standardInchiKey,
        component.phCatalogId,
        component.phCatalogMatch?.selection,
        component.enrichmentVersion ?? 0,
    ])));
    const refresh = useWasteStore((state) => state.refreshChemicalEnrichment);
    const pending = useRef<Promise<void>>(Promise.resolve());

    useEffect(() => {
        if (!userId || !isChemicalEnrichmentEnabled) return;
        let cancelled = false;
        // Serialize passes: an identity returned by enrichment can itself change the key.
        pending.current = pending.current.then(async () => {
            if (!cancelled) await refresh();
        }).catch(() => {
            console.error('Automatic waste chemical enrichment could not complete.');
        });
        return () => { cancelled = true; };
    }, [userId, labId, identityKey, refresh]);
}
