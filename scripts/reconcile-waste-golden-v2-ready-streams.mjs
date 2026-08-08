/*
 * Reconciles audited V2 ready-to-ready stream mismatches.
 *
 * These are data corrections, not a second routing engine: each entry records
 * whether the stored KOSHA evidence supports the pre-existing app result or
 * the app needs a routing-rule correction.  The product-side corrections live
 * in chemicalAnalyzer.ts and wasteBatch.ts; this script only updates the
 * evidence-backed expected scenario/label and its immutable audit note.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.join(process.cwd(), 'data', 'waste-golden-set-v2');
const dataPath = path.join(directory, 'materials.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const assessedAt = '2026-08-08T00:00:00.000Z';
const sha = (value) => createHash('sha256').update(value).digest('hex');

const ready = (streamCode, reason) => ({ status: 'ready', streamCode, reason });
const hold = (reason) => ({ status: 'needs_input', reason });
const audit = (outcome, reason, evidenceSections = [2, 3, 9, 10, 13, 15]) => ({
    outcome,
    reason,
    evidenceSections,
    assessedAt,
});

const updates = new Map([
    // Organic nitrile/sulfide aliases: preserve the source-backed organic
    // stream. Acrylonitrile is the exception because its fatal H-codes are an
    // independently stored reason to withhold automatic deposit.
    ['107-13-1', {
        expected: { status: 'blocked', reason: 'KOSHA Section 2 lists fatal acute-toxicity H-codes; do not automatically authorize container deposit.' },
        adjudication: audit('app_correct', 'The prior organic-stream label omitted fatal acute-toxicity evidence.', [2, 13, 15]),
    }],

    // Inorganic sulfides remain in their dedicated stream. The old labels
    // were generated from a generic inorganic-salt fallback rather than the
    // stored sulfide identity.
    ...['1344-81-6', '12025-34-2', '12039-15-5', '12068-85-8', '13759-10-9', '12138-09-9']
        .map((casNumber) => [casNumber, {
            expected: ready('CYANIDE_SULFIDE', 'KOSHA Section 3 identifies an inorganic sulfide standard scenario; use the dedicated cyanide/sulfide common stream.'),
            adjudication: audit('app_correct', 'The prior general-aqueous label discarded the stored inorganic sulfide identity.', [3, 10, 13, 15]),
        }]),

    // Acid-like names without a confirmed free-acid identity/pH are ordinary
    // aqueous waste in this standard scenario. This avoids treating every
    // organic "... acid ... hydrazide" name as an acid-container instruction.
    ...['925-83-7', '4080-98-2', '3619-17-8', '1071-93-8', '2760-98-7', '6629-10-3', '965-52-6', '161050-58-4', '327-97-9', '542-05-2', '11099-06-2', '7487-88-9', '18939-43-0', '13824-85-6', '1000-56-2', '13494-91-2']
        .map((casNumber) => [casNumber, {
            expected: ready('AQUEOUS_OTHER', 'KOSHA Sections 2 and 9 do not establish a free corrosive-acid aqueous identity for the stored standard scenario; use the general aqueous common stream.'),
            adjudication: audit('app_correct', 'The prior acid label was generated from a material-name keyword without corroborating acid-routing evidence.', [2, 3, 9, 13, 15]),
        }]),

    // Explicit acid-salt evidence for sodium bisulfate is retained. Other
    // sulfate aliases are handled by the app rule so their existing general
    // aqueous labels stay unchanged.
    ['7681-38-1', {
        expected: ready('ACID_AQUEOUS', 'KOSHA Section 9 records an acidic aqueous pH for sodium bisulfate; use the acid aqueous common stream.'),
        adjudication: audit('app_correct', 'The prior general-aqueous label conflicted with stored Section 9 acidic pH evidence.', [2, 3, 9, 13, 15]),
    }],

    // Metal-containing hydroxide/oxide materials take the heavy-metal stream;
    // hydroxide wording alone is not a basis for an alkali stream.
    ...['138265-88-0', '169314-88-9'].map((casNumber) => [casNumber, {
        expected: ready('HEAVY_METAL', 'KOSHA Section 3 confirms zinc-containing material identity; use the heavy-metal common stream.'),
        adjudication: audit('app_correct', 'The prior alkali label elevated hydroxide wording above the metal-containing identity.', [3, 13, 15]),
    }]),

    // Zwitterions, inner salts and metal soaps are not free hydroxide bases in
    // the stored single-substance scenario.
    ...['54326-11-3', '59272-84-3', '4292-10-8', '15990-43-9', '142-03-0']
        .map((casNumber) => [casNumber, {
            expected: ready('AQUEOUS_OTHER', 'KOSHA Sections 2, 3 and 9 do not establish a free alkali aqueous identity for the stored standard scenario; use the general aqueous common stream.'),
            adjudication: audit('app_correct', 'The prior alkali label was generated from hydroxide wording in an inner-salt, metal-soap, or nomenclature alias.', [2, 3, 9, 13, 15]),
        }]),

    ['73772-46-0', {
        expected: ready('ALKALI_AQUEOUS', 'KOSHA Section 3 identifies an ammonium hydroxide material; use the alkali aqueous common stream.'),
        adjudication: audit('gold_correct', 'The explicit ammonium-hydroxide identity should retain the alkali label.', [2, 3, 9, 13]),
    }],

    ['92203-02-6', {
        expected: hold('The KOSHA identity is a reaction-product material rather than a composition-resolved single substance; obtain composition and matrix confirmation before routing.'),
        adjudication: audit('app_correct', 'The prior alkali label treated a reaction-product material as a single resolved hydroxide.', [2, 3, 9, 13, 15]),
    }],

    // These rows already expected contaminated solids, but their hard-coded
    // organic matrix contradicted the stored Section 9 physical state.
    ...['68956-81-0', '7720-78-7', '12174-11-7'].map((casNumber) => [casNumber, {
        scenario: { physicalForm: 'solid', matrix: 'solid_slurry' },
        adjudication: audit('app_correct', 'The prior organic matrix conflicted with the stored Section 9 solid physical form.', [3, 9, 13, 15]),
    }]),

    // The initial 57-case audit exposed additional rows that had previously
    // passed only because the app shared the same broad cyanide/sulfide
    // precedence.  Metal sulfides belong to their metal stream under the
    // current common-stream policy.
    ...['21109-95-5', '12035-51-7', '12359-48-7', '21548-73-2', '11113-75-0', '12035-72-2', '12612-50-9', '13598-22-6', '12137-12-1', '12344-68-2', '12626-36-7', '11112-63-3', '12003-00-8', '1317-40-4', '22205-45-4', '12214-12-9', '12442-27-2', '71243-75-9']
        .map((casNumber) => [casNumber, {
            expected: ready('HEAVY_METAL', 'KOSHA Section 3 confirms a heavy-metal sulfide identity; use the heavy-metal common stream.'),
            adjudication: audit('app_correct', 'The prior cyanide/sulfide label discarded the heavy-metal routing priority.', [2, 3, 9, 13, 15]),
        }]),

    ['19158-51-1', {
        expected: ready('AQUEOUS_OTHER', 'The stored organic sulfonyl-cyanide identity is not an inorganic cyanide salt; use the general aqueous common stream for this standard scenario.'),
        adjudication: audit('app_correct', 'The prior cyanide/sulfide label was generated from an organic cyanide name fragment.', [2, 3, 9, 13, 15]),
    }],
]);

// These cases retain the original golden label. The audit says the app rule,
// rather than the evidence-backed stream, required correction.
const appRuleCorrections = new Map([
    ...['6306-60-1', '93-17-4', '592-88-1', '352-93-2', '139-66-2', '463-58-1', '75-18-3', '624-89-5', '3698-89-3', '21948-70-9', '2179-57-9', '420-12-2']
        .map((casNumber) => [casNumber, audit('gold_correct', 'Organic formula and KOSHA identity show a nitrile/thioether, not an inorganic cyanide/sulfide waste.', [2, 3, 9, 10, 13])]),
    ...['1315-01-1', '12137-74-5'].map((casNumber) => [casNumber, audit('gold_correct', 'The metal-containing sulfide must retain heavy-metal routing priority.', [2, 3, 9, 13, 15])]),
    ...['505-86-2', '4499-86-9', '100-85-6', '2052-49-5', '14518-69-5', '12027-05-3']
        .map((casNumber) => [casNumber, audit('gold_correct', 'The stored identity is an explicit hydroxide base; the app needed an identity rule that also works for carbon-containing hydroxides.', [2, 3, 9, 13])]),
    ...['10028-22-5', '10294-54-9', '10377-48-7', '13454-94-9', '7759-02-6', '10124-41-1']
        .map((casNumber) => [casNumber, audit('gold_correct', 'The existing general-aqueous label is retained; the app previously matched an acid name embedded in an inorganic-salt alias.', [2, 3, 9, 13, 15])]),
    ...['591-89-9', '14038-43-8', '13943-58-3', '13746-66-2', '14481-29-9', '506-78-5']
        .map((casNumber) => [casNumber, audit('gold_correct', 'The stored identity is an inorganic cyanide complex or cyanogen halide; the app must retain the dedicated cyanide/sulfide route.', [2, 3, 9, 10, 13, 15])]),
]);

const rows = JSON.parse(await readFile(dataPath, 'utf8'));
let applied = 0;
const reconciled = rows.map((row) => {
    const update = updates.get(row.casNumber);
    const appRuleAudit = appRuleCorrections.get(row.casNumber);
    if (!update && !appRuleAudit) return row;
    applied += 1;
    return {
        ...row,
        ...(update?.expected ? { expected: update.expected } : {}),
        ...(update?.scenario ? {
            scenario: { ...row.scenario, ...update.scenario },
        } : {}),
        adjudication: update?.adjudication ?? appRuleAudit,
    };
});

if (applied !== 87) {
    throw new Error(`Expected to reconcile 87 audited ready-stream cases, applied ${applied}.`);
}

const serialized = `${JSON.stringify(reconciled, null, 2)}\n`;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.datasetSha256 = sha(serialized);
manifest.generatedAt = new Date().toISOString();
manifest.readyStreamReconciliation = {
    method: 'stored_kosha_evidence_and_standard_scenario_audit',
    assessedAt,
    reviewedCases: 87,
};
await writeFile(dataPath, serialized, 'utf8');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Reconciled ${applied} V2 ready-stream mismatches.`);
