import type { CartItem } from '../types';

// ════════════════════════════════════════════
// Types
// ════════════════════════════════════════════

export type Severity = 'DANGER' | 'WARNING';

export interface CompatibilityWarning {
    severity: Severity;
    ruleId: string;
    chemicalA: string;
    chemicalB: string;
    messageKey: string;
}

// ════════════════════════════════════════════
// H-code Hazard Groups
// ════════════════════════════════════════════

type HazardGroup =
    | 'OXIDIZER'
    | 'FLAMMABLE'
    | 'WATER_REACTIVE'
    | 'SELF_REACTIVE'
    | 'PYROPHORIC'
    | 'CORROSIVE'
    | 'EXPLOSIVE'
    | 'ACUTE_TOXIC_INHALATION';

const HAZARD_GROUP_CODES: Record<HazardGroup, string[]> = {
    OXIDIZER: ['H270', 'H271', 'H272'],
    FLAMMABLE: ['H220', 'H221', 'H222', 'H223', 'H224', 'H225', 'H226', 'H227', 'H228'],
    WATER_REACTIVE: ['H260', 'H261'],
    SELF_REACTIVE: ['H240', 'H241', 'H242'],
    PYROPHORIC: ['H250'],
    CORROSIVE: ['H314'],
    EXPLOSIVE: ['H200', 'H201', 'H202', 'H203', 'H204', 'H205'],
    ACUTE_TOXIC_INHALATION: ['H330', 'H331'],  // Fatal/Toxic if inhaled
};

// ════════════════════════════════════════════
// Chemical Name / Formula Pattern Detectors
// ════════════════════════════════════════════

/** Common cyanide-containing chemicals (produce HCN gas with acids) */
const CYANIDE_PATTERNS = [
    /cyanide/i, /cyanid/i, /\bCN\b/, /\bHCN\b/, /\bKCN\b/, /\bNaCN\b/,
    /시안화/i, /시안/i, /청산/i,
];

/** Common sulfide-containing chemicals (produce H2S gas with acids) */
const SULFIDE_PATTERNS = [
    /sulfide/i, /sulphide/i, /\bNa2S\b/, /\bFeS\b/, /\bH2S\b/,
    /황화/i,
];

/** Reactive metals that produce H2 gas with acids */
const REACTIVE_METAL_PATTERNS = [
    /\bsodium\b/i, /\bpotassium\b/i, /\blithium\b/i, /\bcalcium\b/i,
    /\bmagnesium\b/i, /\bzinc\b/i, /\biron\b/i, /\baluminum\b/i, /\baluminium\b/i,
    /나트륨/i, /칼륨/i, /리튬/i, /칼슘/i, /마그네슘/i, /아연/i, /철/i, /알루미늄/i,
];

/** Check if name or formula matches any pattern in a list */
const matchesAny = (name: string, formula: string, patterns: RegExp[]): boolean => {
    return patterns.some(p => p.test(name) || p.test(formula));
};

// ════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════

/** Extract H-code identifiers (e.g. "H225") from hazard statement strings */
const extractHCodes = (statements: string[]): string[] => {
    const codes: string[] = [];
    const pattern = /H\d{3}/g;
    for (const stmt of statements) {
        const matches = stmt.match(pattern);
        if (matches) codes.push(...matches);
    }
    return [...new Set(codes)];
};

/** Check if a chemical's H-codes belong to a specific hazard group */
const hasGroup = (hCodes: string[], group: HazardGroup): boolean => {
    return hCodes.some(code => HAZARD_GROUP_CODES[group].includes(code));
};

/** Check if the chemical is water-soluble / aqueous based on solubility text */
const isAqueous = (solubility?: string): boolean => {
    if (!solubility) return false;
    const lower = solubility.toLowerCase();
    return (
        lower.includes('miscible') ||
        lower.includes('soluble in water') ||
        lower.includes('soluble') ||
        lower.includes('water')
    );
};

/** Check if a chemical is acidic (pH-based or H-code based) */
const isAcidic = (entry: ChemEntry): boolean => {
    if (entry.ph !== undefined && entry.ph < 4) return true;
    // H314 (corrosive) with known acid properties
    return hasGroup(entry.hCodes, 'CORROSIVE') && (entry.ph !== undefined ? entry.ph < 7 : false);
};

/** Check if a chemical is a strong base */
const isBasic = (entry: ChemEntry): boolean => {
    if (entry.ph !== undefined && entry.ph > 10) return true;
    return false;
};

// ════════════════════════════════════════════
// Incompatibility Rules (11 rules)
// ════════════════════════════════════════════

interface ChemEntry {
    name: string;
    formula: string;
    hCodes: string[];
    isOrganic: boolean;
    isAqueous: boolean;
    ph?: number;
    isCyanide: boolean;
    isSulfide: boolean;
    isReactiveMetal: boolean;
}

type Rule = (a: ChemEntry, b: ChemEntry) => CompatibilityWarning | null;

const rules: Rule[] = [
    // ── Physical Hazard Rules ──

    // Rule 1: Oxidizer + Flammable → DANGER (fire/explosion)
    (a, b) => {
        if (hasGroup(a.hCodes, 'OXIDIZER') && hasGroup(b.hCodes, 'FLAMMABLE')) {
            return {
                severity: 'DANGER',
                ruleId: 'oxidizer_flammable',
                chemicalA: a.name,
                chemicalB: b.name,
                messageKey: 'compat_oxidizer_flammable',
            };
        }
        return null;
    },

    // Rule 2: Oxidizer + Organic (non-flammable) → WARNING (ignition risk)
    (a, b) => {
        if (hasGroup(a.hCodes, 'OXIDIZER') && b.isOrganic && !hasGroup(b.hCodes, 'FLAMMABLE')) {
            return {
                severity: 'WARNING',
                ruleId: 'oxidizer_organic',
                chemicalA: a.name,
                chemicalB: b.name,
                messageKey: 'compat_oxidizer_organic',
            };
        }
        return null;
    },

    // Rule 3: Water-reactive + Aqueous → DANGER (toxic/flammable gas)
    (a, b) => {
        if (hasGroup(a.hCodes, 'WATER_REACTIVE') && b.isAqueous) {
            return {
                severity: 'DANGER',
                ruleId: 'water_reactive',
                chemicalA: a.name,
                chemicalB: b.name,
                messageKey: 'compat_water_reactive',
            };
        }
        return null;
    },

    // Rule 4: Pyrophoric + Any → DANGER (spontaneous ignition)
    (a, b) => {
        if (hasGroup(a.hCodes, 'PYROPHORIC')) {
            return {
                severity: 'DANGER',
                ruleId: 'pyrophoric',
                chemicalA: a.name,
                chemicalB: b.name,
                messageKey: 'compat_pyrophoric',
            };
        }
        return null;
    },

    // Rule 5: Self-reactive / Organic Peroxide + Any → DANGER (explosion)
    (a, b) => {
        if (hasGroup(a.hCodes, 'SELF_REACTIVE')) {
            return {
                severity: 'DANGER',
                ruleId: 'self_reactive',
                chemicalA: a.name,
                chemicalB: b.name,
                messageKey: 'compat_self_reactive',
            };
        }
        return null;
    },

    // Rule 6: Explosive + Any → DANGER (isolation required)
    (a, b) => {
        if (hasGroup(a.hCodes, 'EXPLOSIVE')) {
            return {
                severity: 'DANGER',
                ruleId: 'explosive',
                chemicalA: a.name,
                chemicalB: b.name,
                messageKey: 'compat_explosive',
            };
        }
        return null;
    },

    // ── Toxic Gas Generation Rules ──

    // Rule 7: Acid + Cyanide → DANGER (HCN gas — lethal)
    (a, b) => {
        if (isAcidic(a) && b.isCyanide) {
            return {
                severity: 'DANGER',
                ruleId: 'acid_cyanide',
                chemicalA: a.name,
                chemicalB: b.name,
                messageKey: 'compat_acid_cyanide',
            };
        }
        return null;
    },

    // Rule 8: Acid + Sulfide → DANGER (H2S gas — toxic)
    (a, b) => {
        if (isAcidic(a) && b.isSulfide) {
            return {
                severity: 'DANGER',
                ruleId: 'acid_sulfide',
                chemicalA: a.name,
                chemicalB: b.name,
                messageKey: 'compat_acid_sulfide',
            };
        }
        return null;
    },

    // ── Reaction Hazard Rules ──

    // Rule 9: Acid + Reactive Metal → WARNING (H2 flammable gas)
    (a, b) => {
        if (isAcidic(a) && b.isReactiveMetal) {
            return {
                severity: 'WARNING',
                ruleId: 'acid_metal',
                chemicalA: a.name,
                chemicalB: b.name,
                messageKey: 'compat_acid_metal',
            };
        }
        return null;
    },

    // Rule 10: Strong Acid + Strong Base → WARNING (exothermic)
    (a, b) => {
        if (isAcidic(a) && isBasic(b)) {
            return {
                severity: 'WARNING',
                ruleId: 'acid_base',
                chemicalA: a.name,
                chemicalB: b.name,
                messageKey: 'compat_acid_base',
            };
        }
        return null;
    },

    // Rule 11: Corrosive acid + Organic → WARNING (exothermic reaction)
    (a, b) => {
        const isAcid = hasGroup(a.hCodes, 'CORROSIVE') && (a.ph !== undefined ? a.ph < 7 : true);
        if (isAcid && b.isOrganic) {
            return {
                severity: 'WARNING',
                ruleId: 'acid_organic',
                chemicalA: a.name,
                chemicalB: b.name,
                messageKey: 'compat_acid_organic',
            };
        }
        return null;
    },
];

// ════════════════════════════════════════════
// Main API
// ════════════════════════════════════════════

/**
 * Check cart items for incompatible chemical combinations.
 * Returns deduplicated warnings sorted by severity (DANGER first).
 *
 * 11 Rules covering:
 * - Physical: oxidizer×flammable, oxidizer×organic, water-reactive×aqueous,
 *   pyrophoric, self-reactive, explosive
 * - Toxic gas: acid×cyanide (HCN), acid×sulfide (H2S)
 * - Reaction: acid×reactive metal (H2), acid×base (exothermic), acid×organic
 */
export function checkCompatibility(cart: CartItem[]): CompatibilityWarning[] {
    if (cart.length < 2) return [];

    // Pre-process cart items
    const entries: ChemEntry[] = cart.map(item => {
        const name = item.chemical.name;
        const formula = item.chemical.molecularFormula ?? '';
        return {
            name,
            formula,
            hCodes: extractHCodes(item.chemical.ghs?.hazardStatements ?? []),
            isOrganic: item.chemical.properties?.isOrganic ?? false,
            isAqueous: isAqueous(item.chemical.physicalProperties?.solubility),
            ph: item.chemical.properties?.ph,
            isCyanide: matchesAny(name, formula, CYANIDE_PATTERNS),
            isSulfide: matchesAny(name, formula, SULFIDE_PATTERNS),
            isReactiveMetal: matchesAny(name, formula, REACTIVE_METAL_PATTERNS),
        };
    });

    const warnings: CompatibilityWarning[] = [];
    const seen = new Set<string>();

    // Check each pair (both directions for asymmetric rules)
    for (let i = 0; i < entries.length; i++) {
        for (let j = 0; j < entries.length; j++) {
            if (i === j) continue;

            for (const rule of rules) {
                const warning = rule(entries[i], entries[j]);
                if (warning) {
                    // Deduplicate: same rule + same pair (order-independent)
                    const pairKey = [warning.ruleId, ...[warning.chemicalA, warning.chemicalB].sort()].join('|');
                    if (!seen.has(pairKey)) {
                        seen.add(pairKey);
                        warnings.push(warning);
                    }
                }
            }
        }
    }

    // Sort: DANGER first, then WARNING
    warnings.sort((a, b) => {
        if (a.severity === b.severity) return 0;
        return a.severity === 'DANGER' ? -1 : 1;
    });

    return warnings;
}
