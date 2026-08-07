import type { PhAcidBaseFamily, PhCatalog, PhCatalogRecord } from './catalogTypes';
import { PH_CATALOG_SOURCE_MANIFEST } from './sourceManifest';
import { PH_STRUCTURE_IDENTITIES } from './identityData';

const USGS = 'USGS-PHREEQC-3.8.8';
const NIST = 'NIST-JPCRD-BUFFERS-2002';
const CURATED = 'BURIL-CURATED-25C-2026-08';

const ANHYDROUS_FORMS = new Set([
    'sodium-hydroxide', 'potassium-hydroxide', 'lithium-hydroxide',
    'sodium-chloride', 'potassium-chloride', 'sodium-nitrate', 'potassium-nitrate',
    'sodium-bisulfate', 'sodium-sulfate', 'potassium-sulfate',
    'sodium-dihydrogen-phosphate', 'disodium-hydrogen-phosphate', 'trisodium-phosphate',
    'potassium-dihydrogen-phosphate', 'dipotassium-hydrogen-phosphate',
    'sodium-fluoride', 'potassium-fluoride', 'sodium-bicarbonate', 'sodium-carbonate',
    'potassium-carbonate', 'ammonium-chloride', 'ammonium-sulfate',
    'sodium-acetate', 'potassium-acetate', 'sodium-formate', 'sodium-propionate',
    'sodium-benzoate', 'sodium-lactate', 'sodium-hydrogen-oxalate', 'disodium-oxalate',
    'disodium-succinate', 'trisodium-citrate', 'tris-hydrochloride',
    'glycine-hydrochloride', 'sodium-glycinate',
]);

const L_STEREOCHEMISTRY = new Set(['l-tartaric-acid', 'l-alanine', 'l-histidine']);
const IMPLICIT_HYDROGEN_ION_FORMS = new Set([
    'hydrochloric-acid', 'hydrobromic-acid', 'hydroiodic-acid', 'nitric-acid',
    'perchloric-acid', 'sulfuric-acid',
]);
const IMPLICIT_HYDROXIDE_ION_FORMS = new Set([
    'sodium-hydroxide', 'potassium-hydroxide', 'lithium-hydroxide',
]);

interface FamilyOptions {
    sourceRefs?: readonly string[];
    /** Explicit manual allowlist marker; provenance alone never implies approval. */
    approved?: true;
    provisionalSteps?: readonly number[];
}

const family = (
    id: string,
    fullyProtonatedCharge: number,
    pKas: readonly number[],
    options: FamilyOptions = {},
): PhAcidBaseFamily => {
    const sourceRefs = options.sourceRefs ?? [CURATED];
    const provisionalSteps = new Set(options.provisionalSteps ?? (options.approved ? [] : pKas.map((_, index) => index)));
    return {
        id,
        fullyProtonatedCharge,
        pKas,
        pKaMetadata: pKas.map((_, index) => {
            const provisional = provisionalSteps.has(index);
            return {
                pKaType: provisional ? 'conditional' : 'thermodynamic',
                temperatureC: 25,
                solvent: 'water',
                ionicStrengthMolal: provisional ? null : 0,
                standardState: provisional ? 'reported_condition' : 'infinite_dilution_molality',
                uncertaintyPka: null,
                approvalStatus: provisional ? 'provisional' : 'approved',
                sourceRefs,
            };
        }),
        sourceRefs,
    };
};

export const PH_ACID_BASE_FAMILIES: readonly PhAcidBaseFamily[] = Object.freeze([
    family('sulfate', -1, [1.987], { sourceRefs: [USGS, NIST], approved: true }),
    family('phosphate', 0, [2.148, 7.198, 12.35], { sourceRefs: [USGS, NIST], approved: true }),
    family('fluoride', 0, [3.17], { sourceRefs: [USGS], approved: true }),
    family('carbonate', 0, [6.351, 10.329], { sourceRefs: [USGS, NIST], approved: true }),
    family('borate', 0, [9.237], { sourceRefs: [USGS, NIST], approved: true }),
    family('ammonium', 1, [9.245], { sourceRefs: [USGS, NIST], approved: true }),
    family('acetate', 0, [4.756], { sourceRefs: [USGS, NIST], approved: true }),
    family('formate', 0, [3.745], { sourceRefs: [USGS], approved: true }),
    family('propionate', 0, [4.874], { sourceRefs: [USGS], approved: true }),
    family('butyrate', 0, [4.819], { sourceRefs: [USGS], approved: true }),
    family('benzoate', 0, [4.202], { sourceRefs: [USGS], approved: true }),
    family('lactate', 0, [3.86]),
    family('oxalate', 0, [1.27, 4.266], { sourceRefs: [NIST], approved: true }),
    family('succinate', 0, [4.207, 5.636], { sourceRefs: [NIST], approved: true }),
    family('malate', 0, [3.40, 5.11]),
    family('tartrate', 0, [3.036, 4.366], { sourceRefs: [USGS, NIST], approved: true }),
    family('citrate', 0, [3.128, 4.761, 6.396], { sourceRefs: [USGS, NIST], approved: true }),
    family('tris', 1, [8.072], { sourceRefs: [NIST], approved: true }),
    family('glycine', 1, [2.351, 9.780], { sourceRefs: [USGS, NIST], approved: true }),
    family('alanine', 1, [2.34, 9.69]),
    family('histidine', 2, [1.54, 6.07, 9.34], { sourceRefs: [NIST], approved: true }),
    family('mes', 0, [6.270], { sourceRefs: [NIST], approved: true }),
    family('mops', 0, [7.184], { sourceRefs: [NIST], approved: true }),
    family('pipes', 0, [2.67, 7.141], { sourceRefs: [NIST], approved: true, provisionalSteps: [0] }),
    family('hepes', 1, [3.00, 7.564], { sourceRefs: [NIST], approved: true, provisionalSteps: [0] }),
    family('ches', 0, [9.394], { sourceRefs: [NIST], approved: true }),
    family('caps', 0, [10.499], { sourceRefs: [NIST], approved: true }),
]);

const record = (
    id: string,
    names: readonly string[],
    casNumber: string | undefined,
    formula: string,
    molecularWeight: number,
    contributions: PhCatalogRecord['contributions'] = [],
    fixedIons: PhCatalogRecord['fixedIons'] = [],
    sourceRefs: readonly string[] = [CURATED],
    flags?: PhCatalogRecord['flags'],
): PhCatalogRecord => ({
    id,
    names,
    casNumber,
    structureIdentity: PH_STRUCTURE_IDENTITIES[id]!,
    exactFormLabel: names[0]!,
    hydration: ANHYDROUS_FORMS.has(id) ? 'anhydrous' : 'not_applicable',
    stereochemistry: L_STEREOCHEMISTRY.has(id) ? 'L' : 'achiral',
    formula,
    molecularWeight,
    kind: id === 'water' ? 'solvent' : 'solute',
    contributions,
    fixedIons,
    implicitWaterIonCharge: IMPLICIT_HYDROGEN_ION_FORMS.has(id)
        ? 1
        : IMPLICIT_HYDROXIDE_ION_FORMS.has(id) ? -1 : undefined,
    sourceRefs,
    flags,
    reviewed: true,
});

const f = (familyId: string, stoichiometry = 1) => ({ familyId, stoichiometry });
const ion = (label: string, charge: number, stoichiometry = 1) => ({ label, charge, stoichiometry });

/**
 * Reviewed input forms, not merely acid names. Salts share an equilibrium family
 * but carry their real counter-ion charge, which is required by electroneutrality.
 */
export const PH_CATALOG_RECORDS: readonly PhCatalogRecord[] = Object.freeze([
    record('water', ['water', 'distilled water', 'deionized water', '물', '증류수', '탈이온수'], '7732-18-5', 'H2O', 18.01528),

    record('hydrochloric-acid', ['hydrochloric acid', '염산'], '7647-01-0', 'HCl', 36.4609, [], [ion('Cl-', -1)], [USGS]),
    record('hydrobromic-acid', ['hydrobromic acid', '브로민화 수소산'], '10035-10-6', 'HBr', 80.9119, [], [ion('Br-', -1)], [USGS]),
    record('hydroiodic-acid', ['hydroiodic acid', '아이오딘화 수소산'], '10034-85-2', 'HI', 127.9124, [], [ion('I-', -1)], [USGS]),
    record('nitric-acid', ['nitric acid', '질산'], '7697-37-2', 'HNO3', 63.0128, [], [ion('NO3-', -1)], [USGS]),
    record('perchloric-acid', ['perchloric acid', '과염소산'], '7601-90-3', 'HClO4', 100.4585, [], [ion('ClO4-', -1)], [USGS], ['unsupported_reactivity']),
    record('sodium-hydroxide', ['sodium hydroxide', '수산화나트륨'], '1310-73-2', 'NaOH', 39.9971, [], [ion('Na+', 1)], [USGS]),
    record('potassium-hydroxide', ['potassium hydroxide', '수산화칼륨'], '1310-58-3', 'KOH', 56.1056, [], [ion('K+', 1)], [USGS]),
    record('lithium-hydroxide', ['lithium hydroxide', '수산화리튬'], '1310-65-2', 'LiOH', 23.948, [], [ion('Li+', 1)], [USGS]),
    record('sodium-chloride', ['sodium chloride (anhydrous)', '무수 염화나트륨'], '7647-14-5', 'NaCl', 58.44, [], [ion('Na+', 1), ion('Cl-', -1)], [USGS]),
    record('potassium-chloride', ['potassium chloride (anhydrous)', '무수 염화칼륨'], '7447-40-7', 'KCl', 74.55, [], [ion('K+', 1), ion('Cl-', -1)], [USGS]),
    record('sodium-nitrate', ['sodium nitrate (anhydrous)', '무수 질산나트륨'], '7631-99-4', 'NaNO3', 84.995, [], [ion('Na+', 1), ion('NO3-', -1)], [USGS]),
    record('potassium-nitrate', ['potassium nitrate (anhydrous)', '무수 질산칼륨'], '7757-79-1', 'KNO3', 101.103, [], [ion('K+', 1), ion('NO3-', -1)], [USGS]),

    // The first proton is represented by electroneutrality against HSO4-/SO4--.
    // It must not be modeled as a fixed +1 ion because H+ remains an equilibrium species.
    record('sulfuric-acid', ['sulfuric acid', '황산'], '7664-93-9', 'H2SO4', 98.0785, [f('sulfate')], [], [USGS]),
    record('sodium-bisulfate', ['sodium bisulfate', 'sodium hydrogen sulfate', '황산수소나트륨'], '7681-38-1', 'NaHSO4', 120.06, [f('sulfate')], [ion('Na+', 1)], [USGS]),
    record('sodium-sulfate', ['sodium sulfate', '황산나트륨'], '7757-82-6', 'Na2SO4', 142.04, [f('sulfate')], [ion('Na+', 1, 2)], [USGS]),
    record('potassium-sulfate', ['potassium sulfate', '황산칼륨'], '7778-80-5', 'K2SO4', 174.26, [f('sulfate')], [ion('K+', 1, 2)], [USGS]),

    record('phosphoric-acid', ['phosphoric acid', '인산'], '7664-38-2', 'H3PO4', 97.994, [f('phosphate')], [], [USGS]),
    record('sodium-dihydrogen-phosphate', ['sodium dihydrogen phosphate', '인산이수소나트륨'], '7558-80-7', 'NaH2PO4', 119.98, [f('phosphate')], [ion('Na+', 1)], [USGS]),
    record('disodium-hydrogen-phosphate', ['disodium hydrogen phosphate', '인산수소이나트륨'], '7558-79-4', 'Na2HPO4', 141.96, [f('phosphate')], [ion('Na+', 1, 2)], [USGS]),
    record('trisodium-phosphate', ['trisodium phosphate', '인산삼나트륨'], '7601-54-9', 'Na3PO4', 163.94, [f('phosphate')], [ion('Na+', 1, 3)], [USGS]),
    record('potassium-dihydrogen-phosphate', ['potassium dihydrogen phosphate', '인산이수소칼륨'], '7778-77-0', 'KH2PO4', 136.09, [f('phosphate')], [ion('K+', 1)], [USGS]),
    record('dipotassium-hydrogen-phosphate', ['dipotassium hydrogen phosphate', '인산수소이칼륨'], '7758-11-4', 'K2HPO4', 174.18, [f('phosphate')], [ion('K+', 1, 2)], [USGS]),

    record('hydrofluoric-acid', ['hydrofluoric acid', '불산', '플루오린화 수소산'], '7664-39-3', 'HF', 20.006, [f('fluoride')], [], [USGS]),
    record('sodium-fluoride', ['sodium fluoride', '플루오린화나트륨'], '7681-49-4', 'NaF', 41.988, [f('fluoride')], [ion('Na+', 1)], [USGS]),
    record('potassium-fluoride', ['potassium fluoride', '플루오린화칼륨'], '7789-23-3', 'KF', 58.0967, [f('fluoride')], [ion('K+', 1)], [USGS]),

    record('boric-acid', ['boric acid', '붕산'], '10043-35-3', 'H3BO3', 61.83, [f('borate')], [], [USGS]),
    record('carbonic-acid', ['carbonic acid equilibrium pool', '탄산 평형 풀'], undefined, 'H2CO3*', 62.025, [f('carbonate')], [], [USGS], ['gas_sensitive']),
    record('sodium-bicarbonate', ['sodium bicarbonate', 'sodium hydrogen carbonate', '탄산수소나트륨'], '144-55-8', 'NaHCO3', 84.007, [f('carbonate')], [ion('Na+', 1)], [USGS], ['gas_sensitive']),
    record('sodium-carbonate', ['sodium carbonate', '탄산나트륨'], '497-19-8', 'Na2CO3', 105.99, [f('carbonate')], [ion('Na+', 1, 2)], [USGS], ['gas_sensitive']),
    record('potassium-carbonate', ['potassium carbonate', '탄산칼륨'], '584-08-7', 'K2CO3', 138.205, [f('carbonate')], [ion('K+', 1, 2)], [USGS], ['gas_sensitive']),

    record('ammonia', ['ammonia (concentration expressed as NH3)', '암모니아(NH3 기준 농도)'], '7664-41-7', 'NH3', 17.031, [f('ammonium')], [], [USGS], ['gas_sensitive']),
    record('ammonium-chloride', ['ammonium chloride', '염화암모늄'], '12125-02-9', 'NH4Cl', 53.491, [f('ammonium')], [ion('Cl-', -1)], [USGS], ['gas_sensitive']),
    record('ammonium-sulfate', ['ammonium sulfate', '황산암모늄'], '7783-20-2', '(NH4)2SO4', 132.14, [f('ammonium', 2), f('sulfate')], [], [USGS], ['gas_sensitive']),

    record('acetic-acid', ['acetic acid', '아세트산', '초산'], '64-19-7', 'CH3COOH', 60.052, [f('acetate')]),
    record('sodium-acetate', ['sodium acetate', '아세트산나트륨'], '127-09-3', 'CH3COONa', 82.034, [f('acetate')], [ion('Na+', 1)]),
    record('potassium-acetate', ['potassium acetate', '아세트산칼륨'], '127-08-2', 'CH3COOK', 98.142, [f('acetate')], [ion('K+', 1)]),
    record('formic-acid', ['formic acid', '개미산'], '64-18-6', 'HCOOH', 46.025, [f('formate')]),
    record('sodium-formate', ['sodium formate', '개미산나트륨'], '141-53-7', 'HCOONa', 68.007, [f('formate')], [ion('Na+', 1)]),
    record('propionic-acid', ['propionic acid', '프로피온산'], '79-09-4', 'C3H6O2', 74.079, [f('propionate')]),
    record('sodium-propionate', ['sodium propionate', '프로피온산나트륨'], '137-40-6', 'C3H5NaO2', 96.06, [f('propionate')], [ion('Na+', 1)]),
    record('butyric-acid', ['butyric acid', 'butanoic acid', '뷰티르산'], '107-92-6', 'C4H8O2', 88.106, [f('butyrate')]),
    record('benzoic-acid', ['benzoic acid', '벤조산'], '65-85-0', 'C7H6O2', 122.123, [f('benzoate')]),
    record('sodium-benzoate', ['sodium benzoate', '벤조산나트륨'], '532-32-1', 'C7H5NaO2', 144.105, [f('benzoate')], [ion('Na+', 1)]),
    record('lactic-acid', ['lactic acid', '젖산'], '50-21-5', 'C3H6O3', 90.078, [f('lactate')]),
    record('sodium-lactate', ['sodium lactate', '젖산나트륨'], '72-17-3', 'C3H5NaO3', 112.06, [f('lactate')], [ion('Na+', 1)]),

    record('oxalic-acid', ['oxalic acid', '옥살산'], '144-62-7', 'H2C2O4', 90.034, [f('oxalate')]),
    record('sodium-hydrogen-oxalate', ['sodium hydrogen oxalate (anhydrous)', '무수 옥살산수소나트륨'], '1186-49-8', 'NaHC2O4', 112.016, [f('oxalate')], [ion('Na+', 1)]),
    record('disodium-oxalate', ['disodium oxalate', '옥살산나트륨'], '62-76-0', 'Na2C2O4', 134.0, [f('oxalate')], [ion('Na+', 1, 2)]),
    record('succinic-acid', ['succinic acid', '숙신산'], '110-15-6', 'C4H6O4', 118.09, [f('succinate')]),
    record('disodium-succinate', ['disodium succinate', '숙신산이나트륨'], '150-90-3', 'C4H4Na2O4', 162.05, [f('succinate')], [ion('Na+', 1, 2)]),
    record('malic-acid', ['malic acid', '말산'], '6915-15-7', 'C4H6O5', 134.087, [f('malate')]),
    record('l-tartaric-acid', ['L-(+)-tartaric acid', 'L-(+)-타르타르산'], '87-69-4', 'C4H6O6', 150.087, [f('tartrate')]),
    record('citric-acid', ['citric acid', '구연산', '시트르산'], '77-92-9', 'C6H8O7', 192.124, [f('citrate')]),
    record('trisodium-citrate', ['trisodium citrate', '구연산삼나트륨'], '68-04-2', 'Na3C6H5O7', 258.07, [f('citrate')], [ion('Na+', 1, 3)]),

    record('tris-base', ['tris', 'tris base', '트리스'], '77-86-1', 'C4H11NO3', 121.14, [f('tris')]),
    record('tris-hydrochloride', ['tris hydrochloride', 'tris-hcl', '트리스 염산염'], '1185-53-1', 'C4H12ClNO3', 157.60, [f('tris')], [ion('Cl-', -1)]),
    record('glycine', ['glycine', '글리신'], '56-40-6', 'C2H5NO2', 75.067, [f('glycine')]),
    record('glycine-hydrochloride', ['glycine hydrochloride', '글리신 염산염'], '6000-43-7', 'C2H6ClNO2', 111.53, [f('glycine')], [ion('Cl-', -1)]),
    record('sodium-glycinate', ['sodium glycinate', '글리신나트륨'], '6000-44-8', 'C2H4NNaO2', 97.05, [f('glycine')], [ion('Na+', 1)]),
    record('l-alanine', ['L-alanine', 'L-알라닌'], '56-41-7', 'C3H7NO2', 89.094, [f('alanine')]),
    record('l-histidine', ['L-histidine', 'L-히스티딘'], '71-00-1', 'C6H9N3O2', 155.16, [f('histidine')]),

    record('mes', ['MES free acid', '2-(N-morpholino)ethanesulfonic acid'], '4432-31-9', 'C6H13NO4S', 195.24, [f('mes')]),
    record('mops', ['MOPS free acid', '3-(N-morpholino)propanesulfonic acid'], '1132-61-2', 'C7H15NO4S', 209.26, [f('mops')]),
    record('pipes', ['PIPES free acid'], '5625-37-6', 'C8H18N2O6S2', 302.37, [f('pipes')]),
    record('hepes', ['HEPES free acid'], '7365-45-9', 'C8H18N2O4S', 238.30, [f('hepes')]),
    record('ches', ['CHES free acid'], '103-47-9', 'C8H17NO3S', 207.29, [f('ches')]),
    record('caps', ['CAPS free acid'], '1135-40-6', 'C9H19NO3S', 221.32, [f('caps')]),
]);

export const DEFAULT_PH_CATALOG: PhCatalog = Object.freeze({
    version: PH_CATALOG_SOURCE_MANIFEST.catalogVersion,
    temperatureC: 25,
    sourceIds: PH_CATALOG_SOURCE_MANIFEST.sources.map((source) => source.id),
    records: PH_CATALOG_RECORDS,
    families: PH_ACID_BASE_FAMILIES,
});

export const PH_CATALOG_BY_ID = new Map(PH_CATALOG_RECORDS.map((entry) => [entry.id, entry]));

const byCas = new Map<string, PhCatalogRecord[]>();
for (const entry of PH_CATALOG_RECORDS) {
    if (!entry.casNumber) continue;
    const matches = byCas.get(entry.casNumber) ?? [];
    matches.push(entry);
    byCas.set(entry.casNumber, matches);
}

/** CAS fallback is intentionally accepted only when it identifies one exact catalog form. */
export const findPhCatalogRecordByCas = (casNumber: string | undefined): PhCatalogRecord | undefined => {
    if (!casNumber) return undefined;
    const matches = byCas.get(casNumber.trim());
    return matches?.length === 1 ? matches[0] : undefined;
};

const normalizedFormula = (formula: string | undefined): string =>
    formula?.replace(/\s+/g, '').replace(/\((?:aq|s|l|g)\)$/i, '').toUpperCase() ?? '';

/** Formula matches are suggestions only and must never approve an identity for calculation. */
export const suggestPhCatalogRecordsByFormula = (formula: string | undefined): PhCatalogRecord[] => {
    const normalized = normalizedFormula(formula);
    if (!normalized) return [];
    return PH_CATALOG_RECORDS.filter((entry) => normalizedFormula(entry.formula) === normalized);
};
