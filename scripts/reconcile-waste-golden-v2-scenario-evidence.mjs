/*
 * Separates product state (SDS Section 9) from the waste-phase scenario.
 *
 * A product that is a compressed gas is not automatically an organic-liquid
 * waste, and a liquid product is not automatically a solid residue.  Where
 * the stored V2 record has no capture, absorption, dilution, or solidification
 * evidence, the safe golden outcome is `needs_input`, not an invented stream.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.join(process.cwd(), 'data', 'waste-golden-set-v2');
const dataPath = path.join(directory, 'materials.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const assessedAt = '2026-08-08T00:00:00.000Z';
const sha = (value) => createHash('sha256').update(value).digest('hex');

const GAS_H_CODES = new Set(['H220', 'H221', 'H280', 'H281']);
const METAL_FORMULA_PATTERN = /(?:Ag|Al|As|Au|Ba|Be|Bi|Cd|Co|Cr|Cu|Fe|Ga|Hg|In|Li|Mn|Mo|Na|Ni|Pb|Pt|Sb|Sn|Ti|Tl|V|Zn|Zr)/;
const STATE_CONFLICT_REASON_PREFIX = 'SDS Section 9 product-state evidence conflicts with the prior standard waste scenario.';

const sectionText = (row, section) => (
    row.sds.sections.find((candidate) => candidate.section === section)?.extract ?? ''
);

/** Reads only the Section 9 `state` value; it never scans flammability or vapour-density fields. */
const section9PhysicalForm = (row) => {
    const text = sectionText(row, 9);
    const state = /\uc131\uc0c1\s*([\s\S]*?)(?=\s*\uc0c9\uc0c1)/.exec(text)?.[1] ?? '';
    if (/(?:\uace0\uccb4|\ubd84\ub9d0|\uacb0\uc815|solid|powder|crystal)/i.test(state)) return 'solid';
    if (/(?:\uae30\uccb4|\uac00\uc2a4|\bgas\b)/i.test(state)) return 'gas';
    if (/(?:\uc561\uccb4|\uc624\uc77c|liquid|oily)/i.test(state)) return 'liquid';
    return 'unknown';
};

const hasCompressedGasEvidence = (row) => row.ghs.hCodes.some((code) => GAS_H_CODES.has(code));

const materialPhysicalForm = (row) => {
    const section9Form = section9PhysicalForm(row);
    if (hasCompressedGasEvidence(row)) return 'gas';
    // A lone `gas` word for a metal salt is internally inconsistent source
    // metadata. Preserve the SDS extract, but do not manufacture a gas label.
    if (section9Form === 'gas' && METAL_FORMULA_PATTERN.test(row.molecularFormula)) return 'unknown';
    return section9Form;
};

const wasteScenarioForMatrix = (matrix) => ({
    aqueous: 'aqueous_solution',
    organic_non_halogenated: 'organic_solution',
    organic_halogenated: 'organic_solution',
    mixed_biphasic: 'organic_solution',
    solid_slurry: 'solid_residue',
    unknown: 'unresolved',
}[matrix]);

const isExistingConflict = (row, type) => row.scenario.stateScenarioConflict === type;

const gasToLiquidWasteConflict = (row) => {
    const form = materialPhysicalForm(row);
    const liquidWasteMatrix = [
        'aqueous',
        'organic_non_halogenated',
        'organic_halogenated',
        'mixed_biphasic',
    ].includes(row.scenario.matrix);
    return isExistingConflict(row, 'gas_to_liquid_waste') || (form === 'gas' && liquidWasteMatrix);
};

const liquidToSolidResidueConflict = (row) => (
    isExistingConflict(row, 'liquid_to_solid_residue') || (
        materialPhysicalForm(row) === 'liquid' && row.scenario.matrix === 'solid_slurry'
    )
);

const holdForStateConflict = (row, type, form) => ({
    ...row,
    scenario: {
        ...row.scenario,
        physicalForm: form,
        materialPhysicalForm: form,
        wasteScenario: 'unresolved',
        scenarioBasis: 'insufficient_evidence',
        stateScenarioConflict: type,
        matrix: 'unknown',
        matrixSource: 'unresolved',
        amount: { value: 100, unit: 'mL' },
    },
    expected: {
        status: 'needs_input',
        reason: type === 'gas_to_liquid_waste'
            ? `${STATE_CONFLICT_REASON_PREFIX} The product is a gas or compressed gas, but no absorption, capture, or liquid-waste composition is evidenced; confirm the actual waste phase before routing.`
            : `${STATE_CONFLICT_REASON_PREFIX} The product is a liquid, but no absorption, curing, or solid-residue evidence is stored; confirm the actual waste phase before routing.`,
    },
    adjudication: {
        outcome: 'insufficient_evidence',
        reason: type === 'gas_to_liquid_waste'
            ? 'Section 9 or compressed-gas GHS evidence establishes gas handling, while the stored record contains no evidence for a liquid waste phase.'
            : 'Section 9 establishes a liquid product, while the stored record contains no evidence for a solid waste residue.',
        evidenceSections: [2, 9, 13, 15],
        assessedAt,
    },
});

const rows = JSON.parse(await readFile(dataPath, 'utf8'));
const gasConflicts = rows.filter(gasToLiquidWasteConflict);
const liquidSolidConflicts = rows.filter(liquidToSolidResidueConflict);
const conflictCas = new Set([...gasConflicts, ...liquidSolidConflicts].map((row) => row.casNumber));

if (gasConflicts.length !== 29 || liquidSolidConflicts.length !== 49 || conflictCas.size !== 78) {
    throw new Error(
        `Expected 29 gas-to-liquid and 49 liquid-to-solid conflicts (78 unique); found ${gasConflicts.length}, ${liquidSolidConflicts.length}, ${conflictCas.size}.`,
    );
}

const reconciled = rows.map((row) => {
    const form = materialPhysicalForm(row);
    if (gasToLiquidWasteConflict(row)) return holdForStateConflict(row, 'gas_to_liquid_waste', 'gas');
    if (liquidToSolidResidueConflict(row)) return holdForStateConflict(row, 'liquid_to_solid_residue', 'liquid');

    const wasteScenario = wasteScenarioForMatrix(row.scenario.matrix);
    return {
        ...row,
        scenario: {
            ...row.scenario,
            physicalForm: form,
            materialPhysicalForm: form,
            wasteScenario,
            scenarioBasis: wasteScenario === 'unresolved'
                ? 'insufficient_evidence'
                : 'explicit_standard_scenario',
            ...(row.scenario.stateScenarioConflict ? { stateScenarioConflict: row.scenario.stateScenarioConflict } : {}),
            matrixSource: wasteScenario === 'unresolved' ? 'unresolved' : 'user',
        },
    };
});

const serialized = `${JSON.stringify(reconciled, null, 2)}\n`;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.schemaVersion = '2.2.0';
manifest.datasetSha256 = sha(serialized);
manifest.generatedAt = new Date().toISOString();
manifest.scenarioEvidenceReconciliation = {
    method: 'section_9_physical_state_and_ghs_compressed_gas_audit',
    assessedAt,
    reviewedCases: 78,
    gasWastePhaseConflicts: 29,
    liquidSolidConflicts: 49,
};

await writeFile(dataPath, serialized, 'utf8');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log('Reconciled 78 Section 9 product-state/scenario conflicts (29 gas-to-liquid, 49 liquid-to-solid).');
