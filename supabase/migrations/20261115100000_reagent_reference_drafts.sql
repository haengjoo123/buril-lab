-- Staging에 version 20261114122715 (reagent_reference_drafts)로 적용된 SQL을 옮긴 파일.
-- 저장소 규칙에 맞춰 트랜잭션과 타임아웃만 덧붙였고 본문 SQL은 같다.
-- 데이터(초안 1,045행, 별칭 초안 40,172행)는 이 파일에 없고 별도로 적재했다.
-- AI 생성 시약 참고 데이터 (초안). 서버 전용. 폐기 판정·보관 경고의 근거로 직접 사용하지 않는다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.reagent_reference_drafts (
    id uuid primary key default gen_random_uuid(),
    source text not null default 'ai_reagentdb' check (char_length(source) between 1 and 100),
    source_reagent_id integer not null,
    prompt_version text not null check (char_length(prompt_version) between 1 and 20),
    cas_number text,
    name_ko text not null check (char_length(name_ko) between 1 and 300),
    name_en text,
    formula text,
    category text,
    storage_group text,
    cabinet text,
    lab_waste_category text,
    waste_matrix text check (waste_matrix is null or waste_matrix = any (array[
        'aqueous','organic_non_halogenated','organic_halogenated','mixed_biphasic','solid_slurry','unknown'])),
    hazard_flags text[] not null default '{}',
    record jsonb not null check (jsonb_typeof(record) = 'object' and octet_length(record::text) <= 262144),
    verify jsonb check (verify is null or jsonb_typeof(verify) = 'object'),
    verify_overall text check (verify_overall is null or verify_overall = any (array['ok','minor','major','critical'])),
    check_status text,
    major_issue_count integer not null default 0 check (major_issue_count >= 0),
    review_status text not null default 'unreviewed'
        check (review_status = any (array['unreviewed','in_review','verified','rejected'])),
    review_notes text,
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source, source_reagent_id, prompt_version)
);
comment on table public.reagent_reference_drafts is
  'AI-generated reagent reference drafts. Unverified unless review_status = verified. Never routing or decision evidence. Server only.';
create index reagent_reference_drafts_cas_idx on public.reagent_reference_drafts (cas_number) where cas_number is not null;
create index reagent_reference_drafts_review_idx on public.reagent_reference_drafts (review_status, major_issue_count desc);
create index reagent_reference_drafts_reviewer_idx on public.reagent_reference_drafts (reviewed_by) where reviewed_by is not null;

create table public.reagent_alias_drafts (
    id uuid primary key default gen_random_uuid(),
    draft_id uuid not null references public.reagent_reference_drafts(id) on delete cascade,
    alias text not null check (char_length(alias) between 1 and 200),
    normalized_alias text not null check (char_length(normalized_alias) between 1 and 200),
    kind text not null check (kind = any (array['ko','en','abbreviations','old_or_trade_names','common_typos'])),
    status text not null default 'candidate' check (status = any (array['candidate','ambiguous','rejected'])),
    reject_reason text,
    created_at timestamptz not null default now(),
    unique (draft_id, normalized_alias)
);
comment on table public.reagent_alias_drafts is
  'AI-generated alias drafts. Not used for search until promoted through analytics_review_candidates. Server only.';
create index reagent_alias_drafts_normalized_idx on public.reagent_alias_drafts (normalized_alias) where status = 'candidate';

-- 앱 검색과 같은 정규화 규칙을 강제
create function private.reagent_alias_drafts_normalize()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
begin
    new.normalized_alias := private.analytics_normalize_query(new.alias);
    return new;
end;
$$;
revoke all on function private.reagent_alias_drafts_normalize() from public, anon, authenticated;
create trigger reagent_alias_drafts_normalize_trg
    before insert or update of alias on public.reagent_alias_drafts
    for each row execute function private.reagent_alias_drafts_normalize();

create function private.reagent_reference_drafts_touch()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger reagent_reference_drafts_touch_trg
    before update on public.reagent_reference_drafts
    for each row execute function private.reagent_reference_drafts_touch();

-- 기존 서버 전용 테이블과 같은 접근 패턴
alter table public.reagent_reference_drafts enable row level security;
alter table public.reagent_alias_drafts enable row level security;
create policy server_only_deny_browser_roles on public.reagent_reference_drafts
    as restrictive for all to anon, authenticated using (false) with check (false);
create policy server_only_deny_browser_roles on public.reagent_alias_drafts
    as restrictive for all to anon, authenticated using (false) with check (false);
revoke all on public.reagent_reference_drafts, public.reagent_alias_drafts from anon, authenticated;
grant select, insert, update, delete on public.reagent_reference_drafts, public.reagent_alias_drafts to service_role;

commit;
