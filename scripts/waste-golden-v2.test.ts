import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    GOLDEN_SET_V2_VERSION,
    type GoldenConcentrationScenario,
    type WasteGoldenSetV2Manifest,
    type WasteGoldenSetV2Row,
    validateGoldenConcentrationScenarios,
    validateWasteGoldenSetV2,
} from '../src/features/wasteGoldenSet/schema';
import { runGoldenConcentrationScenarios, runWasteGoldenSetV2 } from './wasteGoldenSetV2';

const dataDirectory = path.resolve(process.cwd(), 'data', 'waste-golden-set-v2');
const datasetPath = path.join(dataDirectory, 'materials.json');
const manifestPath = path.join(dataDirectory, 'source-manifest.json');
const datasetText = readFileSync(datasetPath, 'utf8');
// Git stores this reviewed artifact with LF line endings. Windows checkouts may
// expose CRLF in the worktree, which must not change the canonical content hash.
const canonicalDatasetText = datasetText.replace(/\r\n?/gu, '\n');
const rows = JSON.parse(datasetText) as WasteGoldenSetV2Row[];
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WasteGoldenSetV2Manifest;
const scenariosText = readFileSync(path.join(dataDirectory, 'concentration-scenarios.json'), 'utf8');
const concentrationScenarios = JSON.parse(scenariosText) as GoldenConcentrationScenario[];

describe('CAS·SDS actual-substance golden set V2', () => {
    it('contains independently reviewed, evidence-complete unique CAS records', () => {
        expect(rows).toHaveLength(manifest.rowCount);
        expect(manifest.schemaVersion).toBe(GOLDEN_SET_V2_VERSION);
        expect(createHash('sha256').update(canonicalDatasetText).digest('hex')).toBe(manifest.datasetSha256);
        expect(validateWasteGoldenSetV2(rows, manifest)).toEqual([]);
    });

    it('withholds routing where product state and the former standard scenario conflict', () => {
        // The historic counts cover the original ten strata; the curated
        // common-reagent rows are checked separately below.
        const stateScenarioConflicts = rows.filter(({ scenario, stratum }) => (
            scenario.stateScenarioConflict && stratum !== 'common_lab_reagent'
        ));
        const gasToLiquid = stateScenarioConflicts.filter(({ scenario }) => (
            scenario.stateScenarioConflict === 'gas_to_liquid_waste'
        ));
        const liquidToSolid = stateScenarioConflicts.filter(({ scenario }) => (
            scenario.stateScenarioConflict === 'liquid_to_solid_residue'
        ));

        expect(stateScenarioConflicts).toHaveLength(78);
        expect(gasToLiquid).toHaveLength(29);
        expect(liquidToSolid).toHaveLength(49);
        const needsInputConflicts = stateScenarioConflicts.filter(({ expected }) => expected.status === 'needs_input');
        const independentlyBlockedConflicts = stateScenarioConflicts.filter(({ expected }) => expected.status === 'blocked');

        expect(needsInputConflicts).toHaveLength(50);
        expect(independentlyBlockedConflicts).toHaveLength(28);
        expect(needsInputConflicts.every(({ scenario, expected }) => (
            scenario.materialPhysicalForm !== 'unknown' &&
            scenario.wasteScenario === 'unresolved' &&
            scenario.scenarioBasis === 'insufficient_evidence' &&
            scenario.matrix === 'unknown' &&
            scenario.matrixSource === 'unresolved' &&
            expected.status === 'needs_input'
        ))).toBe(true);
        // A state conflict normally needs user input. These 28 also carry
        // independently confirmed reactive/fluoride or fatal-toxicity
        // evidence, so the safer approved outcome is a block rather than an
        // ordinary hold.
        expect(independentlyBlockedConflicts.every(({ expected, adjudication }) => (
            expected.status === 'blocked' && adjudication?.outcome === 'app_correct'
        ))).toBe(true);
        const reagentConflicts = rows.filter(({ scenario, stratum }) => (
            scenario.stateScenarioConflict && stratum === 'common_lab_reagent'
        ));
        expect(reagentConflicts.map(({ casNumber, expected }) => [casNumber, expected.status])).toEqual([
            ['7647-01-0', 'needs_input'],
            ['7664-39-3', 'blocked'],
        ]);
        expect(reagentConflicts.every(({ scenario }) => scenario.wasteScenario === 'unresolved')).toBe(true);
    });

    it('covers common laboratory reagents with hazard-specific answers', () => {
        const reagents = rows.filter(({ stratum }) => stratum === 'common_lab_reagent');
        const byCas = new Map(reagents.map((row) => [row.casNumber, row.expected]));

        expect(reagents).toHaveLength(manifest.strata.common_lab_reagent);
        expect(reagents.every(({ review }) => review.reviewerId === 'ai-assisted-label-review-v1')).toBe(true);
        expect(byCas.get('64-17-5')).toMatchObject({ status: 'ready', streamCode: 'ORGANIC_NON_HALOGENATED' });
        expect(byCas.get('75-09-2')).toMatchObject({ status: 'ready', streamCode: 'ORGANIC_HALOGENATED' });
        expect(byCas.get('64-19-7')).toMatchObject({ status: 'ready', streamCode: 'ACID_AQUEOUS' });
        expect(byCas.get('497-19-8')).toMatchObject({ status: 'ready', streamCode: 'ALKALI_AQUEOUS' });
        for (const blocked of ['7697-37-2', '7681-52-9', '16940-66-2', '109-72-8', '88-89-1', '20816-12-0', '1313-82-2']) {
            expect(byCas.get(blocked)?.status).toBe('blocked');
        }
    });

    it('records special review as a non-authorizing recommendation, not a decision status', () => {
        const specialReviewRecommendations = rows.filter(({ expected }) => (
            expected.status === 'needs_input' &&
            expected.recommendedStreamCode === 'SPECIAL_REVIEW'
        ));

        expect(specialReviewRecommendations).toHaveLength(16);
        expect(specialReviewRecommendations.every(({ expected }) => !expected.streamCode)).toBe(true);
    });

    it('records every post-approval label change as AI-assisted, never as human review', () => {
        const revised = rows.filter(({ labelRevisions }) => labelRevisions?.length);

        expect(revised).toHaveLength(91);
        expect(revised.every(({ labelRevisions }) => labelRevisions!.every((revision) => (
            revision.reviewMethod === 'ai_assisted_evidence_review' &&
            revision.humanReviewed === false &&
            revision.evidenceSections.length > 0
        )))).toBe(true);
        // Fatal acute toxicity is never a general common-container answer.
        // Inorganic cyanide salts keep their dedicated cyanide stream, which
        // the review document lists as an open human-policy question.
        expect(rows.filter(({ ghs, expected }) => (
            ghs.hCodes.some((code) => ['H300', 'H310', 'H330'].includes(code)) &&
            expected.status === 'ready' &&
            expected.streamCode !== 'CYANIDE_SULFIDE'
        ))).toEqual([]);
    });

    it('replays the stored PubChem structure the app uses for ionic organic salts', () => {
        const sodiumOctylSulfate = rows.find(({ casNumber }) => casNumber === '142-31-4')!;
        const withoutStructure = { ...sodiumOctylSulfate, connectivitySmiles: undefined };

        expect(sodiumOctylSulfate.connectivitySmiles).toBe('CCCCCCCCOS(=O)(=O)[O-].[Na+]');
        expect(runWasteGoldenSetV2([sodiumOctylSulfate]).strictMatches).toBe(1);
        expect(runWasteGoldenSetV2([withoutStructure]).mismatches[0]?.actual).toMatchObject({
            status: 'needs_input',
            missingFields: ['classification'],
        });
    });

    it('replays every stored standard scenario without a network dependency', () => {
        const report = runWasteGoldenSetV2(rows);
        const concentrationReport = runGoldenConcentrationScenarios(rows, concentrationScenarios);
        // CI output is intentionally the report artifact: there is no live SDS
        // request here, and no source document is copied into the repository.
        const conciseMismatchExamples = report.mismatches.slice(0, 10).map(({ id, casNumber, stratum, expected, actual, unsafeAutomaticReady, readyStreamMismatch, recommendedStreamMismatch, adjudication }) => ({
            id,
            casNumber,
            stratum,
            expected,
            actual: {
                status: actual.status,
                streamCode: actual.streamCode,
                reasons: actual.reasons,
                missingFields: actual.missingFields,
            },
            unsafeAutomaticReady,
            readyStreamMismatch,
            recommendedStreamMismatch,
            adjudication,
        }));
        console.log(JSON.stringify({
            goldenSet: 'V2',
            total: report.total,
            strictMatchRate: report.strictMatchRate,
            conservativeHoldRate: report.conservativeHoldRate,
            unsafeAutomaticReady: report.unsafeAutomaticReady,
            readyStreamMismatches: report.readyStreamMismatches,
            recommendedStreamMismatches: report.recommendedStreamMismatches,
            byStratum: report.byStratum,
            mismatchExamples: conciseMismatchExamples,
            concentrationScenarios: concentrationReport,
        }, null, 2));

        if (process.env.GOLDEN_SET_WRITE_REPORT === '1') {
            writeFileSync(path.join(dataDirectory, 'baseline-report.json'), `${JSON.stringify({
                schemaVersion: GOLDEN_SET_V2_VERSION,
                datasetSha256: manifest.datasetSha256,
                generatedAt: new Date().toISOString(),
                ...report,
                concentrationScenarios: concentrationReport,
            }, null, 2)}\n`, 'utf8');
        }

        expect(report.total).toBe(manifest.rowCount);
        // The safety gate is deliberately asymmetric: a conservative hold is a
        // metric for later improvement, but automatic ready against a withheld
        // or blocked golden result must never ship.
        expect(report.unsafeAutomaticReady).toBe(0);
        // A ready result is unsafe when it directs the verified standard
        // scenario to a different common stream, even if both sides say
        // "ready".  This gate is kept separate from conservative holds.
        expect(report.readyStreamMismatches).toBe(0);
        // The same asymmetric gate covers the concentration variants.
        expect(concentrationReport.unsafeAutomaticReady).toBe(0);
        expect(concentrationReport.readyStreamMismatches).toBe(0);
    });

    it('lifts the fatal-toxicity hold only for a solution below its KECO threshold', () => {
        // Same LF canonicalization as the row file: Windows checkouts may use CRLF.
        const canonicalScenariosText = scenariosText.replace(/\r\n?/gu, '\n');
        expect(manifest.concentrationScenarios).toEqual({
            file: 'concentration-scenarios.json',
            count: concentrationScenarios.length,
            datasetSha256: createHash('sha256').update(canonicalScenariosText).digest('hex'),
        });
        expect(validateGoldenConcentrationScenarios(concentrationScenarios, rows)).toEqual([]);
        const casCovered = new Set(concentrationScenarios.map(({ casNumber }) => casNumber));
        for (const cas of ['7664-93-9', '7697-37-2', '50-00-0', '1239-45-8']) expect(casCovered.has(cas)).toBe(true);

        const ready = concentrationScenarios.filter(({ expected }) => expected.status === 'ready');
        expect(ready.every(({ materialForm, concentration }) => materialForm === 'solution' && concentration)).toBe(true);
        // Neat products, empty concentrations, nitric acid (oxidizer) and
        // ethidium bromide (no KECO class) are never relaxed.
        expect(concentrationScenarios.filter(({ materialForm, concentration, casNumber }) => (
            materialForm === 'neat' || !concentration || casNumber === '7697-37-2' || casNumber === '1239-45-8'
        )).every(({ expected }) => expected.status === 'blocked')).toBe(true);

        const report = runGoldenConcentrationScenarios(rows, concentrationScenarios);
        expect(report.mismatches).toEqual([]);
        expect(report.strictMatches).toBe(concentrationScenarios.length);
    });
});
