import type { SolventClass, SolutionContext } from '../types';
import { searchChemical } from '../services/searchService';
import { parseFormula } from './chemicalAnalyzer';

export interface SolventDictionaryEntry {
    name: string;
    solventClass: Extract<SolventClass, 'organic_halogen' | 'organic_non_halogen'>;
    casNumber?: string;
    molecularFormula?: string;
}

export interface CustomSolventResolution {
    solventClass: SolventClass;
    solventName?: string;
    isSolventVerified: boolean;
    solventResolution: SolutionContext['solventResolution'];
    solventCasNumber?: string;
    solventMolecularFormula?: string;
}

const COMMON_SOLVENT_ALIASES: Record<string, SolventDictionaryEntry> = {};

export const REPRESENTATIVE_SOLVENT_PRESETS = Object.freeze({
    organic_non_halogen: [
        'DMSO',
        'Ethanol',
        'Methanol',
        'Acetone',
        'Acetonitrile',
        'Hexane',
        'Ethyl acetate',
        'THF',
    ],
    organic_halogen: [
        'Dichloromethane',
        'Chloroform',
        'Chlorobenzene',
        '1,2-Dichloroethane',
    ],
} satisfies Record<'organic_non_halogen' | 'organic_halogen', readonly string[]>);

const addSolvent = (entry: SolventDictionaryEntry, aliases: string[]) => {
    aliases.forEach((alias) => {
        COMMON_SOLVENT_ALIASES[normalizeSolventQuery(alias)] = entry;
    });
};

addSolvent(
    { name: 'DMSO', solventClass: 'organic_non_halogen', casNumber: '67-68-5', molecularFormula: 'C2H6OS' },
    ['DMSO', 'Dimethyl sulfoxide', 'Dimethyl sulphoxide']
);
addSolvent(
    { name: 'Ethanol', solventClass: 'organic_non_halogen', casNumber: '64-17-5', molecularFormula: 'C2H6O' },
    ['Ethanol', 'EtOH', 'Ethyl alcohol']
);
addSolvent(
    { name: 'Methanol', solventClass: 'organic_non_halogen', casNumber: '67-56-1', molecularFormula: 'CH4O' },
    ['Methanol', 'MeOH', 'Methyl alcohol']
);
addSolvent(
    { name: 'Acetone', solventClass: 'organic_non_halogen', casNumber: '67-64-1', molecularFormula: 'C3H6O' },
    ['Acetone']
);
addSolvent(
    { name: 'Acetonitrile', solventClass: 'organic_non_halogen', casNumber: '75-05-8', molecularFormula: 'C2H3N' },
    ['Acetonitrile', 'ACN', 'MeCN']
);
addSolvent(
    { name: 'Hexane', solventClass: 'organic_non_halogen', casNumber: '110-54-3', molecularFormula: 'C6H14' },
    ['Hexane', 'n-Hexane']
);
addSolvent(
    { name: 'Heptane', solventClass: 'organic_non_halogen', casNumber: '142-82-5', molecularFormula: 'C7H16' },
    ['Heptane', 'n-Heptane']
);
addSolvent(
    { name: 'Toluene', solventClass: 'organic_non_halogen', casNumber: '108-88-3', molecularFormula: 'C7H8' },
    ['Toluene']
);
addSolvent(
    { name: 'Xylene', solventClass: 'organic_non_halogen', casNumber: '1330-20-7', molecularFormula: 'C8H10' },
    ['Xylene', 'Xylenes', 'o-Xylene', 'm-Xylene', 'p-Xylene']
);
addSolvent(
    { name: 'Benzene', solventClass: 'organic_non_halogen', casNumber: '71-43-2', molecularFormula: 'C6H6' },
    ['Benzene']
);
addSolvent(
    { name: 'THF', solventClass: 'organic_non_halogen', casNumber: '109-99-9', molecularFormula: 'C4H8O' },
    ['THF', 'Tetrahydrofuran']
);
addSolvent(
    { name: 'DMF', solventClass: 'organic_non_halogen', casNumber: '68-12-2', molecularFormula: 'C3H7NO' },
    ['DMF', 'Dimethylformamide', 'N,N-Dimethylformamide']
);
addSolvent(
    { name: 'IPA', solventClass: 'organic_non_halogen', casNumber: '67-63-0', molecularFormula: 'C3H8O' },
    ['IPA', 'Isopropanol', 'Isopropyl alcohol', '2-Propanol']
);
addSolvent(
    { name: 'Ethyl acetate', solventClass: 'organic_non_halogen', casNumber: '141-78-6', molecularFormula: 'C4H8O2' },
    ['Ethyl acetate', 'EtOAc']
);
addSolvent(
    { name: 'Diethyl ether', solventClass: 'organic_non_halogen', casNumber: '60-29-7', molecularFormula: 'C4H10O' },
    ['Diethyl ether', 'Ether', 'Ethyl ether']
);
addSolvent(
    { name: 'Dichloromethane', solventClass: 'organic_halogen', casNumber: '75-09-2', molecularFormula: 'CH2Cl2' },
    ['Dichloromethane', 'DCM', 'Methylene chloride']
);
addSolvent(
    { name: 'Chloroform', solventClass: 'organic_halogen', casNumber: '67-66-3', molecularFormula: 'CHCl3' },
    ['Chloroform']
);
addSolvent(
    { name: 'Chlorobenzene', solventClass: 'organic_halogen', casNumber: '108-90-7', molecularFormula: 'C6H5Cl' },
    ['Chlorobenzene']
);
addSolvent(
    { name: '1,2-Dichloroethane', solventClass: 'organic_halogen', casNumber: '107-06-2', molecularFormula: 'C2H4Cl2' },
    ['1,2-Dichloroethane', 'Dichloroethane', 'EDC']
);
addSolvent(
    { name: 'Trichloroethylene', solventClass: 'organic_halogen', casNumber: '79-01-6', molecularFormula: 'C2HCl3' },
    ['Trichloroethylene', 'TCE']
);
addSolvent(
    { name: 'Tetrachloroethylene', solventClass: 'organic_halogen', casNumber: '127-18-4', molecularFormula: 'C2Cl4' },
    ['Tetrachloroethylene', 'Perchloroethylene', 'PCE']
);
addSolvent(
    { name: 'Carbon tetrachloride', solventClass: 'organic_halogen', casNumber: '56-23-5', molecularFormula: 'CCl4' },
    ['Carbon tetrachloride', 'Tetrachloromethane']
);

function normalizeSolventQuery(value: string): string {
    return value
        .trim()
        .toUpperCase()
        .replace(/[.,]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*-\s*/g, '-');
}

function inferSolventClassFromFormula(formula?: string): SolventClass {
    if (!formula) return 'organic_unknown';

    const elements = parseFormula(formula);
    const hasCarbon = Boolean(elements.C);
    const hasHalogen = Boolean(elements.F || elements.Cl || elements.Br || elements.I);

    if (hasCarbon && hasHalogen) return 'organic_halogen';
    if (hasCarbon) return 'organic_non_halogen';
    return 'organic_unknown';
}

export function resolveLocalOrganicSolvent(input: string): SolventDictionaryEntry | undefined {
    return COMMON_SOLVENT_ALIASES[normalizeSolventQuery(input)];
}

export async function resolveCustomOrganicSolvent(input: string): Promise<CustomSolventResolution> {
    const trimmedInput = input.trim();

    if (!trimmedInput) {
        return {
            solventClass: 'organic_unknown',
            isSolventVerified: false,
            solventResolution: 'unresolved',
        };
    }

    const localMatch = resolveLocalOrganicSolvent(trimmedInput);
    if (localMatch) {
        return {
            solventClass: localMatch.solventClass,
            solventName: localMatch.name,
            isSolventVerified: true,
            solventResolution: 'local_dictionary',
            solventCasNumber: localMatch.casNumber,
            solventMolecularFormula: localMatch.molecularFormula,
        };
    }

    const externalMatch = await searchChemical(trimmedInput).catch(() => null);
    if (!externalMatch) {
        return {
            solventClass: 'organic_unknown',
            solventName: trimmedInput,
            isSolventVerified: false,
            solventResolution: 'unresolved',
        };
    }

    const solventClass = inferSolventClassFromFormula(externalMatch.molecularFormula);
    const isVerifiedOrganicSolvent = solventClass === 'organic_halogen' || solventClass === 'organic_non_halogen';

    return {
        solventClass,
        solventName: externalMatch.name || trimmedInput,
        isSolventVerified: isVerifiedOrganicSolvent,
        solventResolution: isVerifiedOrganicSolvent ? 'external_lookup' : 'unresolved',
        solventCasNumber: externalMatch.casNumber,
        solventMolecularFormula: externalMatch.molecularFormula,
    };
}
