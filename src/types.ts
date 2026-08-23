export type DisposalCategory =
    | 'ACID'
    | 'ALKALI'
    | 'NEUTRAL'
    | 'ORGANIC_HALOGEN'
    | 'ORGANIC_NON_HALOGEN'
    | 'HEAVY_METAL'
    | 'CYANIDE'
    | 'REACTIVE'
    | 'SOLID_WASTE'
    | 'SPECIAL_HAZARD'
    | 'UNKNOWN';

export type SolutionPhysicalForm =
    | 'neat_or_solid'
    | 'aqueous'
    | 'organic_solvent'
    | 'mixed_or_unknown';

export type SolventClass =
    | 'aqueous'
    | 'organic_non_halogen'
    | 'organic_halogen'
    | 'organic_unknown'
    | 'mixed_or_unknown'
    | 'none';

export type SolventResolutionSource =
    | 'preset'
    | 'local_dictionary'
    | 'external_lookup'
    | 'user'
    | 'unresolved';

export type ChemicalMaterialKind =
    | 'ionic_organic_salt'
    | 'possible_ionic_organic_material'
    | 'organic_compound'
    | 'inorganic_salt'
    | 'unresolved';

export interface ChemicalMaterialProfile {
    kind: ChemicalMaterialKind;
    evidence: 'connectivity_smiles' | 'formula' | 'unresolved';
    /** True when a waste stream cannot be selected from identity alone. */
    requiresMatrixConfirmation: boolean;
}

export interface SolutionContext {
    physicalForm: SolutionPhysicalForm;
    solventClass: SolventClass;
    solventName?: string;
    solventPreset?: string;
    isCustomSolvent?: boolean;
    isSolventVerified?: boolean;
    solventResolution?: SolventResolutionSource;
    solventCasNumber?: string;
    solventMolecularFormula?: string;
}

export interface Chemical {
    id: string; // UUID or unique identifier
    name: string; // Official chemical name
    casNumber: string; // format: dddd-dd-d
    molecularFormula: string; // e.g., C6H6
    molecularWeight?: number;
    /** PubChem structure with disconnected ionic fragments preserved. */
    connectivitySmiles?: string;
    externalIdentifiers?: {
        pubchemCid?: number;
        equivalentPubchemCids?: number[];
        standardInchiKey?: string;
        alternateCasNumbers?: string[];
    };
    hazardLookup?: ChemicalHazardLookup;
    referencePhLookup?: ChemicalReferencePhLookup;
    properties?: {
        isHalogenated: boolean;
        isOrganic: boolean;
        /** External SDS/reference value. Never use this as a measured waste-batch pH. */
        referencePh?: number;
        /** @deprecated Read-only fallback for records created before referencePh was introduced. */
        ph?: number;
        phSource?: 'kosha_reference' | 'pubchem_reference';
    };
    physicalProperties?: {
        solubility?: string; // e.g. "miscible", "insoluble"
        flashPoint?: number; // degrees C
        boilingPoint?: number; // degrees C
        logKow?: number; // Partition coefficient
        stability?: string; // Stability description from Section 10
    };
    ghs?: {
        signal: string; // "Danger" or "Warning"
        hazardStatements: string[]; // e.g. "H225: Highly flammable liquid and vapour"
        precautionaryStatements?: string[];
        pictograms?: string[]; // URLs
    };
    koshaId?: number; // Added to support fetching KOSHA MSDS details
}

export type ChemicalHazardLookupStatus =
    | 'classified'
    | 'not_classified'
    | 'source_absent'
    | 'transient_error'
    | 'identity_ambiguous';

export interface ChemicalHazardLookup {
    status: ChemicalHazardLookupStatus;
    hCodes: string[];
    hazardStatements: string[];
    pictograms: string[];
    signalWord?: string;
    hazardFlags: WasteHazardFlag[];
    sources: Array<{
        source: 'pubchem' | 'kosha';
        sourceId: string;
    }>;
    fetchedAt: string;
    expiresAt?: string;
    algorithmVersion: number;
}

export type ChemicalReferencePhLookupStatus =
    | 'available'
    | 'pending'
    | 'not_requested'
    | 'source_absent'
    | 'transient_error'
    | 'identity_ambiguous';

export interface ChemicalReferencePhLookup {
    status: ChemicalReferencePhLookupStatus;
    value?: number;
    source?: 'kosha';
    sourceId?: string;
    fetchedAt?: string;
    expiresAt?: string;
    retryAfterMs?: number;
}

export type PhCatalogMatchedBy = 'inchi_key' | 'cas' | 'pubchem_cid';

export interface ChemicalPhCatalogMatch {
    status: 'matched' | 'ambiguous' | 'unmatched';
    id?: string;
    candidateIds: string[];
    matchedBy?: PhCatalogMatchedBy;
    catalogVersion: string;
    selection: 'automatic' | 'manual' | 'none';
}

export interface ChemicalEnrichmentRequestItem {
    requestId: string;
    name?: string;
    casNumber?: string;
    pubchemCid?: number;
    standardInchiKey?: string;
    molecularFormula?: string;
    molecularWeight?: number;
}

export interface ChemicalEnrichmentRequest {
    items: ChemicalEnrichmentRequestItem[];
    profile?: ChemicalEnrichmentProfile;
    scope?: { labId?: string };
}

export type ChemicalEnrichmentProfile = 'full' | 'inventory_hazard';

export type GhsPictogramCode =
    | 'GHS01'
    | 'GHS02'
    | 'GHS03'
    | 'GHS04'
    | 'GHS05'
    | 'GHS06'
    | 'GHS07'
    | 'GHS08'
    | 'GHS09';

export interface ChemicalEnrichmentDelivery {
    freshness: 'fresh' | 'stale';
    source: 'server_cache' | 'upstream';
    revalidationScheduled?: boolean;
}

export interface ChemicalEnrichmentResult {
    requestId: string;
    overallStatus: 'complete' | 'needs_review' | 'retryable';
    identity: {
        status: 'verified' | 'ambiguous' | 'not_found';
        canonicalName?: string;
        localizedName?: string;
        casNumber?: string;
        alternateCasNumbers?: string[];
        koshaChemId?: number;
        pubchemCid?: number;
        equivalentPubchemCids: number[];
        standardInchiKey?: string;
        molecularFormula?: string;
        molecularWeight?: number;
        connectivitySmiles?: string;
        evidence: Array<{
            source: 'pubchem' | 'kosha';
            sourceId: string;
            method: 'exact_cas' | 'primary_cid' | 'equivalent_inchikey' | 'exact_name';
        }>;
    };
    hazard: Omit<ChemicalHazardLookup, 'algorithmVersion'>;
    referencePh: ChemicalReferencePhLookup;
    phCatalog: Omit<ChemicalPhCatalogMatch, 'selection'>;
    delivery?: ChemicalEnrichmentDelivery;
    retryAfterMs?: number;
    enrichmentVersion: number;
}

export type AnalysisHazardWarningCode =
      | 'acute_toxic'
      | 'carcinogen_mutagen_reprotoxic'
      | 'environmental_hazard'
      | 'target_organ_toxic'
      /** US RCRA P-list match; informational only in the Korean policy. */
      | 'p_list_advisory'
      | 'u_listed_waste';

export interface AnalysisHazardWarning {
    code: AnalysisHazardWarningCode;
    hCodes: string[];
    labelKey: string;
    descriptionKey: string;
    evidenceLabel?: string;
}

export type ChemicalHazardEvidenceSource =
    | 'h_code'
    | 'formula_element'
    | 'formula_pattern'
    | 'name_pattern'
    | 'cas_registry';

export type ChemicalHazardEvidenceConfidence = 'confirmed' | 'inferred';

/** Evidence for one independently detected hazard; never inferred from disposal category precedence. */
export interface ChemicalHazardEvidence {
    flag: WasteHazardFlag;
    source: ChemicalHazardEvidenceSource;
    value: string;
    confidence: ChemicalHazardEvidenceConfidence;
}

/**
 * Lossless chemical hazard output. `category` remains a legacy single-value
 * projection and must not be used as the source of these flags.
 */
export interface ChemicalHazardProfile {
    version: '1.0.0';
    flags: WasteHazardFlag[];
    evidence: ChemicalHazardEvidence[];
}

export interface AnalysisResult {
    chemical: Chemical;
    category: DisposalCategory;
    binColor: string; // tailwind class e.g., 'bg-waste-acid'
    label: string; // User-facing label e.g., '산성 폐액'
    reason: string; // Explanation key for translation
    reasonParams?: Record<string, string | number>; // Dynamic params for translation
    isSafe: boolean; // False if requires manual verification
    isAiEstimated?: boolean; // True if the category was inferred by the Gemini API fallback
    hazardWarnings?: AnalysisHazardWarning[];
    /** Missing only on legacy/persisted results; consumers must re-derive it from `chemical`. */
    hazardProfile?: ChemicalHazardProfile;
    /** Material identity is separate from the final waste-stream category. */
    materialProfile?: ChemicalMaterialProfile;
}

export type MixtureAnalysisBasis = 'pure' | 'solution' | 'unknown_matrix';

export interface MixtureAnalysisResult {
    category: DisposalCategory;
    binColor: string;
    label: string;
    reason: string;
    isSafe: boolean;
    basis: MixtureAnalysisBasis;
    baseLabel?: string;
    baseReason?: string;
    contextWarnings?: string[];
    disposalDetails?: {
        solubility: 'SOLUBLE' | 'INSOLUBLE';
        neutralization: 'ALLOWED' | 'PROHIBITED';
    };
}

export interface CartItem extends AnalysisResult {
    volume?: string; // Input by user (e.g. "500 mL")
    molarity?: string; // Input by user (e.g. "0.1 M")
    solutionContext?: SolutionContext;
}

/** Units accepted by the V2 waste-batch workflow. */
export type AmountUnit = 'mL' | 'L' | 'mg' | 'g';

/** The physical matrix of the complete waste batch, not an individual reagent. */
export type WasteMatrix =
    | 'aqueous'
    | 'organic_non_halogenated'
    | 'organic_halogenated'
    | 'mixed_biphasic'
    | 'solid_slurry'
    | 'unknown';

export type DecisionStatus = 'ready' | 'needs_input' | 'blocked';

export type HandlingAction =
    | 'container_deposit'
    | 'isolated'
    | 'handover';

/** Stable, locale-independent waste stream identifiers. */
export type WasteStreamCode =
    | 'ACID_AQUEOUS'
    | 'ALKALI_AQUEOUS'
    | 'ORGANIC_HALOGENATED'
    | 'ORGANIC_NON_HALOGENATED'
    | 'HEAVY_METAL'
    | 'CYANIDE_SULFIDE'
    | 'REACTIVE_OXIDIZER'
    | 'SOLID_CONTAMINATED'
    | 'AQUEOUS_OTHER'
    | 'SPECIAL_REVIEW';

export type WasteHazardFlag =
    | 'FLAMMABLE'
    | 'OXIDIZER'
    | 'EXPLOSIVE'
    | 'SELF_REACTIVE'
    | 'WATER_REACTIVE'
    | 'PYROPHORIC'
    | 'CORROSIVE'
    | 'ACUTE_TOXIC'
    | 'CMR'
    | 'ENVIRONMENTAL_HAZARD'
    | 'CYANIDE'
    | 'SULFIDE'
    | 'HEAVY_METAL'
    | 'HYDROFLUORIC_ACID'
    | 'FLUORIDE'
    | 'REACTIVE'
    | 'UNKNOWN_COMPONENT';

export type WasteComponentSource = 'search' | 'scan' | 'inventory' | 'cabinet' | 'manual';
export type WasteDataStatus = 'verified' | 'lookup_failed' | 'not_checked';
export type WasteIdentityConfidence = 'verified' | 'review_required' | 'unknown';
export type AdditionalComponentsStatus = 'none' | 'present' | 'unknown';
export type FluorideContainerStatus = 'compatible' | 'incompatible' | 'unknown';
export type WasteMixingState = 'unknown' | 'separate' | 'already_mixed';
export type WasteIncidentContext = 'none' | 'broken' | 'leak';
export type WasteMatrixSource = 'automatic' | 'user' | 'unresolved';
export type ConcentrationUnit = 'M' | 'mM' | '%' | 'mg/mL';
export type WasteSolutionVolumeUnit = 'uL' | 'mL' | 'L';
export type WasteConcentrationBasis = 'w_w' | 'w_v' | 'v_v';
export type WasteLegalPhClass = 'waste_acid' | 'waste_alkali' | 'none' | 'unknown';
export type WasteCorrosivityPhScreen = 'review_required' | 'not_indicated' | 'unknown';
export type WasteRoutingBasis =
    | 'special_rule'
    | 'identity'
    | 'measured_batch_ph'
    | 'predicted_batch_ph'
    | 'matrix'
    | 'unresolved';

/**
 * Batch amount keeps both the user's entry and the normalized comparison value.
 * Volume is normalized to mL and mass to mg; mass and volume are never converted
 * into one another without an explicit density-aware workflow.
 */
export interface WasteAmount {
    value: number | null;
    unit: AmountUnit | null;
    normalizedValue: number | null;
    normalizedUnit: 'mL' | 'mg' | null;
    isApproximate: boolean;
    isUnknown: boolean;
    /** Client-side provenance; final RPCs continue to store the normalized amount and approximation flag. */
    source?: 'manual' | 'component_sum';
}

export interface WasteConcentration {
    value: number;
    unit: ConcentrationUnit;
    /** Required for percentage concentrations so the value can be converted without guessing. */
    basis?: WasteConcentrationBasis;
    density?: WasteDensityMetadata;
}

export interface WasteDensityMetadata {
    value: number;
    unit: 'g/mL';
    /** w/w uses solution density; v/v uses the pure solute density. */
    kind: 'solution' | 'solute';
    source?: 'catalog' | 'user';
    temperatureC?: number;
    isEstimate?: boolean;
}

export interface WasteSolutionVolume {
    value: number;
    unit: WasteSolutionVolumeUnit;
    normalizedMl: number;
    isEstimate?: boolean;
}

/** V2 cart line. Extending CartItem keeps legacy readers interoperable. */
export interface WasteComponent extends CartItem {
    cartLineId: string;
    sourceType: WasteComponentSource;
    sourceRef?: string;
    inventoryId?: string;
    cabinetId?: string;
    identityConfidence: WasteIdentityConfidence;
    /** True when a person, rather than an automatic lookup, explicitly confirmed the identity. */
    identityConfirmedByUser?: boolean;
    ghsDataStatus: WasteDataStatus;
    /** User explicitly reviewed the product label or SDS when an automatic GHS lookup was unavailable. */
    hazardDataConfirmedByUser?: boolean;
    capturedAt: string;
    hazardFlags: WasteHazardFlag[];
    /** Automatically recovered GHS and exact identity-based hazard evidence. */
    automaticHazardFlags?: WasteHazardFlag[];
    /** Label/SDS flags explicitly selected by a person; automatic refresh never removes these. */
    manualHazardFlags?: WasteHazardFlag[];
    /** Structured, field-level label scan evidence used to explain identity confirmation. */
    scanSnapshot?: Record<string, unknown>;
    concentration?: WasteConcentration;
    solutionVolume?: WasteSolutionVolume;
    /** Stable identifier for the exact chemical form in the approved pH catalog. */
    phCatalogId?: string;
    phCatalogMatch?: ChemicalPhCatalogMatch;
    enrichmentVersion?: number;
    enrichmentLastAttemptAt?: string;
    enrichmentRetryCount?: number;
    /** Number of inventory containers represented by this line that are physically discarded. */
    inventoryDisposalQuantity?: number;
    inventorySnapshot?: {
        brand?: string | null;
        productNumber?: string | null;
        location?: string | null;
        nominalCapacity?: string | null;
        quantity?: number | null;
        remainingPercent?: number | null;
    };
}

export interface WasteBatchDraft {
    id: string;
    /** Human-readable label generated when the draft is parked. */
    displayName?: string;
    /** ISO timestamp recorded when the draft is parked. */
    parkedAt?: string;
    scopeKey: string;
    userId?: string;
    labId?: string;
    components: WasteComponent[];
    matrix: WasteMatrix;
    matrixSource: WasteMatrixSource;
    totalAmount: WasteAmount;
    /** Actual measured pH of the complete physical waste batch. */
    measuredBatchPh?: number;
    /** @deprecated Persisted-draft compatibility; normalized into measuredBatchPh when loaded. */
    measuredPh?: number;
    measuredPhStatus: 'measured' | 'unknown' | 'not_required';
    mixingState: WasteMixingState;
    additionalComponentsStatus?: AdditionalComponentsStatus;
    /** Confirmation that HF/fluoride waste uses an institution-approved compatible container. */
    fluorideContainerStatus?: FluorideContainerStatus;
    /** Physical incident context that must never be downgraded to an ordinary container deposit. */
    incidentContext: WasteIncidentContext;
    createdAt: string;
    updatedAt: string;
}

export type WasteDecisionReasonCode =
    | 'dangerous_compatibility'
    | 'incident_response'
    | 'special_hazard'
    | 'reactive_waste'
    | 'explosive_or_self_reactive'
    | 'water_reactive_aqueous'
    | 'pyrophoric'
    | 'policy_blocked_hazard'
    | 'policy_disallowed_hazard'
    | 'hf_fluoride_incompatible_container'
    | 'acid_alkali_separate'
    | 'acid_alkali_non_aqueous_mixed'
    | 'unknown_matrix_review'
    | 'unknown_component';

export interface WasteDecisionReason {
    code: WasteDecisionReasonCode;
    messageKey: string;
    ruleId?: string;
    chemicals?: string[];
}

export type WasteMissingField =
    | 'components'
    | 'matrix'
    | 'total_amount'
    | 'mixing_state'
    | 'measured_ph'
    | 'identity'
    | 'hazard_data'
    /** Identity/GHS are known, but the disposal family could not be derived safely. */
    | 'classification'
    | 'additional_components'
    | 'fluoride_container'
    | 'inventory_quantity'
    | 'policy_stream'
    | 'policy_destination';

export interface WasteDecision {
    decisionStatus: DecisionStatus;
    streamCode: WasteStreamCode;
    hazardFlags: WasteHazardFlag[];
    allowedActions: HandlingAction[];
    blockingReasons: WasteDecisionReason[];
    missingFields: WasteMissingField[];
    legalWastePhClass: WasteLegalPhClass;
    corrosivityPhScreen: WasteCorrosivityPhScreen;
    routingBasis: WasteRoutingBasis;
    policyVersion: string;
    ruleVersion: string;
}

export type PhPredictionStatus =
    | 'available'
    | 'approximate'
    | 'unsupported'
    | 'blocked'
    | 'failed';

export type PhPredictionConfidence = 'good' | 'approximate' | 'unavailable';

/** A prediction never authorizes routing by itself; that requires separate server approval. */
export interface PhPredictionResult {
    status: PhPredictionStatus;
    value?: number;
    displayValue?: number;
    ionicStrength?: number;
    confidence: PhPredictionConfidence;
    issueCodes: string[];
    assumptions: string[];
    modelVersion: string;
    catalogVersion: string;
    inputHash: string;
}

/** Immutable audit copy written only when a handling record is finalized. */
export interface PhPredictionSnapshot extends PhPredictionResult {
    origin: 'client_generated';
    capturedAt: string;
}

export interface MsdsSection {
    title: string;
    content: { label: string; value: string }[];
}

export interface WasteLog {
    id: string;
    created_at: string;
    chemicals: CartItem[];
    disposal_category: string;
    total_volume_ml?: number;
    handler_name?: string;
    memo?: string;
}
