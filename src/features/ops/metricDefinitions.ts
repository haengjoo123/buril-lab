import { SMALL_SAMPLE_MIN } from './opsHomeTasks'

/**
 * The operator home's metrics in one place (plan 1-A "정의 관리"). Values come from
 * public.analytics_admin_kpis_v1 (supabase/migrations/20261106090000_admin_kpis_v1.sql) and, for
 * D7, analytics_admin_summary. `formula` mirrors docs/operations/admin-kpis-rollout.md for
 * developers; the screen shows `tooltipKey` in the "정의" panel instead.
 */

export type MetricGroup = 'north_star' | 'product' | 'safety' | 'b2b'
export type MetricUnit = 'labs' | 'users' | 'ratio' | 'events' | 'requests' | 'institutions'
/** How the value is windowed; the "정의" panel explains each in words (tooltipKey). */
export type MetricWindow = 'rolling_7d' | 'period' | 'cohort_14d' | 'cohort_w4' | 'rolling_4w' | 'snapshot'
export type MetricId =
  | 'D2_wsal' | 'D3_wau' | 'D3_stickiness' | 'D4_activation' | 'D5_retention_w4' | 'D6_onboarding' | 'D7_ingestion'
  | 'S1_needs_review' | 'S2_corrections' | 'S3_danger_ignored' | 'S6_requests' | 'S7_ghs_gaps'
  | 'B1_active_centers' | 'B1_linked_labs' | 'B2_sales_candidates' | 'B3_pro_ready' | 'B4_purchase_intent'

export interface MetricDefinition {
  id: MetricId
  group: MetricGroup
  /** Tile label (i18n). */
  labelKey: string
  /** Developer-facing formula, mirrors docs/operations/admin-kpis-rollout.md; never rendered. */
  formula: string
  unit: MetricUnit
  window: MetricWindow
  /** Ratios: SMALL_SAMPLE_MIN (shown as n/N below it). Plain counts: 0. */
  minSample: number
  /** Plain-language definition for the "정의" panel (i18n). */
  tooltipKey: string
}

/** Display order: the north star first, then each group's tiles in the order the home shows them. */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    id: 'D2_wsal', group: 'north_star', labelKey: 'ops_kpi_north_star_title', unit: 'labs', window: 'rolling_7d',
    minSample: 0, tooltipKey: 'ops_kpi_def_wsal',
    formula: 'distinct customer labs with CR in [now-7d, now)',
  },
  {
    id: 'D3_wau', group: 'product', labelKey: 'ops_kpi_wau_label', unit: 'users', window: 'rolling_7d',
    minSample: 0, tooltipKey: 'ops_kpi_def_wau',
    formula: 'distinct non-internal users with ACT in [now-7d, now)',
  },
  {
    id: 'D3_stickiness', group: 'product', labelKey: 'ops_kpi_stickiness_label', unit: 'ratio', window: 'rolling_7d',
    minSample: SMALL_SAMPLE_MIN, tooltipKey: 'ops_kpi_def_stickiness',
    formula: 'WAU / users with ACT in [now-30d, now)',
  },
  {
    id: 'D4_activation', group: 'product', labelKey: 'ops_kpi_activation_label', unit: 'ratio', window: 'cohort_14d',
    minSample: SMALL_SAMPLE_MIN, tooltipKey: 'ops_kpi_def_activation',
    formula: 'labs created [now-42d, now-14d) with 2nd member ∧ item ∧ v2 record within 14d / cohort',
  },
  {
    id: 'D5_retention_w4', group: 'product', labelKey: 'ops_kpi_retention_label', unit: 'ratio', window: 'cohort_w4',
    minSample: SMALL_SAMPLE_MIN, tooltipKey: 'ops_kpi_def_retention',
    formula: 'labs created [now-84d, now-28d) with CR on days 22-28 / cohort',
  },
  {
    id: 'D6_onboarding', group: 'product', labelKey: 'ops_kpi_onboarding_label', unit: 'ratio', window: 'period',
    minSample: SMALL_SAMPLE_MIN, tooltipKey: 'ops_kpi_def_onboarding',
    formula: 'users whose first shown is in the period and who reached first value / those users',
  },
  {
    id: 'D7_ingestion', group: 'product', labelKey: 'ops_an_ingestion_title', unit: 'ratio', window: 'period',
    minSample: SMALL_SAMPLE_MIN, tooltipKey: 'ops_kpi_def_ingestion',
    formula: 'analytics_admin_summary.analyticsIngestionFailureRate (baseline < 1%)',
  },
  {
    id: 'S1_needs_review', group: 'safety', labelKey: 'ops_kpi_needs_review_label', unit: 'ratio', window: 'period',
    minSample: SMALL_SAMPLE_MIN, tooltipKey: 'ops_kpi_def_needs_review',
    formula: 'valid v2 records needs_input|blocked / valid v2 records',
  },
  {
    id: 'S3_danger_ignored', group: 'safety', labelKey: 'ops_kpi_danger_label', unit: 'events', window: 'period',
    minSample: 0, tooltipKey: 'ops_kpi_def_danger',
    formula: 'storage_warning_ignored with DANGER: events, distinct labs',
  },
  {
    id: 'S2_corrections', group: 'safety', labelKey: 'ops_kpi_corrections_label', unit: 'ratio', window: 'period',
    minSample: SMALL_SAMPLE_MIN, tooltipKey: 'ops_kpi_def_corrections',
    formula: 'voided v2 records / all v2 records created in the period',
  },
  {
    id: 'S6_requests', group: 'safety', labelKey: 'ops_kpi_requests_label', unit: 'requests', window: 'snapshot',
    minSample: 0, tooltipKey: 'ops_kpi_def_requests',
    formula: 'open|in_progress requests: due_date < today (Seoul), today..today+3; median first lab reply',
  },
  {
    id: 'S7_ghs_gaps', group: 'safety', labelKey: 'ops_kpi_ghs_label', unit: 'ratio', window: 'period',
    minSample: SMALL_SAMPLE_MIN, tooltipKey: 'ops_kpi_def_ghs',
    formula: 'components lookup_failed|not_checked / components with a GHS status',
  },
  {
    id: 'B1_active_centers', group: 'b2b', labelKey: 'ops_kpi_active_centers_label', unit: 'ratio', window: 'period',
    minSample: SMALL_SAMPLE_MIN, tooltipKey: 'ops_kpi_def_active_centers',
    formula: 'approved centers with a request or export in the period / approved centers',
  },
  {
    id: 'B1_linked_labs', group: 'b2b', labelKey: 'ops_kpi_linked_labs_label', unit: 'labs', window: 'snapshot',
    minSample: 0, tooltipKey: 'ops_kpi_def_linked_labs',
    formula: 'distinct customer labs with an approved link to an approved center',
  },
  {
    id: 'B2_sales_candidates', group: 'b2b', labelKey: 'ops_kpi_sales_label', unit: 'institutions', window: 'rolling_7d',
    minSample: 0, tooltipKey: 'ops_kpi_def_sales',
    formula: 'lower(trim(institution)) with >= 2 WSAL labs and no approved center',
  },
  {
    id: 'B3_pro_ready', group: 'b2b', labelKey: 'ops_kpi_pro_label', unit: 'labs', window: 'rolling_4w',
    minSample: 0, tooltipKey: 'ops_kpi_def_pro',
    formula: 'labs with CR in >= 3 of the last 4 weeks and >= 3 members',
  },
  {
    id: 'B4_purchase_intent', group: 'b2b', labelKey: 'ops_kpi_purchase_label', unit: 'events', window: 'period',
    minSample: 0, tooltipKey: 'ops_kpi_def_purchase',
    formula: 'registration/placement events; brands only with >= 3 labs and >= 5 users',
  },
]

export function getMetricDefinition(id: MetricId): MetricDefinition {
  const definition = METRIC_DEFINITIONS.find((entry) => entry.id === id)
  if (!definition) throw new Error(`Unknown metric ${id}`)
  return definition
}

export function metricsInGroup(group: MetricGroup): MetricDefinition[] {
  return METRIC_DEFINITIONS.filter((entry) => entry.group === group)
}
