/**
 * Apply the approved first-pass V2 adjudication decisions to the stored
 * golden labels.  This intentionally consumes the pre-change offline report
 * and asserts every cohort size, so a future baseline cannot silently relabel
 * a different set of materials.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const directory = path.join(root, 'data', 'waste-golden-set-v2');
const datasetPath = path.join(directory, 'materials.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const reportPath = path.join(directory, 'baseline-report.json');
const assessedAt = '2026-08-08T05:30:00.000Z';
const sha = (value) => createHash('sha256').update(value).digest('hex');

const AMMONIUM_SALT_CAS = new Set(['7783-20-2', '7783-18-8', '12593-60-1']);
const DIRECT_REACTIVE_EVIDENCE_CAS = new Set([
    '10325-94-7', '895-85-2', '26628-22-8', '302-01-2',
    '60-34-4', '100-63-0', '1304-85-4', '10058-23-8',
]);
const REACTIVE_NAME_FALSE_POSITIVE_CAS = new Set(['12037-01-3', '12738-76-0', '9054-89-1']);

const assertCount = (label, rows, expected) => {
    if (rows.length !== expected) {
        throw new Error(`${label}: expected ${expected} rows, received ${rows.length}.`);
    }
};

const decision = (status, reason, recommendedStreamCode) => ({
    status,
    ...(recommendedStreamCode ? { recommendedStreamCode } : {}),
    reason,
});

const adjudication = (outcome, reason, evidenceSections) => ({
    outcome,
    reason,
    evidenceSections,
    assessedAt,
});

async function main() {
    const [rows, report, manifest] = await Promise.all([
        readFile(datasetPath, 'utf8').then(JSON.parse),
        readFile(reportPath, 'utf8').then(JSON.parse),
        readFile(manifestPath, 'utf8').then(JSON.parse),
    ]);
    const baselineById = new Map(report.mismatches.map((mismatch) => [mismatch.id, mismatch]));
    const appCorrect = report.mismatches.filter(({ adjudication: item }) => item.outcome === 'app_correct');
    const insufficientReady = report.mismatches.filter((item) => (
        item.adjudication.outcome === 'insufficient_evidence' &&
        item.expected.status === 'ready' &&
        !AMMONIUM_SALT_CAS.has(item.casNumber)
    ));
    const directReactive = report.mismatches.filter((item) => DIRECT_REACTIVE_EVIDENCE_CAS.has(item.casNumber));
    const uncertainReactive = report.mismatches.filter((item) => (
        item.adjudication.outcome === 'gold_correct' &&
        item.actual.reasons.includes('reactive_waste') &&
        !DIRECT_REACTIVE_EVIDENCE_CAS.has(item.casNumber) &&
        !REACTIVE_NAME_FALSE_POSITIVE_CAS.has(item.casNumber)
    ));
    const reactiveNameFalsePositives = report.mismatches.filter((item) => REACTIVE_NAME_FALSE_POSITIVE_CAS.has(item.casNumber));
    const legacySpecialReview = rows.filter(({ expected }) => expected.status === 'SPECIAL_REVIEW');

    assertCount('app-correct cohort', appCorrect, 21);
    assertCount('insufficient-evidence ready cohort', insufficientReady, 41);
    assertCount('direct reactive-evidence cohort', directReactive, 8);
    assertCount('reactive uncertainty cohort', uncertainReactive, 12);
    assertCount('reactive keyword false-positive cohort', reactiveNameFalsePositives, 3);
    // Sixteen currently replay as needs_input with a special-review route;
    // one is independently blocked, but its golden status still carries the
    // same non-authorizing route recommendation after migration.
    assertCount('legacy SPECIAL_REVIEW status cohort', legacySpecialReview, 17);

    const appCorrectIds = new Set(appCorrect.map(({ id }) => id));
    const insufficientReadyIds = new Set(insufficientReady.map(({ id }) => id));
    const directReactiveIds = new Set(directReactive.map(({ id }) => id));
    const uncertainReactiveIds = new Set(uncertainReactive.map(({ id }) => id));

    const updated = rows.map((row) => {
        const baseline = baselineById.get(row.id);
        const next = { ...row, expected: { ...row.expected } };

        // A special-review destination is a recommendation, not a decision
        // status: the user must still establish the missing inputs.
        if (next.expected.status === 'SPECIAL_REVIEW') {
            next.expected = decision(
                'needs_input',
                next.expected.reason,
                'SPECIAL_REVIEW',
            );
        }

        if (appCorrectIds.has(row.id)) {
            if (!baseline || baseline.actual.status !== 'blocked') {
                throw new Error(`${row.id}: app-correct baseline must be blocked.`);
            }
            next.expected = decision(
                'blocked',
                'Stored SDS evidence independently establishes a special, reactive, or fluoride-container hold before container deposit.',
            );
            next.adjudication = adjudication(
                'app_correct',
                'The original hold label underweighted confirmed SDS evidence; the app result is the approved baseline.',
                [2, 10, 13, 15],
            );
        } else if (insufficientReadyIds.has(row.id)) {
            if (!baseline || baseline.actual.status !== 'needs_input') {
                throw new Error(`${row.id}: insufficient-evidence baseline must need input.`);
            }
            next.expected = decision(
                'needs_input',
                'Identity/GHS are known, but the stored SDS scenario does not establish enough composition or material-form evidence for automatic routing.',
                baseline.actual.streamCode,
            );
            next.adjudication = adjudication(
                'insufficient_evidence',
                'The prior common-stream label invented a route from incomplete single-substance scenario evidence.',
                [3, 9, 13, 15],
            );
        } else if (directReactiveIds.has(row.id)) {
            if (!baseline || baseline.actual.status !== 'blocked') {
                throw new Error(`${row.id}: direct-reactive baseline must be blocked.`);
            }
            next.expected = decision(
                'blocked',
                'KOSHA Section 2 or Section 10 directly establishes a reactive hazard; isolate before any container deposit.',
            );
            next.adjudication = adjudication(
                'app_correct',
                'Direct stored H-code or Section 10 evidence confirms reactivity; the original automatic-ready label was corrected.',
                [2, 10],
            );
        } else if (uncertainReactiveIds.has(row.id)) {
            if (!baseline || baseline.actual.status !== 'blocked') {
                throw new Error(`${row.id}: uncertain-reactive baseline must be blocked.`);
            }
            next.expected = decision(
                'needs_input',
                'Stored name-level evidence alone does not confirm reactivity, but it is insufficient to authorize automatic deposit.',
                'REACTIVE_OXIDIZER',
            );
            next.adjudication = adjudication(
                'insufficient_evidence',
                'The scenario is held pending stronger reactivity evidence; this is not an automatic-ready common stream.',
                [2, 10, 13],
            );
        }

        return next;
    });

    const serialized = `${JSON.stringify(updated, null, 2)}\n`;
    manifest.schemaVersion = '2.3.0';
    manifest.datasetSha256 = sha(serialized);
    manifest.generatedAt = assessedAt;
    manifest.baselineCorrection = {
        method: 'approved_first_pass_adjudication',
        assessedAt,
        appCorrect: appCorrectIds.size,
        insufficientEvidence: insufficientReadyIds.size,
        directReactiveEvidence: directReactiveIds.size,
        reactiveUncertainty: uncertainReactiveIds.size,
        reactiveNameFalsePositives: reactiveNameFalsePositives.length,
        specialReviewRecommendationMigrations: legacySpecialReview.length,
    };

    await Promise.all([
        writeFile(datasetPath, serialized, 'utf8'),
        writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    ]);
    console.log(JSON.stringify(manifest.baselineCorrection));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
