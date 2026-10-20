/*
 * Offline curator for the V2 concentration scenarios (waste rule 2.7.0).
 *
 * Each scenario reuses a stored common-reagent row for identity, GHS and
 * KOSHA evidence and adds the material form and concentration a researcher
 * enters, plus the KECO hazardous-class thresholds from the stored snapshot
 * (scripts/fixtures/keco-fatal-toxicity-dilution-2026-10-20.json). The
 * expected answers below are written by hand from that evidence, never taken
 * from the analyzer, and are disclosed as AI-assisted (not human) review:
 *
 * - neat product, solid, or no usable concentration: the fatal acute-toxicity
 *   (H330) hold stays, as in the base row;
 * - a prepared solution below the LOWEST threshold of every hazardous KECO
 *   class is no 유해화학물질 mixture, so the hold is lifted and the ordinary
 *   stream for that chemistry applies; at or above it the hold stays
 *   (published rules read "N% 이상");
 * - a % without a w/w or w/v basis is read as the dense liquid measured out
 *   (the neat or stock density), never as less than entered;
 * - an independent hold is never lifted: nitric acid keeps its H271 oxidizer
 *   hold, and a substance KECO does not classify (ethidium bromide) has no
 *   threshold and stays held.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.join(process.cwd(), 'data', 'waste-golden-set-v2');
const scenariosPath = path.join(directory, 'concentration-scenarios.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const kecoPath = path.join(process.cwd(), 'scripts', 'fixtures', 'keco-fatal-toxicity-dilution-2026-10-20.json');
const reviewedAt = '2026-10-20T00:00:00.000Z';

const HAZARDOUS = new Set([
    'banned', 'restricted', 'permitted', 'accident_preparedness', 'toxic',
    'acute_toxic', 'chronic_toxic', 'eco_toxic', 'human_eco_hazard',
]);

const HELD = 'Isolate for SPECIAL_REVIEW handover instead of a common container.';

// [base row, suffix, form, concentration | null, expected status, ready stream | null, reason]
const SCENARIOS = [
    ['v2-1002-7664-93-9', 'c1m', 'solution', { value: 1, unit: 'M' }, 'ready', 'ACID_AQUEOUS',
        '1 M is about 9.8% w/v (w/w is lower), below the 10% KECO threshold of both 사고대비물질 and 인체급성유해성; a corrosive (H314) aqueous acid goes to the aqueous acid stream.'],
    ['v2-1002-7664-93-9', 'c5ww', 'solution', { value: 5, unit: '%', basis: 'w_w' }, 'ready', 'ACID_AQUEOUS',
        '5% w/w is below the 10% KECO threshold; corrosive (H314) aqueous acid stream.'],
    ['v2-1002-7664-93-9', 'c2m', 'solution', { value: 2, unit: 'M' }, 'blocked', null,
        `2 M is about 19.6% w/v, above the 10% KECO threshold, so the fatal acute-toxicity (H330) hold stays. ${HELD}`],
    ['v2-1002-7664-93-9', 'c10ww', 'solution', { value: 10, unit: '%', basis: 'w_w' }, 'blocked', null,
        `The KECO rule reads "10% 이상", so exactly 10% w/w is still a hazardous mixture. ${HELD}`],
    ['v2-1002-7664-93-9', 'c6vv', 'solution', { value: 6, unit: '%', basis: 'v_v' }, 'blocked', null,
        `6% v/v of concentrated acid (1.84 g/mL) is about 11% by mass, above the 10% KECO threshold. ${HELD}`],
    ['v2-1002-7664-93-9', 'neat', 'neat', null, 'blocked', null,
        `The neat product is judged as supplied (100%). ${HELD}`],
    ['v2-1002-7664-93-9', 'unknown', 'solution', null, 'blocked', null,
        `Without a concentration the solution cannot be shown to be below the KECO threshold. ${HELD}`],
    ['v2-1003-7697-37-2', 'c01m', 'solution', { value: 0.1, unit: 'M' }, 'blocked', null,
        'KOSHA Section 2 classifies nitric acid as an oxidizer (H271); the oxidizer hold is independent of the 10% KECO acute-toxicity threshold and is never relaxed by dilution here.'],
    ['v2-1003-7697-37-2', 'c1ww', 'solution', { value: 1, unit: '%', basis: 'w_w' }, 'blocked', null,
        'Below the 10% KECO threshold, but the H271 oxidizer hold still applies; keep it apart from organics and flammables.'],
    ['v2-1003-7697-37-2', 'neat', 'neat', null, 'blocked', null,
        'Neat nitric acid is an oxidizer (H271) with fatal inhalation toxicity (H330).'],
    ['v2-1054-50-00-0', 'c005ww', 'solution', { value: 0.05, unit: '%', basis: 'w_w' }, 'ready', 'AQUEOUS_OTHER',
        '0.05% w/w is below every KECO threshold (제한물질 1%, 사고대비물질 1%, 인체급성유해성 1%, 인체만성유해성 0.1%); a dilute non-halogenated aqueous solution goes to the ordinary aqueous stream.'],
    ['v2-1054-50-00-0', 'c05ww', 'solution', { value: 0.5, unit: '%', basis: 'w_w' }, 'blocked', null,
        `0.5% is below the 1% acute threshold but above the 0.1% 인체만성유해성 threshold, so it is still a hazardous mixture. ${HELD}`],
    ['v2-1054-50-00-0', 'c4wv', 'solution', { value: 4, unit: '%', basis: 'w_v' }, 'blocked', null,
        `4% formaldehyde (10% formalin fixative) is above every KECO threshold. ${HELD}`],
    ['v2-1054-50-00-0', 'neat', 'neat', null, 'blocked', null,
        `Formalin as supplied is judged at 100%. ${HELD}`],
    ['v2-1054-50-00-0', 'unknown', 'solution', null, 'blocked', null,
        `Without a concentration the solution cannot be shown to be below the KECO thresholds. ${HELD}`],
    ['v2-1055-111-30-8', 'c05wv', 'solution', { value: 0.5, unit: '%', basis: 'w_v' }, 'ready', 'AQUEOUS_OTHER',
        '0.5% w/v is below the 1% 인체급성유해성 and 25% 생태유해성 KECO thresholds; ordinary aqueous stream.'],
    ['v2-1055-111-30-8', 'c25wv', 'solution', { value: 2.5, unit: '%', basis: 'w_v' }, 'blocked', null,
        `2.5% glutaraldehyde fixative is above the 1% KECO acute threshold. ${HELD}`],
    ['v2-1056-1239-45-8', 'c05ugml', 'solution', { value: 0.0005, unit: 'mg/mL' }, 'blocked', null,
        `KECO lists no hazardous class for ethidium bromide, so no legal threshold can lift the fatal acute-toxicity (H330) hold even for a 0.5 µg/mL gel buffer. ${HELD}`],
    ['v2-1056-1239-45-8', 'c10mgml', 'solution', { value: 10, unit: 'mg/mL' }, 'blocked', null,
        `A 10 mg/mL stock has fatal inhalation toxicity (H330) and no KECO threshold. ${HELD}`],
    ['v2-1056-1239-45-8', 'neat', 'neat', null, 'blocked', null,
        `The neat product is judged as supplied. ${HELD}`],
    ['v2-1057-60-24-2', 'c01vv', 'solution', { value: 0.1, unit: '%', basis: 'v_v' }, 'ready', 'AQUEOUS_OTHER',
        '0.1% v/v (about 0.11% by mass) is below the 1% 인체급성유해성 and 25% 생태유해성 KECO thresholds; ordinary aqueous stream.'],
    ['v2-1057-60-24-2', 'c1vv', 'solution', { value: 1, unit: '%', basis: 'v_v' }, 'blocked', null,
        `1% v/v of the neat liquid (1.11 g/mL) is above the 1% KECO acute threshold. ${HELD}`],
    ['v2-1057-60-24-2', 'neat', 'neat', null, 'blocked', null,
        `The neat product is judged as supplied. ${HELD}`],
];

const rows = JSON.parse(await readFile(path.join(directory, 'materials.json'), 'utf8'));
const keco = JSON.parse(await readFile(kecoPath, 'utf8'));
const rowsById = new Map(rows.map((row) => [row.id, row]));

const scenarios = SCENARIOS.map(([baseRowId, suffix, materialForm, concentration, status, streamCode, reason]) => {
    const base = rowsById.get(baseRowId);
    if (!base) throw new Error(`Unknown base row ${baseRowId}`);
    const record = keco.records.find((candidate) => candidate.casNumber === base.casNumber);
    if (!record) throw new Error(`No KECO record for ${base.casNumber}`);
    return {
        id: `${baseRowId}-${suffix}`,
        baseRowId,
        casNumber: base.casNumber,
        materialForm,
        ...(concentration ? { concentration } : {}),
        thresholdEvidence: {
            authority: 'KECO',
            service: keco.source.service,
            accessedAt: `${keco.source.accessedAt}T00:00:00.000Z`,
            entries: record.entries
                .filter((entry) => HAZARDOUS.has(entry.category))
                .map(({ typeName, uniqueNumber, contentThreshold }) => ({
                    typeName,
                    uniqueNumber,
                    ...(contentThreshold ? { contentThreshold } : {}),
                })),
        },
        expected: {
            status,
            ...(streamCode ? { streamCode } : {}),
            reason,
        },
        review: {
            reviewerId: 'ai-assisted-label-review-v1',
            reviewMethod: 'ai_assisted_evidence_review',
            humanReviewed: false,
            reviewedAt,
        },
    };
});

const text = `${JSON.stringify(scenarios, null, 2)}\n`;
await writeFile(scenariosPath, text, 'utf8');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.concentrationScenarios = {
    file: 'concentration-scenarios.json',
    count: scenarios.length,
    datasetSha256: createHash('sha256').update(text).digest('hex'),
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${scenarios.length} concentration scenarios.`);
