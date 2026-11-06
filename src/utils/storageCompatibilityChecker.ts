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

import { normalizeShelfDividers } from './shelfSections';
import type {
    ReagentPlacement,
    StorageClassification,
    StorageClassificationConfidence,
    StorageClassificationEvidence,
    StoragePlacementGroup,
} from '../types/fridge';

// ════════════════════════════════════════════
// Types
// ════════════════════════════════════════════

export type StorageSeverity = 'DANGER' | 'WARNING';

export interface StorageWarning {
    severity: StorageSeverity;
    /** Strongest rule for this pair. */
    ruleId: string;
    itemA: string;
    itemB: string;
    itemAId?: string;
    itemBId?: string;
    messageKey: string; // i18n translation key
    /** Every rule this pair matched, strongest first. A pair is reported once. */
    ruleIds: string[];
    messageKeys: string[];
    /** Every placement behind this line (same-named bottles share one line). */
    itemIds: string[];
}

/**
 * A pair that would conflict if unverified name-based candidates are right.
 * Never a confirmed warning: it only asks the user to verify the data.
 */
export interface StorageReviewConflict {
    ruleId: string;
    itemA: string;
    itemB: string;
    itemAId?: string;
    itemBId?: string;
    messageKey: string;
    ruleIds: string[];
    messageKeys: string[];
    itemIds: string[];
}

export type StorageCompatMark = 'danger' | 'warning' | 'review';

/**
 * Storage Compatibility Group
 * Based on OSHA/NFPA hazardous material segregation classes.
 */
export type StorageGroup = StoragePlacementGroup;

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
    // Fatal acute toxicity
    H300: ['ACUTE_TOXIC'], H310: ['ACUTE_TOXIC'], H330: ['ACUTE_TOXIC'],
    // H314 (corrosive) is resolved to acid or base by resolveCorrosiveGroups.
};

/** Corrosive H-codes that need identity context to tell an acid from a base. */
const CORROSIVE_H_CODES = new Set(['H314']);

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
    /inorganic\s*acid/i, /무기산/i,
];

/** Organic acids */
const ORGANIC_ACID_PATTERNS = [
    /acetic\s*acid/i, /아세트산/i, /초산/i,
    /citric\s*acid/i, /구연산/i,
    /formic\s*acid/i, /포름산/i, /개미산/i,
    // 수산 (oxalic acid) must not match 수산화 (hydroxide).
    /oxalic\s*acid/i, /옥살산/i, /수산(?!화)/i,
    /trifluoroacetic/i, /트리플루오로아세트산/i, /\bTFA\b/,
    /lactic\s*acid/i, /젖산/i,
    /maleic\s*acid/i, /말레산/i,
    /benzoic\s*acid/i, /벤조산/i,
    /tartaric\s*acid/i, /타르타르산/i,
    /propionic\s*acid/i, /프로피온산/i,
    /butyric\s*acid/i, /부티르산/i,
    /organic\s*acid/i, /유기산/i,
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
    /base/i, /alkali/i, /염기/i, /알칼리/i,
];

/**
 * Specific evidence that an H314 corrosive is a base. Deliberately narrower
 * than BASE_PATTERNS (no bare "base"), because it changes an authoritative group.
 */
const BASE_EVIDENCE_PATTERNS = [
    /hydroxide/i, /수산화/,
    /ammonia/i, /암모니아/,
    /amine/i, /아민/,
    /hydrazine/i, /히드라진/, /하이드라진/,
    /(?:piperid|pyrrolid|morphol)ine/i, /\bDBU\b/,
    /caustic/i, /가성\s*소다/, /가성\s*칼리/,
    /\b(?:NaOH|KOH|LiOH|CsOH|NH4OH|NH3)\b/,
    /\(OH\)\d/, // Ca(OH)2, Ba(OH)2, ...
];

/** Common organic solvents (identity hints only; not proof of flammability) */
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

/** Azide compounds */
const AZIDE_PATTERNS = [
    /azide/i, /아자이드/i, /아지드/i,
    /sodium\s*azide/i, /\bNaN3\b/i,
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
];

// ════════════════════════════════════════════
// Classification Logic
// ════════════════════════════════════════════

const matchesAny = (text: string, patterns: RegExp[]): boolean =>
    patterns.some(p => p.test(text));

const STORAGE_GROUP_PRIORITY: StorageGroup[] = [
    'PYROPHORIC',
    'WATER_REACTIVE',
    'ORGANIC_PEROXIDE',
    'EXPLOSIVE',
    'FLAMMABLE',
    'OXIDIZER',
    'TOXIC_CYANIDE',
    'TOXIC_SULFIDE',
    'TOXIC_AZIDE',
    'ACUTE_TOXIC',
    'COMPRESSED_GAS',
    'INORGANIC_ACID',
    'ORGANIC_ACID',
    'BASE',
    'ORGANIC_SOLVENT',
    'GENERAL',
];

function hasIdentifyingInfo(item: ReagentPlacement): boolean {
    const fields = [
        item.name,
        item.casNo,
        item.brand,
        item.productNumber,
    ];
    const joined = fields
        .map((value) => value?.trim() ?? '')
        .filter(Boolean)
        .join(' ');

    if (!joined) return false;
    return !/^(unknown|unidentified|미상|이름\s*없음|\?+)$/i.test(joined);
}

export function getStorageGroupPriority(group: StorageGroup): number {
    const index = STORAGE_GROUP_PRIORITY.indexOf(group);
    return index === -1 ? STORAGE_GROUP_PRIORITY.length : index;
}

export function getPrimaryStorageGroup(groups: StorageGroup[]): StorageGroup {
    return [...groups].sort((a, b) => getStorageGroupPriority(a) - getStorageGroupPriority(b))[0] || 'GENERAL';
}

function hasAcidNameEvidence(name: string): boolean {
    return matchesAny(name, INORGANIC_ACID_PATTERNS) || matchesAny(name, ORGANIC_ACID_PATTERNS);
}

function hasBaseEvidence(item: ReagentPlacement): boolean {
    return Boolean(item.isBasic) || matchesAny(item.name.trim(), BASE_EVIDENCE_PATTERNS);
}

/**
 * H314 says "corrosive", not "acid". With base evidence (hydroxide, amine,
 * ammonia, the stored isBasic signal) it is a base; without any it stays an
 * acid as before. Conflicting evidence keeps both groups so no rule is lost.
 */
function resolveCorrosiveGroups(item: ReagentPlacement): StorageGroup[] {
    if (!hasBaseEvidence(item)) return ['INORGANIC_ACID'];
    return hasAcidNameEvidence(item.name.trim()) ? ['INORGANIC_ACID', 'BASE'] : ['BASE'];
}

/**
 * Classify a reagent into one or more storage groups.
 * H-codes are authoritative for compatibility groups. Name matching is kept
 * as a review-only candidate and never drives compatibility rules directly.
 *
 * A single reagent can belong to multiple groups
 * (e.g., nitric acid = both INORGANIC_ACID and OXIDIZER).
 */
export function classifyStoragePlacement(item: ReagentPlacement): StorageClassification {
    const groups = new Set<StorageGroup>();
    const candidateGroups = new Set<StorageGroup>();
    const evidence = new Set<StorageClassificationEvidence>();
    const isIdentified = hasIdentifyingInfo(item);

    if (!isIdentified) {
        return {
            groups: ['GENERAL'],
            candidateGroups: [],
            primaryGroup: 'GENERAL',
            confidence: 'review',
            evidence: ['insufficient_identity'],
            needsReview: true,
        };
    }

    // 1. H-code classification (most reliable)
    if (item.hCodes && item.hCodes.length > 0) {
        let isCorrosive = false;
        for (const code of item.hCodes) {
            if (CORROSIVE_H_CODES.has(code)) isCorrosive = true;
            const hGroups = H_CODE_GROUPS[code];
            if (hGroups) hGroups.forEach(g => groups.add(g));
        }
        if (isCorrosive) resolveCorrosiveGroups(item).forEach(g => groups.add(g));
        if (groups.size > 0) {
            evidence.add('h_codes');
            if (item.casNo) evidence.add('cas_number');
        }
    }

    // 2. Name-based classification is a review hint only. Do not promote a
    // text match into a compatibility group, especially FLAMMABLE or
    // ORGANIC_PEROXIDE.
    let matchedNamePattern = false;
    const nameText = item.name.trim();
    if (matchesAny(nameText, INORGANIC_ACID_PATTERNS)) {
        candidateGroups.add('INORGANIC_ACID');
        matchedNamePattern = true;
    }
    if (matchesAny(nameText, ORGANIC_ACID_PATTERNS)) {
        candidateGroups.add('ORGANIC_ACID');
        matchedNamePattern = true;
    }
    if (matchesAny(nameText, BASE_PATTERNS)) {
        candidateGroups.add('BASE');
        matchedNamePattern = true;
    }
    if (matchesAny(nameText, OXIDIZER_PATTERNS)) {
        candidateGroups.add('OXIDIZER');
        matchedNamePattern = true;
    }
    if (matchesAny(nameText, ORGANIC_SOLVENT_PATTERNS)) {
        candidateGroups.add('ORGANIC_SOLVENT');
        matchedNamePattern = true;
    }
    if (matchesAny(nameText, CYANIDE_PATTERNS)) {
        candidateGroups.add('TOXIC_CYANIDE');
        matchedNamePattern = true;
    }
    if (matchesAny(nameText, SULFIDE_PATTERNS)) {
        candidateGroups.add('TOXIC_SULFIDE');
        matchedNamePattern = true;
    }
    if (matchesAny(nameText, AZIDE_PATTERNS)) {
        candidateGroups.add('TOXIC_AZIDE');
        matchedNamePattern = true;
    }
    if (matchesAny(nameText, WATER_REACTIVE_PATTERNS)) {
        candidateGroups.add('WATER_REACTIVE');
        matchedNamePattern = true;
    }
    if (matchesAny(nameText, PYROPHORIC_PATTERNS)) {
        candidateGroups.add('PYROPHORIC');
        matchedNamePattern = true;
    }
    if (matchesAny(nameText, ORGANIC_PEROXIDE_PATTERNS)) {
        candidateGroups.add('ORGANIC_PEROXIDE');
        matchedNamePattern = true;
    }
    if (matchedNamePattern) evidence.add('name_patterns');

    // 3. Legacy flags have no persisted provenance, so they are candidates as
    // well rather than authoritative storage groups.
    // The stored acid flag also fires on Korean base names (수산화…), so a base
    // with no acid name keeps only its base candidate.
    if (item.isAcidic && (!hasBaseEvidence(item) || hasAcidNameEvidence(nameText))) {
        candidateGroups.add('INORGANIC_ACID');
        evidence.add('acid_base_flags');
    }
    if (item.isBasic) {
        candidateGroups.add('BASE');
        evidence.add('acid_base_flags');
    }

    if (groups.size === 0) {
        groups.add('GENERAL');
        evidence.add('fallback_general');
    }

    const resolvedGroups = [...groups];
    const resolvedCandidateGroups = [...candidateGroups].filter((group) => !groups.has(group));
    const hasAuthoritativeHCodeGroup = evidence.has('h_codes') && !groups.has('GENERAL');
    const hasNameOnlyCandidate = !hasAuthoritativeHCodeGroup && resolvedCandidateGroups.length > 0;

    let confidence: StorageClassificationConfidence = 'low';
    if (hasNameOnlyCandidate) {
        confidence = 'review';
    } else if (hasAuthoritativeHCodeGroup || (item.ghsStatus === 'success' && !groups.has('GENERAL'))) {
        confidence = 'high';
    }

    return {
        groups: resolvedGroups,
        candidateGroups: resolvedCandidateGroups,
        primaryGroup: getPrimaryStorageGroup(resolvedGroups),
        confidence,
        evidence: [...evidence],
        needsReview: confidence === 'low' || confidence === 'review',
    };
}

export function classifyStorageGroups(item: ReagentPlacement): StorageGroup[] {
    // Compatibility callers must never consume name-only candidates.
    return classifyStoragePlacement(item).groups;
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
    { ruleId: 'store_inorgacid_azide', groupA: 'INORGANIC_ACID', groupB: 'TOXIC_AZIDE', severity: 'DANGER', messageKey: 'storage_acid_azide' },
    { ruleId: 'store_orgacid_azide', groupA: 'ORGANIC_ACID', groupB: 'TOXIC_AZIDE', severity: 'DANGER', messageKey: 'storage_acid_azide' },
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
    compartment: number;
}

interface RuleMatch {
    rule: StorageRule;
    first: ReagentPlacement;
    second: ReagentPlacement;
}

interface PairFinding {
    matches: RuleMatch[];
    itemIds: Set<string>;
}

type CabinetShelfInput = { id: string; items: ReagentPlacement[]; dividers?: number[] };

const severityRank = (severity: StorageSeverity) => (severity === 'DANGER' ? 0 : 1);
const ruleOrder = (match: RuleMatch) => severityRank(match.rule.severity) * STORAGE_RULES.length
    + STORAGE_RULES.indexOf(match.rule);

/** Same-named bottles share one line, so a pair is keyed by its two names. */
const pairKey = (a: ReagentPlacement, b: ReagentPlacement) =>
    [a.name.trim().toLowerCase(), b.name.trim().toLowerCase()].sort().join('|');

function matchRules(a: ClassifiedItem, b: ClassifiedItem): RuleMatch[] {
    const matches: RuleMatch[] = [];
    for (const rule of STORAGE_RULES) {
        // Special handling: EXPLOSIVE isolate rule — explosive + any non-explosive
        if (rule.ruleId === 'store_explosive_any') {
            const aExplosive = a.groups.includes('EXPLOSIVE');
            const bExplosive = b.groups.includes('EXPLOSIVE');
            if (aExplosive !== bExplosive) {
                matches.push({
                    rule,
                    first: aExplosive ? a.item : b.item,
                    second: aExplosive ? b.item : a.item,
                });
            }
            continue;
        }

        const match =
            (a.groups.includes(rule.groupA) && b.groups.includes(rule.groupB)) ||
            (a.groups.includes(rule.groupB) && b.groups.includes(rule.groupA));
        if (match) matches.push({ rule, first: a.item, second: b.item });
    }
    return matches;
}

/**
 * Pair every item inside the same shelf compartment and collect matched rules
 * per pair. Dividers model physical compartment walls in the 3D cabinet.
 */
function collectPairFindings(
    items: ReagentPlacement[],
    dividers: number[],
    resolveGroups: (item: ReagentPlacement) => StorageGroup[],
    includePair: (a: ReagentPlacement, b: ReagentPlacement) => boolean = () => true,
): PairFinding[] {
    if (items.length < 2) return [];
    const boundaries = normalizeShelfDividers(dividers);

    const classified: ClassifiedItem[] = items.map(item => ({
        item,
        groups: resolveGroups(item),
        // Placement positions are left edges; use the rendered container center.
        compartment: boundaries.filter((boundary) => item.position + item.width / 2 >= boundary).length,
    }));

    const findings = new Map<string, PairFinding>();
    for (let i = 0; i < classified.length; i++) {
        for (let j = i + 1; j < classified.length; j++) {
            const a = classified[i];
            const b = classified[j];
            if (a.compartment !== b.compartment || !includePair(a.item, b.item)) continue;

            const matches = matchRules(a, b);
            if (matches.length === 0) continue;

            const key = pairKey(a.item, b.item);
            const finding = findings.get(key) ?? { matches: [], itemIds: new Set<string>() };
            for (const match of matches) {
                if (!finding.matches.some(existing => existing.rule === match.rule)) finding.matches.push(match);
            }
            finding.itemIds.add(a.item.id);
            finding.itemIds.add(b.item.id);
            findings.set(key, finding);
        }
    }

    return [...findings.values()].map(finding => ({
        ...finding,
        matches: [...finding.matches].sort((x, y) => ruleOrder(x) - ruleOrder(y)),
    }));
}

function summarizeFinding(finding: PairFinding) {
    const [primary] = finding.matches;
    return {
        ruleId: primary.rule.ruleId,
        itemA: primary.first.name,
        itemB: primary.second.name,
        itemAId: primary.first.id,
        itemBId: primary.second.id,
        messageKey: primary.rule.messageKey,
        ruleIds: finding.matches.map(match => match.rule.ruleId),
        messageKeys: [...new Set(finding.matches.map(match => match.rule.messageKey))],
        itemIds: [...finding.itemIds],
    };
}

/**
 * Check storage compatibility within each separate shelf compartment.
 * One line per pair at its highest severity, sorted DANGER first.
 */
export function checkShelfCompatibility(items: ReagentPlacement[], dividers: number[] = []): StorageWarning[] {
    const warnings: StorageWarning[] = collectPairFindings(items, dividers, classifyStorageGroups)
        .map(finding => ({
            severity: finding.matches[0].rule.severity,
            ...summarizeFinding(finding),
        }));

    // Sort: DANGER first, then WARNING, then by rule order for a stable list.
    const ruleIndex = (ruleId: string) => STORAGE_RULES.findIndex(rule => rule.ruleId === ruleId);
    warnings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || ruleIndex(a.ruleId) - ruleIndex(b.ruleId));

    return warnings;
}

/**
 * Check all shelves in the cabinet for incompatible storage.
 * Returns a map of shelf ID → warnings.
 */
export function checkCabinetCompatibility(
    shelves: CabinetShelfInput[]
): Map<string, StorageWarning[]> {
    const results = new Map<string, StorageWarning[]>();
    for (const shelf of shelves) {
        const warnings = checkShelfCompatibility(shelf.items, shelf.dividers || []);
        if (warnings.length > 0) {
            results.set(shelf.id, warnings);
        }
    }
    return results;
}

/**
 * Pairs that would conflict if the unverified name candidates of a reagent
 * awaiting review (e.g. a failed GHS lookup) are right. These are never
 * warnings; they keep the problem visible as "needs review" instead of silent.
 * Pairs already covered by a confirmed warning are left to that warning.
 */
export function checkShelfReviewConflicts(items: ReagentPlacement[], dividers: number[] = []): StorageReviewConflict[] {
    if (items.length < 2) return [];
    const classifications = new Map(items.map(item => [item.id, classifyStoragePlacement(item)] as const));
    const confirmedPairs = new Set(
        collectPairFindings(items, dividers, classifyStorageGroups)
            .map(finding => pairKey(finding.matches[0].first, finding.matches[0].second)),
    );

    const reviewGroups = (item: ReagentPlacement): StorageGroup[] => {
        const classification = classifications.get(item.id)!;
        const groups = new Set<StorageGroup>(classification.groups.filter(group => group !== 'GENERAL'));
        if (!classification.needsReview) return [...groups];
        classification.candidateGroups.forEach(group => groups.add(group));
        // Without verified GHS data a common solvent may well be flammable.
        if (classification.candidateGroups.includes('ORGANIC_SOLVENT') && item.ghsStatus !== 'success') {
            groups.add('FLAMMABLE');
        }
        return [...groups];
    };

    return collectPairFindings(
        items,
        dividers,
        reviewGroups,
        (a, b) => (classifications.get(a.id)!.needsReview || classifications.get(b.id)!.needsReview)
            && !confirmedPairs.has(pairKey(a, b)),
    ).map(summarizeFinding);
}

export function checkCabinetReviewConflicts(
    shelves: CabinetShelfInput[]
): Map<string, StorageReviewConflict[]> {
    const results = new Map<string, StorageReviewConflict[]>();
    for (const shelf of shelves) {
        const conflicts = checkShelfReviewConflicts(shelf.items, shelf.dividers || []);
        if (conflicts.length > 0) results.set(shelf.id, conflicts);
    }
    return results;
}

/** Per-bottle marker for the 3D view: confirmed conflicts win over review. */
export function buildCabinetCompatMarks(
    warningMap: Map<string, StorageWarning[]>,
    reviewMap: Map<string, StorageReviewConflict[]>,
): Map<string, StorageCompatMark> {
    const marks = new Map<string, StorageCompatMark>();
    warningMap.forEach(warnings => warnings.forEach(warning => {
        const mark: StorageCompatMark = warning.severity === 'DANGER' ? 'danger' : 'warning';
        warning.itemIds.forEach(id => {
            if (marks.get(id) !== 'danger') marks.set(id, mark);
        });
    }));
    reviewMap.forEach(conflicts => conflicts.forEach(conflict => {
        conflict.itemIds.forEach(id => {
            if (!marks.has(id)) marks.set(id, 'review');
        });
    }));
    return marks;
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
        TOXIC_AZIDE: 'storage_group_azide',
        ACUTE_TOXIC: 'storage_group_acute_toxic',
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
