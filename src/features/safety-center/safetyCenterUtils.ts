import type { InventoryItem } from '../../services/inventoryService';
import { getExpiryStatus } from '../../utils/expiryStatus';
import { hasManufacturerDate } from '../../utils/manufacturerDate';
import {
  classifyInventoryHazard,
  type InventoryHazardFilterCategory,
} from '../../utils/inventoryHazardClassifier';
import type {
  SafetyCenterLabCandidate,
  SafetyCenterRequest,
  SafetyCenterRiskItem,
  SafetyCenterWasteLog,
} from './types';

export const SAFETY_CENTER_SCORE_VERSION = 2 as const;

export type SafetyCenterHazardFlag = `hazard_${InventoryHazardFilterCategory}`;

export type SafetyCenterRiskFlag =
  | 'hazard'
  | SafetyCenterHazardFlag
  | 'expired'
  | 'expiring'
  | 'missing_cas'
  | 'low_remaining'
  | 'ghs_data_review';

export type SafetyCenterRiskBand = 'critical' | 'high' | 'moderate' | 'review' | 'low';

export interface RiskItemAssessment {
  flags: SafetyCenterRiskFlag[];
  score: number;
  hazardScore: number;
  operationalScore: number;
  dataQualityScore: number;
  riskBand: SafetyCenterRiskBand;
  scoreVersion: typeof SAFETY_CENTER_SCORE_VERSION;
  hazardCategories: InventoryHazardFilterCategory[];
  hazardLabels: string[];
  daysLeft: number | null;
  ghsDataNeedsReview: boolean;
}

export interface LabRiskSummary {
  labId: string;
  labName: string;
  evaluationStatus: 'evaluated' | 'no_items';
  /** Normalized 0-100 comparison index. */
  riskScore: number;
  /** Raw sum retained for workload/management burden reporting. */
  riskBurden: number;
  peakRiskScore: number;
  topFiveAverage: number;
  averageRiskScore: number;
  hazardRate: number;
  hazardCount: number;
  highRiskCount: number;
  flammableCount: number;
  corrosiveCount: number;
  toxicCount: number;
  otherManagedCount: number;
  expiredCount: number;
  expiringCount: number;
  missingCasCount: number;
  lowRemainingCount: number;
  dataQualityCount: number;
  totalItems: number;
}

export interface SafetyCenterDashboardSummary {
  scoreVersion: typeof SAFETY_CENTER_SCORE_VERSION;
  approvedLabCount: number;
  hazardCount: number;
  highRiskCount: number;
  flammableCount: number;
  corrosiveCount: number;
  toxicCount: number;
  otherManagedCount: number;
  expiredOrExpiringCount: number;
  missingCasCount: number;
  openRequestCount: number;
  recentWasteCount: number;
  labSummaries: LabRiskSummary[];
}

const HAZARD_BASE_SCORES: Record<InventoryHazardFilterCategory, number> = {
  special_high: 60,
  toxic: 45,
  corrosive: 30,
  flammable: 30,
  other_managed: 20,
};

const HAZARD_FLAG_BY_CATEGORY: Record<InventoryHazardFilterCategory, SafetyCenterHazardFlag> = {
  special_high: 'hazard_special_high',
  flammable: 'hazard_flammable',
  corrosive: 'hazard_corrosive',
  toxic: 'hazard_toxic',
  other_managed: 'hazard_other_managed',
};

const HAZARD_CATEGORY_LABELS: Record<InventoryHazardFilterCategory, string> = {
  special_high: '특수 고위험',
  flammable: '인화성',
  corrosive: '부식성',
  toxic: '독성',
  other_managed: '기타 관리 위험',
};

interface LabRiskAccumulator {
  labId: string;
  labName: string;
  scores: number[];
  riskBurden: number;
  hazardCount: number;
  highRiskCount: number;
  flammableCount: number;
  corrosiveCount: number;
  toxicCount: number;
  otherManagedCount: number;
  expiredCount: number;
  expiringCount: number;
  missingCasCount: number;
  lowRemainingCount: number;
  dataQualityCount: number;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function createLabAccumulator(labId: string, labName: string): LabRiskAccumulator {
  return {
    labId,
    labName,
    scores: [],
    riskBurden: 0,
    hazardCount: 0,
    highRiskCount: 0,
    flammableCount: 0,
    corrosiveCount: 0,
    toxicCount: 0,
    otherManagedCount: 0,
    expiredCount: 0,
    expiringCount: 0,
    missingCasCount: 0,
    lowRemainingCount: 0,
    dataQualityCount: 0,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finalizeLabRiskSummary(accumulator: LabRiskAccumulator): LabRiskSummary {
  const scores = [...accumulator.scores].sort((left, right) => right - left);
  const peakRiskScore = scores[0] ?? 0;
  const topFiveAverage = average(scores.slice(0, 5));
  const averageRiskScore = average(scores);
  const totalItems = scores.length;
  const hazardRate = totalItems === 0
    ? 0
    : Math.round((accumulator.hazardCount / totalItems) * 100);

  // Peak risk catches a critical item; the top-five and mean terms describe
  // concentration without allowing inventory row count to dominate the index.
  const weightedIndex = (
    peakRiskScore * 0.45
    + topFiveAverage * 0.35
    + averageRiskScore * 0.20
  );
  const criticalFloor = accumulator.highRiskCount > 0 ? peakRiskScore : 0;

  return {
    labId: accumulator.labId,
    labName: accumulator.labName,
    evaluationStatus: totalItems > 0 ? 'evaluated' : 'no_items',
    riskScore: clampScore(Math.max(weightedIndex, criticalFloor)),
    riskBurden: Math.round(accumulator.riskBurden),
    peakRiskScore: clampScore(peakRiskScore),
    topFiveAverage: Math.round(topFiveAverage),
    averageRiskScore: Math.round(averageRiskScore),
    hazardRate,
    hazardCount: accumulator.hazardCount,
    highRiskCount: accumulator.highRiskCount,
    flammableCount: accumulator.flammableCount,
    corrosiveCount: accumulator.corrosiveCount,
    toxicCount: accumulator.toxicCount,
    otherManagedCount: accumulator.otherManagedCount,
    expiredCount: accumulator.expiredCount,
    expiringCount: accumulator.expiringCount,
    missingCasCount: accumulator.missingCasCount,
    lowRemainingCount: accumulator.lowRemainingCount,
    dataQualityCount: accumulator.dataQualityCount,
    totalItems,
  };
}

export function asInventoryItem(item: SafetyCenterRiskItem): InventoryItem {
  return {
    id: item.item_id,
    lab_id: item.lab_id,
    user_id: null,
    name: item.inventory_name,
    brand: item.brand,
    product_number: item.product_number,
    cas_number: item.cas_number,
    quantity: item.quantity,
    capacity: item.capacity,
    storage_type: item.storage_type,
    cabinet_id: null,
    storage_location_id: null,
    product_id: null,
    expiry_date: item.expiry_date,
    manufacturer_date_type: item.manufacturer_date_type,
    received_date: item.received_date,
    opened_date: item.opened_date,
    memo: null,
    remaining_percent: item.remaining_percent,
    created_at: item.created_at,
    updated_at: item.updated_at,
    cabinet_name: item.cabinet_name,
    storage_location_name: item.storage_location_name,
    _source: item.source_type,
  };
}

export function getHazardCategoryLabel(category: InventoryHazardFilterCategory): string {
  return HAZARD_CATEGORY_LABELS[category];
}

export function getHazardCategoryFlag(category: InventoryHazardFilterCategory): SafetyCenterHazardFlag {
  return HAZARD_FLAG_BY_CATEGORY[category];
}

export function assessRiskItem(item: SafetyCenterRiskItem): RiskItemAssessment {
  const flags: SafetyCenterRiskFlag[] = [];
  const hazard = classifyInventoryHazard(asInventoryItem(item), {
    hCodes: item.ghs_h_codes ?? [],
    allowNameCandidates: true,
  });
  const hazardCategories = hazard.filterCategories;
  const expiry = getExpiryStatus(hasManufacturerDate(item.manufacturer_date_type) ? item.expiry_date : null);
  const isMissingCas = !item.cas_number?.trim();
  const isLowRemaining = (item.remaining_percent ?? 100) <= 10;
  const ghsDataNeedsReview = item.ghs_data_status === 'transient_error';

  if (hazardCategories.length > 0) {
    flags.push('hazard');
    hazardCategories.forEach((category) => flags.push(HAZARD_FLAG_BY_CATEGORY[category]));
  }
  if (expiry?.level === 'expired' || expiry?.level === 'critical') flags.push('expired');
  else if (expiry?.level === 'warning') flags.push('expiring');
  if (isMissingCas) flags.push('missing_cas');
  if (isLowRemaining) flags.push('low_remaining');
  if (ghsDataNeedsReview) flags.push('ghs_data_review');

  const highestHazardScore = hazardCategories.reduce(
    (highest, category) => Math.max(highest, HAZARD_BASE_SCORES[category]),
    0,
  );
  const overlapBonus = Math.min(10, Math.max(0, hazardCategories.length - 1) * 5);
  const hazardScore = Math.min(70, highestHazardScore + overlapBonus);
  const operationalScore = (
    (flags.includes('expired') ? 25 : 0)
    + (flags.includes('expiring') ? 12 : 0)
    + (flags.includes('low_remaining') ? 8 : 0)
  );
  const dataQualityScore = (
    (isMissingCas ? 5 : 0)
    + (ghsDataNeedsReview ? 5 : 0)
  );
  const score = clampScore(hazardScore + operationalScore + dataQualityScore);
  const riskBand: SafetyCenterRiskBand = hazardCategories.includes('special_high')
    ? 'critical'
    : score >= 45
      ? 'high'
      : score >= 25
        ? 'moderate'
        : dataQualityScore > 0
          ? 'review'
          : 'low';

  return {
    flags,
    score,
    hazardScore,
    operationalScore,
    dataQualityScore,
    riskBand,
    scoreVersion: SAFETY_CENTER_SCORE_VERSION,
    hazardCategories,
    hazardLabels: hazard.groupLabelKeys,
    daysLeft: expiry?.daysLeft ?? null,
    ghsDataNeedsReview,
  };
}

export function getRiskFlagLabel(flag: SafetyCenterRiskFlag): string {
  if (flag.startsWith('hazard_')) {
    const category = flag.slice('hazard_'.length) as InventoryHazardFilterCategory;
    return getHazardCategoryLabel(category);
  }

  switch (flag) {
    case 'hazard':
      return '관리 위험';
    case 'expired':
      return '만료/긴급';
    case 'expiring':
      return '만료 임박';
    case 'missing_cas':
      return 'CAS 누락';
    case 'low_remaining':
      return '잔량 부족';
    case 'ghs_data_review':
      return 'GHS 확인 필요';
    default:
      return flag;
  }
}

export function getRequestStatusLabel(status: SafetyCenterRequest['status']): string {
  switch (status) {
    case 'open':
      return '요청됨';
    case 'in_progress':
      return '처리 중';
    case 'submitted':
      return '제출됨';
    case 'resolved':
      return '완료';
    default:
      return status;
  }
}

export function getPriorityLabel(priority: SafetyCenterRequest['priority']): string {
  switch (priority) {
    case 'urgent':
      return '긴급';
    case 'high':
      return '높음';
    case 'normal':
      return '보통';
    case 'low':
      return '낮음';
    default:
      return priority;
  }
}

export function buildSafetyCenterDashboardSummary(input: {
  candidates: SafetyCenterLabCandidate[];
  riskItems: SafetyCenterRiskItem[];
  requests: SafetyCenterRequest[];
  wasteLogs: SafetyCenterWasteLog[];
}): SafetyCenterDashboardSummary {
  const assessments = input.riskItems.map((item) => ({
    item,
    assessment: assessRiskItem(item),
  }));
  const labMap = new Map<string, LabRiskAccumulator>();

  input.candidates
    .filter((candidate) => candidate.link_status === 'approved')
    .forEach((candidate) => {
      labMap.set(candidate.lab_id, createLabAccumulator(candidate.lab_id, candidate.lab_name));
    });

  for (const { item, assessment } of assessments) {
    const existing = labMap.get(item.lab_id) ?? createLabAccumulator(item.lab_id, item.lab_name);

    existing.scores.push(assessment.score);
    existing.riskBurden += assessment.score;
    if (assessment.hazardCategories.length > 0) existing.hazardCount += 1;
    if (assessment.hazardCategories.includes('special_high')) existing.highRiskCount += 1;
    if (assessment.hazardCategories.includes('flammable')) existing.flammableCount += 1;
    if (assessment.hazardCategories.includes('corrosive')) existing.corrosiveCount += 1;
    if (assessment.hazardCategories.includes('toxic')) existing.toxicCount += 1;
    if (assessment.hazardCategories.includes('other_managed')) existing.otherManagedCount += 1;
    if (assessment.flags.includes('expired')) existing.expiredCount += 1;
    if (assessment.flags.includes('expiring')) existing.expiringCount += 1;
    if (assessment.flags.includes('missing_cas')) existing.missingCasCount += 1;
    if (assessment.flags.includes('low_remaining')) existing.lowRemainingCount += 1;
    if (assessment.dataQualityScore > 0) existing.dataQualityCount += 1;
    labMap.set(item.lab_id, existing);
  }

  const labSummaries = Array.from(labMap.values())
    .map(finalizeLabRiskSummary)
    .sort((left, right) => right.riskScore - left.riskScore || right.riskBurden - left.riskBurden);

  return {
    scoreVersion: SAFETY_CENTER_SCORE_VERSION,
    approvedLabCount: input.candidates.filter((candidate) => candidate.link_status === 'approved').length,
    hazardCount: assessments.filter(({ assessment }) => assessment.hazardCategories.length > 0).length,
    highRiskCount: assessments.filter(({ assessment }) => assessment.hazardCategories.includes('special_high')).length,
    flammableCount: assessments.filter(({ assessment }) => assessment.hazardCategories.includes('flammable')).length,
    corrosiveCount: assessments.filter(({ assessment }) => assessment.hazardCategories.includes('corrosive')).length,
    toxicCount: assessments.filter(({ assessment }) => assessment.hazardCategories.includes('toxic')).length,
    otherManagedCount: assessments.filter(({ assessment }) => assessment.hazardCategories.includes('other_managed')).length,
    expiredOrExpiringCount: assessments.filter(({ assessment }) =>
      assessment.flags.includes('expired') || assessment.flags.includes('expiring')
    ).length,
    missingCasCount: assessments.filter(({ assessment }) => assessment.flags.includes('missing_cas')).length,
    openRequestCount: input.requests.filter((request) => request.status !== 'resolved').length,
    recentWasteCount: input.wasteLogs.length,
    labSummaries,
  };
}

export function filterRiskItems(input: {
  items: SafetyCenterRiskItem[];
  labId: string;
  riskFlag: string;
  casState: string;
  expiryState: string;
  query: string;
}): SafetyCenterRiskItem[] {
  const normalizedQuery = input.query.trim().toLowerCase();

  return input.items.filter((item) => {
    const assessment = assessRiskItem(item);
    if (input.labId !== 'all' && item.lab_id !== input.labId) return false;

    const matchesRiskFlag = input.riskFlag === 'all'
      || (input.riskFlag === 'hazard' && assessment.hazardCategories.length > 0)
      || assessment.flags.includes(input.riskFlag as SafetyCenterRiskFlag);
    if (!matchesRiskFlag) return false;

    if (input.casState === 'missing' && item.cas_number?.trim()) return false;
    if (input.casState === 'present' && !item.cas_number?.trim()) return false;

    if (input.expiryState !== 'all') {
      const expiry = getExpiryStatus(hasManufacturerDate(item.manufacturer_date_type) ? item.expiry_date : null);
      if (input.expiryState === 'expired' && expiry?.level !== 'expired') return false;
      if (input.expiryState === 'warning' && expiry?.level !== 'warning' && expiry?.level !== 'critical') return false;
      if (input.expiryState === 'none' && expiry) return false;
    }

    if (!normalizedQuery) return true;

    return [
      item.inventory_name,
      item.lab_name,
      item.cas_number ?? '',
      item.brand ?? '',
      item.product_number ?? '',
      item.cabinet_name ?? '',
      item.storage_location_name ?? '',
    ].join(' ').toLowerCase().includes(normalizedQuery);
  });
}
