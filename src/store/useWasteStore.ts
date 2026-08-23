import { create } from 'zustand';
import type {
    AmountUnit,
    CartItem,
    WasteBatchDraft,
    WasteComponent,
    WasteConcentration,
    WasteMatrix,
    WasteSolutionVolume,
    ChemicalEnrichmentResult,
    Chemical,
} from '../types';
import {
    createEmptyWasteBatch,
    createWasteComponentFromAnalysis,
    deriveWasteAmountFromComponentVolumes,
    inferWasteMatrixFromComponents,
    normalizeWasteAmount,
    deriveWasteHazardFlags,
} from '../utils/wasteBatch';
import { deriveWizardMatrixFromComponents } from '../utils/wasteBatchWizard';
import { searchHistoryService } from '../services/searchHistoryService';
import { resolvePhCatalogIdentity } from '../features/phPrediction';
import { analyzeChemical, detectChemicalMaterial } from '../utils/chemicalAnalyzer';
import { chemicalFromEnrichment, enrichChemicals } from '../services/chemicalEnrichmentService';
import { isChemicalEnrichmentEnabled } from '../config/featureFlags';

const BATCH_STORAGE_PREFIX = 'buril-waste-batch-v2:';
const LEGACY_STORAGE_KEY = 'buril-waste-store';
const BATCH_STORAGE_SCHEMA_VERSION = 6;
const PREVIOUS_BATCH_STORAGE_SCHEMA_VERSION = 5;
const OLDER_BATCH_STORAGE_SCHEMA_VERSION = 4;
const PARKED_BATCH_STORAGE_SCHEMA_VERSION = 3;
const LEGACY_BATCH_STORAGE_SCHEMA_VERSION = 2;
export const MAX_PARKED_WASTE_BATCHES = 10;
const PREVIOUS_MATRIX_STORAGE_PREFIX = 'buril-waste-previous-matrix-v2:';

interface WasteBatchStorageEnvelope {
    schemaVersion: typeof BATCH_STORAGE_SCHEMA_VERSION;
    ownerUserId: string;
    scopeKey: string;
    draft: WasteBatchDraft;
    parkedDrafts: WasteBatchDraft[];
}

interface LegacyWasteBatchStorageEnvelope {
    schemaVersion: typeof LEGACY_BATCH_STORAGE_SCHEMA_VERSION;
    ownerUserId: string;
    scopeKey: string;
    draft: WasteBatchDraft;
}

interface PreviousWasteBatchStorageEnvelope {
    schemaVersion: typeof PREVIOUS_BATCH_STORAGE_SCHEMA_VERSION;
    ownerUserId: string;
    scopeKey: string;
    draft: WasteBatchDraft;
    parkedDrafts: WasteBatchDraft[];
}

interface OlderWasteBatchStorageEnvelope {
    schemaVersion: typeof OLDER_BATCH_STORAGE_SCHEMA_VERSION;
    ownerUserId: string;
    scopeKey: string;
    draft: WasteBatchDraft;
    parkedDrafts: WasteBatchDraft[];
}

interface ParkedWasteBatchStorageEnvelope {
    schemaVersion: typeof PARKED_BATCH_STORAGE_SCHEMA_VERSION;
    ownerUserId: string;
    scopeKey: string;
    draft: WasteBatchDraft;
    parkedDrafts: WasteBatchDraft[];
}

interface LoadedWasteScope {
    batch: WasteBatchDraft;
    parkedBatches: WasteBatchDraft[];
}

const buildScopeKey = (userId: string | null, labId: string | null): string =>
    `${userId ?? 'anonymous'}:${labId ?? 'personal'}`;

const storageKeyForScope = (scopeKey: string): string =>
    `${BATCH_STORAGE_PREFIX}${scopeKey}`;

const previousMatrixKeyForScope = (scopeKey: string): string =>
    `${PREVIOUS_MATRIX_STORAGE_PREFIX}${scopeKey}`;

const canUseLocalStorage = (): boolean => typeof localStorage !== 'undefined';

const readStorage = (key: string): string | null => {
    if (!canUseLocalStorage()) return null;
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const removeStorage = (key: string): boolean => {
    if (!canUseLocalStorage()) return false;
    try {
        localStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
};

const readPreviousMatrix = (scopeKey: string): WasteMatrix | null => {
    const value = readStorage(previousMatrixKeyForScope(scopeKey));
    return value === 'aqueous' || value === 'organic_non_halogenated' ||
        value === 'organic_halogenated' || value === 'solid_slurry'
        ? value
        : null;
};

const savePreviousMatrix = (scopeKey: string, matrix: WasteMatrix): boolean => {
    if (!canUseLocalStorage() || matrix === 'unknown' || matrix === 'mixed_biphasic') return false;
    try {
        localStorage.setItem(previousMatrixKeyForScope(scopeKey), matrix);
        return true;
    } catch {
        return false;
    }
};

const isWasteBatchDraft = (value: unknown): value is WasteBatchDraft => {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Partial<WasteBatchDraft>;
    return typeof draft.id === 'string' &&
        typeof draft.scopeKey === 'string' &&
        Array.isArray(draft.components) &&
        typeof draft.matrix === 'string' &&
        Boolean(draft.totalAmount);
};

const parseLegacyNumber = (value: string): number | null => {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseLegacySolutionVolume = (value: string | undefined): WasteSolutionVolume | undefined => {
    if (!value) return undefined;
    const match = value.match(/^\s*(\d+(?:[.,]\d+)?)\s*(uL|µL|μL|mL|L)\s*$/i);
    if (!match) return undefined;
    const numericValue = parseLegacyNumber(match[1]);
    if (numericValue === null) return undefined;
    const rawUnit = match[2].toLowerCase();
    const unit: WasteSolutionVolume['unit'] = rawUnit === 'l'
        ? 'L'
        : rawUnit === 'ml' ? 'mL' : 'uL';
    const normalizedMl = unit === 'L'
        ? numericValue * 1_000
        : unit === 'uL' ? numericValue / 1_000 : numericValue;
    return { value: numericValue, unit, normalizedMl };
};

const parseLegacyConcentration = (
    value: string | undefined,
): WasteConcentration | undefined => {
    if (!value) return undefined;
    const match = value.match(/^\s*(\d+(?:[.,]\d+)?)\s*(mM|M|mg\s*\/\s*mL)\s*$/);
    if (!match) return undefined;
    const numericValue = parseLegacyNumber(match[1]);
    if (numericValue === null) return undefined;
    const compactUnit = match[2].replace(/\s+/g, '');
    const unit: WasteConcentration['unit'] = compactUnit === 'mg/mL'
        ? 'mg/mL'
        : compactUnit === 'mM' ? 'mM' : 'M';
    return { value: numericValue, unit };
};

const normalizeWasteComponent = (component: WasteComponent): WasteComponent => {
    const materialProfile = component.materialProfile ?? detectChemicalMaterial(component.chemical);
    const legacyHazardFlags = component.hazardFlags ?? [];
    const manualHazardFlags = component.manualHazardFlags ?? (
        component.hazardDataConfirmedByUser ? legacyHazardFlags : []
    );
    const automaticHazardFlags = component.automaticHazardFlags ?? (
        component.hazardDataConfirmedByUser ? [] : legacyHazardFlags
    );
    const phCatalogMatch = component.phCatalogMatch ?? resolvePhCatalogIdentity({
        standardInchiKey: component.chemical.externalIdentifiers?.standardInchiKey,
        casNumber: component.chemical.casNumber,
        pubchemCid: component.chemical.externalIdentifiers?.pubchemCid,
        equivalentPubchemCids: component.chemical.externalIdentifiers?.equivalentPubchemCids,
        molecularFormula: component.chemical.molecularFormula,
        currentPhCatalogId: component.phCatalogId,
    });
    const normalized = {
        ...component,
        materialProfile,
        solutionVolume: component.solutionVolume ?? parseLegacySolutionVolume(component.volume),
        concentration: component.concentration ?? parseLegacyConcentration(component.molarity),
        phCatalogId: component.phCatalogId ?? (phCatalogMatch.status === 'matched' ? phCatalogMatch.id : undefined),
        phCatalogMatch,
        automaticHazardFlags,
        manualHazardFlags,
        hazardFlags: [...new Set([...automaticHazardFlags, ...manualHazardFlags])],
        enrichmentVersion: component.enrichmentVersion ?? 0,
    };
    const legacyOrganicSaltCategory = (
        component.category === 'ORGANIC_NON_HALOGEN' ||
        component.category === 'ORGANIC_HALOGEN'
    ) && (
        materialProfile.kind === 'ionic_organic_salt' ||
        materialProfile.kind === 'possible_ionic_organic_material'
    );
    if (!legacyOrganicSaltCategory) return normalized;

    const reanalysis = analyzeChemical(component.chemical);
    return {
        ...normalized,
        category: reanalysis.category,
        binColor: reanalysis.binColor,
        label: reanalysis.label,
        reason: reanalysis.reason,
        reasonParams: reanalysis.reasonParams,
        isSafe: reanalysis.isSafe,
        hazardWarnings: reanalysis.hazardWarnings,
        hazardProfile: reanalysis.hazardProfile,
        materialProfile: reanalysis.materialProfile,
        identityConfidence: reanalysis.materialProfile?.kind === 'possible_ionic_organic_material'
            ? 'review_required'
            : component.identityConfidence,
    };
};

const isVolumeWasteMatrix = (matrix: WasteMatrix): boolean =>
    matrix !== 'unknown' && matrix !== 'solid_slurry';

const isEmptyWasteAmount = (amount: WasteBatchDraft['totalAmount']): boolean =>
    !amount.isUnknown && amount.value === null && amount.unit === null &&
    amount.normalizedValue === null && amount.normalizedUnit === null;

const amountsMatch = (
    left: WasteBatchDraft['totalAmount'],
    right: WasteBatchDraft['totalAmount'],
): boolean => left.normalizedUnit === right.normalizedUnit &&
    left.normalizedValue !== null && right.normalizedValue !== null &&
    Math.abs(left.normalizedValue - right.normalizedValue) <=
        Math.max(1e-9, right.normalizedValue * 1e-9);

const normalizeStoredTotalAmount = (
    draft: WasteBatchDraft,
    components: WasteComponent[],
): WasteBatchDraft['totalAmount'] => {
    const stored = draft.totalAmount;
    const derived = isVolumeWasteMatrix(draft.matrix)
        ? deriveWasteAmountFromComponentVolumes(components)
        : null;

    if (derived) {
        if (stored.source === 'component_sum') return derived;
        if (stored.source === 'manual') return stored.isApproximate ? derived : stored;
        if (stored.isUnknown) return stored;
        // Before automatic totals existed, this field was mandatory. Treat an
        // equal legacy value as the old duplicate entry, not an intentional override.
        if (isEmptyWasteAmount(stored) || amountsMatch(stored, derived)) return derived;
        return { ...stored, source: 'manual' };
    }

    if (stored.source === 'component_sum') {
        return {
            value: null,
            unit: null,
            normalizedValue: null,
            normalizedUnit: null,
            isApproximate: false,
            isUnknown: false,
        };
    }
    if (!stored.source && (stored.isUnknown || !isEmptyWasteAmount(stored))) {
        return { ...stored, source: 'manual' };
    }
    return stored;
};

/**
 * Early V2 drafts predate incident context. Normalize that absence to the
 * ordinary (non-incident) path without dropping newer fields such as scan
 * snapshots that this store does not otherwise need to understand.
 */
const normalizeWasteBatchDraft = (draft: WasteBatchDraft): WasteBatchDraft => {
    const legacyMeasuredPh = draft.measuredBatchPh ?? draft.measuredPh;
    const components = draft.components.map(normalizeWasteComponent);
    const migratedMatrix = draft.matrix === 'mixed_biphasic'
        ? inferWasteMatrixFromComponents(components) ?? 'unknown'
        : draft.matrix;
    const migratedMatrixSource = draft.matrix === 'mixed_biphasic'
        ? migratedMatrix === 'unknown' ? 'unresolved' : 'automatic'
        : draft.matrixSource;
    const normalizedDraft = {
        ...draft,
        matrix: migratedMatrix,
        matrixSource: migratedMatrixSource,
    };
    // A waste batch represents one physical container. Infer that invariant for
    // ordinary/unknown drafts, but preserve an explicit legacy "separate" value
    // so it can be resolved without silently treating separate chemicals as mixed.
    const mixingState = draft.components.length === 0
        ? 'unknown'
        : draft.mixingState === 'separate' ? 'separate' : 'already_mixed';
    const acceptsMeasuredBatchPh = migratedMatrix === 'aqueous' && mixingState === 'already_mixed';
    const measuredBatchPh = acceptsMeasuredBatchPh && legacyMeasuredPh !== undefined &&
        Number.isFinite(legacyMeasuredPh) && legacyMeasuredPh >= 0 && legacyMeasuredPh <= 14
        ? legacyMeasuredPh
        : undefined;
    const measuredPhStatus = !acceptsMeasuredBatchPh
        ? 'not_required'
        : draft.measuredPhStatus === 'measured'
            ? measuredBatchPh === undefined ? 'unknown' : 'measured'
            : 'unknown';

    return {
        ...normalizedDraft,
        components,
        totalAmount: normalizeStoredTotalAmount(normalizedDraft, components),
        measuredBatchPh,
        measuredPh: undefined,
        measuredPhStatus,
        mixingState,
        incidentContext: draft.incidentContext === 'broken' || draft.incidentContext === 'leak'
            ? draft.incidentContext
            : 'none',
        displayName: typeof draft.displayName === 'string' && draft.displayName.trim()
            ? draft.displayName.trim()
            : undefined,
        parkedAt: typeof draft.parkedAt === 'string' && draft.parkedAt.trim()
            ? draft.parkedAt
            : undefined,
        fluorideContainerStatus:
            draft.fluorideContainerStatus === 'compatible' ||
            draft.fluorideContainerStatus === 'incompatible' ||
            draft.fluorideContainerStatus === 'unknown'
                ? draft.fluorideContainerStatus
                : undefined,
    };
};

const isBatchOwnedByScope = (
    batch: WasteBatchDraft,
    scopeKey: string,
    userId: string,
    labId: string | null,
): boolean => batch.scopeKey === scopeKey &&
    batch.userId === userId &&
    (batch.labId ?? null) === labId;

const isWasteBatchStorageEnvelope = (
    value: unknown,
): value is WasteBatchStorageEnvelope => {
    if (!value || typeof value !== 'object') return false;
    const envelope = value as Partial<WasteBatchStorageEnvelope>;
    return envelope.schemaVersion === BATCH_STORAGE_SCHEMA_VERSION &&
        typeof envelope.ownerUserId === 'string' &&
        typeof envelope.scopeKey === 'string' &&
        isWasteBatchDraft(envelope.draft) &&
        Array.isArray(envelope.parkedDrafts);
};

const isLegacyWasteBatchStorageEnvelope = (
    value: unknown,
): value is LegacyWasteBatchStorageEnvelope => {
    if (!value || typeof value !== 'object') return false;
    const envelope = value as Partial<LegacyWasteBatchStorageEnvelope>;
    return envelope.schemaVersion === LEGACY_BATCH_STORAGE_SCHEMA_VERSION &&
        typeof envelope.ownerUserId === 'string' &&
        typeof envelope.scopeKey === 'string' &&
        isWasteBatchDraft(envelope.draft);
};

const isPreviousWasteBatchStorageEnvelope = (
    value: unknown,
): value is PreviousWasteBatchStorageEnvelope => {
    if (!value || typeof value !== 'object') return false;
    const envelope = value as Partial<PreviousWasteBatchStorageEnvelope>;
    return envelope.schemaVersion === PREVIOUS_BATCH_STORAGE_SCHEMA_VERSION &&
        typeof envelope.ownerUserId === 'string' &&
        typeof envelope.scopeKey === 'string' &&
        isWasteBatchDraft(envelope.draft) &&
        Array.isArray(envelope.parkedDrafts);
};

const isOlderWasteBatchStorageEnvelope = (
    value: unknown,
): value is OlderWasteBatchStorageEnvelope => {
    if (!value || typeof value !== 'object') return false;
    const envelope = value as Partial<OlderWasteBatchStorageEnvelope>;
    return envelope.schemaVersion === OLDER_BATCH_STORAGE_SCHEMA_VERSION &&
        typeof envelope.ownerUserId === 'string' &&
        typeof envelope.scopeKey === 'string' &&
        isWasteBatchDraft(envelope.draft) &&
        Array.isArray(envelope.parkedDrafts);
};

const isParkedWasteBatchStorageEnvelope = (
    value: unknown,
): value is ParkedWasteBatchStorageEnvelope => {
    if (!value || typeof value !== 'object') return false;
    const envelope = value as Partial<ParkedWasteBatchStorageEnvelope>;
    return envelope.schemaVersion === PARKED_BATCH_STORAGE_SCHEMA_VERSION &&
        typeof envelope.ownerUserId === 'string' &&
        typeof envelope.scopeKey === 'string' &&
        isWasteBatchDraft(envelope.draft) &&
        Array.isArray(envelope.parkedDrafts);
};

const saveWasteScope = (
    batch: WasteBatchDraft,
    parkedBatches: WasteBatchDraft[],
): boolean => {
    if (!canUseLocalStorage() || !batch.userId) return false;
    try {
        const envelope: WasteBatchStorageEnvelope = {
            schemaVersion: BATCH_STORAGE_SCHEMA_VERSION,
            ownerUserId: batch.userId,
            scopeKey: batch.scopeKey,
            draft: normalizeWasteBatchDraft(batch),
            parkedDrafts: parkedBatches
                .filter((draft) => isBatchOwnedByScope(
                    draft,
                    batch.scopeKey,
                    batch.userId as string,
                    batch.labId ?? null,
                ))
                .map(normalizeWasteBatchDraft),
        };
        localStorage.setItem(storageKeyForScope(batch.scopeKey), JSON.stringify(envelope));
        return true;
    } catch {
        // Storage can be unavailable in private browsing or after a quota failure.
        // The in-memory draft remains usable and the legacy source is preserved.
        return false;
    }
};

const loadWasteScope = (
    scopeKey: string,
    userId: string | null,
    labId: string | null,
): LoadedWasteScope => {
    if (canUseLocalStorage() && userId) {
        const raw = readStorage(storageKeyForScope(scopeKey));
        if (raw) {
            try {
                const parsed: unknown = JSON.parse(raw);
                if (
                    isWasteBatchStorageEnvelope(parsed) &&
                    parsed.ownerUserId === userId &&
                    parsed.scopeKey === scopeKey &&
                    isBatchOwnedByScope(parsed.draft, scopeKey, userId, labId)
                ) {
                    const batch = normalizeWasteBatchDraft(parsed.draft);
                    const parkedBatches = parsed.parkedDrafts
                        .filter(isWasteBatchDraft)
                        .map(normalizeWasteBatchDraft)
                        .filter((draft) =>
                            draft.id !== batch.id &&
                            isBatchOwnedByScope(draft, scopeKey, userId, labId)
                        );
                    return { batch, parkedBatches };
                }

                // Schema 3 introduced parked drafts. Upgrade both active and
                // parked components to the structured volume/concentration model.
                if (
                    isPreviousWasteBatchStorageEnvelope(parsed) &&
                    parsed.ownerUserId === userId &&
                    parsed.scopeKey === scopeKey &&
                    isBatchOwnedByScope(parsed.draft, scopeKey, userId, labId)
                ) {
                    const batch = normalizeWasteBatchDraft(parsed.draft);
                    const parkedBatches = parsed.parkedDrafts
                        .filter(isWasteBatchDraft)
                        .map(normalizeWasteBatchDraft)
                        .filter((draft) =>
                            draft.id !== batch.id &&
                            isBatchOwnedByScope(draft, scopeKey, userId, labId)
                        );
                    saveWasteScope(batch, parkedBatches);
                    return { batch, parkedBatches };
                }

                if (
                    isOlderWasteBatchStorageEnvelope(parsed) &&
                    parsed.ownerUserId === userId &&
                    parsed.scopeKey === scopeKey &&
                    isBatchOwnedByScope(parsed.draft, scopeKey, userId, labId)
                ) {
                    const batch = normalizeWasteBatchDraft(parsed.draft);
                    const parkedBatches = parsed.parkedDrafts
                        .filter(isWasteBatchDraft)
                        .map(normalizeWasteBatchDraft)
                        .filter((draft) =>
                            draft.id !== batch.id &&
                            isBatchOwnedByScope(draft, scopeKey, userId, labId)
                        );
                    saveWasteScope(batch, parkedBatches);
                    return { batch, parkedBatches };
                }

                if (
                    isParkedWasteBatchStorageEnvelope(parsed) &&
                    parsed.ownerUserId === userId &&
                    parsed.scopeKey === scopeKey &&
                    isBatchOwnedByScope(parsed.draft, scopeKey, userId, labId)
                ) {
                    const batch = normalizeWasteBatchDraft(parsed.draft);
                    const parkedBatches = parsed.parkedDrafts
                        .filter(isWasteBatchDraft)
                        .map(normalizeWasteBatchDraft)
                        .filter((draft) => draft.id !== batch.id && isBatchOwnedByScope(draft, scopeKey, userId, labId));
                    saveWasteScope(batch, parkedBatches);
                    return { batch, parkedBatches };
                }

                // Schema 2 stored only the active draft. Upgrade that exact
                // owner/scope match without changing its contents.
                if (
                    isLegacyWasteBatchStorageEnvelope(parsed) &&
                    parsed.ownerUserId === userId &&
                    parsed.scopeKey === scopeKey &&
                    isBatchOwnedByScope(parsed.draft, scopeKey, userId, labId)
                ) {
                    const batch = normalizeWasteBatchDraft(parsed.draft);
                    saveWasteScope(batch, []);
                    return { batch, parkedBatches: [] };
                }

                // Early V2 builds stored the draft directly without an envelope.
                // Restore only an exact owner/scope match, then upgrade it in place.
                if (
                    isWasteBatchDraft(parsed) &&
                    isBatchOwnedByScope(parsed, scopeKey, userId, labId)
                ) {
                    const batch = normalizeWasteBatchDraft(parsed);
                    saveWasteScope(batch, []);
                    return { batch, parkedBatches: [] };
                }
            } catch {
                // A malformed draft is ignored; a clean draft is safer than a partial one.
            }
        }

        // The former unscoped cart did not carry an authenticated owner. Never attach
        // ownerless data to whichever account happens to sign in next. A rare
        // owner-tagged legacy value can still be migrated for that exact user only.
        const legacyRaw = readStorage(LEGACY_STORAGE_KEY);
        if (legacyRaw) {
            try {
                const legacy = JSON.parse(legacyRaw) as {
                    ownerUserId?: string;
                    state?: { cart?: CartItem[]; ownerUserId?: string; userId?: string };
                };
                const legacyOwner = legacy.ownerUserId ??
                    legacy.state?.ownerUserId ??
                    legacy.state?.userId;
                const legacyCart = legacy.state?.cart;

                if (
                    legacyOwner === userId &&
                    Array.isArray(legacyCart) &&
                    legacyCart.length > 0
                ) {
                    const migrated = createEmptyWasteBatch({
                        scopeKey,
                        userId,
                        labId: labId ?? undefined,
                    });
                    migrated.components = legacyCart.map((item) =>
                        normalizeWasteComponent(createWasteComponentFromAnalysis(item))
                    );
                    migrated.updatedAt = new Date().toISOString();
                    const persisted = saveWasteScope(migrated, []);
                    if (persisted) removeStorage(LEGACY_STORAGE_KEY);
                    return { batch: migrated, parkedBatches: [] };
                }

                removeStorage(LEGACY_STORAGE_KEY);
            } catch {
                // An unreadable unscoped value cannot be attributed safely.
                removeStorage(LEGACY_STORAGE_KEY);
            }
        }
    }

    return {
        batch: createEmptyWasteBatch({
            scopeKey,
            userId: userId ?? undefined,
            labId: labId ?? undefined,
        }),
        parkedBatches: [],
    };
};

const touchBatch = (batch: WasteBatchDraft): WasteBatchDraft => ({
    ...batch,
    updatedAt: new Date().toISOString(),
});

const componentEnrichmentFingerprint = (component: WasteComponent): string => JSON.stringify({
    chemical: component.chemical,
    identityConfidence: component.identityConfidence,
    hazardFlags: component.hazardFlags,
    automaticHazardFlags: component.automaticHazardFlags,
    manualHazardFlags: component.manualHazardFlags,
    hazardDataConfirmedByUser: component.hazardDataConfirmedByUser,
    phCatalogId: component.phCatalogId,
    enrichmentVersion: component.enrichmentVersion,
    enrichmentRetryCount: component.enrichmentRetryCount,
});

const componentIdentityKey = (component: WasteComponent): string => {
    const identifiers = component.chemical.externalIdentifiers;
    return identifiers?.standardInchiKey
        ? `inchikey:${identifiers.standardInchiKey.toUpperCase()}`
        : component.chemical.casNumber
            ? `cas:${component.chemical.casNumber}`
            : identifiers?.pubchemCid
                ? `cid:${identifiers.pubchemCid}`
                : `name:${component.chemical.name.trim().toLowerCase()}|formula:${component.chemical.molecularFormula}`;
};

const shouldEnrichComponent = (component: WasteComponent, retryImmediately = false): boolean => {
    if ((component.enrichmentVersion ?? 0) < 2) return true;
    if (!component.chemical.casNumber || !component.phCatalogMatch) return true;
    const hazardStatus = component.chemical.hazardLookup?.status;
    // A partially migrated draft can already have CAS/pH metadata while still
    // missing the hazard result. Treat that as incomplete instead of allowing
    // the legacy lookup_failed flag to become permanent.
    if (!hazardStatus) return true;
    if (
        (hazardStatus === 'classified' || hazardStatus === 'not_classified') &&
        component.ghsDataStatus !== 'verified'
    ) return true;
    if (
        (hazardStatus === 'source_absent' || hazardStatus === 'identity_ambiguous') &&
        component.ghsDataStatus !== 'lookup_failed'
    ) return true;
    const referencePhStatus = component.chemical.referencePhLookup?.status;
    if (referencePhStatus === 'pending') {
        if (retryImmediately) return true;
        const attemptedAt = Date.parse(component.enrichmentLastAttemptAt || '');
        return !Number.isFinite(attemptedAt) || Date.now() - attemptedAt >= 10_000;
    }
    if (referencePhStatus === 'transient_error') {
        if (retryImmediately) return true;
        const attemptedAt = Date.parse(component.enrichmentLastAttemptAt || '');
        return !Number.isFinite(attemptedAt) || Date.now() - attemptedAt >= 5 * 60 * 1000;
    }
    if (hazardStatus !== 'transient_error') return false;
    if (retryImmediately) return true;
    const attemptedAt = Date.parse(component.enrichmentLastAttemptAt || '');
    return !Number.isFinite(attemptedAt) || Date.now() - attemptedAt >= 5 * 60 * 1000;
};

const applyEnrichmentToComponent = (
    component: WasteComponent,
    result: ChemicalEnrichmentResult,
    retryCount: number,
): WasteComponent => {
    const returnedCas = result.identity.casNumber;
    const existingCas = component.chemical.casNumber;
    const hasCasConflict = Boolean(existingCas && returnedCas && existingCas !== returnedCas);
    const enrichedChemical = chemicalFromEnrichment(result, component.chemical);
    const existingProperties = component.chemical.properties;
    const enrichedProperties = enrichedChemical?.properties;
    const mergedProperties: Chemical['properties'] = existingProperties || enrichedProperties
        ? {
            ...existingProperties,
            ...enrichedProperties,
            isOrganic: enrichedProperties?.isOrganic ?? existingProperties?.isOrganic ?? false,
            isHalogenated: enrichedProperties?.isHalogenated ?? existingProperties?.isHalogenated ?? false,
            ...(
                enrichedChemical?.referencePhLookup?.status !== 'available' && existingProperties?.referencePh !== undefined
                    ? {
                        referencePh: existingProperties.referencePh,
                        ...(existingProperties.phSource ? { phSource: existingProperties.phSource } : {}),
                    }
                    : {}
            ),
        }
        : undefined;
    const chemical: Chemical = enrichedChemical
        ? {
            ...component.chemical,
            ...enrichedChemical,
            name: result.identity.status === 'verified'
                ? enrichedChemical.name
                : component.chemical.name,
            casNumber: hasCasConflict
                ? existingCas
                : existingCas || enrichedChemical.casNumber,
            properties: mergedProperties,
            physicalProperties: {
                ...enrichedChemical.physicalProperties,
                ...component.chemical.physicalProperties,
            },
            koshaId: enrichedChemical.koshaId ?? component.chemical.koshaId,
        }
        : {
            ...component.chemical,
            hazardLookup: {
                ...result.hazard,
                status: hasCasConflict ? 'identity_ambiguous' as const : result.hazard.status,
                algorithmVersion: result.enrichmentVersion,
            },
            referencePhLookup: result.referencePh,
        };
    const reanalysis = analyzeChemical(chemical);
    const manualHazardFlags = component.manualHazardFlags ?? (
        component.hazardDataConfirmedByUser ? component.hazardFlags : []
    );
    const automaticHazardFlags = [...new Set([
        ...result.hazard.hazardFlags,
        ...deriveWasteHazardFlags(reanalysis),
    ])];
    const hazardStatus = hasCasConflict ? 'identity_ambiguous' : result.hazard.status;
    const ghsDataStatus = hazardStatus === 'classified' || hazardStatus === 'not_classified'
        ? 'verified'
        : hazardStatus === 'transient_error' && retryCount < 2
            ? 'not_checked'
            : 'lookup_failed';
    const phCatalogMatch = resolvePhCatalogIdentity({
        standardInchiKey: result.identity.standardInchiKey,
        casNumber: hasCasConflict ? existingCas : returnedCas || existingCas,
        pubchemCid: result.identity.pubchemCid,
        equivalentPubchemCids: result.identity.equivalentPubchemCids,
        molecularFormula: result.identity.molecularFormula || chemical.molecularFormula,
        currentPhCatalogId: component.phCatalogId,
    });

    return {
        ...component,
        ...reanalysis,
        chemical,
        identityConfidence: result.identity.status === 'verified' && !hasCasConflict
            ? 'verified'
            : 'review_required',
        ghsDataStatus,
        automaticHazardFlags,
        manualHazardFlags,
        hazardFlags: [...new Set([...automaticHazardFlags, ...manualHazardFlags])],
        phCatalogId: component.phCatalogId ?? (phCatalogMatch.status === 'matched' ? phCatalogMatch.id : undefined),
        phCatalogMatch,
        enrichmentVersion: result.enrichmentVersion,
        enrichmentLastAttemptAt: new Date().toISOString(),
        enrichmentRetryCount: hazardStatus === 'transient_error' ||
            result.referencePh.status === 'pending' || result.referencePh.status === 'transient_error'
            ? retryCount
            : 0,
    };
};

const hasBatchContent = (batch: WasteBatchDraft): boolean =>
    batch.components.length > 0 ||
    batch.matrix !== 'unknown' ||
    batch.totalAmount.value !== null ||
    batch.totalAmount.isUnknown ||
    batch.measuredPhStatus !== 'not_required' ||
    batch.mixingState !== 'unknown' ||
    batch.additionalComponentsStatus !== undefined ||
    batch.fluorideContainerStatus !== undefined ||
    batch.incidentContext !== 'none';

const MATRIX_DISPLAY_NAMES: Record<WasteMatrix, string> = {
    aqueous: '수용액 폐액',
    organic_non_halogenated: '비할로겐 유기용매 폐액',
    organic_halogenated: '할로겐 유기용매 폐액',
    mixed_biphasic: '혼합용매·두 층 폐액',
    solid_slurry: '고체·슬러리 폐액',
    unknown: '미분류 폐액',
};

const buildParkedDisplayName = (batch: WasteBatchDraft): string => {
    const componentNames = batch.components
        .map(({ chemical }) => chemical.name.trim())
        .filter(Boolean);
    if (componentNames.length === 1) return `${componentNames[0]} 폐액`;
    if (componentNames.length > 1) {
        return `${componentNames[0]} 외 ${componentNames.length - 1}개 성분 폐액`;
    }
    if (batch.incidentContext === 'broken') return '파손 대응 폐액';
    if (batch.incidentContext === 'leak') return '누출 대응 폐액';
    return MATRIX_DISPLAY_NAMES[batch.matrix];
};

type AmountDimension = 'volume' | 'mass';

const matrixDimension = (matrix: WasteMatrix): AmountDimension | null =>
    matrix === 'unknown' ? null : matrix === 'solid_slurry' ? 'mass' : 'volume';

const unitDimension = (unit: AmountUnit | null): AmountDimension | null => {
    if (unit === 'mg' || unit === 'g') return 'mass';
    if (unit === 'mL' || unit === 'L') return 'volume';
    return null;
};

const EMPTY_WASTE_AMOUNT: WasteBatchDraft['totalAmount'] = {
    value: null,
    unit: null,
    normalizedValue: null,
    normalizedUnit: null,
    isApproximate: false,
    isUnknown: false,
};

const reconcileTotalAmountWithComponents = (
    current: WasteBatchDraft['totalAmount'],
    components: readonly WasteComponent[],
    matrix: WasteMatrix,
    resetManual: boolean,
): WasteBatchDraft['totalAmount'] => {
    if (!isVolumeWasteMatrix(matrix)) return current;
    const derived = deriveWasteAmountFromComponentVolumes(components);
    if (derived) {
        if (resetManual || current.source !== 'manual' || current.isApproximate) return derived;
        return current;
    }
    return resetManual || current.source === 'component_sum'
        ? { ...EMPTY_WASTE_AMOUNT }
        : current;
};

const amountAfterAutomaticMatrixChange = (
    batch: WasteBatchDraft,
    nextMatrix: WasteMatrix,
): WasteBatchDraft['totalAmount'] => {
    const currentDimension = matrixDimension(batch.matrix) ?? unitDimension(batch.totalAmount.unit);
    const nextDimension = matrixDimension(nextMatrix);
    return currentDimension !== null && nextDimension !== null && currentDimension !== nextDimension
        ? { ...EMPTY_WASTE_AMOUNT }
        : batch.totalAmount;
};

const emptyAIState = {
    aiGuide: null as string | null,
    aiLoading: false,
    aiError: false,
};

export type AddWasteComponentOptions = Partial<Pick<
    WasteComponent,
    | 'cartLineId'
    | 'sourceType'
    | 'sourceRef'
    | 'sourceSearchEventId'
    | 'inventoryId'
    | 'cabinetId'
    | 'identityConfidence'
    | 'identityConfirmedByUser'
    | 'ghsDataStatus'
    | 'hazardDataConfirmedByUser'
    | 'capturedAt'
    | 'hazardFlags'
    | 'automaticHazardFlags'
    | 'manualHazardFlags'
    | 'concentration'
    | 'solutionVolume'
    | 'phCatalogId'
    | 'phCatalogMatch'
    | 'inventoryDisposalQuantity'
    | 'inventorySnapshot'
    | 'scanSnapshot'
    | 'solutionContext'
>>;

export interface WasteState {
    scopeKey: string;
    batch: WasteBatchDraft;
    parkedBatches: WasteBatchDraft[];
    /** Legacy-compatible projection used by navigation badges and older read paths. */
    cart: WasteComponent[];
    previousMatrix: WasteMatrix | null;
    setScope: (userId: string | null, labId: string | null) => void;
    refreshChemicalEnrichment: () => Promise<void>;
    addToCart: (result: CartItem, options?: AddWasteComponentOptions) => void;
    removeFromCart: (cartLineIdOrLegacyChemicalId: string) => void;
    updateComponent: (
        cartLineId: string,
        patch: Partial<Pick<
            WasteComponent,
            | 'concentration'
            | 'solutionVolume'
            | 'phCatalogId'
            | 'identityConfidence'
            | 'identityConfirmedByUser'
            | 'inventoryDisposalQuantity'
            | 'ghsDataStatus'
            | 'hazardFlags'
            | 'automaticHazardFlags'
            | 'manualHazardFlags'
            | 'hazardDataConfirmedByUser'
            | 'phCatalogMatch'
            | 'solutionContext'
        >>,
    ) => void;
    setMatrix: (matrix: WasteMatrix) => void;
    setTotalAmount: (params: {
        value: number | null;
        unit: AmountUnit | null;
        isApproximate?: boolean;
        isUnknown?: boolean;
        source?: WasteBatchDraft['totalAmount']['source'];
    }) => void;
    setMeasuredPh: (value: number | null, isUnknown?: boolean) => void;
    /** Resolve only a legacy draft that explicitly claimed its components were separate. */
    confirmSingleContainer: () => void;
    setAdditionalComponentsStatus: (
        value: WasteBatchDraft['additionalComponentsStatus'],
    ) => void;
    setFluorideContainerStatus: (
        value: WasteBatchDraft['fluorideContainerStatus'],
    ) => void;
    setIncidentContext: (value: WasteBatchDraft['incidentContext']) => void;
    rememberCurrentMatrix: () => void;
    applyPreviousMatrix: () => void;
    clearCart: () => void;
    /** Move the current draft into scoped storage; false means nothing changed. */
    parkCurrentBatch: () => boolean;
    /** Restore only when the current draft contains no user or component data. */
    restoreParkedBatch: (id: string) => boolean;
    deleteParkedBatch: (id: string) => boolean;
    aiGuide: string | null;
    setAiGuide: (guide: string | null) => void;
    aiLoading: boolean;
    setAiLoading: (loading: boolean) => void;
    aiError: boolean;
    setAiError: (error: boolean) => void;

    recentSearches: string[];
    loadSearchHistory: () => Promise<void>;
    addSearchHistory: (query: string) => void;
    removeSearchHistory: (query: string) => void;
    clearSearchHistory: () => void;
}

const initialScopeKey = buildScopeKey(null, null);
const initialBatch = createEmptyWasteBatch({ scopeKey: initialScopeKey });

export const useWasteStore = create<WasteState>((set, get) => ({
    scopeKey: initialScopeKey,
    batch: initialBatch,
    parkedBatches: [],
    cart: initialBatch.components,
    previousMatrix: null,

    setScope: (userId, labId) => {
        const scopeKey = buildScopeKey(userId, labId);
        if (get().scopeKey === scopeKey) return;

        const { batch, parkedBatches } = loadWasteScope(scopeKey, userId, labId);
        set({
            scopeKey,
            batch,
            parkedBatches,
            cart: batch.components,
            previousMatrix: userId ? readPreviousMatrix(scopeKey) : null,
            ...emptyAIState,
        });
    },

    refreshChemicalEnrichment: async () => {
        if (!isChemicalEnrichmentEnabled) return;

        const runPass = async (retryCount: number, retryImmediately: boolean): Promise<boolean> => {
            const snapshot = get();
            const requestedScopeKey = snapshot.scopeKey;
            if (!snapshot.batch.userId) return false;

            const drafts = [snapshot.batch, ...snapshot.parkedBatches];
            const grouped = new Map<string, {
                item: Parameters<typeof enrichChemicals>[0][number];
                references: Array<{ batchId: string; cartLineId: string; fingerprint: string }>;
            }>();
            for (const draft of drafts) {
                for (const component of draft.components) {
                    if (!shouldEnrichComponent(component, retryImmediately)) continue;
                    const key = componentIdentityKey(component);
                    const existing = grouped.get(key);
                    const reference = {
                        batchId: draft.id,
                        cartLineId: component.cartLineId,
                        fingerprint: componentEnrichmentFingerprint(component),
                    };
                    if (existing) {
                        existing.references.push(reference);
                        continue;
                    }
                    const identifiers = component.chemical.externalIdentifiers;
                    grouped.set(key, {
                        item: {
                            requestId: `draft:${grouped.size}`,
                            name: component.chemical.name,
                            ...(component.chemical.casNumber ? { casNumber: component.chemical.casNumber } : {}),
                            ...(identifiers?.pubchemCid ? { pubchemCid: identifiers.pubchemCid } : {}),
                            ...(identifiers?.standardInchiKey ? { standardInchiKey: identifiers.standardInchiKey } : {}),
                            molecularFormula: component.chemical.molecularFormula,
                            ...(component.chemical.molecularWeight ? { molecularWeight: component.chemical.molecularWeight } : {}),
                        },
                        references: [reference],
                    });
                }
            }
            if (grouped.size === 0) return false;

            const entries = Array.from(grouped.entries());
            const resultsByKey = new Map<string, ChemicalEnrichmentResult>();
            for (let start = 0; start < entries.length; start += 25) {
                const chunk = entries.slice(start, start + 25);
                try {
                    const results = await enrichChemicals(
                        chunk.map(([, entry]) => entry.item),
                        { labId: snapshot.batch.labId },
                    );
                    results.forEach((result, index) => {
                        const key = chunk[index]?.[0];
                        if (key) resultsByKey.set(key, result);
                    });
                } catch {
                    const fetchedAt = new Date().toISOString();
                    for (const [key, entry] of chunk) {
                        const phCatalog = resolvePhCatalogIdentity({
                            standardInchiKey: entry.item.standardInchiKey,
                            casNumber: entry.item.casNumber,
                            pubchemCid: entry.item.pubchemCid,
                            molecularFormula: entry.item.molecularFormula,
                        });
                        resultsByKey.set(key, {
                            requestId: entry.item.requestId,
                            overallStatus: 'retryable',
                            identity: {
                                status: 'ambiguous',
                                canonicalName: entry.item.name,
                                casNumber: entry.item.casNumber,
                                pubchemCid: entry.item.pubchemCid,
                                equivalentPubchemCids: entry.item.pubchemCid ? [entry.item.pubchemCid] : [],
                                standardInchiKey: entry.item.standardInchiKey,
                                molecularFormula: entry.item.molecularFormula,
                                molecularWeight: entry.item.molecularWeight,
                                evidence: [],
                            },
                            hazard: {
                                status: 'transient_error',
                                hCodes: [],
                                hazardStatements: [],
                                pictograms: [],
                                hazardFlags: [],
                                sources: [],
                                fetchedAt,
                            },
                            referencePh: {
                                status: 'transient_error',
                                source: 'kosha',
                                retryAfterMs: 2_000,
                            },
                            phCatalog: {
                                status: phCatalog.status,
                                id: phCatalog.id,
                                candidateIds: phCatalog.candidateIds,
                                matchedBy: phCatalog.matchedBy,
                                catalogVersion: phCatalog.catalogVersion,
                            },
                            retryAfterMs: 2_000,
                            enrichmentVersion: 2,
                        });
                    }
                }
            }

            if (get().scopeKey !== requestedScopeKey) return false;
            set((current) => {
                if (current.scopeKey !== requestedScopeKey) return current;
                const updateDraft = (draft: WasteBatchDraft): WasteBatchDraft => {
                    let changed = false;
                    const components = draft.components.map((component) => {
                        const key = componentIdentityKey(component);
                        const result = resultsByKey.get(key);
                        const reference = grouped.get(key)?.references.find((candidate) => (
                            candidate.batchId === draft.id && candidate.cartLineId === component.cartLineId
                        ));
                        if (!result || !reference || reference.fingerprint !== componentEnrichmentFingerprint(component)) {
                            return component;
                        }
                        changed = true;
                        return applyEnrichmentToComponent(component, result, retryCount);
                    });
                    return changed ? { ...draft, components, updatedAt: new Date().toISOString() } : draft;
                };
                const batch = updateDraft(current.batch);
                const parkedBatches = current.parkedBatches.map(updateDraft);
                saveWasteScope(batch, parkedBatches);
                return { batch, parkedBatches, cart: batch.components, ...emptyAIState };
            });

            return Array.from(resultsByKey.values()).some((result) =>
                result.overallStatus === 'retryable' ||
                result.referencePh.status === 'pending' ||
                result.referencePh.status === 'transient_error'
            );
        };

        const shouldRetry = await runPass(1, false);
        if (!shouldRetry) return;
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 10_000));
        await runPass(2, true);
    },

    addToCart: (result, options) => set((state) => {
        const createdComponent = createWasteComponentFromAnalysis(result, options);
        const component = normalizeWasteComponent({
            ...createdComponent,
            solutionVolume: options?.solutionVolume,
            phCatalogId: options?.phCatalogId,
        });
        const components = [...state.batch.components, component];
        const inferredMatrix = state.batch.matrixSource === 'user'
            ? null
            : inferWasteMatrixFromComponents(components);
        const nextMatrix = state.batch.matrixSource === 'user'
            ? state.batch.matrix
            : inferredMatrix ?? 'unknown';
        const batch = touchBatch({
            ...state.batch,
            components,
            mixingState: state.batch.mixingState === 'separate' ? 'separate' : 'already_mixed',
            // "Present" is a pending state created by the explicit
            // "add by searching" action. The next component added completes
            // that one question; users can choose Present again for another.
            additionalComponentsStatus: state.batch.additionalComponentsStatus === 'present'
                ? 'none'
                : state.batch.additionalComponentsStatus,
            matrix: nextMatrix,
            matrixSource: state.batch.matrixSource === 'user'
                ? 'user'
                : inferredMatrix ? 'automatic' : 'unresolved',
            totalAmount: reconcileTotalAmountWithComponents(
                amountAfterAutomaticMatrixChange(state.batch, nextMatrix),
                components,
                nextMatrix,
                true,
            ),
        });
        saveWasteScope(batch, state.parkedBatches);
        return { batch, cart: batch.components, ...emptyAIState };
    }),

    removeFromCart: (cartLineIdOrLegacyChemicalId) => set((state) => {
        const directIndex = state.batch.components.findIndex(
            ({ cartLineId }) => cartLineId === cartLineIdOrLegacyChemicalId,
        );
        const index = directIndex >= 0
            ? directIndex
            : state.batch.components.findIndex(
                ({ chemical }) => chemical.id === cartLineIdOrLegacyChemicalId,
            );
        if (index < 0) return state;

        const components = state.batch.components.filter((_, itemIndex) => itemIndex !== index);
        const inferredMatrix = state.batch.matrixSource === 'user'
            ? null
            : inferWasteMatrixFromComponents(components);
        const nextMatrix = state.batch.matrixSource === 'user'
            ? state.batch.matrix
            : inferredMatrix ?? 'unknown';
        const batch = touchBatch({
            ...state.batch,
            components,
            mixingState: components.length === 0
                ? 'unknown'
                : state.batch.mixingState === 'separate' ? 'separate' : 'already_mixed',
            matrix: nextMatrix,
            matrixSource: state.batch.matrixSource === 'user'
                ? 'user'
                : inferredMatrix ? 'automatic' : 'unresolved',
            totalAmount: components.length === 0
                ? { ...EMPTY_WASTE_AMOUNT }
                : reconcileTotalAmountWithComponents(
                    amountAfterAutomaticMatrixChange(state.batch, nextMatrix),
                    components,
                    nextMatrix,
                    true,
                ),
        });
        saveWasteScope(batch, state.parkedBatches);
        return { batch, cart: components, ...emptyAIState };
    }),

    updateComponent: (cartLineId, patch) => set((state) => {
        const components = state.batch.components.map((component) =>
            component.cartLineId === cartLineId ? { ...component, ...patch } : component
        );
        const volumeChanged = Object.prototype.hasOwnProperty.call(patch, 'solutionVolume');
        const solutionContextChanged = Object.prototype.hasOwnProperty.call(patch, 'solutionContext');
        const wizardMatrix = solutionContextChanged
            ? deriveWizardMatrixFromComponents(components)
            : null;
        const nextMatrix = wizardMatrix
            ? wizardMatrix.requiresBatchConfirmation
                ? 'unknown'
                : wizardMatrix.matrix ?? 'unknown'
            : state.batch.matrix;
        const batch = touchBatch({
            ...state.batch,
            components,
            matrix: nextMatrix,
            matrixSource: wizardMatrix
                ? wizardMatrix.requiresBatchConfirmation || !wizardMatrix.matrix
                    ? 'unresolved'
                    : 'automatic'
                : state.batch.matrixSource,
            totalAmount: volumeChanged || solutionContextChanged
                ? reconcileTotalAmountWithComponents(
                    solutionContextChanged
                        ? amountAfterAutomaticMatrixChange(state.batch, nextMatrix)
                        : state.batch.totalAmount,
                    components,
                    nextMatrix,
                    true,
                )
                : state.batch.totalAmount,
            measuredBatchPh: nextMatrix === 'aqueous' ? state.batch.measuredBatchPh : undefined,
            measuredPhStatus: nextMatrix === 'aqueous'
                ? state.batch.measuredPhStatus
                : 'not_required',
        });
        saveWasteScope(batch, state.parkedBatches);
        return { batch, cart: components, ...emptyAIState };
    }),

    setMatrix: (matrix) => set((state) => {
        const oldDimension = matrixDimension(state.batch.matrix);
        const newDimension = matrixDimension(matrix);
        const storedAmountDimension = unitDimension(state.batch.totalAmount.unit);
        const crossesDimension = newDimension !== null && (
            (oldDimension !== null && oldDimension !== newDimension) ||
            (storedAmountDimension !== null && storedAmountDimension !== newDimension)
        );
        const baseAmount = crossesDimension
            ? { ...EMPTY_WASTE_AMOUNT }
            : state.batch.totalAmount;
        const batch = touchBatch({
            ...state.batch,
            matrix,
            matrixSource: 'user',
            totalAmount: reconcileTotalAmountWithComponents(
                baseAmount,
                state.batch.components,
                matrix,
                false,
            ),
            measuredBatchPh: matrix === 'aqueous' ? state.batch.measuredBatchPh : undefined,
            measuredPh: undefined,
            measuredPhStatus: matrix === 'aqueous' && state.batch.mixingState === 'already_mixed'
                ? (state.batch.measuredPhStatus === 'measured' ? 'measured' : 'unknown')
                : 'not_required',
            mixingState: state.batch.components.length === 0
                ? 'unknown'
                : state.batch.mixingState === 'separate' ? 'separate' : 'already_mixed',
        });
        saveWasteScope(batch, state.parkedBatches);
        return { batch, cart: batch.components, ...emptyAIState };
    }),

    setTotalAmount: ({ value, unit, isApproximate = false, isUnknown = false, source = 'manual' }) =>
        set((state) => {
            const normalized = value !== null && unit !== null && !isUnknown
                ? normalizeWasteAmount(value, unit)
                : null;
            const requestedAmount: WasteBatchDraft['totalAmount'] = isUnknown
                ? {
                    value: null,
                    unit: null,
                    normalizedValue: null,
                    normalizedUnit: null,
                    isApproximate: false,
                    isUnknown: true,
                    source,
                }
                : {
                    value,
                    unit,
                    normalizedValue: normalized?.normalizedValue ?? null,
                    normalizedUnit: normalized?.normalizedUnit ?? null,
                    isApproximate,
                    isUnknown: false,
                    source,
                };
            const derived = isVolumeWasteMatrix(state.batch.matrix)
                ? deriveWasteAmountFromComponentVolumes(state.batch.components)
                : null;
            const batch = touchBatch({
                ...state.batch,
                totalAmount: derived && source === 'manual' && isApproximate && !isUnknown
                    ? derived
                    : requestedAmount,
            });
            saveWasteScope(batch, state.parkedBatches);
            return { batch, cart: batch.components, ...emptyAIState };
        }),

    setMeasuredPh: (value, isUnknown = false) => set((state) => {
        if (state.batch.matrix !== 'aqueous' || state.batch.mixingState !== 'already_mixed') {
            const batch = touchBatch({
                ...state.batch,
                measuredBatchPh: undefined,
                measuredPh: undefined,
                measuredPhStatus: 'not_required',
            });
            saveWasteScope(batch, state.parkedBatches);
            return { batch, cart: batch.components, ...emptyAIState };
        }
        const validValue = value !== null && Number.isFinite(value) && value >= 0 && value <= 14
            ? value
            : undefined;
        const batch = touchBatch({
            ...state.batch,
            measuredBatchPh: isUnknown ? undefined : validValue,
            measuredPh: undefined,
            measuredPhStatus: isUnknown || validValue === undefined ? 'unknown' : 'measured',
        });
        saveWasteScope(batch, state.parkedBatches);
        return { batch, cart: batch.components, ...emptyAIState };
    }),

    confirmSingleContainer: () => set((state) => {
        if (state.batch.components.length === 0 || state.batch.mixingState !== 'separate') {
            return state;
        }
        const acceptsMeasuredBatchPh = state.batch.matrix === 'aqueous';
        const batch = touchBatch({
            ...state.batch,
            mixingState: 'already_mixed',
            measuredBatchPh: acceptsMeasuredBatchPh ? state.batch.measuredBatchPh : undefined,
            measuredPh: undefined,
            measuredPhStatus: acceptsMeasuredBatchPh
                ? (state.batch.measuredPhStatus === 'measured' ? 'measured' : 'unknown')
                : 'not_required',
        });
        saveWasteScope(batch, state.parkedBatches);
        return { batch, cart: batch.components, ...emptyAIState };
    }),

    setAdditionalComponentsStatus: (additionalComponentsStatus) => set((state) => {
        const batch = touchBatch({ ...state.batch, additionalComponentsStatus });
        saveWasteScope(batch, state.parkedBatches);
        return { batch, cart: batch.components, ...emptyAIState };
    }),

    setFluorideContainerStatus: (fluorideContainerStatus) => set((state) => {
        const batch = touchBatch({ ...state.batch, fluorideContainerStatus });
        saveWasteScope(batch, state.parkedBatches);
        return { batch, cart: batch.components, ...emptyAIState };
    }),

    setIncidentContext: (incidentContext) => set((state) => {
        const batch = touchBatch({ ...state.batch, incidentContext });
        saveWasteScope(batch, state.parkedBatches);
        return { batch, cart: batch.components, ...emptyAIState };
    }),

    rememberCurrentMatrix: () => set((state) => {
        if (state.batch.matrix === 'unknown') return state;
        savePreviousMatrix(state.scopeKey, state.batch.matrix);
        return { previousMatrix: state.batch.matrix };
    }),

    applyPreviousMatrix: () => {
        const previousMatrix = get().previousMatrix;
        if (previousMatrix) get().setMatrix(previousMatrix);
    },

    clearCart: () => set((state) => {
        const batch = createEmptyWasteBatch({
            scopeKey: state.scopeKey,
            userId: state.batch.userId,
            labId: state.batch.labId,
        });
        saveWasteScope(batch, state.parkedBatches);
        return { batch, cart: batch.components, ...emptyAIState };
    }),

    parkCurrentBatch: () => {
        const state = get();
        if (!state.batch.userId || !hasBatchContent(state.batch)) return false;
        if (state.parkedBatches.length >= MAX_PARKED_WASTE_BATCHES) return false;

        const now = new Date().toISOString();
        const parkedBatch = normalizeWasteBatchDraft({
            ...state.batch,
            displayName: buildParkedDisplayName(state.batch),
            parkedAt: now,
            updatedAt: now,
        });
        const parkedBatches = [
            parkedBatch,
            ...state.parkedBatches.filter(({ id }) => id !== parkedBatch.id),
        ];
        const batch = createEmptyWasteBatch({
            scopeKey: state.scopeKey,
            userId: state.batch.userId,
            labId: state.batch.labId,
        });

        // One envelope write commits both sides of the move. If storage is
        // unavailable, the current in-memory draft remains untouched.
        if (!saveWasteScope(batch, parkedBatches)) return false;
        set({
            batch,
            parkedBatches,
            cart: batch.components,
            ...emptyAIState,
        });
        return true;
    },

    restoreParkedBatch: (id) => {
        const state = get();
        if (hasBatchContent(state.batch)) return false;
        const parkedBatch = state.parkedBatches.find((candidate) => candidate.id === id);
        if (!parkedBatch) return false;

        const batch = touchBatch(normalizeWasteBatchDraft({
            ...parkedBatch,
            parkedAt: undefined,
        }));
        const parkedBatches = state.parkedBatches.filter((candidate) => candidate.id !== id);
        if (!saveWasteScope(batch, parkedBatches)) return false;
        set({
            batch,
            parkedBatches,
            cart: batch.components,
            ...emptyAIState,
        });
        return true;
    },

    deleteParkedBatch: (id) => {
        const state = get();
        const parkedBatches = state.parkedBatches.filter((candidate) => candidate.id !== id);
        if (parkedBatches.length === state.parkedBatches.length) return false;
        if (!saveWasteScope(state.batch, parkedBatches)) return false;
        set({ parkedBatches });
        return true;
    },

    aiGuide: null,
    setAiGuide: (aiGuide) => set({ aiGuide }),
    aiLoading: false,
    setAiLoading: (aiLoading) => set({ aiLoading }),
    aiError: false,
    setAiError: (aiError) => set({ aiError }),

    recentSearches: [],
    loadSearchHistory: async () => {
        const history = await searchHistoryService.getRecentSearches(5);
        set({ recentSearches: history });
    },
    addSearchHistory: (query) => {
        const normalized = query.trim();
        if (!normalized) return;
        set((state) => ({
            recentSearches: [
                normalized,
                ...state.recentSearches.filter((item) => item !== normalized),
            ].slice(0, 5),
        }));
        searchHistoryService.addSearch(normalized).catch(console.error);
    },
    removeSearchHistory: (query) => {
        set((state) => ({
            recentSearches: state.recentSearches.filter((item) => item !== query),
        }));
        searchHistoryService.removeSearch(query).catch(console.error);
    },
    clearSearchHistory: () => {
        set({ recentSearches: [] });
        searchHistoryService.clearHistory().catch(console.error);
    },
}));

export type { WasteConcentration };
