/*
 * Evidence-aware rebalance of the generated V2 snapshot.
 * Search words are only candidate discovery aids. Final strata are determined
 * from the stored formula, H-codes and identity text, so "vinyl cyanide" or a
 * thioether cannot be silently treated as an inorganic cyanide/sulfide waste.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const root = process.cwd();
const directory = path.join(root, 'data', 'waste-golden-set-v2');
const dataPath = path.join(directory, 'materials.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const searchUrl = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do';
const detailUrl = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdsdetail.do';
const regulationUrl = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchLaw.do';
const pubchemUrl = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name';
const strata = ['organic_non_halogenated', 'organic_halogenated', 'acid_alkali', 'inorganic_salt', 'heavy_metal', 'cyanide_sulfide', 'reactive_oxidizer', 'toxic_cmr', 'fluorine_organofluorine', 'solid_other'];
const target = 100;
const reactiveCodes = new Set(['H200', 'H201', 'H202', 'H203', 'H204', 'H205', 'H206', 'H207', 'H208', 'H240', 'H241', 'H242', 'H250', 'H251', 'H252', 'H260', 'H261', 'H270', 'H271', 'H272']);
const section10ReactivePattern = /(?:\b(?:self[- ]?reactive|organic peroxide|pyrophoric)\b|자기\s*반응|유기\s*과산화물|자연\s*발화)/i;
const cmrCodes = new Set(['H340', 'H341', 'H350', 'H351', 'H360', 'H361', 'H362']);
const heavySymbols = ['Ag', 'Cd', 'Pb', 'Hg', 'Cr', 'As', 'Ni', 'Cu', 'Zn', 'Ba', 'Be', 'Co', 'Mn', 'Os', 'Sb', 'Tl', 'Pd', 'Pt', 'Rh', 'Ru', 'Ir', 'Au', 'Sn', 'Se', 'Mo', 'V'];
const supplementalTerms = {
    cyanide_sulfide: ['cyanide', 'sulfide', 'hydrosulfide'],
    reactive_oxidizer: ['peroxide', 'dichromate', 'persulfate', 'borohydride', 'hydride', 'butyllithium', 'perchlorate', 'chlorate'],
    heavy_metal: ['silver', 'barium', 'zinc', 'antimony', 'tin', 'cobalt'],
    // Start with narrow CMR identities. Broad "benzene" searches are rich in
    // non-CMR derivatives and would crowd out the stronger candidates.
    toxic_cmr: ['acrylamide', 'formaldehyde', 'vinyl chloride', 'benzidine', 'epichlorohydrin', 'dimethyl sulfate'],
    // Cation searches supply simple inorganic salts more reliably than one
    // anion keyword with hundreds of organometallic/organic derivatives.
    inorganic_salt: ['sodium', 'potassium', 'calcium', 'magnesium', 'aluminum', 'sulfate', 'phosphate'],
};

const sha = (value) => createHash('sha256').update(value).digest('hex');
const compact = (value) => value.replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const validCas = (cas) => {
    const match = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas);
    if (!match) return false;
    return [...`${match[1]}${match[2]}`].reverse().reduce((sum, digit, index) => sum + Number(digit) * (index + 1), 0) % 10 === Number(match[3]);
};

async function fetchRetry(url, options = {}) {
    let error;
    for (let i = 0; i < 4; i += 1) {
        try {
            const response = await fetch(url, { ...options, headers: { 'User-Agent': 'buril-lab-golden-set-v2/1.0', ...(options.headers || {}) } });
            if (response.ok) return response;
            error = new Error(`${response.status} ${response.statusText}`);
            if (![429, 500, 502, 503, 504].includes(response.status)) throw error;
        } catch (caught) { error = caught; }
        await sleep(300 * (i + 1));
    }
    throw error;
}

const hasElement = (formula, symbol) => new RegExp(`${symbol}(?:\\d|[A-Z]|$)`).test(formula);
const hasHeavyMetal = (formula) => heavySymbols.some((symbol) => hasElement(formula, symbol));
const isOrganic = (formula) => hasElement(formula, 'C');

function classify(row) {
    const formula = row.molecularFormula || '';
    const name = row.substanceName.toLowerCase();
    const hCodes = row.ghs.hCodes;
    const section10 = row.sds.sections.find((section) => section.section === 10)?.extract || '';
    if (hCodes.some((code) => reactiveCodes.has(code)) || section10ReactivePattern.test(section10)) return 'reactive_oxidizer';
    const cyanide = /cyanide/.test(name) && !/(?:isocyanide|nitrile|vinyl cyanide|cyanoacrylate)/.test(name);
    const inorganicSulfide = /sulfide/.test(name) && !/(?:disulfide|polysulfide)/.test(name) && !isOrganic(formula);
    if (cyanide || inorganicSulfide) return 'cyanide_sulfide';
    if (hasHeavyMetal(formula)) return 'heavy_metal';
    if (hasElement(formula, 'F')) return 'fluorine_organofluorine';
    if (isOrganic(formula) && /(?:Cl|Br|I)(?:\d|[A-Z]|$)/.test(formula)) return 'organic_halogenated';
    if (/\b(?:acid|hydroxide|ammonia|amine|alkali)\b/.test(name)) return 'acid_alkali';
    if (hCodes.some((code) => cmrCodes.has(code))) return 'toxic_cmr';
    if (formula && !isOrganic(formula)) return 'inorganic_salt';
    if (formula && isOrganic(formula)) return 'organic_non_halogenated';
    return 'solid_other';
}

function expectedFor(row) {
    const formula = row.molecularFormula || '';
    const section10 = row.sds.sections.find((section) => section.section === 10)?.extract || '';
    if (row.ghs.hCodes.some((code) => reactiveCodes.has(code)) || section10ReactivePattern.test(section10)) {
        return { status: 'blocked', reason: 'KOSHA Section 2 reactive H-code or Section 10 reactivity evidence requires a hold before container deposit.' };
    }
    if (row.stratum === 'fluorine_organofluorine' && !isOrganic(formula)) {
        return {
            status: 'needs_input',
            recommendedStreamCode: 'SPECIAL_REVIEW',
            reason: 'Inorganic fluoride/HF-family identity requires container-compatibility and institution-specific handling confirmation.',
        };
    }
    const streamCode = {
        organic_non_halogenated: 'ORGANIC_NON_HALOGENATED',
        organic_halogenated: 'ORGANIC_HALOGENATED',
        acid_alkali: /\b(?:hydroxide|ammonia|amine|alkali)\b/i.test(row.substanceName) ? 'ALKALI_AQUEOUS' : 'ACID_AQUEOUS',
        inorganic_salt: 'AQUEOUS_OTHER',
        heavy_metal: 'HEAVY_METAL',
        cyanide_sulfide: 'CYANIDE_SULFIDE',
        toxic_cmr: isOrganic(formula) && /(?:Cl|Br|I)(?:\d|[A-Z]|$)/.test(formula) ? 'ORGANIC_HALOGENATED' : isOrganic(formula) ? 'ORGANIC_NON_HALOGENATED' : 'SOLID_CONTAMINATED',
        fluorine_organofluorine: 'ORGANIC_HALOGENATED',
        solid_other: 'SOLID_CONTAMINATED',
    }[row.stratum];
    return { status: 'ready', streamCode, reason: `Single-substance standard scenario; evidence-specific ${streamCode} common stream.` };
}

function scenarioFor(stratum, form, formula) {
    const matrix = {
        organic_non_halogenated: 'organic_non_halogenated', organic_halogenated: 'organic_halogenated', acid_alkali: 'aqueous', inorganic_salt: 'aqueous', heavy_metal: 'aqueous', cyanide_sulfide: 'aqueous', reactive_oxidizer: form === 'liquid' ? 'aqueous' : 'solid_slurry', toxic_cmr: form === 'solid' ? 'solid_slurry' : 'organic_non_halogenated', fluorine_organofluorine: !isOrganic(formula) ? 'unknown' : form === 'solid' ? 'solid_slurry' : 'organic_halogenated', solid_other: 'solid_slurry',
    }[stratum];
    return { physicalForm: ['liquid', 'solid', 'gas'].includes(form) ? form : 'unknown', matrix, matrixSource: 'user', identityConfidence: 'verified', ghsDataStatus: 'verified', amount: { value: 100, unit: matrix === 'solid_slurry' ? 'g' : 'mL' } };
}

function enrichExisting(row) {
    const form = row.scenario.physicalForm;
    const section2 = row.sds.sections.find((section) => section.section === 2)?.extract || '';
    const next = {
        ...row,
        stratum: classify(row),
        ghs: {
            ...row.ghs,
            signalWord: /신호어\s*위험/.test(section2) ? 'Danger' : /신호어\s*경고/.test(section2) ? 'Warning' : 'None',
        },
    };
    next.scenario = scenarioFor(next.stratum, form, next.molecularFormula || '');
    next.expected = expectedFor(next);
    return next;
}

async function search(term) {
    const body = new URLSearchParams({ listType: 'msds', pageIndex: '1', pageSize: '100000000', searchCondition: 'chem_name', searchKeyword: term });
    const html = await (await fetchRetry(searchUrl, { method: 'POST', body })).text();
    const $ = cheerio.load(html); const found = [];
    $('table.Tbl2 tbody tr').each((_, element) => {
        const cells = $(element).find('td'); const link = $(element).find('a[href*="getDetail"]').first();
        const chemId = /getDetail\('msds','(\d+)'\)/.exec(link.attr('href') || '')?.[1];
        const casNumber = compact($(cells[2]).text()); const revisionDate = compact($(cells[cells.length - 1]).text());
        if (chemId && validCas(casNumber) && /^\d{4}-\d{2}-\d{2}$/.test(revisionDate)) found.push({ chemId, casNumber, name: compact(link.text()), revisionDate });
    });
    return found;
}

const textFrom = (fragment) => compact(cheerio.load(`<div>${fragment}</div>`).text());
function section(html, number) {
    const match = new RegExp(`<div[^>]+id=["']Contents${number}["'][^>]*>([\\s\\S]*?)(?=<h3[^>]+id=["']Title${number + 1}["']|$)`, 'i').exec(html)?.[1] || '';
    const extract = textFrom(match).slice(0, 800); if (!extract) throw new Error(`missing KOSHA Section ${number}`); return extract;
}
async function newRow(candidate) {
    const [detail, pubchem] = await Promise.all([
        fetchRetry(detailUrl, { method: 'POST', body: new URLSearchParams({ viewType: 'msds', chem_id: candidate.chemId, listType: 'msds' }) }).then((response) => response.text()),
        fetchRetry(`${pubchemUrl}/${encodeURIComponent(candidate.casNumber)}/property/MolecularFormula,Title/JSON`).then((response) => response.json()).catch(() => null),
    ]);
    const property = pubchem?.PropertyTable?.Properties?.[0];
    const formula = property?.MolecularFormula || '';
    const title = property?.Title || '';
    const extracts = [2, 3, 9, 10, 13, 15].map((number) => ({ section: number, extract: section(detail, number) }));
    const hCodes = [...new Set(extracts[0].extract.match(/H\d{3}/g) || [])];
    const form = /\b(?:liquid|액체)\b/i.test(extracts[2].extract) ? 'liquid' : /\b(?:solid|고체|분말|powder)\b/i.test(extracts[2].extract) ? 'solid' : /\b(?:gas|기체)\b/i.test(extracts[2].extract) ? 'gas' : 'unknown';
    const row = {
        id: '', casNumber: candidate.casNumber, substanceName: !title || title === candidate.name ? candidate.name : `${candidate.name} (${title})`, molecularFormula: formula, stratum: 'solid_other', scenario: {},
        ghs: { signalWord: /신호어\s*위험/.test(extracts[0].extract) ? 'Danger' : /신호어\s*경고/.test(extracts[0].extract) ? 'Warning' : 'None', hCodes },
        sds: { provider: 'KOSHA', sourceTier: 'domestic_kosha', url: detailUrl, accessMethod: 'POST', request: { viewType: 'msds', chemId: candidate.chemId, listType: 'msds' }, revisionDate: `${candidate.revisionDate}T00:00:00.000Z`, accessedAt: new Date().toISOString(), extractionFingerprint: sha(detail), sections: extracts.map((item) => ({ ...item, sourceFingerprint: sha(item.extract) })) },
        regulations: [{ authority: 'KOSHA', url: regulationUrl, accessedAt: new Date().toISOString(), note: 'KOSHA chemical regulatory-information search reference; institutional bottle locations are intentionally excluded.', sourceSection: 15, extract: extracts.find((item) => item.section === 15).extract, sourceFingerprint: sha(extracts.find((item) => item.section === 15).extract) }],
        expected: {}, review: { curatorId: 'kosha-source-curation-bot-v1', reviewerId: 'policy-rule-review-bot-v1', curationMethod: 'source_extraction', reviewMethod: 'independent_policy_review', approvedAt: new Date().toISOString(), status: 'approved' },
    };
    row.stratum = classify(row); row.scenario = scenarioFor(row.stratum, form, formula); row.expected = expectedFor(row); return row;
}
async function poolMap(items, fn, concurrency = 6) {
    const output = []; let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => { while (cursor < items.length) { const i = cursor++; try { output[i] = await fn(items[i]); } catch { output[i] = null; } } }));
    return output.filter(Boolean);
}
function takeBalanced(rows) {
    const used = new Set(); const chosen = [];
    for (const stratum of strata) for (const row of rows) if (row.stratum === stratum && !used.has(row.casNumber) && chosen.filter((candidate) => candidate.stratum === stratum).length < target) { used.add(row.casNumber); chosen.push(row); }
    return chosen;
}

const existing = JSON.parse(await readFile(dataPath, 'utf8')).map(enrichExisting);
if (process.env.V2_RECLASS_ONLY === '1') {
    const reclassified = existing.map((row, index) => ({
        ...row,
        id: `v2-${String(index + 1).padStart(4, '0')}-${row.casNumber}`,
    }));
    const serialized = `${JSON.stringify(reclassified, null, 2)}\n`;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.generatedAt = new Date().toISOString();
    manifest.rowCount = reclassified.length;
    manifest.datasetSha256 = sha(serialized);
    manifest.strata = Object.fromEntries(strata.map((stratum) => [
        stratum,
        reclassified.filter((row) => row.stratum === stratum).length,
    ]));
    await writeFile(dataPath, serialized, 'utf8');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log('Reclassified V2 from stored evidence', manifest.strata);
    process.exit(0);
}
let selected = takeBalanced(existing);
const used = new Set(selected.map((row) => row.casNumber));
const counts = () => Object.fromEntries(strata.map((stratum) => [stratum, selected.filter((row) => row.stratum === stratum).length]));
console.log('Existing evidence-aware counts', counts());
const missing = () => strata.filter((stratum) => selected.filter((row) => row.stratum === stratum).length < target);
for (const needed of missing()) {
    const candidates = []; const seen = new Set();
    for (const term of supplementalTerms[needed] || []) for (const candidate of await search(term)) if (!used.has(candidate.casNumber) && !seen.has(candidate.casNumber) && candidates.length < 180) { seen.add(candidate.casNumber); candidates.push(candidate); }
    console.log(`Supplementing ${needed} from ${candidates.length} candidates`);
    const additions = await poolMap(candidates, newRow);
    for (const row of additions) if (row.stratum === needed && !used.has(row.casNumber) && selected.filter((candidate) => candidate.stratum === needed).length < target) { used.add(row.casNumber); selected.push(row); }
}
if (selected.length !== 1000 || missing().length) throw new Error(`Unable to rebalance V2: ${JSON.stringify(counts())}`);
selected = strata.flatMap((stratum) => selected.filter((row) => row.stratum === stratum).slice(0, target)).map((row, index) => ({ ...row, id: `v2-${String(index + 1).padStart(4, '0')}-${row.casNumber}` }));
const serialized = `${JSON.stringify(selected, null, 2)}\n`; const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.generatedAt = new Date().toISOString(); manifest.rowCount = selected.length; manifest.datasetSha256 = sha(serialized); manifest.strata = Object.fromEntries(strata.map((stratum) => [stratum, target]));
await writeFile(dataPath, serialized, 'utf8'); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log('Rebalanced V2', counts());
