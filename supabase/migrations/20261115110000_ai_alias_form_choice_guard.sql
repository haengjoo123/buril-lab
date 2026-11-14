-- 여러 형태(무수물/수화물/용액, TEA = 트라이에틸아민/트라이에탄올아민/트라이에틸알루미늄)에 걸린
-- 이름은 별칭 하나로 연결하지 않는다. 검색은 /api/chemicals/suggest의 formChoices로 형태를 고르게 하고,
-- 관리자 승인 함수도 이런 키를 global_reagent_aliases에 다시 켜지 못하게 막는다.
-- 되돌리기 (수동):
-- begin;
-- (위 함수 본문에서 '신규:' 블록 4줄을 뺀 이전 정의로 create or replace)
-- drop function if exists private.reagent_alias_is_multi_form_v1(text);
-- drop index if exists public.reagent_alias_drafts_normalized_all_idx;
-- commit;
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 형태 후보 조회용 (기존 인덱스는 status = 'candidate'만 덮는다)
create index if not exists reagent_alias_drafts_normalized_all_idx
    on public.reagent_alias_drafts (normalized_alias);

-- 같은 정규화 이름이 둘 이상의 초안 시약에 걸리는지. 오타 별칭과 형식 오류로 반려된 별칭은 세지 않는다.
create or replace function private.reagent_alias_is_multi_form_v1(p_normalized_alias text)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
    select count(distinct a.draft_id) > 1
    from public.reagent_alias_drafts a
    where a.normalized_alias = p_normalized_alias
      and a.kind <> 'common_typos'
      and (a.reject_reason is null or a.reject_reason like '검수자 지적%');
$$;
revoke all on function private.reagent_alias_is_multi_form_v1(text) from public, anon, authenticated;
grant execute on function private.reagent_alias_is_multi_form_v1(text) to service_role;

create or replace function public.analytics_review_candidate_decide(
    p_candidate_id uuid,
    p_status text,
    p_notes text,
    p_evidence jsonb,
    p_operator_user_id uuid,
    p_proposed_alias text default null::text,
    p_canonical_name text default null::text,
    p_canonical_cas text default null::text
)
returns jsonb
language plpgsql
set search_path to 'pg_catalog', 'public', 'private'
as $function$
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
        -- 신규: 여러 형태에 걸린 이름은 승인으로 한 시약에 묶지 않는다 (반려는 허용)
        if p_status = 'approved'
           and private.reagent_alias_is_multi_form_v1(
                   private.analytics_normalize_query(v_candidate.proposed_alias)) then
            raise exception 'This alias names several reagent forms and stays a form choice in search'
                using errcode = '22023';
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
$function$;
-- create or replace는 기존 권한을 유지한다. 브라우저 role에는 처음부터 없다.
revoke all on function public.analytics_review_candidate_decide(uuid, text, text, jsonb, uuid, text, text, text)
    from public, anon, authenticated;
grant execute on function public.analytics_review_candidate_decide(uuid, text, text, jsonb, uuid, text, text, text)
    to service_role;

commit;
