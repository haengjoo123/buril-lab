import type { InventoryItem } from '../../services/inventoryService';
import { getExpiryStatus } from '../../utils/expiryStatus';
import { classifyInventoryHazard } from '../../utils/inventoryHazardClassifier';
import type {
  SafetyCenterLabCandidate,
  SafetyCenterRequest,
  SafetyCenterRiskItem,
  SafetyCenterWasteLog,
} from './types';

export type SafetyCenterRiskFlag =
  | 'hazard'
  | 'expired'
  | 'expiring'
  | 'missing_cas'
  | 'low_remaining';

export interface RiskItemAssessment {
  flags: SafetyCenterRiskFlag[];
  score: number;
  hazardLabels: string[];
  daysLeft: number | null;
}

export interface LabRiskSummary {
  labId: string;
  labName: string;
  riskScore: number;
  highRiskCount: number;
  expiredCount: number;
  expiringCount: number;
  missingCasCount: number;
  lowRemainingCount: number;
  totalItems: number;
}

export interface SafetyCenterDashboardSummary {
  approvedLabCount: number;
  highRiskCount: number;
  expiredOrExpiringCount: number;
  missingCasCount: number;
  openRequestCount: number;
  recentWasteCount: number;
  labSummaries: LabRiskSummary[];
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
    memo: null,
    remaining_percent: item.remaining_percent,
    created_at: item.created_at,
    updated_at: item.updated_at,
    cabinet_name: item.cabinet_name,
    storage_location_name: item.storage_location_name,
    _source: item.source_type,
  };
}

export function assessRiskItem(item: SafetyCenterRiskItem): RiskItemAssessment {
  const flags: SafetyCenterRiskFlag[] = [];
  const hazard = classifyInventoryHazard(asInventoryItem(item));
  const expiry = getExpiryStatus(item.expiry_date);

  if (hazard.level === 'high') flags.push('hazard');
  if (expiry?.level === 'expired' || expiry?.level === 'critical') flags.push('expired');
  else if (expiry?.level === 'warning') flags.push('expiring');
  if (!item.cas_number?.trim()) flags.push('missing_cas');
  if ((item.remaining_percent ?? 100) <= 10) flags.push('low_remaining');

  const score =
    (flags.includes('hazard') ? 40 : 0) +
    (flags.includes('expired') ? 25 : 0) +
    (flags.includes('expiring') ? 12 : 0) +
    (flags.includes('missing_cas') ? 10 : 0) +
    (flags.includes('low_remaining') ? 8 : 0);

  return {
    flags,
    score,
    hazardLabels: hazard.groupLabelKeys,
    daysLeft: expiry?.daysLeft ?? null,
  };
}

export function getRiskFlagLabel(flag: SafetyCenterRiskFlag): string {
  switch (flag) {
    case 'hazard':
      return '고위험';
    case 'expired':
      return '만료/긴급';
    case 'expiring':
      return '만료 임박';
    case 'missing_cas':
      return 'CAS 누락';
    case 'low_remaining':
      return '잔량 부족';
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
  const labMap = new Map<string, LabRiskSummary>();

  for (const { item, assessment } of assessments) {
    const existing = labMap.get(item.lab_id) ?? {
      labId: item.lab_id,
      labName: item.lab_name,
      riskScore: 0,
      highRiskCount: 0,
      expiredCount: 0,
      expiringCount: 0,
      missingCasCount: 0,
      lowRemainingCount: 0,
      totalItems: 0,
    };

    existing.totalItems += 1;
    existing.riskScore += assessment.score;
    if (assessment.flags.includes('hazard')) existing.highRiskCount += 1;
    if (assessment.flags.includes('expired')) existing.expiredCount += 1;
    if (assessment.flags.includes('expiring')) existing.expiringCount += 1;
    if (assessment.flags.includes('missing_cas')) existing.missingCasCount += 1;
    if (assessment.flags.includes('low_remaining')) existing.lowRemainingCount += 1;
    labMap.set(item.lab_id, existing);
  }

  return {
    approvedLabCount: input.candidates.filter((candidate) => candidate.link_status === 'approved').length,
    highRiskCount: assessments.filter(({ assessment }) => assessment.flags.includes('hazard')).length,
    expiredOrExpiringCount: assessments.filter(({ assessment }) =>
      assessment.flags.includes('expired') || assessment.flags.includes('expiring')
    ).length,
    missingCasCount: assessments.filter(({ assessment }) => assessment.flags.includes('missing_cas')).length,
    openRequestCount: input.requests.filter((request) => request.status !== 'resolved').length,
    recentWasteCount: input.wasteLogs.length,
    labSummaries: Array.from(labMap.values()).sort((left, right) => right.riskScore - left.riskScore),
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
    if (input.riskFlag !== 'all' && !assessment.flags.includes(input.riskFlag as SafetyCenterRiskFlag)) return false;
    if (input.casState === 'missing' && item.cas_number?.trim()) return false;
    if (input.casState === 'present' && !item.cas_number?.trim()) return false;

    if (input.expiryState !== 'all') {
      const expiry = getExpiryStatus(item.expiry_date);
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
