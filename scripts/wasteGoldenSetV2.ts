import type { Chemical, WasteBatchDraft, WasteMatrix, WasteStreamCode } from '../src/types';
import {
    analyzeWasteBatch,
    createEmptyWasteBatch,
    createWasteComponentFromAnalysis,
    normalizeWasteAmount,
} from '../src/utils/wasteBatch';
import { analyzeChemical } from '../src/utils/chemicalAnalyzer';
import type {
    GoldenAdjudication,
    GoldenDecisionStatus,
    GoldenEvidenceSectionNumber,
    GoldenStratum,
    WasteGoldenSetV2Row,
} from '../src/features/wasteGoldenSet/schema';

export interface GoldenSetMismatch {
    id: string;
    casNumber: string;
    stratum: GoldenStratum;
    expected: {
        status: GoldenDecisionStatus;
        streamCode?: WasteStreamCode;
        recommendedStreamCode?: WasteStreamCode;
    };
    actual: {
        status: GoldenDecisionStatus;
        streamCode: WasteStreamCode;
        reasons: string[];
        missingFields: string[];
    };
    unsafeAutomaticReady: boolean;
    /** Both outcomes are ready, but the app selected a different waste stream. */
    readyStreamMismatch: boolean;
    /** A held case received the same status but a different non-authorizing recommendation. */
    recommendedStreamMismatch: boolean;
    adjudication: GoldenAdjudication;
}

export interface GoldenSetStratumReport {
    total: number;
    strictMatches: number;
    strictMatchRate: number;
    conservativeHolds: number;
    conservativeHoldRate: number;
    unsafeAutomaticReady: number;
    readyStreamMismatches: number;
    recommendedStreamMismatches: number;
}

export interface GoldenSetReport {
    total: number;
    strictMatches: number;
    strictMatchRate: number;
    conservativeHolds: number;
    conservativeHoldRate: number;
    unsafeAutomaticReady: number;
    readyStreamMismatches: number;
    recommendedStreamMismatches: number;
    byStratum: Record<GoldenStratum, GoldenSetStratumReport>;
    mismatches: GoldenSetMismatch[];
}

const amount = (matrix: WasteMatrix) => {
    const unit = matrix === 'solid_slurry' ? 'g' : 'mL';
    const normalized = normalizeWasteAmount(100, unit);
    if (!normalized) throw new Error('Golden-set amount must normalize.');
    return {
        value: 100,
        unit,
        ...normalized,
        isApproximate: false,
        isUnknown: false,
    } as const;
};

const chemicalFor = (row: WasteGoldenSetV2Row): Chemical => ({
    id: row.id,
    name: row.substanceName,
    casNumber: row.casNumber,
    molecularFormula: row.molecularFormula,
    ghs: {
        signal: row.ghs.signalWord === 'Danger' ? 'Danger' : 'Warning',
        hazardStatements: row.ghs.hCodes,
    },
});

export const batchForGoldenRow = (row: WasteGoldenSetV2Row): WasteBatchDraft => {
    const chemical = chemicalFor(row);
    return {
        ...createEmptyWasteBatch({ id: row.id, now: '2026-08-08T00:00:00.000Z' }),
        components: [createWasteComponentFromAnalysis(analyzeChemical(chemical), {
            cartLineId: row.id,
            identityConfidence: row.scenario.identityConfidence,
            ghsDataStatus: row.scenario.ghsDataStatus,
        })],
        matrix: row.scenario.matrix,
        matrixSource: row.scenario.matrixSource,
        totalAmount: amount(row.scenario.matrix),
    };
};

const normalizedStatus = (decision: ReturnType<typeof analyzeWasteBatch>): GoldenDecisionStatus => {
    if (decision.decisionStatus === 'blocked') return 'blocked';
    if (decision.decisionStatus === 'needs_input') return 'needs_input';
    return 'ready';
};

const createStratumReport = (): GoldenSetStratumReport => ({
    total: 0,
    strictMatches: 0,
    strictMatchRate: 0,
    conservativeHolds: 0,
    conservativeHoldRate: 0,
    unsafeAutomaticReady: 0,
    readyStreamMismatches: 0,
    recommendedStreamMismatches: 0,
});

const finalizeRates = (report: GoldenSetStratumReport): GoldenSetStratumReport => ({
    ...report,
    strictMatchRate: report.total === 0 ? 0 : report.strictMatches / report.total,
    conservativeHoldRate: report.total === 0 ? 0 : report.conservativeHolds / report.total,
});

const REACTIVE_H_CODES = new Set([
    'H200', 'H201', 'H202', 'H203', 'H204', 'H205', 'H206', 'H207', 'H208',
    'H240', 'H241', 'H242', 'H250', 'H251', 'H252', 'H260', 'H261',
    'H270', 'H271', 'H272',
]);
const SECTION_10_REACTIVE_PATTERN = /(?:\b(?:self[- ]?reactive|organic peroxide|pyrophoric)\b|자기\s*반응|유기\s*과산화물|자연\s*발화)/i;

const hasReactiveEvidence = (row: WasteGoldenSetV2Row): boolean => {
    const section10 = row.sds.sections.find(({ section }) => section === 10)?.extract ?? '';
    return row.ghs.hCodes.some((code) => REACTIVE_H_CODES.has(code)) ||
        SECTION_10_REACTIVE_PATTERN.test(section10);
};

const adjudication = (
    row: WasteGoldenSetV2Row,
    actual: GoldenSetMismatch['actual'],
): GoldenAdjudication => {
    const assessedAt = '2026-08-08T00:00:00.000Z';
    const evidenceSections = (...sections: GoldenEvidenceSectionNumber[]) => sections;

    if (row.sds.sections.find(({ section }) => section === 15)?.availability === 'not_available') {
        return {
            outcome: 'insufficient_evidence',
            reason: 'KOSHA did not provide a Section 15 body for the stored source record, so regulatory handling cannot be inferred automatically.',
            evidenceSections: evidenceSections(2, 9, 10, 13, 15),
            assessedAt,
        };
    }
    if (actual.missingFields.includes('fluoride_container')) {
        return {
            outcome: 'app_correct',
            reason: 'A fluoride-compatible container is not established by the single-substance SDS scenario.',
            evidenceSections: evidenceSections(2, 13, 15),
            assessedAt,
        };
    }
    if (actual.reasons.includes('reactive_waste')) {
        return hasReactiveEvidence(row)
            ? {
                outcome: 'app_correct',
                reason: 'KOSHA Section 2 or 10 independently establishes reactivity.',
                evidenceSections: evidenceSections(2, 10),
                assessedAt,
            }
            : {
                outcome: 'gold_correct',
                reason: 'The app blocked on a name pattern, but the stored KOSHA Section 2 and 10 evidence does not establish reactivity.',
                evidenceSections: evidenceSections(2, 10),
                assessedAt,
            };
    }
    if (actual.reasons.includes('special_hazard')) {
        return {
            outcome: 'policy_decision',
            reason: 'The current analyzer elevates this to special hazard; the common-stream baseline needs an explicit domestic-policy decision.',
            evidenceSections: evidenceSections(2, 13, 15),
            assessedAt,
        };
    }
    if (actual.missingFields.includes('hazard_data') && row.scenario.ghsDataStatus === 'verified') {
        return {
            outcome: 'gold_correct',
            reason: 'Verified GHS data was incorrectly treated as absent because the disposal category was unresolved.',
            evidenceSections: evidenceSections(2, 3, 9),
            assessedAt,
        };
    }
    if (actual.missingFields.includes('classification') || actual.missingFields.includes('matrix')) {
        return {
            outcome: 'insufficient_evidence',
            reason: 'The stored single-substance scenario does not establish enough material-form or routing evidence for automatic disposal classification.',
            evidenceSections: evidenceSections(3, 9, 13, 15),
            assessedAt,
        };
    }
    if (row.expected.status !== 'ready' && actual.status === 'ready') {
        return {
            outcome: 'gold_correct',
            reason: 'The stored evidence requires a hold, but the app automatically authorized a common stream.',
            evidenceSections: evidenceSections(2, 10, 13, 15),
            assessedAt,
        };
    }
    return {
        outcome: 'policy_decision',
        reason: 'The result depends on a routing-policy choice not resolved by the stored common SDS evidence alone.',
        evidenceSections: evidenceSections(2, 10, 13, 15),
        assessedAt,
    };
};

/**
 * Execute stored V2 cases against the product analyzer. It has no network or
 * document reads and is safe to run in CI.
 */
export const runWasteGoldenSetV2 = (rows: readonly WasteGoldenSetV2Row[]): GoldenSetReport => {
    const byStratum = {} as Record<GoldenStratum, GoldenSetStratumReport>;
    const mismatches: GoldenSetMismatch[] = [];

    for (const row of rows) {
        const decision = analyzeWasteBatch(batchForGoldenRow(row));
        const actualStatus = normalizedStatus(decision);
        const strictMatch = actualStatus === row.expected.status && (
            actualStatus === 'ready'
                ? decision.streamCode === row.expected.streamCode
                : actualStatus === 'needs_input' && row.expected.recommendedStreamCode
                    ? decision.streamCode === row.expected.recommendedStreamCode
                    : true
        );
        const unsafeAutomaticReady = actualStatus === 'ready' && row.expected.status !== 'ready';
        const readyStreamMismatch = actualStatus === 'ready' &&
            row.expected.status === 'ready' &&
            decision.streamCode !== row.expected.streamCode;
        const recommendedStreamMismatch = actualStatus === 'needs_input' &&
            row.expected.status === 'needs_input' &&
            Boolean(row.expected.recommendedStreamCode) &&
            decision.streamCode !== row.expected.recommendedStreamCode;
        const conservativeHold = row.expected.status === 'ready' && actualStatus !== 'ready';
        const stratum = byStratum[row.stratum] ?? createStratumReport();
        stratum.total += 1;
        if (strictMatch) stratum.strictMatches += 1;
        if (conservativeHold) stratum.conservativeHolds += 1;
        if (unsafeAutomaticReady) stratum.unsafeAutomaticReady += 1;
        if (readyStreamMismatch) stratum.readyStreamMismatches += 1;
        if (recommendedStreamMismatch) stratum.recommendedStreamMismatches += 1;
        byStratum[row.stratum] = stratum;

        if (!strictMatch) {
            const actual = {
                status: actualStatus,
                streamCode: decision.streamCode,
                reasons: decision.blockingReasons.map(({ code }) => code),
                missingFields: decision.missingFields,
            };
            mismatches.push({
                id: row.id,
                casNumber: row.casNumber,
                stratum: row.stratum,
                expected: row.expected,
                actual,
                unsafeAutomaticReady,
                readyStreamMismatch,
                recommendedStreamMismatch,
                adjudication: adjudication(row, actual),
            });
        }
    }

    const reports = Object.values(byStratum).map(finalizeRates);
    const total = reports.reduce((sum, report) => sum + report.total, 0);
    const strictMatches = reports.reduce((sum, report) => sum + report.strictMatches, 0);
    const conservativeHolds = reports.reduce((sum, report) => sum + report.conservativeHolds, 0);
    const unsafeAutomaticReady = reports.reduce((sum, report) => sum + report.unsafeAutomaticReady, 0);
    const readyStreamMismatches = reports.reduce((sum, report) => sum + report.readyStreamMismatches, 0);
    const recommendedStreamMismatches = reports.reduce((sum, report) => sum + report.recommendedStreamMismatches, 0);
    return {
        total,
        strictMatches,
        strictMatchRate: total === 0 ? 0 : strictMatches / total,
        conservativeHolds,
        conservativeHoldRate: total === 0 ? 0 : conservativeHolds / total,
        unsafeAutomaticReady,
        readyStreamMismatches,
        recommendedStreamMismatches,
        byStratum: Object.fromEntries(
            Object.entries(byStratum).map(([stratum, report]) => [stratum, finalizeRates(report)]),
        ) as Record<GoldenStratum, GoldenSetStratumReport>,
        mismatches,
    };
};
