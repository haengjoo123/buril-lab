export type DisposalCategory =
    | 'ACID'
    | 'ALKALI'
    | 'NEUTRAL'
    | 'ORGANIC_HALOGEN'
    | 'ORGANIC_NON_HALOGEN'
    | 'UNKNOWN';

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

export interface AnalysisResult {
    chemical: Chemical;
    category: DisposalCategory;
    binColor: string; // tailwind class e.g., 'bg-waste-acid'
    label: string; // User-facing label e.g., '산성 폐액'
    reason: string; // Explanation key for translation
    reasonParams?: Record<string, string | number>; // Dynamic params for translation
    isSafe: boolean; // False if requires manual verification
}

export interface CartItem extends AnalysisResult {
    volume?: string; // Input by user (e.g. "500 mL")
    molarity?: string; // Input by user (e.g. "0.1 M")
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
