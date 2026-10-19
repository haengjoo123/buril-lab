/**
 * Apply the 2026-10-19 AI-assisted re-review of the V2 mismatch baseline.
 *
 * Every cohort is listed by CAS and its size is asserted, so the script can
 * only relabel the rows that were reviewed in WASTE_GOLDEN_SET_V2_REVIEW.md.
 * It reads stored KOSHA evidence only (no network). The decisions are
 * AI-assisted and are recorded as such; they are not a human/legal review.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.join(process.cwd(), 'data', 'waste-golden-set-v2');
const datasetPath = path.join(directory, 'materials.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const revisedAt = '2026-10-19T00:00:00.000Z';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const FATAL_CODES = ['H300', 'H310', 'H330'];

/** H300/H310/H330 rows that the analyzer isolates as SPECIAL_REVIEW. */
const FATAL_TOXICITY_CAS = new Set([
    '74-90-8', '12211-52-8', '557-21-1', '107-12-0', '14402-89-2', '75-15-0', '7783-06-4',
    '1344-48-5', '31119-53-6', '1191-79-3', '1345-09-1', '1306-19-0', '10124-36-4', '10108-64-2',
    '68876-84-6', '7439-97-6', '15385-58-7', '10112-91-1', '12344-40-0', '22967-92-6', '7784-03-4',
    '79-19-6', '2231-57-4', '497-18-7', '6610-29-3', '57-14-7', '640-19-7', '684-16-2', '367-11-3',
    '16961-83-4', '3863-11-4', '453-18-9', '382-21-8', '62-74-8', '420-46-2', '685-88-1', '96-24-2',
    '327-98-0', '78-95-5', '126-99-8', '1897-45-6', '4109-96-0', '5836-73-7', '12663-46-6', '109-09-1',
    '79-11-8', '87-86-5', '107-14-2', '107-20-0', '111-44-4', '1825-21-4', '20427-59-2', '75-59-2',
    '21041-93-0', '77-78-1', '7783-35-9', '7488-55-3', '7446-18-6', '7783-36-0', '1031-07-8',
    '151-21-3', '65-30-5', '2074-50-2', '10031-59-1', '51-60-5', '75-86-5', '921-03-9', '1752-30-3',
    '1798-60-3', '107-18-6', '51774-11-9', '107-19-7', '68551-07-5', '90604-31-2', '68333-80-2',
    '68603-15-6', '681-84-5',
]);

/** Section 3 identity is an oxidizing or energetic functional group. */
const REACTIVE_IDENTITY_CAS = new Map([
    ['10022-68-1', 'nitrate oxidizer (cadmium nitrate)'],
    ['7783-32-6', 'iodate oxidizer (mercuric iodate)'],
    ['7616-83-3', 'perchlorate oxidizer (mercuric perchlorate)'],
    ['94-17-7', 'diacyl organic peroxide'],
    ['3071-32-7', 'organic hydroperoxide'],
    ['1705-60-8', 'tetrakis(tert-butylperoxy) organic peroxide'],
    ['7782-79-8', 'hydrazoic acid (energetic azide)'],
    ['20762-60-1', 'inorganic azide'],
    ['13775-80-9', 'hydrazinium salt (reducing, energetic)'],
    ['1073-69-4', 'aryl hydrazine (reducing)'],
    ['12268-84-7', 'nitrate oxidizer (basic lead nitrate)'],
    ['14691-87-3', 'periodate oxidizer'],
]);

/** Rare-earth oxides: Section 9 solid without solubility data. */
const UNRESOLVED_OXIDE_CAS = new Set(['12037-01-3', '12738-76-0']);

/**
 * PubChem ConnectivitySMILES (accessed 2026-10-19), the same identity field
 * the app enrichment passes to analyzeChemical. Without it the replay saw a
 * carbon-plus-metal formula and withheld classification that the app makes.
 */
const CONNECTIVITY_SMILES = new Map([
    ['506-65-0', '[C-]#N.[Au+]'],
    ['143-33-9', '[C-]#N.[Na+]'],
    ['592-01-8', '[C-]#N.[C-]#N.[Ca+2]'],
    ['592-04-1', 'C(#N)[Hg]C#N'],
    ['151-50-8', '[C-]#N.[K+]'],
    ['1335-31-5', 'C(#N)[Hg]O[Hg]C#N'],
    ['15333-24-1', '[C-]#N.[C-]#N.[C-]#N.[C-]#N.[Na+].[Na+].[Zn+2]'],
    ['557-19-7', '[C-]#N.[C-]#N.[Ni+2]'],
    ['542-84-7', '[C-]#N.[C-]#N.[Co+2]'],
    ['14220-17-8', '[C-]#N.[C-]#N.[C-]#N.[C-]#N.[K+].[K+].[Ni+2]'],
    ['506-61-6', '[C-]#N.[C-]#N.[K+].[Ag+]'],
    ['14763-77-0', '[C-]#N.[C-]#N.[Cu+2]'],
    ['591-89-9', 'C(#N)[Hg-2](C#N)(C#N)C#N.[K+].[K+]'],
    ['14038-43-8', `${'[C-]#N.'.repeat(18)}[Fe+2].[Fe+2].[Fe+2].[Fe+3].[Fe+3].[Fe+3].[Fe+3]`],
    ['13967-50-5', '[C-]#N.[C-]#N.[K+].[Au+]'],
    ['13943-58-3', '[C-]#N.[C-]#N.[C-]#N.[C-]#N.[C-]#N.[C-]#N.[K+].[K+].[K+].[K+].[Fe+2]'],
    ['13746-66-2', '[C-]#N.[C-]#N.[C-]#N.[C-]#N.[C-]#N.[C-]#N.[K+].[K+].[K+].[Fe+3]'],
    ['544-92-3', '[C-]#N.[Cu+]'],
    ['592-05-2', 'C(#N)[Pb]C#N'],
    ['14481-29-9', '[C-]#N.[C-]#N.[C-]#N.[C-]#N.[C-]#N.[C-]#N.[NH4+].[NH4+].[NH4+].[NH4+].[Fe+2]'],
    ['542-83-6', '[C-]#N.[C-]#N.[Cd+2]'],
    ['14402-89-2', '[C-]#N.[C-]#N.[C-]#N.[C-]#N.[C-]#N.N#[O+].[Na+].[Na+].[Fe+2]'],
    ['1191-79-3', `${'CCCCCCCCCCCCCCCCCC(=O)[O-].'.repeat(4)}[Cd+2].[Ba+2]`],
    ['3026-22-0', 'C1=CC=C(C=C1)C(=O)[O-].C1=CC=C(C=C1)C(=O)[O-].[Cd+2]'],
    ['5743-04-4', 'CC(=O)[O-].CC(=O)[O-].O.O.[Cd+2]'],
    ['55700-14-6', 'C1CCC(CC1)CCCC(=O)[O-].C1CCC(CC1)CCCC(=O)[O-].[Cd+2]'],
    ['4167-05-9', 'CC(C)(C)C1=CC=C(C=C1)C(=O)[O-].CC(C)(C)C1=CC=C(C=C1)C(=O)[O-].[Cd+2]'],
    ['543-90-8', 'CC(=O)[O-].CC(=O)[O-].[Cd+2]'],
    ['592-02-9', 'C[CH2-].C[CH2-].[Cd+2]'],
    ['2191-10-8', 'CCCCCCCC(=O)[O-].CCCCCCCC(=O)[O-].[Cd+2]'],
    ['10468-30-1', 'CCCCCCCCC=CCCCCCCCC(=O)[O-].CCCCCCCCC=CCCCCCCCC(=O)[O-].[Cd+2]'],
    ['4464-23-7', 'C(=O)O.[Cd]'],
    ['61951-96-0', 'CC(C)(C)CC(C)(C)CC(=O)[O-].CC(C)(C)CC(C)(C)CC(=O)[O-].[Cd+2]'],
    ['2223-93-0', 'CCCCCCCCCCCCCCCCCC(=O)[O-].CCCCCCCCCCCCCCCCCC(=O)[O-].[Cd+2]'],
    ['2420-98-6', 'CCCCC(CC)C(=O)[O-].CCCCC(CC)C(=O)[O-].[Cd+2]'],
    ['93894-07-6', 'CCCCCCCCCC1=CC=CC=C1[O-].CCCCCCCCCC1=CC=CC=C1[O-].[Cd+2]'],
    ['108-07-6', 'CC(=O)O[Hg]C'],
    ['583-15-3', 'C1=CC=C(C=C1)C(=O)[O-].C1=CC=C(C=C1)C(=O)[O-].[Hg+2]'],
    ['628-86-4', 'C(#[N+][O-])[Hg]C#[N+][O-]'],
    ['102-98-7', 'B(O)(O)O[Hg]C1=CC=CC=C1'],
    ['22967-92-6', 'C[Hg+]'],
    ['27685-51-4', 'C(#N)[S-].C(#N)[S-].C(#N)[S-].C(#N)[S-].[Co+2].[Hg+2]'],
    ['15630-89-4', 'C(=O)([O-])[O-].C(=O)([O-])[O-].OO.OO.OO.[Na+].[Na+].[Na+].[Na+]'],
    ['62-74-8', 'C(C(=O)[O-])F.[Na+]'],
    ['1067-97-6', 'CCCC[Sn](CCCC)CCCC.O'],
    ['13121-70-5', 'C1CCC(CC1)[Sn+](C2CCCCC2)C3CCCCC3.[OH-]'],
    ['100-57-2', 'C1=CC=C(C=C1)[Hg].O'],
    ['54326-11-3', 'CCCCCCCCCCCCCCCCCC(=O)O[Al]OC(=O)C1=CC=CC=C1.O'],
    ['142-03-0', 'CC(=O)[O-].CC(=O)[O-].[OH-].[Al+3]'],
    ['10040-45-6', 'C1=CC=NC(=C1)C(C2=CC=C(C=C2)OS(=O)(=O)[O-])C3=CC=C(C=C3)OS(=O)(=O)[O-].[Na+].[Na+]'],
    ['142-87-0', 'CCCCCCCCCCOS(=O)(=O)[O-].[Na+]'],
    ['142-31-4', 'CCCCCCCCOS(=O)(=O)[O-].[Na+]'],
    ['546-74-7', 'CCOS(=O)(=O)[O-].[Na+]'],
    ['512-42-5', 'COS(=O)(=O)[O-].[Na+]'],
    ['1000-56-2', 'CCCOS(=O)(=O)[O-].[Na+]'],
    ['151-21-3', 'CCCCCCCCCCCCOS(=O)(=O)[O-].[Na+]'],
    ['9004-82-4', 'CCCCCCCCCCCCOCCOS(=O)(=O)[O-].[Na+]'],
    ['126-92-1', 'CCCCC(CC)COS(=O)(=O)O.[Na]'],
    ['870-72-4', 'C(O)S(=O)(=O)[O-].[Na+]'],
    ['149-44-0', 'C(O)S(=O)O.[Na]'],
    ['24887-06-7', 'C(O)S(=O)[O-].C(O)S(=O)[O-].[Zn+2]'],
]);

/** Ionic organic salts whose conservative hold came only from the missing structure. */
const STRUCTURE_RESOLVED_HOLD_CAS = new Set([
    '54326-11-3', '142-03-0', '1000-56-2', '10040-45-6', '142-87-0', '142-31-4',
    '546-74-7', '512-42-5', '9004-82-4', '126-92-1', '870-72-4', '149-44-0',
]);

const assertCount = (label, actual, expected) => {
    if (actual !== expected) throw new Error(`${label}: expected ${expected} rows, received ${actual}.`);
};

const revise = (row, next, group, reason, evidenceSections) => {
    if (JSON.stringify(row.expected) === JSON.stringify(next)) return row;
    return {
        ...row,
        expected: next,
        adjudication: {
            outcome: 'app_correct',
            reason: `AI-assisted re-review (${group}): ${reason}`,
            evidenceSections,
            assessedAt: revisedAt,
        },
        labelRevisions: [
            ...(row.labelRevisions ?? []),
            {
                previous: row.expected,
                group,
                reason,
                evidenceSections,
                reviewerId: 'ai-assisted-label-review-v1',
                reviewMethod: 'ai_assisted_evidence_review',
                humanReviewed: false,
                revisedAt,
            },
        ],
    };
};

async function main() {
    const [rows, manifest] = await Promise.all([
        readFile(datasetPath, 'utf8').then(JSON.parse),
        readFile(manifestPath, 'utf8').then(JSON.parse),
    ]);
    const counts = { fatal: 0, reactive: 0, oxide: 0, smiles: 0, structureResolved: 0 };

    const updated = rows.map((original) => {
        let row = original;
        const smiles = CONNECTIVITY_SMILES.get(row.casNumber);
        if (smiles && row.connectivitySmiles !== smiles) {
            row = { ...row, connectivitySmiles: smiles };
            counts.smiles += 1;
        }
        if (STRUCTURE_RESOLVED_HOLD_CAS.has(row.casNumber) && row.adjudication?.outcome !== 'gold_correct') {
            row = {
                ...row,
                adjudication: {
                    outcome: 'gold_correct',
                    reason: 'The hold came from the replay omitting the PubChem ConnectivitySMILES that the app enrichment supplies. With the structure the ionic salt is classified and routed by the user-confirmed matrix; no hazard rule is relaxed.',
                    evidenceSections: [3, 9],
                    assessedAt: revisedAt,
                },
            };
            counts.structureResolved += 1;
        }

        if (FATAL_TOXICITY_CAS.has(row.casNumber)) {
            const fatal = row.ghs.hCodes.filter((code) => FATAL_CODES.includes(code));
            if (fatal.length === 0) throw new Error(`${row.id}: no fatal acute-toxicity H-code in stored Section 2.`);
            counts.fatal += 1;
            return revise(
                row,
                {
                    status: 'blocked',
                    reason: `KOSHA Section 2 classifies fatal acute toxicity (${fatal.join(', ')}). Do not deposit in a common container; isolate for SPECIAL_REVIEW handover.`,
                },
                'fatal_acute_toxicity_special_review',
                `Stored KOSHA Section 2 lists ${fatal.join(', ')}. Fatal-by-inhalation/skin/ingestion materials must not be auto-routed to a common stream, so the analyzer's isolated special-review block is the safer answer.`,
                [2, 13],
            );
        }
        if (REACTIVE_IDENTITY_CAS.has(row.casNumber)) {
            const identity = REACTIVE_IDENTITY_CAS.get(row.casNumber);
            const section10 = row.sds.sections.find(({ section }) => section === 10)?.extract ?? '';
            const explosionNote = /가열시\s*용기가\s*폭발/.test(section10)
                ? ' Section 10 also records that containers may explode when heated.'
                : '';
            counts.reactive += 1;
            return revise(
                row,
                {
                    status: 'blocked',
                    reason: `Section 3 identity is a ${identity}. Keep it out of common containers and hand it over as REACTIVE_OXIDIZER waste.`,
                },
                'reactive_oxidizer_identity_block',
                `KOSHA Section 2 has no reactive H-code, but the Section 3 identity is a ${identity}.${explosionNote} Reactive/oxidizer holds are never loosened, and no user input can make this a common-container deposit, so an isolated block replaces the input-resolvable hold.`,
                [2, 3, 10],
            );
        }
        if (UNRESOLVED_OXIDE_CAS.has(row.casNumber)) {
            counts.oxide += 1;
            return revise(
                row,
                {
                    status: 'needs_input',
                    reason: 'A rare-earth oxide is not a confirmed soluble salt; confirm the waste form before routing it as aqueous waste.',
                },
                'unresolved_oxide_classification',
                'Section 9 records a solid with no solubility data, and the "peroxide" synonym is an obsolete name for a stable oxide. The analyzer deliberately leaves oxides unclassified, so the aqueous standard scenario needs user confirmation instead of automatic AQUEOUS_OTHER.',
                [3, 9, 10],
            );
        }
        return row;
    });

    assertCount('fatal acute-toxicity cohort', counts.fatal, FATAL_TOXICITY_CAS.size);
    assertCount('reactive identity cohort', counts.reactive, REACTIVE_IDENTITY_CAS.size);
    assertCount('unresolved oxide cohort', counts.oxide, UNRESOLVED_OXIDE_CAS.size);

    const serialized = `${JSON.stringify(updated, null, 2)}\n`;
    manifest.schemaVersion = '2.4.0';
    manifest.datasetSha256 = sha(serialized);
    manifest.aiAssistedReview = {
        method: 'ai_assisted_evidence_review',
        reviewerId: 'ai-assisted-label-review-v1',
        humanReviewed: false,
        assessedAt: revisedAt,
        fatalAcuteToxicityBlocks: FATAL_TOXICITY_CAS.size,
        reactiveIdentityBlocks: REACTIVE_IDENTITY_CAS.size,
        unresolvedOxideHolds: UNRESOLVED_OXIDE_CAS.size,
        structureResolvedHolds: STRUCTURE_RESOLVED_HOLD_CAS.size,
        connectivitySmilesRows: CONNECTIVITY_SMILES.size,
        reviewDocument: 'WASTE_GOLDEN_SET_V2_REVIEW.md',
    };
    await Promise.all([
        writeFile(datasetPath, serialized, 'utf8'),
        writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    ]);
    console.log(JSON.stringify(counts));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
