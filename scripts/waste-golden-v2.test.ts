import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    GOLDEN_SET_V2_VERSION,
    type WasteGoldenSetV2Manifest,
    type WasteGoldenSetV2Row,
    validateWasteGoldenSetV2,
} from '../src/features/wasteGoldenSet/schema';
import { runWasteGoldenSetV2 } from './wasteGoldenSetV2';

const dataDirectory = path.resolve(process.cwd(), 'data', 'waste-golden-set-v2');
const datasetPath = path.join(dataDirectory, 'materials.json');
const manifestPath = path.join(dataDirectory, 'source-manifest.json');
const datasetText = readFileSync(datasetPath, 'utf8');
// Git stores this reviewed artifact with LF line endings. Windows checkouts may
// expose CRLF in the worktree, which must not change the canonical content hash.
const canonicalDatasetText = datasetText.replace(/\r\n?/gu, '\n');
const rows = JSON.parse(datasetText) as WasteGoldenSetV2Row[];
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WasteGoldenSetV2Manifest;

describe('CAS·SDS actual-substance golden set V2', () => {
    it('contains exactly 1,000 independently reviewed, evidence-complete unique CAS records', () => {
        expect(rows).toHaveLength(1000);
        expect(manifest.schemaVersion).toBe(GOLDEN_SET_V2_VERSION);
        expect(manifest.rowCount).toBe(1000);
        expect(createHash('sha256').update(canonicalDatasetText).digest('hex')).toBe(manifest.datasetSha256);
        expect(validateWasteGoldenSetV2(rows, manifest)).toEqual([]);
    });

    it('withholds routing where product state and the former standard scenario conflict', () => {
        const stateScenarioConflicts = rows.filter(({ scenario }) => scenario.stateScenarioConflict);
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

        expect(needsInputConflicts).toHaveLength(58);
        expect(independentlyBlockedConflicts).toHaveLength(20);
        expect(needsInputConflicts.every(({ scenario, expected }) => (
            scenario.materialPhysicalForm !== 'unknown' &&
            scenario.wasteScenario === 'unresolved' &&
            scenario.scenarioBasis === 'insufficient_evidence' &&
            scenario.matrix === 'unknown' &&
            scenario.matrixSource === 'unresolved' &&
            expected.status === 'needs_input'
        ))).toBe(true);
        // A state conflict normally needs user input. These 20 also carry
        // independently confirmed reactive/fluoride evidence, so the safer
        // approved outcome is a block rather than an ordinary hold.
        expect(independentlyBlockedConflicts.every(({ expected, adjudication }) => (
            expected.status === 'blocked' && adjudication?.outcome === 'app_correct'
        ))).toBe(true);
    });

    it('records special review as a non-authorizing recommendation, not a decision status', () => {
        const specialReviewRecommendations = rows.filter(({ expected }) => (
            expected.status === 'needs_input' &&
            expected.recommendedStreamCode === 'SPECIAL_REVIEW'
        ));

        expect(specialReviewRecommendations).toHaveLength(17);
        expect(specialReviewRecommendations.every(({ expected }) => !expected.streamCode)).toBe(true);
    });

    it('replays every stored standard scenario without a network dependency', () => {
        const report = runWasteGoldenSetV2(rows);
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
        }, null, 2));

        if (process.env.GOLDEN_SET_WRITE_REPORT === '1') {
            writeFileSync(path.join(dataDirectory, 'baseline-report.json'), `${JSON.stringify({
                schemaVersion: GOLDEN_SET_V2_VERSION,
                datasetSha256: manifest.datasetSha256,
                generatedAt: new Date().toISOString(),
                ...report,
            }, null, 2)}\n`, 'utf8');
        }

        expect(report.total).toBe(1000);
        // The safety gate is deliberately asymmetric: a conservative hold is a
        // metric for later improvement, but automatic ready against a withheld
        // or blocked golden result must never ship.
        expect(report.unsafeAutomaticReady).toBe(0);
        // A ready result is unsafe when it directs the verified standard
        // scenario to a different common stream, even if both sides say
        // "ready".  This gate is kept separate from conservative holds.
        expect(report.readyStreamMismatches).toBe(0);
    });
});
