import type {
    AnalysisHazardWarning,
    AnalysisResult,
    Chemical,
    ChemicalHazardEvidence,
    ChemicalHazardProfile,
    DisposalCategory,
    WasteHazardFlag,
} from '../types';
import pListCas from '../data/p_list_cas.json';
import uListCas from '../data/u_list_cas.json';
import { parseFormula, type ElementCounts } from './chemicalFormula';

export { parseFormula } from './chemicalFormula';

const hydrateSeparators = /[.\u00b7\u2022]/g;

const HALOGENS = ['F', 'Cl', 'Br', 'I'] as const;
const HEAVY_METALS = [
    'Ag', 'Cd', 'Pb', 'Hg', 'Cr', 'As', 'Ni', 'Cu', 'Zn', 'Ba',
    'Be', 'Co', 'Mn', 'Os', 'Sb', 'Tl', 'Pd', 'Pt', 'Rh', 'Ru',
    'Ir', 'Au', 'Sn', 'Se', 'Mo', 'V',
] as const;
const CARBIDE_COUNTERIONS = [
    'Li', 'Na', 'K', 'Rb', 'Cs',
    'Mg', 'Ca', 'Sr', 'Ba',
    'Al', 'Be', 'B', 'Si',
    'Ti', 'Zr', 'V', 'W', 'Fe',
] as const;
const CARBONATE_COUNTERIONS = [
    'Li', 'Na', 'K', 'Rb', 'Cs',
    'Mg', 'Ca', 'Sr', 'Ba',
    'Al', 'Be', 'Fe', 'Cu', 'Zn',
    'Ni', 'Co', 'Mn', 'Ag', 'Cd', 'Pb',
] as const;
const ALKALI_METALS = ['Li', 'Na', 'K', 'Rb', 'Cs'] as const;

const REACTIVE_H_CODES = new Set([
    // Explosives / desensitized explosives
    'H200', 'H201', 'H202', 'H203', 'H204', 'H205', 'H206', 'H207', 'H208',
    // Self-reactive substances and organic peroxides
    'H240', 'H241', 'H242',
    // Pyrophoric / self-heating / water-reactive
    'H250', 'H251', 'H252', 'H260', 'H261',
    // Oxidizing gases, liquids, and solids
    'H270', 'H271', 'H272',
]);

const FATAL_ACUTE_TOXICITY_H_CODES = new Set(['H300', 'H310', 'H330']);
const ACUTE_TOXICITY_H_CODES = new Set(['H300', 'H301', 'H310', 'H311', 'H330', 'H331']);
const CMR_H_CODES = new Set(['H340', 'H341', 'H350', 'H351', 'H360', 'H361', 'H362']);
const ENVIRONMENTAL_H_CODES = new Set(['H400', 'H401', 'H402', 'H410', 'H411', 'H412', 'H413', 'H420']);
const TARGET_ORGAN_H_CODES = new Set(['H370', 'H371', 'H372', 'H373']);

const HAZARD_H_CODES = {
    FLAMMABLE: ['H220', 'H221', 'H222', 'H223', 'H224', 'H225', 'H226', 'H227', 'H228'],
    OXIDIZER: ['H270', 'H271', 'H272'],
    EXPLOSIVE: ['H200', 'H201', 'H202', 'H203', 'H204', 'H205'],
    SELF_REACTIVE: ['H240', 'H241', 'H242'],
    WATER_REACTIVE: ['H260', 'H261'],
    PYROPHORIC: ['H250'],
    CORROSIVE: ['H290', 'H314'],
    ACUTE_TOXIC: ['H300', 'H301', 'H310', 'H311', 'H330', 'H331'],
    CMR: ['H340', 'H341', 'H350', 'H351', 'H360', 'H361', 'H362'],
    ENVIRONMENTAL_HAZARD: ['H400', 'H410', 'H411', 'H412', 'H413'],
} as const satisfies Partial<Record<WasteHazardFlag, readonly string[]>>;

const HYDROFLUORIC_ACID_CAS = '7664-39-3';
const FLUORIDE_COMPOUND_CAS = new Set([
    '7681-49-4', '7789-23-3', '12125-01-8', '1341-49-7', '7789-24-4',
    '7789-75-5', '7783-40-6', '7784-18-1', '1333-83-1', '7789-29-9',
]);
const FLUORIDE_COMPOUND_FORMULAS = new Set([
    'NAF', 'KF', 'NH4F', 'NH4HF2', 'LIF', 'CAF2', 'MGF2', 'ALF3',
    'NAHF2', 'KHF2', 'CSF', 'RBF', 'BAF2', 'ZNF2',
]);

const REACTIVE_NAME_PATTERNS = [
    /\bperoxide\b/i,
    /\bsuperoxide\b/i,
    /\bhydroperoxide\b/i,
    /\bnitrate\b/i,
    /\bnitrite\b/i,
    /\bhypochlorite\b/i,
    /\bchlorite\b/i,
    /\bchlorate\b/i,
    /\bbromate\b/i,
    /\bperchlorate\b/i,
    /\bperiodate\b/i,
    /\biodate\b/i,
    /\bpermanganate\b/i,
    /\bpersulfate\b/i,
    /\bperoxydisulfate\b/i,
    /\bperacetic\s+acid\b/i,
    /perbenzoic\s+acid/i,
    /\bperoxy/i,
    /\bperoxy\s*acid\b/i,
    /\bazide\b/i,
    /\bdiazomethane\b/i,
    /\bhydrazine\b/i,
    /\bpicric\b/i,
    /\bnitric\s+acid\b/i,
    /\bperchloric\s+acid\b/i,
    /\bchromic\s+acid\b/i,
    /\bborohydride\b/i,
    /\baluminum\s+hydride\b/i,
    /\baluminium\s+hydride\b/i,
    /\blithium\s+alum(?:in)?ium\s+hydride\b/i,
    /\b(?:sodium|potassium|lithium|calcium)\s+hydride\b/i,
    /\b(?:sodium|potassium|lithium)\s+amide\b/i,
    /\blithium\s+diisopropylamide\b/i,
    /\bLDA\b/i,
    /\b(?:n-|sec-|tert-|t-)?butyllithium\b/i,
    /\borganolithium\b/i,
    /\b(?:methyl|ethyl|phenyl|vinyl|allyl|isopropyl|tert-butyl|benzyl)magnesium\s+(?:bromide|chloride|iodide)\b/i,
    /\bDIBAL-?H\b/i,
    /\bdiisobutylalum(?:in)?ium\s+hydride\b/i,
    /\bsodium\s+metal\b/i,
    /\bpotassium\s+metal\b/i,
];

const CYANIDE_NAME_PATTERNS = [
    /\bcyanide\b/i,
    /\bcyanid\b/i,
    /\bferricyanide\b/i,
    /\bferrocyanide\b/i,
    /\bthiocyanate\b/i,
    /시안화|시안|청산/i,
];

const SULFIDE_NAME_PATTERNS = [
    /\bsulfide\b/i,
    /\bsulphide\b/i,
    /\bhydrogen\s+sulfide\b/i,
    /황화/i,
];

const INORGANIC_CARBON_NAME_PATTERNS = [
    /\bcarbonate\b/i,
    /\bbicarbonate\b/i,
    /\bcarbon\s+monoxide\b/i,
    /\bcarbon\s+dioxide\b/i,
    /\bcarbide\b/i,
    /\bcyanide\b/i,
    /\bferricyanide\b/i,
    /\bferrocyanide\b/i,
    /\bthiocyanate\b/i,
];

const ALKALI_NAME_PATTERNS = [
    /\bhydroxide\b/i,
    /\bammonia\b/i,
    /\bammonium\s+hydroxide\b/i,
    /\bbase\b/i,
    /\balkali\b/i,
    /\b(?:sodium|potassium)\s+bicarbonate\b/i,
    /\b(?:sodium|potassium)\s+carbonate\b/i,
];

const ACID_NAME_PATTERNS = [
    /\bsulfuric\s+acid\b/i,
    /\bsulphuric\s+acid\b/i,
    /\bhydrochloric\s+acid\b/i,
    /\bhydrofluoric\s+acid\b/i,
    /\bhydrobromic\s+acid\b/i,
    /\bhydroiodic\s+acid\b/i,
    /\bphosphoric\s+acid\b/i,
    /\bboric\s+acid\b/i,
    /\bchromic\s+acid\b/i,
    /\binorganic\s+acid\b/i,
    /\bHCl\b/i,
    /\bHF\b/i,
];

const SOLID_NAME_PATTERNS = [
    /\bpowder\b/i,
    /\bresin\b/i,
    /\bsand\b/i,
    /\bpellet\b/i,
    /\bbead\b/i,
    /\blump\b/i,
    /\bcrystal\b/i,
];

export const extractHCodes = (statements: string[] = []): string[] => {
    const codes = new Set<string>();
    for (const statement of statements) {
        const matches = statement.match(/H\d{3}/g) || [];
        matches.forEach(code => codes.add(code));
    }
    return [...codes];
};

export const buildHazardWarnings = (hCodes: string[] = [], chemical?: Chemical): AnalysisHazardWarning[] => {
    const warningSpecs: Array<{
        code: AnalysisHazardWarning['code'];
        hCodes: Set<string>;
        labelKey: string;
        descriptionKey: string;
    }> = [
        {
            code: 'acute_toxic',
            hCodes: ACUTE_TOXICITY_H_CODES,
            labelKey: 'hazard_warning_acute_toxic',
            descriptionKey: 'hazard_warning_acute_toxic_desc',
        },
        {
            code: 'carcinogen_mutagen_reprotoxic',
            hCodes: CMR_H_CODES,
            labelKey: 'hazard_warning_cmr',
            descriptionKey: 'hazard_warning_cmr_desc',
        },
        {
            code: 'target_organ_toxic',
            hCodes: TARGET_ORGAN_H_CODES,
            labelKey: 'hazard_warning_target_organ',
            descriptionKey: 'hazard_warning_target_organ_desc',
        },
        {
            code: 'environmental_hazard',
            hCodes: ENVIRONMENTAL_H_CODES,
            labelKey: 'hazard_warning_environmental',
            descriptionKey: 'hazard_warning_environmental_desc',
        },
    ];

    const warnings: AnalysisHazardWarning[] = warningSpecs
        .map((spec) => ({
            code: spec.code,
            hCodes: hCodes.filter(code => spec.hCodes.has(code)),
            labelKey: spec.labelKey,
            descriptionKey: spec.descriptionKey,
        }))
        .filter(warning => warning.hCodes.length > 0);

    if (chemical?.casNumber && uListCas.includes(chemical.casNumber)) {
        warnings.push({
            code: 'u_listed_waste',
            hCodes: [],
            labelKey: 'hazard_warning_u_listed',
            descriptionKey: 'hazard_warning_u_listed_desc',
            evidenceLabel: `CAS ${chemical.casNumber}`,
        });
    }

    return warnings;
};

const matchesAny = (text: string, patterns: RegExp[]): boolean =>
    patterns.some(pattern => pattern.test(text));

const hasAnyElement = (elements: ElementCounts, candidates: readonly string[]): boolean =>
    candidates.some(element => Boolean(elements[element]));

const normalizedFormula = (formula: string): string =>
    formula.replace(/\s+/g, '').replace(hydrateSeparators, '.');

const isLikelyCyanideFormula = (formula: string): boolean => {
    const normalized = normalizedFormula(formula);
    return /\bH?CN\b/i.test(normalized) ||
        /CN(?:\)|\d|$)/i.test(normalized) ||
        /SCN(?:\)|\d|$)/i.test(normalized);
};

const isLikelySulfideFormula = (elements: ElementCounts): boolean => {
    const sulfideCounterions = ['H', 'Li', 'Na', 'K', 'Mg', 'Ca', 'Ba', 'Fe', 'Zn', 'Cd', 'Pb', 'Hg', 'Cu'];
    return Boolean(elements.S) &&
        !elements.O &&
        !elements.C &&
        hasAnyElement(elements, sulfideCounterions);
};

const isHydrofluoricAcidIdentity = (chemical: Chemical): boolean =>
    chemical.casNumber?.trim() === HYDROFLUORIC_ACID_CAS ||
    normalizedFormula(chemical.molecularFormula || '').toUpperCase() === 'HF' ||
    /\b(?:hydrofluoric\s+acid|hydrogen\s+fluoride|fluorhydric\s+acid)\b|불산|불화\s*수소|플루오린화\s*수소/i.test(chemical.name || '');

const isFluorideCompoundIdentity = (chemical: Chemical): boolean =>
    FLUORIDE_COMPOUND_CAS.has(chemical.casNumber?.trim() ?? '') ||
    FLUORIDE_COMPOUND_FORMULAS.has(normalizedFormula(chemical.molecularFormula || '').toUpperCase()) ||
    /\b(?:bi)?fluoride\b|\bhydrogen\s+difluoride\b|불화물|불화암모늄|불화나트륨|불화칼륨/i.test(chemical.name || '');

const isFormulaExactly = (formula: string, candidates: readonly string[]): boolean => {
    const normalized = normalizedFormula(formula).toUpperCase();
    return candidates.some(candidate => normalized === candidate.toUpperCase());
};

const hasInorganicPhosphateCore = (elements: ElementCounts): boolean =>
    Boolean(elements.P) &&
    (elements.O || 0) >= 4 &&
    !elements.C;

const hasAlkaliMetalCounterion = (elements: ElementCounts): boolean =>
    hasAnyElement(elements, ALKALI_METALS);

const isAlkaliPhosphateSalt = (name: string, formula: string, elements: ElementCounts): boolean => {
    if (!hasInorganicPhosphateCore(elements) || !hasAlkaliMetalCounterion(elements)) return false;

    const isNamedPhosphate = /\b(?:ortho)?phosphate\b/i.test(name);
    const hasBasicPhosphateName = /\b(?:di[-\s]?(?:sodium|potassium|lithium)|(?:sodium|potassium|lithium)\s+phosphate\s+dibasic|dibasic|hydrogen\s+(?:ortho)?phosphate|monohydrogen\s+(?:ortho)?phosphate|tri[-\s]?(?:sodium|potassium|lithium)|(?:sodium|potassium|lithium)\s+phosphate\s+tribasic|tribasic)\b/i.test(name);
    if (isNamedPhosphate && hasBasicPhosphateName) return true;

    return isFormulaExactly(formula, ['Li2HPO4', 'Na2HPO4', 'K2HPO4', 'Li3PO4', 'Na3PO4', 'K3PO4']);
};

const isAcidPhosphateSalt = (name: string, formula: string, elements: ElementCounts): boolean => {
    if (!hasInorganicPhosphateCore(elements) || !hasAlkaliMetalCounterion(elements)) return false;

    const isNamedPhosphate = /\b(?:ortho)?phosphate\b/i.test(name);
    const hasAcidPhosphateName = /\b(?:mono[-\s]?(?:sodium|potassium|lithium)|(?:sodium|potassium|lithium)\s+phosphate\s+monobasic|monobasic|dihydrogen\s+(?:ortho)?phosphate|biphosphate)\b/i.test(name);
    if (isNamedPhosphate && hasAcidPhosphateName) return true;

    return isFormulaExactly(formula, ['LiH2PO4', 'NaH2PO4', 'KH2PO4']);
};

export const isInorganicCarbonFormula = (formula: string, name = ''): boolean => {
    const elements = parseFormula(formula);
    const normalized = normalizedFormula(formula);
    const elementNames = Object.keys(elements);

    if (!elements.C) return false;
    if (matchesAny(name, INORGANIC_CARBON_NAME_PATTERNS)) return true;
    if (isLikelyCyanideFormula(normalized)) return true;
    if (isFormulaExactly(normalized, ['CO', 'CO2', 'H2CO3'])) return true;

    const nonCarbonOxygenHydrogenElements = elementNames.filter(element => !['C', 'O', 'H'].includes(element));
    const isCarbonateLike = elements.C === 1 &&
        (elements.O || 0) >= 3 &&
        nonCarbonOxygenHydrogenElements.length > 0 &&
        !elements.N &&
        !hasAnyElement(elements, HALOGENS) &&
        nonCarbonOxygenHydrogenElements.every(element =>
            (CARBONATE_COUNTERIONS as readonly string[]).includes(element)
        );
    if (isCarbonateLike) return true;

    const hasMetalCounterion = hasAnyElement(elements, CARBIDE_COUNTERIONS);
    const isCarbideLike = Boolean(elements.C) &&
        hasMetalCounterion &&
        !elements.H &&
        !elements.O &&
        !elements.N;
    return isCarbideLike;
};

export const isLikelyOrganicByFormula = (formula: string, name = ''): boolean => {
    const elements = parseFormula(formula);
    return Boolean(elements.C) && !isInorganicCarbonFormula(formula, name);
};

const HAZARD_PROFILE_VERSION = '1.0.0' as const;

/**
 * Detect every supported hazard independently from source evidence. Disposal
 * category precedence is intentionally absent from this function.
 */
export const detectChemicalHazards = (chemical: Chemical): ChemicalHazardProfile => {
    const name = chemical.name || '';
    const formula = chemical.molecularFormula || '';
    const casNumber = chemical.casNumber?.trim() ?? '';
    const elements = parseFormula(formula);
    const hCodes = extractHCodes(chemical.ghs?.hazardStatements);
    const flags = new Set<WasteHazardFlag>();
    const evidence: ChemicalHazardEvidence[] = [];
    const evidenceKeys = new Set<string>();

    const addEvidence = (
        flag: WasteHazardFlag,
        source: ChemicalHazardEvidence['source'],
        value: string,
        confidence: ChemicalHazardEvidence['confidence'],
    ): void => {
        flags.add(flag);
        const key = `${flag}:${source}:${value}`;
        if (evidenceKeys.has(key)) return;
        evidenceKeys.add(key);
        evidence.push({ flag, source, value, confidence });
    };

    for (const [flag, expectedCodes] of Object.entries(HAZARD_H_CODES) as Array<[
        keyof typeof HAZARD_H_CODES,
        readonly string[],
    ]>) {
        for (const code of hCodes.filter(candidate => expectedCodes.includes(candidate))) {
            addEvidence(flag, 'h_code', code, 'confirmed');
        }
    }

    for (const code of hCodes.filter(candidate => REACTIVE_H_CODES.has(candidate))) {
        addEvidence('REACTIVE', 'h_code', code, 'confirmed');
    }

    if (matchesAny(name, REACTIVE_NAME_PATTERNS)) {
        addEvidence('REACTIVE', 'name_pattern', name, 'inferred');
    }
    if (isFormulaExactly(formula, ['HNO3', 'HClO4', 'NaBH4', 'LiAlH4', 'NaH', 'KH', 'LiH', 'CaH2'])) {
        addEvidence('REACTIVE', 'formula_pattern', formula, 'confirmed');
    }

    if (matchesAny(name, CYANIDE_NAME_PATTERNS)) {
        addEvidence('CYANIDE', 'name_pattern', name, 'inferred');
    }
    if (isLikelyCyanideFormula(formula)) {
        addEvidence('CYANIDE', 'formula_pattern', formula, 'confirmed');
    }

    if (matchesAny(name, SULFIDE_NAME_PATTERNS)) {
        addEvidence('SULFIDE', 'name_pattern', name, 'inferred');
    }
    if (isLikelySulfideFormula(elements)) {
        addEvidence('SULFIDE', 'formula_pattern', formula, 'confirmed');
    }

    for (const element of HEAVY_METALS.filter(candidate => Boolean(elements[candidate]))) {
        addEvidence('HEAVY_METAL', 'formula_element', element, 'confirmed');
    }

    if (isHydrofluoricAcidIdentity(chemical)) {
        const [source, value] = casNumber === HYDROFLUORIC_ACID_CAS
            ? ['cas_registry', casNumber] as const
            : normalizedFormula(formula).toUpperCase() === 'HF'
                ? ['formula_pattern', formula] as const
                : ['name_pattern', name] as const;
        addEvidence(
            'HYDROFLUORIC_ACID',
            source,
            value,
            source === 'name_pattern' ? 'inferred' : 'confirmed',
        );
    } else if (isFluorideCompoundIdentity(chemical)) {
        const [source, value] = FLUORIDE_COMPOUND_CAS.has(casNumber)
            ? ['cas_registry', casNumber] as const
            : FLUORIDE_COMPOUND_FORMULAS.has(normalizedFormula(formula).toUpperCase())
                ? ['formula_pattern', formula] as const
                : ['name_pattern', name] as const;
        addEvidence(
            'FLUORIDE',
            source,
            value,
            source === 'name_pattern' ? 'inferred' : 'confirmed',
        );
    }

    return {
        version: HAZARD_PROFILE_VERSION,
        flags: [...flags],
        evidence,
    };
};

// Helper: Determine disposal category details
export const getCategoryDetails = (category: DisposalCategory): { binColor: string; label: string } => {
    switch (category) {
        case 'ACID':
            return { binColor: 'bg-red-500', label: 'label_acid' };
        case 'ALKALI':
            return { binColor: 'bg-blue-500', label: 'label_alkali' };
        case 'NEUTRAL':
            return { binColor: 'bg-green-500', label: 'label_neutral' };
        case 'ORGANIC_HALOGEN':
            return { binColor: 'bg-orange-600', label: 'label_organic_halogen' };
        case 'ORGANIC_NON_HALOGEN':
            return { binColor: 'bg-yellow-500', label: 'label_organic_non_halogen' };
        case 'HEAVY_METAL':
            return { binColor: 'bg-purple-600', label: 'label_heavy_metal' };
        case 'CYANIDE':
            return { binColor: 'bg-teal-600', label: 'label_cyanide' };
        case 'REACTIVE':
            return { binColor: 'bg-rose-600', label: 'label_reactive' };
        case 'SOLID_WASTE':
            return { binColor: 'bg-stone-500', label: 'label_solid_waste' };
        case 'SPECIAL_HAZARD':
            return { binColor: 'bg-red-800', label: 'label_special_hazard' };
        default:
            return { binColor: 'bg-gray-400', label: 'mix_label_unknown' };
    }
};

const buildResult = (
    chemical: Chemical,
    category: DisposalCategory,
    reason: string,
    reasonParams?: Record<string, string | number>,
    hazardProfile = detectChemicalHazards(chemical),
): AnalysisResult => {
    const { binColor, label } = getCategoryDetails(category);
    const hazardWarnings = buildHazardWarnings(extractHCodes(chemical.ghs?.hazardStatements), chemical);
    return {
        chemical,
        category,
        binColor,
        label,
        reason,
        reasonParams,
        isSafe: category !== 'UNKNOWN' && category !== 'SPECIAL_HAZARD',
        hazardWarnings: hazardWarnings.length > 0 ? hazardWarnings : undefined,
        hazardProfile,
    };
};

export const analyzeChemical = (chemical: Chemical): AnalysisResult => {
    // 0. P-List Check (Highest Priority)
    if (chemical.casNumber && pListCas.includes(chemical.casNumber)) {
        return buildResult(chemical, 'SPECIAL_HAZARD', 'reason_us_rcra_p_list_match');
    }

    const elements = parseFormula(chemical.molecularFormula || '');
    const formula = chemical.molecularFormula || '';
    const name = chemical.name || '';
    const hCodes = extractHCodes(chemical.ghs?.hazardStatements);
    const hasFatalAcuteToxicityHCode = hCodes.some(code => FATAL_ACUTE_TOXICITY_H_CODES.has(code));
    const hasHalogen = hasAnyElement(elements, HALOGENS);
    const isOrganic = isLikelyOrganicByFormula(formula, name);
    const hazardProfile = detectChemicalHazards(chemical);

    chemical.properties = {
        ...chemical.properties,
        isOrganic,
        isHalogenated: isOrganic && hasHalogen,
    };

    let category: DisposalCategory = 'UNKNOWN';
    let reason = '';

    const isReactive = hazardProfile.flags.includes('REACTIVE');
    const isCyanideOrSulfide = hazardProfile.flags.includes('CYANIDE') ||
        hazardProfile.flags.includes('SULFIDE');
    const hasHeavyMetal = hazardProfile.flags.includes('HEAVY_METAL');
    const isSolid = matchesAny(name, SOLID_NAME_PATTERNS);

    if (isReactive) {
        category = 'REACTIVE';
        reason = 'reason_reactive';
    } else if (isCyanideOrSulfide) {
        category = 'CYANIDE';
        reason = 'reason_cyanide';
    } else if (hasFatalAcuteToxicityHCode) {
        category = 'SPECIAL_HAZARD';
        reason = 'reason_fatal_acute_toxicity';
    } else if (hasHeavyMetal) {
        category = 'HEAVY_METAL';
        reason = 'reason_heavy_metal';
    } else if (isOrganic) {
        if (hasHalogen) {
            category = 'ORGANIC_HALOGEN';
            reason = 'reason_organic_halogen';
        } else {
            category = 'ORGANIC_NON_HALOGEN';
            reason = 'reason_organic_non_halogen';
        }
    } else {
        if (isAcidPhosphateSalt(name, formula, elements)) {
            category = 'ACID';
            reason = 'reason_acid_phosphate_salt';
        } else if (isAlkaliPhosphateSalt(name, formula, elements)) {
            category = 'ALKALI';
            reason = 'reason_alkali_phosphate_salt';
        } else if (matchesAny(name, ACID_NAME_PATTERNS)) {
            category = 'ACID';
            reason = 'reason_acid_keyword';
        } else if (matchesAny(name, ALKALI_NAME_PATTERNS)) {
            category = 'ALKALI';
            reason = 'reason_alkali_keyword';
        }
    }

    // Apply Solid fallback if category is unknown or if it specifically matches solid without being overridden by dangerous categories
    if (category === 'UNKNOWN' && isSolid) {
        category = 'SOLID_WASTE';
        reason = 'reason_solid_waste';
    }

    return buildResult(chemical, category, reason || 'reason_unknown', undefined, hazardProfile);
};
