/*
 * Networked maintenance task for the committed V2 snapshot. It adds the
 * material-specific KOSHA Section 15 extract and its regulation reference
 * without copying an SDS/PDF into the repository. It never runs in CI.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { requireKoshaBulkCollectionPermission } from './kosha-bulk-collection-guard.mjs';

requireKoshaBulkCollectionPermission();

const root = process.cwd();
const directory = path.join(root, 'data', 'waste-golden-set-v2');
const datasetPath = path.join(directory, 'materials.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const regulationUrl = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchLaw.do';
const reactiveHCodes = new Set([
    'H200', 'H201', 'H202', 'H203', 'H204', 'H205', 'H206', 'H207', 'H208',
    'H240', 'H241', 'H242', 'H250', 'H251', 'H252', 'H260', 'H261',
    'H270', 'H271', 'H272',
]);
// Section 10 often contains CAMEO boilerplate such as "some react with water",
// vessel explosions on heating, or generic polymerization/fire warnings. Those
// statements are not material-specific enough to create a blocked label. Only
// direct self-reactive, organic-peroxide, or pyrophoric wording is accepted.
const section10ReactivePattern = /(?:\b(?:self[- ]?reactive|organic peroxide|pyrophoric)\b|자기\s*반응|유기\s*과산화물|자연\s*발화)/i;

// These are the 20 prior acid-keyword false positives found in the original
// baseline. Their stored SDS evidence does not establish an aqueous acid waste
// scenario, so they must remain withheld rather than receive ACID_AQUEOUS.
const acidHoldCas = new Set([
    '102184-95-2', '16923-64-1', '16924-28-0', '7790-92-3', '26935-10-4',
    '36290-04-7', '9041-04-7', '68585-21-7', '57950-83-1', '90218-44-3',
    '9003-06-9', '22708-90-3', '10101-52-7', '15292-27-0', '14284-24-3',
    '10006-28-7', '12068-40-5', '1327-44-2', '12736-96-8', '15859-24-2',
]);
// These need a compatible fluoride container before the common stream can be
// selected. Their heavy-metal/toxicity evidence is retained separately.
const fluorideHoldCas = new Set(['7790-79-6', '68784-55-4', '7783-39-3', '13867-72-6']);

const sha = (value) => createHash('sha256').update(value).digest('hex');
const compact = (value) => value.replace(/\s+/g, ' ').trim();
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithRetry(url, options) {
    let error;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'buril-lab-golden-set-v2/2.1 (local evidence refresh)',
                    ...(options.headers || {}),
                },
            });
            if (response.ok) return response;
            error = new Error(`${response.status} ${response.statusText}`);
            if (![429, 500, 502, 503, 504].includes(response.status)) throw error;
        } catch (caught) {
            error = caught;
        }
        await delay(350 * (attempt + 1));
    }
    throw error;
}

function sectionExtract(html, section) {
    const expression = new RegExp(
        `<div[^>]+id=["']Contents${section}["'][^>]*>([\\s\\S]*?)(?=<h3[^>]+id=["']Title${section + 1}["']|$)`,
        'i',
    );
    const fragment = expression.exec(html)?.[1] || '';
    const extract = compact(cheerio.load(`<div>${fragment}</div>`).text()).slice(0, 800);
    return extract;
}

const hasReactiveEvidence = (row) => {
    const section10 = row.sds.sections.find((section) => section.section === 10)?.extract || '';
    return row.ghs.hCodes.some((code) => reactiveHCodes.has(code)) || section10ReactivePattern.test(section10);
};

function correctExpectedLabel(row) {
    if (acidHoldCas.has(row.casNumber)) {
        row.scenario = {
            ...row.scenario,
            // The SDS identifies an acid-related name, but it does not prove
            // that this disposal material is an aqueous acid solution.
            matrix: 'unknown',
            matrixSource: 'unresolved',
        };
        row.expected = {
            status: 'needs_input',
            reason: 'The stored SDS does not establish an aqueous acid disposal scenario; retain for material-form and disposal-criteria confirmation.',
        };
        return;
    }
    if (fluorideHoldCas.has(row.casNumber)) {
        row.expected = {
            status: 'needs_input',
            reason: 'Fluoride-bearing material requires compatible-container confirmation before a common waste stream can be selected.',
        };
        return;
    }
    if (hasReactiveEvidence(row)) {
        row.expected = {
            status: 'blocked',
            reason: 'KOSHA Section 2 reactive H-code or Section 10 reactivity evidence requires a hold before container deposit.',
        };
        return;
    }
    const formula = row.molecularFormula || '';
    const isOrganic = /C(?:\d|[A-Z]|$)/.test(formula);
    const isHalogenatedOrganic = isOrganic && /(?:Cl|Br|I)(?:\d|[A-Z]|$)/.test(formula);
    if (row.stratum === 'fluorine_organofluorine' && !isOrganic) {
        row.expected = {
            status: 'needs_input',
            recommendedStreamCode: 'SPECIAL_REVIEW',
            reason: 'Inorganic fluoride/HF-family identity requires container-compatibility and institution-specific handling confirmation.',
        };
        return;
    }
    const streamCode = {
        organic_non_halogenated: 'ORGANIC_NON_HALOGENATED',
        organic_halogenated: 'ORGANIC_HALOGENATED',
        acid_alkali: /\b(?:hydroxide|ammonia|amine|alkali)\b/i.test(row.substanceName) ? 'ALKALI_AQUEOUS' : 'ACID_AQUEOUS',
        inorganic_salt: 'AQUEOUS_OTHER',
        heavy_metal: 'HEAVY_METAL',
        cyanide_sulfide: 'CYANIDE_SULFIDE',
        reactive_oxidizer: 'AQUEOUS_OTHER',
        toxic_cmr: isHalogenatedOrganic ? 'ORGANIC_HALOGENATED' : isOrganic ? 'ORGANIC_NON_HALOGENATED' : 'SOLID_CONTAMINATED',
        fluorine_organofluorine: 'ORGANIC_HALOGENATED',
        solid_other: 'SOLID_CONTAMINATED',
    }[row.stratum];
    row.expected = {
        status: 'ready',
        streamCode,
        reason: row.stratum === 'reactive_oxidizer'
            ? 'The candidate search matched a reactive term, but KOSHA Section 2 and 10 contain no reactive evidence; use the standard aqueous common stream.'
            : `Single-substance standard scenario; evidence-specific ${streamCode} common stream.`,
    };
}

async function mapPool(items, worker, concurrency = 4) {
    const results = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
        }
    }));
    return results;
}

async function main() {
    const rows = JSON.parse(await readFile(datasetPath, 'utf8'));
    const accessedAt = new Date().toISOString();
    const start = Math.max(0, Number.parseInt(process.env.V2_EVIDENCE_START || '0', 10) || 0);
    const batchSize = Math.max(1, Number.parseInt(process.env.V2_EVIDENCE_BATCH_SIZE || `${rows.length}`, 10) || rows.length);
    const end = Math.min(rows.length, start + batchSize);
    const targetRows = rows.slice(start, end);
    if (targetRows.length === 0) throw new Error(`No rows in requested evidence range ${start}:${end}.`);
    console.log(`Refreshing KOSHA Section 15 evidence for records ${start + 1}-${end}/${rows.length}...`);

    const replacements = await mapPool(targetRows, async (row, index) => {
        const response = await fetchWithRetry(row.sds.url, {
            method: 'POST',
            body: new URLSearchParams({
                viewType: row.sds.request.viewType,
                chem_id: row.sds.request.chemId,
                listType: row.sds.request.listType,
            }),
        });
        const html = await response.text();
        const extractedSection15 = sectionExtract(html, 15);
        const availability = extractedSection15 ? 'available' : 'not_available';
        const extract = extractedSection15 || 'KOSHA SDS detail did not provide a Section 15 body on the recorded access date; regulatory handling remains insufficiently evidenced.';
        const section15 = {
            section: 15,
            extract,
            sourceFingerprint: availability === 'available' ? sha(extract) : sha(html),
            availability,
        };
        const existing = row.sds.sections.filter((section) => section.section !== 15);
        const next = {
            ...row,
            sds: {
                ...row.sds,
                accessedAt,
                extractionFingerprint: sha(html),
                sections: [...existing, section15].sort((left, right) => left.section - right.section),
            },
            regulations: [{
                authority: 'KOSHA',
                url: regulationUrl,
                accessedAt,
                note: availability === 'available'
                    ? 'Material-specific KOSHA SDS Section 15 regulatory-information extract; institutional container locations are intentionally excluded.'
                    : 'KOSHA detail returned no Section 15 body; do not infer regulatory handling from this record.',
                sourceSection: 15,
                extract,
                sourceFingerprint: section15.sourceFingerprint,
                availability,
            }],
        };
        correctExpectedLabel(next);
        if ((index + 1) % 20 === 0) console.log(`  ${index + 1}/${targetRows.length}`);
        return next;
    });
    const refreshed = rows.map((row, index) => replacements[index - start] ?? row);
    // Label corrections do not depend on a network response and should remain
    // idempotent when this refresh is resumed in short batches.
    refreshed.forEach(correctExpectedLabel);

    const acidCorrections = refreshed.filter((row) => acidHoldCas.has(row.casNumber)).length;
    const fluorideCorrections = refreshed.filter((row) => fluorideHoldCas.has(row.casNumber)).length;
    if (acidCorrections !== 20 || fluorideCorrections !== 4) {
        throw new Error(`Expected 20 acid and 4 fluoride corrections; found ${acidCorrections} and ${fluorideCorrections}.`);
    }

    const serialized = `${JSON.stringify(refreshed, null, 2)}\n`;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.schemaVersion = '2.1.0';
    manifest.generatedAt = accessedAt;
    manifest.rowCount = refreshed.length;
    manifest.datasetSha256 = sha(serialized);
    manifest.evidenceRefresh = {
        accessedAt,
        requiredSections: [2, 3, 9, 10, 13, 15],
        acidHoldCorrections: acidCorrections,
        fluorideHoldCorrections: fluorideCorrections,
        reactiveEvidenceRule: 'Section 2 reactive H-code or Section 10 reactive evidence only',
    };
    await writeFile(datasetPath, serialized, 'utf8');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`Stored Section 15 evidence for ${targetRows.length} records; corrected ${acidCorrections} acid and ${fluorideCorrections} fluoride labels.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
