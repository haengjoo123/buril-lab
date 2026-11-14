/**
 * Offline comparison of AI reagent drafts (reagent_reference_drafts) against the app's
 * waste decision engine. Report only: nothing here feeds routing or approvals.
 *
 * The engine side uses verified evidence only, in this order:
 *  1. the reviewed golden set (PubChem/KOSHA GHS + an explicit standard scenario) with the
 *     same CAS, built exactly as the golden-set check builds it;
 *  2. the server PubChem/KOSHA enrichment cache (`chemical_enrichment_cache`, `cas:<CAS>`)
 *     when the identity is verified and GHS is classified or explicitly not classified.
 *     There is no standard scenario for these, so the matrix comes only from the engine's
 *     own component inference; when it cannot infer one the draft is held (matrix needed).
 * AI values are used only on the comparison side. The engine code is imported, never changed.
 *
 * Conditional comparison (reported separately, never counted as a ready decision): for a
 * matrix-required draft the engine is run once per candidate matrix, as if a user had picked
 * it, on the same verified evidence. Every candidate is run regardless of the AI draft; the
 * AI matrix only selects which of those results to read for the "at the AI matrix" figures.
 */
import type { ChemicalEnrichmentResult, WasteBatchDraft, WasteMatrix, WasteStreamCode } from '../src/types';
import {
    analyzeWasteBatch,
    createEmptyWasteBatch,
    createWasteComponentFromAnalysis,
    inferWasteMatrixFromComponents,
    normalizeWasteAmount,
} from '../src/utils/wasteBatch';
import { analyzeChemical } from '../src/utils/chemicalAnalyzer';
import { chemicalFromEnrichment } from '../src/services/chemicalEnrichmentService';
import type { WasteGoldenSetV2Row } from '../src/features/wasteGoldenSet/schema';
import { batchForGoldenRow } from './wasteGoldenSetV2';

export interface AiWasteDraft {
    id: string;
    nameKo: string;
    nameEn: string | null;
    casNumber: string | null;
    wasteMatrix: string | null;
    labWasteCategory: string | null;
    hazardFlags: string[];
    reasoning: string | null;
    verifyOverall: string | null;
}

/**
 * The AI category vocabulary is the lab's Korean container labels. Each maps to the engine
 * stream codes that would agree with it. Kept explicit so the advisor can check the mapping.
 */
export const AI_CATEGORY_STREAMS: Readonly<Record<string, readonly WasteStreamCode[]>> = Object.freeze({
    '산 폐액': ['ACID_AQUEOUS'],
    '알칼리 폐액': ['ALKALI_AQUEOUS'],
    '할로겐 유기용제 폐액': ['ORGANIC_HALOGENATED'],
    '비할로겐 유기용제 폐액': ['ORGANIC_NON_HALOGENATED'],
    '중금속 함유 폐액': ['HEAVY_METAL'],
    '시안 함유 폐액': ['CYANIDE_SULFIDE'],
    '산화제 폐액(별도 수거)': ['REACTIVE_OXIDIZER'],
    '과산화물·반응성 물질(전문업체 처리)': ['REACTIVE_OXIDIZER', 'SPECIAL_REVIEW'],
    '고상 시약 폐기물': ['SOLID_CONTAMINATED'],
    // AQUEOUS_OTHER is the collected "기타 수계 폐액" stream; the engine never routes to the drain.
    // A match here means the same stream family only. aiDrainClaims counts these drafts separately.
    '희석 후 일반 배출 가능': ['AQUEOUS_OTHER'],
    '실린더 반납': ['SPECIAL_REVIEW'],
    '기타 특수 폐기물(확인필요)': ['SPECIAL_REVIEW'],
    '생물학적 폐기물': ['SPECIAL_REVIEW'],
});

export type ComparisonBucket = 'ready' | 'held' | 'no_verified_evidence';
export type EvidenceSource = 'golden_set' | 'enrichment_cache';
/** Held before the engine runs: verified GHS exists but the engine could not infer a matrix. */
export const MATRIX_REQUIRED = 'matrix_required';

/** Cache entries keyed by CAS (the part after `cas:` in `lookup_key`). */
export type EnrichmentCacheByCas = ReadonlyMap<string, ChemicalEnrichmentResult>;

/**
 * Only verified identities with a definite GHS answer count as evidence. A cached CAS that
 * disagrees with the draft CAS is ignored rather than trusted.
 */
export function usableEnrichmentResult(cas: string, result: ChemicalEnrichmentResult | undefined): ChemicalEnrichmentResult | null {
    if (!result) return null;
    if (result.identity?.status !== 'verified') return null;
    if (result.hazard?.status !== 'classified' && result.hazard?.status !== 'not_classified') return null;
    if (result.identity.casNumber && result.identity.casNumber !== cas) return null;
    return result;
}

const amountFor = (matrix: WasteMatrix) => {
    const unit = matrix === 'solid_slurry' ? 'g' : 'mL';
    const normalized = normalizeWasteAmount(100, unit);
    if (!normalized) throw new Error('Comparison amount must normalize.');
    return { value: 100, unit, ...normalized, isApproximate: false, isUnknown: false } as const;
};

/**
 * Matrices a user can pick for a single reagent. mixed_biphasic needs a second phase, which a
 * single-reagent draft does not have, so it is not a candidate.
 */
export const CONDITIONAL_MATRICES = Object.freeze([
    'aqueous', 'organic_non_halogenated', 'organic_halogenated', 'solid_slurry',
] as const satisfies readonly WasteMatrix[]);
export type ConditionalMatrix = typeof CONDITIONAL_MATRICES[number];

export interface ConditionalResult {
    matrix: ConditionalMatrix;
    status: 'ready' | 'needs_input' | 'blocked';
    stream?: WasteStreamCode;
    reasons: string[];
    missingFields: string[];
}

/**
 * Build the engine batch from a cached enrichment result the way the app does: the same
 * Chemical projection and component builder, with no AI value and no assumed scenario.
 * Returns the batch with matrix `unknown` when the engine cannot infer one.
 */
export function batchForEnrichmentResult(id: string, cas: string, result: ChemicalEnrichmentResult): WasteBatchDraft | null {
    const chemical = chemicalFromEnrichment(result, { casNumber: cas });
    if (!chemical) return null;
    const component = createWasteComponentFromAnalysis(analyzeChemical(chemical), {
        cartLineId: id,
        identityConfidence: 'verified',
        ghsDataStatus: 'verified',
    });
    const matrix = inferWasteMatrixFromComponents([component]);
    return {
        ...createEmptyWasteBatch({ id, now: '2026-08-08T00:00:00.000Z' }),
        components: [component],
        matrix: matrix ?? 'unknown',
        matrixSource: matrix ? 'automatic' : 'unresolved',
        ...(matrix ? { totalAmount: amountFor(matrix) } : {}),
    };
}

/** Run the engine once per candidate matrix, each as a user-selected matrix on the same batch. */
export function conditionalResults(batch: WasteBatchDraft): ConditionalResult[] {
    return CONDITIONAL_MATRICES.map((matrix) => {
        const decision = analyzeWasteBatch({ ...batch, matrix, matrixSource: 'user', totalAmount: amountFor(matrix) });
        return {
            matrix,
            status: decision.decisionStatus,
            ...(decision.decisionStatus === 'ready' ? { stream: decision.streamCode } : {}),
            reasons: decision.blockingReasons.map((reason) => reason.code),
            missingFields: decision.missingFields.map((field) => String(field)),
        };
    });
}

/** How the AI draft relates to the conditional engine results. */
export type ConditionalVerdict =
    | 'match_at_ai_matrix'       // ready at the AI matrix and the stream fits the AI category
    | 'mismatch_at_ai_matrix'    // ready at the AI matrix, stream does not fit
    | 'held_at_ai_matrix'        // the engine holds the reagent even at the AI matrix
    | 'no_ai_matrix';            // AI matrix unknown, mixed_biphasic or missing; or category unmapped

export function conditionalVerdict(draft: AiWasteDraft, results: readonly ConditionalResult[], aiExpectedStreams: readonly WasteStreamCode[]): ConditionalVerdict {
    const atAi = results.find((result) => result.matrix === draft.wasteMatrix);
    if (!atAi || aiExpectedStreams.length === 0) return 'no_ai_matrix';
    if (atAi.status !== 'ready' || !atAi.stream) return 'held_at_ai_matrix';
    return aiExpectedStreams.includes(atAi.stream) ? 'match_at_ai_matrix' : 'mismatch_at_ai_matrix';
}

/** The stream when every candidate matrix is ready with the same stream (the matrix does not matter). */
export function matrixIndependentStream(results: readonly ConditionalResult[]): WasteStreamCode | undefined {
    const [first] = results;
    if (!first?.stream || results.some((result) => result.status !== 'ready' || result.stream !== first.stream)) return undefined;
    return first.stream;
}

export type MismatchKind = 'matrix' | 'stream' | 'unmapped_category';

export interface ComparisonRow {
    draft: AiWasteDraft;
    bucket: ComparisonBucket;
    evidenceSource?: EvidenceSource;
    /** PubChem CID of the cached enrichment result used as evidence. */
    pubchemCid?: number;
    hazardStatus?: string;
    goldenId?: string;
    scenarioBasis?: string;
    /** The golden scenario dissolves a solid reagent while the draft disposes of it as a solid. */
    scenarioDiffers?: boolean;
    engineStatus?: 'ready' | 'needs_input' | 'blocked';
    engineMatrix?: WasteMatrix;
    engineStream?: WasteStreamCode;
    engineReasons?: string[];
    engineMissingFields?: string[];
    aiExpectedStreams: readonly WasteStreamCode[];
    mismatches: MismatchKind[];
    /** Matrix-required drafts only: engine results per candidate matrix. Not a decision. */
    conditional?: ConditionalResult[];
    conditionalVerdict?: ConditionalVerdict;
}

export interface ConditionalSummary {
    /** Matrix-required drafts run once per candidate matrix. */
    evaluated: number;
    byVerdict: Record<ConditionalVerdict, number>;
    /** Every candidate matrix ready with the same stream. */
    matrixIndependent: number;
    matrixIndependentMatches: number;
    matrixIndependentMismatches: number;
    /** Some candidate matrix gives a stream that fits the AI category. */
    aiCategoryReachable: number;
    /** No candidate matrix gives a stream that fits the AI category (category mapped). */
    aiCategoryUnreachable: number;
    /** Engine stream at the AI matrix → AI category, for mismatch_at_ai_matrix. */
    mismatchPairs: Record<string, number>;
    heldAtAiMatrixReasons: Record<string, number>;
}

export interface ComparisonSummary {
    totalDrafts: number;
    withVerifiedEvidence: number;
    byEvidenceSource: Record<EvidenceSource, number>;
    /** Enrichment-cache drafts held because the engine could not infer a matrix. */
    heldMatrixRequired: number;
    /** Cache entries present for a draft CAS but not usable (unverified identity, no GHS answer, CAS conflict). */
    unusableCacheEntries: number;
    noVerifiedEvidence: number;
    noCas: number;
    /** Drafts whose AI category allows drain disposal; the engine always collects aqueous waste. */
    aiDrainClaims: number;
    engineReady: number;
    engineNeedsInput: number;
    engineBlocked: number;
    readyMatches: number;
    readyMismatches: number;
    /** Ready mismatches explained by the dissolved-vs-solid scenario difference alone. */
    readyMismatchesFromScenario: number;
    mismatchByKind: Record<MismatchKind, number>;
    heldReasons: Record<string, number>;
    heldMissingFields: Record<string, number>;
    /** Conditional per-matrix results; separate from the ready figures above. */
    conditional: ConditionalSummary;
    categoryMapping: Readonly<Record<string, readonly WasteStreamCode[]>>;
}

function readyMismatches(draft: AiWasteDraft, matrix: WasteMatrix, stream: WasteStreamCode, aiExpectedStreams: readonly WasteStreamCode[]): MismatchKind[] {
    const mismatches: MismatchKind[] = [];
    if (draft.wasteMatrix && draft.wasteMatrix !== 'unknown' && matrix !== 'unknown' && draft.wasteMatrix !== matrix) {
        mismatches.push('matrix');
    }
    if (aiExpectedStreams.length === 0) mismatches.push('unmapped_category');
    else if (!aiExpectedStreams.includes(stream)) mismatches.push('stream');
    return mismatches;
}

function compareWithEnrichment(
    draft: AiWasteDraft,
    cas: string,
    result: ChemicalEnrichmentResult,
    aiExpectedStreams: readonly WasteStreamCode[],
): ComparisonRow | null {
    const batch = batchForEnrichmentResult(draft.id, cas, result);
    if (!batch) return null;
    const evidence = {
        draft,
        evidenceSource: 'enrichment_cache' as const,
        pubchemCid: result.identity.pubchemCid,
        hazardStatus: result.hazard.status,
        aiExpectedStreams,
    };
    if (batch.matrix === 'unknown') {
        const conditional = conditionalResults(batch);
        return {
            ...evidence,
            bucket: 'held',
            engineMatrix: 'unknown',
            engineReasons: [MATRIX_REQUIRED],
            engineMissingFields: ['matrix'],
            mismatches: [],
            conditional,
            conditionalVerdict: conditionalVerdict(draft, conditional, aiExpectedStreams),
        };
    }
    const decision = analyzeWasteBatch(batch);
    const engineStatus = decision.decisionStatus;
    return {
        ...evidence,
        bucket: engineStatus === 'ready' ? 'ready' : 'held',
        scenarioDiffers: false,
        engineStatus,
        engineMatrix: batch.matrix,
        engineStream: decision.streamCode,
        engineReasons: decision.blockingReasons.map((reason) => reason.code),
        engineMissingFields: decision.missingFields.map((field) => String(field)),
        mismatches: engineStatus === 'ready' ? readyMismatches(draft, batch.matrix, decision.streamCode, aiExpectedStreams) : [],
    };
}

export function compareDraft(
    draft: AiWasteDraft,
    golden: ReadonlyMap<string, WasteGoldenSetV2Row>,
    enrichmentCache: EnrichmentCacheByCas = new Map(),
): ComparisonRow {
    const aiExpectedStreams = (draft.labWasteCategory && AI_CATEGORY_STREAMS[draft.labWasteCategory]) || [];
    const row = draft.casNumber ? golden.get(draft.casNumber) : undefined;
    if (!row) {
        const cached = draft.casNumber ? usableEnrichmentResult(draft.casNumber, enrichmentCache.get(draft.casNumber)) : null;
        const compared = cached && draft.casNumber ? compareWithEnrichment(draft, draft.casNumber, cached, aiExpectedStreams) : null;
        return compared ?? { draft, bucket: 'no_verified_evidence', aiExpectedStreams, mismatches: [] };
    }

    const batch = batchForGoldenRow(row);
    const decision = analyzeWasteBatch(batch);
    const engineStatus = decision.decisionStatus;
    const mismatches = engineStatus === 'ready' ? readyMismatches(draft, batch.matrix, decision.streamCode, aiExpectedStreams) : [];
    return {
        draft,
        bucket: engineStatus === 'ready' ? 'ready' : 'held',
        evidenceSource: 'golden_set',
        goldenId: row.id,
        scenarioBasis: row.scenario.scenarioBasis,
        scenarioDiffers: row.scenario.materialPhysicalForm === 'solid'
            && batch.matrix !== 'solid_slurry'
            && draft.wasteMatrix === 'solid_slurry',
        engineStatus,
        engineMatrix: batch.matrix,
        engineStream: decision.streamCode,
        engineReasons: decision.blockingReasons.map((reason) => reason.code),
        engineMissingFields: decision.missingFields.map((field) => String(field)),
        aiExpectedStreams,
        mismatches,
    };
}

const increment = (counts: Record<string, number>, key: string) => { counts[key] = (counts[key] ?? 0) + 1; };

function summarizeConditional(rows: readonly ComparisonRow[]): ConditionalSummary {
    const summary: ConditionalSummary = {
        evaluated: 0,
        byVerdict: { match_at_ai_matrix: 0, mismatch_at_ai_matrix: 0, held_at_ai_matrix: 0, no_ai_matrix: 0 },
        matrixIndependent: 0,
        matrixIndependentMatches: 0,
        matrixIndependentMismatches: 0,
        aiCategoryReachable: 0,
        aiCategoryUnreachable: 0,
        mismatchPairs: {},
        heldAtAiMatrixReasons: {},
    };
    for (const row of rows) {
        if (!row.conditional || !row.conditionalVerdict) continue;
        summary.evaluated += 1;
        summary.byVerdict[row.conditionalVerdict] += 1;
        const expected = row.aiExpectedStreams;
        const independent = matrixIndependentStream(row.conditional);
        if (independent) {
            summary.matrixIndependent += 1;
            if (expected.length > 0) {
                if (expected.includes(independent)) summary.matrixIndependentMatches += 1;
                else summary.matrixIndependentMismatches += 1;
            }
        }
        if (expected.length > 0) {
            if (row.conditional.some((result) => result.stream && expected.includes(result.stream))) summary.aiCategoryReachable += 1;
            else summary.aiCategoryUnreachable += 1;
        }
        const atAi = row.conditional.find((result) => result.matrix === row.draft.wasteMatrix);
        if (row.conditionalVerdict === 'mismatch_at_ai_matrix' && atAi?.stream) {
            increment(summary.mismatchPairs, `${atAi.stream} → ${row.draft.labWasteCategory}`);
        }
        if (row.conditionalVerdict === 'held_at_ai_matrix' && atAi) {
            for (const key of new Set([...atAi.reasons, ...atAi.missingFields.map((field) => `missing:${field}`)])) {
                increment(summary.heldAtAiMatrixReasons, key);
            }
        }
    }
    return summary;
}

export function runAiDraftWasteComparison(
    drafts: readonly AiWasteDraft[],
    goldenRows: readonly WasteGoldenSetV2Row[],
    enrichmentCache: EnrichmentCacheByCas = new Map(),
): { rows: ComparisonRow[]; summary: ComparisonSummary } {
    const golden = new Map(goldenRows.map((row) => [row.casNumber, row]));
    const rows = drafts.map((draft) => compareDraft(draft, golden, enrichmentCache));
    const summary: ComparisonSummary = {
        totalDrafts: rows.length,
        withVerifiedEvidence: rows.filter((row) => row.bucket !== 'no_verified_evidence').length,
        byEvidenceSource: {
            golden_set: rows.filter((row) => row.evidenceSource === 'golden_set').length,
            enrichment_cache: rows.filter((row) => row.evidenceSource === 'enrichment_cache').length,
        },
        heldMatrixRequired: rows.filter((row) => row.engineReasons?.includes(MATRIX_REQUIRED)).length,
        unusableCacheEntries: rows.filter((row) => row.bucket === 'no_verified_evidence'
            && row.draft.casNumber && enrichmentCache.has(row.draft.casNumber)).length,
        noVerifiedEvidence: rows.filter((row) => row.bucket === 'no_verified_evidence').length,
        noCas: drafts.filter((draft) => !draft.casNumber).length,
        aiDrainClaims: drafts.filter((draft) => draft.labWasteCategory === '희석 후 일반 배출 가능').length,
        engineReady: rows.filter((row) => row.engineStatus === 'ready').length,
        engineNeedsInput: rows.filter((row) => row.engineStatus === 'needs_input').length,
        engineBlocked: rows.filter((row) => row.engineStatus === 'blocked').length,
        readyMatches: rows.filter((row) => row.bucket === 'ready' && row.mismatches.length === 0).length,
        readyMismatches: rows.filter((row) => row.bucket === 'ready' && row.mismatches.length > 0).length,
        readyMismatchesFromScenario: rows.filter((row) => row.bucket === 'ready' && row.mismatches.length > 0 && row.scenarioDiffers).length,
        mismatchByKind: { matrix: 0, stream: 0, unmapped_category: 0 },
        heldReasons: {},
        heldMissingFields: {},
        conditional: summarizeConditional(rows),
        categoryMapping: AI_CATEGORY_STREAMS,
    };
    for (const row of rows) {
        for (const kind of row.mismatches) summary.mismatchByKind[kind] += 1;
        if (row.bucket !== 'held') continue;
        for (const reason of new Set(row.engineReasons)) increment(summary.heldReasons, reason);
        for (const field of new Set(row.engineMissingFields)) increment(summary.heldMissingFields, field);
    }
    return { rows, summary };
}

function csvCell(value: unknown): string {
    const text = value === undefined || value === null ? '' : Array.isArray(value) ? value.join(' ') : String(value);
    // Keep spreadsheet apps from evaluating draft text as a formula.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(header: string[], lines: unknown[][]): string {
    // BOM so Excel opens the Korean text as UTF-8.
    return '﻿' + [header, ...lines].map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function mismatchCsv(rows: readonly ComparisonRow[]): string {
    return toCsv(
        ['시약명', '영문명', 'CAS', '불일치 항목', '시나리오 차이(고체 시약을 수용액으로 가정)', '엔진 매트릭스', '엔진 stream', 'AI 매트릭스', 'AI 분류', 'AI 분류에 맞는 stream',
            'AI reasoning', 'AI hazard_flags', '근거 출처', '골든셋 id', '골든셋 시나리오 근거', 'PubChem CID', 'AI 검수 판정'],
        rows.filter((row) => row.bucket === 'ready' && row.mismatches.length > 0).map((row) => [
            row.draft.nameKo, row.draft.nameEn, row.draft.casNumber, row.mismatches, row.scenarioDiffers ? '예' : '',
            row.engineMatrix, row.engineStream,
            row.draft.wasteMatrix, row.draft.labWasteCategory, row.aiExpectedStreams, row.draft.reasoning,
            row.draft.hazardFlags, row.evidenceSource, row.goldenId, row.scenarioBasis, row.pubchemCid, row.draft.verifyOverall,
        ]),
    );
}

export function heldCsv(rows: readonly ComparisonRow[]): string {
    return toCsv(
        ['시약명', 'CAS', '엔진 상태', '보류 사유', '필요한 입력', '엔진 매트릭스', '엔진 권고 stream(승인 아님)', 'AI 매트릭스', 'AI 분류', 'AI reasoning', '근거 출처', '골든셋 id', 'PubChem CID'],
        rows.filter((row) => row.bucket === 'held').map((row) => [
            row.draft.nameKo, row.draft.casNumber, row.engineStatus, row.engineReasons, row.engineMissingFields,
            row.engineMatrix, row.engineStream, row.draft.wasteMatrix, row.draft.labWasteCategory, row.draft.reasoning,
            row.evidenceSource, row.goldenId, row.pubchemCid,
        ]),
    );
}

const CONDITIONAL_VERDICT_LABELS: Record<ConditionalVerdict, string> = {
    match_at_ai_matrix: 'AI 매트릭스에서 일치',
    mismatch_at_ai_matrix: 'AI 매트릭스에서 불일치',
    held_at_ai_matrix: 'AI 매트릭스에서도 보류',
    no_ai_matrix: 'AI 매트릭스·분류로 비교 불가',
};

const conditionalCell = (result: ConditionalResult | undefined) => {
    if (!result) return '';
    if (result.status === 'ready') return result.stream;
    const why = [...result.reasons, ...result.missingFields.map((field) => `입력 필요:${field}`)];
    return `${result.status}${why.length ? ` (${why.join(' ')})` : ''}`;
};

/** Conditional per-matrix engine results: "if the matrix were X, the engine would say Y". Not a decision. */
export function conditionalCsv(rows: readonly ComparisonRow[]): string {
    return toCsv(
        ['시약명', '영문명', 'CAS', '조건부 판정', 'AI 매트릭스', 'AI 분류', 'AI 분류에 맞는 stream',
            ...CONDITIONAL_MATRICES.map((matrix) => `엔진(${matrix} 가정)`), '매트릭스 무관 stream',
            'AI reasoning', 'AI hazard_flags', 'PubChem CID', 'GHS 상태', 'AI 검수 판정'],
        rows.filter((row) => row.conditional && row.conditionalVerdict).map((row) => [
            row.draft.nameKo, row.draft.nameEn, row.draft.casNumber, CONDITIONAL_VERDICT_LABELS[row.conditionalVerdict!],
            row.draft.wasteMatrix, row.draft.labWasteCategory, row.aiExpectedStreams,
            ...CONDITIONAL_MATRICES.map((matrix) => conditionalCell(row.conditional!.find((result) => result.matrix === matrix))),
            matrixIndependentStream(row.conditional!), row.draft.reasoning, row.draft.hazardFlags,
            row.pubchemCid, row.hazardStatus, row.draft.verifyOverall,
        ]),
    );
}

export function noEvidenceCsv(rows: readonly ComparisonRow[]): string {
    return toCsv(
        ['시약명', '영문명', 'CAS', 'AI 매트릭스', 'AI 분류', 'AI hazard_flags'],
        rows.filter((row) => row.bucket === 'no_verified_evidence').map((row) => [
            row.draft.nameKo, row.draft.nameEn, row.draft.casNumber, row.draft.wasteMatrix,
            row.draft.labWasteCategory, row.draft.hazardFlags,
        ]),
    );
}
