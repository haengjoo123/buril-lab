import { describe, expect, it } from 'vitest';
import type { SafetyCenterLabCandidate, SafetyCenterRiskItem } from './types';
import {
  assessRiskItem,
  buildSafetyCenterDashboardSummary,
  filterRiskItems,
} from './safetyCenterUtils';

function createRiskItem(overrides: Partial<SafetyCenterRiskItem> = {}): SafetyCenterRiskItem {
  return {
    source_type: 'inventory',
    item_id: overrides.item_id ?? 'item-1',
    lab_id: overrides.lab_id ?? 'lab-1',
    lab_name: overrides.lab_name ?? 'Lab 1',
    inventory_name: overrides.inventory_name ?? 'Acetone',
    brand: null,
    product_number: null,
    cas_number: '67-64-1',
    quantity: 1,
    capacity: '500 mL',
    storage_type: 'other',
    cabinet_name: null,
    storage_location_name: null,
    expiry_date: null,
    remaining_percent: 100,
    ghs_h_codes: ['H225'],
    ghs_data_status: 'success',
    ghs_fetched_at: '2026-08-07T00:00:00.000Z',
    ghs_expires_at: '2026-08-14T00:00:00.000Z',
    created_at: '2026-08-07T00:00:00.000Z',
    updated_at: '2026-08-07T00:00:00.000Z',
    ...overrides,
  };
}

function createCandidate(labId: string, labName: string): SafetyCenterLabCandidate {
  return {
    lab_id: labId,
    lab_name: labName,
    institution_name: null,
    institution_type: null,
    research_field: null,
    created_at: '2026-08-07T00:00:00.000Z',
    link_id: `link-${labId}`,
    link_status: 'approved',
    link_scope: ['summary', 'risk_detail'],
    requested_at: null,
    responded_at: null,
  };
}

describe('Safety Center risk scoring v2', () => {
  it('scores ordinary flammables instead of treating them as zero hazard', () => {
    const assessment = assessRiskItem(createRiskItem());

    expect(assessment.hazardCategories).toContain('flammable');
    expect(assessment.flags).toContain('hazard_flammable');
    expect(assessment.flags).not.toContain('hazard_special_high');
    expect(assessment.hazardScore).toBe(30);
    expect(assessment.score).toBe(30);
  });

  it('scores corrosive H-codes from the GHS payload', () => {
    const assessment = assessRiskItem(createRiskItem({
      inventory_name: 'Hydrochloric acid',
      cas_number: '7647-01-0',
      ghs_h_codes: ['H314'],
    }));

    expect(assessment.hazardCategories).toContain('corrosive');
    expect(assessment.flags).toContain('hazard_corrosive');
    expect(assessment.score).toBe(30);
  });

  it('caps overlapping category contribution instead of double-counting special high toxicity', () => {
    const assessment = assessRiskItem(createRiskItem({
      inventory_name: 'Sodium azide',
      cas_number: '26628-22-8',
      ghs_h_codes: [],
    }));

    expect(assessment.hazardCategories).toEqual(expect.arrayContaining(['special_high', 'toxic']));
    expect(assessment.hazardScore).toBe(65);
    expect(assessment.riskBand).toBe('critical');
  });

  it('keeps missing CAS as a small data-quality contribution', () => {
    const assessment = assessRiskItem(createRiskItem({
      inventory_name: 'Unidentified sample',
      cas_number: null,
      ghs_h_codes: [],
      ghs_data_status: null,
    }));

    expect(assessment.hazardScore).toBe(0);
    expect(assessment.dataQualityScore).toBe(5);
    expect(assessment.flags).toContain('missing_cas');
    expect(assessment.riskBand).toBe('review');
  });

  it('keeps normalized lab risk stable when identical low-risk rows are duplicated', () => {
    const oneItem = createRiskItem({ item_id: 'a-1', lab_id: 'lab-a', lab_name: 'Lab A' });
    const tenItems = Array.from({ length: 10 }, (_, index) => createRiskItem({
      item_id: `b-${index}`,
      lab_id: 'lab-b',
      lab_name: 'Lab B',
    }));
    const summary = buildSafetyCenterDashboardSummary({
      candidates: [createCandidate('lab-a', 'Lab A'), createCandidate('lab-b', 'Lab B')],
      riskItems: [oneItem, ...tenItems],
      requests: [],
      wasteLogs: [],
    });
    const labA = summary.labSummaries.find((lab) => lab.labId === 'lab-a');
    const labB = summary.labSummaries.find((lab) => lab.labId === 'lab-b');

    expect(labA?.riskScore).toBe(labB?.riskScore);
    expect(labA?.riskBurden).toBe(30);
    expect(labB?.riskBurden).toBe(300);
  });

  it('filters Safety Center rows by detailed hazard category', () => {
    const flammable = createRiskItem({ item_id: 'flammable', inventory_name: 'Acetone' });
    const corrosive = createRiskItem({
      item_id: 'corrosive',
      inventory_name: 'Hydrochloric acid',
      cas_number: '7647-01-0',
      ghs_h_codes: ['H314'],
    });

    const result = filterRiskItems({
      items: [flammable, corrosive],
      labId: 'all',
      riskFlag: 'hazard_corrosive',
      casState: 'all',
      expiryState: 'all',
      query: '',
    });

    expect(result.map((item) => item.item_id)).toEqual(['corrosive']);
  });

  it('does not present an approved lab with no risk rows as an evaluated zero', () => {
    const summary = buildSafetyCenterDashboardSummary({
      candidates: [createCandidate('lab-empty', 'Empty Lab')],
      riskItems: [],
      requests: [],
      wasteLogs: [],
    });

    expect(summary.labSummaries[0]).toMatchObject({
      evaluationStatus: 'no_items',
      riskScore: 0,
      totalItems: 0,
    });
  });
});
