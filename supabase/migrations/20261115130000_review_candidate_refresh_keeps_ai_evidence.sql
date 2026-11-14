-- 검토 후보 갱신(refresh_analytics_review_candidates)이 AI 혼재금지 후보의 근거를 지우지 않게 한다.
-- 실제 혼합 기록에서 같은 쌍('cas:A|cas:B')이 나오면 evidence를 혼합 통계로 바꾸되,
-- 기존 AI 근거는 evidence.aiDraftEvidence로 남긴다. 다른 동작은 그대로다.
--
-- 되돌리기: 20260824000000_production_baseline.sql의 같은 함수 정의를 다시 적용한다
-- (변경점은 혼합 후보 on conflict의 evidence 한 줄뿐이다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.refresh_analytics_review_candidates() RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $$
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
        -- AI 초안이 올린 혼재금지 후보와 같은 쌍이면 AI 근거를 aiDraftEvidence로 보존한다.
        evidence = case
            when coalesce(public.analytics_review_candidates.evidence ->> 'source', '') like 'ai_reagentdb%'
                then excluded.evidence || jsonb_build_object('aiDraftEvidence', public.analytics_review_candidates.evidence)
            when public.analytics_review_candidates.evidence ? 'aiDraftEvidence'
                then excluded.evidence || jsonb_build_object('aiDraftEvidence', public.analytics_review_candidates.evidence -> 'aiDraftEvidence')
            else excluded.evidence
        end,
        updated_at = now();
    get diagnostics v_safety_count = row_count;

    return jsonb_build_object('aliasCandidates', v_alias_count, 'mixtureCandidates', v_safety_count);
end;
$$;

revoke all on function private.refresh_analytics_review_candidates() from public, anon, authenticated;
grant all on function private.refresh_analytics_review_candidates() to service_role;

commit;
