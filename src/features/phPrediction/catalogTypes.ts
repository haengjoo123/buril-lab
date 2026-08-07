export type PhCatalogRecordFlag =
    | 'gas_sensitive'
    | 'temperature_sensitive'
    | 'precipitation_risk'
    | 'metal_complexation'
    | 'unsupported_reactivity';

export interface PhPkaMetadata {
    pKaType: 'thermodynamic' | 'conditional';
    temperatureC: number;
    solvent: 'water';
    /** Zero denotes an infinite-dilution thermodynamic value; null means unspecified/reporting conditions. */
    ionicStrengthMolal: number | null;
    standardState: 'infinite_dilution_molality' | 'reported_condition';
    uncertaintyPka: number | null;
    approvalStatus: 'approved' | 'provisional';
    sourceRefs: readonly string[];
}

export interface PhAcidBaseFamily {
    id: string;
    /** Charge of the fully protonated member. Each deprotonation lowers charge by one. */
    fullyProtonatedCharge: number;
    /** Stepwise, thermodynamic pKa values at 25 degrees C, in deprotonation order. */
    pKas: readonly number[];
    /** Per-step provenance prevents applying activity correction twice to conditional values. */
    pKaMetadata: readonly PhPkaMetadata[];
    sourceRefs: readonly string[];
}

export interface PhCatalogContribution {
    familyId: string;
    stoichiometry: number;
}

export interface PhCatalogFixedIon {
    label: string;
    charge: number;
    stoichiometry: number;
}

export type PhStructureIdentity =
    | {
        kind: 'pubchem';
        pubchemCid: number;
        standardInchiKey: string;
        sourceRef: string;
    }
    | {
        kind: 'pseudo_species';
        modelId: string;
        definition: string;
        selectable: false;
    };

export interface PhCatalogRecord {
    id: string;
    names: readonly string[];
    casNumber?: string;
    structureIdentity: PhStructureIdentity;
    exactFormLabel: string;
    hydration: 'anhydrous' | 'not_applicable';
    stereochemistry: 'achiral' | 'unspecified' | 'L';
    formula: string;
    molecularWeight: number;
    /** Water/diluent contributes volume but no analytical solute. */
    kind: 'solute' | 'solvent';
    contributions: readonly PhCatalogContribution[];
    fixedIons: readonly PhCatalogFixedIon[];
    /** Strong acids/bases may release one water-system ion outside a protonation family. */
    implicitWaterIonCharge?: -1 | 1;
    flags?: readonly PhCatalogRecordFlag[];
    sourceRefs: readonly string[];
    reviewed: true;
}

export interface PhCatalog {
    version: string;
    temperatureC: 25;
    sourceIds: readonly string[];
    records: readonly PhCatalogRecord[];
    families: readonly PhAcidBaseFamily[];
}
