import type {
    AnalysisHazardWarning,
    AnalysisResult,
    Chemical,
    ChemicalHazardEvidence,
    ChemicalHazardProfile,
    ChemicalMaterialProfile,
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
const INORGANIC_SALT_CATIONS = [
    ...ALKALI_METALS,
    'Mg', 'Ca', 'Sr', 'Ba', 'Al', 'Fe', 'Ga', 'In', 'Tl', 'Zr', 'Hf',
    'La', 'Ce', 'Y', 'Sc',
] as const;
const INORGANIC_SALT_ANION_ELEMENTS = ['Cl', 'Br', 'I', 'N', 'S', 'P', 'Si'] as const;

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

/**
 * analyze_waste_batch_v2 re-derives REACTIVE from these same patterns, so a
 * change here needs the same change in the server function.
 */
const REACTIVE_NAME_PATTERNS = [
    // No leading boundary: organic peroxides are named "...diperoxide" or
    // "tert-butylperoxy..." and the domestic SDS often omits H242.
    /peroxide\b/i,
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
    /peroxy/i,
    /\bazide\b/i,
    /\bdiazomethane\b/i,
    // Alkyl and aryl hydrazines ("1,2-dimethylhydrazine") are strong
    // reducers like hydrazine itself; hydrazides and hydrazones do not match.
    /hydrazine\b/i,
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
    /\blithium\s+hexamethyldisilazide\b/i,
    /\bLDA\b/i,
    /\b(?:n-|sec-|tert-|t-)?butyllithium\b/i,
    /\b(?:methyl|ethyl|propyl|isopropyl|phenyl|vinyl|allyl|benzyl)\s*-?\s*lithium\b/i,
    /\borganolithium\b/i,
    /\b(?:methyl|ethyl|phenyl|vinyl|allyl|isopropyl|tert-butyl|benzyl)magnesium\s+(?:bromide|chloride|iodide)\b/i,
    /\bDIBAL-?H\b/i,
    /\bdiisobutylalum(?:in)?ium\s+hydride\b/i,
    /\bsodium\s+naphthalenide\b/i,
    /\bpotassium\s+graphite\b/i,
    /\btriethylalum(?:in)?ium\b/i,
    /\bdiethylzinc\b/i,
    /\b(?:oxalyl|acetyl|benzoyl)\s+chloride\b/i,
    /\bthionyl\s+chloride\b/i,
    /\bphosphorus\s+trichloride\b/i,
    /\bsulfuryl\s+chloride\b/i,
    /\btitanium\s+tetrachloride\b/i,
    /\bsodium\s+metal\b/i,
    /\bpotassium\s+metal\b/i,
];

/**
 * A name-only match is intentionally weaker than an SDS H-code or formula
 * match. Supplier aliases can describe a stable oxide using an obsolete
 * "peroxide" synonym, and enzymes can include "superoxide" in their
 * biological function. Neither wording alone establishes a reactive waste.
 */
const REACTIVE_NAME_FALSE_POSITIVE_CONTEXTS = [
    /\b(?:superoxide\s+dismutase|dismutase\s*,?\s*superoxide)\b/i,
    /\b(?:peroxide|superoxide)\b[\s\S]*\boxide\b|\boxide\b[\s\S]*\b(?:peroxide|superoxide)\b/i,
    /(?:과산화물|수퍼옥사이드|슈퍼옥사이드)[\s\S]*(?:산화물|산화\s*[가-힣]+)|(?:산화물|산화\s*[가-힣]+)[\s\S]*(?:과산화물|수퍼옥사이드|슈퍼옥사이드)/i,
];

const NITROPRUSSIDE_NAME_PATTERN = /nitroprusside|nitroferricyanide|니트로프루시드|나이트로프루시드|나이트로프루씨드/i;

const CYANIDE_NAME_PATTERNS = [
    /\bcyanide\b/i,
    /\bcyanid\b/i,
    /\b(?:di|tri|tetra|hexa)cyanide\b/i,
    /\bcyanogen\b/i,
    /\bferricyanide\b/i,
    /\bferrocyanide\b/i,
    /\bthiocyanate\b/i,
    NITROPRUSSIDE_NAME_PATTERN,
    /시안화|시안|청산|시아니드|시아나이드|사이안화/i,
];

/**
 * Inorganic cyanides identified by CAS. Ammonium cyanide (CH4N2) looks organic
 * by formula and zinc cyanide is often listed without one; both are still
 * cyanide salts. The server keeps the same list in analyze_waste_batch_v2.
 */
export const INORGANIC_CYANIDE_CAS: ReadonlySet<string> = new Set([
    '143-33-9', // sodium cyanide
    '151-50-8', // potassium cyanide
    '592-01-8', // calcium cyanide
    '12211-52-8', // ammonium cyanide
    '557-21-1', // zinc cyanide
    '14402-89-2', // sodium nitroprusside
    '13755-38-9', // sodium nitroprusside dihydrate
]);
const HYDROGEN_CYANIDE_CAS = '74-90-8';
const AMMONIUM_CYANIDE_NAME_PATTERN = /\bammonium\s+cyanide\b|시안화\s*암모늄/i;

/**
 * Iron hexacyanide complexes (ferro-/ferricyanide, Prussian blue) and
 * thiocyanates are stable near neutral pH, so their waste is not required to
 * be alkaline. Nitroprusside releases cyanide readily and is not exempt.
 */
const STABLE_CYANIDE_NAME_PATTERN = /ferrocyan|ferricyan|hexacyanofer|prussian|페로시안|페리시안|시안화제[12]철|사이아노페레이트|thiocyan|티오시아/i;

/** A cyanide that can release HCN, so its aqueous waste must be kept at pH 10 or higher. */
export const requiresAlkalineCyanideWaste = (name: string | undefined): boolean => {
    const value = name ?? '';
    return NITROPRUSSIDE_NAME_PATTERN.test(value) || !STABLE_CYANIDE_NAME_PATTERN.test(value);
};

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
];

/**
 * Keep ordinary organic acids out of automatic acid routing, but use a
 * confirmed corrosivity statement plus an acid identity in incompatibility
 * checks. Otherwise a corrosive acid that happens to be organic can be mixed
 * with cyanide or sulfide without the acid-pair danger rule firing.
 */
const CORROSIVE_ACID_NAME_PATTERN = /\bacid\b|산\s*$/i;

export const isCorrosiveAcidByNameAndHCodes = (
    name: string | undefined,
    hCodes: readonly string[],
): boolean => (
    hCodes.includes('H314') && CORROSIVE_ACID_NAME_PATTERN.test(name || '')
);

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

    if (chemical?.casNumber && pListCas.includes(chemical.casNumber)) {
        warnings.push({
            code: 'p_list_advisory',
            hCodes: [],
            labelKey: 'hazard_warning_p_list_advisory',
            descriptionKey: 'hazard_warning_p_list_advisory_desc',
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

const ORGANIC_CATION_THIOCYANATE_NAME_PATTERNS = [
    /\b(?:guanidin(?:e|ium)|[a-z]*ammonium|pyridin(?:e|ium)|[a-z]*imidazolium|[a-z]*phosphonium|[a-z]*pyrrolidinium)\s+thiocyanate\b/i,
    /(?:구아니딘|과니딘|구아니디늄|암모늄|피리디늄|이미다졸륨)\s*티오시아네이트|티오시안산\s*(?:구아니딘|과니딘|암모늄)/,
];
const THIOCYANATE_SMILES_FRAGMENTS = new Set([
    'SC#N', 'N#CS', 'C(#N)S', '[S-]C#N', 'N#C[S-]', 'C(#N)[S-]', '[SH]C#N',
]);

const hasDisconnectedThiocyanateFragment = (connectivitySmiles = ''): boolean => {
    const fragments = connectivitySmiles.split('.').map(fragment => fragment.trim()).filter(Boolean);
    return fragments.length >= 2 && fragments.some(fragment => THIOCYANATE_SMILES_FRAGMENTS.has(fragment));
};

/**
 * A thiocyanate salt of an organic cation. The SCN- anion is identified by
 * a disconnected PubChem fragment or by "<cation> thiocyanate" salt naming;
 * ester names such as "methyl thiocyanate" are covalent and not matched.
 */
const isOrganicCationThiocyanateSalt = (chemical: Chemical, elements: ElementCounts): boolean => (
    Boolean(elements.S && elements.N && elements.C) && (
        hasDisconnectedThiocyanateFragment(chemical.connectivitySmiles) ||
        matchesAny(chemical.name || '', ORGANIC_CATION_THIOCYANATE_NAME_PATTERNS)
    )
);

const isLikelySulfideFormula = (elements: ElementCounts): boolean => {
    const sulfideCounterions = ['H', 'Li', 'Na', 'K', 'Mg', 'Ca', 'Ba', 'Fe', 'Zn', 'Cd', 'Pb', 'Hg', 'Cu', 'Sn'];
    return Boolean(elements.S) &&
        !elements.O &&
        !elements.C &&
        hasAnyElement(elements, sulfideCounterions);
};

const isCyanogenHalideFormula = (elements: ElementCounts): boolean => (
    elements.C === 1 && elements.N === 1 && !elements.H &&
    hasAnyElement(elements, HALOGENS)
);

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

/** Hydrogen cyanide is cyanide, but a volatile toxic gas is never a container waste. */
export const isHydrogenCyanide = (chemical: Pick<Chemical, 'casNumber' | 'molecularFormula'>): boolean =>
    chemical.casNumber?.trim() === HYDROGEN_CYANIDE_CAS ||
    isFormulaExactly(chemical.molecularFormula ?? '', ['HCN', 'CHN']);

const INORGANIC_ACID_FORMULAS = [
    'HCL', 'HBR', 'HI', 'HF', 'H2SO4', 'HNO3', 'H3PO4', 'HCLO4',
] as const;

/**
 * A supplier SDS often lists a salt as an alias such as "sulfuric acid,
 * cesium salt".  That text does not make the salt an acid for routing.
 * Keep genuine acid-salt identities (for example sodium bisulfate) explicit
 * instead of treating every occurrence of an acid name as the free acid.
 */
const isExplicitAcidSulfateSalt = (name: string, formula: string): boolean => (
    /\b(?:bi)?sulfate\b|\bhydrogen\s+sulfate\b/i.test(name) &&
    isFormulaExactly(formula, ['NaHSO4', 'HNaO4S', 'KHSO4', 'HKSO4'])
);

const isInorganicAcidSalt = (elements: ElementCounts): boolean => (
    hasAnyElement(elements, INORGANIC_SALT_CATIONS)
);

/**
 * Quaternary ammonium/phosphonium hydroxides are genuine bases despite
 * containing carbon.  "Inner salt" names are deliberately excluded: their
 * hydroxide wording is nomenclature, not a free hydroxide counter-ion.
 */
const isExplicitOrganicHydroxideBase = (name: string): boolean => (
    !/\binner\s+salt\b/i.test(name) &&
    /\b(?:[a-z-]+(?:ammonium|phosphonium)|cetrimonium)\s+hydroxide\b/i.test(name)
);

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

const smilesFragmentHasCarbon = (fragment: string): boolean =>
    /c|C(?![a-z])/.test(fragment);

const smilesFragmentHasPositiveCharge = (fragment: string): boolean =>
    /\[[^\]]*\+\d*[^\]]*\]/.test(fragment);

const smilesFragmentHasNegativeCharge = (fragment: string): boolean =>
    /\[[^\]]*-\d*[^\]]*\]/.test(fragment);

/**
 * PubChem ConnectivitySMILES retains disconnected counter-ions. Requiring
 * separate positive and negative fragments avoids treating covalent
 * organometallic reagents (for example C[Li]) as ordinary salts.
 */
export const isIonicOrganicSaltByStructure = (connectivitySmiles = ''): boolean => {
    const fragments = connectivitySmiles
        .split('.')
        .map(fragment => fragment.trim())
        .filter(Boolean);
    if (fragments.length < 2) return false;

    const positiveFragments = fragments.filter(smilesFragmentHasPositiveCharge);
    const negativeFragments = fragments.filter(smilesFragmentHasNegativeCharge);
    if (positiveFragments.length === 0 || negativeFragments.length === 0) return false;

    return [...positiveFragments, ...negativeFragments].some(smilesFragmentHasCarbon);
};

const HYDROHALIDE_SALT_NAME_PATTERN = /\b(mono|di|tri|tetra)?hydro(chloride|bromide|iodide)\b/gi;
const KOREAN_HYDROHALIDE_SALT_NAME_PATTERN = /(이|삼)?(염산|브로민화수소산|브롬화수소산|아이오딘화수소산|요오드화수소산)염/g;
const HYDROHALIDE_MULTIPLIERS: Record<string, number> = {
    mono: 1, di: 2, tri: 3, tetra: 4, 이: 2, 삼: 3,
};
const HYDROHALIDE_HALOGENS: Record<string, 'Cl' | 'Br' | 'I'> = {
    chloride: 'Cl', bromide: 'Br', iodide: 'I',
    염산: 'Cl', 브로민화수소산: 'Br', 브롬화수소산: 'Br', 아이오딘화수소산: 'I', 요오드화수소산: 'I',
};

/**
 * Halide equivalents a name declares as hydrohalide counter-ions. A KOSHA
 * name repeats the identity in Korean and English, so the largest count per
 * halogen is used rather than a sum.
 */
const getNamedHydrohalideCounterions = (name: string): Partial<Record<'Cl' | 'Br' | 'I', number>> => {
    const counts: Partial<Record<'Cl' | 'Br' | 'I', number>> = {};
    for (const pattern of [HYDROHALIDE_SALT_NAME_PATTERN, KOREAN_HYDROHALIDE_SALT_NAME_PATTERN]) {
        for (const [, prefix, acid] of name.matchAll(pattern)) {
            const halogen = HYDROHALIDE_HALOGENS[acid.toLowerCase()];
            const count = HYDROHALIDE_MULTIPLIERS[prefix?.toLowerCase() ?? 'mono'] ?? 1;
            counts[halogen] = Math.max(counts[halogen] ?? 0, count);
        }
    }
    return counts;
};

/**
 * Amine hydrohalide salts such as Tris-HCl or guanidine hydrochloride carry
 * their halogen as a chloride/bromide/iodide counter-ion, not as a
 * carbon-halogen bond. The name must declare exactly every halogen atom in
 * the formula; any extra halogen (for example 2-chloroethylamine
 * hydrochloride) or a missing nitrogen base keeps the organic-halogen route.
 */
export const isOrganicBaseHydrohalideSalt = (chemical: Chemical): boolean => {
    const formula = chemical.molecularFormula || '';
    const name = chemical.name || '';
    const elements = parseFormula(formula);
    if (!elements.N || !isLikelyOrganicByFormula(formula, name)) return false;
    const counterions = getNamedHydrohalideCounterions(name);
    if (Object.keys(counterions).length === 0) return false;
    return HALOGENS.every(halogen => (elements[halogen] || 0) === ((counterions as Record<string, number>)[halogen] || 0));
};

/**
 * This is deliberately narrower than "not organic". It recognizes an ionic
 * inorganic salt only when the formula contains a counter-ion and a familiar
 * non-fluoride inorganic anion. Oxides, elemental materials and incomplete
 * formulae remain unresolved instead of being silently sent to aqueous waste.
 */
const isConfirmedInorganicSalt = (elements: ElementCounts): boolean => (
    !elements.C &&
    !elements.F &&
    hasAnyElement(elements, INORGANIC_SALT_CATIONS) &&
    hasAnyElement(elements, INORGANIC_SALT_ANION_ELEMENTS)
);

/**
 * Ammonium is an ionic counterion, but it cannot be discovered from the
 * element list alone because every ammonium salt is composed only of N/H and
 * its anion. Require both an explicit ammonium identity and a familiar
 * inorganic anion; hydroxide, fluoride and reactive salts have already won
 * precedence before this fallback is reached.
 */
const isConfirmedAmmoniumSalt = (name: string, elements: ElementCounts): boolean => (
    !elements.C &&
    !elements.F &&
    Boolean(elements.N && elements.H) &&
    /ammonium|암모늄/i.test(name) &&
    !/\b(?:hydrogen\s+(?:sulfate|sulphate|phosphate|carbonate)|bi(?:sulfate|sulphate|phosphate|carbonate))\b|(?:중|수소)\s*(?:황산|인산|탄산)/i.test(name) &&
    hasAnyElement(elements, INORGANIC_SALT_ANION_ELEMENTS)
);

const isPossibleIonicOrganicMaterial = (
    chemical: Chemical,
    elements: ElementCounts,
): boolean => (
    !chemical.connectivitySmiles &&
    Boolean(elements.C) &&
    !isInorganicCarbonFormula(chemical.molecularFormula || '', chemical.name || '') &&
    hasAnyElement(elements, [...INORGANIC_SALT_CATIONS, ...HEAVY_METALS])
);

/** Material identity is descriptive evidence, never a final waste-stream decision. */
export const detectChemicalMaterial = (chemical: Chemical): ChemicalMaterialProfile => {
    const formula = chemical.molecularFormula || '';
    const name = chemical.name || '';
    const elements = parseFormula(formula);

    // Carbonate, bicarbonate and cyanide ions contain carbon but are not
    // organic ions. Without this guard PubChem's "C(=O)([O-])[O-].[Na+]..."
    // turned sodium carbonate into a neutral organic salt and dropped its
    // alkali identity.
    if (!isInorganicCarbonFormula(formula, name) &&
        isIonicOrganicSaltByStructure(chemical.connectivitySmiles)) {
        return {
            kind: 'ionic_organic_salt',
            evidence: 'connectivity_smiles',
            requiresMatrixConfirmation: true,
        };
    }
    if (isOrganicBaseHydrohalideSalt(chemical)) {
        return {
            kind: 'ionic_organic_salt',
            evidence: 'hydrohalide_name',
            requiresMatrixConfirmation: true,
        };
    }
    if (isInorganicCarbonFormula(formula, name) &&
        hasAnyElement(elements, [...INORGANIC_SALT_CATIONS, ...HEAVY_METALS])) {
        return {
            kind: 'inorganic_salt',
            evidence: 'formula',
            requiresMatrixConfirmation: true,
        };
    }
    if (isPossibleIonicOrganicMaterial(chemical, elements)) {
        return {
            kind: 'possible_ionic_organic_material',
            evidence: 'formula',
            requiresMatrixConfirmation: true,
        };
    }
    if (isConfirmedInorganicSalt(elements) || isConfirmedAmmoniumSalt(name, elements)) {
        return {
            kind: 'inorganic_salt',
            evidence: 'formula',
            requiresMatrixConfirmation: true,
        };
    }
    if (isLikelyOrganicByFormula(formula, name)) {
        return {
            kind: 'organic_compound',
            evidence: 'formula',
            requiresMatrixConfirmation: true,
        };
    }
    return {
        kind: 'unresolved',
        evidence: 'unresolved',
        requiresMatrixConfirmation: true,
    };
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
    const isOrganic = isLikelyOrganicByFormula(formula, name);
    const hasMetalCounterion = hasAnyElement(elements, [
        ...INORGANIC_SALT_CATIONS,
        ...HEAVY_METALS,
    ]);
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

    if (matchesAny(name, REACTIVE_NAME_PATTERNS) &&
        !matchesAny(name, REACTIVE_NAME_FALSE_POSITIVE_CONTEXTS)) {
        addEvidence('REACTIVE', 'name_pattern', name, 'inferred');
    }
    if (isFormulaExactly(formula, ['HNO3', 'HClO4', 'NaBH4', 'LiAlH4', 'NaH', 'KH', 'LiH', 'CaH2'])) {
        addEvidence('REACTIVE', 'formula_pattern', formula, 'confirmed');
    }

    // "Vinyl cyanide" and other nitrile synonyms are organic molecules, not
    // inorganic cyanide waste.  The same distinction prevents thioethers
    // such as dimethyl sulfide from being routed to a sulfide stream.
    if ((!isOrganic || hasMetalCounterion || isCyanogenHalideFormula(elements)) &&
        matchesAny(name, CYANIDE_NAME_PATTERNS)) {
        addEvidence('CYANIDE', 'name_pattern', name, 'inferred');
    }
    if ((!isOrganic || hasMetalCounterion || isCyanogenHalideFormula(elements)) &&
        isLikelyCyanideFormula(formula)) {
        addEvidence('CYANIDE', 'formula_pattern', formula, 'confirmed');
    }
    // Guanidinium thiocyanate (RNA lysis buffers) has an organic cation but a
    // free SCN- anion: it gives HCN/cyanogen chloride with acid or bleach,
    // exactly like sodium thiocyanate. Covalent R-SCN esters stay excluded.
    if (!hasMetalCounterion && isOrganicCationThiocyanateSalt(chemical, elements)) {
        const [source, value] = hasDisconnectedThiocyanateFragment(chemical.connectivitySmiles)
            ? ['formula_pattern', chemical.connectivitySmiles ?? ''] as const
            : ['name_pattern', name] as const;
        addEvidence('CYANIDE', source, value, source === 'formula_pattern' ? 'confirmed' : 'inferred');
    }
    if (INORGANIC_CYANIDE_CAS.has(casNumber) || casNumber === HYDROGEN_CYANIDE_CAS) {
        addEvidence('CYANIDE', 'cas_registry', casNumber, 'confirmed');
    }
    if (isHydrogenCyanide(chemical)) {
        addEvidence('CYANIDE', 'formula_pattern', formula || casNumber, 'confirmed');
    }
    if (AMMONIUM_CYANIDE_NAME_PATTERN.test(name)) {
        addEvidence('CYANIDE', 'name_pattern', name, 'inferred');
    }

    if (!isOrganic && matchesAny(name, SULFIDE_NAME_PATTERNS)) {
        addEvidence('SULFIDE', 'name_pattern', name, 'inferred');
    }
    if (!isOrganic && isLikelySulfideFormula(elements)) {
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
    const { binColor, label: categoryLabel } = getCategoryDetails(category);
    const hazardWarnings = buildHazardWarnings(extractHCodes(chemical.ghs?.hazardStatements), chemical);
    const materialProfile = detectChemicalMaterial(chemical);
    const label = category === 'NEUTRAL' && materialProfile.kind === 'ionic_organic_salt'
        ? 'label_ionic_organic_salt'
        : category === 'UNKNOWN' && materialProfile.kind === 'possible_ionic_organic_material'
            ? 'label_possible_ionic_material'
            : categoryLabel;
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
        materialProfile,
    };
};

export interface AnalyzeChemicalOptions {
    /**
     * Classify as if the fatal acute-toxicity precedence did not exist. Used
     * only to route a solution already proven to be below the substance's
     * legal concentration threshold; every other precedence still applies.
     */
    ignoreFatalAcuteToxicity?: boolean;
}

export const analyzeChemical = (chemical: Chemical, options: AnalyzeChemicalOptions = {}): AnalysisResult => {
    const elements = parseFormula(chemical.molecularFormula || '');
    const formula = chemical.molecularFormula || '';
    const name = chemical.name || '';

    // A reaction-product UVCB cannot be treated as a single known chemical
    // merely because one constituent name happens to contain "acid" or
    // "hydroxide".  Preserve it as unresolved until its composition is
    // confirmed in the waste batch.
    if (/\breaction\s+products?\b/i.test(name)) {
        return buildResult(chemical, 'UNKNOWN', 'reason_complex_reaction_product');
    }
    const hCodes = extractHCodes(chemical.ghs?.hazardStatements);
    const hasFatalAcuteToxicityHCode = !options.ignoreFatalAcuteToxicity &&
        hCodes.some(code => FATAL_ACUTE_TOXICITY_H_CODES.has(code));
    // A hydrohalide counter-ion is ionic chloride, not an organic halogen.
    const hasHalogen = hasAnyElement(elements, HALOGENS) && !isOrganicBaseHydrohalideSalt(chemical);
    const isOrganic = isLikelyOrganicByFormula(formula, name);
    const hazardProfile = detectChemicalHazards(chemical);
    const materialProfile = detectChemicalMaterial(chemical);

    chemical.properties = {
        ...chemical.properties,
        isOrganic,
        isHalogenated: isOrganic && hasHalogen,
    };

    let category: DisposalCategory = 'UNKNOWN';
    let reason = '';

    const isReactive = hazardProfile.flags.includes('REACTIVE');
    const hasCyanide = hazardProfile.flags.includes('CYANIDE');
    const hasSulfide = hazardProfile.flags.includes('SULFIDE');
    const hasHeavyMetal = hazardProfile.flags.includes('HEAVY_METAL');
    const isSolid = matchesAny(name, SOLID_NAME_PATTERNS);

    if (isReactive) {
        category = 'REACTIVE';
        reason = 'reason_reactive';
    } else if (hasCyanide && isHydrogenCyanide(chemical)) {
        category = 'SPECIAL_HAZARD';
        reason = 'reason_hydrogen_cyanide';
    } else if (hasCyanide) {
        category = 'CYANIDE';
        reason = 'reason_cyanide';
    } else if (hasFatalAcuteToxicityHCode) {
        category = 'SPECIAL_HAZARD';
        reason = 'reason_fatal_acute_toxicity';
    } else if (hasHeavyMetal) {
        category = 'HEAVY_METAL';
        reason = 'reason_heavy_metal';
    } else if (hasSulfide) {
        category = 'CYANIDE';
        reason = 'reason_cyanide';
    } else if (isCorrosiveAcidByNameAndHCodes(name, hCodes)) {
        // A confirmed corrosive acid remains an acid even when its formula is
        // organic. The batch matrix, not this category, decides whether the
        // final waste is aqueous or an organic solvent stream.
        category = 'ACID';
        reason = 'reason_corrosive_acid_identity';
    } else if (isExplicitOrganicHydroxideBase(name)) {
        category = 'ALKALI';
        reason = 'reason_alkali_keyword';
    } else if (materialProfile.kind === 'ionic_organic_salt') {
        // An organic ion is not evidence of an organic solvent phase. Keep the
        // legacy category server-compatible while the material profile and the
        // batch matrix carry the authoritative distinction.
        category = 'NEUTRAL';
        reason = 'reason_ionic_organic_salt_matrix_required';
    } else if (materialProfile.kind === 'possible_ionic_organic_material') {
        category = 'UNKNOWN';
        reason = 'reason_possible_ionic_material_review';
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
        } else if (isFormulaExactly(formula, INORGANIC_ACID_FORMULAS) ||
            isExplicitAcidSulfateSalt(name, formula)) {
            category = 'ACID';
            reason = isExplicitAcidSulfateSalt(name, formula)
                ? 'reason_acid_keyword'
                : 'reason_acid_formula';
        } else if (matchesAny(name, ACID_NAME_PATTERNS) && !isInorganicAcidSalt(elements)) {
            category = 'ACID';
            reason = 'reason_acid_keyword';
        } else if (matchesAny(name, ALKALI_NAME_PATTERNS)) {
            category = 'ALKALI';
            reason = 'reason_alkali_keyword';
        } else if (isConfirmedInorganicSalt(elements) || isConfirmedAmmoniumSalt(name, elements)) {
            // More hazardous families have already won by precedence above:
            // reactive, cyanide/sulfide, fatal toxicity, and heavy metal.
            category = 'NEUTRAL';
            reason = 'reason_neutral_inorganic_salt';
        }
    }

    // Apply Solid fallback if category is unknown or if it specifically matches solid without being overridden by dangerous categories
    if (category === 'UNKNOWN' && isSolid &&
        materialProfile.kind !== 'possible_ionic_organic_material') {
        category = 'SOLID_WASTE';
        reason = 'reason_solid_waste';
    }

    return buildResult(chemical, category, reason || 'reason_unknown', undefined, hazardProfile);
};
