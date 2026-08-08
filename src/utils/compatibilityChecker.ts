import type { CartItem, DisposalCategory, WasteMatrix } from '../types';
import { isCorrosiveAcidByNameAndHCodes } from './chemicalAnalyzer';

export type Severity = 'DANGER' | 'WARNING';

export interface CompatibilityWarning {
    severity: Severity;
    ruleId: string;
    chemicalA: string;
    chemicalB: string;
    messageKey: string;
}

type HazardGroup =
    | 'OXIDIZER'
    | 'FLAMMABLE'
    | 'WATER_REACTIVE'
    | 'SELF_REACTIVE'
    | 'PYROPHORIC'
    | 'CORROSIVE'
    | 'EXPLOSIVE';

const HAZARD_GROUP_CODES: Record<HazardGroup, readonly string[]> = {
    OXIDIZER: ['H270', 'H271', 'H272'],
    FLAMMABLE: ['H220', 'H221', 'H222', 'H223', 'H224', 'H225', 'H226', 'H227', 'H228'],
    WATER_REACTIVE: ['H260', 'H261'],
    SELF_REACTIVE: ['H240', 'H241', 'H242'],
    PYROPHORIC: ['H250'],
    CORROSIVE: ['H314'],
    EXPLOSIVE: ['H200', 'H201', 'H202', 'H203', 'H204', 'H205'],
};

interface ChemEntry {
    name: string;
    formula: string;
    category: DisposalCategory;
    hCodes: string[];
    isOrganic: boolean;
    isAqueous: boolean;
    referencePh?: number;
    isCyanide: boolean;
    isSulfide: boolean;
    isReactiveMetal: boolean;
}

type Rule = (a: ChemEntry, b: ChemEntry) => CompatibilityWarning | null;

const extractHCodes = (statements: string[]): string[] => {
    const codes = statements.flatMap((statement) =>
        statement.toUpperCase().match(/H\d{3}/g) ?? []
    );
    return [...new Set(codes)];
};

const hasGroup = (hCodes: string[], group: HazardGroup): boolean =>
    hCodes.some((code) => HAZARD_GROUP_CODES[group].includes(code));

const CYANIDE_NAME_PATTERN = /\bcyanide\b|\bcyanid\b|시안화|시안|청산/i;
const CYANIDE_FORMULA_PATTERN = /^(?:HCN|NACN|KCN|LICN|CA\(CN\)2)$/i;
const SULFIDE_NAME_PATTERN = /\bsulfide\b|\bsulphide\b|황화/i;
const SULFIDE_FORMULA_PATTERN = /^(?:NA2S|K2S|FES|H2S)$/i;

const REACTIVE_METAL_FORMULAS = new Set(['NA', 'K', 'LI', 'CA', 'MG', 'ZN', 'FE', 'AL']);
const REACTIVE_METAL_NAMES = [
    'sodium',
    'potassium',
    'lithium',
    'calcium',
    'magnesium',
    'zinc',
    'iron',
    'aluminum',
    'aluminium',
];
const REACTIVE_METAL_KOREAN_NAMES = [
    '나트륨', '칼륨', '리튬', '칼슘', '마그네슘', '아연', '철', '알루미늄',
];

/** Match an elemental metal, not any compound whose name happens to contain it. */
const isReactiveElementalMetal = (name: string, formula: string): boolean => {
    const normalizedFormula = formula
        .replace(/\((?:s|l|g|aq)\)/gi, '')
        .replace(/\s+/g, '')
        .toUpperCase();

    if (REACTIVE_METAL_FORMULAS.has(normalizedFormula)) return true;

    const normalizedName = name.trim().toLowerCase();
    const englishMatch = REACTIVE_METAL_NAMES.some((metal) =>
        normalizedName === metal ||
        normalizedName === `${metal} metal` ||
        normalizedName === `metallic ${metal}` ||
        normalizedName.startsWith(`${metal} metal `) ||
        normalizedName.startsWith(`${metal} powder`) ||
        normalizedName.startsWith(`${metal} granule`)
    );
    if (englishMatch) return true;

    return REACTIVE_METAL_KOREAN_NAMES.some((metal) =>
        normalizedName === metal ||
        normalizedName === `${metal} 금속` ||
        normalizedName.startsWith(`${metal} 금속 `) ||
        normalizedName.startsWith(`${metal} 분말`) ||
        normalizedName.startsWith(`금속 ${metal}`)
    );
};

const isAcidic = (entry: ChemEntry): boolean =>
    entry.category === 'ACID' ||
    isCorrosiveAcidByNameAndHCodes(entry.name, entry.hCodes) ||
    (entry.referencePh !== undefined && entry.referencePh < 4) ||
    (hasGroup(entry.hCodes, 'CORROSIVE') && entry.referencePh !== undefined && entry.referencePh < 7);

const isBasic = (entry: ChemEntry): boolean =>
    entry.category === 'ALKALI' || (entry.referencePh !== undefined && entry.referencePh > 10);

const warning = (
    severity: Severity,
    ruleId: string,
    messageKey: string,
    a: ChemEntry,
    b: ChemEntry,
): CompatibilityWarning => ({
    severity,
    ruleId,
    chemicalA: a.name,
    chemicalB: b.name,
    messageKey,
});

const rules: Rule[] = [
    (a, b) => hasGroup(a.hCodes, 'OXIDIZER') && hasGroup(b.hCodes, 'FLAMMABLE')
        ? warning('DANGER', 'oxidizer_flammable', 'compat_oxidizer_flammable', a, b)
        : null,
    (a, b) => hasGroup(a.hCodes, 'OXIDIZER') && b.isOrganic && !hasGroup(b.hCodes, 'FLAMMABLE')
        ? warning('WARNING', 'oxidizer_organic', 'compat_oxidizer_organic', a, b)
        : null,
    (a, b) => hasGroup(a.hCodes, 'WATER_REACTIVE') && b.isAqueous
        ? warning('DANGER', 'water_reactive', 'compat_water_reactive', a, b)
        : null,
    (a, b) => hasGroup(a.hCodes, 'PYROPHORIC')
        ? warning('DANGER', 'pyrophoric', 'compat_pyrophoric', a, b)
        : null,
    (a, b) => hasGroup(a.hCodes, 'SELF_REACTIVE')
        ? warning('DANGER', 'self_reactive', 'compat_self_reactive', a, b)
        : null,
    (a, b) => hasGroup(a.hCodes, 'EXPLOSIVE')
        ? warning('DANGER', 'explosive', 'compat_explosive', a, b)
        : null,
    (a, b) => isAcidic(a) && b.isCyanide
        ? warning('DANGER', 'acid_cyanide', 'compat_acid_cyanide', a, b)
        : null,
    (a, b) => isAcidic(a) && b.isSulfide
        ? warning('DANGER', 'acid_sulfide', 'compat_acid_sulfide', a, b)
        : null,
    (a, b) => isAcidic(a) && b.isReactiveMetal
        ? warning('WARNING', 'acid_metal', 'compat_acid_metal', a, b)
        : null,
    (a, b) => isAcidic(a) && isBasic(b)
        ? warning('WARNING', 'acid_base', 'compat_acid_base', a, b)
        : null,
    (a, b) => {
        const corrosiveAcid = hasGroup(a.hCodes, 'CORROSIVE') &&
            (a.category === 'ACID' || (a.referencePh !== undefined ? a.referencePh < 7 : false));
        return corrosiveAcid && b.isOrganic
            ? warning('WARNING', 'acid_organic', 'compat_acid_organic', a, b)
            : null;
    },
];

const toEntry = (item: CartItem, matrix?: WasteMatrix): ChemEntry => {
    const name = item.chemical.name ?? '';
    const formula = item.chemical.molecularFormula ?? '';
    const normalizedFormula = formula.replace(/\s+/g, '').toUpperCase();
    const aqueousContext = item.solutionContext?.physicalForm === 'aqueous' ||
        item.solutionContext?.solventClass === 'aqueous';
    const aqueousMatrix = matrix === 'aqueous' || matrix === 'mixed_biphasic';
    const isWaterIdentity = normalizedFormula === 'H2O' || /^(?:water|distilled water|deionized water|물|증류수|탈이온수)$/i.test(name.trim());

    return {
        name,
        formula,
        category: item.category,
        hCodes: extractHCodes(item.chemical.ghs?.hazardStatements ?? []),
        isOrganic: item.chemical.properties?.isOrganic ?? false,
        // Solubility describes what a pure substance can dissolve in, not the
        // actual matrix currently inside the waste container.
        isAqueous: aqueousMatrix || aqueousContext || isWaterIdentity,
        referencePh: item.chemical.properties?.referencePh ?? item.chemical.properties?.ph,
        isCyanide: item.category === 'CYANIDE' ||
            CYANIDE_NAME_PATTERN.test(name) ||
            CYANIDE_FORMULA_PATTERN.test(normalizedFormula),
        isSulfide: SULFIDE_NAME_PATTERN.test(name) || SULFIDE_FORMULA_PATTERN.test(normalizedFormula),
        isReactiveMetal: isReactiveElementalMetal(name, formula),
    };
};

/**
 * Check legacy cart items for incompatible combinations. The return shape is
 * unchanged so current storage, fridge and cart callers remain compatible.
 */
export function checkCompatibility(
    cart: CartItem[],
    options: { matrix?: WasteMatrix } = {},
): CompatibilityWarning[] {
    if (cart.length < 2) return [];

    const entries = cart.map((item) => toEntry(item, options.matrix));
    const warnings: CompatibilityWarning[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < entries.length; i += 1) {
        for (let j = 0; j < entries.length; j += 1) {
            if (i === j) continue;

            for (const rule of rules) {
                const result = rule(entries[i], entries[j]);
                if (!result) continue;

                const pair = [result.chemicalA, result.chemicalB].sort();
                const key = [result.ruleId, ...pair].join('|');
                if (!seen.has(key)) {
                    seen.add(key);
                    warnings.push(result);
                }
            }
        }
    }

    return warnings.sort((a, b) => {
        if (a.severity === b.severity) return 0;
        return a.severity === 'DANGER' ? -1 : 1;
    });
}
