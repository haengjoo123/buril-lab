import type { AnalysisHazardWarning, AnalysisResult, Chemical, DisposalCategory } from '../types';
import pListCas from '../data/p_list_cas.json';
import uListCas from '../data/u_list_cas.json';

type ElementCounts = Record<string, number>;

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
];

const SULFIDE_NAME_PATTERNS = [
    /\bsulfide\b/i,
    /\bsulphide\b/i,
    /\bhydrogen\s+sulfide\b/i,
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

const hydrateSeparators = /[.\u00b7\u2022]/g;

// Helper: Parse molecular formula into element counts
// e.g., "C6H12O6" -> { C: 6, H: 12, O: 6 }
export const parseFormula = (formula: string): ElementCounts => {
    const totals: ElementCounts = {};
    const normalized = formula.replace(/\s+/g, '').replace(hydrateSeparators, '.');

    const addElements = (target: ElementCounts, source: ElementCounts, multiplier = 1) => {
        for (const [element, count] of Object.entries(source)) {
            target[element] = (target[element] || 0) + count * multiplier;
        }
    };

    const readNumber = (segment: string, start: number): { value: number; next: number } => {
        let end = start;
        while (/\d/.test(segment[end] || '')) end++;
        return {
            value: end > start ? parseInt(segment.slice(start, end), 10) : 1,
            next: end,
        };
    };

    const parseSegment = (segment: string): ElementCounts => {
        const stack: ElementCounts[] = [{}];
        let index = 0;

        while (index < segment.length) {
            const char = segment[index];

            if (char === '(' || char === '[') {
                stack.push({});
                index++;
                continue;
            }

            if (char === ')' || char === ']') {
                const group = stack.pop() || {};
                const multiplier = readNumber(segment, index + 1);
                addElements(stack[stack.length - 1], group, multiplier.value);
                index = multiplier.next;
                continue;
            }

            if (/[A-Z]/.test(char)) {
                let end = index + 1;
                if (/[a-z]/.test(segment[end] || '')) end++;
                const element = segment.slice(index, end);
                const count = readNumber(segment, end);
                stack[stack.length - 1][element] = (stack[stack.length - 1][element] || 0) + count.value;
                index = count.next;
                continue;
            }

            index++;
        }

        return stack[0];
    };

    for (const rawPart of normalized.split('.')) {
        if (!rawPart) continue;
        const coefficient = rawPart.match(/^(\d+)(?=[A-Z([])/);
        const multiplier = coefficient ? parseInt(coefficient[1], 10) : 1;
        const part = coefficient ? rawPart.slice(coefficient[1].length) : rawPart;
        addElements(totals, parseSegment(part), multiplier);
    }

    return totals;
};

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
        isSafe: category !== 'UNKNOWN',
        hazardWarnings: hazardWarnings.length > 0 ? hazardWarnings : undefined,
    };
};

export const analyzeChemical = (chemical: Chemical): AnalysisResult => {
    // 0. P-List Check (Highest Priority)
    if (chemical.casNumber && pListCas.includes(chemical.casNumber)) {
        return buildResult(chemical, 'SPECIAL_HAZARD', 'reason_special_hazard');
    }

    const elements = parseFormula(chemical.molecularFormula || '');
    const formula = chemical.molecularFormula || '';
    const name = chemical.name || '';
    const hCodes = extractHCodes(chemical.ghs?.hazardStatements);
    const hasReactiveHCode = hCodes.some(code => REACTIVE_H_CODES.has(code));
    const hasFatalAcuteToxicityHCode = hCodes.some(code => FATAL_ACUTE_TOXICITY_H_CODES.has(code));
    const hasHalogen = hasAnyElement(elements, HALOGENS);
    const hasHeavyMetal = hasAnyElement(elements, HEAVY_METALS);
    const isOrganic = isLikelyOrganicByFormula(formula, name);

    chemical.properties = {
        ...chemical.properties,
        isOrganic,
        isHalogenated: isOrganic && hasHalogen,
    };

    let category: DisposalCategory = 'UNKNOWN';
    let reason = '';
    let reasonParams: Record<string, string | number> | undefined;

    const isReactive = hasReactiveHCode ||
        matchesAny(name, REACTIVE_NAME_PATTERNS) ||
        isFormulaExactly(formula, ['HNO3', 'HClO4', 'NaBH4', 'LiAlH4', 'NaH', 'KH', 'LiH', 'CaH2']);
    const isCyanideOrSulfide = matchesAny(name, CYANIDE_NAME_PATTERNS) ||
        matchesAny(name, SULFIDE_NAME_PATTERNS) ||
        isLikelyCyanideFormula(formula) ||
        isLikelySulfideFormula(elements);
    const isSolid = matchesAny(name, SOLID_NAME_PATTERNS);

    if (isReactive) {
        category = 'REACTIVE';
        reason = 'reason_reactive';
    } else if (isCyanideOrSulfide) {
        category = 'CYANIDE';
        reason = 'reason_cyanide';
    } else if (hasFatalAcuteToxicityHCode) {
        category = 'SPECIAL_HAZARD';
        reason = 'reason_special_hazard';
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
        if (chemical.properties?.ph !== undefined) {
            if (chemical.properties.ph < 7) {
                category = 'ACID';
                reason = 'reason_acid_ph';
                reasonParams = { ph: chemical.properties.ph };
            } else if (chemical.properties.ph > 7) {
                category = 'ALKALI';
                reason = 'reason_alkali_ph';
                reasonParams = { ph: chemical.properties.ph };
            } else {
                category = 'NEUTRAL';
                reason = 'reason_neutral_ph';
                reasonParams = { ph: chemical.properties.ph };
            }
        }

        if (category === 'UNKNOWN') {
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
    }

    // Apply Solid fallback if category is unknown or if it specifically matches solid without being overridden by dangerous categories
    if (category === 'UNKNOWN' && isSolid) {
        category = 'SOLID_WASTE';
        reason = 'reason_solid_waste';
    }

    return buildResult(chemical, category, reason || 'reason_unknown', reasonParams);
};
