-- Staging에 version 20261114123806 (ai_alias_bulk_promotion)으로 적용된 SQL을 옮긴 파일.
-- 저장소 규칙에 맞춰 트랜잭션과 타임아웃만 덧붙였고 본문 SQL은 같다.
-- 실제 승격(batch 6d6508a0-2a57-4b5e-a379-0bfd49c6aa8d)과, 여러 형태에 걸린 별칭 215개를
-- is_active=false로 끈 작업은 이 파일 밖에서 데이터 작업으로 실행했다.
-- AI 별칭 일괄 승격 기록 (배치 단위 되돌리기용)
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.reagent_alias_promotions (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null,
    alias_draft_id uuid not null unique references public.reagent_alias_drafts(id) on delete cascade,
    global_alias_id uuid not null references public.global_reagent_aliases(id) on delete cascade,
    promoted_by uuid references auth.users(id) on delete set null,
    promoted_at timestamptz not null default now()
);
comment on table public.reagent_alias_promotions is 'Bulk promotions of AI alias drafts into global_reagent_aliases. Server only.';
create index reagent_alias_promotions_batch_idx on public.reagent_alias_promotions (batch_id);
create index reagent_alias_promotions_global_idx on public.reagent_alias_promotions (global_alias_id);
create index reagent_alias_promotions_promoter_idx on public.reagent_alias_promotions (promoted_by) where promoted_by is not null;
alter table public.reagent_alias_promotions enable row level security;
create policy server_only_deny_browser_roles on public.reagent_alias_promotions
    as restrictive for all to anon, authenticated using (false) with check (false);
revoke all on public.reagent_alias_promotions from anon, authenticated;
grant select, insert, update, delete on public.reagent_alias_promotions to service_role;

-- 일괄 승격: 기존(사람이 승인한) 별칭은 절대 덮어쓰지 않는다
create function private.promote_ai_aliases_v1(
    p_kinds text[] default array['ko','en','abbreviations','old_or_trade_names'],
    p_operator_user_id uuid default null,
    p_dry_run boolean default true
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_batch uuid := gen_random_uuid();
    v_eligible integer;
    v_inserted integer;
begin
    create temp table _eligible on commit drop as
    select a.id as alias_draft_id, trim(a.alias) as alias, a.normalized_alias,
           d.name_ko as canonical_name,
           case when d.cas_number is not null and private.is_valid_cas_number(d.cas_number) then d.cas_number end as cas_number
    from public.reagent_alias_drafts a
    join public.reagent_reference_drafts d on d.id = a.draft_id
    where a.status = 'candidate'
      and a.kind = any (p_kinds)
      and coalesce(d.record -> 'field_confidence' ->> 'identity', '') <> 'low'
      and not exists (select 1 from public.reagent_alias_promotions p where p.alias_draft_id = a.id)
      and not exists (select 1 from public.global_reagent_aliases g where g.normalized_alias = a.normalized_alias);
    select count(*) into v_eligible from _eligible;

    if p_dry_run then
        return jsonb_build_object('dryRun', true, 'eligible', v_eligible,
            'byKind', (select jsonb_object_agg(kind, n) from (
                select a.kind, count(*) n from _eligible e join public.reagent_alias_drafts a on a.id = e.alias_draft_id group by 1) k));
    end if;

    with ins as (
        insert into public.global_reagent_aliases (alias, normalized_alias, canonical_name, cas_number, approved_by, is_active)
        select alias, normalized_alias, canonical_name, cas_number, p_operator_user_id, true from _eligible
        on conflict (normalized_alias) do nothing
        returning id, normalized_alias
    )
    insert into public.reagent_alias_promotions (batch_id, alias_draft_id, global_alias_id, promoted_by)
    select v_batch, e.alias_draft_id, ins.id, p_operator_user_id
    from ins join _eligible e using (normalized_alias);
    get diagnostics v_inserted = row_count;

    return jsonb_build_object('dryRun', false, 'batchId', v_batch, 'eligible', v_eligible, 'promoted', v_inserted);
end;
$$;

-- 배치 되돌리기: 이후 사람이 검토 승인으로 덮어쓴 별칭(source_review_id 있음)은 남긴다
create function private.rollback_ai_alias_promotion_v1(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare v_deleted integer;
begin
    with del as (
        delete from public.global_reagent_aliases g
        using public.reagent_alias_promotions p
        where p.batch_id = p_batch_id and p.global_alias_id = g.id and g.source_review_id is null
        returning g.id
    ) select count(*) into v_deleted from del;
    delete from public.reagent_alias_promotions where batch_id = p_batch_id;
    return jsonb_build_object('batchId', p_batch_id, 'deletedAliases', v_deleted);
end;
$$;

revoke all on function private.promote_ai_aliases_v1(text[], uuid, boolean) from public, anon, authenticated;
revoke all on function private.rollback_ai_alias_promotion_v1(uuid) from public, anon, authenticated;

commit;
