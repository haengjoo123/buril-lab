import { describe, expect, it } from 'vitest';
import type {
    ConcentrationUnit,
    WasteBatchDraft,
    WasteComponent,
    WasteConcentrationBasis,
} from '../../types';
import {
    PH_CATALOG_RECORDS,
    PH_ACID_BASE_FAMILIES,
    PH_CATALOG_SOURCE_MANIFEST,
    PH_CATALOG_VALIDATION_EVIDENCE,
    PH_PREDICTION_ISSUES,
    DEFAULT_PH_CATALOG,
    convertConcentrationToMolar,
    hashPredictionInput,
    predictAqueousPh,
    validatePhCatalog,
} from './index';
import { PHREEQC_GOLDEN_RESULTS } from './fixtures/phreeqcGolden';
import phreeqcSelectedOutput from './fixtures/phreeqc-v3.8.8-golden.sel?raw';

interface ComponentOptions {
    id?: string;
    catalogId: string;
    cas: string;
    concentration?: number;
    unit?: ConcentrationUnit;
    basis?: WasteConcentrationBasis;
    density?: { value: number; kind: 'solution' | 'solute'; source?: 'catalog' | 'user'; isEstimate?: boolean };
    volume?: number;
    volumeUnit?: 'uL' | 'mL' | 'L';
    hazardFlags?: WasteComponent['hazardFlags'];
    identityVerified?: boolean;
}

const component = ({
    id,
    catalogId,
    cas,
    concentration = 0.001,
    unit = 'M',
    basis,
    density,
    volume = 50,
    volumeUnit = 'mL',
    hazardFlags = [],
    identityVerified = true,
}: ComponentOptions): WasteComponent => ({
    cartLineId: id ?? `${catalogId}-${volume}-${concentration}`,
    sourceType: 'manual',
    identityConfidence: identityVerified ? 'verified' : 'unknown',
    ghsDataStatus: 'verified',
    capturedAt: '2026-08-04T00:00:00.000Z',
    hazardFlags,
    phCatalogId: catalogId,
    solutionVolume: {
        value: volume,
        unit: volumeUnit,
        normalizedMl: volumeUnit === 'L' ? volume * 1_000 : volumeUnit === 'uL' ? volume / 1_000 : volume,
    },
    concentration: catalogId === 'water' ? undefined : {
        value: concentration,
        unit,
        basis,
        density: density ? { ...density, unit: 'g/mL' } : undefined,
    },
    solutionContext: catalogId === 'water' ? undefined : {
        physicalForm: 'aqueous',
        solventClass: 'aqueous',
        solventName: 'Water',
        isSolventVerified: true,
        solventResolution: 'user',
        solventCasNumber: '7732-18-5',
        solventMolecularFormula: 'H2O',
    },
    chemical: {
        id: catalogId,
        name: catalogId,
        casNumber: cas,
        molecularFormula: '',
    },
    category: 'NEUTRAL',
    binColor: '',
    label: '',
    reason: '',
    isSafe: true,
});

const batch = (
    components: WasteComponent[],
    overrides: Partial<WasteBatchDraft> = {},
): WasteBatchDraft => ({
    id: 'batch-1',
    scopeKey: 'local',
    components,
    matrix: 'aqueous',
    matrixSource: 'user',
    totalAmount: {
        value: 100,
        unit: 'mL',
        normalizedValue: 100,
        normalizedUnit: 'mL',
        isApproximate: false,
        isUnknown: false,
    },
    measuredPhStatus: 'unknown',
    mixingState: 'already_mixed',
    additionalComponentsStatus: 'none',
    incidentContext: 'none',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
});

describe('pH concentration and volume inputs', () => {
    it('converts M, mM, and mg/mL to molarity', () => {
        expect(convertConcentrationToMolar({ value: 0.5, unit: 'M' }, 40)).toMatchObject({ ok: true, molar: 0.5 });
        expect(convertConcentrationToMolar({ value: 500, unit: 'mM' }, 40)).toMatchObject({ ok: true, molar: 0.5 });
        expect(convertConcentrationToMolar({ value: 20, unit: 'mg/mL' }, 40)).toMatchObject({ ok: true, molar: 0.5 });
    });

    it('uses explicit percent basis and density rules', () => {
        expect(convertConcentrationToMolar({ value: 2, unit: '%', basis: 'w_v' }, 40))
            .toMatchObject({ ok: true, molar: 0.5 });
        expect(convertConcentrationToMolar({
            value: 2,
            unit: '%',
            basis: 'w_w',
            density: { value: 1.2, unit: 'g/mL', kind: 'solution', source: 'catalog' },
        }, 40)).toMatchObject({ ok: true, molar: 0.6 });
        expect(convertConcentrationToMolar({
            value: 2,
            unit: '%',
            basis: 'v_v',
            density: { value: 0.8, unit: 'g/mL', kind: 'solute', source: 'catalog' },
        }, 40)).toMatchObject({ ok: true, molar: 0.4 });
        expect(convertConcentrationToMolar({
            value: 37,
            unit: '%',
            basis: 'w_w',
            density: { value: 1.19, unit: 'g/mL', kind: 'solution', source: 'catalog' },
        }, 36.4609)).toMatchObject({ ok: true, molar: expect.closeTo(12.08, 2) });
    });

    it('does not guess a percent basis or required density', () => {
        expect(convertConcentrationToMolar({ value: 2, unit: '%' }, 40))
            .toEqual({ ok: false, issue: PH_PREDICTION_ISSUES.PERCENT_BASIS_REQUIRED });
        expect(convertConcentrationToMolar({ value: 2, unit: '%', basis: 'w_w' }, 40))
            .toEqual({ ok: false, issue: PH_PREDICTION_ISSUES.DENSITY_REQUIRED });
        expect(convertConcentrationToMolar({
            value: 2,
            unit: '%',
            basis: 'w_w',
            density: { value: 1, unit: 'g/mL', kind: 'solute' },
        }, 40)).toEqual({ ok: false, issue: PH_PREDICTION_ISSUES.DENSITY_KIND_MISMATCH });
    });

    it('marks density not verified at 25 C as approximate input data', () => {
        expect(convertConcentrationToMolar({
            value: 2,
            unit: '%',
            basis: 'w_w',
            density: { value: 1.2, unit: 'g/mL', kind: 'solution', source: 'catalog', temperatureC: 20 },
        }, 40)).toMatchObject({
            ok: true,
            approximateIssues: [PH_PREDICTION_ISSUES.DENSITY_TEMPERATURE_ASSUMED],
        });
    });
});

describe('solution-context confidence gate', () => {
    it('keeps user-confirmed aqueous fallback numeric but approximate', () => {
        const unknownCarrier = component({
            catalogId: 'acetic-acid',
            cas: '64-19-7',
            concentration: 0.01,
            volume: 100,
        });
        unknownCarrier.solutionContext = {
            physicalForm: 'mixed_or_unknown',
            solventClass: 'mixed_or_unknown',
            isSolventVerified: false,
            solventResolution: 'user',
        };
        const prediction = predictAqueousPh(batch([unknownCarrier], {
            totalAmount: {
                value: 100,
                unit: 'mL',
                normalizedValue: 100,
                normalizedUnit: 'mL',
                isApproximate: false,
                isUnknown: false,
            },
        }));
        expect(prediction.value).toBeDefined();
        expect(prediction.status).toBe('approximate');
        expect(prediction.confidence).toBe('approximate');
        expect(prediction.issueCodes).toContain(PH_PREDICTION_ISSUES.COMPONENT_SOLVENT_ASSUMED_AQUEOUS);
        expect(prediction.assumptions).toContain('component_solvent_assumed_aqueous_from_batch_confirmation');
    });

    it('blocks a pH number when an organic carrier is explicit', () => {
        const dcmCarrier = component({ catalogId: 'acetic-acid', cas: '64-19-7' });
        dcmCarrier.solutionContext = {
            physicalForm: 'organic_solvent',
            solventClass: 'organic_halogen',
            solventName: 'Dichloromethane',
            solventCasNumber: '75-09-2',
            solventMolecularFormula: 'CH2Cl2',
            isSolventVerified: true,
            solventResolution: 'user',
        };
        expect(predictAqueousPh(batch([dcmCarrier]))).toMatchObject({
            status: 'unsupported',
            issueCodes: [PH_PREDICTION_ISSUES.COMPONENT_SOLVENT_NOT_AQUEOUS],
        });
        expect(predictAqueousPh(batch([dcmCarrier])).value).toBeUndefined();
    });
});

describe('aqueous charge-balance prediction', () => {
    it('solves a dilute strong acid with Davies activity correction', () => {
        const result = predictAqueousPh(batch([
            component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0' }),
            component({ catalogId: 'water', cas: '7732-18-5' }),
        ]));
        expect(result.status).toBe('available');
        expect(result.value).toBeCloseTo(3.31, 1);
        expect(result.displayValue).toBe(3.3);
        expect(result.ionicStrength).toBeCloseTo(0.0005, 4);
    });

    it('handles equimolar and excess strong acid/base mixtures without changing measured pH', () => {
        const neutral = batch([
            component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', id: 'acid' }),
            component({ catalogId: 'sodium-hydroxide', cas: '1310-73-2', id: 'base' }),
        ], { measuredBatchPh: 8.4, measuredPhStatus: 'measured' });
        const neutralResult = predictAqueousPh(neutral);
        expect(neutralResult.value).toBeCloseTo(7, 5);
        expect(neutral.measuredBatchPh).toBe(8.4);

        const acidExcess = predictAqueousPh(batch([
            component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', concentration: 0.002, id: 'acid' }),
            component({ catalogId: 'sodium-hydroxide', cas: '1310-73-2', concentration: 0.001, id: 'base' }),
        ]));
        expect(acidExcess.value).toBeCloseTo(3.3, 1);
    });

    it('models sulfuric acid without treating its first proton as a fixed spectator ion', () => {
        const sulfuric = predictAqueousPh(batch([
            component({ catalogId: 'sulfuric-acid', cas: '7664-93-9', concentration: 0.001, volume: 100 }),
        ]));
        expect(sulfuric.value).toBeDefined();
        expect(sulfuric.value!).toBeLessThan(3);

        const neutralized = predictAqueousPh(batch([
            component({ catalogId: 'sulfuric-acid', cas: '7664-93-9', concentration: 0.001, volume: 50, id: 'acid' }),
            component({ catalogId: 'sodium-hydroxide', cas: '1310-73-2', concentration: 0.002, volume: 50, id: 'base' }),
        ]));
        expect(neutralized.value).toBeDefined();
        expect(neutralized.value!).toBeGreaterThan(6);
    });

    it('includes water autoionization for very dilute acid and base', () => {
        const diluteAcid = predictAqueousPh(batch([
            component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', concentration: 1e-8, volume: 100 }),
        ]));
        const diluteBase = predictAqueousPh(batch([
            component({ catalogId: 'sodium-hydroxide', cas: '1310-73-2', concentration: 1e-8, volume: 100 }),
        ]));
        expect(diluteAcid.value).toBeCloseTo(6.98, 1);
        expect(diluteBase.value).toBeCloseTo(7.02, 1);
    });

    it('includes ordinary neutral salts in ionic strength without inventing acidity', () => {
        const saline = predictAqueousPh(batch([
            component({ catalogId: 'sodium-chloride', cas: '7647-14-5', concentration: 0.05, volume: 100 }),
        ]));
        expect(saline.value).toBeCloseTo(7, 5);
        expect(saline.ionicStrength).toBeCloseTo(0.05, 4);
        expect(saline.status).toBe('approximate');
        expect(saline.issueCodes).toContain(PH_PREDICTION_ISSUES.IONIC_STRENGTH_APPROXIMATE);
    });

    it('solves weak acid, buffer, polyprotic, and amphoteric systems', () => {
        const acetic = predictAqueousPh(batch([
            component({ catalogId: 'acetic-acid', cas: '64-19-7', volume: 100 }),
        ]));
        expect(acetic.value).toBeCloseTo(3.91, 1);

        const acetateBuffer = predictAqueousPh(batch([
            component({ catalogId: 'acetic-acid', cas: '64-19-7', concentration: 0.01, id: 'acid' }),
            component({ catalogId: 'sodium-acetate', cas: '127-09-3', concentration: 0.01, id: 'salt' }),
        ]));
        expect(acetateBuffer.value).toBeCloseTo(4.75, 1);

        const phosphateBuffer = predictAqueousPh(batch([
            component({ catalogId: 'sodium-dihydrogen-phosphate', cas: '7558-80-7', id: 'acid' }),
            component({ catalogId: 'disodium-hydrogen-phosphate', cas: '7558-79-4', id: 'base' }),
        ]));
        expect(phosphateBuffer.value).toBeCloseTo(7.14, 1);

        const glycine = predictAqueousPh(batch([
            component({ catalogId: 'glycine', cas: '56-40-6', concentration: 0.1, volume: 100 }),
        ]));
        expect(glycine.value).toBeCloseTo(6.07, 1);
    });

    it('does not emit a number for ammonia or carbonate systems where gas exchange is important', () => {
        const result = predictAqueousPh(batch([
            component({ catalogId: 'ammonium-chloride', cas: '12125-02-9', volume: 100 }),
        ]));
        expect(result.status).toBe('unsupported');
        expect(result.value).toBeUndefined();
        expect(result.issueCodes).toContain(PH_PREDICTION_ISSUES.GAS_SENSITIVE_CLOSED_SYSTEM);

        const carbonate = predictAqueousPh(batch([
            component({ catalogId: 'sodium-bicarbonate', cas: '144-55-8', volume: 100 }),
        ]));
        expect(carbonate.status).toBe('unsupported');
        expect(carbonate.value).toBeUndefined();
    });

    it('uses the exact final batch volume, otherwise labels volume additivity as approximate', () => {
        const exact = predictAqueousPh(batch([
            component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', volume: 50 }),
            component({ catalogId: 'water', cas: '7732-18-5', volume: 50 }),
        ]));
        const estimated = predictAqueousPh(batch([
            component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', volume: 50 }),
            component({ catalogId: 'water', cas: '7732-18-5', volume: 50 }),
        ], {
            totalAmount: {
                value: null,
                unit: null,
                normalizedValue: null,
                normalizedUnit: null,
                isApproximate: false,
                isUnknown: true,
            },
        }));
        expect(exact.status).toBe('available');
        expect(estimated.status).toBe('approximate');
        expect(estimated.issueCodes).toContain(PH_PREDICTION_ISSUES.VOLUME_ADDITIVITY_ASSUMED);
    });

    it('rejects high ionic strength and pH outside the supported range without returning a pH number', () => {
        const highIonicStrength = predictAqueousPh(batch([
            component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', concentration: 0.3, volume: 100 }),
        ]));
        expect(highIonicStrength.status).toBe('unsupported');
        expect(highIonicStrength.value).toBeUndefined();
        expect(highIonicStrength.issueCodes).toContain(PH_PREDICTION_ISSUES.IONIC_STRENGTH_OUT_OF_RANGE);

        const extremePh = predictAqueousPh(batch([
            component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', concentration: 0.2, volume: 100 }),
        ]));
        expect(extremePh.status).toBe('unsupported');
        expect(extremePh.value).toBeUndefined();
        expect(extremePh.issueCodes).toContain(PH_PREDICTION_ISSUES.PH_OUT_OF_RANGE);
    });

    it('rejects concentrated weak solutes even when dissociation keeps ionic strength low', () => {
        const concentratedAceticAcid = predictAqueousPh(batch([
            component({ catalogId: 'acetic-acid', cas: '64-19-7', concentration: 1, volume: 100 }),
        ]));
        expect(concentratedAceticAcid.status).toBe('unsupported');
        expect(concentratedAceticAcid.value).toBeUndefined();
        expect(concentratedAceticAcid.issueCodes)
            .toContain(PH_PREDICTION_ISSUES.ANALYTICAL_CONCENTRATION_OUT_OF_RANGE);
    });

    it('matches pinned independent PHREEQC golden values within 0.1 pH', () => {
        const cases = [
            {
                id: 'diluteHcl',
                expected: PHREEQC_GOLDEN_RESULTS.diluteHcl.pH,
                components: [
                    component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0' }),
                    component({ catalogId: 'water', cas: '7732-18-5' }),
                ],
            },
            {
                id: 'acetateBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.acetateBuffer.pH,
                components: [
                    component({ catalogId: 'acetic-acid', cas: '64-19-7', concentration: 0.01, id: 'acid' }),
                    component({ catalogId: 'sodium-acetate', cas: '127-09-3', concentration: 0.01, id: 'salt' }),
                ],
            },
            {
                id: 'phosphateBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.phosphateBuffer.pH,
                components: [
                    component({ catalogId: 'sodium-dihydrogen-phosphate', cas: '7558-80-7', id: 'acid' }),
                    component({ catalogId: 'disodium-hydrogen-phosphate', cas: '7558-79-4', id: 'base' }),
                ],
            },
            {
                id: 'sulfuricAcid',
                expected: PHREEQC_GOLDEN_RESULTS.sulfuricAcid.pH,
                components: [
                    component({ catalogId: 'sulfuric-acid', cas: '7664-93-9', concentration: 0.001, volume: 100 }),
                ],
            },
            {
                id: 'sulfateAfterTwoEquivalentsNaoh',
                expected: PHREEQC_GOLDEN_RESULTS.sulfateAfterTwoEquivalentsNaoh.pH,
                components: [
                    component({ catalogId: 'sulfuric-acid', cas: '7664-93-9', concentration: 0.001, volume: 50, id: 'acid' }),
                    component({ catalogId: 'sodium-hydroxide', cas: '1310-73-2', concentration: 0.002, volume: 50, id: 'base' }),
                ],
            },
            {
                id: 'glycine',
                expected: PHREEQC_GOLDEN_RESULTS.glycine.pH,
                components: [
                    component({ catalogId: 'glycine', cas: '56-40-6', concentration: 0.1, volume: 100 }),
                ],
            },
            {
                id: 'diluteNaoh',
                expected: PHREEQC_GOLDEN_RESULTS.diluteNaoh.pH,
                components: [
                    component({ catalogId: 'sodium-hydroxide', cas: '1310-73-2' }),
                    component({ catalogId: 'water', cas: '7732-18-5' }),
                ],
            },
            {
                id: 'strongAcidBaseEquivalence',
                expected: PHREEQC_GOLDEN_RESULTS.strongAcidBaseEquivalence.pH,
                components: [
                    component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', id: 'acid' }),
                    component({ catalogId: 'sodium-hydroxide', cas: '1310-73-2', id: 'base' }),
                ],
            },
            {
                id: 'hclExcessAfterNeutralization',
                expected: PHREEQC_GOLDEN_RESULTS.hclExcessAfterNeutralization.pH,
                components: [
                    component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', concentration: 0.003, id: 'acid' }),
                    component({ catalogId: 'sodium-hydroxide', cas: '1310-73-2', concentration: 0.001, id: 'base' }),
                ],
            },
            {
                id: 'naohExcessAfterNeutralization',
                expected: PHREEQC_GOLDEN_RESULTS.naohExcessAfterNeutralization.pH,
                components: [
                    component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', concentration: 0.001, id: 'acid' }),
                    component({ catalogId: 'sodium-hydroxide', cas: '1310-73-2', concentration: 0.003, id: 'base' }),
                ],
            },
            {
                id: 'acetateAcidRichBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.acetateAcidRichBuffer.pH,
                components: [
                    component({ catalogId: 'acetic-acid', cas: '64-19-7', concentration: 0.018, id: 'acid' }),
                    component({ catalogId: 'sodium-acetate', cas: '127-09-3', concentration: 0.002, id: 'salt' }),
                ],
            },
            {
                id: 'acetateBaseRichBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.acetateBaseRichBuffer.pH,
                components: [
                    component({ catalogId: 'acetic-acid', cas: '64-19-7', concentration: 0.002, id: 'acid' }),
                    component({ catalogId: 'sodium-acetate', cas: '127-09-3', concentration: 0.018, id: 'salt' }),
                ],
            },
            {
                id: 'formateBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.formateBuffer.pH,
                components: [
                    component({ catalogId: 'formic-acid', cas: '64-18-6', concentration: 0.01, id: 'acid' }),
                    component({ catalogId: 'sodium-formate', cas: '141-53-7', concentration: 0.01, id: 'salt' }),
                ],
            },
            {
                id: 'propionateBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.propionateBuffer.pH,
                components: [
                    component({ catalogId: 'propionic-acid', cas: '79-09-4', concentration: 0.01, id: 'acid' }),
                    component({ catalogId: 'sodium-propionate', cas: '137-40-6', concentration: 0.01, id: 'salt' }),
                ],
            },
            {
                id: 'benzoateBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.benzoateBuffer.pH,
                components: [
                    component({ catalogId: 'benzoic-acid', cas: '65-85-0', concentration: 0.002, id: 'acid' }),
                    component({ catalogId: 'sodium-benzoate', cas: '532-32-1', concentration: 0.002, id: 'salt' }),
                ],
            },
            {
                id: 'phosphateFirstStepBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.phosphateFirstStepBuffer.pH,
                components: [
                    component({ catalogId: 'phosphoric-acid', cas: '7664-38-2', concentration: 0.01, id: 'acid' }),
                    component({ catalogId: 'sodium-dihydrogen-phosphate', cas: '7558-80-7', concentration: 0.01, id: 'salt' }),
                ],
            },
            {
                id: 'phosphateThirdStepBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.phosphateThirdStepBuffer.pH,
                components: [
                    component({ catalogId: 'disodium-hydrogen-phosphate', cas: '7558-79-4', concentration: 0.0005, id: 'acid' }),
                    component({ catalogId: 'trisodium-phosphate', cas: '7601-54-9', concentration: 0.0005, id: 'base' }),
                ],
            },
            {
                id: 'sulfateBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.sulfateBuffer.pH,
                components: [
                    component({ catalogId: 'sodium-bisulfate', cas: '7681-38-1', id: 'acid' }),
                    component({ catalogId: 'sodium-sulfate', cas: '7757-82-6', id: 'base' }),
                ],
            },
            {
                id: 'fluorideBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.fluorideBuffer.pH,
                components: [
                    component({ catalogId: 'hydrofluoric-acid', cas: '7664-39-3', concentration: 0.01, id: 'acid' }),
                    component({ catalogId: 'sodium-fluoride', cas: '7681-49-4', concentration: 0.01, id: 'salt' }),
                ],
            },
            {
                id: 'boricAcid',
                expected: PHREEQC_GOLDEN_RESULTS.boricAcid.pH,
                components: [component({ catalogId: 'boric-acid', cas: '10043-35-3', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'halfNeutralizedBoricAcid',
                expected: PHREEQC_GOLDEN_RESULTS.halfNeutralizedBoricAcid.pH,
                components: [
                    component({ catalogId: 'boric-acid', cas: '10043-35-3', concentration: 0.002, id: 'acid' }),
                    component({ catalogId: 'sodium-hydroxide', cas: '1310-73-2', concentration: 0.001, id: 'base' }),
                ],
            },
            {
                id: 'glycineAcidBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.glycineAcidBuffer.pH,
                components: [
                    component({ catalogId: 'glycine-hydrochloride', cas: '6000-43-7', concentration: 0.01, id: 'acid' }),
                    component({ catalogId: 'glycine', cas: '56-40-6', concentration: 0.01, id: 'base' }),
                ],
            },
            {
                id: 'glycineBaseBuffer',
                expected: PHREEQC_GOLDEN_RESULTS.glycineBaseBuffer.pH,
                components: [
                    component({ catalogId: 'glycine', cas: '56-40-6', concentration: 0.01, id: 'acid' }),
                    component({ catalogId: 'sodium-glycinate', cas: '6000-44-8', concentration: 0.01, id: 'base' }),
                ],
            },
            {
                id: 'diluteNitricAcid',
                expected: PHREEQC_GOLDEN_RESULTS.diluteNitricAcid.pH,
                components: [component({ catalogId: 'nitric-acid', cas: '7697-37-2', concentration: 0.0005, volume: 100 })],
            },
            {
                id: 'phosphoricAcid',
                expected: PHREEQC_GOLDEN_RESULTS.phosphoricAcid.pH,
                components: [component({ catalogId: 'phosphoric-acid', cas: '7664-38-2', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'sodiumFluoride',
                expected: PHREEQC_GOLDEN_RESULTS.sodiumFluoride.pH,
                components: [component({ catalogId: 'sodium-fluoride', cas: '7681-49-4', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'formicAcid',
                expected: PHREEQC_GOLDEN_RESULTS.formicAcid.pH,
                components: [component({ catalogId: 'formic-acid', cas: '64-18-6', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'propionicAcid',
                expected: PHREEQC_GOLDEN_RESULTS.propionicAcid.pH,
                components: [component({ catalogId: 'propionic-acid', cas: '79-09-4', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'benzoicAcid',
                expected: PHREEQC_GOLDEN_RESULTS.benzoicAcid.pH,
                components: [component({ catalogId: 'benzoic-acid', cas: '65-85-0', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'aceticAcid',
                expected: PHREEQC_GOLDEN_RESULTS.aceticAcid.pH,
                components: [component({ catalogId: 'acetic-acid', cas: '64-19-7', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'sodiumAcetate',
                expected: PHREEQC_GOLDEN_RESULTS.sodiumAcetate.pH,
                components: [component({ catalogId: 'sodium-acetate', cas: '127-09-3', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'sodiumPropionate',
                expected: PHREEQC_GOLDEN_RESULTS.sodiumPropionate.pH,
                components: [component({ catalogId: 'sodium-propionate', cas: '137-40-6', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'sodiumBenzoate',
                expected: PHREEQC_GOLDEN_RESULTS.sodiumBenzoate.pH,
                components: [component({ catalogId: 'sodium-benzoate', cas: '532-32-1', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'sodiumFormate',
                expected: PHREEQC_GOLDEN_RESULTS.sodiumFormate.pH,
                components: [component({ catalogId: 'sodium-formate', cas: '141-53-7', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'sodiumBisulfate',
                expected: PHREEQC_GOLDEN_RESULTS.sodiumBisulfate.pH,
                components: [component({ catalogId: 'sodium-bisulfate', cas: '7681-38-1', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'sodiumSulfate',
                expected: PHREEQC_GOLDEN_RESULTS.sodiumSulfate.pH,
                components: [component({ catalogId: 'sodium-sulfate', cas: '7757-82-6', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'trisodiumPhosphate',
                expected: PHREEQC_GOLDEN_RESULTS.trisodiumPhosphate.pH,
                components: [component({ catalogId: 'trisodium-phosphate', cas: '7601-54-9', concentration: 0.0005, volume: 100 })],
            },
            {
                id: 'glycineHydrochloride',
                expected: PHREEQC_GOLDEN_RESULTS.glycineHydrochloride.pH,
                components: [component({ catalogId: 'glycine-hydrochloride', cas: '6000-43-7', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'sodiumGlycinate',
                expected: PHREEQC_GOLDEN_RESULTS.sodiumGlycinate.pH,
                components: [component({ catalogId: 'sodium-glycinate', cas: '6000-44-8', concentration: 0.001, volume: 100 })],
            },
            {
                id: 'diluteKoh',
                expected: PHREEQC_GOLDEN_RESULTS.diluteKoh.pH,
                components: [
                    component({ catalogId: 'potassium-hydroxide', cas: '1310-58-3' }),
                    component({ catalogId: 'water', cas: '7732-18-5' }),
                ],
            },
            {
                id: 'sodiumChloride',
                expected: PHREEQC_GOLDEN_RESULTS.sodiumChloride.pH,
                components: [component({ catalogId: 'sodium-chloride', cas: '7647-14-5', concentration: 0.05, volume: 100 })],
            },
        ];
        for (const goldenCase of cases) {
            const prediction = predictAqueousPh(batch(goldenCase.components));
            const releaseEvidence = PH_CATALOG_VALIDATION_EVIDENCE.cases
                .find((entry) => entry.id === goldenCase.id);
            expect(releaseEvidence, `${goldenCase.id}: missing release evidence`).toBeDefined();
            expect(prediction.value, `${goldenCase.id}: ${prediction.status} ${prediction.issueCodes.join(',')}`).toBeDefined();
            expect(prediction.value).toBeCloseTo(releaseEvidence!.predictorPh, 10);
            expect(
                Math.abs(prediction.value! - goldenCase.expected),
                `${goldenCase.id}: predicted ${prediction.value}, PHREEQC ${goldenCase.expected}`,
            ).toBeLessThanOrEqual(0.1);
        }
    });

    it('keeps the typed golden values identical to the hashed PHREEQC selected output', () => {
        const rows = phreeqcSelectedOutput.trim().split(/\r?\n/).slice(1).map((line) => {
            const [solution, pH, ionicStrength] = line.trim().split(/\s+/).map(Number);
            return { solution, pH, ionicStrength };
        });
        const expected = Object.values(PHREEQC_GOLDEN_RESULTS);

        expect(rows).toHaveLength(expected.length);
        rows.forEach((row, index) => {
            expect(row.solution).toBe(index + 1);
            expect(row.pH).toBe(expected[index]!.pH);
            expect(row.ionicStrength).toBe(expected[index]!.ionicStrength);
        });
    });
});

describe('safety and completeness gates', () => {
    const acid = () => component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', volume: 100 });

    it('never predicts before physical mixing or during an incident', () => {
        expect(predictAqueousPh(batch([acid()], { mixingState: 'separate' }))).toMatchObject({
            status: 'blocked',
            confidence: 'unavailable',
        });
        expect(predictAqueousPh(batch([acid()], { mixingState: 'unknown' })).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.MIXING_STATE_UNKNOWN);
        expect(predictAqueousPh(batch([acid()], { incidentContext: 'leak' })).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.ACTIVE_INCIDENT);
    });

    it('blocks dangerous hazards and rejects unsupported matrices or solvents', () => {
        expect(predictAqueousPh(batch([
            component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', volume: 100, hazardFlags: ['CYANIDE'] }),
        ])).issueCodes).toContain(PH_PREDICTION_ISSUES.DANGEROUS_HAZARD);
        expect(predictAqueousPh(batch([acid()], { matrix: 'organic_non_halogenated' })).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.MATRIX_NOT_AQUEOUS);

        const organicContext = acid();
        organicContext.solutionContext = {
            physicalForm: 'organic_solvent',
            solventClass: 'organic_non_halogen',
        };
        expect(predictAqueousPh(batch([organicContext])).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.COMPONENT_SOLVENT_NOT_AQUEOUS);
    });

    it('requires confirmed completeness, exact identity, catalog form, volume, and concentration', () => {
        expect(predictAqueousPh(batch([acid()], { additionalComponentsStatus: 'unknown' })).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.ADDITIONAL_COMPONENTS_UNCONFIRMED);
        expect(predictAqueousPh(batch([
            component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', volume: 100, identityVerified: false }),
        ])).issueCodes).toContain(PH_PREDICTION_ISSUES.IDENTITY_CONFIRMATION_REQUIRED);

        const missingCatalog = acid();
        missingCatalog.phCatalogId = 'not-reviewed';
        expect(predictAqueousPh(batch([missingCatalog])).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.CATALOG_MATCH_REQUIRED);

        const mismatchedCatalogForm = acid();
        mismatchedCatalogForm.phCatalogId = 'sodium-hydroxide';
        expect(predictAqueousPh(batch([mismatchedCatalogForm])).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.CATALOG_MATCH_REQUIRED);

        const missingVolume = acid();
        missingVolume.solutionVolume = undefined;
        expect(predictAqueousPh(batch([missingVolume])).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.VOLUME_REQUIRED);

        const missingConcentration = acid();
        missingConcentration.concentration = undefined;
        expect(predictAqueousPh(batch([missingConcentration])).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.CONCENTRATION_REQUIRED);
    });

    it('fails closed for duplicate line ids, unresolved hazard data, and corrupt final volume normalization', () => {
        const duplicateA = acid();
        const duplicateB = component({ catalogId: 'water', cas: '7732-18-5', id: duplicateA.cartLineId });
        expect(predictAqueousPh(batch([duplicateA, duplicateB])).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.INVALID_INPUT);

        const unresolvedHazards = acid();
        unresolvedHazards.ghsDataStatus = 'not_checked';
        expect(predictAqueousPh(batch([unresolvedHazards])).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.HAZARD_DATA_REQUIRED);

        const corruptVolume = batch([acid()]);
        corruptVolume.totalAmount = {
            value: 1,
            unit: 'L',
            normalizedValue: 100,
            normalizedUnit: 'mL',
            isApproximate: false,
            isUnknown: false,
        };
        expect(predictAqueousPh(corruptVolume).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.FINAL_VOLUME_INVALID);
    });

    it('fails closed for provisional conditional pKa data without returning a number', () => {
        const result = predictAqueousPh(batch([
            component({ catalogId: 'lactic-acid', cas: '50-21-5', concentration: 0.001, volume: 100 }),
        ]));
        expect(result.status).toBe('unsupported');
        expect(result.value).toBeUndefined();
        expect(result.issueCodes).toContain(PH_PREDICTION_ISSUES.CATALOG_VALIDATION_REQUIRED);
    });

    it('automatically matches an exact unique CAS but never infers identity from formula alone', () => {
        const casMatched = acid();
        casMatched.phCatalogId = undefined;
        expect(predictAqueousPh(batch([casMatched])).value).toBeDefined();

        const formulaMatched = acid();
        formulaMatched.phCatalogId = undefined;
        formulaMatched.chemical.casNumber = '';
        formulaMatched.chemical.molecularFormula = 'HCl(aq)';
        expect(predictAqueousPh(batch([formulaMatched])).issueCodes)
            .toContain(PH_PREDICTION_ISSUES.CATALOG_MATCH_REQUIRED);
    });
});

describe('offline catalog governance', () => {
    it('ships a broad reviewed set with unique ids and complete family references', () => {
        expect(PH_CATALOG_RECORDS.length).toBeGreaterThan(50);
        expect(new Set(PH_CATALOG_RECORDS.map((entry) => entry.id)).size).toBe(PH_CATALOG_RECORDS.length);
        expect(PH_CATALOG_RECORDS.every((entry) => entry.reviewed)).toBe(true);
        const familyIds = new Set(PH_ACID_BASE_FAMILIES.map((entry) => entry.id));
        expect(PH_CATALOG_RECORDS.every((entry) => entry.contributions.every(({ familyId }) => familyIds.has(familyId))))
            .toBe(true);
        expect(PH_ACID_BASE_FAMILIES.every((entry) => entry.pKas.every((value, index) => index === 0 || value > entry.pKas[index - 1]!)))
            .toBe(true);
        expect(PH_ACID_BASE_FAMILIES.every((entry) => entry.pKaMetadata.length === entry.pKas.length)).toBe(true);
        expect(PH_CATALOG_RECORDS.every((entry) => Boolean(entry.structureIdentity))).toBe(true);
        expect(validatePhCatalog(DEFAULT_PH_CATALOG)).toEqual([]);
    });

    it('pins the public-domain USGS release and explicitly excludes non-commercial data', () => {
        const usgs = PH_CATALOG_SOURCE_MANIFEST.sources.find((source) => source.id === 'USGS-PHREEQC-3.8.8');
        expect(usgs).toMatchObject({
            releaseTag: 'v3.8.8',
            releaseCommit: 'cafc3530d40c7b098ebb9c32f56383ccba6a3856',
        });
        expect(PH_CATALOG_SOURCE_MANIFEST.excludedSources.some((source) => source.id.includes('IUPAC'))).toBe(true);
    });

    it('produces a stable, order-independent relevant-input hash', () => {
        const acid = component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', id: 'acid' });
        const water = component({ catalogId: 'water', cas: '7732-18-5', id: 'water' });
        const first = batch([acid, water]);
        const changedWater = component({ catalogId: 'water', cas: '7732-18-5', id: 'water' });
        const second = batch([changedWater, component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', id: 'acid' })]);
        expect(hashPredictionInput(first)).toBe(hashPredictionInput(second));
        changedWater.solutionVolume = { value: 60, unit: 'mL', normalizedMl: 60 };
        expect(hashPredictionInput(first)).not.toBe(hashPredictionInput(second));

        const safetyChanged = batch([component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', id: 'acid' })]);
        const originalHash = hashPredictionInput(safetyChanged);
        safetyChanged.components[0].ghsDataStatus = 'not_checked';
        expect(hashPredictionInput(safetyChanged)).not.toBe(originalHash);
    });

    it('rejects structurally invalid catalog metadata before solving', () => {
        const firstFamily = DEFAULT_PH_CATALOG.families[0]!;
        const invalidCatalog = {
            ...DEFAULT_PH_CATALOG,
            families: [{ ...firstFamily, pKaMetadata: [] }, ...DEFAULT_PH_CATALOG.families.slice(1)],
        };
        expect(validatePhCatalog(invalidCatalog)).not.toEqual([]);
        expect(predictAqueousPh(batch([
            component({ catalogId: 'hydrochloric-acid', cas: '7647-01-0', volume: 100 }),
        ]), invalidCatalog)).toMatchObject({
            status: 'failed',
            issueCodes: [PH_PREDICTION_ISSUES.CATALOG_INVALID],
        });
    });
});
