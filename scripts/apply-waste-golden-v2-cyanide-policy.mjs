/*
 * Offline relabel for waste rule 2.8.0 (unified cyanide handling).
 *
 * The rows are listed by hand from the stored KOSHA evidence, not taken from
 * the analyzer:
 * - CYANIDE_ALKALINE_ROWS: aqueous cyanide salts and metal cyanide complexes
 *   that can release HCN. They go to the cyanide container only with a
 *   measured batch pH of 10 or higher, and the standard scenario has none, so
 *   the answer becomes needs_input with CYANIDE_SULFIDE recommended. Iron
 *   hexacyanides and thiocyanates are stable near neutral pH and keep ready.
 * - CYANIDE_UNIFICATION_ROWS: inorganic cyanides that were held only because
 *   their formula looked organic or was missing (ammonium cyanide, zinc
 *   cyanide) or because a complex name was not recognised (nitroprusside).
 *   They now follow the same cyanide rule.
 * Hydrogen cyanide, organic nitriles and acetone cyanohydrin stay blocked.
 * Every change is recorded as an AI-assisted label revision, never as human review.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.join(process.cwd(), 'data', 'waste-golden-set-v2');
const datasetPath = path.join(directory, 'materials.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const revisedAt = '2026-10-21T00:00:00.000Z';

const CYANIDE_ALKALINE_ROWS = [
    'v2-0001-57-12-5', // cyanide ion
    'v2-0002-506-65-0', // gold(I) cyanide
    'v2-0003-143-33-9', // sodium cyanide
    'v2-0004-592-01-8', // calcium cyanide
    'v2-0006-592-04-1', // mercuric cyanide
    'v2-0007-151-50-8', // potassium cyanide
    'v2-0009-15333-24-1', // sodium zinc cyanide
    'v2-0010-557-19-7', // nickel cyanide
    'v2-0011-542-84-7', // cobalt cyanide
    'v2-0012-14220-17-8', // nickel potassium cyanide
    'v2-0013-506-61-6', // potassium silver cyanide
    'v2-0014-14763-77-0', // cupric cyanide
    'v2-0015-14402-75-6', // potassium cadmium cyanide
    'v2-0017-591-89-9', // mercuric potassium cyanide
    'v2-0020-13967-50-5', // gold potassium cyanide
    'v2-0023-542-62-1', // barium cyanide
    'v2-0025-4367-08-2', // copper dicyanide
    'v2-0028-506-64-9', // silver cyanide
    'v2-0029-544-92-3', // copper(I) cyanide
    'v2-0030-592-05-2', // lead cyanide
    'v2-0031-506-78-5', // cyanogen iodide
    'v2-0036-542-83-6', // cadmium cyanide
];
const CYANIDE_UNIFICATION_ROWS = [
    'v2-0016-12211-52-8', // ammonium cyanide
    'v2-0026-557-21-1', // zinc dicyanide
    'v2-0037-14402-89-2', // sodium nitroprusside
];

const ALKALINE_REASON = 'Aqueous cyanide that can release HCN goes to the cyanide container only with a measured batch pH of 10 or higher (rule 2.8.0). The standard scenario has no measured pH, so it needs input; CYANIDE_SULFIDE is the recommended stream.';
const UNIFICATION_REASON = 'An inorganic cyanide like sodium cyanide (KOSHA Section 2 H300/H310/H330 is the cyanide toxicity itself), so it follows the cyanide rule instead of the general fatal-toxicity hold. ' + ALKALINE_REASON;

const rows = JSON.parse((await readFile(datasetPath, 'utf8')).replace(/\r\n?/gu, '\n'));
const byId = new Map(rows.map((row) => [row.id, row]));

const revise = (id, group, reason) => {
    const row = byId.get(id);
    if (!row) throw new Error(`Unknown row ${id}`);
    if (row.scenario.matrix !== 'aqueous') throw new Error(`${id} is not an aqueous scenario`);
    if (row.labelRevisions?.some((revision) => revision.group === group)) return;
    const previous = row.expected;
    row.expected = { status: 'needs_input', recommendedStreamCode: 'CYANIDE_SULFIDE', reason };
    row.labelRevisions = [...(row.labelRevisions ?? []), {
        previous,
        group,
        reason,
        evidenceSections: [2, 10, 13],
        reviewerId: 'ai-assisted-label-review-v1',
        reviewMethod: 'ai_assisted_evidence_review',
        humanReviewed: false,
        revisedAt,
    }];
};

for (const id of CYANIDE_ALKALINE_ROWS) revise(id, 'cyanide_alkaline_ph', ALKALINE_REASON);
for (const id of CYANIDE_UNIFICATION_ROWS) revise(id, 'cyanide_unification', UNIFICATION_REASON);

const text = `${JSON.stringify(rows, null, 2)}\n`;
await writeFile(datasetPath, text, 'utf8');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.datasetSha256 = createHash('sha256').update(text).digest('hex');
manifest.aiAssistedReview = {
    ...manifest.aiAssistedReview,
    cyanideAlkalinePhHolds: CYANIDE_ALKALINE_ROWS.length,
    cyanideUnificationRows: CYANIDE_UNIFICATION_ROWS.length,
    cyanidePolicyAssessedAt: revisedAt,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Relabelled ${CYANIDE_ALKALINE_ROWS.length + CYANIDE_UNIFICATION_ROWS.length} cyanide rows.`);
