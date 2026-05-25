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
    | 'unresolved';

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
    properties?: {
        isHalogenated: boolean;
        isOrganic: boolean;
        ph?: number; // Optional, for acid/alkali determination
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

export type AnalysisHazardWarningCode =
    | 'acute_toxic'
    | 'carcinogen_mutagen_reprotoxic'
    | 'environmental_hazard'
    | 'target_organ_toxic'
    | 'u_listed_waste';

export interface AnalysisHazardWarning {
    code: AnalysisHazardWarningCode;
    hCodes: string[];
    labelKey: string;
    descriptionKey: string;
    evidenceLabel?: string;
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
