-- Make the server-only denial explicit so the Supabase Security Advisor can
-- distinguish these tables from accidentally unconfigured RLS tables.
-- Table grants remain revoked; service_role bypasses RLS and keeps only the
-- least-privilege grants established by the base analytics migration.

begin;

do $$
declare
    v_table text;
begin
    foreach v_table in array array[
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
        'analytics_commercialization_settings'
    ]
    loop
        execute format(
            'drop policy if exists server_only_deny_browser_roles on public.%I',
            v_table
        );
        execute format(
            'create policy server_only_deny_browser_roles on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
            v_table
        );
    end loop;
end;
$$;

commit;
