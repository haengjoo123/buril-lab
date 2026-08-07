import { PHREEQC_GOLDEN_RESULTS } from './fixtures/phreeqcGolden';

export type PhGoldenCoverageTag =
    | 'strong_acid'
    | 'strong_base'
    | 'neutralization'
    | 'weak_acid'
    | 'weak_buffer'
    | 'polyprotic'
    | 'amphoteric'
    | 'near_neutral'
    | 'dilution'
    | 'activity_correction';

export interface PhGoldenCaseEvidence {
    id: string;
    reference:
        | { kind: 'phreeqc_selected_output'; selectedOutputRow: number }
        | { kind: 'certified_reference'; sourceRef: string; artifactSha256: string };
    referencePh: number;
    predictorPh: number;
    recordIds: readonly string[];
    familyIds: readonly string[];
    coverageTags: readonly PhGoldenCoverageTag[];
}

export interface PhCatalogValidationEvidence {
    evidenceVersion: string;
    catalogVersion: string;
    modelVersion: string;
    predictorSourceSha256: string;
    /** SHA-256 of the complete scientific/identity payload produced by catalogApproval.ts. */
    catalogFingerprintSha256: string;
    upstreamReleaseCommit: string;
    goldenInputSha256: string;
    goldenOutputSha256: string;
    maximumGoldenErrorPh: number;
    minimumPassingGoldenCases: number;
    requiredCoverageTags: readonly PhGoldenCoverageTag[];
    cases: readonly PhGoldenCaseEvidence[];
}

type GoldenResultKey = keyof typeof PHREEQC_GOLDEN_RESULTS;

const phreeqcCase = (
    id: GoldenResultKey,
    selectedOutputRow: number,
    predictorPh: number,
    recordIds: readonly string[],
    familyIds: readonly string[],
    coverageTags: readonly PhGoldenCoverageTag[],
): PhGoldenCaseEvidence => Object.freeze({
    id,
    reference: Object.freeze({ kind: 'phreeqc_selected_output' as const, selectedOutputRow }),
    referencePh: PHREEQC_GOLDEN_RESULTS[id].pH,
    predictorPh,
    recordIds: Object.freeze(recordIds),
    familyIds: Object.freeze(familyIds),
    coverageTags: Object.freeze(coverageTags),
});

const PHREEQC_CASES: readonly PhGoldenCaseEvidence[] = Object.freeze([
    phreeqcCase('diluteHcl', 1, 3.312086280522635, ['hydrochloric-acid', 'water'], [], ['strong_acid', 'dilution', 'activity_correction']),
    phreeqcCase('acetateBuffer', 2, 4.726605043908421, ['acetic-acid', 'sodium-acetate'], ['acetate'], ['weak_buffer', 'activity_correction']),
    phreeqcCase('phosphateBuffer', 3, 7.133438395016128, ['sodium-dihydrogen-phosphate', 'disodium-hydrogen-phosphate'], ['phosphate'], ['weak_buffer', 'polyprotic', 'near_neutral']),
    phreeqcCase('sulfuricAcid', 4, 2.75222763470083, ['sulfuric-acid'], ['sulfate'], ['strong_acid', 'polyprotic']),
    phreeqcCase('sulfateAfterTwoEquivalentsNaoh', 5, 7.008689671754837, ['sulfuric-acid', 'sodium-hydroxide'], ['sulfate'], ['strong_base', 'neutralization', 'near_neutral']),
    phreeqcCase('glycine', 6, 6.0748406033962965, ['glycine'], ['glycine'], ['amphoteric', 'near_neutral']),
    phreeqcCase('diluteNaoh', 7, 10.687913719477365, ['sodium-hydroxide', 'water'], [], ['strong_base', 'dilution', 'activity_correction']),
    phreeqcCase('strongAcidBaseEquivalence', 8, 7, ['hydrochloric-acid', 'sodium-hydroxide'], [], ['neutralization', 'near_neutral']),
    phreeqcCase('hclExcessAfterNeutralization', 9, 3.01874939755362, ['hydrochloric-acid', 'sodium-hydroxide'], [], ['strong_acid', 'neutralization']),
    phreeqcCase('naohExcessAfterNeutralization', 10, 10.98125060244638, ['hydrochloric-acid', 'sodium-hydroxide'], [], ['strong_base', 'neutralization']),
    phreeqcCase('acetateAcidRichBuffer', 11, 3.8516261023978586, ['acetic-acid', 'sodium-acetate'], ['acetate'], ['weak_buffer']),
    phreeqcCase('acetateBaseRichBuffer', 12, 5.668648574719555, ['acetic-acid', 'sodium-acetate'], ['acetate'], ['weak_buffer']),
    phreeqcCase('formateBuffer', 13, 3.7453173372214223, ['formic-acid', 'sodium-formate'], ['formate'], ['weak_buffer']),
    phreeqcCase('propionateBuffer', 14, 4.843787507637899, ['propionic-acid', 'sodium-propionate'], ['propionate'], ['weak_buffer']),
    phreeqcCase('benzoateBuffer', 15, 4.238231251671095, ['benzoic-acid', 'sodium-benzoate'], ['benzoate'], ['weak_buffer']),
    phreeqcCase('phosphateFirstStepBuffer', 16, 2.6182292935382065, ['phosphoric-acid', 'sodium-dihydrogen-phosphate'], ['phosphate'], ['weak_buffer', 'polyprotic']),
    phreeqcCase('phosphateThirdStepBuffer', 17, 10.36682642150845, ['disodium-hydrogen-phosphate', 'trisodium-phosphate'], ['phosphate'], ['weak_buffer', 'polyprotic']),
    phreeqcCase('sulfateBuffer', 18, 3.3577129401965067, ['sodium-bisulfate', 'sodium-sulfate'], ['sulfate'], ['weak_buffer', 'polyprotic']),
    phreeqcCase('fluorideBuffer', 19, 3.2433494344986684, ['hydrofluoric-acid', 'sodium-fluoride'], ['fluoride'], ['weak_buffer']),
    phreeqcCase('boricAcid', 20, 6.114945657551289, ['boric-acid'], ['borate'], ['weak_acid']),
    phreeqcCase('halfNeutralizedBoricAcid', 21, 9.197833229089156, ['boric-acid', 'sodium-hydroxide'], ['borate'], ['weak_buffer', 'neutralization']),
    phreeqcCase('glycineAcidBuffer', 22, 2.742150021622365, ['glycine-hydrochloride', 'glycine'], ['glycine'], ['amphoteric', 'weak_buffer']),
    phreeqcCase('glycineBaseBuffer', 23, 9.736924331369664, ['glycine', 'sodium-glycinate'], ['glycine'], ['amphoteric', 'weak_buffer']),
    phreeqcCase('diluteNitricAcid', 24, 3.312086280522635, ['nitric-acid'], [], ['strong_acid', 'dilution']),
    phreeqcCase('phosphoricAcid', 25, 3.0629000730550615, ['phosphoric-acid'], ['phosphate'], ['weak_acid', 'polyprotic']),
    phreeqcCase('sodiumFluoride', 26, 7.188050866127014, ['sodium-fluoride'], ['fluoride'], ['weak_acid', 'near_neutral']),
    phreeqcCase('formicAcid', 27, 3.465868681028951, ['formic-acid'], ['formate'], ['weak_acid']),
    phreeqcCase('propionicAcid', 28, 3.9623967788065784, ['propionic-acid'], ['propionate'], ['weak_acid']),
    phreeqcCase('benzoicAcid', 29, 3.656215953917126, ['benzoic-acid'], ['benzoate'], ['weak_acid']),
    phreeqcCase('aceticAcid', 30, 3.907110245752847, ['acetic-acid'], ['acetate'], ['weak_acid']),
    phreeqcCase('sodiumAcetate', 31, 7.866441905498505, ['sodium-acetate'], ['acetate'], ['weak_acid']),
    phreeqcCase('sodiumPropionate', 32, 7.9244603998959064, ['sodium-propionate'], ['propionate'], ['weak_acid']),
    phreeqcCase('sodiumBenzoate', 33, 7.599642559885979, ['sodium-benzoate'], ['benzoate'], ['weak_acid']),
    phreeqcCase('sodiumFormate', 34, 7.395358562469482, ['sodium-formate'], ['formate'], ['weak_acid']),
    phreeqcCase('sodiumBisulfate', 35, 3.055482269919594, ['sodium-bisulfate'], ['sulfate'], ['polyprotic']),
    phreeqcCase('sodiumSulfate', 36, 7.015987306833267, ['sodium-sulfate'], ['sulfate'], ['polyprotic', 'near_neutral']),
    phreeqcCase('trisodiumPhosphate', 37, 10.666104672447545, ['trisodium-phosphate'], ['phosphate'], ['polyprotic']),
    phreeqcCase('glycineHydrochloride', 38, 3.09054341326555, ['glycine-hydrochloride'], ['glycine'], ['amphoteric']),
    phreeqcCase('sodiumGlycinate', 39, 10.321379764965968, ['sodium-glycinate'], ['glycine'], ['amphoteric']),
    phreeqcCase('diluteKoh', 40, 10.687913719477365, ['potassium-hydroxide', 'water'], [], ['strong_base', 'dilution']),
    phreeqcCase('sodiumChloride', 41, 7, ['sodium-chloride'], [], ['near_neutral', 'activity_correction']),
]);

const NIST_PHYSIOLOGICAL_PHOSPHATE_CASE: PhGoldenCaseEvidence = Object.freeze({
    id: 'nist-phosphate-physiological-25c',
    reference: Object.freeze({
        kind: 'certified_reference' as const,
        sourceRef: 'NIST-JRES-STANDARD-BUFFERS-1962',
        artifactSha256: 'd3f25e6eaa5a99286bd93410096189d93363c6443ba4a39a3f2f34e4cd2bbee4',
    }),
    referencePh: 7.413,
    predictorPh: 7.420878214610639,
    recordIds: Object.freeze(['potassium-dihydrogen-phosphate', 'disodium-hydrogen-phosphate']),
    familyIds: Object.freeze(['phosphate']),
    coverageTags: Object.freeze(['weak_buffer', 'polyprotic', 'activity_correction'] as const),
});

/**
 * Machine-readable release evidence. A record is eligible only when it is
 * directly named by a passing case and every acid/base family it uses passes
 * the thermodynamic-data gates. Any scientific catalog change invalidates the
 * fingerprint and requires a new fixed evidence release.
 */
export const PH_CATALOG_VALIDATION_EVIDENCE: PhCatalogValidationEvidence = Object.freeze({
    evidenceVersion: 'buril-ph-evidence-2026.08.3',
    catalogVersion: 'buril-ph-2026.08.2',
    modelVersion: 'buril-aqueous-charge-balance-davies-1.0.0',
    predictorSourceSha256: '3de6cfb6c13b03640bcf3fdecaa1291a3d6f9e764723c7ec28feb1ab84fa55fa',
    catalogFingerprintSha256: '57c27be647411f1b5a3a7c694af3ae6c94b2ca48a06a78c00ce22d7fd5791b43',
    upstreamReleaseCommit: 'cafc3530d40c7b098ebb9c32f56383ccba6a3856',
    goldenInputSha256: 'da8946eb6a0fccc7c35ad88a3bf5f3d7506cb10504ce25b5b675de1ada2a984f',
    goldenOutputSha256: '78b471c4249d36514583b48257cbe72484e880e655f91392524101ae81205cca',
    maximumGoldenErrorPh: 0.1,
    minimumPassingGoldenCases: 42,
    requiredCoverageTags: Object.freeze([
        'strong_acid',
        'strong_base',
        'weak_buffer',
        'polyprotic',
        'amphoteric',
        'near_neutral',
    ] as const),
    cases: Object.freeze([...PHREEQC_CASES, NIST_PHYSIOLOGICAL_PHOSPHATE_CASE]),
});
