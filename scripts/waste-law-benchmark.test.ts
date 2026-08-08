import { describe, expect, it } from 'vitest';
import type { Chemical, WasteBatchDraft, WasteMatrix, WasteStreamCode } from '../src/types';
import { analyzeChemical } from '../src/utils/chemicalAnalyzer';
import {
    analyzeWasteBatch,
    createEmptyWasteBatch,
    createWasteComponentFromAnalysis,
    normalizeWasteAmount,
} from '../src/utils/wasteBatch';

/**
 * V1 national-law / universal-safety benchmark.
 *
 * This is deliberately a safety benchmark, not a claim that Korean law assigns
 * a physical waste bottle to every compound. Its oracle contains only outcomes
 * that are independently clear from legal pH thresholds or universal
 * incompatibility practice: a route, an escalation, or a hard block.
 */
type Expected = {
    id: string;
    basis: 'legal_ph' | 'universal_incompatibility' | 'universal_high_hazard' | 'conservative_data_quality';
    status: 'ready' | 'needs_input' | 'blocked' | 'not_ready';
    streamCode?: WasteStreamCode;
};

type BenchmarkCase = {
    expected: Expected;
    batch: WasteBatchDraft;
};

const amount = (matrix: WasteMatrix) => {
    const unit = matrix === 'solid_slurry' ? 'g' : 'mL';
    const normalized = normalizeWasteAmount(100, unit);
    if (!normalized) throw new Error('Benchmark amount must normalize.');
    return {
        value: 100,
        unit,
        ...normalized,
        isApproximate: false,
        isUnknown: false,
    } as const;
};

function chemical(
    name: string,
    formula: string,
    hCodes: string[] = [],
    casNumber?: string,
): Chemical {
    return {
        id: `${name}:${formula}`,
        name,
        casNumber,
        molecularFormula: formula,
        ghs: { signal: hCodes.length > 0 ? 'Danger' : 'Warning', hazardStatements: hCodes },
    };
}

function batch(
    id: string,
    matrix: WasteMatrix,
    chemicals: Chemical[],
): WasteBatchDraft {
    return {
        ...createEmptyWasteBatch({ id, now: '2026-08-08T00:00:00.000Z' }),
        components: chemicals.map((item, index) => createWasteComponentFromAnalysis(
            analyzeChemical(item),
            {
                cartLineId: `${id}-${index}`,
                // Benchmark inputs model a user-confirmed chemical identity and
                // a retrieved GHS record. The sparse-GHS family intentionally
                // tests whether a *partial* record is treated as sufficient.
                identityConfidence: 'verified',
                ghsDataStatus: 'verified',
            },
        )),
        matrix,
        matrixSource: 'user',
        totalAmount: amount(matrix),
    };
}

function add(
    target: BenchmarkCase[],
    expected: Expected,
    draft: WasteBatchDraft,
): void {
    target.push({ expected, batch: draft });
}

const acids = [
    chemical('Hydrochloric acid', 'HCl', ['H314']),
    chemical('Sulfuric acid', 'H2SO4', ['H314']),
    chemical('Phosphoric acid', 'H3PO4', ['H314']),
    chemical('Hydrobromic acid', 'HBr', ['H314']),
    chemical('Hydroiodic acid', 'HI', ['H314']),
    chemical('Boric acid', 'H3BO3', []),
    chemical('Sulfamic acid', 'NH2SO3H', ['H314']),
    chemical('Methanesulfonic acid', 'CH4O3S', ['H314']),
    chemical('p-Toluenesulfonic acid', 'C7H8O3S', ['H314']),
    chemical('Trifluoroacetic acid', 'C2HF3O2', ['H314']),
];

const cyanides = [
    chemical('Sodium cyanide', 'NaCN', ['H300']),
    chemical('Potassium cyanide', 'KCN', ['H300']),
    chemical('Lithium cyanide', 'LiCN', ['H301']),
    chemical('Calcium cyanide', 'Ca(CN)2', ['H301']),
    chemical('Hydrogen cyanide', 'HCN', ['H300']),
    chemical('Silver cyanide', 'AgCN', ['H301']),
    chemical('Copper cyanide', 'CuCN', ['H301']),
    chemical('Zinc cyanide', 'Zn(CN)2', ['H301']),
    chemical('Mercury cyanide', 'Hg(CN)2', ['H300']),
    chemical('Nickel cyanide', 'Ni(CN)2', ['H301']),
];

const sulfides = [
    chemical('Sodium sulfide', 'Na2S', ['H314']),
    chemical('Potassium sulfide', 'K2S', ['H314']),
    chemical('Hydrogen sulfide', 'H2S', ['H330']),
    chemical('Iron sulfide', 'FeS', []),
    chemical('Zinc sulfide', 'ZnS', []),
    chemical('Cadmium sulfide', 'CdS', ['H301']),
    chemical('Copper sulfide', 'CuS', []),
    chemical('Lead sulfide', 'PbS', []),
    chemical('Ammonium sulfide', '(NH4)2S', ['H314']),
    chemical('Barium sulfide', 'BaS', ['H301']),
];

const oxidizers = [
    chemical('Potassium permanganate', 'KMnO4', ['H272']),
    chemical('Sodium hypochlorite', 'NaClO', ['H272']),
    chemical('Potassium chlorate', 'KClO3', ['H271']),
    chemical('Sodium chlorite', 'NaClO2', ['H271']),
    chemical('Ammonium persulfate', '(NH4)2S2O8', ['H272']),
    chemical('Potassium dichromate', 'K2Cr2O7', ['H272']),
    chemical('Hydrogen peroxide', 'H2O2', ['H271']),
    chemical('Nitric acid', 'HNO3', ['H272', 'H314']),
    chemical('Perchloric acid', 'HClO4', ['H271', 'H314']),
    chemical('Potassium bromate', 'KBrO3', ['H271']),
];

const flammables = [
    chemical('Acetone', 'C3H6O', ['H225'], '67-64-1'),
    chemical('Ethanol', 'C2H6O', ['H225'], '64-17-5'),
    chemical('Methanol', 'CH4O', ['H225'], '67-56-1'),
    chemical('Isopropanol', 'C3H8O', ['H225'], '67-63-0'),
    chemical('Diethyl ether', 'C4H10O', ['H224'], '60-29-7'),
    chemical('Tetrahydrofuran', 'C4H8O', ['H225'], '109-99-9'),
    chemical('Toluene', 'C7H8', ['H225'], '108-88-3'),
    chemical('Hexane', 'C6H14', ['H225'], '110-54-3'),
    chemical('Ethyl acetate', 'C4H8O2', ['H225'], '141-78-6'),
    chemical('Acetonitrile', 'C2H3N', ['H225'], '75-05-8'),
];

const waterReactive = [
    chemical('Calcium carbide', 'CaC2', ['H260']),
    chemical('Sodium hydride', 'NaH', ['H260']),
    chemical('Potassium hydride', 'KH', ['H260']),
    chemical('Lithium hydride', 'LiH', ['H260']),
    chemical('Lithium aluminium hydride', 'LiAlH4', ['H260']),
    chemical('Sodium borohydride', 'NaBH4', ['H260']),
    chemical('Potassium metal', 'K', ['H260']),
    chemical('Sodium metal', 'Na', ['H260']),
    chemical('Lithium metal', 'Li', ['H260']),
    chemical('Calcium metal', 'Ca', ['H261']),
];

const fluorideCases = [
    chemical('Hydrofluoric acid', 'HF', ['H314'], '7664-39-3'),
    chemical('Sodium fluoride', 'NaF', ['H301'], '7681-49-4'),
    chemical('Potassium fluoride', 'KF', ['H301'], '7789-23-3'),
    chemical('Ammonium fluoride', 'NH4F', ['H301'], '12125-01-8'),
    chemical('Ammonium bifluoride', 'NH4HF2', ['H301'], '1341-49-7'),
    chemical('Lithium fluoride', 'LiF', ['H301'], '7789-24-4'),
    chemical('Calcium fluoride', 'CaF2', [], '7789-75-5'),
    chemical('Magnesium fluoride', 'MgF2', [], '7783-40-6'),
    chemical('Aluminium fluoride', 'AlF3', [], '7784-18-1'),
    chemical('Barium fluoride', 'BaF2', ['H301'], '7789-29-9'),
];

const heavyMetals = [
    chemical('Copper sulfate', 'CuSO4', ['H302']),
    chemical('Zinc sulfate', 'ZnSO4', ['H302']),
    chemical('Nickel sulfate', 'NiSO4', ['H351']),
    chemical('Lead nitrate', 'Pb(NO3)2', ['H272', 'H302']),
    chemical('Cadmium chloride', 'CdCl2', ['H301']),
    chemical('Mercury chloride', 'HgCl2', ['H300']),
    chemical('Silver nitrate', 'AgNO3', ['H272']),
    chemical('Chromium(III) chloride', 'CrCl3', []),
    chemical('Cobalt chloride', 'CoCl2', ['H302']),
    chemical('Barium chloride', 'BaCl2', ['H301']),
];

const halogenatedSolvents = [
    chemical('Dichloromethane', 'CH2Cl2', [], '75-09-2'),
    chemical('Chloroform', 'CHCl3', [], '67-66-3'),
    chemical('Carbon tetrachloride', 'CCl4', [], '56-23-5'),
    chemical('Trichloroethylene', 'C2HCl3', [], '79-01-6'),
    chemical('Tetrachloroethylene', 'C2Cl4', [], '127-18-4'),
    chemical('1,2-Dichloroethane', 'C2H4Cl2', [], '107-06-2'),
    chemical('Chlorobenzene', 'C6H5Cl', [], '108-90-7'),
    chemical('Bromobenzene', 'C6H5Br', []),
    chemical('Iodobenzene', 'C6H5I', []),
    chemical('Trifluoroacetic anhydride', 'C4F6O3', []),
];

const nonHalogenatedSolvents = [
    chemical('Acetone', 'C3H6O', ['H225'], '67-64-1'),
    chemical('Ethanol', 'C2H6O', ['H225'], '64-17-5'),
    chemical('Methanol', 'CH4O', ['H225'], '67-56-1'),
    chemical('Isopropanol', 'C3H8O', ['H225'], '67-63-0'),
    chemical('Dimethyl sulfoxide', 'C2H6OS', [], '67-68-5'),
    chemical('Acetonitrile', 'C2H3N', ['H225'], '75-05-8'),
    chemical('Toluene', 'C7H8', ['H225'], '108-88-3'),
    chemical('Hexane', 'C6H14', ['H225'], '110-54-3'),
    chemical('Heptane', 'C7H16', ['H225'], '142-82-5'),
    chemical('Xylene', 'C8H10', ['H225'], '1330-20-7'),
];

// These are real, high-reactivity reagents. A partial GHS record that contains
// no hazard statements must not silently turn them into an ordinary organic
// solvent route. This family intentionally probes a conservative-data gap.
const sparseGhsReactive = [
    chemical('Methyllithium', 'CH3Li'),
    chemical('Ethyllithium', 'C2H5Li'),
    chemical('Propyllithium', 'C3H7Li'),
    chemical('Isopropyllithium', 'C3H7Li'),
    chemical('Phenyllithium', 'C6H5Li'),
    chemical('Vinyllithium', 'C2H3Li'),
    chemical('Allyllithium', 'C3H5Li'),
    chemical('Benzyllithium', 'C7H7Li'),
    chemical('Lithium hexamethyldisilazide', 'C6H18LiNSi2'),
    chemical('Sodium naphthalenide', 'C10H8Na'),
    chemical('Potassium graphite', 'C8K'),
    chemical('Triethylaluminium', 'C6H15Al'),
    chemical('Diethylzinc', 'C4H10Zn'),
    chemical('Oxalyl chloride', 'C2Cl2O2'),
    chemical('Acetyl chloride', 'C2H3ClO'),
    chemical('Benzoyl chloride', 'C7H5ClO'),
    chemical('Thionyl chloride', 'SOCl2'),
    chemical('Phosphorus trichloride', 'PCl3'),
    chemical('Sulfuryl chloride', 'SO2Cl2'),
    chemical('Titanium tetrachloride', 'TiCl4'),
];

function buildBenchmark(): BenchmarkCase[] {
    const cases: BenchmarkCase[] = [];

    // 100 cases: legal corrosivity boundary. The measured final-batch pH,
    // rather than a reagent's reference pH, determines the stream.
    for (const [index, [ph, streamCode]] of ([
        [2, 'ACID_AQUEOUS'], [2.01, 'AQUEOUS_OTHER'], [12.49, 'AQUEOUS_OTHER'], [12.5, 'ALKALI_AQUEOUS'],
    ] as const).entries()) {
        for (let variant = 0; variant < 35; variant += 1) {
            const id = `legal-ph-${index}-${variant}`;
            const draft = batch(id, 'aqueous', [acids[variant % acids.length], chemical('Sodium hydroxide', 'NaOH', ['H314'])]);
            draft.mixingState = 'already_mixed';
            draft.measuredPhStatus = 'measured';
            draft.measuredBatchPh = ph;
            add(cases, { id, basis: 'legal_ph', status: 'ready', streamCode }, draft);
        }
    }

    for (const [family, right] of [
        ['acid-cyanide', cyanides],
        ['acid-sulfide', sulfides],
    ] as const) {
        for (let leftIndex = 0; leftIndex < acids.length; leftIndex += 1) {
            for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
                const id = `${family}-${leftIndex}-${rightIndex}`;
                add(cases, { id, basis: 'universal_incompatibility', status: 'blocked' }, batch(id, 'aqueous', [acids[leftIndex], right[rightIndex]]));
            }
        }
    }

    for (let oxidizerIndex = 0; oxidizerIndex < oxidizers.length; oxidizerIndex += 1) {
        for (let flammableIndex = 0; flammableIndex < flammables.length; flammableIndex += 1) {
            const id = `oxidizer-flammable-${oxidizerIndex}-${flammableIndex}`;
            add(cases, { id, basis: 'universal_incompatibility', status: 'blocked' }, batch(id, 'aqueous', [oxidizers[oxidizerIndex], flammables[flammableIndex]]));
        }
    }

    for (let reactiveIndex = 0; reactiveIndex < waterReactive.length; reactiveIndex += 1) {
        for (let variant = 0; variant < 10; variant += 1) {
            const id = `water-reactive-${reactiveIndex}-${variant}`;
            add(cases, { id, basis: 'universal_incompatibility', status: 'blocked' }, batch(id, 'aqueous', [waterReactive[reactiveIndex], chemical(`Water ${variant}`, 'H2O')]));
        }
    }

    for (const [status, fluorideContainerStatus] of [
        ['ready', 'compatible'], ['needs_input', 'unknown'], ['blocked', 'incompatible'],
    ] as const) {
        for (const item of fluorideCases) {
            for (let variant = 0; variant < 2; variant += 1) {
                const id = `fluoride-${status}-${item.name}-${variant}`;
                const draft = batch(id, 'aqueous', [item]);
                draft.fluorideContainerStatus = fluorideContainerStatus;
                add(cases, { id, basis: 'universal_high_hazard', status, streamCode: 'SPECIAL_REVIEW' }, draft);
            }
        }
    }

    for (let metalIndex = 0; metalIndex < heavyMetals.length; metalIndex += 1) {
        for (let variant = 0; variant < 10; variant += 1) {
            const id = `heavy-metal-${metalIndex}-${variant}`;
            add(cases, { id, basis: 'universal_high_hazard', status: 'ready', streamCode: 'HEAVY_METAL' }, batch(id, 'aqueous', [heavyMetals[metalIndex]]));
        }
    }

    for (const [family, matrix, chemicals, streamCode] of [
        ['halogenated-solvent', 'organic_halogenated', halogenatedSolvents, 'ORGANIC_HALOGENATED'],
        ['non-halogenated-solvent', 'organic_non_halogenated', nonHalogenatedSolvents, 'ORGANIC_NON_HALOGENATED'],
    ] as const) {
        for (let chemicalIndex = 0; chemicalIndex < chemicals.length; chemicalIndex += 1) {
            for (let variant = 0; variant < 10; variant += 1) {
                const id = `${family}-${chemicalIndex}-${variant}`;
                add(cases, { id, basis: 'universal_high_hazard', status: 'ready', streamCode }, batch(id, matrix, [chemicals[chemicalIndex]]));
            }
        }
    }

    for (let chemicalIndex = 0; chemicalIndex < sparseGhsReactive.length; chemicalIndex += 1) {
        for (let variant = 0; variant < 5; variant += 1) {
            const id = `sparse-ghs-reactive-${chemicalIndex}-${variant}`;
            const matrix: WasteMatrix = sparseGhsReactive[chemicalIndex].molecularFormula?.includes('C')
                ? 'organic_non_halogenated'
                : 'aqueous';
            add(cases, { id, basis: 'conservative_data_quality', status: 'not_ready' }, batch(id, matrix, [sparseGhsReactive[chemicalIndex]]));
        }
    }

    return cases;
}

describe('waste-law benchmark v1', () => {
    it('runs 1,000 independently-labelled safety scenarios and reports unsafe automatic routes', () => {
        const cases = buildBenchmark();
        expect(cases).toHaveLength(1_000);

        const results = cases.map(({ expected, batch: draft }) => ({
            expected,
            actual: analyzeWasteBatch(draft),
        }));
        const strictMatches = results.filter(({ expected, actual }) => (
            (expected.status === 'not_ready' ? actual.decisionStatus !== 'ready' : actual.decisionStatus === expected.status)
            && (expected.streamCode === undefined || actual.streamCode === expected.streamCode)
        ));
        const unsafeAutomaticRoutes = results.filter(({ expected, actual }) => (
            expected.status !== 'ready' && actual.decisionStatus === 'ready'
        ));
        const failures = results
            .filter(({ expected }) => !strictMatches.some((match) => match.expected.id === expected.id))
            .map(({ expected, actual }) => ({
                id: expected.id,
                basis: expected.basis,
                expected: expected.status,
                actual: actual.decisionStatus,
                stream: actual.streamCode,
            }));

        console.log(JSON.stringify({
            benchmark: 'waste-law-v1',
            total: results.length,
            strictMatches: strictMatches.length,
            strictMatchRate: Number((strictMatches.length / results.length * 100).toFixed(1)),
            unsafeAutomaticRoutes: unsafeAutomaticRoutes.length,
            failuresByBasis: failures.reduce<Record<string, number>>((counts, failure) => {
                counts[failure.basis] = (counts[failure.basis] ?? 0) + 1;
                return counts;
            }, {}),
            unsafeRoutesByBasis: unsafeAutomaticRoutes.reduce<Record<string, number>>((counts, result) => {
                counts[result.expected.basis] = (counts[result.expected.basis] ?? 0) + 1;
                return counts;
            }, {}),
            unsafeExamples: unsafeAutomaticRoutes.slice(0, 30).map(({ expected, actual }) => ({
                id: expected.id,
                basis: expected.basis,
                actual: actual.decisionStatus,
                stream: actual.streamCode,
            })),
            failures: failures.slice(0, 30),
        }, null, 2));

        // This is the meaningful release gate. A conservative extra block is
        // reviewable; an automatic container-deposit for a labelled hazardous
        // or data-incomplete case is not.
        expect(unsafeAutomaticRoutes).toHaveLength(0);
    });
});
