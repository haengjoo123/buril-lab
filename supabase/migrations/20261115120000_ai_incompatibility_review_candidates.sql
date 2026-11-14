-- AI 시약 초안의 혼재금지(incompatibilities) 항목을 관리자 검토 대기열(analytics_review_candidates,
-- candidate_type = 'safety_rule')에 후보로만 올린다. 보관 경고 규칙이나 폐기 판정은 바꾸지 않는다
-- (evidence.automaticRuleChange = false). 대상은 major_issue_count = 0이고 verify_overall이 critical이
-- 아닌 초안, 상대 물질 CAS(with_cas)가 있는 항목뿐이다. source_key는 기존 혼합 후보와 같은
-- 'cas:A|cas:B'(least|greatest) 형식이라 같은 쌍은 하나의 후보로 모인다.
-- 이미 승인·반려된 키는 건너뛰고, 대기 중인 키는 evidence만 보강한다.
-- 되돌리기 (수동):
-- begin;
-- delete from public.analytics_review_candidates
--   where candidate_type = 'safety_rule' and status = 'pending' and evidence->>'source' like 'ai_reagentdb%';
-- update public.analytics_review_candidates set evidence = evidence - 'aiDraftEvidence', updated_at = now()
--   where status = 'pending' and evidence ? 'aiDraftEvidence';
-- drop function if exists private.enqueue_ai_incompatibility_candidates_v1(text[], boolean);
-- drop function if exists private.ai_incompatibility_pairs_v1(text[]);
-- commit;
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 검토 후보가 될 혼재금지 쌍. 읽기 전용.
create or replace function private.ai_incompatibility_pairs_v1(p_severities text[])
returns table (
    source_key text,
    a_key text,
    b_key text,
    source_label text,
    severity text,
    a_name text,
    b_name text,
    draft_ids uuid[],
    first_draft_id uuid,
    reasons text[],
    decided boolean,
    pending_id uuid
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
    with eligible as (
        select d.id, d.source || '_' || d.prompt_version as source_label, d.name_ko, d.cas_number,
               case when jsonb_typeof(d.record -> 'incompatibilities') = 'array'
                    then d.record -> 'incompatibilities' else '[]'::jsonb end as incompatibilities
        from public.reagent_reference_drafts d
        where d.major_issue_count = 0
          and coalesce(d.verify_overall, '') <> 'critical'
          and d.review_status <> 'rejected'
          and d.cas_number is not null
          and private.is_valid_cas_number(d.cas_number)
    ), mentions as (
        select
            e.id as draft_id,
            e.source_label,
            e.name_ko,
            'cas:' || e.cas_number as self_key,
            'cas:' || trim(i ->> 'with_cas') as other_key,
            nullif(trim(i ->> 'with'), '') as other_label,
            nullif(trim(i ->> 'reason'), '') as reason,
            case i ->> 'severity' when '치명' then 3 when '높음' then 2 when '중간' then 1 end as severity_rank
        from eligible e
        cross join lateral jsonb_array_elements(e.incompatibilities) i
        where nullif(trim(i ->> 'with_cas'), '') is not null
          and private.is_valid_cas_number(trim(i ->> 'with_cas'))
          and trim(i ->> 'with_cas') <> e.cas_number
          and i ->> 'severity' in ('치명', '높음', '중간')
    ), names as (
        select distinct on ('cas:' || cas_number) 'cas:' || cas_number as key, name_ko
        from public.reagent_reference_drafts
        where cas_number is not null
        order by 'cas:' || cas_number, (major_issue_count = 0) desc, name_ko
    ), keyed as (
        select least(m.self_key, m.other_key) as a_key, greatest(m.self_key, m.other_key) as b_key, m.*
        from mentions m
    ), grouped as (
        select
            k.a_key || '|' || k.b_key as source_key,
            k.a_key,
            k.b_key,
            min(k.source_label) as source_label,
            (array['중간', '높음', '치명'])[max(k.severity_rank)] as severity,
            -- 초안 자신의 이름 → 초안에 적힌 상대 물질 표현 → 같은 CAS의 다른 초안 이름 순서
            coalesce(max(case when k.self_key = k.a_key then k.name_ko end),
                     max(case when k.other_key = k.a_key then k.other_label end),
                     max(na.name_ko)) as a_name,
            coalesce(max(case when k.self_key = k.b_key then k.name_ko end),
                     max(case when k.other_key = k.b_key then k.other_label end),
                     max(nb.name_ko)) as b_name,
            array_agg(distinct k.draft_id) as draft_ids,
            (array_agg(k.draft_id order by k.severity_rank desc, k.draft_id))[1] as first_draft_id,
            coalesce(array_agg(distinct k.reason) filter (where k.reason is not null), array[]::text[]) as reasons
        from keyed k
        left join names na on na.key = k.a_key
        left join names nb on nb.key = k.b_key
        group by k.a_key, k.b_key
    )
    select
        g.source_key, g.a_key, g.b_key, g.source_label, g.severity, g.a_name, g.b_name,
        g.draft_ids, g.first_draft_id, g.reasons,
        exists (
            select 1 from public.analytics_review_candidates c
            where c.candidate_type = 'safety_rule' and c.source_key = g.source_key
              and c.status in ('approved', 'rejected')) as decided,
        (select c.id from public.analytics_review_candidates c
            where c.candidate_type = 'safety_rule' and c.source_key = g.source_key
              and c.status = 'pending') as pending_id
    from grouped g
    where g.severity = any (p_severities);
$$;
revoke all on function private.ai_incompatibility_pairs_v1(text[]) from public, anon, authenticated;
grant execute on function private.ai_incompatibility_pairs_v1(text[]) to service_role;

create or replace function private.enqueue_ai_incompatibility_candidates_v1(
    p_severities text[] default array['치명'],
    p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_inserted integer := 0;
    v_enriched integer := 0;
    v_result jsonb;
begin
    if p_severities is null or cardinality(p_severities) = 0
       or not p_severities <@ array['치명', '높음', '중간'] then
        raise exception 'severities must be a non-empty subset of 치명, 높음, 중간' using errcode = '22023';
    end if;

    select jsonb_build_object(
        'dryRun', p_dry_run,
        'severities', to_jsonb(p_severities),
        'pairs', count(*),
        'skippedDecided', count(*) filter (where p.decided),
        'newCandidates', count(*) filter (where not p.decided and p.pending_id is null),
        'pendingToEnrich', count(*) filter (where not p.decided and p.pending_id is not null)
    ) into v_result
    from private.ai_incompatibility_pairs_v1(p_severities) p;
    v_result := v_result || jsonb_build_object('bySeverity', coalesce((
        select jsonb_object_agg(s.severity, s.n) from (
            select p.severity, count(*) n from private.ai_incompatibility_pairs_v1(p_severities) p
            where not p.decided group by 1) s), '{}'::jsonb));

    if p_dry_run then
        return v_result;
    end if;

    with ins as (
        insert into public.analytics_review_candidates (
            candidate_type, source_key, title, summary, evidence, sample_count
        )
        select
            'safety_rule',
            p.source_key,
            left('혼재금지 후보: ' || p.a_name || ' + ' || p.b_name, 300),
            left('[' || p.severity || '] '
                 || coalesce(nullif(array_to_string(p.reasons[1:3], ' / '), ''), '사유 없음')
                 || ' (AI 초안 · 검토 전. 승인해도 보관·폐기 규칙은 자동으로 바뀌지 않습니다.)', 2000),
            jsonb_build_object(
                'source', p.source_label,
                'severity', p.severity,
                'draftId', p.first_draft_id,
                'draftIds', to_jsonb(p.draft_ids),
                'reasons', to_jsonb(p.reasons),
                'componentAKey', p.a_key,
                'componentBKey', p.b_key,
                'automaticRuleChange', false
            ),
            cardinality(p.draft_ids)
        from private.ai_incompatibility_pairs_v1(p_severities) p
        where not p.decided
        on conflict (candidate_type, source_key) where status = 'pending'
        do update set
            evidence = case
                when coalesce(public.analytics_review_candidates.evidence ->> 'source', '') like 'ai_reagentdb%'
                    then excluded.evidence
                else public.analytics_review_candidates.evidence
                     || jsonb_build_object('aiDraftEvidence', excluded.evidence)
            end,
            updated_at = now()
        returning (xmax = 0) as inserted
    )
    select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_inserted, v_enriched
    from ins;

    return v_result || jsonb_build_object('inserted', v_inserted, 'enriched', v_enriched);
end;
$$;
revoke all on function private.enqueue_ai_incompatibility_candidates_v1(text[], boolean) from public, anon, authenticated;
grant execute on function private.enqueue_ai_incompatibility_candidates_v1(text[], boolean) to service_role;

commit;
