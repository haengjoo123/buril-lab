// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { translations } from '../../locales/translations'
import { METRIC_DEFINITIONS, getMetricDefinition, metricsInGroup } from './metricDefinitions'
import { SMALL_SAMPLE_MIN } from './opsHomeTasks'

describe('operator metric definitions', () => {
  it('gives every metric a unique id', () => {
    const ids = METRIC_DEFINITIONS.map((definition) => definition.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(getMetricDefinition(id).id).toBe(id)
  })

  it('has a Korean and an English label and definition for every metric', () => {
    const ko = translations.ko as Record<string, string | undefined>
    const en = translations.en as Record<string, string | undefined>
    for (const { labelKey, tooltipKey } of METRIC_DEFINITIONS) {
      for (const key of [labelKey, tooltipKey]) {
        expect(ko[key], `ko.${key}`).toEqual(expect.any(String))
        expect(en[key], `en.${key}`).toEqual(expect.any(String))
      }
    }
  })

  it('applies the small-sample rule to ratios only', () => {
    for (const definition of METRIC_DEFINITIONS) {
      expect(definition.minSample, definition.id).toBe(definition.unit === 'ratio' ? SMALL_SAMPLE_MIN : 0)
    }
  })

  it('has the weekly recording labs as the only north star', () => {
    expect(metricsInGroup('north_star').map((definition) => definition.id)).toEqual(['D2_wsal'])
  })

  it('lists each group in the order the home shows its tiles, so the "정의" panel reads alongside them', () => {
    expect(metricsInGroup('product').map((definition) => definition.id)).toEqual([
      'D3_wau', 'D3_stickiness', 'D4_activation', 'D5_retention_w4', 'D6_onboarding', 'D7_ingestion',
    ])
    expect(metricsInGroup('safety').map((definition) => definition.id)).toEqual([
      'S1_needs_review', 'S3_danger_ignored', 'S2_corrections', 'S6_requests', 'S7_ghs_gaps',
    ])
    expect(metricsInGroup('b2b').map((definition) => definition.id)).toEqual([
      'B1_active_centers', 'B1_linked_labs', 'B2_sales_candidates', 'B3_pro_ready', 'B4_purchase_intent',
    ])
  })

  it('keeps the void-reason presets the KPI migration maps to categories', () => {
    // The `s2` CTE of supabase/migrations/20261106090000_admin_kpis_v1.sql maps these exact strings
    // (lower-cased, spaces collapsed) to amount / duplicate / category. Changing a preset means a new
    // migration; until then the edited preset counts as "other".
    expect(translations.ko.log_void_reason_amount).toBe('양 오입력')
    expect(translations.ko.log_void_reason_duplicate).toBe('중복 기록')
    expect(translations.ko.log_void_reason_category).toBe('분류 오선택')
    expect(translations.en.log_void_reason_amount).toBe('Wrong amount')
    expect(translations.en.log_void_reason_duplicate).toBe('Duplicate entry')
    expect(translations.en.log_void_reason_category).toBe('Wrong category')
  })
})
