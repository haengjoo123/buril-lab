/**
 * Storage Compatibility Checker
 * ═════════════════════════════
 * Checks chemical storage compatibility based on OSHA/NFPA segregation
 * guidelines for reagents placed on the same shelf in a virtual cabinet.
 *
 * Unlike the cart-based compatibility checker (for mixture disposal),
 * this module focuses on **co-storage safety** — whether chemicals can
 * safely sit next to each other on the same shelf.
 *
 * Reference Standards:
 * - OSHA 29 CFR 1910.106 (Flammable/Combustible Liquid Storage)
 * - NFPA 400 (Hazardous Materials Storage)
 * - UCSD Chemical Storage Segregation Guide
 * - UC Davis Chemical Safety Guidelines
 */

import type { ReagentPlacement } from '../types/fridge';

// ════════════════════════════════════════════
// Types
// ════════════════════════════════════════════

export type StorageSeverity = 'DANGER' | 'WARNING';

export interface StorageWarning {
    severity: StorageSeverity;
    ruleId: string;
    itemA: string;
    itemB: string;
    messageKey: string; // i18n translation key
}

/**
 * Storage Compatibility Group
 * Based on OSHA/NFPA hazardous material segregation classes.
 */
export type StorageGroup =
    | 'FLAMMABLE'
    | 'OXIDIZER'
    | 'INORGANIC_ACID'
    | 'ORGANIC_ACID'
    | 'BASE'
    | 'TOXIC_CYANIDE'
    | 'TOXIC_SULFIDE'
    | 'WATER_REACTIVE'
    | 'PYROPHORIC'
    | 'EXPLOSIVE'
    | 'ORGANIC_PEROXIDE'
    | 'COMPRESSED_GAS'
    | 'ORGANIC_SOLVENT'
    | 'GENERAL'; // Non-hazardous or unclassified

// ════════════════════════════════════════════
// H-code → Storage Group Mapping
// ════════════════════════════════════════════

const H_CODE_GROUPS: Record<string, StorageGroup[]> = {
    // Flammable
    H220: ['FLAMMABLE'], H221: ['FLAMMABLE'], H222: ['FLAMMABLE'],
    H223: ['FLAMMABLE'], H224: ['FLAMMABLE'], H225: ['FLAMMABLE'],
    H226: ['FLAMMABLE'], H227: ['FLAMMABLE'], H228: ['FLAMMABLE'],
    // Oxidizer
    H270: ['OXIDIZER'], H271: ['OXIDIZER'], H272: ['OXIDIZER'],
    // Water-reactive
    H260: ['WATER_REACTIVE'], H261: ['WATER_REACTIVE'],
    // Self-reactive / Organic peroxide
    H240: ['EXPLOSIVE'], H241: ['EXPLOSIVE'], H242: ['ORGANIC_PEROXIDE'],
    // Pyrophoric
    H250: ['PYROPHORIC'],
    // Explosive
    H200: ['EXPLOSIVE'], H201: ['EXPLOSIVE'], H202: ['EXPLOSIVE'],
    H203: ['EXPLOSIVE'], H204: ['EXPLOSIVE'], H205: ['EXPLOSIVE'],
    // Compressed gas
    H280: ['COMPRESSED_GAS'], H281: ['COMPRESSED_GAS'],
    // Corrosive (need further context: acid or base)
    H314: ['INORGANIC_ACID'], // Default to acid; overridden by name detection
};

// ════════════════════════════════════════════
// Name-based Chemical Detection (Korean + English)
// ════════════════════════════════════════════

/** Inorganic acids — strong mineral acids */
const INORGANIC_ACID_PATTERNS = [
    /sulfuric\s*acid/i, /황산/i,
    /hydrochloric\s*acid/i, /염산/i, /\bHCl\b/,
    /nitric\s*acid/i, /질산/i, /\bHNO3\b/,
    /phosphoric\s*acid/i, /인산/i,
    /perchloric\s*acid/i, /과염소산/i,
    /hydrobromic\s*acid/i, /브롬화수소산/i,
    /hydrofluoric\s*acid/i, /불산/i, /\bHF\b/,
    /chromic\s*acid/i, /크롬산/i,
    /boric\s*acid/i, /붕산/i,
];

/** Organic acids */
const ORGANIC_ACID_PATTERNS = [
    /acetic\s*acid/i, /아세트산/i, /초산/i,
    /citric\s*acid/i, /구연산/i,
    /formic\s*acid/i, /포름산/i, /개미산/i,
    /oxalic\s*acid/i, /옥살산/i, /수산/i,
    /trifluoroacetic/i, /트리플루오로아세트산/i, /\bTFA\b/,
    /lactic\s*acid/i, /젖산/i,
    /maleic\s*acid/i, /말레산/i,
    /benzoic\s*acid/i, /벤조산/i,
    /tartaric\s*acid/i, /타르타르산/i,
    /propionic\s*acid/i, /프로피온산/i,
    /butyric\s*acid/i, /부티르산/i,
];

/** Bases / Alkalies */
const BASE_PATTERNS = [
    /sodium\s*hydroxide/i, /수산화\s*나트륨/i, /가성\s*소다/i, /\bNaOH\b/,
    /potassium\s*hydroxide/i, /수산화\s*칼륨/i, /가성\s*칼리/i, /\bKOH\b/,
    /ammonium\s*hydroxide/i, /수산화\s*암모늄/i, /암모니아수/i,
    /calcium\s*hydroxide/i, /수산화\s*칼슘/i, /소석회/i,
    /sodium\s*carbonate/i, /탄산\s*나트륨/i, /소다회/i,
    /sodium\s*bicarbonate/i, /탄산수소\s*나트륨/i, /중조/i,
    /lithium\s*hydroxide/i, /수산화\s*리튬/i,
    /barium\s*hydroxide/i, /수산화\s*바륨/i,
    /triethylamine/i, /트리에틸아민/i, /\bTEA\b/,
    /pyridine/i, /피리딘/i,
];

/** Common organic solvents (flammable liquids) */
const ORGANIC_SOLVENT_PATTERNS = [
    /\bacetone\b/i, /아세톤/i,
    /\bmethanol\b/i, /메탄올/i, /메틸\s*알코올/i,
    /\bethanol\b/i, /에탄올/i, /에틸\s*알코올/i,
    /\bisopropanol\b/i, /이소프로판올/i, /\bIPA\b/,
    /\bhexane\b/i, /헥산/i,
    /\btoluene\b/i, /톨루엔/i,
    /\bxylene\b/i, /자일렌/i, /크실렌/i,
    /\bbenzene\b/i, /벤젠/i,
    /\bether\b/i, /에테르/i, /에터/i,
    /diethyl\s*ether/i, /디에틸에테르/i,
    /\bTHF\b/i, /tetrahydrofuran/i, /테트라하이드로퓨란/i,
    /\bDMF\b/i, /dimethylformamide/i, /디메틸포름아미드/i,
    /\bDMSO\b/i, /dimethyl\s*sulfoxide/i, /디메틸설폭사이드/i,
    /dichloromethane/i, /\bDCM\b/i, /디클로로메탄/i, /메틸렌\s*클로라이드/i,
    /chloroform/i, /클로로포름/i,
    /ethyl\s*acetate/i, /에틸\s*아세테이트/i, /초산에틸/i,
    /\bpentane\b/i, /펜탄/i,
    /\bheptane\b/i, /헵탄/i,
    /petroleum\s*ether/i, /석유\s*에테르/i,
    /\bacetonitrile\b/i, /아세토니트릴/i,
    /\bbutanol\b/i, /부탄올/i,
    /cyclohexane/i, /사이클로헥산/i,
    /carbon\s*tetrachloride/i, /사염화탄소/i,
    /\bformaldehyde\b/i, /포름알데히드/i, /포르말린/i,
];

/** Strong oxidizers */
const OXIDIZER_PATTERNS = [
    /potassium\s*permanganate/i, /과망간산\s*칼륨/i, /\bKMnO4\b/,
    /hydrogen\s*peroxide/i, /과산화\s*수소/i, /\bH2O2\b/,
    /sodium\s*hypochlorite/i, /차아염소산\s*나트륨/i, /락스/i,
    /potassium\s*dichromate/i, /중크롬산\s*칼륨/i,
    /sodium\s*peroxide/i, /과산화\s*나트륨/i,
    /potassium\s*perchlorate/i, /과염소산\s*칼륨/i,
    /ammonium\s*persulfate/i, /과황산\s*암모늄/i,
    /benzoyl\s*peroxide/i, /벤조일\s*퍼옥사이드/i,
    /sodium\s*periodate/i, /과요오드산\s*나트륨/i,
    /potassium\s*iodate/i, /요오드산\s*칼륨/i,
    /nitric\s*acid/i, /질산/i, // Nitric acid is both acid and oxidizer
    /perchloric\s*acid/i, /과염소산/i, // Perchloric acid is both acid and oxidizer
    /chromic\s*acid/i, /크롬산/i, // Chromic acid is both acid and oxidizer
];

/** Cyanide compounds */
const CYANIDE_PATTERNS = [
    /cyanide/i, /시안화/i, /시안/i, /청산/i,
    /\bKCN\b/, /\bNaCN\b/, /\bHCN\b/,
];

/** Sulfide compounds */
const SULFIDE_PATTERNS = [
    /sulfide/i, /sulphide/i, /황화/i,
    /\bNa2S\b/, /\bFeS\b/, /\bH2S\b/,
];

/** Water-reactive materials */
const WATER_REACTIVE_PATTERNS = [
    /sodium\s*metal/i, /금속\s*나트륨/i,
    /potassium\s*metal/i, /금속\s*칼륨/i,
    /lithium\s*(metal|wire|ribbon)/i, /금속\s*리튬/i,
    /calcium\s*hydride/i, /수소화\s*칼슘/i, /\bCaH2\b/,
    /sodium\s*hydride/i, /수소화\s*나트륨/i, /\bNaH\b/,
    /lithium\s*aluminum\s*hydride/i, /리튬\s*알루미늄\s*하이드라이드/i, /\bLiAlH4\b/, /\bLAH\b/,
    /sodium\s*borohydride/i, /수소화\s*붕소\s*나트륨/i, /\bNaBH4\b/,
    /butyllithium/i, /부틸리튬/i, /\bn-?BuLi\b/i,
    /phosphorus\s*pentachloride/i, /오염화\s*인/i,
    /phosphorus\s*pentoxide/i, /오산화\s*이인/i,
    /\bP2O5\b/,
];

/** Pyrophoric materials */
const PYROPHORIC_PATTERNS = [
    /butyllithium/i, /부틸리튬/i, /\bn-?BuLi\b/i,
    /triethylaluminum/i, /트리에틸알루미늄/i,
    /diethylzinc/i, /디에틸아연/i,
    /iron\s*pentacarbonyl/i, /철\s*펜타카보닐/i,
    /white\s*phosphorus/i, /황인/i, /백린/i,
];

/** Organic peroxides */
const ORGANIC_PEROXIDE_PATTERNS = [
    /benzoyl\s*peroxide/i, /벤조일\s*퍼옥사이드/i,
    /tert-?butyl\s*hydroperoxide/i, /t-?부틸\s*하이드로퍼옥사이드/i,
    /cumene\s*hydroperoxide/i, /큐멘\s*하이드로퍼옥사이드/i,
    /peracetic\s*acid/i, /과아세트산/i,
    /dibenzoyl\s*peroxide/i,
    /peroxide/i, // Catch-all for peroxides in name
];

// ════════════════════════════════════════════
// Classification Logic
// ════════════════════════════════════════════

const matchesAny = (text: string, patterns: RegExp[]): boolean =>
    patterns.some(p => p.test(text));

/**
 * Classify a reagent into one or more storage groups.
 * Uses both H-codes (if available) and name-based pattern matching.
 *
 * A single reagent can belong to multiple groups
 * (e.g., nitric acid = both INORGANIC_ACID and OXIDIZER).
 */
export function classifyStorageGroups(item: ReagentPlacement): StorageGroup[] {
    const groups = new Set<StorageGroup>();
    const nameText = `${item.name} ${item.notes || ''} ${item.casNo || ''}`;

    // 1. H-code classification (most reliable)
    if (item.hCodes && item.hCodes.length > 0) {
        for (const code of item.hCodes) {
            const hGroups = H_CODE_GROUPS[code];
            if (hGroups) hGroups.forEach(g => groups.add(g));
        }
    }

    // 2. Name-based classification (supplements H-codes or standalone)
    if (matchesAny(nameText, INORGANIC_ACID_PATTERNS)) groups.add('INORGANIC_ACID');
    if (matchesAny(nameText, ORGANIC_ACID_PATTERNS)) groups.add('ORGANIC_ACID');
    if (matchesAny(nameText, BASE_PATTERNS)) groups.add('BASE');
    if (matchesAny(nameText, OXIDIZER_PATTERNS)) groups.add('OXIDIZER');
    if (matchesAny(nameText, ORGANIC_SOLVENT_PATTERNS)) {
        groups.add('ORGANIC_SOLVENT');
        groups.add('FLAMMABLE'); // Most organic solvents are flammable
    }
    if (matchesAny(nameText, CYANIDE_PATTERNS)) groups.add('TOXIC_CYANIDE');
    if (matchesAny(nameText, SULFIDE_PATTERNS)) groups.add('TOXIC_SULFIDE');
    if (matchesAny(nameText, WATER_REACTIVE_PATTERNS)) groups.add('WATER_REACTIVE');
    if (matchesAny(nameText, PYROPHORIC_PATTERNS)) groups.add('PYROPHORIC');
    if (matchesAny(nameText, ORGANIC_PEROXIDE_PATTERNS)) groups.add('ORGANIC_PEROXIDE');

    // 3. Use isAcidic/isBasic flags from chemical data
    if (item.isAcidic && groups.size === 0) groups.add('INORGANIC_ACID');
    if (item.isBasic && groups.size === 0) groups.add('BASE');

    // 4. Override: if H314 + base detected, reclassify as BASE
    if (groups.has('INORGANIC_ACID') && groups.has('BASE')) {
        // If name explicitly matches base, prefer BASE over generic H314 acid assignment
        if (matchesAny(nameText, BASE_PATTERNS) && !matchesAny(nameText, INORGANIC_ACID_PATTERNS)) {
            groups.delete('INORGANIC_ACID');
        }
    }

    if (groups.size === 0) groups.add('GENERAL');
    return [...groups];
}

// ════════════════════════════════════════════
// Storage Incompatibility Rules (16 rules)
// ════════════════════════════════════════════
//
// Based on OSHA/NFPA chemical segregation matrix:
//
//              FLAM  OXID  I-ACID  O-ACID  BASE  CYA  SULF  W-REACT  PYRO  EXPL  ORG-PEROX
// FLAMMABLE     ✓     ✗      ✗       ⚠      ✗     ⚠    ⚠      ⚠       ✗     ✗      ✗
// OXIDIZER      ✗     ✓      ⚠       ✗      ⚠     ✗    ✗      ✗       ✗     ✗      ✗
// I-ACID        ✗     ⚠      ✓       ⚠      ✗     ✗    ✗      ✗       ✗     ✗      ✗
// BASE          ✗     ⚠      ✗       ⚠      ✓     ⚠    ⚠      ⚠       ✗     ✗      ✗
// WATER-REACT   ⚠     ✗      ✗       ✗      ⚠     ✗    ✗      ✓       ✗     ✗      ✗
// PYROPHORIC    ✗     ✗      ✗       ✗      ✗     ✗    ✗      ✗       ⚠     ✗      ✗
// EXPLOSIVE     ✗     ✗      ✗       ✗      ✗     ✗    ✗      ✗       ✗     ⚠      ✗
//
// ✓ = Compatible (same group)
// ✗ = Incompatible (DANGER)
// ⚠ = Conditionally incompatible (WARNING)

interface StorageRule {
    ruleId: string;
    groupA: StorageGroup;
    groupB: StorageGroup;
    severity: StorageSeverity;
    messageKey: string;
}

const STORAGE_RULES: StorageRule[] = [
    // ── DANGER level rules (must not store together) ──

    // 1. Flammable + Oxidizer → Fire/explosion
    { ruleId: 'store_flam_oxid', groupA: 'FLAMMABLE', groupB: 'OXIDIZER', severity: 'DANGER', messageKey: 'storage_flam_oxidizer' },
    // 2. Flammable + Inorganic acid → Exothermic/fire
    { ruleId: 'store_flam_acid', groupA: 'FLAMMABLE', groupB: 'INORGANIC_ACID', severity: 'DANGER', messageKey: 'storage_flam_acid' },
    // 3. Oxidizer + Organic solvent → Ignition/explosion
    { ruleId: 'store_oxid_organic', groupA: 'OXIDIZER', groupB: 'ORGANIC_SOLVENT', severity: 'DANGER', messageKey: 'storage_oxid_organic' },
    // 4. Acid + Cyanide → HCN lethal gas
    { ruleId: 'store_acid_cyanide', groupA: 'INORGANIC_ACID', groupB: 'TOXIC_CYANIDE', severity: 'DANGER', messageKey: 'storage_acid_cyanide' },
    // 5. Acid + Sulfide → H2S toxic gas
    { ruleId: 'store_acid_sulfide', groupA: 'INORGANIC_ACID', groupB: 'TOXIC_SULFIDE', severity: 'DANGER', messageKey: 'storage_acid_sulfide' },
    // 6. Pyrophoric + Any flammable/oxidizer → Spontaneous ignition
    { ruleId: 'store_pyro_flam', groupA: 'PYROPHORIC', groupB: 'FLAMMABLE', severity: 'DANGER', messageKey: 'storage_pyro_flam' },
    { ruleId: 'store_pyro_oxid', groupA: 'PYROPHORIC', groupB: 'OXIDIZER', severity: 'DANGER', messageKey: 'storage_pyro_danger' },
    // 7. Organic peroxide + Flammable → Fire/explosion
    { ruleId: 'store_orgperox_flam', groupA: 'ORGANIC_PEROXIDE', groupB: 'FLAMMABLE', severity: 'DANGER', messageKey: 'storage_orgperox_flam' },
    // 8. Organic peroxide + Acid → Decomposition/explosion
    { ruleId: 'store_orgperox_acid', groupA: 'ORGANIC_PEROXIDE', groupB: 'INORGANIC_ACID', severity: 'DANGER', messageKey: 'storage_orgperox_acid' },
    // 9. Water-reactive + Base (aqueous solutions) → Gas generation
    { ruleId: 'store_waterreact_base', groupA: 'WATER_REACTIVE', groupB: 'BASE', severity: 'DANGER', messageKey: 'storage_waterreact_aqueous' },
    // 10. Water-reactive + Inorganic Acid (aqueous) → Violent reaction
    { ruleId: 'store_waterreact_acid', groupA: 'WATER_REACTIVE', groupB: 'INORGANIC_ACID', severity: 'DANGER', messageKey: 'storage_waterreact_aqueous' },

    // ── WARNING level rules (should be separated if possible) ──

    // 11. Acid + Base → Exothermic neutralization
    { ruleId: 'store_acid_base', groupA: 'INORGANIC_ACID', groupB: 'BASE', severity: 'WARNING', messageKey: 'storage_acid_base' },
    // 12. Organic acid + Base → Exothermic
    { ruleId: 'store_orgacid_base', groupA: 'ORGANIC_ACID', groupB: 'BASE', severity: 'WARNING', messageKey: 'storage_acid_base' },
    // 13. Flammable + Base → Some reactions possible
    { ruleId: 'store_flam_base', groupA: 'FLAMMABLE', groupB: 'BASE', severity: 'WARNING', messageKey: 'storage_flam_base' },
    // 14. Oxidizer + Inorganic acid → Accelerated corrosion / toxic gas
    { ruleId: 'store_oxid_acid', groupA: 'OXIDIZER', groupB: 'INORGANIC_ACID', severity: 'WARNING', messageKey: 'storage_oxid_acid' },
    // 15. Explosive → Must be isolated from everything
    { ruleId: 'store_explosive_any', groupA: 'EXPLOSIVE', groupB: 'GENERAL', severity: 'DANGER', messageKey: 'storage_explosive_isolate' },
    // 16. Organic acid + Oxidizer → Fire risk
    { ruleId: 'store_orgacid_oxid', groupA: 'ORGANIC_ACID', groupB: 'OXIDIZER', severity: 'WARNING', messageKey: 'storage_orgacid_oxid' },
];

// ════════════════════════════════════════════
// Main API
// ════════════════════════════════════════════

interface ClassifiedItem {
    item: ReagentPlacement;
    groups: StorageGroup[];
}

/**
 * Check storage compatibility for all items on a shelf.
 * Returns deduplicated warnings sorted by severity.
 */
export function checkShelfCompatibility(items: ReagentPlacement[]): StorageWarning[] {
    if (items.length < 2) return [];

    // Pre-classify all items
    const classified: ClassifiedItem[] = items.map(item => ({
        item,
        groups: classifyStorageGroups(item),
    }));

    const warnings: StorageWarning[] = [];
    const seen = new Set<string>();

    // Check every pair
    for (let i = 0; i < classified.length; i++) {
        for (let j = i + 1; j < classified.length; j++) {
            const a = classified[i];
            const b = classified[j];

            // Check each rule
            for (const rule of STORAGE_RULES) {
                const match =
                    (a.groups.includes(rule.groupA) && b.groups.includes(rule.groupB)) ||
                    (a.groups.includes(rule.groupB) && b.groups.includes(rule.groupA));

                // Special handling: EXPLOSIVE isolate rule — explosive + any non-explosive
                if (rule.ruleId === 'store_explosive_any') {
                    const aExplosive = a.groups.includes('EXPLOSIVE');
                    const bExplosive = b.groups.includes('EXPLOSIVE');
                    if ((aExplosive && !bExplosive) || (!aExplosive && bExplosive)) {
                        const key = [rule.ruleId, a.item.name, b.item.name].sort().join('|');
                        if (!seen.has(key)) {
                            seen.add(key);
                            warnings.push({
                                severity: rule.severity,
                                ruleId: rule.ruleId,
                                itemA: aExplosive ? a.item.name : b.item.name,
                                itemB: aExplosive ? b.item.name : a.item.name,
                                messageKey: rule.messageKey,
                            });
                        }
                    }
                    continue;
                }

                if (match) {
                    const key = [rule.ruleId, a.item.name, b.item.name].sort().join('|');
                    if (!seen.has(key)) {
                        seen.add(key);
                        warnings.push({
                            severity: rule.severity,
                            ruleId: rule.ruleId,
                            itemA: a.item.name,
                            itemB: b.item.name,
                            messageKey: rule.messageKey,
                        });
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

/**
 * Check all shelves in the cabinet for incompatible storage.
 * Returns a map of shelf ID → warnings.
 */
export function checkCabinetCompatibility(
    shelves: { id: string; items: ReagentPlacement[] }[]
): Map<string, StorageWarning[]> {
    const results = new Map<string, StorageWarning[]>();
    for (const shelf of shelves) {
        const warnings = checkShelfCompatibility(shelf.items);
        if (warnings.length > 0) {
            results.set(shelf.id, warnings);
        }
    }
    return results;
}

/**
 * Get the classification summary for a single reagent.
 * Useful for displaying on the reagent edit panel.
 */
export function getStorageGroupLabels(groups: StorageGroup[]): string[] {
    const LABEL_KEYS: Record<StorageGroup, string> = {
        FLAMMABLE: 'storage_group_flammable',
        OXIDIZER: 'storage_group_oxidizer',
        INORGANIC_ACID: 'storage_group_inorganic_acid',
        ORGANIC_ACID: 'storage_group_organic_acid',
        BASE: 'storage_group_base',
        TOXIC_CYANIDE: 'storage_group_cyanide',
        TOXIC_SULFIDE: 'storage_group_sulfide',
        WATER_REACTIVE: 'storage_group_water_reactive',
        PYROPHORIC: 'storage_group_pyrophoric',
        EXPLOSIVE: 'storage_group_explosive',
        ORGANIC_PEROXIDE: 'storage_group_organic_peroxide',
        COMPRESSED_GAS: 'storage_group_compressed_gas',
        ORGANIC_SOLVENT: 'storage_group_organic_solvent',
        GENERAL: 'storage_group_general',
    };
    return groups.filter(g => g !== 'GENERAL').map(g => LABEL_KEYS[g]);
}
