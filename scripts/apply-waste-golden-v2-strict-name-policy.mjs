/*
 * Offline relabel for waste rule 2.9.0 (stricter name-based holds, user
 * approved). The rows are listed by hand from the stored KOSHA evidence, not
 * taken from the analyzer:
 * - ORGANIC_PEROXIDE_ROWS: organic peroxides named "...diperoxide" or made
 *   with a hydroperoxide. KOSHA Section 2 has no H242, but Section 10 warns
 *   that the container can explode on heating. They are blocked for
 *   REACTIVE_OXIDIZER handover instead of the organic common stream.
 * - SUBSTITUTED_HYDRAZINE_ROWS: alkyl and aryl hydrazines. They are strong
 *   reducers like hydrazine itself and are blocked the same way.
 *   1,1-Dimethylhydrazine (57-14-7) is already blocked for fatal toxicity.
 *   Acyl hydrazines such as N,N'-diacetylhydrazine (3148-73-0) are
 *   hydrazides, not reactive, and keep their label.
 * - NAMED_METAL_FLUORINE_SOLID_ROWS: unclassified solids without a formula
 *   whose name shows a heavy metal or fluorine. They keep the classification
 *   hold instead of the common contaminated-solid fallback.
 * Every change is recorded as an AI-assisted label revision, never as human review.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.join(process.cwd(), 'data', 'waste-golden-set-v2');
const datasetPath = path.join(directory, 'materials.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const revisedAt = '2026-10-21T12:00:00.000Z';

const ORGANIC_PEROXIDE_ROWS = [
    'v2-0250-2781-00-2', // di-tert-butyl ... (p-phenylenedimethylene) diperoxide
    'v2-0252-129757-67-1', // sebacate reaction products with tert-butyl hydroperoxide
];
const SUBSTITUTED_HYDRAZINE_ROWS = [
    'v2-0294-1615-80-1', // 1,2-diethylhydrazine
    'v2-0296-540-73-8', // 1,2-dimethylhydrazine
    'v2-0297-122-66-7', // 1,2-diphenylhydrazine (hydrazobenzene)
];
const NAMED_METAL_FLUORINE_SOLID_ROWS = [
    'v2-0154-12656-57-4', // cadmium sulfoselenide orange
    'v2-0354-74912-23-5', // europium fluoroborate
    'v2-0546-1332-65-6', // dicopper chloride trihydroxide
    'v2-0948-18943-30-1', // strontium hexafluorosilicate
];

const PEROXIDE_REASON = 'The Section 3 identity is an organic peroxide. KOSHA Section 2 has no H242, but Section 10 warns that the container can explode on heating, and reactive/oxidizer holds are never loosened (rule 2.9.0). Keep it out of common containers and hand it over as REACTIVE_OXIDIZER waste.';
const HYDRAZINE_REASON = 'The Section 3 identity is a substituted hydrazine, a strong reducer like hydrazine itself. Section 10 warns that the container can explode on heating, and the analyzer blocks alkyl and aryl hydrazines like hydrazine (rule 2.9.0). Keep it out of common containers and hand it over as REACTIVE_OXIDIZER waste.';
const SOLID_REASON = 'The unclassified solid has no formula, and its Section 3 name shows a heavy metal or fluorine. The common contaminated-solid fallback is withheld (rule 2.9.0), so the user must confirm the classification before routing.';

const rows = JSON.parse((await readFile(datasetPath, 'utf8')).replace(/\r\n?/gu, '\n'));
const byId = new Map(rows.map((row) => [row.id, row]));

const revise = (id, group, expected, evidenceSections) => {
    const row = byId.get(id);
    if (!row) throw new Error(`Unknown row ${id}`);
    if (row.labelRevisions?.some((revision) => revision.group === group)) return;
    if (row.expected.status === expected.status) throw new Error(`${id} already has status ${expected.status}`);
    const previous = row.expected;
    row.expected = expected;
    row.labelRevisions = [...(row.labelRevisions ?? []), {
        previous,
        group,
        reason: expected.reason,
        evidenceSections,
        reviewerId: 'ai-assisted-label-review-v1',
        reviewMethod: 'ai_assisted_evidence_review',
        humanReviewed: false,
        revisedAt,
    }];
};

for (const id of ORGANIC_PEROXIDE_ROWS) {
    revise(id, 'organic_peroxide_reactive_block', { status: 'blocked', reason: PEROXIDE_REASON }, [2, 3, 10]);
}
for (const id of SUBSTITUTED_HYDRAZINE_ROWS) {
    revise(id, 'substituted_hydrazine_reactive_block', { status: 'blocked', reason: HYDRAZINE_REASON }, [2, 3, 10]);
}
for (const id of NAMED_METAL_FLUORINE_SOLID_ROWS) {
    revise(id, 'named_metal_fluorine_solid_hold', { status: 'needs_input', reason: SOLID_REASON }, [2, 3, 9]);
}

const text = `${JSON.stringify(rows, null, 2)}\n`;
await writeFile(datasetPath, text, 'utf8');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.datasetSha256 = createHash('sha256').update(text).digest('hex');
manifest.aiAssistedReview = {
    ...manifest.aiAssistedReview,
    organicPeroxideBlocks: ORGANIC_PEROXIDE_ROWS.length,
    substitutedHydrazineBlocks: SUBSTITUTED_HYDRAZINE_ROWS.length,
    namedMetalFluorineSolidHolds: NAMED_METAL_FLUORINE_SOLID_ROWS.length,
    strictNamePolicyAssessedAt: revisedAt,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const total = ORGANIC_PEROXIDE_ROWS.length + SUBSTITUTED_HYDRAZINE_ROWS.length + NAMED_METAL_FLUORINE_SOLID_ROWS.length;
console.log(`Relabelled ${total} rows for the 2.9.0 name policy.`);
