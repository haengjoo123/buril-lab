import type { WasteMatrix, WasteStreamCode } from '../../types';

/**
 * V2 is intentionally a data contract, rather than a second routing engine.
 * It records the evidence needed to audit a single-substance golden case and
 * lets the regression runner turn that record into the existing batch input.
 */
export const GOLDEN_SET_V2_VERSION = '2.3.0' as const;

export const GOLDEN_DECISION_STATUSES = [
    'ready',
    'needs_input',
    'blocked',
] as const;

export type GoldenDecisionStatus = typeof GOLDEN_DECISION_STATUSES[number];

export const GOLDEN_STRATA = [
    'organic_non_halogenated',
    'organic_halogenated',
    'acid_alkali',
    'inorganic_salt',
    'heavy_metal',
    'cyanide_sulfide',
    'reactive_oxidizer',
    'toxic_cmr',
    'fluorine_organofluorine',
    'solid_other',
] as const;

export type GoldenStratum = typeof GOLDEN_STRATA[number];

export type GoldenEvidenceSectionNumber = 2 | 3 | 9 | 10 | 13 | 15;

export interface GoldenEvidenceSection {
    section: GoldenEvidenceSectionNumber;
    /** A short, normalized extract; never an SDS/PDF copy. */
    extract: string;
    sourceFingerprint: string;
    /** KOSHA occasionally returns no Section 15 body; this is recorded, never inferred. */
    availability?: 'available' | 'not_available';
}

export interface GoldenSdsReference {
    provider: 'KOSHA';
    sourceTier: 'domestic_kosha';
    /** POST endpoint, kept as a URL instead of redistributing the source. */
    url: string;
    accessMethod: 'POST';
    request: {
        viewType: 'msds';
        chemId: string;
        listType: 'msds';
    };
    revisionDate: string;
    accessedAt: string;
    extractionFingerprint: string;
    sections: GoldenEvidenceSection[];
}

export interface GoldenRegulatoryReference {
    authority: 'KOSHA';
    url: string;
    accessedAt: string;
    note: string;
    /** KOSHA SDS Section 15 is the stored, material-specific regulation evidence. */
    sourceSection: 15;
    extract: string;
    sourceFingerprint: string;
    availability?: 'available' | 'not_available';
}

export const GOLDEN_ADJUDICATION_OUTCOMES = [
    'app_correct',
    'gold_correct',
    'policy_decision',
    'insufficient_evidence',
] as const;

export type GoldenAdjudicationOutcome = typeof GOLDEN_ADJUDICATION_OUTCOMES[number];

/**
 * Physical state of the supplied product, extracted from SDS Section 9 (or
 * left unknown when the stored source does not establish it).  This is not
 * the same thing as the phase of the waste that a user is about to discard.
 */
export const GOLDEN_MATERIAL_PHYSICAL_FORMS = [
    'solid',
    'liquid',
    'gas',
    'unknown',
] as const;

export type GoldenMaterialPhysicalForm = typeof GOLDEN_MATERIAL_PHYSICAL_FORMS[number];

/** The evidenced physical scenario of the waste, independent of product state. */
export const GOLDEN_WASTE_SCENARIOS = [
    'neat_material',
    'aqueous_solution',
    'organic_solution',
    'solid_residue',
    'unresolved',
] as const;

export type GoldenWasteScenario = typeof GOLDEN_WASTE_SCENARIOS[number];

/** Why the waste-phase scenario is present in the golden record. */
export const GOLDEN_SCENARIO_BASES = [
    'sds_section_9',
    'explicit_standard_scenario',
    'insufficient_evidence',
] as const;

export type GoldenScenarioBasis = typeof GOLDEN_SCENARIO_BASES[number];

/** Stored only when product-state evidence disproves the former baseline scenario. */
export type GoldenStateScenarioConflict =
    | 'gas_to_liquid_waste'
    | 'liquid_to_solid_residue';

/**
 * Automated, evidence-linked assessment of a non-strict regression result.
 * It is deliberately not a substitute for a human legal determination.
 */
export interface GoldenAdjudication {
    outcome: GoldenAdjudicationOutcome;
    reason: string;
    evidenceSections: GoldenEvidenceSectionNumber[];
    assessedAt: string;
}

export interface GoldenScenario {
    /** @deprecated Use materialPhysicalForm; kept for existing V2 readers. */
    physicalForm: 'liquid' | 'solid' | 'gas' | 'solution' | 'unknown';
    materialPhysicalForm: GoldenMaterialPhysicalForm;
    wasteScenario: GoldenWasteScenario;
    scenarioBasis: GoldenScenarioBasis;
    stateScenarioConflict?: GoldenStateScenarioConflict;
    matrix: WasteMatrix;
    matrixSource: 'user' | 'unresolved';
    /** Inputs that the user has actually confirmed for this standard scenario. */
    identityConfidence: 'verified';
    ghsDataStatus: 'verified';
    amount: {
        value: number;
        unit: 'mL' | 'g';
    };
}

export interface GoldenDecision {
    status: GoldenDecisionStatus;
    /** Required only when the standard scenario is ready for container deposit. */
    streamCode?: WasteStreamCode;
    /**
     * A non-authorizing route recommendation.  `needs_input` may point to
     * SPECIAL_REVIEW while still requiring user evidence before handover.
     */
    recommendedStreamCode?: WasteStreamCode;
    reason: string;
}

export interface GoldenReview {
    curatorId: string;
    reviewerId: string;
    curationMethod: 'source_extraction';
    reviewMethod: 'independent_policy_review';
    approvedAt: string;
    status: 'approved';
    disagreement?: {
        reason: string;
        resolvedAt: string;
    };
}

export interface WasteGoldenSetV2Row {
    id: string;
    casNumber: string;
    substanceName: string;
    /** Supporting public-DB identity field; the domestic SDS remains the primary source. */
    molecularFormula: string;
    stratum: GoldenStratum;
    scenario: GoldenScenario;
    ghs: {
        signalWord: 'Danger' | 'Warning' | 'None' | 'Unknown';
        hCodes: string[];
    };
    sds: GoldenSdsReference;
    regulations: GoldenRegulatoryReference[];
    expected: GoldenDecision;
    /** Present when the stored baseline exposed a non-strict app/golden result. */
    adjudication?: GoldenAdjudication;
    review: GoldenReview;
}

export interface WasteGoldenSetV2Manifest {
    schemaVersion: typeof GOLDEN_SET_V2_VERSION;
    datasetId: 'waste-golden-set-v2';
    generatedAt: string;
    sourcePolicy: {
        order: readonly ['domestic_kosha', 'manufacturer_sds', 'public_chemical_database'];
        sdsContentRedistributed: false;
        networkRequiredForCi: false;
    };
    rowCount: number;
    datasetSha256: string;
    strata: Record<GoldenStratum, number>;
    scenarioEvidenceReconciliation?: {
        method: 'section_9_physical_state_and_ghs_compressed_gas_audit';
        assessedAt: string;
        reviewedCases: number;
        gasWastePhaseConflicts: number;
        liquidSolidConflicts: number;
    };
    baselineCorrection?: {
        method: 'approved_first_pass_adjudication';
        assessedAt: string;
        appCorrect: number;
        insufficientEvidence: number;
        directReactiveEvidence: number;
        reactiveUncertainty: number;
        reactiveNameFalsePositives: number;
        specialReviewRecommendationMigrations: number;
    };
}

export const isValidCasNumber = (cas: string): boolean => {
    const match = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas);
    if (!match) return false;
    const digits = `${match[1]}${match[2]}`;
    const expected = Number(match[3]);
    const total = [...digits]
        .reverse()
        .reduce((sum, digit, index) => sum + Number(digit) * (index + 1), 0);
    return total % 10 === expected;
};

const isIsoDate = (value: string): boolean => !Number.isNaN(Date.parse(value));

const isStreamExpected = (decision: GoldenDecision): boolean => {
    if (decision.status === 'ready') {
        return Boolean(decision.streamCode) && !decision.recommendedStreamCode;
    }
    if (decision.status === 'needs_input') {
        return !decision.streamCode;
    }
    return !decision.streamCode && !decision.recommendedStreamCode;
};

export const validateWasteGoldenSetV2 = (
    rows: readonly WasteGoldenSetV2Row[],
    manifest?: WasteGoldenSetV2Manifest,
): string[] => {
    const problems: string[] = [];
    const seenCas = new Set<string>();

    rows.forEach((row, index) => {
        const prefix = `row ${index + 1} (${row.id || row.casNumber || 'unknown'})`;
        if (!row.id || !row.substanceName) {
            problems.push(`${prefix}: id and substanceName are required.`);
        }
        if (!isValidCasNumber(row.casNumber)) problems.push(`${prefix}: invalid CAS check digit.`);
        if (seenCas.has(row.casNumber)) problems.push(`${prefix}: duplicate CAS ${row.casNumber}.`);
        seenCas.add(row.casNumber);
        if (!GOLDEN_STRATA.includes(row.stratum)) problems.push(`${prefix}: invalid stratum.`);
        if (!GOLDEN_DECISION_STATUSES.includes(row.expected.status)) problems.push(`${prefix}: invalid decision status.`);
        if (!isStreamExpected(row.expected)) problems.push(`${prefix}: ready stream and non-authorizing recommendation are inconsistent with status.`);
        if (!row.expected.reason.trim()) problems.push(`${prefix}: expected.reason is required.`);

        if (!GOLDEN_MATERIAL_PHYSICAL_FORMS.includes(row.scenario.materialPhysicalForm)) {
            problems.push(`${prefix}: invalid material physical form.`);
        }
        if (!GOLDEN_WASTE_SCENARIOS.includes(row.scenario.wasteScenario)) {
            problems.push(`${prefix}: invalid waste scenario.`);
        }
        if (!GOLDEN_SCENARIO_BASES.includes(row.scenario.scenarioBasis)) {
            problems.push(`${prefix}: invalid scenario basis.`);
        }
        if (row.scenario.physicalForm !== row.scenario.materialPhysicalForm) {
            problems.push(`${prefix}: legacy and material physical forms must agree.`);
        }
        const expectedMatrixByWasteScenario: Partial<Record<GoldenWasteScenario, WasteMatrix>> = {
            aqueous_solution: 'aqueous',
            organic_solution: undefined,
            solid_residue: 'solid_slurry',
            unresolved: 'unknown',
        };
        const expectedMatrix = expectedMatrixByWasteScenario[row.scenario.wasteScenario];
        if (expectedMatrix && row.scenario.matrix !== expectedMatrix) {
            problems.push(`${prefix}: matrix conflicts with waste scenario.`);
        }
        if (row.scenario.wasteScenario === 'organic_solution' && ![
            'organic_non_halogenated',
            'organic_halogenated',
            'mixed_biphasic',
        ].includes(row.scenario.matrix)) {
            problems.push(`${prefix}: organic waste scenario requires an organic matrix.`);
        }
        if (row.scenario.wasteScenario === 'unresolved' && (
            row.scenario.matrixSource !== 'unresolved' ||
            row.scenario.scenarioBasis !== 'insufficient_evidence' ||
            row.expected.status === 'ready'
        )) {
            problems.push(`${prefix}: unresolved scenario must withhold automatic ready.`);
        }
        if (row.scenario.wasteScenario !== 'unresolved' && row.scenario.matrixSource !== 'user') {
            problems.push(`${prefix}: resolved scenario requires explicit user matrix confirmation.`);
        }
        if (row.scenario.scenarioBasis === 'insufficient_evidence' && row.scenario.wasteScenario !== 'unresolved') {
            problems.push(`${prefix}: insufficient scenario evidence must remain unresolved.`);
        }
        if (row.scenario.stateScenarioConflict && row.scenario.wasteScenario !== 'unresolved') {
            problems.push(`${prefix}: a state/scenario conflict must remain unresolved.`);
        }

        if (row.sds.provider !== 'KOSHA' || row.sds.sourceTier !== 'domestic_kosha') {
            problems.push(`${prefix}: primary SDS must be a domestic KOSHA reference.`);
        }
        if (!row.sds.url.startsWith('https://') || row.sds.accessMethod !== 'POST' || !row.sds.request.chemId) {
            problems.push(`${prefix}: incomplete KOSHA SDS retrieval reference.`);
        }
        if (!isIsoDate(row.sds.accessedAt) || !isIsoDate(row.sds.revisionDate)) {
            problems.push(`${prefix}: invalid SDS accessed/revision date.`);
        }
        if (!/^[a-f0-9]{64}$/i.test(row.sds.extractionFingerprint)) {
            problems.push(`${prefix}: missing SDS extraction fingerprint.`);
        }
        const sections = new Set(row.sds.sections.map(({ section }) => section));
        for (const section of [2, 3, 9, 10, 13, 15] as const) {
            const item = row.sds.sections.find((candidate) => candidate.section === section);
            if (!sections.has(section) || !item?.extract.trim() || !/^[a-f0-9]{64}$/i.test(item.sourceFingerprint)) {
                problems.push(`${prefix}: missing Section ${section} evidence.`);
            }
        }
        if (row.regulations.length === 0 || row.regulations.some((reference) => (
            !reference.url.startsWith('https://') ||
            !isIsoDate(reference.accessedAt) ||
            reference.sourceSection !== 15 ||
            !reference.extract.trim() ||
            !/^[a-f0-9]{64}$/i.test(reference.sourceFingerprint)
        ))) {
            problems.push(`${prefix}: a dated regulatory reference is required.`);
        }
        if (row.adjudication && (
            !GOLDEN_ADJUDICATION_OUTCOMES.includes(row.adjudication.outcome) ||
            !row.adjudication.reason.trim() ||
            row.adjudication.evidenceSections.length === 0 ||
            row.adjudication.evidenceSections.some((section) => !sections.has(section)) ||
            !isIsoDate(row.adjudication.assessedAt)
        )) {
            problems.push(`${prefix}: invalid automated adjudication.`);
        }
        if (row.review.status !== 'approved' || !row.review.curatorId || !row.review.reviewerId ||
            row.review.curatorId === row.review.reviewerId || !isIsoDate(row.review.approvedAt)) {
            problems.push(`${prefix}: approved, independently reviewed record is required.`);
        }
    });

    if (manifest) {
        if (manifest.schemaVersion !== GOLDEN_SET_V2_VERSION) problems.push('manifest: wrong schemaVersion.');
        if (manifest.rowCount !== rows.length) problems.push('manifest: rowCount does not match dataset.');
        if (manifest.sourcePolicy.networkRequiredForCi) problems.push('manifest: CI must not need source-network access.');
        if (Object.values(manifest.strata).reduce((sum, count) => sum + count, 0) !== rows.length) {
            problems.push('manifest: stratum counts do not match dataset.');
        }
    }

    return problems;
};
