import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// chemicalFromEnrichment lives next to the app's API client; the comparison is offline and never calls it.
vi.mock('../src/services/internalApi', () => ({
    postJson: () => { throw new Error('The offline comparison must not call the app API.'); },
}));
import type { WasteGoldenSetV2Row } from '../src/features/wasteGoldenSet/schema';
import type { ChemicalEnrichmentResult } from '../src/types';
import {
    AI_CATEGORY_STREAMS,
    MATRIX_REQUIRED,
    heldCsv,
    mismatchCsv,
    noEvidenceCsv,
    runAiDraftWasteComparison,
    type AiWasteDraft,
    type EnrichmentCacheByCas,
} from './aiDraftWasteComparison';

const goldenRows = JSON.parse(readFileSync(
    path.resolve(process.cwd(), 'data', 'waste-golden-set-v2', 'materials.json'), 'utf8',
)) as WasteGoldenSetV2Row[];

const draft = (overrides: Partial<AiWasteDraft>): AiWasteDraft => ({
    id: overrides.casNumber ?? 'x',
    nameKo: '시약',
    nameEn: null,
    casNumber: null,
    wasteMatrix: null,
    labWasteCategory: null,
    hazardFlags: [],
    reasoning: null,
    verifyOverall: 'minor',
    ...overrides,
});

const enrichment = (
    cas: string,
    overrides: {
        name?: string;
        formula?: string;
        identityStatus?: ChemicalEnrichmentResult['identity']['status'];
        hazardStatus?: ChemicalEnrichmentResult['hazard']['status'];
        hCodes?: string[];
        identityCas?: string;
    } = {},
): ChemicalEnrichmentResult => {
    const hCodes = overrides.hCodes ?? ['H225', 'H319', 'H336'];
    return {
        requestId: cas,
        overallStatus: 'complete',
        identity: {
            status: overrides.identityStatus ?? 'verified',
            canonicalName: overrides.name ?? 'acetone',
            casNumber: overrides.identityCas ?? cas,
            pubchemCid: 180,
            equivalentPubchemCids: [180],
            standardInchiKey: 'CSCPPACGZOOCGX-UHFFFAOYSA-N',
            molecularFormula: overrides.formula ?? 'C3H6O',
            molecularWeight: 58.08,
            evidence: [{ source: 'pubchem', sourceId: '180', method: 'exact_cas' }],
        },
        hazard: {
            status: overrides.hazardStatus ?? 'classified',
            hCodes,
            hazardStatements: hCodes,
            pictograms: [],
            signalWord: hCodes.length > 0 ? 'Danger' : undefined,
            hazardFlags: [],
            sources: [{ source: 'pubchem', sourceId: '180' }],
            fetchedAt: '2026-11-01T00:00:00.000Z',
        },
        referencePh: { status: 'not_requested' },
        phCatalog: { status: 'unmatched', candidateIds: [], catalogVersion: 'test' },
        enrichmentVersion: 3,
    };
};

const ACETONE = '67-64-1';
const SODIUM_CHLORIDE = '7647-14-5';
const cacheOf = (...results: ChemicalEnrichmentResult[]): EnrichmentCacheByCas =>
    new Map(results.map((result) => [result.requestId, result]));

describe('AI draft vs waste engine comparison', () => {
    it('maps every AI category the drafts use to engine stream codes', () => {
        for (const category of [
            '산 폐액', '알칼리 폐액', '할로겐 유기용제 폐액', '비할로겐 유기용제 폐액', '중금속 함유 폐액', '시안 함유 폐액',
            '산화제 폐액(별도 수거)', '과산화물·반응성 물질(전문업체 처리)', '고상 시약 폐기물', '희석 후 일반 배출 가능',
            '실린더 반납', '기타 특수 폐기물(확인필요)', '생물학적 폐기물',
        ]) expect(AI_CATEGORY_STREAMS[category]?.length).toBeGreaterThan(0);
    });

    it('runs the engine only on verified golden-set evidence and keeps AI values on the comparison side', () => {
        const golden = goldenRows.find((row) => row.scenario.scenarioBasis === 'explicit_standard_scenario');
        expect(golden).toBeDefined();
        const { rows, summary } = runAiDraftWasteComparison([
            draft({ casNumber: golden!.casNumber, wasteMatrix: 'mixed_biphasic', labWasteCategory: '생물학적 폐기물', hazardFlags: ['oxidizer'] }),
            draft({ casNumber: '0000-00-0' }),
            draft({ nameKo: '혼합물' }),
        ], goldenRows);
        expect(summary).toMatchObject({ totalDrafts: 3, withVerifiedEvidence: 1, noVerifiedEvidence: 2, noCas: 1 });
        expect(rows[0].goldenId).toBe(golden!.id);
        expect(rows[0].engineMatrix).toBe(golden!.scenario.matrix);
        expect(rows[1].bucket).toBe('no_verified_evidence');
        expect(rows[1].engineStatus).toBeUndefined();
    });

    it('flags a ready decision whose stream or matrix disagrees with the AI draft', () => {
        const readyRow = goldenRows.find((row) => {
            const result = runAiDraftWasteComparison([draft({ casNumber: row.casNumber })], [row]).rows[0];
            return result.engineStatus === 'ready';
        });
        expect(readyRow).toBeDefined();
        const { rows } = runAiDraftWasteComparison([
            draft({ casNumber: readyRow!.casNumber, wasteMatrix: readyRow!.scenario.matrix === 'aqueous' ? 'solid_slurry' : 'aqueous', labWasteCategory: '실린더 반납' }),
        ], goldenRows);
        expect(rows[0].bucket).toBe('ready');
        expect(rows[0].mismatches).toEqual(expect.arrayContaining(['matrix']));
        const csv = mismatchCsv(rows);
        expect(csv.startsWith('﻿시약명,')).toBe(true);
        expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2);
    });

    it('uses verified enrichment-cache GHS when the golden set has no row, with the engine-inferred matrix', () => {
        const aiDraft = draft({ casNumber: ACETONE, wasteMatrix: 'aqueous', labWasteCategory: '산 폐액', hazardFlags: ['corrosive'] });
        const { rows, summary } = runAiDraftWasteComparison([aiDraft], [], cacheOf(enrichment(ACETONE)));
        const [row] = rows;
        expect(row.evidenceSource).toBe('enrichment_cache');
        expect(row.pubchemCid).toBe(180);
        // The matrix comes from the engine's own solvent evidence, never from the AI's 'aqueous'.
        expect(row.engineMatrix).toBe('organic_non_halogenated');
        expect(row).toMatchObject({ bucket: 'ready', engineStatus: 'ready', engineStream: 'ORGANIC_NON_HALOGENATED', scenarioDiffers: false });
        expect(row.mismatches).toEqual(['matrix', 'stream']);
        expect(summary.byEvidenceSource).toEqual({ golden_set: 0, enrichment_cache: 1 });
        expect(summary).toMatchObject({ withVerifiedEvidence: 1, readyMismatches: 1, readyMismatchesFromScenario: 0 });
        expect(mismatchCsv(rows)).toContain('enrichment_cache');
    });

    it('ignores the AI hazard flags and category when building the engine input', () => {
        const cache = cacheOf(enrichment(ACETONE));
        const plain = runAiDraftWasteComparison([draft({ casNumber: ACETONE })], [], cache).rows[0];
        const loaded = runAiDraftWasteComparison([draft({
            casNumber: ACETONE, wasteMatrix: 'solid_slurry', labWasteCategory: '시안 함유 폐액', hazardFlags: ['cyanide', 'oxidizer'],
        })], [], cache).rows[0];
        expect(loaded.engineMatrix).toBe(plain.engineMatrix);
        expect(loaded.engineStream).toBe(plain.engineStream);
        expect(loaded.engineStatus).toBe(plain.engineStatus);
        expect(loaded.engineReasons).toEqual(plain.engineReasons);
    });

    it('holds a cached reagent as matrix-required when the engine cannot infer a matrix', () => {
        const { rows, summary } = runAiDraftWasteComparison(
            [draft({ casNumber: SODIUM_CHLORIDE, wasteMatrix: 'solid_slurry', labWasteCategory: '고상 시약 폐기물' })],
            [],
            cacheOf(enrichment(SODIUM_CHLORIDE, { name: 'sodium chloride', formula: 'ClNa', hazardStatus: 'not_classified', hCodes: [] })),
        );
        expect(rows[0]).toMatchObject({
            bucket: 'held', evidenceSource: 'enrichment_cache', engineMatrix: 'unknown', engineReasons: [MATRIX_REQUIRED],
        });
        expect(rows[0].engineStatus).toBeUndefined();
        expect(summary).toMatchObject({ heldMatrixRequired: 1, heldReasons: { [MATRIX_REQUIRED]: 1 }, heldMissingFields: { matrix: 1 } });
        expect(heldCsv(rows)).toContain(MATRIX_REQUIRED);
    });

    it('does not use cache entries without a verified identity, a definite GHS answer or a matching CAS', () => {
        const drafts = ['1-1-1', '2-2-2', '3-3-3', '4-4-4'].map((casNumber) => draft({ casNumber }));
        const { rows, summary } = runAiDraftWasteComparison(drafts, [], cacheOf(
            enrichment('1-1-1', { identityStatus: 'ambiguous' }),
            enrichment('2-2-2', { hazardStatus: 'source_absent', hCodes: [] }),
            enrichment('3-3-3', { hazardStatus: 'transient_error', hCodes: [] }),
            enrichment('4-4-4', { identityCas: '9-9-9' }),
        ));
        expect(rows.every((row) => row.bucket === 'no_verified_evidence')).toBe(true);
        expect(summary).toMatchObject({ withVerifiedEvidence: 0, noVerifiedEvidence: 4, unusableCacheEntries: 4 });
    });

    it('prefers the golden set over the enrichment cache for the same CAS', () => {
        const golden = goldenRows.find((row) => row.casNumber === ACETONE);
        expect(golden).toBeDefined();
        const { rows, summary } = runAiDraftWasteComparison([draft({ casNumber: ACETONE })], goldenRows, cacheOf(enrichment(ACETONE)));
        expect(rows[0]).toMatchObject({ evidenceSource: 'golden_set', goldenId: golden!.id, engineMatrix: golden!.scenario.matrix });
        expect(rows[0].pubchemCid).toBeUndefined();
        expect(summary.byEvidenceSource).toEqual({ golden_set: 1, enrichment_cache: 0 });
    });

    it('writes CSV cells that spreadsheets cannot evaluate as formulas', () => {
        const { rows } = runAiDraftWasteComparison([draft({ casNumber: '0000-00-0', nameKo: '=HYPERLINK("x")', reasoning: 'a,"b"' })], goldenRows);
        const csv = noEvidenceCsv(rows);
        expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
        expect(heldCsv(rows).split('\r\n').filter(Boolean)).toHaveLength(1);
    });
});

const input = process.env.AI_DRAFT_WASTE_INPUT;
const outputDirectory = process.env.AI_DRAFT_WASTE_OUTPUT;
const cacheInput = process.env.AI_DRAFT_WASTE_CACHE;
const reportDescribe = input && outputDirectory ? describe : describe.skip;

reportDescribe('AI draft waste comparison report', () => {
    it('writes the mismatch, held and no-evidence reports', () => {
        const drafts = JSON.parse(readFileSync(input!, 'utf8')) as AiWasteDraft[];
        const cache: EnrichmentCacheByCas = cacheInput
            ? new Map(Object.entries(JSON.parse(readFileSync(cacheInput, 'utf8')) as Record<string, ChemicalEnrichmentResult>))
            : new Map();
        const { rows, summary } = runAiDraftWasteComparison(drafts, goldenRows, cache);
        mkdirSync(outputDirectory!, { recursive: true });
        writeFileSync(path.join(outputDirectory!, 'mismatches.csv'), mismatchCsv(rows));
        writeFileSync(path.join(outputDirectory!, 'held.csv'), heldCsv(rows));
        writeFileSync(path.join(outputDirectory!, 'no-verified-evidence.csv'), noEvidenceCsv(rows));
        writeFileSync(path.join(outputDirectory!, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
        console.log(JSON.stringify(summary, null, 2));
        expect(summary.totalDrafts).toBe(drafts.length);
    });
});
