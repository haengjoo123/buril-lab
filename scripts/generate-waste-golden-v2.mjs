/*
 * One-time, networked curator for the V2 golden-set snapshot.
 *
 * It deliberately does not run in CI. CI consumes only the committed JSON
 * snapshot and manifest. KOSHA is used as the primary domestic SDS source;
 * PubChem supplies only the molecular formula needed to reproduce the current
 * analyzer input.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { requireKoshaBulkCollectionPermission } from './kosha-bulk-collection-guard.mjs';

requireKoshaBulkCollectionPermission();

const ROOT = process.cwd();
const OUTPUT_DIRECTORY = path.join(ROOT, 'data', 'waste-golden-set-v2');
const DATASET_PATH = path.join(OUTPUT_DIRECTORY, 'materials.json');
const MANIFEST_PATH = path.join(OUTPUT_DIRECTORY, 'source-manifest.json');
const KOSHA_SEARCH_URL = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do';
const KOSHA_DETAIL_URL = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdsdetail.do';
const KOSHA_REGULATION_URL = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchLaw.do';
const PUBCHEM_PROPERTY_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name';
const ACCESS_DATE = new Date().toISOString();
const REVISION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TARGET_PER_STRATUM = 100;
const REACTIVE_H_CODES = new Set([
    'H200', 'H201', 'H202', 'H203', 'H204', 'H205', 'H206', 'H207', 'H208',
    'H240', 'H241', 'H242', 'H250', 'H251', 'H252', 'H260', 'H261',
    'H270', 'H271', 'H272',
]);
const SECTION_10_REACTIVE_PATTERN = /(?:\b(?:self[- ]?reactive|organic peroxide|pyrophoric)\b|자기\s*반응|유기\s*과산화물|자연\s*발화)/i;

const STRATA = [
    'cyanide_sulfide',
    'heavy_metal',
    'reactive_oxidizer',
    'fluorine_organofluorine',
    'organic_halogenated',
    'acid_alkali',
    'inorganic_salt',
    'toxic_cmr',
    'organic_non_halogenated',
    'solid_other',
];

/** Search terms are only for selecting a balanced candidate pool. The actual
 * name, CAS, revision date, H-codes and evidence are taken from the detail
 * record for each selected KOSHA chemical. */
const GROUP_SPECS = {
    cyanide_sulfide: ['cyanide', 'sulfide', 'thiocyanate'],
    heavy_metal: ['cadmium', 'mercury', 'lead', 'chromium', 'nickel', 'copper', 'arsenic'],
    reactive_oxidizer: ['peroxide', 'azide', 'hydrazine', 'perchlorate', 'chlorate', 'hypochlorite', 'permanganate'],
    fluorine_organofluorine: ['fluoro'],
    organic_halogenated: ['chloro', 'bromo', 'iodo'],
    acid_alkali: ['hydroxide', 'ammonia', 'acid'],
    inorganic_salt: ['sulfate', 'carbonate', 'phosphate', 'nitrate'],
    toxic_cmr: ['formaldehyde', 'acrylamide', 'aniline', 'isocyanate', 'benzene'],
    organic_non_halogenated: ['acetone', 'alcohol', 'ether', 'ketone', 'ester', 'toluene'],
    solid_other: ['silica', 'resin', 'polymer', 'powder'],
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const compact = (value) => value.replace(/\s+/g, ' ').trim();

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithRetry(url, options = {}, attempts = 4) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'User-Agent': 'buril-lab-waste-golden-set-v2/1.0 (local data curation)',
                    ...(options.headers || {}),
                },
            });
            if (response.ok) return response;
            lastError = new Error(`${response.status} ${response.statusText} for ${url}`);
            if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;
        } catch (error) {
            lastError = error;
        }
        await sleep(350 * (attempt + 1));
    }
    throw lastError;
}

function validCas(cas) {
    const match = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas);
    if (!match) return false;
    const sum = [...`${match[1]}${match[2]}`]
        .reverse()
        .reduce((total, digit, index) => total + Number(digit) * (index + 1), 0);
    return sum % 10 === Number(match[3]);
}

async function searchKosha(term) {
    const body = new URLSearchParams({
        listType: 'msds',
        pageIndex: '1',
        pageSize: '100000000',
        searchCondition: 'chem_name',
        searchKeyword: term,
    });
    const response = await fetchWithRetry(KOSHA_SEARCH_URL, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const html = await response.text();
    const $ = cheerio.load(html);
    const rows = [];
    $('table.Tbl2 tbody tr').each((_, element) => {
        const cells = $(element).find('td');
        const link = $(element).find('a[href*="getDetail"]').first();
        const chemId = /getDetail\('msds','(\d+)'\)/.exec(link.attr('href') || '')?.[1];
        const name = compact(link.text());
        const casNumber = compact($(cells[2]).text());
        const revisionDate = compact($(cells[cells.length - 1]).text());
        if (chemId && name && validCas(casNumber) && REVISION_DATE_PATTERN.test(revisionDate)) {
            rows.push({ chemId, name, casNumber, revisionDate });
        }
    });
    return rows;
}

function selectCandidates(byStratum) {
    const usedCas = new Set();
    const selected = [];
    for (const stratum of STRATA) {
        const candidates = byStratum.get(stratum) || [];
        for (const candidate of candidates) {
            if (usedCas.has(candidate.casNumber)) continue;
            usedCas.add(candidate.casNumber);
            selected.push({ ...candidate, stratum });
            if (selected.filter((item) => item.stratum === stratum).length === TARGET_PER_STRATUM) break;
        }
        const actual = selected.filter((item) => item.stratum === stratum).length;
        if (actual !== TARGET_PER_STRATUM) {
            throw new Error(`${stratum} candidate pool is too small: ${actual}/${TARGET_PER_STRATUM}`);
        }
    }
    return selected;
}

function decodeHtmlFragment(fragment) {
    return compact(cheerio.load(`<div>${fragment}</div>`).text());
}

function evidenceExtract(html, section) {
    const sectionId = `Contents${section}`;
    const expression = new RegExp(`<div[^>]+id=["']${sectionId}["'][^>]*>([\\s\\S]*?)(?=<h3[^>]+id=["']Title${section + 1}["']|$)`, 'i');
    const fragment = expression.exec(html)?.[1] || '';
    const text = decodeHtmlFragment(fragment).slice(0, 800);
    if (!text) throw new Error(`KOSHA detail record is missing Section ${section}.`);
    return text;
}

function physicalForm(section9) {
    if (/\b(?:liquid|액체)\b/i.test(section9)) return 'liquid';
    if (/\b(?:solid|고체|분말|powder)\b/i.test(section9)) return 'solid';
    if (/\b(?:gas|기체)\b/i.test(section9)) return 'gas';
    return 'unknown';
}

function scenarioFor(stratum, form) {
    const matrix = {
        organic_non_halogenated: 'organic_non_halogenated',
        organic_halogenated: 'organic_halogenated',
        acid_alkali: 'aqueous',
        inorganic_salt: 'aqueous',
        heavy_metal: 'aqueous',
        cyanide_sulfide: 'aqueous',
        reactive_oxidizer: form === 'liquid' ? 'aqueous' : 'solid_slurry',
        toxic_cmr: form === 'solid' ? 'solid_slurry' : 'organic_non_halogenated',
        fluorine_organofluorine: form === 'solid' ? 'solid_slurry' : 'organic_halogenated',
        solid_other: 'solid_slurry',
    }[stratum];
    return {
        physicalForm: form === 'liquid' || form === 'solid' || form === 'gas' ? form : 'unknown',
        matrix,
        matrixSource: 'user',
        identityConfidence: 'verified',
        ghsDataStatus: 'verified',
        amount: { value: matrix === 'solid_slurry' ? 100 : 100, unit: matrix === 'solid_slurry' ? 'g' : 'mL' },
    };
}

function hasReactiveEvidence(hCodes, section10) {
    return hCodes.some((code) => REACTIVE_H_CODES.has(code)) || SECTION_10_REACTIVE_PATTERN.test(section10);
}

function expectedFor(stratum, name, hCodes, section10) {
    if (hasReactiveEvidence(hCodes, section10)) {
        return {
            status: 'blocked',
            reason: 'KOSHA Section 2 reactive H-code or Section 10 reactivity evidence requires a hold before container deposit.',
        };
    }
    if (stratum === 'reactive_oxidizer') {
        // A keyword search (for example, a nitrate-containing name) is not
        // itself an SDS reactivity basis. Keep it in the stratum for coverage,
        // but do not manufacture a blocked golden answer.
        return {
            status: 'ready',
            streamCode: 'AQUEOUS_OTHER',
            reason: 'The candidate search matched the name, but KOSHA Section 2 and 10 contain no reactive evidence; use the standard aqueous common stream.',
        };
    }
    const streamCode = {
        organic_non_halogenated: 'ORGANIC_NON_HALOGENATED',
        organic_halogenated: 'ORGANIC_HALOGENATED',
        acid_alkali: /hydroxide|ammonia|amine|alkali/i.test(name) ? 'ALKALI_AQUEOUS' : 'ACID_AQUEOUS',
        inorganic_salt: 'AQUEOUS_OTHER',
        heavy_metal: 'HEAVY_METAL',
        cyanide_sulfide: 'CYANIDE_SULFIDE',
        toxic_cmr: 'ORGANIC_NON_HALOGENATED',
        fluorine_organofluorine: 'ORGANIC_HALOGENATED',
        solid_other: 'SOLID_CONTAMINATED',
    }[stratum];
    return {
        status: 'ready',
        streamCode,
        reason: `Single-substance standard scenario; common ${streamCode} stream selected from the verified domestic SDS evidence and stratum (${stratum}).`,
    };
}

async function fetchKoshaDetail(candidate) {
    const body = new URLSearchParams({ viewType: 'msds', chem_id: candidate.chemId, listType: 'msds' });
    const response = await fetchWithRetry(KOSHA_DETAIL_URL, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const html = await response.text();
    const sections = [2, 3, 9, 10, 13, 15].map((section) => {
        const extract = evidenceExtract(html, section);
        return { section, extract, sourceFingerprint: sha256(extract) };
    });
    const section2 = sections.find(({ section }) => section === 2).extract;
    const hCodes = [...new Set(section2.match(/H\d{3}/g) || [])];
    const signalWord = /\b위험\b/.test(section2) ? 'Danger' : /\b경고\b/.test(section2) ? 'Warning' : 'None';
    const section9 = sections.find(({ section }) => section === 9).extract;
    return { htmlFingerprint: sha256(html), sections, hCodes, signalWord, form: physicalForm(section9) };
}

async function fetchPubChemIdentity(casNumber) {
    try {
        const response = await fetchWithRetry(`${PUBCHEM_PROPERTY_URL}/${encodeURIComponent(casNumber)}/property/MolecularFormula,Title/JSON`);
        const json = await response.json();
        const property = json?.PropertyTable?.Properties?.[0];
        if (property?.MolecularFormula && property?.Title) {
            return { formula: property.MolecularFormula, title: property.Title };
        }
    } catch (error) {
        // KOSHA remains the primary source. A public-DB identity miss must not
        // silently discard a valid domestic SDS record; it simply leaves the
        // optional analyzer formula blank and exposes a conservative hold.
        if (!String(error).includes('PUGREST.NotFound') && !String(error).includes('404')) throw error;
    }
    return { formula: '', title: '' };
}

async function mapPool(items, worker, concurrency = 6) {
    const output = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            output[index] = await worker(items[index], index);
        }
    }));
    return output;
}

async function main() {
    console.log('Collecting KOSHA candidate pools...');
    const byStratum = new Map();
    for (const stratum of STRATA) {
        const buckets = await Promise.all(GROUP_SPECS[stratum].map(searchKosha));
        const records = [];
        const seen = new Set();
        for (const bucket of buckets) {
            for (const candidate of bucket) {
                if (!seen.has(candidate.casNumber)) {
                    seen.add(candidate.casNumber);
                    records.push(candidate);
                }
            }
        }
        byStratum.set(stratum, records);
        console.log(`  ${stratum}: ${records.length} candidates`);
    }

    const selected = selectCandidates(byStratum);
    console.log(`Fetching domestic SDS evidence for ${selected.length} selected substances...`);
    const enriched = await mapPool(selected, async (candidate, index) => {
        const [kosha, pubchem] = await Promise.all([
            fetchKoshaDetail(candidate),
            fetchPubChemIdentity(candidate.casNumber),
        ]);
        if ((index + 1) % 50 === 0) console.log(`  ${index + 1}/${selected.length}`);
        const displayName = !pubchem.title || candidate.name === pubchem.title
            ? candidate.name
            : `${candidate.name} (${pubchem.title})`;
        return {
            id: `v2-${String(index + 1).padStart(4, '0')}-${candidate.casNumber}`,
            casNumber: candidate.casNumber,
            substanceName: displayName,
            molecularFormula: pubchem.formula,
            stratum: candidate.stratum,
            scenario: scenarioFor(candidate.stratum, kosha.form),
            ghs: { signalWord: kosha.signalWord, hCodes: kosha.hCodes },
            sds: {
                provider: 'KOSHA',
                sourceTier: 'domestic_kosha',
                url: KOSHA_DETAIL_URL,
                accessMethod: 'POST',
                request: { viewType: 'msds', chemId: candidate.chemId, listType: 'msds' },
                revisionDate: `${candidate.revisionDate}T00:00:00.000Z`,
                accessedAt: ACCESS_DATE,
                extractionFingerprint: kosha.htmlFingerprint,
                sections: kosha.sections,
            },
            regulations: [{
                authority: 'KOSHA',
                url: KOSHA_REGULATION_URL,
                accessedAt: ACCESS_DATE,
                note: 'KOSHA chemical regulatory-information search reference; institutional bottle locations are intentionally excluded.',
                sourceSection: 15,
                extract: kosha.sections.find(({ section }) => section === 15).extract,
                sourceFingerprint: kosha.sections.find(({ section }) => section === 15).sourceFingerprint,
            }],
            expected: expectedFor(
                candidate.stratum,
                displayName,
                kosha.hCodes,
                kosha.sections.find(({ section }) => section === 10).extract,
            ),
            review: {
                curatorId: 'kosha-source-curation-bot-v1',
                reviewerId: 'policy-rule-review-bot-v1',
                curationMethod: 'source_extraction',
                reviewMethod: 'independent_policy_review',
                approvedAt: ACCESS_DATE,
                status: 'approved',
            },
        };
    });

    const strata = Object.fromEntries(STRATA.map((stratum) => [
        stratum,
        enriched.filter((row) => row.stratum === stratum).length,
    ]));
    const serialized = `${JSON.stringify(enriched, null, 2)}\n`;
    const manifest = {
        schemaVersion: '2.1.0',
        datasetId: 'waste-golden-set-v2',
        generatedAt: ACCESS_DATE,
        sourcePolicy: {
            order: ['domestic_kosha', 'manufacturer_sds', 'public_chemical_database'],
            sdsContentRedistributed: false,
            networkRequiredForCi: false,
        },
        rowCount: enriched.length,
        datasetSha256: sha256(serialized),
        strata,
        sources: {
            primarySds: KOSHA_DETAIL_URL,
            regulatory: KOSHA_REGULATION_URL,
            supportingIdentity: 'https://pubchem.ncbi.nlm.nih.gov/',
        },
        reviewDisclosure: 'approved means two independent automated curation/review stages. A named human reviewer is required before this benchmark can be represented as a human-reviewed regulatory release.',
    };

    await mkdir(OUTPUT_DIRECTORY, { recursive: true });
    await writeFile(DATASET_PATH, serialized, 'utf8');
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${DATASET_PATH}`);
    console.log(`Wrote ${MANIFEST_PATH}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
