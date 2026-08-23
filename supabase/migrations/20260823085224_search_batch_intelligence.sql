-- Search and finalized-batch intelligence.
--
-- Raw rows are deliberately server-only. Browser roles have neither table
-- grants nor RLS policies, while the service role is granted only the
-- operations used by Cloudflare Pages Functions. Commercial release remains
-- disabled; all rows written by the current API belong to the internal-only
-- cohort.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '15min';

select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('buril:search-batch-intelligence-v1', 0)
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create extension if not exists pg_cron;

create or replace function private.analytics_normalize_query(input text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
    select nullif(lower(regexp_replace(trim(input), '\s+', ' ', 'g')), '');
$$;

revoke all on function private.analytics_normalize_query(text) from public, anon, authenticated;

create or replace function private.analytics_sanitize_legacy_query(input text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
    v_value text;
begin
    v_value := regexp_replace(input, '[[:cntrl:]]', '', 'g');
    v_value := regexp_replace(trim(v_value), '\s+', ' ', 'g');
    v_value := regexp_replace(v_value, '(https?://|www\.)[^[:space:]]+', '[URL]', 'gi');
    v_value := regexp_replace(
        v_value,
        '[[:alnum:]._%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}',
        '[EMAIL]',
        'gi'
    );
    if v_value !~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$' then
        v_value := regexp_replace(v_value, '(^|[^0-9])([0-9][0-9 ()+\-]{8,}[0-9])($|[^0-9])', '\1[PHONE]\3', 'g');
    end if;
    v_value := regexp_replace(v_value, '(^|[^[:alnum:]_])([[:alnum:]_\-]{32,})($|[^[:alnum:]_])', '\1[TOKEN]\3', 'g');
    return nullif(left(v_value, 200), '');
end;
$$;

revoke all on function private.analytics_sanitize_legacy_query(text) from public, anon, authenticated;

create table public.search_analytics_guest_subjects (
    id uuid primary key,
    delete_token_hash text not null,
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    constraint search_analytics_guest_subjects_hash_check
        check (delete_token_hash ~ '^[a-f0-9]{64}$')
);

create table public.search_analytics_events (
    id uuid primary key,
    user_id uuid references auth.users (id) on delete cascade,
    guest_subject_id uuid references public.search_analytics_guest_subjects (id) on delete cascade,
    lab_id uuid references public.labs (id) on delete set null,
    session_id uuid not null,
    previous_event_id uuid references public.search_analytics_events (id) on delete set null,
    source_history_id uuid unique references public.user_search_history (id) on delete cascade,
    query_sanitized text not null,
    query_normalized text not null,
    query_type text not null check (query_type in ('name', 'cas', 'formula', 'unknown')),
    search_channel text not null check (
        search_channel in ('manual', 'autocomplete', 'history', 'scan', 'voice', 'url', 'legacy')
    ),
    chemical_result_count integer not null default 0 check (chemical_result_count between 0 and 100000),
    product_result_count integer not null default 0 check (product_result_count between 0 and 100000),
    cabinet_result_count integer not null default 0 check (cabinet_result_count between 0 and 100000),
    latency_ms integer check (latency_ms between 0 and 300000),
    outcome text not null check (
        outcome in (
            'matched',
            'no_result',
            'invalid_query',
            'technical_error',
            'legacy_success_unknown'
        )
    ),
    matched_cas text,
    matched_pubchem_cid bigint check (matched_pubchem_cid is null or matched_pubchem_cid > 0),
    matched_kosha_id text,
    matched_standard_name text,
    previous_ingestion_failures integer not null default 0
        check (previous_ingestion_failures between 0 and 1000),
    commercial_cohort text not null default 'internal_only'
        check (commercial_cohort in ('internal_only', 'institution_contract')),
    created_at timestamptz not null default now(),
    constraint search_analytics_events_subject_check check (
        (user_id is not null and guest_subject_id is null)
        or (user_id is null and guest_subject_id is not null and lab_id is null)
    ),
    constraint search_analytics_events_query_sanitized_check
        check (char_length(query_sanitized) between 1 and 200),
    constraint search_analytics_events_query_normalized_check
        check (char_length(query_normalized) between 1 and 200)
);

create table public.search_analytics_actions (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.search_analytics_events (id) on delete cascade,
    related_event_id uuid references public.search_analytics_events (id) on delete set null,
    action_type text not null check (
        action_type in (
            'result_opened',
            'result_selected',
            'query_reformulated',
            'scan_corrected',
            'added_to_batch'
        )
    ),
    target_type text check (target_type is null or target_type in ('chemical', 'product', 'cabinet', 'query', 'batch')),
    target_ref text,
    matched_cas text,
    matched_standard_name text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint search_analytics_actions_metadata_check check (
        jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 16384
    )
);

create table public.analytics_review_candidates (
    id uuid primary key default gen_random_uuid(),
    candidate_type text not null check (
        candidate_type in ('search_alias', 'safety_rule', 'education_content')
    ),
    source_key text not null,
    title text not null,
    summary text not null,
    proposed_alias text,
    canonical_name text,
    canonical_cas text,
    evidence jsonb not null default '{}'::jsonb,
    sample_count integer not null default 0 check (sample_count >= 0),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    review_notes text,
    reviewed_by uuid references auth.users (id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint analytics_review_candidates_source_key_check check (char_length(source_key) between 1 and 500),
    constraint analytics_review_candidates_evidence_check check (
        jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 65536
    )
);

create unique index analytics_review_candidates_pending_key_idx
    on public.analytics_review_candidates (candidate_type, source_key)
    where status = 'pending';

create table public.analytics_review_audit_logs (
    id uuid primary key default gen_random_uuid(),
    candidate_id uuid not null references public.analytics_review_candidates (id) on delete cascade,
    action text not null check (action in ('approved', 'rejected')),
    notes text,
    evidence jsonb not null default '{}'::jsonb,
    operator_user_id uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint analytics_review_audit_logs_evidence_check check (
        jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 65536
    )
);

create table public.global_reagent_aliases (
    id uuid primary key default gen_random_uuid(),
    alias text not null,
    normalized_alias text not null unique,
    canonical_name text not null,
    cas_number text,
    source_review_id uuid unique references public.analytics_review_candidates (id) on delete set null,
    approved_by uuid references auth.users (id) on delete set null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint global_reagent_aliases_alias_check check (char_length(alias) between 1 and 200),
    constraint global_reagent_aliases_normalized_check check (char_length(normalized_alias) between 1 and 200),
    constraint global_reagent_aliases_canonical_check check (char_length(canonical_name) between 1 and 300)
);

create table public.analytics_export_audits (
    id uuid primary key default gen_random_uuid(),
    operator_user_id uuid references auth.users (id) on delete set null,
    operator_email text not null,
    reason text not null,
    filters jsonb not null default '{}'::jsonb,
    row_count integer not null check (row_count between 0 and 50000),
    file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
    created_at timestamptz not null default now(),
    constraint analytics_export_audits_reason_check check (char_length(reason) between 5 and 1000),
    constraint analytics_export_audits_filters_check check (
        jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 16384
    )
);

create table public.analytics_deletion_audits (
    id uuid primary key default gen_random_uuid(),
    subject_type text not null check (subject_type in ('authenticated', 'guest')),
    reason text not null check (reason in ('history_item_deleted', 'history_cleared', 'account_deleted', 'guest_request', 'guest_expired')),
    deleted_event_count integer not null check (deleted_event_count >= 0),
    deleted_action_count integer not null default 0 check (deleted_action_count >= 0),
    created_at timestamptz not null default now()
);

create table public.analytics_monthly_search_rollups (
    month_start date not null,
    commercial_cohort text not null check (commercial_cohort in ('internal_only', 'institution_contract')),
    query_normalized text not null,
    representative_query text not null,
    total_events integer not null,
    matched_events integer not null,
    no_result_events integer not null,
    distinct_users integer not null,
    distinct_labs integer not null,
    reformulation_rate numeric,
    scan_correction_rate numeric,
    unresolved_rate numeric,
    confusion_score numeric,
    created_at timestamptz not null default now(),
    primary key (month_start, commercial_cohort, query_normalized),
    constraint analytics_monthly_search_rollups_threshold_check check (
        total_events >= 30 and distinct_users >= 5 and distinct_labs >= 3
    )
);

create table public.analytics_monthly_mixture_rollups (
    month_start date not null,
    commercial_cohort text not null check (commercial_cohort in ('internal_only', 'institution_contract')),
    component_a_key text not null,
    component_a_name text not null,
    component_b_key text not null,
    component_b_name text not null,
    finalized_batch_count integer not null,
    distinct_users integer not null,
    distinct_labs integer not null,
    volume_distribution jsonb not null default '{}'::jsonb,
    ph_distribution jsonb not null default '{}'::jsonb,
    concentration_distributions jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    primary key (month_start, commercial_cohort, component_a_key, component_b_key),
    constraint analytics_monthly_mixture_rollups_threshold_check check (
        finalized_batch_count >= 10 and distinct_users >= 5 and distinct_labs >= 3
    )
);

create table public.analytics_commercialization_settings (
    singleton boolean primary key default true check (singleton),
    external_product_enabled boolean not null default false check (not external_product_enabled),
    institution_data_agreement_ready boolean not null default false,
    reidentification_risk_review_ready boolean not null default false,
    legal_review_ready boolean not null default false,
    activated_at timestamptz,
    activated_by uuid references auth.users (id) on delete set null,
    updated_at timestamptz not null default now()
);

insert into public.analytics_commercialization_settings (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.waste_log_items
    add column if not exists source_search_event_id uuid
        references public.search_analytics_events (id) on delete set null;

create index search_analytics_events_user_created_idx
    on public.search_analytics_events (user_id, created_at desc, id desc)
    where user_id is not null;
create index search_analytics_events_created_idx
    on public.search_analytics_events (created_at desc, id desc);
create index search_analytics_events_guest_created_idx
    on public.search_analytics_events (guest_subject_id, created_at desc, id desc)
    where guest_subject_id is not null;
create index search_analytics_events_guest_expiry_idx
    on public.search_analytics_events (created_at, id)
    where guest_subject_id is not null;
create index search_analytics_events_lab_created_idx
    on public.search_analytics_events (lab_id, created_at desc, id desc)
    where lab_id is not null;
create index search_analytics_events_query_created_idx
    on public.search_analytics_events (query_normalized, created_at desc, id desc);
create index search_analytics_events_outcome_created_idx
    on public.search_analytics_events (outcome, created_at desc, id desc);
create index search_analytics_events_previous_event_idx
    on public.search_analytics_events (previous_event_id)
    where previous_event_id is not null;
create index search_analytics_events_session_created_idx
    on public.search_analytics_events (session_id, created_at, id);
create index search_analytics_actions_event_created_idx
    on public.search_analytics_actions (event_id, created_at, id);
create index search_analytics_actions_related_event_idx
    on public.search_analytics_actions (related_event_id)
    where related_event_id is not null;
create index search_analytics_actions_type_created_idx
    on public.search_analytics_actions (action_type, created_at desc, id desc);
create index analytics_review_candidates_status_created_idx
    on public.analytics_review_candidates (status, created_at desc, id desc);
create index analytics_review_candidates_reviewer_idx
    on public.analytics_review_candidates (reviewed_by)
    where reviewed_by is not null;
create index analytics_review_audit_candidate_idx
    on public.analytics_review_audit_logs (candidate_id, created_at desc);
create index analytics_review_audit_operator_idx
    on public.analytics_review_audit_logs (operator_user_id, created_at desc)
    where operator_user_id is not null;
create index global_reagent_aliases_active_normalized_idx
    on public.global_reagent_aliases (normalized_alias)
    where is_active;
create index global_reagent_aliases_approver_idx
    on public.global_reagent_aliases (approved_by)
    where approved_by is not null;
create index analytics_export_audits_operator_created_idx
    on public.analytics_export_audits (operator_user_id, created_at desc)
    where operator_user_id is not null;
create index analytics_deletion_audits_created_idx
    on public.analytics_deletion_audits (created_at desc, id desc);
create index waste_log_items_source_search_event_idx
    on public.waste_log_items (source_search_event_id)
    where source_search_event_id is not null;
create index analytics_commercialization_activator_idx
    on public.analytics_commercialization_settings (activated_by)
    where activated_by is not null;
create index waste_logs_analytics_eligible_idx
    on public.waste_logs (created_at desc, id desc)
    where schema_version = 2 and voided_at is null;

create or replace function private.waste_log_item_validate_search_event_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_snapshot_id text;
    v_log_user_id uuid;
    v_log_lab_id uuid;
begin
    v_snapshot_id := nullif(new.analysis_snapshot->>'sourceSearchEventId', '');
    if new.source_search_event_id is null and v_snapshot_id is not null then
        if v_snapshot_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
            raise exception 'sourceSearchEventId must be a UUID' using errcode = '22023';
        end if;
        new.source_search_event_id := v_snapshot_id::uuid;
    end if;

    if new.source_search_event_id is null then
        return new;
    end if;

    select wl.user_id, wl.lab_id
    into v_log_user_id, v_log_lab_id
    from public.waste_logs wl
    where wl.id = new.waste_log_id;

    if not found then
        raise exception 'Waste log does not exist for linked search event' using errcode = '23503';
    end if;

    if not exists (
        select 1
        from public.search_analytics_events event
        where event.id = new.source_search_event_id
          and event.user_id is not null
          and event.outcome = 'matched'
          and event.user_id is not distinct from v_log_user_id
          and event.lab_id is not distinct from v_log_lab_id
    ) then
        raise exception 'Search event is outside the waste log user/lab scope' using errcode = '42501';
    end if;

    return new;
end;
$$;

revoke all on function private.waste_log_item_validate_search_event_link() from public, anon, authenticated;

drop trigger if exists waste_log_items_validate_search_event_link on public.waste_log_items;
create trigger waste_log_items_validate_search_event_link
before insert on public.waste_log_items
for each row
execute function private.waste_log_item_validate_search_event_link();

create or replace function private.delete_search_analytics_for_history_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_event_count integer := 0;
    v_action_count integer := 0;
    v_normalized text;
begin
    v_normalized := private.analytics_normalize_query(old.query);
    if v_normalized is null then
        return old;
    end if;

    select count(*)
    into v_action_count
    from public.search_analytics_actions action
    join public.search_analytics_events event on event.id = action.event_id
    where event.user_id = old.user_id
      and event.query_normalized = v_normalized;

    delete from public.search_analytics_events event
    where event.user_id = old.user_id
      and event.query_normalized = v_normalized;
    get diagnostics v_event_count = row_count;

    if v_event_count > 0 then
        insert into public.analytics_deletion_audits (
            subject_type, reason, deleted_event_count, deleted_action_count
        ) values (
            'authenticated', 'history_item_deleted', v_event_count, v_action_count
        );
    end if;
    return old;
end;
$$;

revoke all on function private.delete_search_analytics_for_history_row() from public, anon, authenticated;

drop trigger if exists user_search_history_delete_analytics on public.user_search_history;
create trigger user_search_history_delete_analytics
before delete on public.user_search_history
for each row
execute function private.delete_search_analytics_for_history_row();

create or replace function private.cleanup_expired_guest_search_analytics()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
    v_event_count integer := 0;
    v_action_count integer := 0;
begin
    select count(*)
    into v_action_count
    from public.search_analytics_actions action
    join public.search_analytics_events event on event.id = action.event_id
    where event.guest_subject_id is not null
      and event.created_at < now() - interval '90 days';

    delete from public.search_analytics_events
    where guest_subject_id is not null
      and created_at < now() - interval '90 days';
    get diagnostics v_event_count = row_count;

    delete from public.search_analytics_guest_subjects subject
    where not exists (
        select 1 from public.search_analytics_events event
        where event.guest_subject_id = subject.id
    );

    if v_event_count > 0 then
        insert into public.analytics_deletion_audits (
            subject_type, reason, deleted_event_count, deleted_action_count
        ) values ('guest', 'guest_expired', v_event_count, v_action_count);
    end if;

    return v_event_count;
end;
$$;

revoke all on function private.cleanup_expired_guest_search_analytics() from public, anon, authenticated;

create or replace function private.refresh_analytics_review_candidates()
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
    v_alias_count integer := 0;
    v_safety_count integer := 0;
begin
    with metrics as (
        select
            event.query_normalized,
            max(event.query_sanitized) as representative_query,
            count(*)::integer as sample_count,
            count(*) filter (where event.outcome = 'no_result')::integer as no_result_count,
            max(next_event.matched_standard_name) filter (where next_event.outcome = 'matched') as canonical_name,
            max(next_event.matched_cas) filter (where next_event.outcome = 'matched') as canonical_cas
        from public.search_analytics_events event
        left join public.search_analytics_actions action
          on action.event_id = event.id and action.action_type = 'query_reformulated'
        left join public.search_analytics_events next_event on next_event.id = action.related_event_id
        where event.created_at >= now() - interval '30 days'
          and event.outcome <> 'technical_error'
        group by event.query_normalized
        having count(*) >= 3
           and (
               count(*) filter (where event.outcome = 'no_result') >= 2
               or count(*) filter (where action.id is not null) >= 2
           )
    )
    insert into public.analytics_review_candidates (
        candidate_type, source_key, title, summary, proposed_alias,
        canonical_name, canonical_cas, evidence, sample_count
    )
    select
        'search_alias',
        metrics.query_normalized,
        '검색 별칭 후보: ' || metrics.representative_query,
        '결과 없음 또는 반복 수정이 누적된 검색어입니다. 승인 전 표준 시약을 확인하세요.',
        metrics.representative_query,
        metrics.canonical_name,
        metrics.canonical_cas,
        jsonb_build_object(
            'noResultCount', metrics.no_result_count,
            'windowDays', 30,
            'automaticDecision', false
        ),
        metrics.sample_count
    from metrics
    where not exists (
        select 1
        from public.analytics_review_candidates decided
        where decided.candidate_type = 'search_alias'
          and decided.source_key = metrics.query_normalized
          and decided.status in ('approved', 'rejected')
    )
    on conflict (candidate_type, source_key) where status = 'pending'
    do update set
        sample_count = excluded.sample_count,
        evidence = excluded.evidence,
        canonical_name = coalesce(excluded.canonical_name, public.analytics_review_candidates.canonical_name),
        canonical_cas = coalesce(excluded.canonical_cas, public.analytics_review_candidates.canonical_cas),
        updated_at = now();
    get diagnostics v_alias_count = row_count;

    with eligible_batches as (
        select wl.id, wl.user_id, wl.lab_id
        from public.waste_logs wl
        where wl.schema_version = 2
          and wl.voided_at is null
          and coalesce(
              wl.confirmation_snapshot->>'mixingState',
              wl.confirmation_snapshot->>'mixing_state',
              case when lower(wl.confirmation_snapshot->>'alreadyMixed') = 'true' then 'already_mixed' end
          ) = 'already_mixed'
          and wl.created_at >= now() - interval '90 days'
    ), components as (
        select
            item.waste_log_id,
            item.line_number,
            coalesce(
                nullif('cas:' || nullif(trim(item.cas_number), ''), 'cas:'),
                'name:' || private.analytics_normalize_query(item.chemical_name)
            ) as component_key,
            item.chemical_name,
            item.hazard_flags
        from public.waste_log_items item
        join eligible_batches batch on batch.id = item.waste_log_id
    ), pairs as (
        select
            least(a.component_key, b.component_key) as component_a_key,
            greatest(a.component_key, b.component_key) as component_b_key,
            case when a.component_key <= b.component_key then a.chemical_name else b.chemical_name end as component_a_name,
            case when a.component_key <= b.component_key then b.chemical_name else a.chemical_name end as component_b_name,
            a.waste_log_id,
            array(select distinct flag from unnest(
                coalesce(a.hazard_flags, array[]::text[]) || coalesce(b.hazard_flags, array[]::text[])
            ) flag) as hazard_flags
        from components a
        join components b on b.waste_log_id = a.waste_log_id and b.line_number > a.line_number
    ), metrics as (
        select
            pair.component_a_key,
            pair.component_b_key,
            max(pair.component_a_name) as component_a_name,
            max(pair.component_b_name) as component_b_name,
            count(distinct pair.waste_log_id)::integer as sample_count,
            array_agg(distinct flag) filter (where flag is not null) as hazard_flags
        from pairs pair
        left join lateral unnest(pair.hazard_flags) flag on true
        group by pair.component_a_key, pair.component_b_key
        having count(distinct pair.waste_log_id) >= 2
    )
    insert into public.analytics_review_candidates (
        candidate_type, source_key, title, summary, evidence, sample_count
    )
    select
        case
            when metrics.hazard_flags && array[
                'OXIDIZER', 'WATER_REACTIVE', 'PYROPHORIC', 'CYANIDE',
                'SULFIDE', 'HYDROFLUORIC_ACID', 'EXPLOSIVE', 'SELF_REACTIVE'
            ]::text[] then 'safety_rule'
            else 'education_content'
        end,
        metrics.component_a_key || '|' || metrics.component_b_key,
        '혼합 검토 후보: ' || metrics.component_a_name || ' + ' || metrics.component_b_name,
        '실제 혼합 빈도만으로 위험을 확정하지 않습니다. 문헌·골든셋·담당자 검토가 필요합니다.',
        jsonb_build_object(
            'componentAKey', metrics.component_a_key,
            'componentBKey', metrics.component_b_key,
            'hazardFlags', to_jsonb(metrics.hazard_flags),
            'automaticRuleChange', false,
            'windowDays', 90
        ),
        metrics.sample_count
    from metrics
    where not exists (
        select 1
        from public.analytics_review_candidates decided
        where decided.candidate_type = case
                when metrics.hazard_flags && array[
                    'OXIDIZER', 'WATER_REACTIVE', 'PYROPHORIC', 'CYANIDE',
                    'SULFIDE', 'HYDROFLUORIC_ACID', 'EXPLOSIVE', 'SELF_REACTIVE'
                ]::text[] then 'safety_rule'
                else 'education_content'
            end
          and decided.source_key = metrics.component_a_key || '|' || metrics.component_b_key
          and decided.status in ('approved', 'rejected')
    )
    on conflict (candidate_type, source_key) where status = 'pending'
    do update set
        sample_count = excluded.sample_count,
        evidence = excluded.evidence,
        updated_at = now();
    get diagnostics v_safety_count = row_count;

    return jsonb_build_object('aliasCandidates', v_alias_count, 'mixtureCandidates', v_safety_count);
end;
$$;

revoke all on function private.refresh_analytics_review_candidates() from public, anon, authenticated;

create or replace function public.analytics_admin_refresh_reviews()
returns jsonb
language sql
volatile
security invoker
set search_path = pg_catalog, public, private
as $$
    select private.refresh_analytics_review_candidates();
$$;

revoke all on function public.analytics_admin_refresh_reviews() from public, anon, authenticated;
grant execute on function public.analytics_admin_refresh_reviews() to service_role;

create or replace function private.rollup_search_batch_analytics(p_month_start date)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
    v_search_count integer := 0;
    v_mixture_count integer := 0;
begin
    with event_flags as (
        select
            event.*,
            exists (
                select 1 from public.search_analytics_actions action
                where action.event_id = event.id
                  and action.action_type = 'query_reformulated'
                  and action.created_at >= event.created_at
                  and action.created_at <= event.created_at + interval '10 minutes'
            ) as reformulated,
            exists (
                select 1 from public.search_analytics_actions action
                where action.event_id = event.id and action.action_type = 'scan_corrected'
            ) as scan_corrected,
            not exists (
                select 1 from public.search_analytics_actions action
                where action.event_id = event.id
                  and action.action_type in ('result_selected', 'added_to_batch', 'query_reformulated')
                  and action.created_at >= event.created_at
                  and action.created_at <= event.created_at + interval '10 minutes'
            ) as unresolved
        from public.search_analytics_events event
        where event.created_at >= p_month_start::timestamptz
          and event.created_at < (p_month_start + interval '1 month')::timestamptz
          and event.outcome <> 'technical_error'
          and event.user_id is not null
          and event.lab_id is not null
    ), metrics as (
        select
            commercial_cohort,
            query_normalized,
            max(query_sanitized) as representative_query,
            count(*)::integer as total_events,
            count(*) filter (where outcome = 'matched')::integer as matched_events,
            count(*) filter (where outcome = 'no_result')::integer as no_result_events,
            count(*) filter (where outcome in ('matched', 'no_result', 'invalid_query'))::integer as valid_events,
            count(distinct user_id)::integer as distinct_users,
            count(distinct lab_id)::integer as distinct_labs,
            avg(reformulated::integer) filter (
                where outcome in ('matched', 'no_result', 'invalid_query')
            )::numeric as reformulation_rate,
            avg(scan_corrected::integer) filter (
                where outcome in ('matched', 'no_result', 'invalid_query')
            )::numeric as scan_correction_rate,
            avg(unresolved::integer) filter (
                where outcome in ('matched', 'no_result', 'invalid_query')
            )::numeric as unresolved_rate
        from event_flags
        group by commercial_cohort, query_normalized
        having count(*) >= 30
           and count(distinct user_id) >= 5
           and count(distinct lab_id) >= 3
    )
    insert into public.analytics_monthly_search_rollups (
        month_start, commercial_cohort, query_normalized, representative_query,
        total_events, matched_events, no_result_events, distinct_users, distinct_labs,
        reformulation_rate, scan_correction_rate, unresolved_rate, confusion_score
    )
    select
        p_month_start,
        metrics.commercial_cohort,
        metrics.query_normalized,
        metrics.representative_query,
        metrics.total_events,
        metrics.matched_events,
        metrics.no_result_events,
        metrics.distinct_users,
        metrics.distinct_labs,
        metrics.reformulation_rate,
        metrics.scan_correction_rate,
        metrics.unresolved_rate,
        100 * (
            0.45 * metrics.no_result_events::numeric / nullif(metrics.valid_events, 0)
            + 0.30 * metrics.reformulation_rate
            + 0.15 * metrics.scan_correction_rate
            + 0.10 * metrics.unresolved_rate
        )
    from metrics
    on conflict do nothing;
    get diagnostics v_search_count = row_count;

    with eligible_batches as (
        select
            wl.id,
            wl.user_id,
            wl.lab_id,
            wl.created_at,
            case
                when exists (
                    select 1
                    from public.waste_log_items linked_item
                    join public.search_analytics_events linked_event
                      on linked_event.id = linked_item.source_search_event_id
                    where linked_item.waste_log_id = wl.id
                      and linked_event.commercial_cohort = 'institution_contract'
                ) then 'institution_contract'
                else 'internal_only'
            end as commercial_cohort,
            case
                when coalesce(wl.confirmation_snapshot->>'measuredBatchPh', wl.confirmation_snapshot->>'measured_batch_ph')
                    ~ '(^[0-9]+([.][0-9]+)?$)|(^[.][0-9]+$)'
                then coalesce(wl.confirmation_snapshot->>'measuredBatchPh', wl.confirmation_snapshot->>'measured_batch_ph')::numeric
            end as measured_ph
        from public.waste_logs wl
        where wl.schema_version = 2
          and wl.voided_at is null
          and wl.created_at >= p_month_start::timestamptz
          and wl.created_at < (p_month_start + interval '1 month')::timestamptz
          and wl.user_id is not null
          and wl.lab_id is not null
          and coalesce(
              wl.confirmation_snapshot->>'mixingState',
              wl.confirmation_snapshot->>'mixing_state',
              case when lower(wl.confirmation_snapshot->>'alreadyMixed') = 'true' then 'already_mixed' end
          ) = 'already_mixed'
    ), components as (
        select
            batch.*,
            item.line_number,
            item.chemical_name,
            coalesce(
                nullif('cas:' || nullif(trim(item.cas_number), ''), 'cas:'),
                'name:' || private.analytics_normalize_query(item.chemical_name)
            ) as component_key,
            item.solution_volume_normalized_ml,
            item.concentration_value,
            item.concentration_unit
        from eligible_batches batch
        join public.waste_log_items item on item.waste_log_id = batch.id
    ), pairs as (
        select
            a.commercial_cohort,
            a.id as waste_log_id,
            a.user_id,
            a.lab_id,
            a.measured_ph,
            least(a.component_key, b.component_key) as component_a_key,
            greatest(a.component_key, b.component_key) as component_b_key,
            case when a.component_key <= b.component_key then a.chemical_name else b.chemical_name end as component_a_name,
            case when a.component_key <= b.component_key then b.chemical_name else a.chemical_name end as component_b_name,
            a.solution_volume_normalized_ml as a_volume,
            b.solution_volume_normalized_ml as b_volume,
            a.concentration_value as a_concentration,
            a.concentration_unit as a_concentration_unit,
            b.concentration_value as b_concentration,
            b.concentration_unit as b_concentration_unit
        from components a
        join components b on b.id = a.id and b.line_number > a.line_number
    ), base_metrics as (
        select
            commercial_cohort,
            component_a_key,
            component_b_key,
            max(component_a_name) as component_a_name,
            max(component_b_name) as component_b_name,
            count(distinct waste_log_id)::integer as batch_count,
            count(distinct user_id)::integer as user_count,
            count(distinct lab_id)::integer as lab_count,
            jsonb_strip_nulls(jsonb_build_object(
                'medianMl', percentile_cont(0.5) within group (order by (coalesce(a_volume, 0) + coalesce(b_volume, 0)))
                    filter (where a_volume is not null or b_volume is not null),
                'q1Ml', percentile_cont(0.25) within group (order by (coalesce(a_volume, 0) + coalesce(b_volume, 0)))
                    filter (where a_volume is not null or b_volume is not null),
                'q3Ml', percentile_cont(0.75) within group (order by (coalesce(a_volume, 0) + coalesce(b_volume, 0)))
                    filter (where a_volume is not null or b_volume is not null),
                'p10Ml', percentile_cont(0.10) within group (order by (coalesce(a_volume, 0) + coalesce(b_volume, 0)))
                    filter (where a_volume is not null or b_volume is not null),
                'p90Ml', percentile_cont(0.90) within group (order by (coalesce(a_volume, 0) + coalesce(b_volume, 0)))
                    filter (where a_volume is not null or b_volume is not null)
            )) as volume_distribution,
            jsonb_strip_nulls(jsonb_build_object(
                'median', percentile_cont(0.5) within group (order by measured_ph),
                'q1', percentile_cont(0.25) within group (order by measured_ph),
                'q3', percentile_cont(0.75) within group (order by measured_ph),
                'p10', percentile_cont(0.10) within group (order by measured_ph),
                'p90', percentile_cont(0.90) within group (order by measured_ph)
            )) as ph_distribution
        from pairs
        group by commercial_cohort, component_a_key, component_b_key
        having count(distinct waste_log_id) >= 10
           and count(distinct user_id) >= 5
           and count(distinct lab_id) >= 3
    ), concentrations as (
        select commercial_cohort, component_a_key, component_b_key, concentration_unit, concentration_value
        from (
            select commercial_cohort, component_a_key, component_b_key,
                a_concentration_unit as concentration_unit, a_concentration as concentration_value
            from pairs
            union all
            select commercial_cohort, component_a_key, component_b_key,
                b_concentration_unit, b_concentration
            from pairs
        ) values_by_unit
        where concentration_unit is not null and concentration_value is not null
    ), concentration_metrics as (
        select
            commercial_cohort,
            component_a_key,
            component_b_key,
            jsonb_object_agg(concentration_unit, distribution) as distributions
        from (
            select
                commercial_cohort,
                component_a_key,
                component_b_key,
                concentration_unit,
                jsonb_build_object(
                    'median', percentile_cont(0.5) within group (order by concentration_value),
                    'q1', percentile_cont(0.25) within group (order by concentration_value),
                    'q3', percentile_cont(0.75) within group (order by concentration_value),
                    'p10', percentile_cont(0.10) within group (order by concentration_value),
                    'p90', percentile_cont(0.90) within group (order by concentration_value)
                ) as distribution
            from concentrations
            group by commercial_cohort, component_a_key, component_b_key, concentration_unit
        ) grouped
        group by commercial_cohort, component_a_key, component_b_key
    )
    insert into public.analytics_monthly_mixture_rollups (
        month_start, commercial_cohort, component_a_key, component_a_name,
        component_b_key, component_b_name, finalized_batch_count,
        distinct_users, distinct_labs, volume_distribution, ph_distribution,
        concentration_distributions
    )
    select
        p_month_start,
        base.commercial_cohort,
        base.component_a_key,
        base.component_a_name,
        base.component_b_key,
        base.component_b_name,
        base.batch_count,
        base.user_count,
        base.lab_count,
        base.volume_distribution,
        base.ph_distribution,
        coalesce(concentration.distributions, '{}'::jsonb)
    from base_metrics base
    left join concentration_metrics concentration
      on concentration.commercial_cohort = base.commercial_cohort
     and concentration.component_a_key = base.component_a_key
     and concentration.component_b_key = base.component_b_key
    on conflict do nothing;
    get diagnostics v_mixture_count = row_count;

    return jsonb_build_object('searchCells', v_search_count, 'mixtureCells', v_mixture_count);
end;
$$;

revoke all on function private.rollup_search_batch_analytics(date) from public, anon, authenticated;

create or replace function public.analytics_review_candidate_decide(
    p_candidate_id uuid,
    p_status text,
    p_notes text,
    p_evidence jsonb,
    p_operator_user_id uuid,
    p_proposed_alias text default null,
    p_canonical_name text default null,
    p_canonical_cas text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
    v_candidate public.analytics_review_candidates%rowtype;
begin
    if p_status not in ('approved', 'rejected') then
        raise exception 'status must be approved or rejected' using errcode = '22023';
    end if;
    if p_operator_user_id is null then
        raise exception 'operator is required' using errcode = '22023';
    end if;
    if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
        raise exception 'evidence must be an object' using errcode = '22023';
    end if;

    select * into v_candidate
    from public.analytics_review_candidates
    where id = p_candidate_id
    for update;

    if not found then
        raise exception 'Review candidate not found' using errcode = 'P0002';
    end if;
    if v_candidate.status <> 'pending' then
        raise exception 'Review candidate has already been decided' using errcode = '22023';
    end if;

    if v_candidate.candidate_type = 'search_alias' then
        v_candidate.proposed_alias := coalesce(
            nullif(trim(p_proposed_alias), ''),
            v_candidate.proposed_alias
        );
        v_candidate.canonical_name := coalesce(
            nullif(trim(p_canonical_name), ''),
            v_candidate.canonical_name
        );
        v_candidate.canonical_cas := coalesce(
            nullif(trim(p_canonical_cas), ''),
            v_candidate.canonical_cas
        );
        if v_candidate.canonical_cas is not null
           and not private.is_valid_cas_number(v_candidate.canonical_cas) then
            raise exception 'Canonical CAS number is invalid' using errcode = '22023';
        end if;
    end if;

    update public.analytics_review_candidates
    set status = p_status,
        proposed_alias = v_candidate.proposed_alias,
        canonical_name = v_candidate.canonical_name,
        canonical_cas = v_candidate.canonical_cas,
        review_notes = nullif(trim(p_notes), ''),
        reviewed_by = p_operator_user_id,
        reviewed_at = now(),
        updated_at = now()
    where id = p_candidate_id
    returning * into v_candidate;

    insert into public.analytics_review_audit_logs (
        candidate_id, action, notes, evidence, operator_user_id
    ) values (
        p_candidate_id, p_status, nullif(trim(p_notes), ''), p_evidence, p_operator_user_id
    );

    if p_status = 'approved' and v_candidate.candidate_type = 'search_alias' then
        if nullif(trim(v_candidate.proposed_alias), '') is null
           or nullif(trim(v_candidate.canonical_name), '') is null then
            raise exception 'Approved alias candidates require an alias and canonical name' using errcode = '22023';
        end if;
        insert into public.global_reagent_aliases (
            alias, normalized_alias, canonical_name, cas_number,
            source_review_id, approved_by
        ) values (
            trim(v_candidate.proposed_alias),
            private.analytics_normalize_query(v_candidate.proposed_alias),
            trim(v_candidate.canonical_name),
            nullif(trim(v_candidate.canonical_cas), ''),
            v_candidate.id,
            p_operator_user_id
        )
        on conflict (normalized_alias) do update set
            alias = excluded.alias,
            canonical_name = excluded.canonical_name,
            cas_number = excluded.cas_number,
            source_review_id = excluded.source_review_id,
            approved_by = excluded.approved_by,
            is_active = true,
            updated_at = now();
    end if;

    return to_jsonb(v_candidate);
end;
$$;

revoke all on function public.analytics_review_candidate_decide(uuid, text, text, jsonb, uuid, text, text, text)
    from public, anon, authenticated;
grant execute on function public.analytics_review_candidate_decide(uuid, text, text, jsonb, uuid, text, text, text)
    to service_role;

create or replace function public.analytics_delete_guest_subject(
    p_guest_subject_id uuid,
    p_delete_token_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    v_event_count integer := 0;
    v_action_count integer := 0;
    v_stored_hash text;
begin
    select delete_token_hash into v_stored_hash
    from public.search_analytics_guest_subjects
    where id = p_guest_subject_id
    for update;

    if not found or v_stored_hash <> p_delete_token_hash then
        raise exception 'Guest analytics subject was not found' using errcode = 'P0002';
    end if;

    select count(*) into v_event_count
    from public.search_analytics_events
    where guest_subject_id = p_guest_subject_id;

    select count(*) into v_action_count
    from public.search_analytics_actions action
    join public.search_analytics_events event on event.id = action.event_id
    where event.guest_subject_id = p_guest_subject_id;

    delete from public.search_analytics_guest_subjects
    where id = p_guest_subject_id;

    insert into public.analytics_deletion_audits (
        subject_type, reason, deleted_event_count, deleted_action_count
    ) values ('guest', 'guest_request', v_event_count, v_action_count);

    return jsonb_build_object(
        'success', true,
        'deletedEvents', v_event_count,
        'deletedActions', v_action_count
    );
end;
$$;

revoke all on function public.analytics_delete_guest_subject(uuid, text) from public, anon, authenticated;
grant execute on function public.analytics_delete_guest_subject(uuid, text) to service_role;

create or replace function public.analytics_delete_user_search(
    p_user_id uuid,
    p_query_normalized text,
    p_delete_all boolean,
    p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    v_event_count integer := 0;
    v_action_count integer := 0;
begin
    if p_user_id is null then
        raise exception 'User is required' using errcode = '22023';
    end if;
    if p_reason not in ('history_item_deleted', 'history_cleared', 'account_deleted') then
        raise exception 'Invalid deletion reason' using errcode = '22023';
    end if;
    if not coalesce(p_delete_all, false) and nullif(trim(p_query_normalized), '') is null then
        raise exception 'Normalized query is required' using errcode = '22023';
    end if;

    select count(*) into v_action_count
    from public.search_analytics_actions action
    join public.search_analytics_events event on event.id = action.event_id
    where event.user_id = p_user_id
      and (coalesce(p_delete_all, false) or event.query_normalized = p_query_normalized);

    delete from public.search_analytics_events event
    where event.user_id = p_user_id
      and (coalesce(p_delete_all, false) or event.query_normalized = p_query_normalized);
    get diagnostics v_event_count = row_count;

    insert into public.analytics_deletion_audits (
        subject_type, reason, deleted_event_count, deleted_action_count
    ) values ('authenticated', p_reason, v_event_count, v_action_count);

    return jsonb_build_object(
        'success', true,
        'deletedEvents', v_event_count,
        'deletedActions', v_action_count
    );
end;
$$;

revoke all on function public.analytics_delete_user_search(uuid, text, boolean, text)
    from public, anon, authenticated;
grant execute on function public.analytics_delete_user_search(uuid, text, boolean, text)
    to service_role;

create or replace function public.analytics_admin_summary(p_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $$
with bounds as (
    select now() - make_interval(days => least(greatest(p_days, 1), 365)) as since
), events as (
    select event.*
    from public.search_analytics_events event, bounds
    where event.created_at >= bounds.since
), batches as (
    select log.*
    from public.waste_logs log, bounds
    where log.created_at >= bounds.since
      and log.schema_version = 2
      and log.voided_at is null
), mixed_batches as (
    select batch.*
    from batches batch
    where coalesce(
        batch.confirmation_snapshot->>'mixingState',
        batch.confirmation_snapshot->>'mixing_state',
        case when lower(batch.confirmation_snapshot->>'alreadyMixed') = 'true' then 'already_mixed' end
    ) = 'already_mixed'
), item_completeness as (
    select
        count(*)::integer as total,
        count(*) filter (where nullif(trim(item.cas_number), '') is not null)::integer as cas_complete,
        count(*) filter (where item.concentration_value is not null and item.concentration_unit is not null)::integer as concentration_complete,
        count(*) filter (where item.solution_volume_normalized_ml is not null)::integer as volume_complete
    from public.waste_log_items item
    join batches batch on batch.id = item.waste_log_id
), daily as (
    select
        date(event.created_at at time zone 'Asia/Seoul') as day,
        count(*)::integer as searches,
        count(*) filter (where event.outcome = 'no_result')::integer as no_results
    from events event
    group by date(event.created_at at time zone 'Asia/Seoul')
    order by day
)
select jsonb_build_object(
    'periodDays', least(greatest(p_days, 1), 365),
    'submittedSearches', (select count(*) from events),
    'uniqueUsers', (
        select count(distinct coalesce('u:' || user_id::text, 'g:' || guest_subject_id::text)) from events
    ),
    'noResultRate', coalesce((
        select round(
            100.0 * count(*) filter (where outcome = 'no_result')
            / nullif(count(*) filter (where outcome in ('matched', 'no_result')), 0),
            2
        ) from events
    ), 0),
    'technicalErrorRate', coalesce((
        select round(100.0 * count(*) filter (where outcome = 'technical_error') / nullif(count(*), 0), 2)
        from events
    ), 0),
    'ingestionRecoveryCount', coalesce((select sum(previous_ingestion_failures) from events), 0),
    'analyticsIngestionFailureRate', coalesce((
        select round(
            100.0 * sum(previous_ingestion_failures)
            / nullif(count(*) + sum(previous_ingestion_failures), 0),
            2
        )
        from events
        where search_channel <> 'legacy'
    ), 0),
    'batchConversionRate', coalesce((
        select round(
            100.0 * count(distinct item.source_search_event_id)
            / nullif(count(*) filter (where event.outcome = 'matched'), 0),
            2
        )
        from events event
        left join public.waste_log_items item on item.source_search_event_id = event.id
    ), 0),
    'finalizedBatches', (select count(*) from batches),
    'mixedBatches', (select count(*) from mixed_batches),
    'dataCompleteness', jsonb_build_object(
        'itemCount', coalesce((select total from item_completeness), 0),
        'casPercent', coalesce((select round(100.0 * cas_complete / nullif(total, 0), 2) from item_completeness), 0),
        'concentrationPercent', coalesce((select round(100.0 * concentration_complete / nullif(total, 0), 2) from item_completeness), 0),
        'volumePercent', coalesce((select round(100.0 * volume_complete / nullif(total, 0), 2) from item_completeness), 0)
    ),
    'dailyTrend', coalesce((
        select jsonb_agg(jsonb_build_object('date', daily.day, 'searches', daily.searches, 'noResults', daily.no_results))
        from daily
    ), '[]'::jsonb)
);
$$;

revoke all on function public.analytics_admin_summary(integer) from public, anon, authenticated;
grant execute on function public.analytics_admin_summary(integer) to service_role;

create or replace function public.analytics_admin_search(
    p_days integer default 90,
    p_limit integer default 100,
    p_order text default 'demand'
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $$
with bounds as (
    select now() - make_interval(days => least(greatest(p_days, 1), 365)) as since
), base as (
    select
        event.*,
        exists (
            select 1 from public.search_analytics_actions action
            where action.event_id = event.id
              and action.action_type = 'query_reformulated'
              and action.created_at >= event.created_at
              and action.created_at <= event.created_at + interval '10 minutes'
        ) as reformulated,
        exists (
            select 1 from public.search_analytics_actions action
            where action.event_id = event.id and action.action_type = 'scan_corrected'
        ) as scan_corrected,
        (
            event.created_at < now() - interval '10 minutes'
            and not exists (
                select 1 from public.search_analytics_actions action
                where action.event_id = event.id
                  and action.action_type in ('result_selected', 'added_to_batch', 'query_reformulated')
                  and action.created_at >= event.created_at
                  and action.created_at <= event.created_at + interval '10 minutes'
            )
        ) as unresolved
    from public.search_analytics_events event, bounds
    where event.created_at >= bounds.since
), metrics as (
    select
        query_normalized,
        max(query_sanitized) as representative_query,
        count(*)::integer as total_events,
        count(*) filter (where created_at >= now() - interval '7 days')::integer as events_7d,
        count(*) filter (where created_at >= now() - interval '30 days')::integer as events_30d,
        count(*) filter (where created_at >= now() - interval '90 days')::integer as events_90d,
        count(*) filter (where outcome = 'matched')::integer as matched_count,
        count(*) filter (where outcome = 'no_result')::integer as no_result_count,
        count(*) filter (where outcome = 'technical_error')::integer as technical_error_count,
        count(*) filter (
            where outcome in ('matched', 'no_result', 'invalid_query') and reformulated
        )::integer as reformulated_count,
        count(*) filter (
            where outcome in ('matched', 'no_result', 'invalid_query') and scan_corrected
        )::integer as scan_corrected_count,
        count(*) filter (
            where outcome in ('matched', 'no_result', 'invalid_query') and unresolved
        )::integer as unresolved_count,
        count(distinct coalesce('u:' || user_id::text, 'g:' || guest_subject_id::text))::integer as subject_count,
        count(*) filter (where outcome in ('matched', 'no_result', 'invalid_query'))::numeric as valid_count
    from base
    group by query_normalized
), scored as (
    select
        metrics.*,
        coalesce(no_result_count / nullif(valid_count, 0), 0) as no_result_rate,
        coalesce(reformulated_count::numeric / nullif(valid_count, 0), 0) as reformulation_rate,
        coalesce(scan_corrected_count::numeric / nullif(valid_count, 0), 0) as scan_correction_rate,
        coalesce(unresolved_count::numeric / nullif(valid_count, 0), 0) as unresolved_rate,
        100 * (
            0.45 * coalesce(no_result_count / nullif(valid_count, 0), 0)
            + 0.30 * coalesce(reformulated_count::numeric / nullif(valid_count, 0), 0)
            + 0.15 * coalesce(scan_corrected_count::numeric / nullif(valid_count, 0), 0)
            + 0.10 * coalesce(unresolved_count::numeric / nullif(valid_count, 0), 0)
        ) as confusion_score
    from metrics
), ranked as (
    select *
    from scored
    order by
        case when p_order = 'confusion' then scored.confusion_score end desc nulls last,
        case when p_order <> 'confusion' then scored.total_events end desc nulls last,
        scored.total_events desc,
        scored.query_normalized
    limit least(greatest(p_limit, 1), 500)
)
select jsonb_build_object(
    'items', coalesce(jsonb_agg(
        jsonb_build_object(
            'query', ranked.representative_query,
            'normalizedQuery', ranked.query_normalized,
            'demandIndex', ranked.total_events,
            'events7d', ranked.events_7d,
            'events30d', ranked.events_30d,
            'events90d', ranked.events_90d,
            'matchedCount', ranked.matched_count,
            'noResultCount', ranked.no_result_count,
            'technicalErrorCount', ranked.technical_error_count,
            'uniqueSubjects', ranked.subject_count,
            'smallSample', ranked.total_events < 10,
            'confusionScore', round(ranked.confusion_score, 2),
            'components', jsonb_build_object(
                'noResultRate', round(100 * ranked.no_result_rate, 2),
                'reformulationRate', round(100 * ranked.reformulation_rate, 2),
                'scanCorrectionRate', round(100 * ranked.scan_correction_rate, 2),
                'unresolvedRate', round(100 * ranked.unresolved_rate, 2)
            ),
            'variants', coalesce((
                select jsonb_agg(variant.query_sanitized order by variant.usage_count desc, variant.query_sanitized)
                from (
                    select event.query_sanitized, count(*) as usage_count
                    from base event
                    where event.query_normalized = ranked.query_normalized
                    group by event.query_sanitized
                    order by count(*) desc, event.query_sanitized
                    limit 10
                ) variant
            ), '[]'::jsonb),
            'resolvedStandards', coalesce((
                select jsonb_agg(resolved.standard_name order by resolved.usage_count desc, resolved.standard_name)
                from (
                    select event.matched_standard_name as standard_name, count(*) as usage_count
                    from base event
                    where event.query_normalized = ranked.query_normalized
                      and event.matched_standard_name is not null
                    group by event.matched_standard_name
                    order by count(*) desc, event.matched_standard_name
                    limit 10
                ) resolved
            ), '[]'::jsonb)
        ) order by
            case when p_order = 'confusion' then ranked.confusion_score end desc nulls last,
            ranked.total_events desc,
            ranked.query_normalized
    ), '[]'::jsonb)
)
from ranked;
$$;

revoke all on function public.analytics_admin_search(integer, integer, text) from public, anon, authenticated;
grant execute on function public.analytics_admin_search(integer, integer, text) to service_role;

create or replace function public.analytics_admin_mixtures(p_days integer default 90, p_limit integer default 100)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $$
with bounds as (
    select now() - make_interval(days => least(greatest(p_days, 1), 365)) as since
), eligible_batches as (
    select
        log.*,
        case
            when coalesce(log.confirmation_snapshot->>'measuredBatchPh', log.confirmation_snapshot->>'measured_batch_ph')
                ~ '(^[0-9]+([.][0-9]+)?$)|(^[.][0-9]+$)'
            then coalesce(log.confirmation_snapshot->>'measuredBatchPh', log.confirmation_snapshot->>'measured_batch_ph')::numeric
        end as measured_ph
    from public.waste_logs log, bounds
    where log.schema_version = 2
      and log.voided_at is null
      and log.created_at >= bounds.since
      and coalesce(
          log.confirmation_snapshot->>'mixingState',
          log.confirmation_snapshot->>'mixing_state',
          case when lower(log.confirmation_snapshot->>'alreadyMixed') = 'true' then 'already_mixed' end
      ) = 'already_mixed'
), components as (
    select
        batch.id as waste_log_id,
        batch.user_id,
        batch.lab_id,
        batch.stream_code,
        batch.handling_action,
        batch.matrix_code,
        batch.measured_ph,
        item.line_number,
        item.chemical_name,
        coalesce(
            nullif('cas:' || nullif(trim(item.cas_number), ''), 'cas:'),
            'name:' || private.analytics_normalize_query(item.chemical_name)
        ) as component_key,
        item.solution_volume_normalized_ml,
        item.concentration_value,
        item.concentration_unit,
        item.hazard_flags,
        item.source_search_event_id
    from eligible_batches batch
    join public.waste_log_items item on item.waste_log_id = batch.id
), pairs as (
    select
        a.waste_log_id,
        a.user_id,
        a.lab_id,
        a.stream_code,
        a.handling_action,
        a.matrix_code,
        a.measured_ph,
        least(a.component_key, b.component_key) as component_a_key,
        greatest(a.component_key, b.component_key) as component_b_key,
        case when a.component_key <= b.component_key then a.chemical_name else b.chemical_name end as component_a_name,
        case when a.component_key <= b.component_key then b.chemical_name else a.chemical_name end as component_b_name,
        a.solution_volume_normalized_ml as a_volume,
        b.solution_volume_normalized_ml as b_volume,
        a.concentration_value as a_concentration,
        a.concentration_unit as a_concentration_unit,
        b.concentration_value as b_concentration,
        b.concentration_unit as b_concentration_unit,
        coalesce(a.hazard_flags, array[]::text[]) || coalesce(b.hazard_flags, array[]::text[]) as hazard_flags,
        (a.source_search_event_id is not null or b.source_search_event_id is not null) as linked_to_search
    from components a
    join components b on b.waste_log_id = a.waste_log_id and b.line_number > a.line_number
), pair_metrics as (
    select
        component_a_key,
        component_b_key,
        max(component_a_name) as component_a_name,
        max(component_b_name) as component_b_name,
        count(distinct waste_log_id)::integer as batch_count,
        count(distinct user_id)::integer as user_count,
        count(distinct lab_id)::integer as lab_count,
        count(distinct waste_log_id) filter (where linked_to_search)::integer as linked_batch_count,
        round((percentile_cont(0.5) within group (order by measured_ph))::numeric, 3) as ph_median,
        round((percentile_cont(0.25) within group (order by measured_ph))::numeric, 3) as ph_q1,
        round((percentile_cont(0.75) within group (order by measured_ph))::numeric, 3) as ph_q3,
        round((percentile_cont(0.10) within group (order by measured_ph))::numeric, 3) as ph_p10,
        round((percentile_cont(0.90) within group (order by measured_ph))::numeric, 3) as ph_p90,
        round((percentile_cont(0.5) within group (
            order by (coalesce(a_volume, 0) + coalesce(b_volume, 0))
        ) filter (where a_volume is not null or b_volume is not null))::numeric, 3) as volume_median,
        round((percentile_cont(0.25) within group (
            order by (coalesce(a_volume, 0) + coalesce(b_volume, 0))
        ) filter (where a_volume is not null or b_volume is not null))::numeric, 3) as volume_q1,
        round((percentile_cont(0.75) within group (
            order by (coalesce(a_volume, 0) + coalesce(b_volume, 0))
        ) filter (where a_volume is not null or b_volume is not null))::numeric, 3) as volume_q3,
        round((percentile_cont(0.10) within group (
            order by (coalesce(a_volume, 0) + coalesce(b_volume, 0))
        ) filter (where a_volume is not null or b_volume is not null))::numeric, 3) as volume_p10,
        round((percentile_cont(0.90) within group (
            order by (coalesce(a_volume, 0) + coalesce(b_volume, 0))
        ) filter (where a_volume is not null or b_volume is not null))::numeric, 3) as volume_p90
    from pairs
    group by component_a_key, component_b_key
    order by count(distinct waste_log_id) desc, component_a_key, component_b_key
    limit least(greatest(p_limit, 1), 500)
), pair_hazards as (
    select
        pair.component_a_key,
        pair.component_b_key,
        jsonb_agg(distinct flag) filter (where flag is not null) as flags
    from pairs pair
    left join lateral unnest(pair.hazard_flags) flag on true
    group by pair.component_a_key, pair.component_b_key
), concentrations as (
    select component_a_key, component_b_key, concentration_unit, concentration_value
    from (
        select component_a_key, component_b_key, a_concentration_unit as concentration_unit, a_concentration as concentration_value
        from pairs
        union all
        select component_a_key, component_b_key, b_concentration_unit, b_concentration
        from pairs
    ) values_by_unit
    where concentration_unit is not null and concentration_value is not null
), concentration_metrics as (
    select
        component_a_key,
        component_b_key,
        jsonb_object_agg(concentration_unit, distribution) as distributions
    from (
        select
            component_a_key,
            component_b_key,
            concentration_unit,
            jsonb_build_object(
                'median', round((percentile_cont(0.5) within group (order by concentration_value))::numeric, 4),
                'q1', round((percentile_cont(0.25) within group (order by concentration_value))::numeric, 4),
                'q3', round((percentile_cont(0.75) within group (order by concentration_value))::numeric, 4),
                'p10', round((percentile_cont(0.10) within group (order by concentration_value))::numeric, 4),
                'p90', round((percentile_cont(0.90) within group (order by concentration_value))::numeric, 4)
            ) as distribution
        from concentrations
        group by component_a_key, component_b_key, concentration_unit
    ) grouped
    group by component_a_key, component_b_key
), stream_distributions as (
    select
        component_a_key,
        component_b_key,
        jsonb_object_agg(coalesce(stream_code, 'unknown'), stream_count) as streams
    from (
        select
            component_a_key,
            component_b_key,
            stream_code,
            count(distinct waste_log_id)::integer as stream_count
        from pairs
        group by component_a_key, component_b_key, stream_code
    ) grouped
    group by component_a_key, component_b_key
), action_distributions as (
    select
        component_a_key,
        component_b_key,
        jsonb_object_agg(coalesce(handling_action, 'unknown'), action_count) as actions
    from (
        select
            component_a_key,
            component_b_key,
            handling_action,
            count(distinct waste_log_id)::integer as action_count
        from pairs
        group by component_a_key, component_b_key, handling_action
    ) grouped
    group by component_a_key, component_b_key
), matrix_distributions as (
    select
        component_a_key,
        component_b_key,
        jsonb_object_agg(coalesce(matrix_code, 'unknown'), matrix_count) as matrices
    from (
        select
            component_a_key,
            component_b_key,
            matrix_code,
            count(distinct waste_log_id)::integer as matrix_count
        from pairs
        group by component_a_key, component_b_key, matrix_code
    ) grouped
    group by component_a_key, component_b_key
), combinations as (
    select
        combination_key,
        max(combination_name) as combination_name,
        count(*)::integer as batch_count
    from (
        select
            component_set.waste_log_id,
            string_agg(component_set.component_key, ' + ' order by component_set.component_key) as combination_key,
            string_agg(component_set.chemical_name, ' + ' order by component_set.component_key) as combination_name
        from (
            select distinct waste_log_id, component_key, chemical_name from components
        ) component_set
        group by component_set.waste_log_id
        having count(*) >= 2
    ) batch_combinations
    group by combination_key
    order by count(*) desc, combination_key
    limit least(greatest(p_limit, 1), 500)
), state_counts as (
    select
        count(*) filter (where coalesce(
            log.confirmation_snapshot->>'mixingState', log.confirmation_snapshot->>'mixing_state'
        ) = 'separate')::integer as separate_count,
        count(*) filter (where coalesce(
            log.confirmation_snapshot->>'mixingState', log.confirmation_snapshot->>'mixing_state', 'unknown'
        ) = 'unknown')::integer as unknown_count
    from public.waste_logs log, bounds
    where log.schema_version = 2 and log.voided_at is null and log.created_at >= bounds.since
), handling_summary as (
    select
        count(*)::integer as total,
        count(*) filter (where handling_action = 'isolated')::integer as isolated,
        count(*) filter (where handling_action = 'handover')::integer as handover
    from eligible_batches
)
select jsonb_build_object(
    'pairs', coalesce((
        select jsonb_agg(jsonb_build_object(
            'componentAKey', metric.component_a_key,
            'componentAName', metric.component_a_name,
            'componentBKey', metric.component_b_key,
            'componentBName', metric.component_b_name,
            'batchCount', metric.batch_count,
            'uniqueUsers', metric.user_count,
            'uniqueLabs', metric.lab_count,
            'searchLinkedBatchCount', metric.linked_batch_count,
            'smallSample', metric.batch_count < 10,
            'phDistribution', jsonb_strip_nulls(jsonb_build_object(
                'median', metric.ph_median, 'q1', metric.ph_q1, 'q3', metric.ph_q3,
                'p10', metric.ph_p10, 'p90', metric.ph_p90
            )),
            'volumeDistributionMl', jsonb_strip_nulls(jsonb_build_object(
                'median', metric.volume_median, 'q1', metric.volume_q1, 'q3', metric.volume_q3,
                'p10', metric.volume_p10, 'p90', metric.volume_p90
            )),
            'concentrationDistributions', coalesce(concentration.distributions, '{}'::jsonb),
            'hazardFlags', coalesce(hazard.flags, '[]'::jsonb),
            'streams', coalesce(stream_distribution.streams, '{}'::jsonb),
            'actions', coalesce(action_distribution.actions, '{}'::jsonb),
            'matrices', coalesce(matrix_distribution.matrices, '{}'::jsonb)
        ) order by metric.batch_count desc, metric.component_a_key, metric.component_b_key)
        from pair_metrics metric
        left join pair_hazards hazard using (component_a_key, component_b_key)
        left join concentration_metrics concentration using (component_a_key, component_b_key)
        left join stream_distributions stream_distribution using (component_a_key, component_b_key)
        left join action_distributions action_distribution using (component_a_key, component_b_key)
        left join matrix_distributions matrix_distribution using (component_a_key, component_b_key)
    ), '[]'::jsonb),
    'combinations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'key', combinations.combination_key,
            'name', combinations.combination_name,
            'batchCount', combinations.batch_count,
            'smallSample', combinations.batch_count < 10
        ) order by combinations.batch_count desc, combinations.combination_key)
        from combinations
    ), '[]'::jsonb),
    'excludedStates', jsonb_build_object(
        'separate', coalesce((select separate_count from state_counts), 0),
        'unknown', coalesce((select unknown_count from state_counts), 0)
    ),
    'handlingSummary', jsonb_build_object(
        'total', coalesce((select total from handling_summary), 0),
        'isolated', coalesce((select isolated from handling_summary), 0),
        'handover', coalesce((select handover from handling_summary), 0),
        'isolatedRate', coalesce((
            select round(100.0 * isolated / nullif(total, 0), 2) from handling_summary
        ), 0),
        'handoverRate', coalesce((
            select round(100.0 * handover / nullif(total, 0), 2) from handling_summary
        ), 0)
    )
);
$$;

revoke all on function public.analytics_admin_mixtures(integer, integer) from public, anon, authenticated;
grant execute on function public.analytics_admin_mixtures(integer, integer) to service_role;

create or replace function public.analytics_admin_governance()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $$
select jsonb_build_object(
    'collection', jsonb_build_object(
        'authenticatedEvents', (select count(*) from public.search_analytics_events where user_id is not null),
        'guestEvents', (select count(*) from public.search_analytics_events where guest_subject_id is not null),
        'guestSubjects', (select count(*) from public.search_analytics_guest_subjects),
        'guestEventsExpiringIn7Days', (
            select count(*) from public.search_analytics_events
            where guest_subject_id is not null
              and created_at < now() - interval '83 days'
        ),
        'oldestGuestEventAt', (
            select min(created_at) from public.search_analytics_events where guest_subject_id is not null
        )
    ),
    'deletions', jsonb_build_object(
        'requestCount', (select count(*) from public.analytics_deletion_audits),
        'deletedEvents', (select coalesce(sum(deleted_event_count), 0) from public.analytics_deletion_audits),
        'deletedActions', (select coalesce(sum(deleted_action_count), 0) from public.analytics_deletion_audits)
    ),
    'exports', jsonb_build_object(
        'count', (select count(*) from public.analytics_export_audits),
        'lastExportAt', (select max(created_at) from public.analytics_export_audits),
        'allAudited', true
    ),
    'monthlyRollups', jsonb_build_object(
        'searchCells', (select count(*) from public.analytics_monthly_search_rollups),
        'mixtureCells', (select count(*) from public.analytics_monthly_mixture_rollups),
        'externalSearchCells', (
            select count(*) from public.analytics_monthly_search_rollups
            where commercial_cohort = 'institution_contract'
        ),
        'externalMixtureCells', (
            select count(*) from public.analytics_monthly_mixture_rollups
            where commercial_cohort = 'institution_contract'
        )
    ),
    'commercialization', jsonb_build_object(
        'externalProductEnabled', (
            select external_product_enabled from public.analytics_commercialization_settings where singleton
        ),
        'institutionDataAgreementReady', (
            select institution_data_agreement_ready from public.analytics_commercialization_settings where singleton
        ),
        'reidentificationRiskReviewReady', (
            select reidentification_risk_review_ready from public.analytics_commercialization_settings where singleton
        ),
        'legalReviewReady', (
            select legal_review_ready from public.analytics_commercialization_settings where singleton
        ),
        'searchThreshold', jsonb_build_object('events', 30, 'users', 5, 'labs', 3),
        'mixtureThreshold', jsonb_build_object('batches', 10, 'users', 5, 'labs', 3),
        'monthlyOnly', true,
        'retroactiveInclusion', false
    ),
    'reviews', jsonb_build_object(
        'pending', (select count(*) from public.analytics_review_candidates where status = 'pending'),
        'approved', (select count(*) from public.analytics_review_candidates where status = 'approved'),
        'rejected', (select count(*) from public.analytics_review_candidates where status = 'rejected')
    )
);
$$;

revoke all on function public.analytics_admin_governance() from public, anon, authenticated;
grant execute on function public.analytics_admin_governance() to service_role;

-- Backfill only the observed successful legacy submission. Outcomes and
-- actions that were never captured are intentionally not inferred.
with sanitized_history as (
    select
        history.*,
        private.analytics_sanitize_legacy_query(history.query) as sanitized_query
    from public.user_search_history history
)
insert into public.search_analytics_events (
    id,
    user_id,
    session_id,
    source_history_id,
    query_sanitized,
    query_normalized,
    query_type,
    search_channel,
    outcome,
    created_at
)
select
    history.id,
    history.user_id,
    gen_random_uuid(),
    history.id,
    history.sanitized_query,
    private.analytics_normalize_query(history.sanitized_query),
    case
        when trim(history.query) ~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$' then 'cas'
        when trim(history.query) ~ '^([A-Z][a-z]?[0-9]*|[()\[\].+\-·]|[0-9]+)+$' then 'formula'
        else 'name'
    end,
    'legacy',
    'legacy_success_unknown',
    history.searched_at
from sanitized_history history
where history.sanitized_query is not null
on conflict (id) do nothing;

alter table public.search_analytics_guest_subjects enable row level security;
alter table public.search_analytics_events enable row level security;
alter table public.search_analytics_actions enable row level security;
alter table public.analytics_review_candidates enable row level security;
alter table public.analytics_review_audit_logs enable row level security;
alter table public.global_reagent_aliases enable row level security;
alter table public.analytics_export_audits enable row level security;
alter table public.analytics_deletion_audits enable row level security;
alter table public.analytics_monthly_search_rollups enable row level security;
alter table public.analytics_monthly_mixture_rollups enable row level security;
alter table public.analytics_commercialization_settings enable row level security;

revoke all on table
    public.search_analytics_guest_subjects,
    public.search_analytics_events,
    public.search_analytics_actions,
    public.analytics_review_candidates,
    public.analytics_review_audit_logs,
    public.global_reagent_aliases,
    public.analytics_export_audits,
    public.analytics_deletion_audits,
    public.analytics_monthly_search_rollups,
    public.analytics_monthly_mixture_rollups,
    public.analytics_commercialization_settings
from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.search_analytics_guest_subjects to service_role;
grant select, insert, delete on table public.search_analytics_events to service_role;
grant select, insert on table public.search_analytics_actions to service_role;
grant select, insert, update on table public.analytics_review_candidates to service_role;
grant select, insert on table public.analytics_review_audit_logs to service_role;
grant select, insert, update on table public.global_reagent_aliases to service_role;
grant select, insert on table public.analytics_export_audits to service_role;
grant select, insert on table public.analytics_deletion_audits to service_role;
grant select, insert on table public.analytics_monthly_search_rollups to service_role;
grant select, insert on table public.analytics_monthly_mixture_rollups to service_role;
grant select on table public.analytics_commercialization_settings to service_role;

-- Service-only, invoker-security RPCs use only these private helpers.
grant usage on schema private to service_role;
grant execute on function private.analytics_normalize_query(text) to service_role;
grant execute on function private.is_valid_cas_number(text) to service_role;
grant execute on function private.refresh_analytics_review_candidates() to service_role;

-- The browser keeps its existing read-only waste-log access, but cannot write
-- the new link directly. Final RPC inserts are validated by the trigger above.
revoke update (source_search_event_id) on public.waste_log_items from anon, authenticated;

select cron.schedule(
    'buril-analytics-guest-expiry',
    '17 3 * * *',
    $cron$select private.cleanup_expired_guest_search_analytics();$cron$
);

select cron.schedule(
    'buril-analytics-review-candidates',
    '42 3 * * *',
    $cron$select private.refresh_analytics_review_candidates();$cron$
);

select cron.schedule(
    'buril-analytics-monthly-rollup',
    '15 2 1 * *',
    $cron$select private.rollup_search_batch_analytics((date_trunc('month', now()) - interval '1 month')::date);$cron$
);

comment on table public.search_analytics_events is
'Server-only submitted-search analytics. No keystrokes, IP addresses, user agents, or browser fingerprints are stored.';
comment on table public.analytics_monthly_search_rollups is
'Irreversible thresholded monthly aggregates. Current API rows remain internal_only and are not externally releasable.';
comment on table public.analytics_monthly_mixture_rollups is
'Thresholded monthly mixture distributions. Never contains individual batch rows.';
comment on column public.waste_log_items.source_search_event_id is
'Optional direct provenance link to the successful submitted search that produced this finalized component; validated to the same user/lab at insert time.';

commit;
