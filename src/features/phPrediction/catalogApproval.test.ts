import { describe, expect, it } from 'vitest';
import type { WasteBatchDraft, WasteComponent } from '../../types';
import {
    DEFAULT_PH_CATALOG,
    DEFAULT_PH_CATALOG_APPROVAL,
    PH_CATALOG_VALIDATION_EVIDENCE,
    PH_PREDICTION_ISSUES,
    evaluatePhCatalogApproval,
    predictAqueousPh,
    validatePhCatalog,
} from './index';
import type { PhCatalogValidationEvidence } from './validationEvidence';
import phreeqcGoldenInput from './fixtures/phreeqc-v3.8.8-golden.pqi?raw';
import phreeqcGoldenOutput from './fixtures/phreeqc-v3.8.8-golden.sel?raw';
import predictorSource from './predictor.ts?raw';
import { PHREEQC_GOLDEN_PROVENANCE, PHREEQC_GOLDEN_RESULTS } from './fixtures/phreeqcGolden';
import { normalizeLf, sha256Text } from './integrity';

const component = (
    catalogId: string,
    casNumber: string,
    molar: number,
    cartLineId: string,
): WasteComponent => ({
    cartLineId,
    sourceType: 'manual',
    identityConfidence: 'verified',
    ghsDataStatus: 'verified',
    capturedAt: '2026-08-04T00:00:00.000Z',
    hazardFlags: [],
    phCatalogId: catalogId,
    solutionVolume: { value: 50, unit: 'mL', normalizedMl: 50 },
    concentration: { value: molar, unit: 'M' },
    chemical: { id: catalogId, name: catalogId, casNumber, molecularFormula: '' },
    category: 'NEUTRAL',
    binColor: '',
    label: '',
    reason: '',
    isSafe: true,
});

const batch = (components: WasteComponent[]): WasteBatchDraft => ({
    id: 'approval-test',
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
});

describe('evidence-derived pH catalog approval', () => {
    it('keeps the Pages Functions runtime golden metadata tied to the source artifacts', () => {
        expect(sha256Text(normalizeLf(phreeqcGoldenInput))).toBe(PHREEQC_GOLDEN_PROVENANCE.inputSha256);
        expect(sha256Text(normalizeLf(phreeqcGoldenOutput))).toBe(PHREEQC_GOLDEN_PROVENANCE.selectedOutputSha256);
        expect(sha256Text(normalizeLf(predictorSource)))
            .toBe(PH_CATALOG_VALIDATION_EVIDENCE.predictorSourceSha256);

        const outputRows = normalizeLf(phreeqcGoldenOutput)
            .split('\n')
            .slice(1)
            .map((line) => line.trim().split(/\s+/).map(Number))
            .filter((values) => values.length >= 3 && values.every(Number.isFinite))
            .map(([row, pH, ionicStrength]) => ({ row, pH, ionicStrength }));
        const runtimeRows = Object.values(PHREEQC_GOLDEN_RESULTS)
            .map((result, index) => ({ row: index + 1, ...result }));

        expect(runtimeRows).toEqual(outputRows);
    });

    it('activates only the exact records covered by passing fixed evidence', () => {
        expect(DEFAULT_PH_CATALOG_APPROVAL.runtimeReady).toBe(true);
        expect(DEFAULT_PH_CATALOG_APPROVAL.passingGoldenCaseIds).toHaveLength(42);
        expect(DEFAULT_PH_CATALOG_APPROVAL.approvedRecordIds).toHaveLength(28);
        expect(DEFAULT_PH_CATALOG_APPROVAL.approvedFamilyIds).toHaveLength(9);
        expect(DEFAULT_PH_CATALOG_APPROVAL.rejectedGoldenCaseIds).toEqual([]);
        expect(DEFAULT_PH_CATALOG_APPROVAL.approvedRecordIds).toContain('hydrochloric-acid');
        expect(DEFAULT_PH_CATALOG_APPROVAL.approvedRecordIds).toContain('potassium-dihydrogen-phosphate');
        expect(DEFAULT_PH_CATALOG_APPROVAL.approvedRecordIds).not.toContain('lactic-acid');
        expect(DEFAULT_PH_CATALOG_APPROVAL.approvedRecordIds).not.toContain('ammonia');
        expect(DEFAULT_PH_CATALOG_APPROVAL.approvedFamilyIds).toContain('phosphate');
        expect(DEFAULT_PH_CATALOG_APPROVAL.approvedFamilyIds).not.toContain('lactate');
    });

    it('cannot be unlocked by changing a status-like string, model version, or scientific data', () => {
        const modelMutation: PhCatalogValidationEvidence = {
            ...PH_CATALOG_VALIDATION_EVIDENCE,
            modelVersion: 'manually-approved',
        };
        expect(evaluatePhCatalogApproval(DEFAULT_PH_CATALOG, modelMutation)).toMatchObject({
            runtimeReady: false,
            approvedRecordIds: [],
        });
        const relaxedPolicy: PhCatalogValidationEvidence = {
            ...PH_CATALOG_VALIDATION_EVIDENCE,
            minimumPassingGoldenCases: 1,
        };
        expect(evaluatePhCatalogApproval(DEFAULT_PH_CATALOG, relaxedPolicy).issueCodes)
            .toContain('approval_policy_integrity_failed');

        const phosphate = DEFAULT_PH_CATALOG.families.find((family) => family.id === 'phosphate')!;
        const scientificMutation = {
            ...DEFAULT_PH_CATALOG,
            activationStatus: 'approved',
            families: DEFAULT_PH_CATALOG.families.map((family) =>
                family.id === 'phosphate'
                    ? { ...phosphate, pKas: [2.2, ...phosphate.pKas.slice(1)] }
                    : family),
        };
        const result = evaluatePhCatalogApproval(scientificMutation);
        expect(result.runtimeReady).toBe(false);
        expect(result.issueCodes).toContain('catalog_fingerprint_mismatch');
    });

    it('fails closed globally when any reference case is rejected', () => {
        const tamperedCases = PH_CATALOG_VALIDATION_EVIDENCE.cases.map((goldenCase) =>
            goldenCase.id === 'nist-phosphate-physiological-25c'
                ? { ...goldenCase, predictorPh: 9 }
                : goldenCase);
        const partialEvidence: PhCatalogValidationEvidence = {
            ...PH_CATALOG_VALIDATION_EVIDENCE,
            cases: tamperedCases,
        };
        const result = evaluatePhCatalogApproval(DEFAULT_PH_CATALOG, partialEvidence);
        expect(result.runtimeReady).toBe(false);
        expect(result.rejectedGoldenCaseIds).toContain('nist-phosphate-physiological-25c');
        expect(result.approvedRecordIds).toEqual([]);
        expect(result.approvedFamilyIds).toEqual([]);
        expect(result.issueCodes).toContain('golden_cases_rejected');
    });

    it('validates integer stoichiometry and a possible neutral charge state for every exact form', () => {
        expect(validatePhCatalog(DEFAULT_PH_CATALOG)).toEqual([]);
        const sodiumChloride = DEFAULT_PH_CATALOG.records.find((record) => record.id === 'sodium-chloride')!;
        const noChargeClosure = {
            ...DEFAULT_PH_CATALOG,
            records: DEFAULT_PH_CATALOG.records.map((record) => record.id === sodiumChloride.id
                ? { ...sodiumChloride, fixedIons: sodiumChloride.fixedIons.slice(0, 1) }
                : record),
        };
        expect(validatePhCatalog(noChargeClosure)).toContain('record.sodium-chloride.charge_closure');

        const aceticAcid = DEFAULT_PH_CATALOG.records.find((record) => record.id === 'acetic-acid')!;
        const fractionalStoichiometry = {
            ...DEFAULT_PH_CATALOG,
            records: DEFAULT_PH_CATALOG.records.map((record) => record.id === aceticAcid.id
                ? { ...aceticAcid, contributions: [{ familyId: 'acetate', stoichiometry: 0.5 }] }
                : record),
        };
        expect(validatePhCatalog(fractionalStoichiometry)).toContain('record.acetic-acid.family');
    });

    it('matches the supported NIST phosphate standard and keeps the 0.10 boundary case unavailable', () => {
        const physiological = predictAqueousPh(batch([
            component('potassium-dihydrogen-phosphate', '7778-77-0', 0.01739, 'acid'),
            component('disodium-hydrogen-phosphate', '7558-79-4', 0.06086, 'base'),
        ]));
        expect(physiological.value).toBeCloseTo(7.420878214610639, 10);
        expect(Math.abs(physiological.value! - 7.413)).toBeLessThanOrEqual(0.1);

        const ionicStrengthBoundary = predictAqueousPh(batch([
            component('potassium-dihydrogen-phosphate', '7778-77-0', 0.05, 'acid'),
            component('disodium-hydrogen-phosphate', '7558-79-4', 0.05, 'base'),
        ]));
        expect(ionicStrengthBoundary.status).toBe('unsupported');
        expect(ionicStrengthBoundary.value).toBeUndefined();
        expect(ionicStrengthBoundary.issueCodes)
            .toContain(PH_PREDICTION_ISSUES.IONIC_STRENGTH_OUT_OF_RANGE);
    });
});
