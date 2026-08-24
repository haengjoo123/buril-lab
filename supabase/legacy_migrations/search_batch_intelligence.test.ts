import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('./20260823085224_search_batch_intelligence.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n')
const hardeningMigration = readFileSync(
  new URL('./20260823100604_harden_search_analytics_server_only_policies.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n')

describe('search and finalized-batch intelligence migration', () => {
  it('keeps raw analytics server-only behind RLS and revoked browser grants', () => {
    for (const table of [
      'search_analytics_guest_subjects',
      'search_analytics_events',
      'search_analytics_actions',
      'analytics_review_candidates',
      'analytics_review_audit_logs',
      'global_reagent_aliases',
      'analytics_export_audits',
      'analytics_deletion_audits',
      'analytics_monthly_search_rollups',
      'analytics_monthly_mixture_rollups',
      'analytics_commercialization_settings',
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security;`)
      expect(hardeningMigration).toContain(`'${table}'`)
    }
    expect(migration).toMatch(/revoke all on table[\s\S]+from public, anon, authenticated, service_role;/)
    expect(hardeningMigration).toContain(
      'as restrictive for all to anon, authenticated using (false) with check (false)',
    )
    expect(migration).not.toMatch(/\b(ip_address|user_agent|browser_fingerprint)\b\s+(text|inet|jsonb)/i)
  })

  it('uses scoped, nullable provenance and only eligible V2 already-mixed batches', () => {
    expect(migration).toContain('references public.search_analytics_events (id) on delete set null')
    expect(migration).toContain('event.user_id is not distinct from v_log_user_id')
    expect(migration).toContain('event.lab_id is not distinct from v_log_lab_id')
    expect(migration).toContain('log.schema_version = 2')
    expect(migration).toContain('log.voided_at is null')
    expect(migration).toContain("= 'already_mixed'")
  })

  it('fixes retention, release thresholds, and commercialization shutoff in schema constraints', () => {
    expect(migration).toContain("created_at < now() - interval '90 days'")
    expect(migration).toContain('total_events >= 30 and distinct_users >= 5 and distinct_labs >= 3')
    expect(migration).toContain('finalized_batch_count >= 10 and distinct_users >= 5 and distinct_labs >= 3')
    expect(migration).toContain('external_product_enabled boolean not null default false check (not external_product_enabled)')
    expect(migration).toContain("'legacy',\n    'legacy_success_unknown'")
  })

  it('keeps candidate decisions human-approved and safety changes non-automatic', () => {
    expect(migration).toContain("if p_status = 'approved' and v_candidate.candidate_type = 'search_alias' then")
    expect(migration).toContain("'automaticRuleChange', false")
    expect(migration).not.toMatch(/insert into public\.[a-z_]*safety[a-z_]*rules/i)
  })
})
