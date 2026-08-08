import { PHREEQC_GOLDEN_PROVENANCE, PHREEQC_GOLDEN_RESULTS } from './fixtures/phreeqcGolden';
import { DEFAULT_PH_CATALOG } from './catalog';
import type { PhAcidBaseFamily, PhCatalog, PhCatalogRecord } from './catalogTypes';
import { validatePhCatalog } from './catalogValidation';
import { sha256Text, stableStringify } from './integrity';
import { PH_PREDICTION_MODEL_VERSION } from './modelMetadata';
import { PH_CATALOG_SOURCE_MANIFEST } from './sourceManifest';
import {
    PH_CATALOG_VALIDATION_EVIDENCE,
    type PhCatalogValidationEvidence,
    type PhGoldenCoverageTag,
} from './validationEvidence';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const GOLDEN_VALUE_TOLERANCE = 1e-10;

export interface PhCatalogApproval {
    runtimeReady: boolean;
    catalogIntegrity: boolean;
    sourceIntegrity: boolean;
    policyIntegrity: boolean;
    goldenArtifactIntegrity: boolean;
    modelSourceIntegrity: boolean;
    catalogFingerprintSha256: string;
    passingGoldenCaseIds: readonly string[];
    rejectedGoldenCaseIds: readonly string[];
    approvedFamilyIds: readonly string[];
    approvedRecordIds: readonly string[];
    coverageTags: readonly PhGoldenCoverageTag[];
    issueCodes: readonly string[];
}

const canonicalFamily = (family: PhAcidBaseFamily) => ({
    id: family.id,
    fullyProtonatedCharge: family.fullyProtonatedCharge,
    pKas: family.pKas,
    pKaMetadata: family.pKaMetadata.map((metadata) => ({
        ...metadata,
        sourceRefs: [...metadata.sourceRefs].sort(),
    })),
    sourceRefs: [...family.sourceRefs].sort(),
});

const canonicalRecord = (record: PhCatalogRecord) => ({
    id: record.id,
    casNumber: record.casNumber ?? null,
    structureIdentity: record.structureIdentity,
    exactFormLabel: record.exactFormLabel,
    hydration: record.hydration,
    stereochemistry: record.stereochemistry,
    formula: record.formula,
    molecularWeight: record.molecularWeight,
    kind: record.kind,
    contributions: [...record.contributions]
        .sort((left, right) => left.familyId.localeCompare(right.familyId)),
    fixedIons: [...record.fixedIons]
        .sort((left, right) => left.label.localeCompare(right.label) || left.charge - right.charge),
    implicitWaterIonCharge: record.implicitWaterIonCharge ?? null,
    flags: [...(record.flags ?? [])].sort(),
    sourceRefs: [...record.sourceRefs].sort(),
    reviewed: record.reviewed,
});

/** Fingerprint binds approval evidence to all calculation-relevant catalog data. */
export const fingerprintPhCatalog = (catalog: PhCatalog): string => sha256Text(stableStringify({
    version: catalog.version,
    temperatureC: catalog.temperatureC,
    sourceIds: [...catalog.sourceIds].sort(),
    families: [...catalog.families].sort((left, right) => left.id.localeCompare(right.id)).map(canonicalFamily),
    records: [...catalog.records].sort((left, right) => left.id.localeCompare(right.id)).map(canonicalRecord),
}));

const isPinnedSourceManifestValid = (
    catalog: PhCatalog,
    evidence: PhCatalogValidationEvidence,
): boolean => {
    const manifestIds = PH_CATALOG_SOURCE_MANIFEST.sources.map((source) => source.id);
    if (stableStringify([...catalog.sourceIds].sort()) !== stableStringify([...manifestIds].sort())) return false;
    if (PH_CATALOG_SOURCE_MANIFEST.catalogVersion !== catalog.version) return false;

    const usgs = PH_CATALOG_SOURCE_MANIFEST.sources.find((source) => source.id === 'USGS-PHREEQC-3.8.8');
    if (!usgs || !('releaseCommit' in usgs) || !('databaseArtifacts' in usgs)
        || !COMMIT_PATTERN.test(usgs.releaseCommit)
        || usgs.releaseCommit !== evidence.upstreamReleaseCommit
        || usgs.releaseCommit !== PHREEQC_GOLDEN_PROVENANCE.releaseCommit
        || usgs.databaseArtifacts.length < 3
        || usgs.databaseArtifacts.some((artifact) => !SHA256_PATTERN.test(artifact.sha256))) {
        return false;
    }

    return PH_CATALOG_SOURCE_MANIFEST.sources.every((source) => {
        if (!source.id || !source.url.startsWith('https://') || !source.releaseTag || !source.rights) return false;
        if ('artifactSha256' in source && !SHA256_PATTERN.test(source.artifactSha256)) return false;
        if ('snapshotSha256' in source && !SHA256_PATTERN.test(source.snapshotSha256)) return false;
        return true;
    });
};

const isThermodynamicallyApproved = (family: PhAcidBaseFamily): boolean =>
    family.pKaMetadata.length === family.pKas.length
    && family.pKaMetadata.every((metadata) =>
        metadata.pKaType === 'thermodynamic'
        && metadata.approvalStatus === 'approved'
        && metadata.temperatureC === 25
        && metadata.solvent === 'water'
        && metadata.ionicStrengthMolal === 0
        && metadata.standardState === 'infinite_dilution_molality'
        && metadata.sourceRefs.length > 0
        && metadata.sourceRefs.every((sourceRef) =>
            sourceRef.startsWith('USGS-') || sourceRef.startsWith('NIST-')));

const hasUnsupportedFlag = (record: PhCatalogRecord): boolean => (record.flags?.length ?? 0) > 0;

export const evaluatePhCatalogApproval = (
    catalog: PhCatalog,
    evidence: PhCatalogValidationEvidence = PH_CATALOG_VALIDATION_EVIDENCE,
): PhCatalogApproval => {
    const issues: string[] = [];
    const catalogErrors = validatePhCatalog(catalog);
    const catalogIntegrity = catalogErrors.length === 0;
    if (!catalogIntegrity) issues.push('catalog_static_validation_failed');

    const actualCatalogFingerprint = fingerprintPhCatalog(catalog);
    const fingerprintMatches = actualCatalogFingerprint === evidence.catalogFingerprintSha256;
    if (!fingerprintMatches) issues.push('catalog_fingerprint_mismatch');
    if (evidence.catalogVersion !== catalog.version) issues.push('catalog_version_mismatch');
    if (evidence.modelVersion !== PH_PREDICTION_MODEL_VERSION) issues.push('model_version_mismatch');

    const sourceIntegrity = isPinnedSourceManifestValid(catalog, evidence);
    if (!sourceIntegrity) issues.push('source_manifest_integrity_failed');
    const policyIntegrity = evidence.maximumGoldenErrorPh
        === PH_CATALOG_SOURCE_MANIFEST.reviewPolicy.maximumGoldenErrorPh
        && evidence.minimumPassingGoldenCases
            === PH_CATALOG_SOURCE_MANIFEST.reviewPolicy.minimumPassingGoldenCases
        && stableStringify([...evidence.requiredCoverageTags].sort())
            === stableStringify([...PH_CATALOG_SOURCE_MANIFEST.reviewPolicy.requiredCoverageTags].sort());
    if (!policyIntegrity) issues.push('approval_policy_integrity_failed');

    // Source-artifact hashes are verified by catalogApproval.test.ts during
    // every production build. Pages Functions cannot safely import Vite raw
    // modules, so production uses the signed release metadata after that gate.
    const modelSourceIntegrity = SHA256_PATTERN.test(evidence.predictorSourceSha256)
        && evidence.modelVersion === PH_PREDICTION_MODEL_VERSION;
    if (!modelSourceIntegrity) issues.push('predictor_source_integrity_failed');
    const goldenArtifactIntegrity = SHA256_PATTERN.test(evidence.goldenInputSha256)
        && SHA256_PATTERN.test(evidence.goldenOutputSha256)
        && evidence.goldenInputSha256 === PHREEQC_GOLDEN_PROVENANCE.inputSha256
        && evidence.goldenOutputSha256 === PHREEQC_GOLDEN_PROVENANCE.selectedOutputSha256;
    if (!goldenArtifactIntegrity) issues.push('golden_artifact_integrity_failed');

    const recordsById = new Map(catalog.records.map((record) => [record.id, record]));
    const familiesById = new Map(catalog.families.map((family) => [family.id, family]));
    const eligibleFamilyIds = new Set(catalog.families.filter(isThermodynamicallyApproved).map((family) => family.id));
    // Original PHREEQC artifacts are hash-verified in the build test. The
    // runtime uses this generated, version-pinned result table because Pages
    // Functions cannot load arbitrary scientific file extensions.
    const goldenRows = new Map(
        Object.values(PHREEQC_GOLDEN_RESULTS).map((result, index) => [
            index + 1,
            { row: index + 1, ...result },
        ]),
    );
    const seenCaseIds = new Set<string>();
    const seenRows = new Set<number>();
    const passingCases = [];
    const rejectedCaseIds: string[] = [];

    for (const goldenCase of evidence.cases) {
        const reference = goldenCase.reference;
        const selectedOutputRow = reference.kind === 'phreeqc_selected_output'
            ? reference.selectedOutputRow
            : undefined;
        const row = selectedOutputRow === undefined ? undefined : goldenRows.get(selectedOutputRow);
        const certifiedSource = reference.kind === 'certified_reference'
            ? PH_CATALOG_SOURCE_MANIFEST.sources.find((source) => source.id === reference.sourceRef)
            : undefined;
        const referenceIntegrity = reference.kind === 'phreeqc_selected_output'
            ? Number.isInteger(selectedOutputRow)
                && !seenRows.has(selectedOutputRow!)
                && Boolean(row)
                && Math.abs(row!.pH - goldenCase.referencePh) <= GOLDEN_VALUE_TOLERANCE
            : Boolean(certifiedSource)
                && 'artifactSha256' in certifiedSource!
                && certifiedSource.artifactSha256 === reference.artifactSha256
                && SHA256_PATTERN.test(reference.artifactSha256);
        const recordIds = new Set(goldenCase.recordIds);
        const declaredFamilyIds = new Set(goldenCase.familyIds);
        const actualFamilyIds = new Set<string>();
        for (const recordId of goldenCase.recordIds) {
            for (const contribution of recordsById.get(recordId)?.contributions ?? []) {
                actualFamilyIds.add(contribution.familyId);
            }
        }
        const caseValid = Boolean(goldenCase.id)
            && !seenCaseIds.has(goldenCase.id)
            && referenceIntegrity
            && Number.isFinite(goldenCase.predictorPh)
            && Math.abs(goldenCase.predictorPh - goldenCase.referencePh)
                <= evidence.maximumGoldenErrorPh
            && recordIds.size === goldenCase.recordIds.length
            && goldenCase.recordIds.length > 0
            && goldenCase.recordIds.every((recordId) => {
                const record = recordsById.get(recordId);
                return Boolean(record) && !hasUnsupportedFlag(record!);
            })
            && goldenCase.familyIds.every((familyId) =>
                familiesById.has(familyId) && eligibleFamilyIds.has(familyId))
            && stableStringify([...declaredFamilyIds].sort()) === stableStringify([...actualFamilyIds].sort())
            && goldenCase.coverageTags.length > 0;
        seenCaseIds.add(goldenCase.id);
        if (selectedOutputRow !== undefined) seenRows.add(selectedOutputRow);
        if (caseValid) passingCases.push(goldenCase);
        else rejectedCaseIds.push(goldenCase.id || `row-${selectedOutputRow ?? 'certified'}`);
    }

    const approvedFamilyIds = new Set<string>();
    const approvedRecordIds = new Set<string>();
    const coverageTags = new Set<PhGoldenCoverageTag>();
    for (const goldenCase of passingCases) {
        goldenCase.familyIds.forEach((familyId) => approvedFamilyIds.add(familyId));
        goldenCase.recordIds.forEach((recordId) => approvedRecordIds.add(recordId));
        goldenCase.coverageTags.forEach((tag) => coverageTags.add(tag));
    }

    const requiredCoverage = evidence.requiredCoverageTags;
    const releaseThresholdsMet = passingCases.length
        >= evidence.minimumPassingGoldenCases
        && requiredCoverage.every((tag) => coverageTags.has(tag));
    if (!releaseThresholdsMet) issues.push('golden_release_threshold_not_met');
    if (rejectedCaseIds.length > 0) issues.push('golden_cases_rejected');

    const globalIntegrity = catalogIntegrity
        && fingerprintMatches
        && evidence.catalogVersion === catalog.version
        && evidence.modelVersion === PH_PREDICTION_MODEL_VERSION
        && sourceIntegrity
        && policyIntegrity
        && goldenArtifactIntegrity
        && modelSourceIntegrity;
    const runtimeReady = globalIntegrity
        && releaseThresholdsMet
        && rejectedCaseIds.length === 0;

    return Object.freeze({
        runtimeReady,
        catalogIntegrity,
        sourceIntegrity,
        policyIntegrity,
        goldenArtifactIntegrity,
        modelSourceIntegrity,
        catalogFingerprintSha256: actualCatalogFingerprint,
        passingGoldenCaseIds: Object.freeze(passingCases.map((goldenCase) => goldenCase.id).sort()),
        rejectedGoldenCaseIds: Object.freeze(rejectedCaseIds.sort()),
        approvedFamilyIds: Object.freeze(runtimeReady ? [...approvedFamilyIds].sort() : []),
        approvedRecordIds: Object.freeze(runtimeReady ? [...approvedRecordIds].sort() : []),
        coverageTags: Object.freeze([...coverageTags].sort()),
        issueCodes: Object.freeze([...new Set(issues)]),
    });
};

export const DEFAULT_PH_CATALOG_APPROVAL = evaluatePhCatalogApproval(DEFAULT_PH_CATALOG);
const approvedDefaultRecordIds = new Set(DEFAULT_PH_CATALOG_APPROVAL.approvedRecordIds);

export const APPROVED_PH_CATALOG_RECORDS: readonly PhCatalogRecord[] = Object.freeze(
    DEFAULT_PH_CATALOG.records.filter((record) => approvedDefaultRecordIds.has(record.id)),
);

export const isPhCatalogRecordApproved = (recordId: string): boolean =>
    approvedDefaultRecordIds.has(recordId);
