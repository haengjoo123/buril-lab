/*
 * Networked, one-time curator for the V2 `common_lab_reagent` stratum.
 *
 * It never runs in CI and is guarded by the KOSHA bulk-collection freeze.
 * Rows use the existing V2 schema: KOSHA Section 2/3/9/10/13/15 short
 * extracts with SHA-256 fingerprints (no SDS/PDF/HTML copy), PubChem only for
 * the analyzer identity fields. The expected answers come from the explicit
 * lab scenario below plus the KOSHA H-codes, never from the analyzer, and are
 * recorded as AI-assisted (not human) review.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { requireKoshaBulkCollectionPermission } from './kosha-bulk-collection-guard.mjs';

// Offline mode recomputes the expected answers of already collected rows
// from their stored KOSHA evidence; only collection needs the network.
const relabelOnly = process.env.V2_COMMON_REAGENTS_RELABEL_ONLY === '1';
if (!relabelOnly) requireKoshaBulkCollectionPermission();

const directory = path.join(process.cwd(), 'data', 'waste-golden-set-v2');
const datasetPath = path.join(directory, 'materials.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const searchUrl = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do';
const detailUrl = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdsdetail.do';
const regulationUrl = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchLaw.do';
const pubchemUrl = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name';
const accessedAt = new Date().toISOString();
const STRATUM = 'common_lab_reagent';

const AQ = 'aqueous';
const ORG = 'organic_non_halogenated';
const HAL = 'organic_halogenated';
const SOLID = 'solid_slurry';

/**
 * The standard laboratory waste scenario for each reagent. `role` captures
 * identity facts the expected answer depends on: acid/base for aqueous
 * routing, `oxidizer` for oxidizing or energetic identities without an H27x
 * code, `fluoride` for HF-family container rules, `cyanide`/`sulfide` for
 * the dedicated cyanide/sulfide stream, `hydrohalide` for amine salts whose
 * only halogen is the HCl counter-ion (not an organic halogen), and `hold`
 * for identities that need user confirmation. The optional note is appended to the reason.
 */
const REAGENTS = [
    // Mineral and common organic acids
    ['7647-01-0', 'Hydrochloric acid', AQ, 'acid', 'The KOSHA record for this CAS is anhydrous hydrogen chloride gas, not the lab solution.'],
    ['7664-93-9', 'Sulfuric acid', AQ, 'acid'],
    ['7697-37-2', 'Nitric acid', AQ, 'oxidizer'],
    ['7664-38-2', 'Phosphoric acid', AQ, 'acid'],
    ['64-19-7', 'Acetic acid', AQ, 'acid'],
    ['7664-39-3', 'Hydrofluoric acid', AQ, 'fluoride'],
    ['64-18-6', 'Formic acid', AQ, 'acid'],
    ['7601-90-3', 'Perchloric acid', AQ, 'oxidizer'],
    ['76-03-9', 'Trichloroacetic acid', AQ, 'acid', 'KOSHA H314: a corrosive aqueous acid is routed by its legal acid class; declare the halogen content at handover.'],
    ['76-05-1', 'Trifluoroacetic acid', HAL, 'acid'],
    ['77-92-9', 'Citric acid', AQ, 'acid', 'KOSHA Section 2 classifies it as corrosive (H314).'],
    ['144-62-7', 'Oxalic acid', AQ],
    ['10043-35-3', 'Boric acid', AQ, 'acid'],
    // Bases
    ['1336-21-6', 'Ammonium hydroxide', AQ, 'base'],
    ['1310-66-3', 'Lithium hydroxide', AQ, 'base'],
    ['1305-62-0', 'Calcium hydroxide', AQ, 'base'],
    ['497-19-8', 'Sodium carbonate', AQ, 'base'],
    ['144-55-8', 'Sodium bicarbonate', AQ, 'base'],
    // Non-halogenated solvents and organic bases
    ['64-17-5', 'Ethanol', ORG],
    ['75-05-8', 'Acetonitrile', ORG],
    ['110-54-3', 'n-Hexane', ORG],
    ['141-78-6', 'Ethyl acetate', ORG],
    ['108-88-3', 'Toluene', ORG],
    ['1330-20-7', 'Xylene', ORG],
    ['67-68-5', 'Dimethyl sulfoxide', ORG],
    ['68-12-2', 'N,N-Dimethylformamide', ORG],
    ['109-99-9', 'Tetrahydrofuran', ORG],
    ['60-29-7', 'Diethyl ether', ORG],
    ['110-86-1', 'Pyridine', ORG],
    ['121-44-8', 'Triethylamine', ORG],
    ['71-43-2', 'Benzene', ORG],
    ['110-82-7', 'Cyclohexane', ORG],
    ['71-23-8', '1-Propanol', ORG],
    ['142-82-5', 'n-Heptane', ORG],
    ['109-66-0', 'n-Pentane', ORG],
    ['123-91-1', '1,4-Dioxane', ORG],
    ['1634-04-4', 'Methyl tert-butyl ether', ORG],
    ['872-50-4', 'N-Methyl-2-pyrrolidone', ORG],
    ['100-41-4', 'Ethylbenzene', ORG],
    ['78-93-3', 'Methyl ethyl ketone', ORG],
    ['108-10-1', 'Methyl isobutyl ketone', ORG],
    ['110-89-4', 'Piperidine', ORG],
    ['107-15-3', 'Ethylenediamine', ORG],
    ['7087-68-5', 'N,N-Diisopropylethylamine', ORG],
    ['110-18-9', 'TEMED', ORG],
    ['100-66-3', 'Anisole', ORG],
    ['107-21-1', 'Ethylene glycol', ORG],
    ['108-95-2', 'Phenol', ORG],
    ['62-53-3', 'Aniline', ORG],
    ['75-12-7', 'Formamide', ORG],
    ['108-24-7', 'Acetic anhydride', ORG],
    // Halogenated solvents
    ['75-09-2', 'Dichloromethane', HAL],
    ['67-66-3', 'Chloroform', HAL],
    ['56-23-5', 'Carbon tetrachloride', HAL],
    ['107-06-2', '1,2-Dichloroethane', HAL],
    ['108-90-7', 'Chlorobenzene', HAL],
    ['79-01-6', 'Trichloroethylene', HAL],
    ['127-18-4', 'Tetrachloroethylene', HAL],
    ['74-88-4', 'Iodomethane', HAL],
    // Fixatives and molecular-biology reagents
    ['50-00-0', 'Formaldehyde', AQ],
    ['30525-89-4', 'Paraformaldehyde', SOLID],
    ['111-30-8', 'Glutaraldehyde', AQ],
    ['1239-45-8', 'Ethidium bromide', AQ],
    ['60-24-2', '2-Mercaptoethanol', AQ],
    ['3483-12-3', 'Dithiothreitol', AQ],
    ['329-98-6', 'PMSF', ORG, 'fluoride'],
    ['593-84-0', 'Guanidine thiocyanate', AQ, 'cyanide', 'The SCN- anion releases HCN or cyanogen chloride with acids or bleach; the organic guanidinium cation does not make it an ordinary aqueous waste.'],
    ['50-01-1', 'Guanidine hydrochloride', AQ, 'hydrohalide', 'The chloride is the hydrochloride counter-ion, not an organic halogen.'],
    ['57-13-6', 'Urea', AQ],
    ['288-32-4', 'Imidazole', AQ],
    ['60-00-4', 'EDTA', AQ, 'acid', 'Free-acid EDTA is acidic in water (pH ~2.5); the acid stream is the more segregated choice. The app takes this from the EDTA free-acid CAS, not from the "아세트산" fragment of its Korean name.'],
    ['6381-92-6', 'EDTA disodium dihydrate', AQ],
    ['77-86-1', 'Tris', AQ],
    ['1185-53-1', 'Tris hydrochloride', AQ, 'hydrohalide', 'The chloride is the hydrochloride counter-ion, not an organic halogen.'],
    ['7365-45-9', 'HEPES', AQ],
    ['56-81-5', 'Glycerol', AQ],
    ['127-09-3', 'Sodium acetate', AQ],
    ['9002-93-1', 'Triton X-100', AQ],
    ['9005-64-5', 'Polysorbate 20', AQ],
    // Inorganic salts and buffers
    ['7647-14-5', 'Sodium chloride', AQ],
    ['7447-40-7', 'Potassium chloride', AQ],
    ['7786-30-3', 'Magnesium chloride', AQ],
    ['10043-52-4', 'Calcium chloride', AQ],
    ['7487-88-9', 'Magnesium sulfate', AQ],
    ['7558-79-4', 'Disodium hydrogen phosphate', AQ, 'base', 'App policy routes dibasic alkali phosphates as alkali; pH is below the legal alkali threshold (human policy question).'],
    ['7778-77-0', 'Potassium dihydrogen phosphate', AQ, 'acid', 'App policy routes monobasic phosphates as acid; pH is above the legal acid threshold (human policy question).'],
    ['12125-02-9', 'Ammonium chloride', AQ],
    ['7772-98-7', 'Sodium thiosulfate', AQ],
    ['7681-82-5', 'Sodium iodide', AQ],
    ['7681-11-0', 'Potassium iodide', AQ],
    ['7705-08-0', 'Iron(III) chloride', AQ],
    ['7553-56-2', 'Iodine', AQ, 'hold', 'Elemental iodine is not a salt and forms shock-sensitive nitrogen triiodide with ammonia; confirm the solution form before routing.'],
    ['7631-86-9', 'Silica gel', SOLID],
    // Heavy metals and oxidizers
    ['7487-94-7', 'Mercury(II) chloride', AQ],
    ['7761-88-8', 'Silver nitrate', AQ, 'oxidizer'],
    ['10099-74-8', 'Lead(II) nitrate', AQ, 'oxidizer'],
    ['7722-64-7', 'Potassium permanganate', AQ, 'oxidizer'],
    ['7778-50-9', 'Potassium dichromate', AQ, 'oxidizer'],
    ['7681-52-9', 'Sodium hypochlorite', AQ, 'oxidizer'],
    ['7632-00-0', 'Sodium nitrite', AQ, 'oxidizer'],
    ['7727-54-0', 'Ammonium persulfate', AQ, 'oxidizer'],
    ['7757-79-1', 'Potassium nitrate', AQ, 'oxidizer'],
    ['7646-85-7', 'Zinc chloride', AQ],
    ['7718-54-9', 'Nickel(II) chloride', AQ],
    ['7646-79-9', 'Cobalt(II) chloride', AQ],
    ['10361-37-2', 'Barium chloride', AQ],
    ['20816-12-0', 'Osmium tetroxide', AQ],
    // Water-reactive, pyrophoric, energetic and sulfide reagents
    ['16940-66-2', 'Sodium borohydride', SOLID, 'oxidizer'],
    ['109-72-8', 'n-Butyllithium', ORG, 'oxidizer'],
    ['7440-23-5', 'Sodium metal', SOLID, 'oxidizer'],
    ['7646-69-7', 'Sodium hydride', SOLID, 'oxidizer'],
    ['16853-85-3', 'Lithium aluminium hydride', SOLID, 'oxidizer'],
    ['88-89-1', 'Picric acid', SOLID, 'oxidizer'],
    ['1313-82-2', 'Sodium sulfide', AQ, 'sulfide'],
    ['7726-95-6', 'Bromine', AQ, 'oxidizer'],
];

const REACTIVE_H_CODES = new Set([
    'H200', 'H201', 'H202', 'H203', 'H204', 'H205', 'H206', 'H207', 'H208',
    'H240', 'H241', 'H242', 'H250', 'H251', 'H252', 'H260', 'H261',
    'H270', 'H271', 'H272',
]);
const FATAL_H_CODES = ['H300', 'H310', 'H330'];
const SECTION_10_REACTIVE_PATTERN = /(?:\b(?:self[- ]?reactive|organic peroxide|pyrophoric)\b|자기\s*반응|유기\s*과산화물|자연\s*발화)/i;
const HEAVY_METALS = ['Ag', 'Cd', 'Pb', 'Hg', 'Cr', 'As', 'Ni', 'Cu', 'Zn', 'Ba', 'Be', 'Co', 'Mn', 'Os', 'Sb', 'Tl', 'Pd', 'Pt', 'Rh', 'Ru', 'Ir', 'Au', 'Sn', 'Se', 'Mo', 'V'];

const sha = (value) => createHash('sha256').update(value).digest('hex');
const compact = (value) => value.replace(/\s+/g, ' ').trim();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hasElement = (formula, symbol) => new RegExp(`${symbol}(?![a-z])`).test(formula);
const isOrganicFormula = (formula) => /C(?![a-z])/.test(formula);
const hasOrganicHalogen = (formula) => isOrganicFormula(formula) && /(?:F|Cl|Br|I)(?![a-z])/.test(formula);

async function fetchWithRetry(url, options = {}) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
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
        await sleep(400 * (attempt + 1));
    }
    throw lastError;
}

/** Exact-CAS KOSHA lookup; the most recently revised record wins. */
async function searchKoshaByCas(casNumber) {
    const body = new URLSearchParams({
        listType: 'msds',
        pageIndex: '1',
        pageSize: '50',
        searchCondition: 'cas_no',
        searchKeyword: casNumber,
    });
    const response = await fetchWithRetry(searchUrl, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const $ = cheerio.load(await response.text());
    const found = [];
    $('table.Tbl2 tbody tr').each((_, element) => {
        const cells = $(element).find('td');
        const link = $(element).find('a[href*="getDetail"]').first();
        const chemId = /getDetail\('msds','(\d+)'\)/.exec(link.attr('href') || '')?.[1];
        const cas = compact($(cells[2]).text());
        const revisionDate = compact($(cells[cells.length - 1]).text());
        if (chemId && cas === casNumber && /^\d{4}-\d{2}-\d{2}$/.test(revisionDate)) {
            found.push({ chemId, name: compact(link.text()), revisionDate });
        }
    });
    return found.sort((a, b) => b.revisionDate.localeCompare(a.revisionDate))[0];
}

function sectionExtract(html, section) {
    const expression = new RegExp(
        `<div[^>]+id=["']Contents${section}["'][^>]*>([\\s\\S]*?)(?=<h3[^>]+id=["']Title${section + 1}["']|$)`,
        'i',
    );
    const fragment = expression.exec(html)?.[1] || '';
    return compact(cheerio.load(`<div>${fragment}</div>`).text()).slice(0, 800);
}

async function fetchKoshaDetail(chemId) {
    const response = await fetchWithRetry(detailUrl, {
        method: 'POST',
        body: new URLSearchParams({ viewType: 'msds', chem_id: chemId, listType: 'msds' }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const html = await response.text();
    const sections = [2, 3, 9, 10, 13, 15].map((section) => {
        const extract = sectionExtract(html, section);
        if (!extract) throw new Error(`KOSHA ${chemId} is missing Section ${section}.`);
        return { section, extract, sourceFingerprint: sha(extract) };
    });
    // The HTML itself is fingerprinted, never stored.
    return { htmlFingerprint: sha(html), sections };
}

async function fetchPubChem(casNumber) {
    try {
        const response = await fetchWithRetry(`${pubchemUrl}/${encodeURIComponent(casNumber)}/property/MolecularFormula,Title,ConnectivitySMILES/JSON`);
        const property = (await response.json())?.PropertyTable?.Properties?.[0];
        return {
            formula: property?.MolecularFormula || '',
            title: property?.Title || '',
            smiles: property?.ConnectivitySMILES || '',
        };
    } catch (error) {
        if (!String(error).includes('404')) throw error;
        return { formula: '', title: '', smiles: '' };
    }
}

function physicalForm(section9) {
    if (/(?:성상|형태)\s*(?:액체|liquid)/i.test(section9) || /\b(?:liquid|액체)\b/i.test(section9)) return 'liquid';
    if (/(?:성상|형태)\s*(?:고체|solid|분말|결정)/i.test(section9) || /\b(?:solid|고체|분말|powder)\b/i.test(section9)) return 'solid';
    if (/(?:성상|형태)\s*(?:기체|gas)/i.test(section9) || /\b(?:gas|기체)\b/i.test(section9)) return 'gas';
    return 'unknown';
}

const wasteScenarioFor = (matrix) => ({
    aqueous: 'aqueous_solution',
    organic_non_halogenated: 'organic_solution',
    organic_halogenated: 'organic_solution',
    solid_slurry: 'solid_residue',
}[matrix]);

function scenarioFor(matrix, form) {
    // A gas product discarded as liquid waste needs the user to confirm the
    // actual waste phase, exactly like the existing V2 state/scenario rule.
    const conflict = form === 'gas' && matrix !== SOLID ? 'gas_to_liquid_waste' : undefined;
    return {
        physicalForm: form,
        materialPhysicalForm: form,
        wasteScenario: conflict ? 'unresolved' : wasteScenarioFor(matrix),
        scenarioBasis: conflict ? 'insufficient_evidence' : 'explicit_standard_scenario',
        ...(conflict ? { stateScenarioConflict: conflict } : {}),
        matrix: conflict ? 'unknown' : matrix,
        matrixSource: conflict ? 'unresolved' : 'user',
        identityConfidence: 'verified',
        ghsDataStatus: 'verified',
        amount: { value: 100, unit: matrix === SOLID ? 'g' : 'mL' },
    };
}

/** Expected answer from the scenario and KOSHA evidence; precedence mirrors the safety policy. */
function expectedFor({ label, matrix, role, note, formula, hCodes, section10, scenario }) {
    const decision = expectedDecision({ label, matrix, role, formula, hCodes, section10, scenario });
    return note ? { ...decision, reason: `${decision.reason} ${note}` } : decision;
}

function expectedDecision({ label, matrix, role, formula, hCodes, section10, scenario }) {
    const reactiveCodes = hCodes.filter((code) => REACTIVE_H_CODES.has(code));
    if (reactiveCodes.length > 0 || SECTION_10_REACTIVE_PATTERN.test(section10)) {
        return {
            status: 'blocked',
            reason: `KOSHA Section 2 reactive/oxidizing classification (${reactiveCodes.join(', ') || 'Section 10'}) requires isolated REACTIVE_OXIDIZER handover, not a common container.`,
        };
    }
    if (role === 'oxidizer') {
        return {
            status: 'blocked',
            reason: `${label} is an oxidizing or energetic reagent; keep it out of common containers and hand it over as REACTIVE_OXIDIZER waste.`,
        };
    }
    const fatalCodes = hCodes.filter((code) => FATAL_H_CODES.includes(code));
    if (fatalCodes.length > 0) {
        return {
            status: 'blocked',
            reason: `KOSHA Section 2 classifies fatal acute toxicity (${fatalCodes.join(', ')}). Isolate for SPECIAL_REVIEW handover instead of a common container.`,
        };
    }
    if (role === 'fluoride') {
        return {
            status: 'needs_input',
            recommendedStreamCode: 'SPECIAL_REVIEW',
            reason: 'Fluoride-bearing reagent: confirm a fluoride-compatible container before handover.',
        };
    }
    if (role === 'hold') {
        return { status: 'needs_input', reason: `${label} needs identity/form confirmation before routing.` };
    }
    if (scenario.wasteScenario === 'unresolved') {
        return {
            status: 'needs_input',
            reason: 'KOSHA Section 9 describes a gas, so the liquid lab-waste scenario must be confirmed before routing.',
        };
    }
    if (role === 'sulfide') {
        return { status: 'ready', streamCode: 'CYANIDE_SULFIDE', reason: 'Inorganic sulfide solution: dedicated cyanide/sulfide stream, never with acids.' };
    }
    if (role === 'cyanide') {
        return { status: 'ready', streamCode: 'CYANIDE_SULFIDE', reason: `${label} is cyanide-family waste: dedicated cyanide/sulfide stream, never with acids or hypochlorite.` };
    }
    if (HEAVY_METALS.some((metal) => hasElement(formula, metal))) {
        return { status: 'ready', streamCode: 'HEAVY_METAL', reason: `${label} contains a regulated heavy metal; use the heavy-metal common stream.` };
    }
    if (matrix === SOLID) {
        return { status: 'ready', streamCode: 'SOLID_CONTAMINATED', reason: `Solid ${label} residue without reactive or fatal-toxicity evidence; contaminated-solid stream.` };
    }
    if (matrix === AQ && role === 'acid' && hCodes.includes('H314')) {
        return { status: 'ready', streamCode: 'ACID_AQUEOUS', reason: `Aqueous ${label} is a corrosive acid (H314); aqueous acid stream.` };
    }
    if (matrix === HAL || (role !== 'hydrohalide' && hasOrganicHalogen(formula))) {
        return { status: 'ready', streamCode: 'ORGANIC_HALOGENATED', reason: `${label} carries organic halogen; the halogenated organic stream is required.` };
    }
    if (matrix === ORG) {
        return { status: 'ready', streamCode: 'ORGANIC_NON_HALOGENATED', reason: `${label} as a neat or solvent waste; non-halogenated organic stream.` };
    }
    if (role === 'acid') {
        return { status: 'ready', streamCode: 'ACID_AQUEOUS', reason: `Aqueous ${label}; acid identity routes to the aqueous acid stream.` };
    }
    if (role === 'base') {
        return { status: 'ready', streamCode: 'ALKALI_AQUEOUS', reason: `Aqueous ${label}; alkali identity routes to the aqueous alkali stream.` };
    }
    return { status: 'ready', streamCode: 'AQUEOUS_OTHER', reason: `Aqueous ${label} without acid/alkali, metal, reactive or fatal-toxicity evidence; aqueous common stream.` };
}

async function relabelStoredRows(rows, manifest) {
    const byCas = new Map(REAGENTS.map(([casNumber, label, matrix, role, note]) => [casNumber, { label, matrix, role, note }]));
    let changed = 0;
    const updated = rows.map((row) => {
        if (row.stratum !== STRATUM) return row;
        const spec = byCas.get(row.casNumber);
        if (!spec) throw new Error(`${row.id}: not in the curated reagent list.`);
        const section10 = row.sds.sections.find(({ section }) => section === 10).extract;
        const expected = expectedFor({ ...spec, formula: row.molecularFormula, hCodes: row.ghs.hCodes, section10, scenario: row.scenario });
        if (JSON.stringify(expected) === JSON.stringify(row.expected)) return row;
        changed += 1;
        return { ...row, expected };
    });
    const serialized = `${JSON.stringify(updated, null, 2)}
`;
    manifest.datasetSha256 = sha(serialized);
    await Promise.all([
        writeFile(datasetPath, serialized, 'utf8'),
        writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}
`, 'utf8'),
    ]);
    console.log(`Recomputed ${changed} ${STRATUM} expected answers from stored evidence.`);
}

async function main() {
    const [rows, manifest] = await Promise.all([
        readFile(datasetPath, 'utf8').then(JSON.parse),
        readFile(manifestPath, 'utf8').then(JSON.parse),
    ]);
    if (relabelOnly) {
        await relabelStoredRows(rows, manifest);
        return;
    }
    const existingCas = new Set(rows.map(({ casNumber }) => casNumber));
    const kept = rows.filter(({ stratum }) => stratum !== STRATUM);
    const skipped = [];
    const added = [];

    for (const [casNumber, label, matrix, role, note] of REAGENTS) {
        if (existingCas.has(casNumber) && !rows.some((row) => row.casNumber === casNumber && row.stratum === STRATUM)) {
            skipped.push({ casNumber, label, reason: 'already in V2' });
            continue;
        }
        const candidate = await searchKoshaByCas(casNumber);
        if (!candidate) {
            skipped.push({ casNumber, label, reason: 'no KOSHA record' });
            continue;
        }
        const [detail, pubchem] = await Promise.all([fetchKoshaDetail(candidate.chemId), fetchPubChem(casNumber)]);
        await sleep(300);
        const section = (number) => detail.sections.find((item) => item.section === number).extract;
        const hCodes = [...new Set(section(2).match(/H\d{3}/g) || [])];
        const scenario = scenarioFor(matrix, physicalForm(section(9)));
        const formula = pubchem.formula;
        const isIonicSalt = pubchem.smiles.includes('.') && /\[[^\]]*[+-]\d*\]/.test(pubchem.smiles) && isOrganicFormula(formula);
        const name = !pubchem.title || candidate.name === pubchem.title ? candidate.name : `${candidate.name} (${pubchem.title})`;
        const section15 = section(15);
        added.push({
            id: '',
            casNumber,
            substanceName: name,
            molecularFormula: formula,
            ...(isIonicSalt ? { connectivitySmiles: pubchem.smiles } : {}),
            stratum: STRATUM,
            scenario,
            ghs: {
                signalWord: /신호어\s*위험/.test(section(2)) ? 'Danger' : /신호어\s*경고/.test(section(2)) ? 'Warning' : 'None',
                hCodes,
            },
            sds: {
                provider: 'KOSHA',
                sourceTier: 'domestic_kosha',
                url: detailUrl,
                accessMethod: 'POST',
                request: { viewType: 'msds', chemId: candidate.chemId, listType: 'msds' },
                revisionDate: `${candidate.revisionDate}T00:00:00.000Z`,
                accessedAt,
                extractionFingerprint: detail.htmlFingerprint,
                sections: detail.sections.map((item) => (
                    item.section === 15 ? { ...item, availability: 'available' } : item
                )),
            },
            regulations: [{
                authority: 'KOSHA',
                url: regulationUrl,
                accessedAt,
                note: 'Material-specific KOSHA SDS Section 15 regulatory-information extract; institutional container locations are intentionally excluded.',
                sourceSection: 15,
                extract: section15,
                sourceFingerprint: sha(section15),
                availability: 'available',
            }],
            expected: expectedFor({ label, matrix, role, note, formula, hCodes, section10: section(10), scenario }),
            review: {
                curatorId: 'kosha-source-curation-bot-v1',
                reviewerId: 'ai-assisted-label-review-v1',
                curationMethod: 'source_extraction',
                reviewMethod: 'independent_policy_review',
                approvedAt: accessedAt,
                status: 'approved',
            },
        });
        console.log(`  ${casNumber} ${label}: ${hCodes.join(',') || '-'} -> ${added.at(-1).expected.status} ${added.at(-1).expected.streamCode ?? ''}`);
    }

    const updated = [
        ...kept,
        ...added.map((row, index) => ({ ...row, id: `v2-${String(kept.length + index + 1).padStart(4, '0')}-${row.casNumber}` })),
    ];
    const serialized = `${JSON.stringify(updated, null, 2)}\n`;
    manifest.rowCount = updated.length;
    manifest.datasetSha256 = sha(serialized);
    manifest.strata = {
        ...manifest.strata,
        [STRATUM]: added.length,
    };
    manifest.commonLabReagentStratum = {
        method: 'kosha_cas_lookup_with_explicit_lab_scenario',
        accessedAt,
        candidates: REAGENTS.length,
        added: added.length,
        skipped,
        labelReview: 'ai_assisted_evidence_review',
        humanReviewed: false,
    };
    await Promise.all([
        writeFile(datasetPath, serialized, 'utf8'),
        writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    ]);
    console.log(`Added ${added.length} ${STRATUM} rows; skipped ${skipped.length}.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
