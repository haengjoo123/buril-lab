-- Waste Disposal V2
--
-- This migration is additive for legacy readers, but deliberately moves all
-- new waste-log mutations behind authenticated RPCs. It does not infer or
-- rewrite classifications for existing rows.

-- Keep the complete V2 rollout atomic. None of the statements in this file
-- use PostgreSQL operations that are forbidden inside a transaction (for
-- example CREATE INDEX CONCURRENTLY or VACUUM).
begin;

set local lock_timeout = '5s';
set local statement_timeout = '15min';

select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('buril:waste-disposal-v2-schema', 0)
);

-- A Supabase migration normally rolls back atomically. This guard also
-- protects operators who previously pasted only part of this migration into
-- the SQL editor: continuing over a half-created V2 contract is less safe than
-- stopping with a diagnostic that requires snapshot review.
do $$
declare
    v_relation_count integer;
    v_function_count integer;
    v_missing_columns text;
begin
    select count(*)
    into v_relation_count
    from unnest(array[
        'public.waste_stream_catalog',
        'public.waste_policy_versions',
        'public.waste_policy_streams',
        'public.waste_policy_lab_overrides',
        'public.waste_log_items',
        'public.inventory_usage_completion_receipts',
        'public.inventory_move_receipts'
    ]::text[]) expected(relation_name)
    where pg_catalog.to_regclass(expected.relation_name) is not null;

    select count(distinct p.proname)
    into v_function_count
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname = any(array[
          'get_active_waste_policy_v2',
          'activate_waste_policy_v2',
          'upsert_lab_waste_stream_override_v2',
          'save_safety_center_waste_policy_draft_v2',
          'actor_display_name_v2',
          'cabinet_visual_width_pct_v2',
          'cabinet_depth_pct_v2',
          'analyze_waste_batch_v2',
          'record_waste_handling_v2',
          'void_waste_log_v2',
          'remove_inventory_record_v2',
          'record_inventory_disposal_v2',
          'record_inventory_usage_completion_v2',
          'move_inventory_records_v2'
      ]::text[]);

    if v_relation_count not in (0, 7)
       or v_function_count not in (0, 14)
       or (v_relation_count = 0) is distinct from (v_function_count = 0) then
        raise exception
            'Partial Waste Disposal V2 schema detected (%/7 relations, %/14 functions). Restore the pre-migration snapshot or complete a reviewed repair before retrying.',
            v_relation_count,
            v_function_count
            using errcode = '55000';
    end if;

    if v_relation_count = 7 then
        select string_agg(required.table_name || '.' || required.column_name, ', ' order by required.table_name, required.column_name)
        into v_missing_columns
        from (values
            ('waste_policy_versions', 'status'),
            ('waste_policy_versions', 'source_refs'),
            ('waste_policy_streams', 'handler_contact'),
            ('waste_policy_streams', 'prohibitions'),
            ('waste_policy_streams', 'label_requirements'),
            ('waste_policy_lab_overrides', 'replacement_location'),
            ('waste_policy_lab_overrides', 'is_disabled'),
            ('waste_log_items', 'analysis_snapshot'),
            ('inventory_usage_completion_receipts', 'receipt'),
            ('inventory_move_receipts', 'receipt')
        ) required(table_name, column_name)
        left join information_schema.columns actual
          on actual.table_schema = 'public'
         and actual.table_name = required.table_name
         and actual.column_name = required.column_name
        where actual.column_name is null;

        if v_missing_columns is not null then
            raise exception
                'Partial Waste Disposal V2 schema detected; required columns are missing: %',
                v_missing_columns
                using errcode = '55000';
        end if;
    end if;
end;
$$;

create table if not exists public.waste_stream_catalog (
    code text primary key,
    display_name_ko text not null,
    display_name_en text not null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    constraint waste_stream_catalog_code_check check (
        code in (
            'ACID_AQUEOUS',
            'ALKALI_AQUEOUS',
            'ORGANIC_HALOGENATED',
            'ORGANIC_NON_HALOGENATED',
            'HEAVY_METAL',
            'CYANIDE_SULFIDE',
            'REACTIVE_OXIDIZER',
            'SOLID_CONTAMINATED',
            'AQUEOUS_OTHER',
            'SPECIAL_REVIEW'
        )
    )
);

create table if not exists public.waste_policy_versions (
    id uuid primary key default gen_random_uuid(),
    policy_key text not null unique,
    scope_type text not null check (scope_type in ('system', 'safety_center', 'lab')),
    safety_center_id uuid references public.safety_centers (id) on delete cascade,
    lab_id uuid references public.labs (id) on delete cascade,
    parent_policy_version_id uuid references public.waste_policy_versions (id) on delete restrict,
    version_label text not null,
    name text not null,
    jurisdiction text not null default 'KR',
    status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
    source_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array'),
    created_by uuid references auth.users (id) on delete set null,
    activated_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    activated_at timestamptz,
    constraint waste_policy_versions_scope_check check (
        (scope_type = 'system' and safety_center_id is null and lab_id is null)
        or (scope_type = 'safety_center' and safety_center_id is not null and lab_id is null)
        or (scope_type = 'lab' and safety_center_id is null and lab_id is not null)
    )
);

create unique index if not exists waste_policy_versions_active_system_idx
    on public.waste_policy_versions (scope_type)
    where scope_type = 'system' and status = 'active';

create unique index if not exists waste_policy_versions_active_center_idx
    on public.waste_policy_versions (safety_center_id)
    where scope_type = 'safety_center' and status = 'active';

create unique index if not exists waste_policy_versions_active_lab_idx
    on public.waste_policy_versions (lab_id)
    where scope_type = 'lab' and status = 'active';

create index if not exists waste_policy_versions_parent_idx
    on public.waste_policy_versions (parent_policy_version_id);

create table if not exists public.waste_policy_streams (
    id uuid primary key default gen_random_uuid(),
    policy_version_id uuid not null references public.waste_policy_versions (id) on delete cascade,
    stream_code text not null references public.waste_stream_catalog (code) on delete restrict,
    display_name_ko text not null,
    display_name_en text not null,
    description_ko text,
    container_label text,
    container_color text,
    location text,
    handler_contact text,
    sop_url text,
    allowed_hazard_flags text[] not null default array[]::text[],
    blocked_hazard_flags text[] not null default array[]::text[],
    prohibitions text[] not null default array[]::text[],
    label_requirements text[] not null default array[]::text[],
    is_enabled boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    unique (policy_version_id, stream_code)
);

create index if not exists waste_policy_streams_stream_code_idx
    on public.waste_policy_streams (stream_code, policy_version_id);

-- Lab overrides contain operational details only. They cannot weaken hazard
-- gates or modify allowed/blocked hazard flags.
create table if not exists public.waste_policy_lab_overrides (
    id uuid primary key default gen_random_uuid(),
    lab_id uuid not null references public.labs (id) on delete cascade,
    stream_code text not null references public.waste_stream_catalog (code) on delete restrict,
    display_name_ko text,
    display_name_en text,
    container_label text,
    container_color text,
    location text,
    handler_contact text,
    replacement_location text,
    is_disabled boolean not null default false,
    created_by uuid references auth.users (id) on delete set null,
    updated_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (lab_id, stream_code)
);

-- SOP references are safety rules owned by the immutable system or
-- institution policy version. A lab may only supply physical, on-site details
-- and must never replace the governing SOP URL.
alter table public.waste_policy_lab_overrides
    drop column if exists sop_url;

create index if not exists waste_policy_lab_overrides_lab_idx
    on public.waste_policy_lab_overrides (lab_id, stream_code);

alter table public.waste_logs
    add column if not exists schema_version integer not null default 1,
    add column if not exists record_origin text not null default 'legacy',
    add column if not exists handling_action text,
    add column if not exists decision_status text not null default 'legacy_unverified',
    add column if not exists stream_code text references public.waste_stream_catalog (code) on delete restrict,
    add column if not exists matrix_code text,
    add column if not exists policy_version_id uuid references public.waste_policy_versions (id) on delete restrict,
    add column if not exists rule_version text,
    add column if not exists total_amount_value numeric,
    add column if not exists total_amount_unit text,
    add column if not exists normalized_amount_value numeric,
    add column if not exists normalized_amount_unit text,
    add column if not exists amount_is_approximate boolean not null default false,
    add column if not exists amount_is_unknown boolean not null default false,
    add column if not exists decision_snapshot jsonb not null default '{}'::jsonb,
    add column if not exists stream_snapshot jsonb not null default '{}'::jsonb,
    add column if not exists confirmation_snapshot jsonb not null default '{}'::jsonb,
    add column if not exists request_id uuid,
    add column if not exists request_payload_hash text,
    add column if not exists request_items_hash text,
    add column if not exists voided_at timestamptz,
    add column if not exists voided_by uuid references auth.users (id) on delete set null,
    add column if not exists void_reason text;

-- The former inventory-deletion RPC stored a recognizable `deleted_location`
-- marker in its chemicals JSON. Classify only that deterministic legacy
-- origin; do not infer a new waste stream or safety decision for old rows.
update public.waste_logs wl
set record_origin = 'legacy_inventory_delete'
where wl.schema_version = 1
  and wl.record_origin = 'legacy'
  and jsonb_typeof(wl.chemicals) = 'array'
  and exists (
      select 1
      from jsonb_array_elements(wl.chemicals) component(value)
      where jsonb_typeof(component.value) = 'object'
        and component.value ? 'deleted_location'
  );

alter table public.waste_logs
    drop constraint if exists waste_logs_schema_version_check,
    add constraint waste_logs_schema_version_check check (schema_version in (1, 2)) not valid,
    drop constraint if exists waste_logs_record_origin_check,
    add constraint waste_logs_record_origin_check check (
        record_origin in (
            'legacy',
            'legacy_inventory_delete',
            'legacy_cabinet_clear',
            'waste_batch',
            'inventory_disposal',
            'import'
        )
    ) not valid,
    drop constraint if exists waste_logs_handling_action_check,
    add constraint waste_logs_handling_action_check check (
        handling_action is null
        or handling_action in ('container_deposit', 'isolated', 'handover')
    ) not valid,
    drop constraint if exists waste_logs_decision_status_check,
    add constraint waste_logs_decision_status_check check (
        decision_status in ('ready', 'needs_input', 'blocked', 'legacy_unverified')
    ) not valid,
    drop constraint if exists waste_logs_matrix_code_check,
    add constraint waste_logs_matrix_code_check check (
        matrix_code is null
        or matrix_code in (
            'aqueous',
            'organic_non_halogenated',
            'organic_halogenated',
            'mixed_biphasic',
            'solid_slurry',
            'unknown'
        )
    ) not valid,
    drop constraint if exists waste_logs_total_amount_unit_check,
    add constraint waste_logs_total_amount_unit_check check (
        total_amount_unit is null or total_amount_unit in ('mL', 'L', 'mg', 'g')
    ) not valid,
    drop constraint if exists waste_logs_normalized_amount_unit_check,
    add constraint waste_logs_normalized_amount_unit_check check (
        normalized_amount_unit is null or normalized_amount_unit in ('mL', 'mg')
    ) not valid,
    drop constraint if exists waste_logs_amount_state_check,
    add constraint waste_logs_amount_state_check check (
        schema_version = 1
        or (
            not (amount_is_unknown and amount_is_approximate)
            and (
                (amount_is_unknown and total_amount_value is null and total_amount_unit is null
                    and normalized_amount_value is null and normalized_amount_unit is null)
                or (
                    not amount_is_unknown
                    and total_amount_value is not null
                    and total_amount_unit is not null
                    and normalized_amount_value is not null
                    and normalized_amount_unit is not null
                    and total_amount_value > 0
                    and normalized_amount_value > 0
                )
            )
        )
    ) not valid,
    drop constraint if exists waste_logs_v2_action_status_check,
    add constraint waste_logs_v2_action_status_check check (
        schema_version = 1
        or (
            handling_action is not null
            and stream_code is not null
            and matrix_code is not null
            and policy_version_id is not null
            and request_id is not null
            and (
                (decision_status = 'ready' and handling_action = 'container_deposit')
                or (decision_status in ('needs_input', 'blocked') and handling_action in ('isolated', 'handover'))
            )
        )
    ) not valid,
    drop constraint if exists waste_logs_void_check,
    add constraint waste_logs_void_check check (
        (voided_at is null and voided_by is null and void_reason is null)
        or (voided_at is not null and voided_by is not null and nullif(trim(void_reason), '') is not null)
    ) not valid,
    drop constraint if exists waste_logs_request_payload_hash_check,
    add constraint waste_logs_request_payload_hash_check check (
        schema_version = 1
        or request_payload_hash ~ '^[0-9a-f]{32}$'
    ) not valid,
    drop constraint if exists waste_logs_request_items_hash_check,
    add constraint waste_logs_request_items_hash_check check (
        (request_items_hash is null or request_items_hash ~ '^[0-9a-f]{32}$')
        and (
            schema_version = 1
            or record_origin <> 'inventory_disposal'
            or request_items_hash is not null
        )
    ) not valid;

alter table public.waste_logs validate constraint waste_logs_schema_version_check;
alter table public.waste_logs validate constraint waste_logs_record_origin_check;
alter table public.waste_logs validate constraint waste_logs_handling_action_check;
alter table public.waste_logs validate constraint waste_logs_decision_status_check;
alter table public.waste_logs validate constraint waste_logs_matrix_code_check;
alter table public.waste_logs validate constraint waste_logs_total_amount_unit_check;
alter table public.waste_logs validate constraint waste_logs_normalized_amount_unit_check;
alter table public.waste_logs validate constraint waste_logs_amount_state_check;
alter table public.waste_logs validate constraint waste_logs_v2_action_status_check;
alter table public.waste_logs validate constraint waste_logs_void_check;
alter table public.waste_logs validate constraint waste_logs_request_payload_hash_check;
alter table public.waste_logs validate constraint waste_logs_request_items_hash_check;

create unique index if not exists waste_logs_user_request_id_uidx
    on public.waste_logs (user_id, request_id)
    where request_id is not null;

create index if not exists waste_logs_decision_status_idx
    on public.waste_logs (decision_status, created_at desc);

create index if not exists waste_logs_stream_code_idx
    on public.waste_logs (stream_code, created_at desc)
    where stream_code is not null;

create table if not exists public.waste_log_items (
    id uuid primary key default gen_random_uuid(),
    waste_log_id uuid not null references public.waste_logs (id) on delete cascade,
    line_number integer not null check (line_number > 0),
    cart_line_id text not null,
    source_type text not null default 'search'
        check (source_type in ('search', 'scan', 'inventory', 'cabinet', 'manual', 'import')),
    source_ref text,
    inventory_item_id uuid references public.inventory (id) on delete set null,
    cabinet_item_id uuid references public.cabinet_items (id) on delete set null,
    chemical_name text not null,
    cas_number text,
    formula text,
    molecular_weight numeric,
    pubchem_cid bigint,
    kosha_chem_id text,
    identity_confidence numeric check (identity_confidence is null or identity_confidence between 0 and 1),
    ghs_data_status text check (
        ghs_data_status is null or ghs_data_status in ('verified', 'lookup_failed', 'not_checked')
    ),
    concentration_value numeric,
    concentration_unit text check (
        concentration_unit is null or concentration_unit in ('M', 'mM', '%', 'mg/mL')
    ),
    hazard_flags text[] not null default array[]::text[],
    data_sources jsonb not null default '[]'::jsonb,
    analysis_snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (waste_log_id, line_number),
    unique (waste_log_id, cart_line_id),
    constraint waste_log_items_concentration_check check (
        (concentration_value is null and concentration_unit is null)
        or (concentration_value is not null and concentration_value > 0 and concentration_unit is not null)
    )
);

create index if not exists waste_log_items_waste_log_id_idx
    on public.waste_log_items (waste_log_id, line_number);

create index if not exists waste_log_items_inventory_item_id_idx
    on public.waste_log_items (inventory_item_id)
    where inventory_item_id is not null;

-- Durable idempotency receipts for the non-waste "used up / empty container"
-- workflow. Inventory and cabinet identifiers intentionally remain as UUID
-- snapshots instead of foreign keys so the receipt survives the final row
-- deletion at quantity zero.
create table if not exists public.inventory_usage_completion_receipts (
    request_id uuid primary key,
    actor_user_id uuid not null,
    lab_id uuid,
    cabinet_item_id uuid not null,
    inventory_item_id uuid not null,
    completion_kind text not null
        check (completion_kind in ('used', 'empty_container')),
    previous_quantity integer not null check (previous_quantity > 0),
    remaining_quantity integer not null check (remaining_quantity >= 0),
    cabinet_item_removed boolean not null,
    inventory_item_removed boolean not null,
    created_at timestamptz not null default now(),
    constraint inventory_usage_completion_receipts_transition_check check (
        remaining_quantity = previous_quantity - 1
    ),
    constraint inventory_usage_completion_receipts_removal_check check (
        cabinet_item_removed = (remaining_quantity = 0)
        and inventory_item_removed = (remaining_quantity = 0)
    )
);

create index if not exists inventory_usage_completion_receipts_actor_idx
    on public.inventory_usage_completion_receipts (actor_user_id, created_at desc);

alter table public.inventory_usage_completion_receipts enable row level security;
revoke all on table public.inventory_usage_completion_receipts from public, anon, authenticated;

create table if not exists public.inventory_move_receipts (
    request_id uuid primary key,
    actor_user_id uuid not null,
    targets_hash text not null check (targets_hash ~ '^[0-9a-f]{32}$'),
    destination_hash text not null check (destination_hash ~ '^[0-9a-f]{32}$'),
    receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
    created_at timestamptz not null default now()
);

create index if not exists inventory_move_receipts_actor_idx
    on public.inventory_move_receipts (actor_user_id, created_at desc);

alter table public.inventory_move_receipts enable row level security;
revoke all on table public.inventory_move_receipts from public, anon, authenticated;

insert into public.waste_stream_catalog (code, display_name_ko, display_name_en, sort_order)
values
    ('ACID_AQUEOUS', '산성 수계 폐액', 'Acidic aqueous waste', 10),
    ('ALKALI_AQUEOUS', '알칼리성 수계 폐액', 'Alkaline aqueous waste', 20),
    ('ORGANIC_HALOGENATED', '할로겐 유기 폐액', 'Halogenated organic waste', 30),
    ('ORGANIC_NON_HALOGENATED', '비할로겐 유기 폐액', 'Non-halogenated organic waste', 40),
    ('HEAVY_METAL', '중금속 함유 폐기물', 'Heavy-metal waste', 50),
    ('CYANIDE_SULFIDE', '시안·황화물 계열', 'Cyanide or sulfide waste', 60),
    ('REACTIVE_OXIDIZER', '반응성·산화성 폐기물', 'Reactive or oxidizing waste', 70),
    ('SOLID_CONTAMINATED', '오염 고체·슬러리', 'Contaminated solid or slurry', 80),
    ('AQUEOUS_OTHER', '기타 수계 폐액', 'Other aqueous waste', 90),
    ('SPECIAL_REVIEW', '분리 보관·특별 검토', 'Isolate and review', 100)
on conflict (code) do update
set display_name_ko = excluded.display_name_ko,
    display_name_en = excluded.display_name_en,
    sort_order = excluded.sort_order;

-- Policy content is immutable by key. Preserve earlier system versions for
-- historical snapshots and retire them before activating this newer source.
update public.waste_policy_versions
set status = 'retired'
where scope_type = 'system'
  and status = 'active'
  and policy_key <> 'buril_kr_default_2026_03';

insert into public.waste_policy_versions (
    policy_key,
    scope_type,
    version_label,
    name,
    jurisdiction,
    status,
    source_refs,
    activated_at
)
values (
    'buril_kr_default_2026_03',
    'system',
    'KR-2026.3',
    '버릴랩 한국 기본 폐기 분류',
    'KR',
    'active',
    jsonb_build_array(
        jsonb_build_object(
            'title', '폐기물관리법 시행규칙 별표 5',
            'url', 'https://www.law.go.kr/flDownload.do?bylClsCd=110201&flSeq=162812925&gubun='
        )
    ),
    now()
)
on conflict (policy_key) do nothing;

insert into public.waste_policy_streams (
    policy_version_id,
    stream_code,
    display_name_ko,
    display_name_en,
    description_ko,
    prohibitions,
    label_requirements,
    sort_order
)
select
    p.id,
    c.code,
    c.display_name_ko,
    c.display_name_en,
    case c.code
        when 'ACID_AQUEOUS' then '산성 수용액을 위한 기본 분류입니다. 실제 폐액통과 위치는 기관 정책을 따릅니다.'
        when 'ALKALI_AQUEOUS' then '알칼리성 수용액을 위한 기본 분류입니다. 실제 폐액통과 위치는 기관 정책을 따릅니다.'
        when 'ORGANIC_HALOGENATED' then '할로겐 함유 유기용매 폐액을 위한 기본 분류입니다.'
        when 'ORGANIC_NON_HALOGENATED' then '비할로겐 유기용매 폐액을 위한 기본 분류입니다.'
        when 'HEAVY_METAL' then '중금속 위험 플래그가 확인된 폐기물을 위한 분류입니다.'
        when 'CYANIDE_SULFIDE' then '산과 접촉하면 유독가스가 발생할 수 있어 분리 취급이 필요한 계열입니다.'
        when 'REACTIVE_OXIDIZER' then '반응성 또는 산화성 위험이 확인된 폐기물을 위한 분류입니다.'
        when 'SOLID_CONTAMINATED' then '오염 고체와 슬러리를 위한 기본 분류입니다.'
        when 'AQUEOUS_OTHER' then '다른 특수 위험으로 분류되지 않은 수계 폐액을 위한 기본 분류입니다.'
        else '일반 폐액통에 바로 넣지 말고 분리 보관 후 기관 담당자에게 인계합니다.'
    end,
    case c.code
        when 'CYANIDE_SULFIDE' then array['산성 폐액과 혼합하지 마세요.']::text[]
        when 'REACTIVE_OXIDIZER' then array['가연성·환원성 폐기물과 임의로 혼합하지 마세요.']::text[]
        when 'SPECIAL_REVIEW' then array['임의로 혼합·중화·희석하거나 배수구에 버리지 마세요.']::text[]
        else array['기관 승인 없이 임의로 중화하거나 배수구에 버리지 마세요.']::text[]
    end,
    array['성분명', '주요 위험', '대략적인 양 또는 양 모름']::text[],
    c.sort_order
from public.waste_policy_versions p
cross join public.waste_stream_catalog c
where p.policy_key = 'buril_kr_default_2026_03'
on conflict (policy_version_id, stream_code) do nothing;

-- RLS and explicit grants are both required. New Supabase projects no longer
-- expose new public tables to the Data API automatically.
alter table public.waste_stream_catalog enable row level security;
alter table public.waste_policy_versions enable row level security;
alter table public.waste_policy_streams enable row level security;
alter table public.waste_policy_lab_overrides enable row level security;
alter table public.waste_log_items enable row level security;
alter table public.waste_logs enable row level security;

drop policy if exists waste_stream_catalog_select_authenticated on public.waste_stream_catalog;
create policy waste_stream_catalog_select_authenticated
    on public.waste_stream_catalog
    for select
    to authenticated
    using ((select auth.uid()) is not null);

drop policy if exists waste_policy_versions_select_accessible on public.waste_policy_versions;
create policy waste_policy_versions_select_accessible
    on public.waste_policy_versions
    for select
    to authenticated
    using (
        (scope_type = 'system' and status = 'active')
        or (
            scope_type = 'safety_center'
            and public.is_safety_center_member(safety_center_id)
            and (
                status = 'active'
                or public.is_safety_center_member(
                    safety_center_id,
                    array['owner', 'manager']::text[]
                )
            )
        )
        or (
            scope_type = 'lab'
            and exists (
                select 1
                from public.lab_members lm
                where lm.lab_id = waste_policy_versions.lab_id
                  and lm.user_id = (select auth.uid())
            )
            and (status = 'active' or public.is_lab_admin(lab_id))
        )
    );

drop policy if exists waste_policy_streams_select_accessible on public.waste_policy_streams;
create policy waste_policy_streams_select_accessible
    on public.waste_policy_streams
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.waste_policy_versions pv
            where pv.id = waste_policy_streams.policy_version_id
              and (
                  (pv.scope_type = 'system' and pv.status = 'active')
                  or (
                      pv.scope_type = 'safety_center'
                      and public.is_safety_center_member(pv.safety_center_id)
                      and (
                          pv.status = 'active'
                          or public.is_safety_center_member(
                              pv.safety_center_id,
                              array['owner', 'manager']::text[]
                          )
                      )
                  )
                  or (
                      pv.scope_type = 'lab'
                      and exists (
                          select 1
                          from public.lab_members lm
                          where lm.lab_id = pv.lab_id
                            and lm.user_id = (select auth.uid())
                      )
                      and (pv.status = 'active' or public.is_lab_admin(pv.lab_id))
                  )
              )
        )
    );

drop policy if exists waste_policy_lab_overrides_select_member on public.waste_policy_lab_overrides;
create policy waste_policy_lab_overrides_select_member
    on public.waste_policy_lab_overrides
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = waste_policy_lab_overrides.lab_id
              and lm.user_id = (select auth.uid())
        )
    );

-- Replace every legacy waste_logs policy with one scope-safe SELECT branch.
-- Mutations are intentionally available only through the RPCs below.
do $$
declare
    v_policy record;
begin
    for v_policy in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = 'waste_logs'
    loop
        execute format('drop policy if exists %I on public.waste_logs', v_policy.policyname);
    end loop;
end;
$$;

create policy waste_logs_select_scoped_v2
    on public.waste_logs
    for select
    to authenticated
    using (
        (select auth.uid()) is not null
        and (
            (lab_id is null and user_id = (select auth.uid()))
            or (
                lab_id is not null
                and exists (
                    select 1
                    from public.lab_members lm
                    where lm.lab_id = waste_logs.lab_id
                      and lm.user_id = (select auth.uid())
                )
            )
        )
    );

drop policy if exists waste_log_items_select_scoped_v2 on public.waste_log_items;
create policy waste_log_items_select_scoped_v2
    on public.waste_log_items
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.waste_logs wl
            where wl.id = waste_log_items.waste_log_id
              and (
                  (wl.lab_id is null and wl.user_id = (select auth.uid()))
                  or (
                      wl.lab_id is not null
                      and exists (
                          select 1
                          from public.lab_members lm
                          where lm.lab_id = wl.lab_id
                            and lm.user_id = (select auth.uid())
                      )
                  )
              )
        )
    );

revoke all on table public.waste_stream_catalog from public, anon, authenticated;
revoke all on table public.waste_policy_versions from public, anon, authenticated;
revoke all on table public.waste_policy_streams from public, anon, authenticated;
revoke all on table public.waste_policy_lab_overrides from public, anon, authenticated;
revoke all on table public.waste_log_items from public, anon, authenticated;
-- Production may carry historical TRUNCATE, REFERENCES, TRIGGER, or MAINTAIN
-- grants in addition to DML. RLS does not protect TRUNCATE, so clear the
-- complete client ACL before restoring the single intended read grant.
revoke all on table public.waste_logs from public, anon, authenticated;

grant select on table public.waste_stream_catalog to authenticated;
grant select on table public.waste_policy_versions to authenticated;
grant select on table public.waste_policy_streams to authenticated;
grant select on table public.waste_policy_lab_overrides to authenticated;
grant select on table public.waste_log_items to authenticated;
grant select on table public.waste_logs to authenticated;

grant all on table public.waste_stream_catalog to service_role;
grant all on table public.waste_policy_versions to service_role;
grant all on table public.waste_policy_streams to service_role;
grant all on table public.waste_policy_lab_overrides to service_role;
grant all on table public.waste_log_items to service_role;
grant all on table public.waste_logs to service_role;

create or replace function public.get_active_waste_policy_v2(
    p_lab_id uuid default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_result jsonb;
    v_institution_policy_count integer;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_lab_id is not null and not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = v_user_id
    ) then
        raise exception 'Access denied for lab %', p_lab_id using errcode = '42501';
    end if;

    -- A lab link must explicitly delegate waste-management policy authority.
    -- Generic summary/risk-detail access is not sufficient to change the
    -- destination policy used for a physical disposal decision.
    select count(distinct pv.id)
    into v_institution_policy_count
    from public.waste_policy_versions pv
    join public.safety_center_lab_links scl
      on scl.center_id = pv.safety_center_id
     and scl.lab_id = p_lab_id
     and scl.status = 'approved'
     and 'waste_management' = any(scl.scope)
    join public.safety_centers sc
      on sc.id = pv.safety_center_id
     and sc.status = 'approved'
    where p_lab_id is not null
      and pv.scope_type = 'safety_center'
      and pv.status = 'active';

    if v_institution_policy_count > 1 then
        raise exception
            'Multiple active safety-center waste policies are linked to lab %; resolve the waste_management policy authority before continuing',
            p_lab_id
            using errcode = 'P0003';
    end if;

    with candidate_versions as (
        select pv.id, pv.scope_type, pv.activated_at, 10 as priority
        from public.waste_policy_versions pv
        where pv.scope_type = 'system'
          and pv.status = 'active'

        union all

        select pv.id, pv.scope_type, pv.activated_at, 20 as priority
        from public.waste_policy_versions pv
        join public.safety_center_lab_links scl
          on scl.center_id = pv.safety_center_id
         and scl.lab_id = p_lab_id
         and scl.status = 'approved'
         and 'waste_management' = any(scl.scope)
        join public.safety_centers sc
          on sc.id = pv.safety_center_id
         and sc.status = 'approved'
        where p_lab_id is not null
          and pv.scope_type = 'safety_center'
          and pv.status = 'active'

    ),
    ranked_streams as (
        select distinct on (ps.stream_code)
            ps.stream_code,
            ps.display_name_ko,
            ps.display_name_en,
            ps.description_ko,
            coalesce(nullif(trim(lo.container_label), ''), ps.container_label) as container_label,
            coalesce(nullif(trim(lo.container_color), ''), ps.container_color) as container_color,
            coalesce(
                nullif(trim(lo.replacement_location), ''),
                nullif(trim(lo.location), ''),
                ps.location
            ) as location,
            coalesce(nullif(trim(lo.handler_contact), ''), ps.handler_contact) as handler_contact,
            ps.container_label as inherited_container_label,
            ps.container_color as inherited_container_color,
            ps.location as inherited_location,
            ps.handler_contact as inherited_handler_contact,
            lo.id as lab_override_id,
            lo.container_label as lab_container_label,
            lo.container_color as lab_container_color,
            lo.location as lab_location,
            lo.handler_contact as lab_handler_contact,
            lo.replacement_location,
            lo.updated_at as lab_override_updated_at,
            ps.sop_url,
            ps.allowed_hazard_flags,
            ps.blocked_hazard_flags,
            ps.prohibitions,
            ps.label_requirements,
            ps.is_enabled,
            coalesce(lo.is_disabled, false) as is_disabled,
            (
                not coalesce(lo.is_disabled, false)
                or nullif(trim(lo.replacement_location), '') is not null
            ) as effective_is_enabled,
            ps.policy_version_id,
            cv.scope_type,
            pv.source_refs,
            cv.priority,
            cv.activated_at,
            ps.sort_order
        from candidate_versions cv
        join public.waste_policy_versions pv on pv.id = cv.id
        join public.waste_policy_streams ps on ps.policy_version_id = cv.id
        left join public.waste_policy_lab_overrides lo
          on lo.lab_id = p_lab_id
         and lo.stream_code = ps.stream_code
        order by
            ps.stream_code,
            cv.priority desc,
            cv.activated_at desc nulls last,
            ps.policy_version_id
    )
    select jsonb_build_object(
        'systemPolicyVersionId', (
            select cv.id
            from candidate_versions cv
            where cv.scope_type = 'system'
            order by cv.activated_at desc nulls last
            limit 1
        ),
        'institutionPolicyVersionId', (
            select cv.id
            from candidate_versions cv
            where cv.scope_type = 'safety_center'
            order by cv.activated_at desc nulls last
            limit 1
        ),
        -- Labs may overlay physical container details, but never activate a
        -- safety-rule policy that outranks the institution/system policy.
        'labPolicyVersionId', null,
        'resolvedStreams', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'streamCode', rs.stream_code,
                    'displayNameKo', rs.display_name_ko,
                    'displayNameEn', rs.display_name_en,
                    'descriptionKo', rs.description_ko,
                    'containerLabel', rs.container_label,
                    'containerColor', rs.container_color,
                    'location', rs.location,
                    'handlerContact', rs.handler_contact,
                    'sopUrl', rs.sop_url,
                    'allowedHazardFlags', to_jsonb(rs.allowed_hazard_flags),
                    'blockedHazardFlags', to_jsonb(rs.blocked_hazard_flags),
                    'prohibitions', to_jsonb(rs.prohibitions),
                    'labelRequirements', to_jsonb(rs.label_requirements),
                    'policyVersionId', rs.policy_version_id,
                    'policyScope', rs.scope_type,
                    'sourceRefs', rs.source_refs,
                    'isEnabled', rs.effective_is_enabled,
                    'inheritedPhysical', jsonb_build_object(
                        'containerLabel', rs.inherited_container_label,
                        'containerColor', rs.inherited_container_color,
                        'location', rs.inherited_location,
                        'handlerContact', rs.inherited_handler_contact
                    ),
                    'labOverride', case
                        when rs.lab_override_id is null then null
                        else jsonb_build_object(
                            'id', rs.lab_override_id,
                            'containerLabel', rs.lab_container_label,
                            'containerColor', rs.lab_container_color,
                            'location', rs.lab_location,
                            'handlerContact', rs.lab_handler_contact,
                            'replacementLocation', rs.replacement_location,
                            'isDisabled', rs.is_disabled,
                            'updatedAt', rs.lab_override_updated_at
                        )
                    end
                )
                order by rs.sort_order, rs.stream_code
            )
            from ranked_streams rs
            where rs.is_enabled
        ), '[]'::jsonb)
    )
    into v_result;

    return v_result;
end;
$$;

create or replace function public.activate_waste_policy_v2(
    p_policy_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_policy public.waste_policy_versions%rowtype;
    v_source_ref jsonb;
    v_unknown_key text;
    v_stream_count integer;
    v_enabled_stream_count integer;
    v_invalid_stream_code text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    select *
    into v_policy
    from public.waste_policy_versions pv
    where pv.id = p_policy_version_id
    for update;

    if not found then
        raise exception 'Waste policy version not found: %', p_policy_version_id using errcode = 'P0002';
    end if;

    if v_policy.scope_type = 'system' then
        raise exception 'System policies can only be activated by a database migration' using errcode = '42501';
    elsif v_policy.scope_type = 'safety_center' then
        if not exists (
            select 1
            from public.safety_centers sc
            where sc.id = v_policy.safety_center_id
              and sc.status = 'approved'
        ) or not public.is_safety_center_member(
            v_policy.safety_center_id,
            array['owner', 'manager']::text[]
        ) then
            raise exception 'Safety-center owner or manager permission is required' using errcode = '42501';
        end if;
    elsif v_policy.scope_type = 'lab' then
        raise exception 'Lab safety-rule policies cannot be activated; use physical stream overrides instead'
            using errcode = '42501';
    end if;

    if v_policy.status <> 'draft' then
        raise exception 'Only a draft policy version can be activated; current status is %', v_policy.status
            using errcode = '22023';
    end if;

    if jsonb_typeof(v_policy.source_refs) <> 'array'
       or jsonb_array_length(v_policy.source_refs) < 1
       or jsonb_array_length(v_policy.source_refs) > 20 then
        raise exception 'An activatable policy requires between 1 and 20 source references'
            using errcode = '22023';
    end if;

    for v_source_ref in select value from jsonb_array_elements(v_policy.source_refs)
    loop
        if jsonb_typeof(v_source_ref) <> 'object' then
            raise exception 'Every source reference must be an object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_source_ref) source_key(key)
        where key not in ('title', 'url')
        limit 1;
        if found then
            raise exception 'Unsupported source reference key: %', v_unknown_key using errcode = '22023';
        end if;

        if not (v_source_ref ? 'title')
           or jsonb_typeof(v_source_ref->'title') <> 'string'
           or nullif(trim(v_source_ref->>'title'), '') is null
           or length(trim(v_source_ref->>'title')) > 500
           or (
               v_source_ref ? 'url'
               and jsonb_typeof(v_source_ref->'url') not in ('string', 'null')
           )
           or (
               nullif(trim(v_source_ref->>'url'), '') is not null
               and (
                   length(trim(v_source_ref->>'url')) > 2000
                   or trim(v_source_ref->>'url') !~ '^https://[^[:space:]]+$'
               )
           ) then
            raise exception 'Each source reference requires a title; a provided URL must use HTTPS'
                using errcode = '22023';
        end if;
    end loop;

    select count(*), count(*) filter (where ps.is_enabled)
    into v_stream_count, v_enabled_stream_count
    from public.waste_policy_streams ps
    where ps.policy_version_id = p_policy_version_id;

    if v_stream_count <> 10 then
        raise exception 'A policy must define exactly 10 waste streams before activation; found %',
            v_stream_count using errcode = '22023';
    end if;

    if v_enabled_stream_count < 1 then
        raise exception 'A policy must have at least one enabled stream before activation' using errcode = '22023';
    end if;

    select ps.stream_code
    into v_invalid_stream_code
    from public.waste_policy_streams ps
    where ps.policy_version_id = p_policy_version_id
      and ps.is_enabled
      and (
          nullif(trim(ps.container_label), '') is null
          or nullif(trim(ps.location), '') is null
          or cardinality(ps.prohibitions) < 1
          or cardinality(ps.label_requirements) < 1
          or exists (
              select 1 from unnest(ps.prohibitions) item(value)
              where nullif(trim(item.value), '') is null
          )
          or exists (
              select 1 from unnest(ps.label_requirements) item(value)
              where nullif(trim(item.value), '') is null
          )
      )
    order by ps.stream_code
    limit 1;
    if found then
        raise exception
            'Enabled stream % requires container_label, location, prohibitions, and label_requirements',
            v_invalid_stream_code
            using errcode = '22023';
    end if;

    select ps.stream_code
    into v_invalid_stream_code
    from public.waste_policy_streams ps
    where ps.policy_version_id = p_policy_version_id
      and ps.stream_code in ('CYANIDE_SULFIDE', 'REACTIVE_OXIDIZER', 'SPECIAL_REVIEW')
      and nullif(trim(ps.handler_contact), '') is null
    order by ps.stream_code
    limit 1;
    if found then
        raise exception 'Special-handling stream % requires handler_contact before activation',
            v_invalid_stream_code using errcode = '22023';
    end if;

    update public.waste_policy_versions
    set status = 'retired'
    where scope_type = 'safety_center'
      and safety_center_id = v_policy.safety_center_id
      and status = 'active'
      and id <> p_policy_version_id;

    update public.waste_policy_versions
    set status = 'active',
        activated_by = v_user_id,
        activated_at = now()
    where id = p_policy_version_id
    returning * into v_policy;

    return jsonb_build_object(
        'id', v_policy.id,
        'policyKey', v_policy.policy_key,
        'scopeType', v_policy.scope_type,
        'status', v_policy.status,
        'activatedAt', v_policy.activated_at,
        'activatedBy', v_policy.activated_by
    );
end;
$$;

-- Remove the earlier seven-argument draft contract so a lab-level caller
-- cannot retain an overload that accepts a policy SOP URL.
drop function if exists public.upsert_lab_waste_stream_override_v2(
    uuid, text, text, text, text, text, text
);
drop function if exists public.upsert_lab_waste_stream_override_v2(
    uuid, text, text, text, text, text
);

create or replace function public.upsert_lab_waste_stream_override_v2(
    p_lab_id uuid,
    p_stream_code text,
    p_container_label text default null,
    p_container_color text default null,
    p_location text default null,
    p_handler_contact text default null,
    p_replacement_location text default null,
    p_is_disabled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_container_label text := nullif(trim(p_container_label), '');
    v_container_color text := nullif(trim(p_container_color), '');
    v_location text := nullif(trim(p_location), '');
    v_handler_contact text := nullif(trim(p_handler_contact), '');
    v_replacement_location text := case
        when coalesce(p_is_disabled, false) then nullif(trim(p_replacement_location), '')
        else null
    end;
    v_is_disabled boolean := coalesce(p_is_disabled, false);
    v_override public.waste_policy_lab_overrides%rowtype;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_lab_admin(p_lab_id) then
        raise exception 'Lab admin permission is required' using errcode = '42501';
    end if;

    if not exists (
        select 1
        from public.waste_stream_catalog c
        where c.code = p_stream_code
    ) then
        raise exception 'Unknown waste stream: %', p_stream_code using errcode = '22023';
    end if;

    if length(coalesce(v_container_label, '')) > 200 then
        raise exception 'container_label must be 200 characters or fewer' using errcode = '22023';
    end if;
    if length(coalesce(v_container_color, '')) > 40
       or (
           v_container_color is not null
           and v_container_color !~ '^(#[0-9A-Fa-f]{6}|[A-Za-z0-9 _-]+)$'
       ) then
        raise exception 'container_color must be a hex color or a short safe label' using errcode = '22023';
    end if;
    if length(coalesce(v_location, '')) > 500 then
        raise exception 'location must be 500 characters or fewer' using errcode = '22023';
    end if;
    if length(coalesce(v_handler_contact, '')) > 300 then
        raise exception 'handler_contact must be 300 characters or fewer' using errcode = '22023';
    end if;
    if length(coalesce(v_replacement_location, '')) > 500 then
        raise exception 'replacement_location must be 500 characters or fewer' using errcode = '22023';
    end if;
    if v_container_label is null
       and v_container_color is null
       and v_location is null
       and v_handler_contact is null
       and v_replacement_location is null
       and not v_is_disabled then
        delete from public.waste_policy_lab_overrides
        where lab_id = p_lab_id
          and stream_code = p_stream_code;

        return jsonb_build_object(
            'id', null,
            'labId', p_lab_id,
            'streamCode', p_stream_code,
            'containerLabel', null,
            'containerColor', null,
            'location', null,
            'handlerContact', null,
            'replacementLocation', null,
            'isDisabled', false,
            'updatedAt', now(),
            'reset', true
        );
    end if;

    insert into public.waste_policy_lab_overrides (
        lab_id,
        stream_code,
        container_label,
        container_color,
        location,
        handler_contact,
        replacement_location,
        is_disabled,
        created_by,
        updated_by,
        updated_at
    ) values (
        p_lab_id,
        p_stream_code,
        v_container_label,
        v_container_color,
        v_location,
        v_handler_contact,
        v_replacement_location,
        v_is_disabled,
        v_user_id,
        v_user_id,
        now()
    )
    on conflict (lab_id, stream_code) do update
    set container_label = excluded.container_label,
        container_color = excluded.container_color,
        location = excluded.location,
        handler_contact = excluded.handler_contact,
        replacement_location = excluded.replacement_location,
        is_disabled = excluded.is_disabled,
        updated_by = v_user_id,
        updated_at = now()
    returning * into v_override;

    return jsonb_build_object(
        'id', v_override.id,
        'labId', v_override.lab_id,
        'streamCode', v_override.stream_code,
        'containerLabel', v_override.container_label,
        'containerColor', v_override.container_color,
        'location', v_override.location,
        'handlerContact', v_override.handler_contact,
        'replacementLocation', v_override.replacement_location,
        'isDisabled', v_override.is_disabled,
        'updatedAt', v_override.updated_at,
        'reset', false
    );
end;
$$;

create or replace function public.save_safety_center_waste_policy_draft_v2(
    p_center_id uuid,
    p_version_label text,
    p_name text,
    p_streams jsonb,
    p_source_refs jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_parent_policy_id uuid;
    v_policy_id uuid := gen_random_uuid();
    v_policy_key text;
    v_stream jsonb;
    v_source_ref jsonb;
    v_stream_code text;
    v_seen_stream_codes text[] := array[]::text[];
    v_unknown_key text;
    v_allowed_flags jsonb;
    v_blocked_flags jsonb;
    v_prohibitions jsonb;
    v_label_requirements jsonb;
    v_sop_url text;
    v_is_enabled boolean;
    v_sort_order integer;
    v_catalog record;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if p_center_id is null then
        raise exception 'center_id is required' using errcode = '22023';
    end if;
    if nullif(trim(p_version_label), '') is null or length(trim(p_version_label)) > 100 then
        raise exception 'version_label is required and must be 100 characters or fewer'
            using errcode = '22023';
    end if;
    if nullif(trim(p_name), '') is null or length(trim(p_name)) > 200 then
        raise exception 'name is required and must be 200 characters or fewer'
            using errcode = '22023';
    end if;
    if p_streams is null
       or jsonb_typeof(p_streams) <> 'array'
       or jsonb_array_length(p_streams) < 1
       or jsonb_array_length(p_streams) > 10 then
        raise exception 'streams must contain between 1 and 10 records' using errcode = '22023';
    end if;
    if p_source_refs is null
       or jsonb_typeof(p_source_refs) <> 'array'
       or jsonb_array_length(p_source_refs) > 20 then
        raise exception 'source_refs must be an array with at most 20 records' using errcode = '22023';
    end if;
    if octet_length(p_streams::text) > 262144
       or octet_length(p_source_refs::text) > 65536 then
        raise exception 'policy draft payload is too large' using errcode = '22023';
    end if;

    if not exists (
        select 1
        from public.safety_centers sc
        where sc.id = p_center_id
          and sc.status = 'approved'
    ) then
        raise exception 'Approved safety center not found: %', p_center_id using errcode = '42501';
    end if;
    if not public.is_safety_center_member(
        p_center_id,
        array['owner', 'manager']::text[]
    ) then
        raise exception 'Safety-center owner or manager permission is required' using errcode = '42501';
    end if;

    for v_source_ref in select value from jsonb_array_elements(p_source_refs)
    loop
        if jsonb_typeof(v_source_ref) <> 'object' then
            raise exception 'Every source reference must be an object' using errcode = '22023';
        end if;
        select key
        into v_unknown_key
        from jsonb_object_keys(v_source_ref) source_key(key)
        where key not in ('title', 'url')
        limit 1;
        if found then
            raise exception 'Unsupported source reference key: %', v_unknown_key using errcode = '22023';
        end if;
        if not (v_source_ref ? 'title')
           or jsonb_typeof(v_source_ref->'title') <> 'string'
           or nullif(trim(v_source_ref->>'title'), '') is null
           or length(trim(v_source_ref->>'title')) > 500
           or (
               v_source_ref ? 'url'
               and jsonb_typeof(v_source_ref->'url') not in ('string', 'null')
           )
           or (
               nullif(trim(v_source_ref->>'url'), '') is not null
               and (
                   length(trim(v_source_ref->>'url')) > 2000
                   or trim(v_source_ref->>'url') !~ '^https://[^[:space:]]+$'
               )
           ) then
            raise exception 'Each source reference requires a title; a provided URL must use HTTPS'
                using errcode = '22023';
        end if;
    end loop;

    -- Validate the complete stream set before inserting any row.
    for v_stream in select value from jsonb_array_elements(p_streams)
    loop
        if jsonb_typeof(v_stream) <> 'object' then
            raise exception 'Every policy stream must be an object' using errcode = '22023';
        end if;
        select key
        into v_unknown_key
        from jsonb_object_keys(v_stream) stream_key(key)
        where key not in (
            'streamCode', 'displayNameKo', 'displayNameEn', 'descriptionKo',
            'containerLabel', 'containerColor', 'location', 'handlerContact',
            'sopUrl', 'allowedHazardFlags', 'blockedHazardFlags',
            'prohibitions', 'labelRequirements', 'isEnabled', 'sortOrder'
        )
        limit 1;
        if found then
            raise exception 'Unsupported policy stream key: %', v_unknown_key using errcode = '22023';
        end if;

        v_stream_code := v_stream->>'streamCode';
        select c.* into v_catalog
        from public.waste_stream_catalog c
        where c.code = v_stream_code;
        if not found then
            raise exception 'Unknown waste stream code: %', v_stream_code using errcode = '22023';
        end if;
        if v_stream_code = any(v_seen_stream_codes) then
            raise exception 'Duplicate policy stream code: %', v_stream_code using errcode = '22023';
        end if;
        v_seen_stream_codes := array_append(v_seen_stream_codes, v_stream_code);

        if length(coalesce(v_stream->>'displayNameKo', '')) > 200
           or length(coalesce(v_stream->>'displayNameEn', '')) > 200
           or length(coalesce(v_stream->>'descriptionKo', '')) > 2000
           or length(coalesce(v_stream->>'containerLabel', '')) > 200
           or length(coalesce(v_stream->>'containerColor', '')) > 100
           or length(coalesce(v_stream->>'location', '')) > 500
           or length(coalesce(v_stream->>'handlerContact', '')) > 500 then
            raise exception 'Policy stream text field exceeds its length limit' using errcode = '22023';
        end if;

        v_sop_url := nullif(trim(v_stream->>'sopUrl'), '');
        if v_sop_url is not null
           and (length(v_sop_url) > 2000 or v_sop_url !~ '^https://[^[:space:]]+$') then
            raise exception 'sopUrl must be an HTTPS URL' using errcode = '22023';
        end if;

        v_allowed_flags := coalesce(v_stream->'allowedHazardFlags', '[]'::jsonb);
        v_blocked_flags := coalesce(v_stream->'blockedHazardFlags', '[]'::jsonb);
        if jsonb_typeof(v_allowed_flags) <> 'array'
           or jsonb_typeof(v_blocked_flags) <> 'array'
           or jsonb_array_length(v_allowed_flags) > 32
           or jsonb_array_length(v_blocked_flags) > 32
           or exists (
               select 1
               from jsonb_array_elements(v_allowed_flags || v_blocked_flags) flag(value)
               where jsonb_typeof(flag.value) <> 'string'
                  or flag.value #>> '{}' not in (
                      'FLAMMABLE', 'OXIDIZER', 'EXPLOSIVE', 'SELF_REACTIVE',
                      'WATER_REACTIVE', 'PYROPHORIC', 'CORROSIVE', 'ACUTE_TOXIC',
                      'CMR', 'ENVIRONMENTAL_HAZARD', 'CYANIDE', 'SULFIDE',
                      'HEAVY_METAL', 'REACTIVE', 'UNKNOWN_COMPONENT'
                  )
           ) then
            raise exception 'Policy hazard flags are invalid' using errcode = '22023';
        end if;
        if exists (
            select 1
            from jsonb_array_elements_text(v_allowed_flags) allowed(flag)
            join jsonb_array_elements_text(v_blocked_flags) blocked(flag) using (flag)
        ) then
            raise exception 'A hazard flag cannot be both allowed and blocked' using errcode = '22023';
        end if;

        v_prohibitions := coalesce(v_stream->'prohibitions', '[]'::jsonb);
        v_label_requirements := coalesce(v_stream->'labelRequirements', '[]'::jsonb);
        if jsonb_typeof(v_prohibitions) <> 'array'
           or jsonb_typeof(v_label_requirements) <> 'array'
           or jsonb_array_length(v_prohibitions) > 20
           or jsonb_array_length(v_label_requirements) > 20
           or exists (
               select 1
               from jsonb_array_elements(v_prohibitions || v_label_requirements) entry(value)
               where jsonb_typeof(entry.value) <> 'string'
                  or length(entry.value #>> '{}') > 500
           ) then
            raise exception 'Policy instruction arrays are invalid' using errcode = '22023';
        end if;

        if v_stream ? 'isEnabled'
           and jsonb_typeof(v_stream->'isEnabled') <> 'boolean' then
            raise exception 'isEnabled must be boolean' using errcode = '22023';
        end if;
        if v_stream ? 'sortOrder'
           and (v_stream->>'sortOrder' !~ '^[0-9]+$'
                or (v_stream->>'sortOrder')::numeric > 10000) then
            raise exception 'sortOrder must be an integer between 0 and 10000'
                using errcode = '22023';
        end if;
    end loop;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('safety-center-policy-draft:' || p_center_id::text, 0)
    );

    select pv.id
    into v_parent_policy_id
    from public.waste_policy_versions pv
    where pv.scope_type = 'safety_center'
      and pv.safety_center_id = p_center_id
      and pv.status = 'active'
    order by pv.activated_at desc nulls last, pv.created_at desc
    limit 1;

    if v_parent_policy_id is null then
        select pv.id
        into v_parent_policy_id
        from public.waste_policy_versions pv
        where pv.scope_type = 'system'
          and pv.status = 'active'
        order by pv.activated_at desc nulls last, pv.created_at desc
        limit 1;
    end if;
    if v_parent_policy_id is null then
        raise exception 'No active parent waste policy is available' using errcode = 'P0002';
    end if;

    v_policy_key := 'safety_center_' || replace(p_center_id::text, '-', '')
        || '_' || replace(v_policy_id::text, '-', '');

    insert into public.waste_policy_versions (
        id, policy_key, scope_type, safety_center_id,
        parent_policy_version_id, version_label, name, jurisdiction,
        status, source_refs, created_by
    ) values (
        v_policy_id, v_policy_key, 'safety_center', p_center_id,
        v_parent_policy_id, trim(p_version_label), trim(p_name), 'KR',
        'draft', p_source_refs, v_user_id
    );

    for v_stream in select value from jsonb_array_elements(p_streams)
    loop
        v_stream_code := v_stream->>'streamCode';
        select c.* into v_catalog
        from public.waste_stream_catalog c
        where c.code = v_stream_code;
        v_allowed_flags := coalesce(v_stream->'allowedHazardFlags', '[]'::jsonb);
        v_blocked_flags := coalesce(v_stream->'blockedHazardFlags', '[]'::jsonb);
        v_prohibitions := coalesce(v_stream->'prohibitions', '[]'::jsonb);
        v_label_requirements := coalesce(v_stream->'labelRequirements', '[]'::jsonb);
        v_is_enabled := coalesce((v_stream->>'isEnabled')::boolean, true);
        v_sort_order := coalesce((v_stream->>'sortOrder')::integer, v_catalog.sort_order);

        insert into public.waste_policy_streams (
            policy_version_id, stream_code, display_name_ko, display_name_en,
            description_ko, container_label, container_color, location,
            handler_contact, sop_url, allowed_hazard_flags,
            blocked_hazard_flags, prohibitions, label_requirements,
            is_enabled, sort_order
        ) values (
            v_policy_id,
            v_stream_code,
            coalesce(nullif(trim(v_stream->>'displayNameKo'), ''), v_catalog.display_name_ko),
            coalesce(nullif(trim(v_stream->>'displayNameEn'), ''), v_catalog.display_name_en),
            nullif(trim(v_stream->>'descriptionKo'), ''),
            nullif(trim(v_stream->>'containerLabel'), ''),
            nullif(trim(v_stream->>'containerColor'), ''),
            nullif(trim(v_stream->>'location'), ''),
            nullif(trim(v_stream->>'handlerContact'), ''),
            nullif(trim(v_stream->>'sopUrl'), ''),
            array(select jsonb_array_elements_text(v_allowed_flags)),
            array(select jsonb_array_elements_text(v_blocked_flags)),
            array(select jsonb_array_elements_text(v_prohibitions)),
            array(select jsonb_array_elements_text(v_label_requirements)),
            v_is_enabled,
            v_sort_order
        );
    end loop;

    return jsonb_build_object(
        'id', v_policy_id,
        'centerId', p_center_id,
        'policyKey', v_policy_key,
        'versionLabel', trim(p_version_label),
        'status', 'draft',
        'streamCount', jsonb_array_length(p_streams),
        'parentPolicyVersionId', v_parent_policy_id
    );
end;
$$;

-- Pure server-side safety derivation used by the privileged recorder. Keeping
-- this helper in an unexposed schema prevents clients from substituting a
-- forged ready/stream/hazard snapshot for the deterministic result.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.is_valid_cas_number(p_cas text)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
    v_cas text := trim(p_cas);
    v_body text;
    v_reversed text;
    v_check_digit integer;
    v_sum integer := 0;
    v_position integer;
begin
    -- CAS Registry Numbers contain 2..7 digits, two digits, and one checksum
    -- digit. The checksum is the reversed body weighted by 1..n modulo 10.
    if v_cas !~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$' then
        return false;
    end if;

    v_body := replace(left(v_cas, length(v_cas) - 2), '-', '');
    v_reversed := reverse(v_body);
    v_check_digit := right(v_cas, 1)::integer;

    for v_position in 1..length(v_reversed)
    loop
        v_sum := v_sum
            + substring(v_reversed from v_position for 1)::integer * v_position;
    end loop;

    return (v_sum % 10) = v_check_digit;
end;
$$;

revoke all on function private.is_valid_cas_number(text)
    from public, anon, authenticated;

create or replace function private.actor_display_name_v2(
    p_user_id uuid,
    p_lab_id uuid
)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $$
    select coalesce(
        case when p_lab_id is not null then (
            select nullif(trim(lm.nickname), '')
            from public.lab_members lm
            where lm.lab_id = p_lab_id
              and lm.user_id = p_user_id
        ) end,
        (
            select coalesce(
                nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
                nullif(trim(u.raw_user_meta_data->>'name'), ''),
                nullif(trim(u.email), '')
            )
            from auth.users u
            where u.id = p_user_id
        )
    )
$$;

revoke all on function private.actor_display_name_v2(uuid, uuid)
    from public, anon, authenticated;

create or replace function private.cabinet_visual_width_pct_v2(
    p_template text,
    p_width numeric,
    p_cabinet_width numeric
)
returns numeric
language sql
immutable
strict
set search_path = pg_catalog
as $$
    select (
        case p_template when 'A' then 0.44 when 'B' then 0.50
            when 'C' then 0.44 when 'D' then 0.50 end
        * (p_width / case p_template when 'A' then 8 when 'B' then 10
            when 'C' then 8 when 'D' then 10 end)
        / p_cabinet_width
    ) * 100
$$;

create or replace function private.cabinet_depth_pct_v2(
    p_template text,
    p_width numeric,
    p_cabinet_depth numeric
)
returns numeric
language sql
immutable
strict
set search_path = pg_catalog
as $$
    select (
        case p_template when 'A' then 0.44 when 'B' then 0.35
            when 'C' then 0.44 when 'D' then 0.44 end
        * (p_width / case p_template when 'A' then 8 when 'B' then 10
            when 'C' then 8 when 'D' then 10 end)
        / p_cabinet_depth
    ) * 100
$$;

revoke all on function private.cabinet_visual_width_pct_v2(text, numeric, numeric)
    from public, anon, authenticated;
revoke all on function private.cabinet_depth_pct_v2(text, numeric, numeric)
    from public, anon, authenticated;

create or replace function private.analyze_waste_batch_v2(
    p_components jsonb,
    p_matrix text,
    p_confirmation jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
    v_component jsonb;
    v_analysis jsonb;
    v_ghs jsonb;
    v_claimed_flags jsonb;
    v_claimed_flag text;
    v_hcode text;
    v_hcodes text[];
    v_category text;
    v_name text;
    v_cas text;
    v_formula text;
    v_formula_normalized text;
    v_identity_text text;
    v_identity_confidence numeric;
    v_ghs_data_status text;
    v_hazard_data_confirmed boolean;
    v_hazard_data_needs_input boolean := false;
    v_component_is_acid boolean;
    v_component_is_alkali boolean;
    v_component_is_cyanide boolean;
    v_component_is_sulfide boolean;
    v_component_is_reactive boolean;
    v_component_is_special boolean;
    v_component_is_heavy_metal boolean;
    v_component_is_organic_halogen boolean;
    v_component_is_organic_non_halogen boolean;
    v_has_acid boolean := false;
    v_has_alkali boolean := false;
    v_has_cyanide boolean := false;
    v_has_sulfide boolean := false;
    v_has_reactive boolean := false;
    v_has_special boolean := false;
    v_has_heavy_metal boolean := false;
    v_has_organic_halogen boolean := false;
    v_has_organic_non_halogen boolean := false;
    v_has_unknown boolean := false;
    v_identity_needs_input boolean := false;
    v_server_flags text[] := array[]::text[];
    v_blocking_codes text[] := array[]::text[];
    v_missing_fields text[] := array[]::text[];
    v_server_stream text;
    v_server_status text;
    v_measured_ph_status text;
    v_measured_ph_text text;
    v_measured_ph numeric;
    v_additional_components_status text;
    v_incident_context text;
begin
    if p_components is null
       or jsonb_typeof(p_components) <> 'array'
       or jsonb_array_length(p_components) < 1
       or jsonb_array_length(p_components) > 100 then
        raise exception 'components must contain between 1 and 100 items' using errcode = '22023';
    end if;

    if p_matrix not in (
        'aqueous', 'organic_non_halogenated', 'organic_halogenated',
        'mixed_biphasic', 'solid_slurry', 'unknown'
    ) then
        raise exception 'Unsupported matrix: %', p_matrix using errcode = '22023';
    end if;

    if p_confirmation is null or jsonb_typeof(p_confirmation) <> 'object' then
        raise exception 'confirmation snapshot must be a JSON object' using errcode = '22023';
    end if;

    if not (p_confirmation ? 'incidentContext')
       and not (p_confirmation ? 'incident_context') then
        raise exception 'confirmationSnapshot.incidentContext is required'
            using errcode = '22023';
    end if;
    if (p_confirmation ? 'incidentContext'
            and jsonb_typeof(p_confirmation->'incidentContext') <> 'string')
       or (p_confirmation ? 'incident_context'
            and jsonb_typeof(p_confirmation->'incident_context') <> 'string') then
        raise exception 'incidentContext must be one of none, broken, or leak'
            using errcode = '22023';
    end if;
    if p_confirmation ? 'incidentContext'
       and p_confirmation ? 'incident_context'
       and p_confirmation->>'incidentContext' is distinct from p_confirmation->>'incident_context' then
        raise exception 'Conflicting incidentContext aliases are not allowed'
            using errcode = '22023';
    end if;
    v_incident_context := coalesce(
        p_confirmation->>'incidentContext',
        p_confirmation->>'incident_context'
    );
    if v_incident_context not in ('none', 'broken', 'leak') then
        raise exception 'incidentContext must be one of none, broken, or leak'
            using errcode = '22023';
    end if;

    -- The canonical client serializes an unanswered optional field as JSON
    -- null. Treat that exactly like an omitted key, while continuing to reject
    -- every non-null value outside the closed enum below.
    if (p_confirmation ? 'additionalComponentsStatus'
            and jsonb_typeof(p_confirmation->'additionalComponentsStatus') not in ('string', 'null'))
       or (p_confirmation ? 'additional_components_status'
            and jsonb_typeof(p_confirmation->'additional_components_status') not in ('string', 'null')) then
        raise exception 'additionalComponentsStatus must be one of none, present, or unknown'
            using errcode = '22023';
    end if;
    if p_confirmation->>'additionalComponentsStatus' is not null
       and p_confirmation->>'additional_components_status' is not null
       and p_confirmation->>'additionalComponentsStatus'
           is distinct from p_confirmation->>'additional_components_status' then
        raise exception 'Conflicting additionalComponentsStatus aliases are not allowed'
            using errcode = '22023';
    end if;
    v_additional_components_status := coalesce(
        p_confirmation->>'additionalComponentsStatus',
        p_confirmation->>'additional_components_status'
    );
    if v_additional_components_status is not null
       and v_additional_components_status not in ('none', 'present', 'unknown') then
        raise exception 'additionalComponentsStatus must be one of none, present, or unknown'
            using errcode = '22023';
    end if;

    for v_component in select value from jsonb_array_elements(p_components)
    loop
        if jsonb_typeof(v_component) <> 'object' then
            raise exception 'Every component must be a JSON object' using errcode = '22023';
        end if;

        v_analysis := coalesce(
            nullif(v_component->'analysisSnapshot', 'null'::jsonb),
            nullif(v_component->'analysis_snapshot', 'null'::jsonb),
            '{}'::jsonb
        );
        if jsonb_typeof(v_analysis) <> 'object' then
            raise exception 'component analysisSnapshot must be an object' using errcode = '22023';
        end if;

        v_ghs_data_status := coalesce(
            v_component->>'ghsDataStatus',
            v_component->>'ghs_data_status'
        );
        if v_ghs_data_status not in ('verified', 'lookup_failed', 'not_checked') then
            raise exception 'component ghsDataStatus must be verified, lookup_failed, or not_checked'
                using errcode = '22023';
        end if;
        if (v_analysis ? 'hazardDataConfirmedByUser'
                and jsonb_typeof(v_analysis->'hazardDataConfirmedByUser') <> 'boolean')
           or (v_analysis ? 'hazard_data_confirmed_by_user'
                and jsonb_typeof(v_analysis->'hazard_data_confirmed_by_user') <> 'boolean') then
            raise exception 'hazardDataConfirmedByUser must be boolean' using errcode = '22023';
        end if;
        v_hazard_data_confirmed := coalesce(
            (v_analysis->>'hazardDataConfirmedByUser')::boolean,
            (v_analysis->>'hazard_data_confirmed_by_user')::boolean,
            false
        );
        if v_ghs_data_status <> 'verified' and not v_hazard_data_confirmed then
            v_hazard_data_needs_input := true;
        end if;

        v_category := upper(coalesce(nullif(trim(v_analysis->>'category'), ''), 'UNKNOWN'));
        if v_category not in (
            'ACID', 'ALKALI', 'NEUTRAL', 'ORGANIC_HALOGEN',
            'ORGANIC_NON_HALOGEN', 'HEAVY_METAL', 'CYANIDE',
            'REACTIVE', 'SOLID_WASTE', 'SPECIAL_HAZARD', 'UNKNOWN'
        ) then
            raise exception 'Unsupported component analysis category: %', v_category using errcode = '22023';
        end if;

        v_name := trim(coalesce(
            v_component->>'chemicalName',
            v_component->>'chemical_name',
            v_component->>'name',
            ''
        ));
        v_cas := trim(coalesce(v_component->>'casNumber', v_component->>'cas_number', ''));
        if v_cas <> '' and not private.is_valid_cas_number(v_cas) then
            raise exception 'Invalid CAS Registry Number: %', v_cas using errcode = '22023';
        end if;
        v_formula := trim(coalesce(v_component->>'formula', ''));
        v_formula_normalized := upper(regexp_replace(v_formula, '[[:space:]]', '', 'g'));
        v_formula_normalized := regexp_replace(
            v_formula_normalized,
            '\((AQ|S|L|G)\)$',
            '',
            'i'
        );

        v_ghs := coalesce(nullif(v_analysis->'ghs', 'null'::jsonb), '{}'::jsonb);
        if jsonb_typeof(v_ghs) <> 'object' then
            raise exception 'analysisSnapshot.ghs must be an object or null' using errcode = '22023';
        end if;

        select coalesce(array_agg(distinct matches.code order by matches.code), array[]::text[])
        into v_hcodes
        from (
            select matched[1] as code
            from regexp_matches(
                upper(v_ghs::text || ' ' || coalesce(v_analysis->'hCodes', '[]'::jsonb)::text),
                '(H[0-9]{3})',
                'g'
            ) as matched
        ) matches;

        v_claimed_flags := coalesce(
            nullif(v_component->'hazardFlags', 'null'::jsonb),
            nullif(v_component->'hazard_flags', 'null'::jsonb),
            '[]'::jsonb
        );
        if jsonb_typeof(v_claimed_flags) <> 'array'
           or jsonb_array_length(v_claimed_flags) > 32 then
            raise exception 'component hazardFlags must contain at most 32 values' using errcode = '22023';
        end if;

        for v_claimed_flag in select jsonb_array_elements_text(v_claimed_flags)
        loop
            if v_claimed_flag not in (
                'FLAMMABLE', 'OXIDIZER', 'EXPLOSIVE', 'SELF_REACTIVE',
                'WATER_REACTIVE', 'PYROPHORIC', 'CORROSIVE', 'ACUTE_TOXIC',
                'CMR', 'ENVIRONMENTAL_HAZARD', 'CYANIDE', 'SULFIDE',
                'HEAVY_METAL', 'REACTIVE', 'UNKNOWN_COMPONENT'
            ) then
                raise exception 'component hazardFlags contains an unsupported value' using errcode = '22023';
            end if;
            v_server_flags := array_append(v_server_flags, v_claimed_flag);
        end loop;

        if v_hcodes && array['H220','H221','H222','H223','H224','H225','H226','H227','H228']::text[] then
            v_server_flags := array_append(v_server_flags, 'FLAMMABLE');
        end if;
        if v_hcodes && array['H270','H271','H272']::text[] then
            v_server_flags := array_append(v_server_flags, 'OXIDIZER');
        end if;
        if v_hcodes && array['H200','H201','H202','H203','H204','H205']::text[] then
            v_server_flags := array_append(v_server_flags, 'EXPLOSIVE');
        end if;
        if v_hcodes && array['H240','H241','H242']::text[] then
            v_server_flags := array_append(v_server_flags, 'SELF_REACTIVE');
        end if;
        if v_hcodes && array['H260','H261']::text[] then
            v_server_flags := array_append(v_server_flags, 'WATER_REACTIVE');
        end if;
        if v_hcodes && array['H250']::text[] then
            v_server_flags := array_append(v_server_flags, 'PYROPHORIC');
        end if;
        if v_hcodes && array['H290','H314']::text[] then
            v_server_flags := array_append(v_server_flags, 'CORROSIVE');
        end if;
        if v_hcodes && array['H300','H301','H310','H311','H330','H331']::text[] then
            v_server_flags := array_append(v_server_flags, 'ACUTE_TOXIC');
        end if;
        if v_hcodes && array['H340','H341','H350','H351','H360','H361','H362']::text[] then
            v_server_flags := array_append(v_server_flags, 'CMR');
        end if;
        if v_hcodes && array['H400','H410','H411','H412','H413']::text[] then
            v_server_flags := array_append(v_server_flags, 'ENVIRONMENTAL_HAZARD');
        end if;

        v_component_is_acid := v_category = 'ACID'
            or v_cas in ('7647-01-0','7664-93-9','7697-37-2','7664-38-2','64-19-7','64-18-6')
            or v_formula_normalized in ('HCL','HBR','HI','HF','H2SO4','HNO3','H3PO4','HCLO4','CH3COOH','HCOOH')
            or v_name ~* '(hydrochloric acid|sulfuric acid|sulphuric acid|nitric acid|phosphoric acid|perchloric acid|acetic acid|formic acid|염산|황산|질산|인산|과염소산|아세트산|개미산|불산)';
        v_component_is_alkali := v_category = 'ALKALI';
        v_component_is_cyanide := v_category = 'CYANIDE'
            or v_cas in ('143-33-9','151-50-8','74-90-8')
            or v_formula_normalized in ('HCN','NACN','KCN','LICN','CA(CN)2')
            or v_name ~* '(cyanide|cyanid|시안화|시안|청산)';
        v_component_is_sulfide := v_cas in ('1313-82-2','1312-73-8','7783-06-4')
            or v_formula_normalized in ('NA2S','K2S','FES','H2S')
            or v_name ~* '(sulfide|sulphide|황화)';
        v_component_is_reactive := v_category = 'REACTIVE'
            or v_hcodes && array[
                'H200','H201','H202','H203','H204','H205','H206','H207','H208',
                'H240','H241','H242','H250','H251','H252','H260','H261',
                'H270','H271','H272'
            ]::text[]
            or v_formula_normalized in ('HNO3','HCLO4','NABH4','LIALH4','NAH','KH','LIH','CAH2')
            or v_name ~* '(peroxide|superoxide|hydroperoxide|nitrate|nitrite|hypochlorite|chlorate|perchlorate|permanganate|persulfate|azide|diazomethane|hydrazine|picric acid|borohydride|butyllithium|organolithium|sodium metal|potassium metal)';
        v_component_is_special := v_category = 'SPECIAL_HAZARD'
            or (
                v_hcodes && array['H300','H310','H330']::text[]
                and not v_component_is_reactive
                and not v_component_is_cyanide
                and not v_component_is_sulfide
            );
        v_component_is_heavy_metal := v_category = 'HEAVY_METAL'
            or v_formula ~ '(Ag|Cd|Pb|Hg|Cr|As|Ni|Cu|Zn|Ba|Be|Co|Mn|Os|Sb|Tl|Pd|Pt|Rh|Ru|Ir|Au|Sn|Se|Mo|V)';
        v_component_is_organic_halogen := v_category = 'ORGANIC_HALOGEN'
            or (v_formula ~ 'C([0-9]|[A-Z]|$)' and v_formula ~ '(F|Cl|Br|I)');
        v_component_is_organic_non_halogen := v_category = 'ORGANIC_NON_HALOGEN';

        if v_component_is_cyanide then
            v_server_flags := array_append(v_server_flags, 'CYANIDE');
        end if;
        if v_component_is_sulfide then
            v_server_flags := array_append(v_server_flags, 'SULFIDE');
        end if;
        if v_component_is_heavy_metal then
            v_server_flags := array_append(v_server_flags, 'HEAVY_METAL');
        end if;
        if v_component_is_reactive or v_component_is_special then
            v_server_flags := array_append(v_server_flags, 'REACTIVE');
        end if;
        if v_category = 'UNKNOWN' then
            v_server_flags := array_append(v_server_flags, 'UNKNOWN_COMPONENT');
            v_has_unknown := true;
        end if;

        v_identity_text := nullif(coalesce(
            v_component->>'identityConfidence',
            v_component->>'identity_confidence'
        ), '');
        if v_identity_text is null
           or v_identity_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$' then
            v_identity_needs_input := true;
        else
            v_identity_confidence := v_identity_text::numeric;
            if v_identity_confidence < 1 then
                v_identity_needs_input := true;
            end if;
        end if;

        v_has_acid := v_has_acid or v_component_is_acid;
        v_has_alkali := v_has_alkali or v_component_is_alkali;
        v_has_cyanide := v_has_cyanide or v_component_is_cyanide;
        v_has_sulfide := v_has_sulfide or v_component_is_sulfide;
        v_has_reactive := v_has_reactive or v_component_is_reactive;
        v_has_special := v_has_special or v_component_is_special;
        v_has_heavy_metal := v_has_heavy_metal or v_component_is_heavy_metal;
        v_has_organic_halogen := v_has_organic_halogen or v_component_is_organic_halogen;
        v_has_organic_non_halogen := v_has_organic_non_halogen or v_component_is_organic_non_halogen;
    end loop;

    select coalesce(array_agg(distinct flag order by flag), array[]::text[])
    into v_server_flags
    from unnest(v_server_flags) as derived(flag);

    if v_has_acid and v_has_cyanide then
        v_blocking_codes := array_append(v_blocking_codes, 'acid_cyanide');
    end if;
    if v_has_acid and v_has_sulfide then
        v_blocking_codes := array_append(v_blocking_codes, 'acid_sulfide');
    end if;
    if 'OXIDIZER' = any(v_server_flags) and 'FLAMMABLE' = any(v_server_flags) then
        v_blocking_codes := array_append(v_blocking_codes, 'oxidizer_flammable');
    end if;
    if 'WATER_REACTIVE' = any(v_server_flags)
       and p_matrix in ('aqueous', 'mixed_biphasic') then
        v_blocking_codes := array_append(v_blocking_codes, 'water_reactive_aqueous');
    end if;
    if 'EXPLOSIVE' = any(v_server_flags) or 'SELF_REACTIVE' = any(v_server_flags) then
        v_blocking_codes := array_append(v_blocking_codes, 'explosive_or_self_reactive');
    end if;
    if 'PYROPHORIC' = any(v_server_flags) then
        v_blocking_codes := array_append(v_blocking_codes, 'pyrophoric');
    end if;
    if v_has_special then
        v_blocking_codes := array_append(v_blocking_codes, 'special_hazard');
    end if;
    if v_has_reactive or 'REACTIVE' = any(v_server_flags) then
        v_blocking_codes := array_append(v_blocking_codes, 'reactive_waste');
    end if;
    if v_incident_context in ('broken', 'leak') then
        v_blocking_codes := array_append(
            v_blocking_codes,
            'physical_incident_' || v_incident_context
        );
    end if;

    v_measured_ph_status := coalesce(
        p_confirmation->>'measuredPhStatus',
        p_confirmation->>'measured_ph_status'
    );
    v_measured_ph_text := coalesce(
        p_confirmation->>'measuredPh',
        p_confirmation->>'measured_ph'
    );
    if v_measured_ph_status = 'measured' then
        if v_measured_ph_text is null
           or v_measured_ph_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$' then
            raise exception 'Measured pH must be a number between 0 and 14' using errcode = '22023';
        end if;
        v_measured_ph := v_measured_ph_text::numeric;
        if v_measured_ph < 0 or v_measured_ph > 14 then
            raise exception 'Measured pH must be a number between 0 and 14' using errcode = '22023';
        end if;
    end if;

    -- Broken containers and leaks are incident-response records, not ordinary
    -- stream deposits. Keep the server stream aligned with the shared client
    -- rule so no matrix-specific stream can downgrade the incident path.
    if v_incident_context in ('broken', 'leak') then
        v_server_stream := 'SPECIAL_REVIEW';
    elsif v_has_special then
        v_server_stream := 'SPECIAL_REVIEW';
    elsif v_has_reactive
       or 'REACTIVE' = any(v_server_flags)
       or 'OXIDIZER' = any(v_server_flags)
       or 'EXPLOSIVE' = any(v_server_flags)
       or 'SELF_REACTIVE' = any(v_server_flags)
       or 'PYROPHORIC' = any(v_server_flags) then
        v_server_stream := 'REACTIVE_OXIDIZER';
    elsif v_has_cyanide or v_has_sulfide then
        v_server_stream := 'CYANIDE_SULFIDE';
    elsif v_has_heavy_metal then
        v_server_stream := 'HEAVY_METAL';
    elsif p_matrix = 'organic_halogenated' or v_has_organic_halogen then
        v_server_stream := 'ORGANIC_HALOGENATED';
    elsif p_matrix = 'organic_non_halogenated' then
        v_server_stream := 'ORGANIC_NON_HALOGENATED';
    elsif p_matrix = 'solid_slurry' then
        v_server_stream := 'SOLID_CONTAMINATED';
    elsif p_matrix = 'aqueous' then
        if v_has_acid and v_has_alkali and v_measured_ph_status = 'measured' then
            if v_measured_ph < 7 then
                v_server_stream := 'ACID_AQUEOUS';
            elsif v_measured_ph > 7 then
                v_server_stream := 'ALKALI_AQUEOUS';
            else
                v_server_stream := 'AQUEOUS_OTHER';
            end if;
        elsif v_has_acid then
            v_server_stream := 'ACID_AQUEOUS';
        elsif v_has_alkali then
            v_server_stream := 'ALKALI_AQUEOUS';
        else
            v_server_stream := 'AQUEOUS_OTHER';
        end if;
    elsif p_matrix = 'mixed_biphasic' then
        if v_has_organic_non_halogen then
            v_server_stream := 'ORGANIC_NON_HALOGENATED';
        else
            v_server_stream := 'SPECIAL_REVIEW';
        end if;
    else
        v_server_stream := 'SPECIAL_REVIEW';
    end if;

    if p_matrix = 'unknown' then
        v_missing_fields := array_append(v_missing_fields, 'matrix');
    end if;
    if v_has_unknown then
        v_missing_fields := array_append(v_missing_fields, 'hazard_data');
    end if;
    if v_hazard_data_needs_input then
        v_missing_fields := array_append(v_missing_fields, 'hazard_data');
    end if;
    if v_identity_needs_input then
        v_missing_fields := array_append(v_missing_fields, 'identity');
    end if;
    if p_matrix = 'aqueous'
       and v_has_acid
       and v_has_alkali
       and v_measured_ph_status <> 'measured' then
        v_missing_fields := array_append(v_missing_fields, 'measured_ph');
    end if;
    -- `present` means the user has declared a known component that is not yet
    -- represented in the component list. No matrix can make that omission
    -- safe to ignore. `unknown`, by contrast, only blocks when the missing
    -- composition can change an otherwise unresolved biphasic classification.
    if v_additional_components_status = 'present'
       or (
           p_matrix = 'mixed_biphasic'
           and not v_has_organic_halogen
           and not v_has_organic_non_halogen
           and (
               v_additional_components_status is null
               or v_additional_components_status = 'unknown'
           )
       ) then
        v_missing_fields := array_append(v_missing_fields, 'additional_components');
    end if;

    select coalesce(array_agg(distinct code order by code), array[]::text[])
    into v_blocking_codes
    from unnest(v_blocking_codes) as blocked(code);
    select coalesce(array_agg(distinct field order by field), array[]::text[])
    into v_missing_fields
    from unnest(v_missing_fields) as missing(field);

    v_server_status := case
        when cardinality(v_blocking_codes) > 0 then 'blocked'
        when cardinality(v_missing_fields) > 0 then 'needs_input'
        else 'ready'
    end;

    return jsonb_build_object(
        'decisionStatus', v_server_status,
        'streamCode', v_server_stream,
        'hazardFlags', to_jsonb(v_server_flags),
        'allowedActions', case
            when v_server_status = 'ready' then jsonb_build_array('container_deposit')
            when v_server_status = 'blocked' then jsonb_build_array('isolated', 'handover')
            else '[]'::jsonb
        end,
        'blockingCodes', to_jsonb(v_blocking_codes),
        'missingFields', to_jsonb(v_missing_fields)
    );
end;
$$;

revoke all on function private.analyze_waste_batch_v2(jsonb, text, jsonb)
    from public, anon, authenticated;

create or replace function public.record_waste_handling_v2(
    p_request_id uuid,
    p_batch jsonb,
    p_lab_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_existing public.waste_logs%rowtype;
    v_log_id uuid;
    v_handling_action text;
    v_decision_status text;
    v_stream_code text;
    v_matrix_code text;
    v_rule_version text;
    v_components jsonb;
    v_decision_snapshot jsonb;
    v_confirmation_snapshot jsonb;
    v_stream_snapshot jsonb;
    v_blocking_reasons jsonb;
    v_missing_fields jsonb;
    v_total_amount jsonb;
    v_amount_unknown boolean;
    v_amount_approximate boolean;
    v_amount_text text;
    v_amount_value numeric;
    v_amount_unit text;
    v_normalized_value numeric;
    v_normalized_unit text;
    v_handler_name text;
    v_memo text;
    v_stream record;
    v_component jsonb;
    v_ordinality bigint;
    v_cart_line_id text;
    v_source_type text;
    v_inventory_item_id uuid;
    v_cabinet_item_id uuid;
    v_ref_lab_id uuid;
    v_ref_user_id uuid;
    v_chemical_name text;
    v_concentration jsonb;
    v_concentration_text text;
    v_concentration_value numeric;
    v_concentration_unit text;
    v_hazard_flags jsonb;
    v_ghs_data_status text;
    v_decision_hazard_flags jsonb;
    v_allowed_actions jsonb;
    v_server_analysis jsonb;
    v_server_decision_status text;
    v_server_stream_code text;
    v_server_hazard_flags jsonb;
    v_server_blocking_codes jsonb;
    v_client_hazard_array text[];
    v_server_hazard_array text[];
    v_policy_flag text;
    v_policy_blocks boolean := false;
    v_payload_hash text;
    v_identity_confidence numeric;
    v_unknown_key text;
    v_client_policy_version text;
    v_institution_policy_count integer;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_request_id is null then
        raise exception 'request_id is required' using errcode = '22023';
    end if;

    if p_batch is null or jsonb_typeof(p_batch) <> 'object' then
        raise exception 'batch must be a JSON object' using errcode = '22023';
    end if;

    if octet_length(p_batch::text) > 2097152 then
        raise exception 'batch payload must be 2 MiB or smaller' using errcode = '22023';
    end if;

    select key
    into v_unknown_key
    from jsonb_object_keys(p_batch) as payload(key)
    where not (key = any(array[
        'components',
        'handlingAction', 'handling_action',
        'decisionStatus', 'decision_status',
        'streamCode', 'stream_code',
        'matrix', 'matrixCode', 'matrix_code',
        'totalAmount', 'total_amount',
        'decision', 'decisionSnapshot', 'decision_snapshot',
        'confirmationSnapshot', 'confirmation_snapshot',
        'ruleVersion', 'rule_version',
        'memo',
        'batch_id', 'scope_key', 'matrix_source',
        'measured_ph', 'measured_ph_status', 'additional_components_status'
    ]::text[]))
    limit 1;

    if found then
        raise exception 'Unsupported batch payload key: %', v_unknown_key using errcode = '22023';
    end if;

    -- jsonb text output has deterministic key ordering, so this hash is stable
    -- across equivalent object-key orderings while preserving array order.
    v_payload_hash := md5(p_batch::text);

    if p_lab_id is not null and not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = v_user_id
    ) then
        raise exception 'Access denied for lab %', p_lab_id using errcode = '42501';
    end if;

    -- Serialize retries for the same user/request pair before checking the
    -- unique index, so concurrent retries return one durable record.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_user_id::text || ':' || p_request_id::text, 0)
    );

    select wl.*
    into v_existing
    from public.waste_logs wl
    where wl.user_id = v_user_id
      and wl.request_id = p_request_id
    limit 1;

    if found then
        if v_existing.lab_id is distinct from p_lab_id then
            raise exception 'request_id was already used in another scope' using errcode = '23505';
        end if;
        if v_existing.request_payload_hash is distinct from v_payload_hash then
            raise exception 'request_id was already used with a different waste batch payload'
                using errcode = '23505';
        end if;

        return jsonb_build_object(
            'id', v_existing.id,
            'request_id', v_existing.request_id,
            'created_at', v_existing.created_at,
            'schema_version', v_existing.schema_version,
            'record_origin', v_existing.record_origin,
            'decision_status', v_existing.decision_status,
            'stream_code', v_existing.stream_code,
            'handling_action', v_existing.handling_action,
            'policy_version_id', v_existing.policy_version_id,
            'stream_snapshot', v_existing.stream_snapshot,
            'idempotent', true,
            'schemaVersion', v_existing.schema_version,
            'recordOrigin', v_existing.record_origin,
            'decisionStatus', v_existing.decision_status,
            'streamCode', v_existing.stream_code,
            'handlingAction', v_existing.handling_action,
            'policyVersionId', v_existing.policy_version_id,
            'streamSnapshot', v_existing.stream_snapshot,
            'createdAt', v_existing.created_at
        );
    end if;

    v_components := p_batch->'components';
    if v_components is null
       or jsonb_typeof(v_components) <> 'array'
       or jsonb_array_length(v_components) < 1
       or jsonb_array_length(v_components) > 100 then
        raise exception 'components must contain between 1 and 100 items' using errcode = '22023';
    end if;

    v_handling_action := coalesce(p_batch->>'handlingAction', p_batch->>'handling_action');
    v_decision_status := coalesce(
        p_batch->>'decisionStatus',
        p_batch->>'decision_status',
        p_batch #>> '{decision,decisionStatus}',
        p_batch #>> '{decision,decision_status}'
    );
    v_stream_code := coalesce(
        p_batch->>'streamCode',
        p_batch->>'stream_code',
        p_batch #>> '{decision,streamCode}',
        p_batch #>> '{decision,stream_code}'
    );
    v_matrix_code := coalesce(p_batch->>'matrix', p_batch->>'matrixCode', p_batch->>'matrix_code');
    v_decision_snapshot := coalesce(
        p_batch->'decision',
        p_batch->'decisionSnapshot',
        p_batch->'decision_snapshot',
        '{}'::jsonb
    );
    v_confirmation_snapshot := coalesce(
        p_batch->'confirmationSnapshot',
        p_batch->'confirmation_snapshot',
        jsonb_strip_nulls(jsonb_build_object(
            'batch_id', p_batch->>'batch_id',
            'scope_key', p_batch->>'scope_key',
            'matrix_source', p_batch->>'matrix_source',
            'measured_ph', p_batch->'measured_ph',
            'measured_ph_status', p_batch->>'measured_ph_status',
            'additional_components_status', p_batch->>'additional_components_status'
        ))
    );

    if jsonb_typeof(v_decision_snapshot) <> 'object'
       or jsonb_typeof(v_confirmation_snapshot) <> 'object' then
        raise exception 'decisionSnapshot and confirmationSnapshot must be JSON objects' using errcode = '22023';
    end if;

    select key
    into v_unknown_key
    from jsonb_object_keys(v_decision_snapshot) as snapshot(key)
    where not (key = any(array[
        'decisionStatus', 'decision_status',
        'streamCode', 'stream_code',
        'hazardFlags', 'hazard_flags',
        'allowedActions', 'allowed_actions',
        'blockingReasons', 'blocking_reasons',
        'missingFields', 'missing_fields',
        'policyVersion', 'policy_version',
        'ruleVersion', 'rule_version'
    ]::text[]))
    limit 1;

    if found then
        raise exception 'Unsupported decision snapshot key: %', v_unknown_key using errcode = '22023';
    end if;

    select key
    into v_unknown_key
    from jsonb_object_keys(v_confirmation_snapshot) as snapshot(key)
    where not (key = any(array[
        'batchId', 'batch_id',
        'scopeKey', 'scope_key',
        'matrixSource', 'matrix_source',
        'measuredPh', 'measured_ph',
        'measuredPhStatus', 'measured_ph_status',
        'additionalComponentsStatus', 'additional_components_status',
        'incidentContext', 'incident_context',
        'alreadyMixed', 'already_mixed'
    ]::text[]))
    limit 1;

    if found then
        raise exception 'Unsupported confirmation snapshot key: %', v_unknown_key using errcode = '22023';
    end if;

    v_rule_version := coalesce(
        v_decision_snapshot->>'ruleVersion',
        v_decision_snapshot->>'rule_version',
        p_batch->>'ruleVersion',
        p_batch->>'rule_version'
    );
    v_client_policy_version := nullif(trim(coalesce(
        v_decision_snapshot->>'policyVersion',
        v_decision_snapshot->>'policy_version'
    )), '');

    if nullif(trim(v_rule_version), '') is null then
        raise exception 'ruleVersion is required' using errcode = '22023';
    end if;

    if v_client_policy_version is null then
        raise exception 'decision policyVersion is required' using errcode = '22023';
    end if;

    if v_handling_action is null
       or v_handling_action not in ('container_deposit', 'isolated', 'handover') then
        raise exception 'Unsupported handlingAction: %', v_handling_action using errcode = '22023';
    end if;

    if v_decision_status is null
       or v_decision_status not in ('ready', 'needs_input', 'blocked') then
        raise exception 'Unsupported decisionStatus: %', v_decision_status using errcode = '22023';
    end if;

    if v_matrix_code is null or v_matrix_code not in (
        'aqueous',
        'organic_non_halogenated',
        'organic_halogenated',
        'mixed_biphasic',
        'solid_slurry',
        'unknown'
    ) then
        raise exception 'Unsupported matrix: %', v_matrix_code using errcode = '22023';
    end if;

    v_blocking_reasons := coalesce(
        v_decision_snapshot->'blockingReasons',
        v_decision_snapshot->'blocking_reasons',
        '[]'::jsonb
    );
    v_missing_fields := coalesce(
        v_decision_snapshot->'missingFields',
        v_decision_snapshot->'missing_fields',
        '[]'::jsonb
    );
    v_decision_hazard_flags := coalesce(
        v_decision_snapshot->'hazardFlags',
        v_decision_snapshot->'hazard_flags',
        '[]'::jsonb
    );
    v_allowed_actions := coalesce(
        v_decision_snapshot->'allowedActions',
        v_decision_snapshot->'allowed_actions',
        '[]'::jsonb
    );

    if jsonb_typeof(v_blocking_reasons) <> 'array'
       or jsonb_typeof(v_missing_fields) <> 'array'
       or jsonb_typeof(v_decision_hazard_flags) <> 'array'
       or jsonb_typeof(v_allowed_actions) <> 'array' then
        raise exception 'Decision hazards, actions, reasons, and missing fields must be arrays' using errcode = '22023';
    end if;

    if jsonb_array_length(v_allowed_actions) < 1
       or jsonb_array_length(v_allowed_actions) > 3
       or exists (
           select 1
           from jsonb_array_elements(v_allowed_actions) action(value)
           where jsonb_typeof(action.value) <> 'string'
              or action.value #>> '{}' not in ('container_deposit', 'isolated', 'handover')
       )
       or not exists (
           select 1
           from jsonb_array_elements_text(v_allowed_actions) action(value)
           where action.value = v_handling_action
       ) then
        raise exception 'handlingAction must be present in a valid allowedActions array' using errcode = '22023';
    end if;

    if jsonb_array_length(v_decision_hazard_flags) > 32
       or exists (
           select 1
           from jsonb_array_elements(v_decision_hazard_flags) flag(value)
           where jsonb_typeof(flag.value) <> 'string'
              or flag.value #>> '{}' not in (
                  'FLAMMABLE', 'OXIDIZER', 'EXPLOSIVE', 'SELF_REACTIVE',
                  'WATER_REACTIVE', 'PYROPHORIC', 'CORROSIVE', 'ACUTE_TOXIC',
                  'CMR', 'ENVIRONMENTAL_HAZARD', 'CYANIDE', 'SULFIDE',
                  'HEAVY_METAL', 'REACTIVE', 'UNKNOWN_COMPONENT'
              )
       ) then
        raise exception 'decision hazardFlags contains an unsupported value' using errcode = '22023';
    end if;

    if jsonb_array_length(v_blocking_reasons) > 100
       or exists (
           select 1
           from jsonb_array_elements(v_blocking_reasons) reason(value)
           where jsonb_typeof(reason.value) <> 'object'
       ) then
        raise exception 'blockingReasons must contain at most 100 objects' using errcode = '22023';
    end if;

    if jsonb_array_length(v_missing_fields) > 20
       or exists (
           select 1
           from jsonb_array_elements(v_missing_fields) missing(value)
           where jsonb_typeof(missing.value) <> 'string'
              or missing.value #>> '{}' not in (
                  'components', 'matrix', 'total_amount', 'measured_ph',
                  'identity', 'hazard_data', 'additional_components',
                  'inventory_quantity', 'policy_stream', 'policy_destination'
              )
       ) then
        raise exception 'missingFields contains an unsupported value' using errcode = '22023';
    end if;

    -- Recalculate the safety result from component identity/category/GHS data,
    -- claimed component flags, and the batch matrix. The client decision is
    -- evidence for the UI only; it is never the authority for a write.
    v_server_analysis := private.analyze_waste_batch_v2(
        v_components,
        v_matrix_code,
        v_confirmation_snapshot
    );
    v_server_decision_status := v_server_analysis->>'decisionStatus';
    v_server_stream_code := v_server_analysis->>'streamCode';
    v_server_hazard_flags := v_server_analysis->'hazardFlags';
    v_server_blocking_codes := v_server_analysis->'blockingCodes';

    select coalesce(array_agg(distinct value order by value), array[]::text[])
    into v_client_hazard_array
    from jsonb_array_elements_text(v_decision_hazard_flags) flags(value);
    select coalesce(array_agg(distinct value order by value), array[]::text[])
    into v_server_hazard_array
    from jsonb_array_elements_text(v_server_hazard_flags) flags(value);

    if v_client_hazard_array is distinct from v_server_hazard_array then
        raise exception 'decision hazardFlags does not match server-derived component hazards'
            using errcode = '22023';
    end if;
    if v_stream_code is distinct from v_server_stream_code then
        raise exception 'streamCode % does not match server-derived stream %',
            v_stream_code, v_server_stream_code using errcode = '22023';
    end if;
    if v_decision_status = 'ready' then
        if v_handling_action <> 'container_deposit'
           or jsonb_array_length(v_blocking_reasons) > 0
           or jsonb_array_length(v_missing_fields) > 0 then
            raise exception 'ready decisions require container_deposit and no blocking or missing reasons' using errcode = '22023';
        end if;
    elsif v_decision_status = 'needs_input' then
        if v_handling_action = 'container_deposit'
           or jsonb_array_length(v_missing_fields) = 0 then
            raise exception 'needs_input decisions require a missing field and a non-deposit action' using errcode = '22023';
        end if;
    else
        if v_handling_action = 'container_deposit'
           or jsonb_array_length(v_blocking_reasons) = 0 then
            raise exception 'blocked decisions require a blocking reason and a non-deposit action' using errcode = '22023';
        end if;
    end if;

    select count(distinct pv.id)
    into v_institution_policy_count
    from public.waste_policy_versions pv
    join public.safety_center_lab_links scl
      on scl.center_id = pv.safety_center_id
     and scl.lab_id = p_lab_id
     and scl.status = 'approved'
     and 'waste_management' = any(scl.scope)
    join public.safety_centers sc
      on sc.id = pv.safety_center_id
     and sc.status = 'approved'
    where p_lab_id is not null
      and pv.scope_type = 'safety_center'
      and pv.status = 'active';

    if v_institution_policy_count > 1 then
        raise exception
            'Multiple active safety-center waste policies are linked to lab %; resolve the waste_management policy authority before recording',
            p_lab_id
            using errcode = 'P0003';
    end if;

    with candidate_versions as (
        select pv.id, pv.scope_type, pv.activated_at, 10 as priority
        from public.waste_policy_versions pv
        where pv.scope_type = 'system'
          and pv.status = 'active'

        union all

        select pv.id, pv.scope_type, pv.activated_at, 20 as priority
        from public.waste_policy_versions pv
        join public.safety_center_lab_links scl
          on scl.center_id = pv.safety_center_id
         and scl.lab_id = p_lab_id
         and scl.status = 'approved'
         and 'waste_management' = any(scl.scope)
        join public.safety_centers sc
          on sc.id = pv.safety_center_id
         and sc.status = 'approved'
        where p_lab_id is not null
          and pv.scope_type = 'safety_center'
          and pv.status = 'active'

    )
    select
        ps.policy_version_id,
        pv.version_label as policy_version_label,
        ps.stream_code as policy_stream_code,
        cv.scope_type,
        ps.display_name_ko,
        ps.display_name_en,
        ps.description_ko,
        coalesce(nullif(trim(lo.container_label), ''), ps.container_label) as container_label,
        coalesce(nullif(trim(lo.container_color), ''), ps.container_color) as container_color,
        coalesce(
            nullif(trim(lo.replacement_location), ''),
            nullif(trim(lo.location), ''),
            ps.location
        ) as location,
        coalesce(nullif(trim(lo.handler_contact), ''), ps.handler_contact) as handler_contact,
        ps.sop_url,
        ps.allowed_hazard_flags,
        ps.blocked_hazard_flags,
        ps.prohibitions,
        ps.label_requirements,
        ps.is_enabled,
        coalesce(lo.is_disabled, false) as is_disabled,
        (
            not coalesce(lo.is_disabled, false)
            or nullif(trim(lo.replacement_location), '') is not null
        ) as effective_is_enabled,
        pv.source_refs
    into v_stream
    from candidate_versions cv
    join public.waste_policy_versions pv on pv.id = cv.id
    join public.waste_policy_streams ps on ps.policy_version_id = cv.id
    left join public.waste_policy_lab_overrides lo
      on lo.lab_id = p_lab_id
     and lo.stream_code = ps.stream_code
    where ps.stream_code in (v_stream_code, 'SPECIAL_REVIEW')
    order by
        case when ps.stream_code = v_stream_code then 0 else 1 end,
        cv.priority desc,
        cv.activated_at desc nulls last,
        ps.policy_version_id
    limit 1;

    if not found then
        raise exception 'No active policy or SPECIAL_REVIEW audit stream is available for %',
            v_stream_code using errcode = '22023';
    end if;

    -- The client analyzed the batch against a specific immutable policy
    -- version. Accept the UUID returned by the resolver or its immutable
    -- version label for the built-in policy, but never silently write against
    -- a different version activated after that analysis.
    if v_client_policy_version is distinct from v_stream.policy_version_id::text
       and not (
           v_stream.scope_type = 'system'
           and v_client_policy_version is not distinct from v_stream.policy_version_label
       ) then
        raise exception
            'Waste policy changed after analysis (client %, current %); refresh the policy and analyze the batch again',
            v_client_policy_version,
            v_stream.policy_version_id
            using errcode = '40001';
    end if;

    -- A disabled institution/lab stream prohibits normal container deposit,
    -- but it must never prevent recording an isolation or handover that the
    -- safety decision already requires. If a policy omitted the derived stream
    -- entirely, SPECIAL_REVIEW supplies immutable audit instructions while the
    -- server-derived stream code remains unchanged in the waste record.
    if v_handling_action = 'container_deposit'
       and (
           v_stream.policy_stream_code is distinct from v_stream_code
           or not v_stream.is_enabled
           or not v_stream.effective_is_enabled
       ) then
        raise exception 'No enabled policy destination is available for %', v_stream_code
            using errcode = '22023';
    end if;

    select flag
    into v_policy_flag
    from unnest(v_stream.blocked_hazard_flags) blocked(flag)
    where flag = any(v_server_hazard_array)
    order by flag
    limit 1;
    if found then
        v_policy_blocks := true;
        v_server_blocking_codes := v_server_blocking_codes
            || jsonb_build_array('policy_blocked:' || v_policy_flag);
    end if;

    if cardinality(v_stream.allowed_hazard_flags) > 0 then
        select flag
        into v_policy_flag
        from unnest(v_server_hazard_array) derived(flag)
        where not (flag = any(v_stream.allowed_hazard_flags))
        order by flag
        limit 1;
        if found then
            v_policy_blocks := true;
            v_server_blocking_codes := v_server_blocking_codes
                || jsonb_build_array('policy_disallowed:' || v_policy_flag);
        end if;
    end if;

    if v_policy_blocks then
        v_server_decision_status := 'blocked';
        v_server_analysis := jsonb_set(
            jsonb_set(
                jsonb_set(
                    v_server_analysis,
                    '{decisionStatus}',
                    to_jsonb(v_server_decision_status),
                    true
                ),
                '{allowedActions}',
                jsonb_build_array('isolated', 'handover'),
                true
            ),
            '{blockingCodes}',
            v_server_blocking_codes,
            true
        );
    end if;

    if v_decision_status is distinct from v_server_decision_status then
        raise exception 'decisionStatus % does not match server-derived status %',
            v_decision_status, v_server_decision_status using errcode = '22023';
    end if;

    if v_handling_action = 'container_deposit'
       and (
           nullif(trim(v_stream.container_label), '') is null
           or nullif(trim(v_stream.location), '') is null
       ) then
        raise exception 'A configured container label and location are required for container_deposit'
            using errcode = '22023';
    end if;

    v_total_amount := coalesce(p_batch->'totalAmount', p_batch->'total_amount');
    if v_total_amount is null or jsonb_typeof(v_total_amount) <> 'object' then
        raise exception 'totalAmount must be an object with a positive value and unit or explicit unknown=true'
            using errcode = '22023';
    end if;

    select key
    into v_unknown_key
    from jsonb_object_keys(v_total_amount) as amount(key)
    where not (key = any(array[
        'value', 'unit',
        'approximate', 'is_approximate',
        'unknown', 'is_unknown'
    ]::text[]))
    limit 1;

    if found then
        raise exception 'Unsupported totalAmount key: %', v_unknown_key using errcode = '22023';
    end if;

    if (v_total_amount ? 'unknown'
            and jsonb_typeof(v_total_amount->'unknown') <> 'boolean')
       or (v_total_amount ? 'is_unknown'
            and jsonb_typeof(v_total_amount->'is_unknown') <> 'boolean') then
        raise exception 'totalAmount.unknown must be boolean' using errcode = '22023';
    end if;
    if v_total_amount ? 'unknown'
       and v_total_amount ? 'is_unknown'
       and v_total_amount->>'unknown' is distinct from v_total_amount->>'is_unknown' then
        raise exception 'Conflicting totalAmount unknown aliases are not allowed' using errcode = '22023';
    end if;
    if (v_total_amount ? 'approximate'
            and jsonb_typeof(v_total_amount->'approximate') <> 'boolean')
       or (v_total_amount ? 'is_approximate'
            and jsonb_typeof(v_total_amount->'is_approximate') <> 'boolean') then
        raise exception 'totalAmount.approximate must be boolean' using errcode = '22023';
    end if;
    if v_total_amount ? 'approximate'
       and v_total_amount ? 'is_approximate'
       and v_total_amount->>'approximate' is distinct from v_total_amount->>'is_approximate' then
        raise exception 'Conflicting totalAmount approximate aliases are not allowed' using errcode = '22023';
    end if;

    v_amount_unknown := coalesce(
        (v_total_amount->>'unknown')::boolean,
        (v_total_amount->>'is_unknown')::boolean,
        false
    );
    v_amount_approximate := coalesce(
        (v_total_amount->>'approximate')::boolean,
        (v_total_amount->>'is_approximate')::boolean,
        false
    );

    if v_amount_unknown then
        if v_amount_approximate then
            raise exception 'An unknown amount cannot also be approximate' using errcode = '22023';
        end if;
        if v_total_amount->>'value' is not null or v_total_amount->>'unit' is not null then
            raise exception 'An unknown amount cannot include a value or unit' using errcode = '22023';
        end if;
    else
        v_amount_text := v_total_amount->>'value';
        v_amount_unit := v_total_amount->>'unit';

        if v_amount_text is null
           or v_amount_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)(?:[eE][+-]?[0-9]+)?$' then
            raise exception 'totalAmount.value must be a positive finite number' using errcode = '22023';
        end if;

        v_amount_value := v_amount_text::numeric;
        if v_amount_value <= 0 or v_amount_value::text in ('NaN', 'Infinity', '-Infinity') then
            raise exception 'totalAmount.value must be a positive finite number' using errcode = '22023';
        end if;

        if v_matrix_code = 'solid_slurry' and v_amount_unit not in ('mg', 'g') then
            raise exception 'Solid or slurry amounts must use mg or g' using errcode = '22023';
        elsif v_matrix_code = 'unknown' and v_amount_unit not in ('mL', 'L', 'mg', 'g') then
            raise exception 'Unknown-matrix amounts must use mL, L, mg, or g' using errcode = '22023';
        elsif v_matrix_code not in ('solid_slurry', 'unknown') and v_amount_unit not in ('mL', 'L') then
            raise exception 'Liquid amounts must use mL or L' using errcode = '22023';
        end if;

        if v_amount_unit = 'L' then
            v_normalized_value := v_amount_value * 1000;
            v_normalized_unit := 'mL';
        elsif v_amount_unit = 'mL' then
            v_normalized_value := v_amount_value;
            v_normalized_unit := 'mL';
        elsif v_amount_unit = 'g' then
            v_normalized_value := v_amount_value * 1000;
            v_normalized_unit := 'mg';
        else
            v_normalized_value := v_amount_value;
            v_normalized_unit := 'mg';
        end if;
    end if;

    -- The recorded handler is always derived from the authenticated session.
    -- Delegated handling needs a separate authorized workflow; a free client
    -- string is not accepted as audit identity.
    v_handler_name := private.actor_display_name_v2(v_user_id, p_lab_id);
    v_memo := nullif(trim(p_batch->>'memo'), '');

    if length(coalesce(v_memo, '')) > 2000 then
        raise exception 'memo must be 2000 characters or fewer' using errcode = '22023';
    end if;

    v_stream_snapshot := jsonb_build_object(
        'streamCode', v_stream_code,
        'displayNameKo', v_stream.display_name_ko,
        'displayNameEn', v_stream.display_name_en,
        'descriptionKo', v_stream.description_ko,
        'containerLabel', v_stream.container_label,
        'containerColor', v_stream.container_color,
        'location', v_stream.location,
        'handlerContact', v_stream.handler_contact,
        'sopUrl', v_stream.sop_url,
        'allowedHazardFlags', to_jsonb(v_stream.allowed_hazard_flags),
        'blockedHazardFlags', to_jsonb(v_stream.blocked_hazard_flags),
        'prohibitions', to_jsonb(v_stream.prohibitions),
        'labelRequirements', to_jsonb(v_stream.label_requirements),
        'policyVersionId', v_stream.policy_version_id,
        'policyScope', v_stream.scope_type,
        'sourceRefs', v_stream.source_refs
    );

    v_decision_snapshot := v_decision_snapshot || jsonb_build_object(
        'decisionStatus', v_decision_status,
        'streamCode', v_stream_code,
        'handlingAction', v_handling_action,
        'ruleVersion', v_rule_version,
        'policyVersionId', v_stream.policy_version_id,
        'serverAnalysis', v_server_analysis,
        'validatedAt', now()
    );

    insert into public.waste_logs (
        user_id,
        lab_id,
        chemicals,
        disposal_category,
        total_volume_ml,
        handler_name,
        memo,
        schema_version,
        record_origin,
        handling_action,
        decision_status,
        stream_code,
        matrix_code,
        policy_version_id,
        rule_version,
        total_amount_value,
        total_amount_unit,
        normalized_amount_value,
        normalized_amount_unit,
        amount_is_approximate,
        amount_is_unknown,
        decision_snapshot,
        stream_snapshot,
        confirmation_snapshot,
        request_id,
        request_payload_hash
    ) values (
        v_user_id,
        p_lab_id,
        v_components,
        v_stream.display_name_ko,
        case when v_normalized_unit = 'mL' then v_normalized_value else null end,
        v_handler_name,
        v_memo,
        2,
        'waste_batch',
        v_handling_action,
        v_decision_status,
        v_stream_code,
        v_matrix_code,
        v_stream.policy_version_id,
        v_rule_version,
        v_amount_value,
        v_amount_unit,
        v_normalized_value,
        v_normalized_unit,
        v_amount_approximate,
        v_amount_unknown,
        v_decision_snapshot,
        v_stream_snapshot,
        v_confirmation_snapshot,
        p_request_id,
        v_payload_hash
    )
    returning id, stream_snapshot into v_log_id, v_stream_snapshot;

    for v_component, v_ordinality in
        select component.value, component.ordinality
        from jsonb_array_elements(v_components) with ordinality as component(value, ordinality)
    loop
        if jsonb_typeof(v_component) <> 'object' then
            raise exception 'Every component must be a JSON object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_component) as component_key(key)
        where not (key = any(array[
            'cartLineId', 'cart_line_id',
            'sourceType', 'source_type',
            'sourceRef', 'source_ref',
            'inventoryItemId', 'inventory_item_id',
            'cabinetItemId', 'cabinet_item_id',
            'chemicalName', 'chemical_name', 'name',
            'casNumber', 'cas_number',
            'formula',
            'molecularWeight', 'molecular_weight',
            'pubchemCid', 'pubchem_cid',
            'koshaChemId', 'kosha_chem_id',
            'identityConfidence', 'identity_confidence',
            'ghsDataStatus', 'ghs_data_status',
            'concentration', 'concentration_value', 'concentration_unit',
            'hazardFlags', 'hazard_flags',
            'dataSources', 'data_sources',
            'analysisSnapshot', 'analysis_snapshot'
        ]::text[]))
        limit 1;

        if found then
            raise exception 'Unsupported component payload key: %', v_unknown_key using errcode = '22023';
        end if;

        v_cart_line_id := nullif(trim(coalesce(
            v_component->>'cartLineId',
            v_component->>'cart_line_id'
        )), '');
        v_chemical_name := nullif(trim(coalesce(
            v_component->>'chemicalName',
            v_component->>'chemical_name',
            v_component->>'name'
        )), '');
        v_source_type := coalesce(
            nullif(trim(v_component->>'sourceType'), ''),
            nullif(trim(v_component->>'source_type'), ''),
            'search'
        );

        if v_cart_line_id is null or length(v_cart_line_id) > 200 then
            raise exception 'Each component requires a cartLineId of 200 characters or fewer' using errcode = '22023';
        end if;
        if v_chemical_name is null or length(v_chemical_name) > 500 then
            raise exception 'Each component requires a chemical name of 500 characters or fewer' using errcode = '22023';
        end if;
        if v_source_type not in ('search', 'scan', 'inventory', 'cabinet', 'manual', 'import') then
            raise exception 'Unsupported component sourceType: %', v_source_type using errcode = '22023';
        end if;

        v_inventory_item_id := nullif(coalesce(
            v_component->>'inventoryItemId',
            v_component->>'inventory_item_id'
        ), '')::uuid;
        v_cabinet_item_id := nullif(coalesce(
            v_component->>'cabinetItemId',
            v_component->>'cabinet_item_id'
        ), '')::uuid;

        if v_source_type = 'inventory' and v_inventory_item_id is null then
            raise exception 'inventory source components require inventoryItemId' using errcode = '22023';
        end if;
        if v_source_type = 'cabinet' and v_cabinet_item_id is null then
            raise exception 'cabinet source components require cabinetItemId' using errcode = '22023';
        end if;

        if v_inventory_item_id is not null then
            select i.lab_id, i.user_id
            into v_ref_lab_id, v_ref_user_id
            from public.inventory i
            where i.id = v_inventory_item_id;

            if not found then
                raise exception 'Inventory component not found: %', v_inventory_item_id using errcode = 'P0002';
            end if;

            if p_lab_id is null then
                if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                    raise exception 'Inventory component is outside the personal scope' using errcode = '42501';
                end if;
            elsif v_ref_lab_id is distinct from p_lab_id then
                raise exception 'Inventory component is outside the selected lab' using errcode = '42501';
            end if;
        end if;

        if v_cabinet_item_id is not null then
            select c.lab_id, c.user_id
            into v_ref_lab_id, v_ref_user_id
            from public.cabinet_items ci
            join public.cabinets c on c.id = ci.cabinet_id
            where ci.id = v_cabinet_item_id;

            if not found then
                raise exception 'Cabinet component not found: %', v_cabinet_item_id using errcode = 'P0002';
            end if;

            if p_lab_id is null then
                if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                    raise exception 'Cabinet component is outside the personal scope' using errcode = '42501';
                end if;
            elsif v_ref_lab_id is distinct from p_lab_id then
                raise exception 'Cabinet component is outside the selected lab' using errcode = '42501';
            end if;
        end if;

        -- The canonical client payload uses `concentration: null` when the
        -- optional value is absent. JSON null is distinct from SQL NULL, so
        -- normalize both forms to an empty object before validating it.
        v_concentration := coalesce(
            nullif(v_component->'concentration', 'null'::jsonb),
            '{}'::jsonb
        );
        if jsonb_typeof(v_concentration) <> 'object' then
            raise exception 'component concentration must be an object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_concentration) as concentration_key(key)
        where key not in ('value', 'unit')
        limit 1;

        if found then
            raise exception 'Unsupported concentration key: %', v_unknown_key using errcode = '22023';
        end if;

        v_concentration_value := null;
        v_concentration_text := coalesce(
            v_concentration->>'value',
            v_component->>'concentration_value'
        );
        v_concentration_unit := coalesce(
            v_concentration->>'unit',
            v_component->>'concentration_unit'
        );
        if v_concentration_text is not null then
            if v_concentration_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)(?:[eE][+-]?[0-9]+)?$' then
                raise exception 'concentration.value must be a positive finite number' using errcode = '22023';
            end if;
            v_concentration_value := v_concentration_text::numeric;
            if v_concentration_value <= 0
               or v_concentration_value::text in ('NaN', 'Infinity', '-Infinity')
               or v_concentration_unit not in ('M', 'mM', '%', 'mg/mL') then
                raise exception 'Invalid concentration value or unit' using errcode = '22023';
            end if;
        elsif v_concentration_unit is not null then
            raise exception 'concentration.unit requires concentration.value' using errcode = '22023';
        end if;

        v_hazard_flags := coalesce(v_component->'hazardFlags', v_component->'hazard_flags', '[]'::jsonb);
        if jsonb_typeof(v_hazard_flags) <> 'array'
           or jsonb_array_length(v_hazard_flags) > 32
           or exists (
               select 1
               from jsonb_array_elements(v_hazard_flags) flag(value)
               where jsonb_typeof(flag.value) <> 'string'
                  or flag.value #>> '{}' not in (
                      'FLAMMABLE', 'OXIDIZER', 'EXPLOSIVE', 'SELF_REACTIVE',
                      'WATER_REACTIVE', 'PYROPHORIC', 'CORROSIVE', 'ACUTE_TOXIC',
                      'CMR', 'ENVIRONMENTAL_HAZARD', 'CYANIDE', 'SULFIDE',
                      'HEAVY_METAL', 'REACTIVE', 'UNKNOWN_COMPONENT'
                  )
           ) then
            raise exception 'component hazardFlags contains an unsupported value' using errcode = '22023';
        end if;

        v_ghs_data_status := coalesce(
            v_component->>'ghsDataStatus',
            v_component->>'ghs_data_status'
        );
        if v_ghs_data_status not in ('verified', 'lookup_failed', 'not_checked') then
            raise exception 'component ghsDataStatus must be verified, lookup_failed, or not_checked'
                using errcode = '22023';
        end if;

        if jsonb_typeof(coalesce(v_component->'dataSources', v_component->'data_sources', '[]'::jsonb)) <> 'array'
           or jsonb_array_length(coalesce(v_component->'dataSources', v_component->'data_sources', '[]'::jsonb)) > 20 then
            raise exception 'component dataSources must contain at most 20 records' using errcode = '22023';
        end if;

        if jsonb_typeof(coalesce(v_component->'analysisSnapshot', v_component->'analysis_snapshot', '{}'::jsonb)) <> 'object' then
            raise exception 'component analysisSnapshot must be an object' using errcode = '22023';
        end if;

        v_identity_confidence := nullif(coalesce(
            v_component->>'identityConfidence',
            v_component->>'identity_confidence'
        ), '')::numeric;
        if v_identity_confidence is not null and (v_identity_confidence < 0 or v_identity_confidence > 1) then
            raise exception 'identityConfidence must be between 0 and 1' using errcode = '22023';
        end if;

        insert into public.waste_log_items (
            waste_log_id,
            line_number,
            cart_line_id,
            source_type,
            source_ref,
            inventory_item_id,
            cabinet_item_id,
            chemical_name,
            cas_number,
            formula,
            molecular_weight,
            pubchem_cid,
            kosha_chem_id,
            identity_confidence,
            ghs_data_status,
            concentration_value,
            concentration_unit,
            hazard_flags,
            data_sources,
            analysis_snapshot
        ) values (
            v_log_id,
            v_ordinality::integer,
            v_cart_line_id,
            v_source_type,
            coalesce(
                v_component->>'sourceRef',
                v_component->>'source_ref',
                v_inventory_item_id::text,
                v_cabinet_item_id::text
            ),
            v_inventory_item_id,
            v_cabinet_item_id,
            v_chemical_name,
            nullif(coalesce(v_component->>'casNumber', v_component->>'cas_number'), ''),
            nullif(v_component->>'formula', ''),
            nullif(coalesce(v_component->>'molecularWeight', v_component->>'molecular_weight'), '')::numeric,
            nullif(coalesce(v_component->>'pubchemCid', v_component->>'pubchem_cid'), '')::bigint,
            nullif(coalesce(v_component->>'koshaChemId', v_component->>'kosha_chem_id'), ''),
            v_identity_confidence,
            v_ghs_data_status,
            v_concentration_value,
            v_concentration_unit,
            array(select jsonb_array_elements_text(v_hazard_flags)),
            coalesce(v_component->'dataSources', v_component->'data_sources', '[]'::jsonb),
            coalesce(v_component->'analysisSnapshot', v_component->'analysis_snapshot', '{}'::jsonb)
        );
    end loop;

    return jsonb_build_object(
        'id', v_log_id,
        'request_id', p_request_id,
        'created_at', now(),
        'schema_version', 2,
        'record_origin', 'waste_batch',
        'decision_status', v_decision_status,
        'stream_code', v_stream_code,
        'handling_action', v_handling_action,
        'policy_version_id', v_stream.policy_version_id,
        'stream_snapshot', v_stream_snapshot,
        'idempotent', false,
        'schemaVersion', 2,
        'recordOrigin', 'waste_batch',
        'decisionStatus', v_decision_status,
        'streamCode', v_stream_code,
        'handlingAction', v_handling_action,
        'policyVersionId', v_stream.policy_version_id,
        'streamSnapshot', v_stream_snapshot,
        'createdAt', now()
    );
end;
$$;

create or replace function public.void_waste_log_v2(
    p_waste_log_id uuid,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_log public.waste_logs%rowtype;
    v_is_lab_admin boolean := false;
    v_reason text := nullif(trim(p_reason), '');
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
        raise exception 'A void reason between 3 and 500 characters is required' using errcode = '22023';
    end if;

    select wl.*
    into v_log
    from public.waste_logs wl
    where wl.id = p_waste_log_id
    for update;

    if not found then
        raise exception 'Waste log not found: %', p_waste_log_id using errcode = 'P0002';
    end if;

    if v_log.voided_at is not null then
        return jsonb_build_object(
            'id', v_log.id,
            'voidedAt', v_log.voided_at,
            'voidedBy', v_log.voided_by,
            'voidReason', v_log.void_reason,
            'idempotent', true
        );
    end if;

    if v_log.lab_id is null then
        if v_log.user_id is distinct from v_user_id or now() > v_log.created_at + interval '15 minutes' then
            raise exception 'Personal waste logs can only be voided by their author within 15 minutes' using errcode = '42501';
        end if;
    else
        if not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_log.lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_log.lab_id using errcode = '42501';
        end if;

        v_is_lab_admin := public.is_lab_admin(v_log.lab_id);
        if not (
            (v_log.user_id = v_user_id and now() <= v_log.created_at + interval '15 minutes')
            or (v_is_lab_admin and now() <= v_log.created_at + interval '24 hours')
        ) then
            raise exception 'The correction window for this waste log has expired' using errcode = '42501';
        end if;
    end if;

    update public.waste_logs
    set voided_at = now(),
        voided_by = v_user_id,
        void_reason = v_reason
    where id = p_waste_log_id
    returning * into v_log;

    return jsonb_build_object(
        'id', v_log.id,
        'schemaVersion', v_log.schema_version,
        'recordOrigin', v_log.record_origin,
        'decisionStatus', v_log.decision_status,
        'streamCode', v_log.stream_code,
        'handlingAction', v_log.handling_action,
        'voidedAt', v_log.voided_at,
        'voidedBy', v_log.voided_by,
        'voidReason', v_log.void_reason,
        'idempotent', false
    );
end;
$$;

revoke all on function public.get_active_waste_policy_v2(uuid) from public, anon;
revoke all on function public.activate_waste_policy_v2(uuid) from public, anon;
revoke all on function public.upsert_lab_waste_stream_override_v2(
    uuid, text, text, text, text, text, text, boolean
) from public, anon;
revoke all on function public.save_safety_center_waste_policy_draft_v2(
    uuid, text, text, jsonb, jsonb
) from public, anon;
revoke all on function public.record_waste_handling_v2(uuid, jsonb, uuid) from public, anon;
revoke all on function public.void_waste_log_v2(uuid, text) from public, anon;

grant execute on function public.get_active_waste_policy_v2(uuid) to authenticated, service_role;
grant execute on function public.activate_waste_policy_v2(uuid) to authenticated, service_role;
grant execute on function public.upsert_lab_waste_stream_override_v2(
    uuid, text, text, text, text, text, text, boolean
) to authenticated, service_role;
grant execute on function public.save_safety_center_waste_policy_draft_v2(
    uuid, text, text, jsonb, jsonb
) to authenticated, service_role;
grant execute on function public.record_waste_handling_v2(uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.void_waste_log_v2(uuid, text) to authenticated, service_role;

-- Preserve the established inventory RPC signatures while making row scope
-- authoritative. Client-supplied actor/lab/cabinet values are assertions,
-- never authorization evidence.
create or replace function public.create_inventory_item_atomic(
    p_name text,
    p_storage_type text,
    p_brand text default null,
    p_product_number text default null,
    p_cas_number text default null,
    p_quantity integer default 1,
    p_capacity text default null,
    p_cabinet_id uuid default null,
    p_storage_location_id uuid default null,
    p_product_id uuid default null,
    p_expiry_date date default null,
    p_memo text default null,
    p_remaining_percent integer default 100,
    p_lab_id uuid default null,
    p_actor_user_id uuid default null,
    p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_new_id uuid;
    v_after_data jsonb;
    v_ref_lab_id uuid;
    v_ref_user_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_actor_user_id is not null and p_actor_user_id is distinct from v_user_id then
        raise exception 'actor_user_id must match the authenticated user' using errcode = '42501';
    end if;

    if nullif(trim(p_name), '') is null or length(trim(p_name)) > 500 then
        raise exception 'Inventory name is required and must be 500 characters or fewer' using errcode = '22023';
    end if;

    if p_storage_type not in ('cabinet', 'other') then
        raise exception 'Unsupported storage type: %', p_storage_type using errcode = '22023';
    end if;

    if coalesce(p_quantity, 1) < 1 or coalesce(p_quantity, 1) > 1000000 then
        raise exception 'quantity must be between 1 and 1000000' using errcode = '22023';
    end if;

    if coalesce(p_remaining_percent, 100) not between 0 and 100 then
        raise exception 'remaining_percent must be between 0 and 100' using errcode = '22023';
    end if;

    if nullif(trim(p_cas_number), '') is not null
       and not private.is_valid_cas_number(trim(p_cas_number)) then
        raise exception 'Invalid CAS Registry Number: %', p_cas_number using errcode = '22023';
    end if;

    if p_lab_id is not null and not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = v_user_id
    ) then
        raise exception 'Access denied for lab %', p_lab_id using errcode = '42501';
    end if;

    if p_storage_type = 'cabinet' then
        if p_cabinet_id is null then
            raise exception 'cabinet_id is required for cabinet storage' using errcode = '22023';
        end if;
        if p_storage_location_id is not null then
            raise exception 'storage_location_id cannot be combined with cabinet storage' using errcode = '22023';
        end if;
    elsif p_cabinet_id is not null then
        raise exception 'cabinet_id is only valid for cabinet storage' using errcode = '22023';
    end if;

    if p_cabinet_id is not null then
        select c.lab_id, c.user_id
        into v_ref_lab_id, v_ref_user_id
        from public.cabinets c
        where c.id = p_cabinet_id;

        if not found then
            raise exception 'Cabinet not found: %', p_cabinet_id using errcode = 'P0002';
        end if;

        if p_lab_id is null then
            if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                raise exception 'Cabinet is outside the personal scope' using errcode = '42501';
            end if;
        elsif v_ref_lab_id is distinct from p_lab_id then
            raise exception 'Cabinet is outside the selected lab' using errcode = '42501';
        end if;
    end if;

    if p_storage_location_id is not null then
        select sl.lab_id, sl.user_id
        into v_ref_lab_id, v_ref_user_id
        from public.storage_locations sl
        where sl.id = p_storage_location_id;

        if not found then
            raise exception 'Storage location not found: %', p_storage_location_id using errcode = 'P0002';
        end if;

        if p_lab_id is null then
            if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                raise exception 'Storage location is outside the personal scope' using errcode = '42501';
            end if;
        elsif v_ref_lab_id is distinct from p_lab_id then
            raise exception 'Storage location is outside the selected lab' using errcode = '42501';
        end if;
    end if;

    insert into public.inventory (
        lab_id,
        user_id,
        name,
        brand,
        product_number,
        cas_number,
        quantity,
        capacity,
        storage_type,
        cabinet_id,
        storage_location_id,
        product_id,
        expiry_date,
        memo,
        remaining_percent
    ) values (
        p_lab_id,
        v_user_id,
        trim(p_name),
        nullif(trim(p_brand), ''),
        nullif(trim(p_product_number), ''),
        nullif(trim(p_cas_number), ''),
        coalesce(p_quantity, 1),
        nullif(trim(p_capacity), ''),
        p_storage_type,
        p_cabinet_id,
        p_storage_location_id,
        p_product_id,
        p_expiry_date,
        nullif(trim(p_memo), ''),
        coalesce(p_remaining_percent, 100)
    )
    returning id into v_new_id;

    select to_jsonb(i.*)
    into v_after_data
    from public.inventory i
    where i.id = v_new_id;

    insert into public.audit_logs (
        actor_user_id,
        actor_name,
        lab_id,
        entity_type,
        entity_id,
        action,
        before_data,
        after_data,
        diff_data,
        source
    ) values (
        v_user_id,
        private.actor_display_name_v2(v_user_id, p_lab_id),
        p_lab_id,
        'inventory',
        v_new_id,
        'create',
        null,
        v_after_data,
        null,
        'rpc'
    );

    return v_after_data;
end;
$$;

create or replace function public.update_inventory_item_atomic(
    p_item_id uuid,
    p_item_source text,
    p_updates jsonb,
    p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_lab_id uuid;
    v_owner_user_id uuid;
    v_before_data jsonb;
    v_after_data jsonb;
    v_diff_data jsonb := '{}'::jsonb;
    v_key text;
    v_before_value jsonb;
    v_after_value jsonb;
    v_cabinet_id uuid;
    v_new_storage_type text;
    v_new_cabinet_id uuid;
    v_new_storage_location_id uuid;
    v_ref_lab_id uuid;
    v_ref_user_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
        raise exception 'updates must be a JSON object' using errcode = '22023';
    end if;

    if p_item_source not in ('inventory', 'cabinet_item') then
        raise exception 'Unsupported item source: %', p_item_source using errcode = '22023';
    end if;

    if p_item_source = 'inventory' then
        if exists (
            select 1
            from jsonb_object_keys(p_updates) as keys(key_name)
            where key_name <> all (array[
                'name', 'brand', 'product_number', 'cas_number', 'quantity', 'capacity',
                'storage_type', 'cabinet_id', 'storage_location_id', 'product_id',
                'expiry_date', 'memo', 'remaining_percent'
            ]::text[])
        ) then
            raise exception 'updates contains an unsupported inventory field' using errcode = '22023';
        end if;

        select to_jsonb(i.*), i.lab_id, i.user_id
        into v_before_data, v_lab_id, v_owner_user_id
        from public.inventory i
        where i.id = p_item_id
        for update;

        if not found then
            raise exception 'Inventory item not found: %', p_item_id using errcode = 'P0002';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for inventory item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        if p_updates ? 'name' and nullif(trim(p_updates->>'name'), '') is null then
            raise exception 'Inventory name cannot be empty' using errcode = '22023';
        end if;
        if p_updates ? 'cas_number'
           and nullif(trim(p_updates->>'cas_number'), '') is not null
           and not private.is_valid_cas_number(trim(p_updates->>'cas_number')) then
            raise exception 'Invalid CAS Registry Number: %', p_updates->>'cas_number' using errcode = '22023';
        end if;
        if p_updates ? 'quantity'
           and (p_updates->>'quantity')::integer not between 1 and 1000000 then
            raise exception 'quantity must be between 1 and 1000000' using errcode = '22023';
        end if;
        if p_updates ? 'remaining_percent'
           and (p_updates->>'remaining_percent')::integer not between 0 and 100 then
            raise exception 'remaining_percent must be between 0 and 100' using errcode = '22023';
        end if;

        v_new_storage_type := case
            when p_updates ? 'storage_type' then p_updates->>'storage_type'
            else v_before_data->>'storage_type'
        end;
        v_new_cabinet_id := case
            when p_updates ? 'cabinet_id' then nullif(p_updates->>'cabinet_id', '')::uuid
            else nullif(v_before_data->>'cabinet_id', '')::uuid
        end;
        v_new_storage_location_id := case
            when p_updates ? 'storage_location_id' then nullif(p_updates->>'storage_location_id', '')::uuid
            else nullif(v_before_data->>'storage_location_id', '')::uuid
        end;

        if v_new_storage_type not in ('cabinet', 'other') then
            raise exception 'Unsupported storage type: %', v_new_storage_type using errcode = '22023';
        end if;
        if v_new_storage_type = 'cabinet' then
            if v_new_cabinet_id is null then
                raise exception 'cabinet_id is required for cabinet storage' using errcode = '22023';
            end if;
            if v_new_storage_location_id is not null then
                raise exception 'storage_location_id cannot be combined with cabinet storage' using errcode = '22023';
            end if;
        elsif v_new_cabinet_id is not null then
            raise exception 'cabinet_id is only valid for cabinet storage' using errcode = '22023';
        end if;

        if v_new_cabinet_id is not null then
            select c.lab_id, c.user_id
            into v_ref_lab_id, v_ref_user_id
            from public.cabinets c
            where c.id = v_new_cabinet_id;

            if not found then
                raise exception 'Cabinet not found: %', v_new_cabinet_id using errcode = 'P0002';
            end if;

            if v_lab_id is null then
                if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                    raise exception 'Cabinet is outside the personal scope' using errcode = '42501';
                end if;
            elsif v_ref_lab_id is distinct from v_lab_id then
                raise exception 'Cabinet is outside the item lab' using errcode = '42501';
            end if;
        end if;

        if v_new_storage_location_id is not null then
            select sl.lab_id, sl.user_id
            into v_ref_lab_id, v_ref_user_id
            from public.storage_locations sl
            where sl.id = v_new_storage_location_id;

            if not found then
                raise exception 'Storage location not found: %', v_new_storage_location_id using errcode = 'P0002';
            end if;

            if v_lab_id is null then
                if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                    raise exception 'Storage location is outside the personal scope' using errcode = '42501';
                end if;
            elsif v_ref_lab_id is distinct from v_lab_id then
                raise exception 'Storage location is outside the item lab' using errcode = '42501';
            end if;
        end if;

        update public.inventory
        set name = case when p_updates ? 'name' then trim(p_updates->>'name') else name end,
            brand = case when p_updates ? 'brand' then nullif(trim(p_updates->>'brand'), '') else brand end,
            product_number = case when p_updates ? 'product_number' then nullif(trim(p_updates->>'product_number'), '') else product_number end,
            cas_number = case when p_updates ? 'cas_number' then nullif(trim(p_updates->>'cas_number'), '') else cas_number end,
            quantity = case when p_updates ? 'quantity' then (p_updates->>'quantity')::integer else quantity end,
            capacity = case when p_updates ? 'capacity' then nullif(trim(p_updates->>'capacity'), '') else capacity end,
            storage_type = case when p_updates ? 'storage_type' then p_updates->>'storage_type' else storage_type end,
            cabinet_id = case when p_updates ? 'cabinet_id' then nullif(p_updates->>'cabinet_id', '')::uuid else cabinet_id end,
            storage_location_id = case when p_updates ? 'storage_location_id' then nullif(p_updates->>'storage_location_id', '')::uuid else storage_location_id end,
            product_id = case when p_updates ? 'product_id' then nullif(p_updates->>'product_id', '')::uuid else product_id end,
            expiry_date = case when p_updates ? 'expiry_date' then nullif(p_updates->>'expiry_date', '')::date else expiry_date end,
            memo = case when p_updates ? 'memo' then nullif(trim(p_updates->>'memo'), '') else memo end,
            remaining_percent = case when p_updates ? 'remaining_percent' then (p_updates->>'remaining_percent')::integer else remaining_percent end,
            updated_at = now()
        where id = p_item_id;

        select to_jsonb(i.*)
        into v_after_data
        from public.inventory i
        where i.id = p_item_id;
    else
        if exists (
            select 1
            from jsonb_object_keys(p_updates) as keys(key_name)
            where key_name <> all (array[
                'name', 'brand', 'product_number', 'cas_no', 'capacity',
                'expiry_date', 'notes', 'remaining_percent'
            ]::text[])
        ) then
            raise exception 'updates contains an unsupported cabinet-item field' using errcode = '22023';
        end if;

        select to_jsonb(ci.*), ci.cabinet_id
        into v_before_data, v_cabinet_id
        from public.cabinet_items ci
        where ci.id = p_item_id
        for update;

        if not found then
            raise exception 'Cabinet item not found: %', p_item_id using errcode = 'P0002';
        end if;

        select c.lab_id, c.user_id
        into v_lab_id, v_owner_user_id
        from public.cabinets c
        where c.id = v_cabinet_id;

        if not found then
            raise exception 'Cabinet not found: %', v_cabinet_id using errcode = 'P0002';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for cabinet item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        if p_updates ? 'name' and nullif(trim(p_updates->>'name'), '') is null then
            raise exception 'Cabinet item name cannot be empty' using errcode = '22023';
        end if;
        if p_updates ? 'cas_no'
           and nullif(trim(p_updates->>'cas_no'), '') is not null
           and not private.is_valid_cas_number(trim(p_updates->>'cas_no')) then
            raise exception 'Invalid CAS Registry Number: %', p_updates->>'cas_no' using errcode = '22023';
        end if;
        if p_updates ? 'remaining_percent'
           and (p_updates->>'remaining_percent')::integer not between 0 and 100 then
            raise exception 'remaining_percent must be between 0 and 100' using errcode = '22023';
        end if;

        update public.cabinet_items
        set name = case when p_updates ? 'name' then trim(p_updates->>'name') else name end,
            brand = case when p_updates ? 'brand' then nullif(trim(p_updates->>'brand'), '') else brand end,
            product_number = case when p_updates ? 'product_number' then nullif(trim(p_updates->>'product_number'), '') else product_number end,
            cas_no = case when p_updates ? 'cas_no' then nullif(trim(p_updates->>'cas_no'), '') else cas_no end,
            capacity = case when p_updates ? 'capacity' then nullif(trim(p_updates->>'capacity'), '') else capacity end,
            expiry_date = case when p_updates ? 'expiry_date' then nullif(p_updates->>'expiry_date', '')::date else expiry_date end,
            notes = case when p_updates ? 'notes' then nullif(trim(p_updates->>'notes'), '') else notes end,
            remaining_percent = case when p_updates ? 'remaining_percent' then (p_updates->>'remaining_percent')::integer else remaining_percent end
        where id = p_item_id;

        select to_jsonb(ci.*)
        into v_after_data
        from public.cabinet_items ci
        where ci.id = p_item_id;
    end if;

    for v_key in select jsonb_object_keys(p_updates)
    loop
        v_before_value := v_before_data->v_key;
        v_after_value := v_after_data->v_key;
        if v_before_value is distinct from v_after_value then
            v_diff_data := jsonb_set(
                v_diff_data,
                array[v_key],
                jsonb_build_object('from', v_before_value, 'to', v_after_value)
            );
        end if;
    end loop;

    if v_diff_data <> '{}'::jsonb then
        insert into public.audit_logs (
            actor_user_id,
            actor_name,
            lab_id,
            entity_type,
            entity_id,
            action,
            before_data,
            after_data,
            diff_data,
            source
        ) values (
            v_user_id,
            private.actor_display_name_v2(v_user_id, v_lab_id),
            v_lab_id,
            p_item_source,
            p_item_id,
            'update',
            v_before_data,
            v_after_data,
            v_diff_data,
            'rpc'
        );
    end if;

    return v_after_data;
end;
$$;

create or replace function public.delete_inventory_item_atomic(
    p_item_id uuid,
    p_item_source text,
    p_item_name text,
    p_lab_id uuid default null,
    p_cabinet_id uuid default null,
    p_cabinet_name text default null,
    p_storage_location_name text default null,
    p_disposal_reason text default 'Deleted from inventory list',
    p_actor_name text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_lab_id uuid;
    v_owner_user_id uuid;
    v_cabinet_id uuid;
    v_linked_inventory_item_id uuid;
    v_before_data jsonb;
    v_item_name text;
    v_location text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_item_source not in ('inventory', 'cabinet_item') then
        raise exception 'Unsupported item source: %', p_item_source using errcode = '22023';
    end if;

    if p_item_source = 'inventory' then
        select to_jsonb(i.*), i.name, i.lab_id, i.user_id, i.cabinet_id
        into v_before_data, v_item_name, v_lab_id, v_owner_user_id, v_cabinet_id
        from public.inventory i
        where i.id = p_item_id
        for update;

        if not found then
            raise exception 'Inventory item not found: %', p_item_id using errcode = 'P0002';
        end if;

        if p_lab_id is distinct from v_lab_id then
            raise exception 'Requested lab scope does not match the inventory row' using errcode = '42501';
        end if;
        if p_cabinet_id is not null and p_cabinet_id is distinct from v_cabinet_id then
            raise exception 'Requested cabinet does not match the inventory row' using errcode = '42501';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for inventory item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        if v_cabinet_id is not null then
            delete from public.cabinet_items ci
            where ci.inventory_item_id = p_item_id
              and ci.cabinet_id = v_cabinet_id;

            insert into public.cabinet_activity_logs (
                cabinet_id,
                action_type,
                item_name,
                reason,
                performed_by
            ) values (
                v_cabinet_id,
                'remove',
                v_item_name,
                coalesce(nullif(trim(p_disposal_reason), ''), 'Deleted from inventory list'),
                v_user_id
            );
        end if;

        delete from public.inventory where id = p_item_id;
        v_location := coalesce(nullif(trim(p_cabinet_name), ''), nullif(trim(p_storage_location_name), ''), 'Inventory');
    else
        select to_jsonb(ci.*), ci.name, ci.cabinet_id, ci.inventory_item_id
        into v_before_data, v_item_name, v_cabinet_id, v_linked_inventory_item_id
        from public.cabinet_items ci
        where ci.id = p_item_id
        for update;

        if not found then
            raise exception 'Cabinet item not found: %', p_item_id using errcode = 'P0002';
        end if;

        select c.lab_id, c.user_id
        into v_lab_id, v_owner_user_id
        from public.cabinets c
        where c.id = v_cabinet_id;

        if not found then
            raise exception 'Cabinet not found: %', v_cabinet_id using errcode = 'P0002';
        end if;

        if p_lab_id is distinct from v_lab_id then
            raise exception 'Requested lab scope does not match the cabinet row' using errcode = '42501';
        end if;
        if p_cabinet_id is not null and p_cabinet_id is distinct from v_cabinet_id then
            raise exception 'Requested cabinet does not match the cabinet item' using errcode = '42501';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for cabinet item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        if v_linked_inventory_item_id is not null then
            perform 1
            from public.inventory i
            where i.id = v_linked_inventory_item_id
              and i.lab_id is not distinct from v_lab_id
              and (
                  v_lab_id is not null
                  or i.user_id = v_user_id
              )
            for update;

            if not found then
                raise exception 'Linked inventory item is outside the cabinet scope' using errcode = '42501';
            end if;
        end if;

        delete from public.cabinet_items where id = p_item_id;

        if v_linked_inventory_item_id is not null then
            delete from public.inventory where id = v_linked_inventory_item_id;
        end if;

        insert into public.cabinet_activity_logs (
            cabinet_id,
            action_type,
            item_name,
            reason,
            performed_by
        ) values (
            v_cabinet_id,
            'remove',
            v_item_name,
            coalesce(nullif(trim(p_disposal_reason), ''), 'Deleted from inventory list'),
            v_user_id
        );

        v_location := coalesce(nullif(trim(p_cabinet_name), ''), 'Cabinet');
    end if;

    insert into public.audit_logs (
        actor_user_id,
        actor_name,
        lab_id,
        entity_type,
        entity_id,
        action,
        location_context,
        before_data,
        source
    ) values (
        v_user_id,
        private.actor_display_name_v2(v_user_id, v_lab_id),
        v_lab_id,
        p_item_source,
        p_item_id,
        'delete',
        v_location,
        v_before_data || jsonb_build_object(
            'client_item_name', p_item_name,
            'deletion_reason', coalesce(nullif(trim(p_disposal_reason), ''), 'Deleted from inventory list')
        ),
        'rpc'
    );

    -- Intentionally no waste_logs or cabinet_disposal_logs insert here. A
    -- database-record deletion is not evidence of physical waste handling.
end;
$$;

comment on function public.delete_inventory_item_atomic(
    uuid, text, text, uuid, uuid, text, text, text, text
) is 'Deletes an inventory/cabinet record with scope checks and audit logging. Does not create a physical waste-disposal record.';

revoke all on function public.create_inventory_item_atomic(
    text, text, text, text, text, integer, text, uuid, uuid, uuid,
    date, text, integer, uuid, uuid, text
) from public, anon;
revoke all on function public.update_inventory_item_atomic(uuid, text, jsonb, text) from public, anon;
revoke all on function public.delete_inventory_item_atomic(
    uuid, text, text, uuid, uuid, text, text, text, text
) from public, anon;

grant execute on function public.create_inventory_item_atomic(
    text, text, text, text, text, integer, text, uuid, uuid, uuid,
    date, text, integer, uuid, uuid, text
) to authenticated, service_role;
grant execute on function public.update_inventory_item_atomic(uuid, text, jsonb, text)
    to authenticated, service_role;
grant execute on function public.delete_inventory_item_atomic(
    uuid, text, text, uuid, uuid, text, text, text, text
) to authenticated, service_role;

create or replace function public.remove_inventory_record_v2(
    p_items jsonb,
    p_lab_id uuid default null,
    p_actor_name text default null,
    p_reason text default 'Incorrect inventory record'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_item jsonb;
    v_item_id uuid;
    v_item_source text;
    v_item_name text;
    v_cabinet_id uuid;
    v_key text;
    v_seen_keys text[] := array[]::text[];
    v_removed_items jsonb := '[]'::jsonb;
    v_unknown_key text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) < 1
       or jsonb_array_length(p_items) > 100 then
        raise exception 'items must contain between 1 and 100 records' using errcode = '22023';
    end if;

    if octet_length(p_items::text) > 65536 then
        raise exception 'items payload must be 64 KiB or smaller' using errcode = '22023';
    end if;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        if jsonb_typeof(v_item) <> 'object' then
            raise exception 'Every inventory record must be a JSON object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_item) as item_key(key)
        where key not in ('item_id', 'itemId', 'item_source', 'itemSource')
        limit 1;

        if found then
            raise exception 'Unsupported inventory record key: %', v_unknown_key using errcode = '22023';
        end if;

        v_item_id := nullif(coalesce(v_item->>'item_id', v_item->>'itemId'), '')::uuid;
        v_item_source := coalesce(v_item->>'item_source', v_item->>'itemSource');

        if v_item_id is null or v_item_source not in ('inventory', 'cabinet_item') then
            raise exception 'Each record requires item_id and a valid item_source' using errcode = '22023';
        end if;

        v_key := v_item_source || ':' || v_item_id::text;
        if v_key = any(v_seen_keys) then
            raise exception 'Duplicate inventory record in request: %', v_key using errcode = '22023';
        end if;
        v_seen_keys := array_append(v_seen_keys, v_key);

        if v_item_source = 'inventory' then
            select i.name, i.cabinet_id
            into v_item_name, v_cabinet_id
            from public.inventory i
            where i.id = v_item_id;
        else
            select ci.name, ci.cabinet_id
            into v_item_name, v_cabinet_id
            from public.cabinet_items ci
            where ci.id = v_item_id;
        end if;

        if not found then
            raise exception 'Inventory record not found: %', v_key using errcode = 'P0002';
        end if;

        perform public.delete_inventory_item_atomic(
            p_item_id => v_item_id,
            p_item_source => v_item_source,
            p_item_name => v_item_name,
            p_lab_id => p_lab_id,
            p_cabinet_id => v_cabinet_id,
            p_cabinet_name => null,
            p_storage_location_name => null,
            p_disposal_reason => coalesce(nullif(trim(p_reason), ''), 'Incorrect inventory record'),
            p_actor_name => p_actor_name
        );

        v_removed_items := v_removed_items || jsonb_build_array(
            jsonb_build_object('item_id', v_item_id, 'item_source', v_item_source)
        );
    end loop;

    return jsonb_build_object(
        'removed_count', jsonb_array_length(v_removed_items),
        'removed_items', v_removed_items
    );
end;
$$;

create or replace function public.record_inventory_disposal_v2(
    p_request_id uuid,
    p_items jsonb,
    p_batch jsonb,
    p_lab_id uuid default null,
    p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_components jsonb;
    v_item jsonb;
    v_item_id uuid;
    v_item_source text;
    v_item_name text;
    v_cabinet_id uuid;
    v_quantity_text text;
    v_quantity_to_remove integer;
    v_available_quantity integer;
    v_key text;
    v_seen_keys text[] := array[]::text[];
    v_removed_items jsonb := '[]'::jsonb;
    v_requested_items jsonb := '[]'::jsonb;
    v_expected_items jsonb := '[]'::jsonb;
    v_result jsonb;
    v_log_id uuid;
    v_unknown_key text;
    v_items_hash text;
    v_stored_items_hash text;
    v_linked_inventory_item_id uuid;
    v_linked_inventory_lab_id uuid;
    v_linked_inventory_cabinet_id uuid;
    v_linked_inventory_quantity integer;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) < 1
       or jsonb_array_length(p_items) > 100 then
        raise exception 'items must contain between 1 and 100 records' using errcode = '22023';
    end if;

    if octet_length(p_items::text) > 65536 then
        raise exception 'items payload must be 64 KiB or smaller' using errcode = '22023';
    end if;

    if p_batch is null or jsonb_typeof(p_batch) <> 'object' then
        raise exception 'batch must be a JSON object' using errcode = '22023';
    end if;

    v_components := p_batch->'components';
    if v_components is null or jsonb_typeof(v_components) <> 'array' then
        raise exception 'batch.components must be an array' using errcode = '22023';
    end if;

    -- Normalize and validate the requested inventory targets before the core
    -- idempotency shortcut. This prevents a retry with malformed or different
    -- targets from being reported as a successful inventory disposal.
    for v_item in select value from jsonb_array_elements(p_items)
    loop
        if jsonb_typeof(v_item) <> 'object' then
            raise exception 'Every inventory record must be a JSON object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_item) as item_key(key)
        where key not in (
            'item_id', 'itemId', 'item_source', 'itemSource',
            'quantity_to_remove', 'quantityToRemove'
        )
        limit 1;

        if found then
            raise exception 'Unsupported inventory record key: %', v_unknown_key using errcode = '22023';
        end if;

        v_item_id := nullif(coalesce(v_item->>'item_id', v_item->>'itemId'), '')::uuid;
        v_item_source := coalesce(v_item->>'item_source', v_item->>'itemSource');
        v_quantity_text := coalesce(
            v_item->>'quantity_to_remove',
            v_item->>'quantityToRemove'
        );

        if v_item_id is null or v_item_source not in ('inventory', 'cabinet_item') then
            raise exception 'Each record requires item_id and a valid item_source' using errcode = '22023';
        end if;
        if v_quantity_text is null
           or v_quantity_text !~ '^[1-9][0-9]*$'
           or v_quantity_text::numeric > 2147483647 then
            raise exception 'quantity_to_remove must be a positive integer' using errcode = '22023';
        end if;
        v_quantity_to_remove := v_quantity_text::integer;
        if v_item_source = 'cabinet_item' and v_quantity_to_remove <> 1 then
            raise exception 'cabinet_item quantity_to_remove must be exactly 1' using errcode = '22023';
        end if;

        v_key := v_item_source || ':' || v_item_id::text;
        if v_key = any(v_seen_keys) then
            raise exception 'Duplicate inventory record in request: %', v_key using errcode = '22023';
        end if;
        v_seen_keys := array_append(v_seen_keys, v_key);
        v_requested_items := v_requested_items || jsonb_build_array(
            jsonb_build_object(
                'item_id', v_item_id,
                'item_source', v_item_source,
                'quantity_to_remove', v_quantity_to_remove
            )
        );
    end loop;

    select coalesce(jsonb_agg(target.value order by
        target.value->>'item_source',
        target.value->>'item_id'
    ), '[]'::jsonb)
    into v_requested_items
    from jsonb_array_elements(v_requested_items) target(value);
    v_items_hash := md5(v_requested_items::text);

    -- Let the core recorder acquire the idempotency lock first. On an initial
    -- call, any later target-validation failure rolls this insert back. On a
    -- retry after the inventory rows were deleted, the existing durable log
    -- can be returned without trying to resolve those deleted rows again.
    v_result := public.record_waste_handling_v2(p_request_id, p_batch, p_lab_id);
    v_log_id := (v_result->>'id')::uuid;

    if coalesce((v_result->>'idempotent')::boolean, false) then
        if coalesce(v_result->>'record_origin', v_result->>'recordOrigin') <> 'inventory_disposal' then
            raise exception 'request_id belongs to a non-inventory waste record' using errcode = '23505';
        end if;

        select
            coalesce(wl.confirmation_snapshot->'inventoryDisposalTargets', '[]'::jsonb),
            wl.request_items_hash
        into v_removed_items, v_stored_items_hash
        from public.waste_logs wl
        where wl.id = v_log_id;

        if v_stored_items_hash is distinct from v_items_hash then
            raise exception 'request_id was already used with a different inventory items payload'
                using errcode = '23505';
        end if;

        if jsonb_typeof(v_removed_items) <> 'array' then
            raise exception 'Stored inventory-disposal targets are invalid' using errcode = '22023';
        end if;

        if jsonb_array_length(v_removed_items) <> jsonb_array_length(v_requested_items)
           or not (v_removed_items @> v_requested_items and v_requested_items @> v_removed_items) then
            raise exception 'request_id was already used with different inventory targets' using errcode = '23505';
        end if;

        return v_result || jsonb_build_object(
            'record_origin', 'inventory_disposal',
            'recordOrigin', 'inventory_disposal',
            'removed_count', jsonb_array_length(v_removed_items),
            'removed_items', v_removed_items
        );
    end if;

    -- Validate every target and its batch linkage before creating the log.
    -- A later error would roll the whole function back as well, but this
    -- ordering avoids unnecessary work on malformed requests.
    v_seen_keys := array[]::text[];
    for v_item in select value from jsonb_array_elements(p_items)
    loop
        if jsonb_typeof(v_item) <> 'object' then
            raise exception 'Every inventory record must be a JSON object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_item) as item_key(key)
        where key not in (
            'item_id', 'itemId', 'item_source', 'itemSource',
            'quantity_to_remove', 'quantityToRemove'
        )
        limit 1;

        if found then
            raise exception 'Unsupported inventory record key: %', v_unknown_key using errcode = '22023';
        end if;

        v_item_id := nullif(coalesce(v_item->>'item_id', v_item->>'itemId'), '')::uuid;
        v_item_source := coalesce(v_item->>'item_source', v_item->>'itemSource');
        v_quantity_to_remove := coalesce(
            v_item->>'quantity_to_remove',
            v_item->>'quantityToRemove'
        )::integer;

        if v_item_id is null or v_item_source not in ('inventory', 'cabinet_item') then
            raise exception 'Each record requires item_id and a valid item_source' using errcode = '22023';
        end if;

        v_key := v_item_source || ':' || v_item_id::text;
        if v_key = any(v_seen_keys) then
            raise exception 'Duplicate inventory record in request: %', v_key using errcode = '22023';
        end if;
        v_seen_keys := array_append(v_seen_keys, v_key);

        if v_item_source = 'inventory' then
            if not exists (
                select 1
                from jsonb_array_elements(v_components) component(value)
                where coalesce(
                    component.value->>'inventory_item_id',
                    component.value->>'inventoryItemId'
                ) = v_item_id::text
            ) then
                raise exception 'Inventory record % is not linked from batch.components', v_item_id using errcode = '22023';
            end if;

            select i.name, i.cabinet_id, i.quantity
            into v_item_name, v_cabinet_id, v_available_quantity
            from public.inventory i
            where i.id = v_item_id;

            if found and (v_available_quantity is null or v_available_quantity < 1) then
                raise exception 'Inventory record % has an invalid available quantity', v_item_id
                    using errcode = '22023';
            elsif found and v_quantity_to_remove > v_available_quantity then
                raise exception 'quantity_to_remove % exceeds available inventory quantity % for %',
                    v_quantity_to_remove, v_available_quantity, v_item_id using errcode = '22023';
            end if;
        else
            if not exists (
                select 1
                from jsonb_array_elements(v_components) component(value)
                where coalesce(
                    component.value->>'cabinet_item_id',
                    component.value->>'cabinetItemId'
                ) = v_item_id::text
            ) then
                raise exception 'Cabinet record % is not linked from batch.components', v_item_id using errcode = '22023';
            end if;

            select ci.name, ci.cabinet_id
            into v_item_name, v_cabinet_id
            from public.cabinet_items ci
            where ci.id = v_item_id;
        end if;

        if not found then
            raise exception 'Inventory record not found: %', v_key using errcode = 'P0002';
        end if;

        v_removed_items := v_removed_items || jsonb_build_array(
            jsonb_build_object(
                'item_id', v_item_id,
                'item_source', v_item_source,
                'quantity_to_remove', v_quantity_to_remove
            )
        );
    end loop;

    -- The inventory transaction must cover every linked component, not merely
    -- an arbitrary subset supplied by the caller. This mirrors the client rule:
    -- an inventory reference takes precedence; otherwise a cabinet-origin line
    -- uses its cabinet item reference. Duplicate component references collapse
    -- to one atomic target, while inventory quantities are summed across lines.
    for v_item in select value from jsonb_array_elements(v_components)
    loop
        if nullif(coalesce(
            v_item->>'inventoryItemId',
            v_item->>'inventory_item_id'
        ), '') is not null then
            v_quantity_text := coalesce(
                v_item #>> '{analysisSnapshot,inventoryDisposalQuantity}',
                v_item #>> '{analysis_snapshot,inventoryDisposalQuantity}',
                v_item #>> '{analysisSnapshot,inventory_disposal_quantity}',
                v_item #>> '{analysis_snapshot,inventory_disposal_quantity}'
            );
            if v_quantity_text is null
               or v_quantity_text !~ '^[1-9][0-9]*$'
               or v_quantity_text::numeric > 2147483647 then
                raise exception 'Each inventory-linked component requires a positive integer inventoryDisposalQuantity'
                    using errcode = '22023';
            end if;
        end if;
    end loop;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'item_id', linked.item_id,
            'item_source', linked.item_source,
            'quantity_to_remove', linked.quantity_to_remove
        )
        order by linked.first_line
    ), '[]'::jsonb)
    into v_expected_items
    from (
        select
            candidate.item_id,
            candidate.item_source,
            sum(candidate.quantity_to_remove) as quantity_to_remove,
            min(candidate.line_number) as first_line
        from (
            select
                case
                    when nullif(coalesce(
                        component.value->>'inventoryItemId',
                        component.value->>'inventory_item_id'
                    ), '') is not null then coalesce(
                        component.value->>'inventoryItemId',
                        component.value->>'inventory_item_id'
                    )
                    when coalesce(
                        component.value->>'sourceType',
                        component.value->>'source_type'
                    ) = 'cabinet' then nullif(coalesce(
                        component.value->>'cabinetItemId',
                        component.value->>'cabinet_item_id'
                    ), '')
                    else null
                end as item_id,
                case
                    when nullif(coalesce(
                        component.value->>'inventoryItemId',
                        component.value->>'inventory_item_id'
                    ), '') is not null then 'inventory'
                    when coalesce(
                        component.value->>'sourceType',
                        component.value->>'source_type'
                    ) = 'cabinet'
                     and nullif(coalesce(
                        component.value->>'cabinetItemId',
                        component.value->>'cabinet_item_id'
                    ), '') is not null then 'cabinet_item'
                    else null
                end as item_source,
                case
                    when nullif(coalesce(
                        component.value->>'inventoryItemId',
                        component.value->>'inventory_item_id'
                    ), '') is not null then coalesce(
                        component.value #>> '{analysisSnapshot,inventoryDisposalQuantity}',
                        component.value #>> '{analysis_snapshot,inventoryDisposalQuantity}',
                        component.value #>> '{analysisSnapshot,inventory_disposal_quantity}',
                        component.value #>> '{analysis_snapshot,inventory_disposal_quantity}'
                    )::integer
                    when coalesce(
                        component.value->>'sourceType',
                        component.value->>'source_type'
                    ) = 'cabinet' then 1
                    else null
                end as quantity_to_remove,
                component.ordinality as line_number
            from jsonb_array_elements(v_components) with ordinality as component(value, ordinality)
        ) candidate
        where candidate.item_id is not null
          and candidate.item_source is not null
          and candidate.quantity_to_remove is not null
        group by candidate.item_id, candidate.item_source
    ) linked;

    if jsonb_array_length(v_expected_items) <> jsonb_array_length(v_requested_items)
       or not (v_expected_items @> v_requested_items and v_requested_items @> v_expected_items) then
        raise exception 'items must exactly match the inventory-linked batch components' using errcode = '22023';
    end if;

    -- Re-read each target inside the deleting RPC. All deletions and the waste
    -- record remain in this one transaction and roll back together on error.
    for v_item in select value from jsonb_array_elements(p_items)
    loop
        v_item_id := nullif(coalesce(v_item->>'item_id', v_item->>'itemId'), '')::uuid;
        v_item_source := coalesce(v_item->>'item_source', v_item->>'itemSource');
        v_quantity_to_remove := coalesce(
            v_item->>'quantity_to_remove',
            v_item->>'quantityToRemove'
        )::integer;

        if v_item_source = 'inventory' then
            select i.name, i.cabinet_id, i.quantity
            into v_item_name, v_cabinet_id, v_available_quantity
            from public.inventory i
            where i.id = v_item_id
            for update;
        else
            select ci.name, ci.cabinet_id, ci.inventory_item_id
            into v_item_name, v_cabinet_id, v_linked_inventory_item_id
            from public.cabinet_items ci
            where ci.id = v_item_id
            for update;
        end if;

        if not found then
            raise exception 'Inventory record disappeared during disposal: %:%', v_item_source, v_item_id using errcode = 'P0002';
        end if;

        if v_item_source = 'inventory' then
            if v_available_quantity is null or v_available_quantity < 1 then
                raise exception 'Inventory record % has an invalid available quantity', v_item_id
                    using errcode = '22023';
            elsif v_quantity_to_remove > v_available_quantity then
                raise exception 'quantity_to_remove % exceeds available inventory quantity % for %',
                    v_quantity_to_remove, v_available_quantity, v_item_id using errcode = '22023';
            elsif v_quantity_to_remove < v_available_quantity then
                perform public.update_inventory_item_atomic(
                    v_item_id,
                    'inventory',
                    jsonb_build_object('quantity', v_available_quantity - v_quantity_to_remove),
                    p_actor_name
                );
            else
                perform public.delete_inventory_item_atomic(
                    p_item_id => v_item_id,
                    p_item_source => v_item_source,
                    p_item_name => v_item_name,
                    p_lab_id => p_lab_id,
                    p_cabinet_id => v_cabinet_id,
                    p_cabinet_name => null,
                    p_storage_location_name => null,
                    p_disposal_reason => 'Disposed through Waste Disposal V2',
                    p_actor_name => p_actor_name
                );
            end if;
        else
            if v_quantity_to_remove <> 1 then
                raise exception 'cabinet_item quantity_to_remove must be exactly 1' using errcode = '22023';
            end if;

            if v_linked_inventory_item_id is not null then
                select i.lab_id, i.cabinet_id, i.quantity
                into
                    v_linked_inventory_lab_id,
                    v_linked_inventory_cabinet_id,
                    v_linked_inventory_quantity
                from public.inventory i
                where i.id = v_linked_inventory_item_id
                for update;

                if not found then
                    raise exception 'Linked inventory item disappeared during disposal: %',
                        v_linked_inventory_item_id using errcode = 'P0002';
                end if;
                if v_linked_inventory_lab_id is distinct from p_lab_id
                   or v_linked_inventory_cabinet_id is distinct from v_cabinet_id then
                    raise exception 'Linked inventory item is outside the cabinet disposal scope'
                        using errcode = '42501';
                end if;
                if v_linked_inventory_quantity is null
                   or v_linked_inventory_quantity not between 1 and 1000000 then
                    raise exception 'Linked inventory item has an invalid available quantity'
                        using errcode = '22023';
                end if;
            end if;

            if v_linked_inventory_item_id is not null
               and v_linked_inventory_quantity > 1 then
                -- A cabinet placement can represent an aggregated inventory
                -- count. Disposing one physical container decrements exactly
                -- one and keeps that placement for the remaining containers.
                perform public.update_inventory_item_atomic(
                    v_linked_inventory_item_id,
                    'inventory',
                    jsonb_build_object('quantity', v_linked_inventory_quantity - 1),
                    null
                );

                insert into public.cabinet_activity_logs (
                    cabinet_id,
                    action_type,
                    item_name,
                    reason,
                    performed_by
                ) values (
                    v_cabinet_id,
                    'update',
                    v_item_name,
                    format(
                        'Disposed one container through Waste Disposal V2; inventory quantity reduced from %s to %s',
                        v_linked_inventory_quantity,
                        v_linked_inventory_quantity - 1
                    ),
                    v_user_id
                );
            else
                perform public.delete_inventory_item_atomic(
                    p_item_id => v_item_id,
                    p_item_source => v_item_source,
                    p_item_name => v_item_name,
                    p_lab_id => p_lab_id,
                    p_cabinet_id => v_cabinet_id,
                    p_cabinet_name => null,
                    p_storage_location_name => null,
                    p_disposal_reason => 'Disposed through Waste Disposal V2',
                    p_actor_name => null
                );
            end if;
        end if;
    end loop;

    update public.waste_logs
    set record_origin = 'inventory_disposal',
        request_items_hash = v_items_hash,
        confirmation_snapshot = coalesce(confirmation_snapshot, '{}'::jsonb)
            || jsonb_build_object('inventoryDisposalTargets', v_requested_items)
    where id = v_log_id
      and user_id = v_user_id;

    return v_result || jsonb_build_object(
        'record_origin', 'inventory_disposal',
        'recordOrigin', 'inventory_disposal',
        'removed_count', jsonb_array_length(v_removed_items),
        'removed_items', v_removed_items
    );
end;
$$;

create or replace function public.record_inventory_usage_completion_v2(
    p_cabinet_item_id uuid,
    p_request_id uuid,
    p_completion_kind text default 'used'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_existing public.inventory_usage_completion_receipts%rowtype;
    v_cabinet_item_before jsonb;
    v_inventory_before jsonb;
    v_inventory_after jsonb;
    v_inventory_item_id uuid;
    v_cabinet_id uuid;
    v_cabinet_name text;
    v_item_name text;
    v_lab_id uuid;
    v_cabinet_owner_id uuid;
    v_inventory_lab_id uuid;
    v_inventory_owner_id uuid;
    v_inventory_cabinet_id uuid;
    v_inventory_storage_type text;
    v_previous_quantity integer;
    v_remaining_quantity integer;
    v_actor_name text;
    v_cabinet_item_removed boolean;
    v_inventory_item_removed boolean;
    v_activity_action text;
    v_activity_reason text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if p_cabinet_item_id is null then
        raise exception 'cabinet_item_id is required' using errcode = '22023';
    end if;
    if p_request_id is null then
        raise exception 'request_id is required' using errcode = '22023';
    end if;
    if p_completion_kind not in ('used', 'empty_container') then
        raise exception 'completion_kind must be used or empty_container' using errcode = '22023';
    end if;

    -- A request ID is globally serialized so another account cannot race the
    -- same idempotency key and obtain an ambiguous receipt.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('inventory-usage-completion:' || p_request_id::text, 0)
    );

    select receipt.*
    into v_existing
    from public.inventory_usage_completion_receipts receipt
    where receipt.request_id = p_request_id;

    if found then
        if v_existing.actor_user_id is distinct from v_user_id
           or v_existing.cabinet_item_id is distinct from p_cabinet_item_id
           or v_existing.completion_kind is distinct from p_completion_kind then
            raise exception 'request_id was already used with a different usage-completion payload'
                using errcode = '23505';
        end if;

        return jsonb_build_object(
            'request_id', v_existing.request_id,
            'cabinet_item_id', v_existing.cabinet_item_id,
            'inventory_item_id', v_existing.inventory_item_id,
            'completion_kind', v_existing.completion_kind,
            'previous_quantity', v_existing.previous_quantity,
            'remaining_quantity', v_existing.remaining_quantity,
            'cabinet_item_removed', v_existing.cabinet_item_removed,
            'inventory_item_removed', v_existing.inventory_item_removed,
            'idempotent', true
        );
    end if;

    select
        to_jsonb(ci.*),
        ci.inventory_item_id,
        ci.cabinet_id,
        ci.name
    into
        v_cabinet_item_before,
        v_inventory_item_id,
        v_cabinet_id,
        v_item_name
    from public.cabinet_items ci
    where ci.id = p_cabinet_item_id
    for update;

    if not found then
        raise exception 'Cabinet item not found: %', p_cabinet_item_id using errcode = 'P0002';
    end if;

    select c.lab_id, c.user_id, c.name
    into v_lab_id, v_cabinet_owner_id, v_cabinet_name
    from public.cabinets c
    where c.id = v_cabinet_id;

    if not found then
        raise exception 'Cabinet not found: %', v_cabinet_id using errcode = 'P0002';
    end if;

    if v_lab_id is null then
        if v_cabinet_owner_id is distinct from v_user_id then
            raise exception 'Access denied for cabinet item %', p_cabinet_item_id using errcode = '42501';
        end if;
    else
        select nullif(trim(lm.nickname), '')
        into v_actor_name
        from public.lab_members lm
        where lm.lab_id = v_lab_id
          and lm.user_id = v_user_id;

        if not found then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;
    end if;

    -- Only reveal linkage state after the caller's cabinet scope is proven.
    if v_inventory_item_id is null then
        raise exception 'Cabinet item % is not linked to an inventory record', p_cabinet_item_id
            using errcode = '22023';
    end if;

    select
        to_jsonb(i.*),
        i.lab_id,
        i.user_id,
        i.cabinet_id,
        i.storage_type,
        i.quantity
    into
        v_inventory_before,
        v_inventory_lab_id,
        v_inventory_owner_id,
        v_inventory_cabinet_id,
        v_inventory_storage_type,
        v_previous_quantity
    from public.inventory i
    where i.id = v_inventory_item_id
    for update;

    if not found then
        raise exception 'Linked inventory item not found: %', v_inventory_item_id using errcode = 'P0002';
    end if;
    if v_inventory_lab_id is distinct from v_lab_id
       or v_inventory_cabinet_id is distinct from v_cabinet_id
       or v_inventory_storage_type is distinct from 'cabinet' then
        raise exception 'Linked inventory item is outside the cabinet scope' using errcode = '42501';
    end if;
    if v_lab_id is null and v_inventory_owner_id is distinct from v_user_id then
        raise exception 'Linked inventory item is outside the personal scope' using errcode = '42501';
    end if;
    if v_previous_quantity is null or v_previous_quantity not between 1 and 1000000 then
        raise exception 'Linked inventory quantity must be between 1 and 1000000' using errcode = '22023';
    end if;

    v_remaining_quantity := v_previous_quantity - 1;
    v_cabinet_item_removed := v_remaining_quantity = 0;
    v_inventory_item_removed := v_remaining_quantity = 0;

    if v_remaining_quantity > 0 then
        update public.inventory
        set quantity = v_remaining_quantity,
            updated_at = now()
        where id = v_inventory_item_id;

        select to_jsonb(i.*)
        into v_inventory_after
        from public.inventory i
        where i.id = v_inventory_item_id;

        v_activity_action := 'update';
        v_activity_reason := format(
            '%s recorded; inventory quantity reduced from %s to %s',
            case p_completion_kind when 'empty_container' then 'Empty container' else 'Full use' end,
            v_previous_quantity,
            v_remaining_quantity
        );
    else
        delete from public.cabinet_items ci
        where ci.id = p_cabinet_item_id
          and ci.inventory_item_id = v_inventory_item_id;

        if not found then
            raise exception 'Cabinet placement disappeared during usage completion' using errcode = 'P0002';
        end if;

        delete from public.inventory i
        where i.id = v_inventory_item_id;

        if not found then
            raise exception 'Inventory item disappeared during usage completion' using errcode = 'P0002';
        end if;

        v_inventory_after := null;
        v_activity_action := 'remove';
        v_activity_reason := case p_completion_kind
            when 'empty_container' then 'Empty container recorded; inventory closed'
            else 'Full use recorded; inventory closed'
        end;
    end if;

    insert into public.cabinet_activity_logs (
        cabinet_id,
        action_type,
        item_name,
        reason,
        performed_by
    ) values (
        v_cabinet_id,
        v_activity_action,
        v_item_name,
        v_activity_reason,
        v_user_id
    );

    insert into public.audit_logs (
        actor_user_id,
        actor_name,
        lab_id,
        entity_type,
        entity_id,
        action,
        location_context,
        before_data,
        after_data,
        diff_data,
        source,
        request_id
    ) values (
        v_user_id,
        v_actor_name,
        v_lab_id,
        'inventory',
        v_inventory_item_id,
        case when v_inventory_item_removed then 'delete' else 'update' end,
        coalesce(nullif(trim(v_cabinet_name), ''), 'Cabinet'),
        jsonb_build_object(
            'inventory', v_inventory_before,
            'cabinet_item', v_cabinet_item_before
        ),
        jsonb_build_object(
            'inventory', v_inventory_after,
            'cabinet_item', case
                when v_cabinet_item_removed then null
                else v_cabinet_item_before
            end,
            'completion_kind', p_completion_kind
        ),
        jsonb_build_object(
            'quantity', jsonb_build_object(
                'from', v_previous_quantity,
                'to', v_remaining_quantity
            ),
            'cabinet_item_removed', v_cabinet_item_removed,
            'inventory_item_removed', v_inventory_item_removed
        ),
        'rpc',
        p_request_id
    );

    insert into public.inventory_usage_completion_receipts (
        request_id,
        actor_user_id,
        lab_id,
        cabinet_item_id,
        inventory_item_id,
        completion_kind,
        previous_quantity,
        remaining_quantity,
        cabinet_item_removed,
        inventory_item_removed
    ) values (
        p_request_id,
        v_user_id,
        v_lab_id,
        p_cabinet_item_id,
        v_inventory_item_id,
        p_completion_kind,
        v_previous_quantity,
        v_remaining_quantity,
        v_cabinet_item_removed,
        v_inventory_item_removed
    );

    return jsonb_build_object(
        'request_id', p_request_id,
        'cabinet_item_id', p_cabinet_item_id,
        'inventory_item_id', v_inventory_item_id,
        'completion_kind', p_completion_kind,
        'previous_quantity', v_previous_quantity,
        'remaining_quantity', v_remaining_quantity,
        'cabinet_item_removed', v_cabinet_item_removed,
        'inventory_item_removed', v_inventory_item_removed,
        'idempotent', false
    );
end;
$$;

create or replace function public.move_inventory_records_v2(
    p_targets jsonb,
    p_destination jsonb,
    p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_existing public.inventory_move_receipts%rowtype;
    v_target jsonb;
    v_placement jsonb;
    v_normalized_targets jsonb := '[]'::jsonb;
    v_normalized_destination jsonb;
    v_moved_items jsonb := '[]'::jsonb;
    v_targets_hash text;
    v_destination_hash text;
    v_unknown_key text;
    v_item_id uuid;
    v_item_source text;
    v_seen_keys text[] := array[]::text[];
    v_seen_inventory_ids uuid[] := array[]::uuid[];
    v_destination_type text;
    v_destination_cabinet_id uuid;
    v_destination_location_id uuid;
    v_destination_lab_id uuid;
    v_destination_owner_id uuid;
    v_destination_cabinet_width numeric;
    v_destination_cabinet_depth numeric;
    v_shelf_id uuid;
    v_template text;
    v_width_text text;
    v_position_text text;
    v_depth_text text;
    v_width numeric;
    v_position numeric;
    v_depth numeric;
    v_visual_width numeric;
    v_depth_span numeric;
    v_other_target jsonb;
    v_other_placement jsonb;
    v_other_visual_width numeric;
    v_other_depth_span numeric;
    v_source_lab_id uuid;
    v_source_owner_id uuid;
    v_source_cabinet_id uuid;
    v_source_location_id uuid;
    v_inventory_item_id uuid;
    v_cabinet_item_id uuid;
    v_item_name text;
    v_inventory_before jsonb;
    v_inventory_after jsonb;
    v_cabinet_item_before jsonb;
    v_cabinet_item_after jsonb;
    v_cabinet_item_source_cabinet_id uuid;
    v_receipt jsonb;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if p_request_id is null then
        raise exception 'request_id is required' using errcode = '22023';
    end if;
    if p_targets is null
       or jsonb_typeof(p_targets) <> 'array'
       or jsonb_array_length(p_targets) < 1
       or jsonb_array_length(p_targets) > 100 then
        raise exception 'targets must contain between 1 and 100 records' using errcode = '22023';
    end if;
    if octet_length(p_targets::text) > 262144 then
        raise exception 'targets payload must be 256 KiB or smaller' using errcode = '22023';
    end if;
    if p_destination is null or jsonb_typeof(p_destination) <> 'object' then
        raise exception 'destination must be a JSON object' using errcode = '22023';
    end if;

    select key
    into v_unknown_key
    from jsonb_object_keys(p_destination) destination_key(key)
    where key not in ('storage_type', 'cabinet_id', 'storage_location_id')
    limit 1;
    if found then
        raise exception 'Unsupported destination key: %', v_unknown_key using errcode = '22023';
    end if;

    v_destination_type := p_destination->>'storage_type';
    if v_destination_type not in ('cabinet', 'other') then
        raise exception 'destination.storage_type must be cabinet or other' using errcode = '22023';
    end if;

    if v_destination_type = 'cabinet' then
        if p_destination ? 'storage_location_id'
           or nullif(p_destination->>'cabinet_id', '') is null then
            raise exception 'Cabinet destination requires only cabinet_id' using errcode = '22023';
        end if;
        v_destination_cabinet_id := (p_destination->>'cabinet_id')::uuid;

        select c.lab_id, c.user_id, c.width, c.depth
        into
            v_destination_lab_id,
            v_destination_owner_id,
            v_destination_cabinet_width,
            v_destination_cabinet_depth
        from public.cabinets c
        where c.id = v_destination_cabinet_id
        for share;
        if not found then
            raise exception 'Destination cabinet not found: %', v_destination_cabinet_id using errcode = 'P0002';
        end if;
        if v_destination_cabinet_width is null or v_destination_cabinet_width <= 0
           or v_destination_cabinet_depth is null or v_destination_cabinet_depth <= 0 then
            raise exception 'Destination cabinet dimensions are invalid' using errcode = '22023';
        end if;

        v_normalized_destination := jsonb_build_object(
            'storage_type', 'cabinet',
            'cabinet_id', v_destination_cabinet_id
        );
    else
        if p_destination ? 'cabinet_id'
           or nullif(p_destination->>'storage_location_id', '') is null then
            raise exception 'Other-storage destination requires only storage_location_id' using errcode = '22023';
        end if;
        v_destination_location_id := (p_destination->>'storage_location_id')::uuid;

        select sl.lab_id, sl.user_id
        into v_destination_lab_id, v_destination_owner_id
        from public.storage_locations sl
        where sl.id = v_destination_location_id
        for share;
        if not found then
            raise exception 'Destination storage location not found: %', v_destination_location_id using errcode = 'P0002';
        end if;

        v_normalized_destination := jsonb_build_object(
            'storage_type', 'other',
            'storage_location_id', v_destination_location_id
        );
    end if;

    if v_destination_lab_id is null then
        if v_destination_owner_id is distinct from v_user_id then
            raise exception 'Destination is outside the personal scope' using errcode = '42501';
        end if;
    elsif not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = v_destination_lab_id
          and lm.user_id = v_user_id
    ) then
        raise exception 'Access denied for destination lab %', v_destination_lab_id using errcode = '42501';
    end if;

    -- Strictly normalize the entire payload before the idempotency lookup. A
    -- retry with changed targets, geometry, or destination cannot reuse a key.
    for v_target in select value from jsonb_array_elements(p_targets)
    loop
        if jsonb_typeof(v_target) <> 'object' then
            raise exception 'Every move target must be a JSON object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_target) target_key(key)
        where key not in ('item_id', 'item_source', 'placement')
        limit 1;
        if found then
            raise exception 'Unsupported move target key: %', v_unknown_key using errcode = '22023';
        end if;

        v_item_id := nullif(v_target->>'item_id', '')::uuid;
        v_item_source := v_target->>'item_source';
        if v_item_id is null or v_item_source not in ('inventory', 'cabinet_item') then
            raise exception 'Each target requires item_id and a valid item_source' using errcode = '22023';
        end if;
        if (v_item_source || ':' || v_item_id::text) = any(v_seen_keys) then
            raise exception 'Duplicate move target: %:%', v_item_source, v_item_id using errcode = '22023';
        end if;
        v_seen_keys := array_append(v_seen_keys, v_item_source || ':' || v_item_id::text);

        v_placement := v_target->'placement';
        if v_destination_type = 'other' then
            if v_item_source <> 'inventory' then
                raise exception 'Only inventory records can move to other storage' using errcode = '22023';
            end if;
            if v_target ? 'placement' then
                raise exception 'Other-storage targets must not contain placement' using errcode = '22023';
            end if;
            v_normalized_targets := v_normalized_targets || jsonb_build_array(
                jsonb_build_object('item_id', v_item_id, 'item_source', v_item_source)
            );
        else
            if v_placement is null or jsonb_typeof(v_placement) <> 'object' then
                raise exception 'Cabinet targets require a placement object' using errcode = '22023';
            end if;
            select key
            into v_unknown_key
            from jsonb_object_keys(v_placement) placement_key(key)
            where key not in ('shelf_id', 'template', 'width', 'position', 'depth_position')
            limit 1;
            if found then
                raise exception 'Unsupported placement key: %', v_unknown_key using errcode = '22023';
            end if;

            v_shelf_id := nullif(v_placement->>'shelf_id', '')::uuid;
            v_template := v_placement->>'template';
            v_width_text := v_placement->>'width';
            v_position_text := v_placement->>'position';
            v_depth_text := v_placement->>'depth_position';
            if v_shelf_id is null
               or v_template not in ('A', 'B', 'C', 'D')
               or v_width_text is null or v_width_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$'
               or v_position_text is null or v_position_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$'
               or v_depth_text is null or v_depth_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$' then
                raise exception 'Cabinet placement fields are invalid' using errcode = '22023';
            end if;
            v_width := v_width_text::numeric;
            v_position := v_position_text::numeric;
            v_depth := v_depth_text::numeric;
            if v_width <= 0 or v_width > 100
               or v_position < 0 or v_position > 100
               or v_position + v_width > 100
               or v_depth < 0 or v_depth > 100 then
                raise exception 'Cabinet placement geometry is outside the allowed range' using errcode = '22023';
            end if;
            if not exists (
                select 1
                from public.cabinet_shelves cs
                where cs.id = v_shelf_id
                  and cs.cabinet_id = v_destination_cabinet_id
            ) then
                raise exception 'Placement shelf is outside the destination cabinet' using errcode = '42501';
            end if;

            v_normalized_targets := v_normalized_targets || jsonb_build_array(
                jsonb_build_object(
                    'item_id', v_item_id,
                    'item_source', v_item_source,
                    'placement', jsonb_build_object(
                        'shelf_id', v_shelf_id,
                        'template', v_template,
                        'width', v_width,
                        'position', v_position,
                        'depth_position', v_depth
                    )
                )
            );
        end if;
    end loop;

    select coalesce(jsonb_agg(target.value order by
        target.value->>'item_source', target.value->>'item_id'
    ), '[]'::jsonb)
    into v_normalized_targets
    from jsonb_array_elements(v_normalized_targets) target(value);

    v_targets_hash := md5(v_normalized_targets::text);
    v_destination_hash := md5(v_normalized_destination::text);

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('inventory-move:' || p_request_id::text, 0)
    );

    select receipt_row.*
    into v_existing
    from public.inventory_move_receipts receipt_row
    where receipt_row.request_id = p_request_id;

    if found then
        if v_existing.actor_user_id is distinct from v_user_id
           or v_existing.targets_hash is distinct from v_targets_hash
           or v_existing.destination_hash is distinct from v_destination_hash then
            raise exception 'request_id was already used with a different inventory-move payload'
                using errcode = '23505';
        end if;
        return jsonb_set(v_existing.receipt, '{idempotent}', 'true'::jsonb, true);
    end if;

    if v_destination_type = 'cabinet' then
        -- Serialize geometry validation and insertion for this destination.
        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
                'inventory-move-destination-cabinet:' || v_destination_cabinet_id::text,
                0
            )
        );

        for v_target in select value from jsonb_array_elements(v_normalized_targets)
        loop
            v_placement := v_target->'placement';
            v_shelf_id := (v_placement->>'shelf_id')::uuid;
            v_template := v_placement->>'template';
            v_width := (v_placement->>'width')::numeric;
            v_position := (v_placement->>'position')::numeric;
            v_depth := (v_placement->>'depth_position')::numeric;
            v_visual_width := private.cabinet_visual_width_pct_v2(
                v_template, v_width, v_destination_cabinet_width
            );
            v_depth_span := private.cabinet_depth_pct_v2(
                v_template, v_width, v_destination_cabinet_depth
            );

            if v_position + v_width / 2 - v_visual_width / 2 < 0
               or v_position + v_width / 2 + v_visual_width / 2 > 100
               or v_depth - v_depth_span / 2 < 0
               or v_depth + v_depth_span / 2 > 100 then
                raise exception 'Cabinet placement physical bounds exceed the shelf'
                    using errcode = '22023';
            end if;

            if exists (
                select 1
                from public.cabinet_items ci
                where ci.cabinet_id = v_destination_cabinet_id
                  and ci.shelf_id = v_shelf_id
                  and not (
                      v_position + v_width / 2 + v_visual_width / 2
                          <= ci.position + ci.width / 2
                             - private.cabinet_visual_width_pct_v2(
                                 ci.template, ci.width, v_destination_cabinet_width
                             ) / 2
                      or v_position + v_width / 2 - v_visual_width / 2
                          >= ci.position + ci.width / 2
                             + private.cabinet_visual_width_pct_v2(
                                 ci.template, ci.width, v_destination_cabinet_width
                             ) / 2
                      or v_depth + v_depth_span / 2
                          <= coalesce(ci.depth_position, 50)
                             - private.cabinet_depth_pct_v2(
                                 ci.template, ci.width, v_destination_cabinet_depth
                             ) / 2
                      or v_depth - v_depth_span / 2
                          >= coalesce(ci.depth_position, 50)
                             + private.cabinet_depth_pct_v2(
                                 ci.template, ci.width, v_destination_cabinet_depth
                             ) / 2
                  )
            ) then
                raise exception 'Cabinet placement collides with an existing destination item'
                    using errcode = '22023';
            end if;

            for v_other_target in
                select other.value
                from jsonb_array_elements(v_normalized_targets) other(value)
                where ((other.value->>'item_source') || ':' || (other.value->>'item_id'))
                    < ((v_target->>'item_source') || ':' || (v_target->>'item_id'))
            loop
                v_other_placement := v_other_target->'placement';
                if v_other_placement->>'shelf_id' <> v_shelf_id::text then
                    continue;
                end if;
                v_other_visual_width := private.cabinet_visual_width_pct_v2(
                    v_other_placement->>'template',
                    (v_other_placement->>'width')::numeric,
                    v_destination_cabinet_width
                );
                v_other_depth_span := private.cabinet_depth_pct_v2(
                    v_other_placement->>'template',
                    (v_other_placement->>'width')::numeric,
                    v_destination_cabinet_depth
                );

                if not (
                    v_position + v_width / 2 + v_visual_width / 2
                        <= (v_other_placement->>'position')::numeric
                           + (v_other_placement->>'width')::numeric / 2
                           - v_other_visual_width / 2
                    or v_position + v_width / 2 - v_visual_width / 2
                        >= (v_other_placement->>'position')::numeric
                           + (v_other_placement->>'width')::numeric / 2
                           + v_other_visual_width / 2
                    or v_depth + v_depth_span / 2
                        <= (v_other_placement->>'depth_position')::numeric
                           - v_other_depth_span / 2
                    or v_depth - v_depth_span / 2
                        >= (v_other_placement->>'depth_position')::numeric
                           + v_other_depth_span / 2
                ) then
                    raise exception 'Cabinet placements in the move payload collide'
                        using errcode = '22023';
                end if;
            end loop;
        end loop;
    end if;

    -- Lock and authorize all source rows in canonical order before changing
    -- any row. Logical duplicates (an inventory row plus its placement) are
    -- rejected even if their source IDs differ.
    for v_target in select value from jsonb_array_elements(v_normalized_targets)
    loop
        v_item_id := (v_target->>'item_id')::uuid;
        v_item_source := v_target->>'item_source';
        v_inventory_item_id := null;
        v_cabinet_item_id := null;

        if v_item_source = 'inventory' then
            select i.lab_id, i.user_id, i.cabinet_id, i.storage_location_id
            into v_source_lab_id, v_source_owner_id, v_source_cabinet_id, v_source_location_id
            from public.inventory i
            where i.id = v_item_id
            for update;
            if not found then
                raise exception 'Inventory move source not found: %', v_item_id using errcode = 'P0002';
            end if;
            v_inventory_item_id := v_item_id;
        else
            select ci.inventory_item_id, ci.cabinet_id
            into v_inventory_item_id, v_source_cabinet_id
            from public.cabinet_items ci
            where ci.id = v_item_id
            for update;
            if not found then
                raise exception 'Cabinet move source not found: %', v_item_id using errcode = 'P0002';
            end if;
            v_cabinet_item_id := v_item_id;

            select c.lab_id, c.user_id
            into v_source_lab_id, v_source_owner_id
            from public.cabinets c
            where c.id = v_source_cabinet_id;
            if not found then
                raise exception 'Source cabinet not found: %', v_source_cabinet_id using errcode = 'P0002';
            end if;

            if v_inventory_item_id is not null then
                perform 1
                from public.inventory i
                where i.id = v_inventory_item_id
                  and i.lab_id is not distinct from v_source_lab_id
                  and i.cabinet_id is not distinct from v_source_cabinet_id
                for update;
                if not found then
                    raise exception 'Linked inventory row is outside the source cabinet scope'
                        using errcode = '42501';
                end if;
            end if;
        end if;

        if v_source_lab_id is distinct from v_destination_lab_id then
            raise exception 'Move source and destination are in different scopes' using errcode = '42501';
        end if;
        if v_source_lab_id is null and v_source_owner_id is distinct from v_user_id then
            raise exception 'Move source is outside the personal scope' using errcode = '42501';
        end if;
        if v_inventory_item_id is not null then
            if v_inventory_item_id = any(v_seen_inventory_ids) then
                raise exception 'Move targets refer to the same logical inventory record more than once'
                    using errcode = '22023';
            end if;
            v_seen_inventory_ids := array_append(v_seen_inventory_ids, v_inventory_item_id);
        end if;

        if v_destination_type = 'cabinet'
           and v_source_cabinet_id is not distinct from v_destination_cabinet_id then
            raise exception 'Move target is already in the destination cabinet' using errcode = '22023';
        elsif v_destination_type = 'other'
          and v_source_cabinet_id is null
          and v_source_location_id is not distinct from v_destination_location_id then
            raise exception 'Move target is already in the destination storage location' using errcode = '22023';
        end if;
    end loop;

    for v_target in select value from jsonb_array_elements(v_normalized_targets)
    loop
        v_item_id := (v_target->>'item_id')::uuid;
        v_item_source := v_target->>'item_source';
        v_placement := v_target->'placement';
        v_inventory_item_id := null;
        v_cabinet_item_id := null;
        v_cabinet_item_before := null;
        v_cabinet_item_after := null;
        v_inventory_before := null;
        v_inventory_after := null;
        v_cabinet_item_source_cabinet_id := null;

        if v_item_source = 'inventory' then
            select to_jsonb(i.*), i.name, i.cabinet_id, i.storage_location_id
            into v_inventory_before, v_item_name, v_source_cabinet_id, v_source_location_id
            from public.inventory i
            where i.id = v_item_id;
            v_inventory_item_id := v_item_id;

            select to_jsonb(ci.*), ci.id, ci.cabinet_id
            into v_cabinet_item_before, v_cabinet_item_id, v_cabinet_item_source_cabinet_id
            from public.cabinet_items ci
            where ci.inventory_item_id = v_inventory_item_id
            order by ci.created_at, ci.id
            limit 1;

            if v_destination_type = 'other' then
                if v_cabinet_item_id is not null then
                    delete from public.cabinet_items ci where ci.id = v_cabinet_item_id;
                end if;
                update public.inventory
                set storage_type = 'other',
                    cabinet_id = null,
                    storage_location_id = v_destination_location_id,
                    updated_at = now()
                where id = v_inventory_item_id;

                if v_cabinet_item_source_cabinet_id is not null then
                    insert into public.cabinet_activity_logs (
                        cabinet_id, action_type, item_name, reason, performed_by
                    ) values (
                        v_cabinet_item_source_cabinet_id, 'remove', v_item_name,
                        'Moved to another storage location through atomic bulk move', v_user_id
                    );
                end if;
                v_cabinet_item_after := null;
            else
                v_shelf_id := (v_placement->>'shelf_id')::uuid;
                v_template := v_placement->>'template';
                v_width := (v_placement->>'width')::numeric;
                v_position := (v_placement->>'position')::numeric;
                v_depth := (v_placement->>'depth_position')::numeric;

                if v_cabinet_item_id is null then
                    insert into public.cabinet_items (
                        inventory_item_id, cabinet_id, shelf_id, template,
                        name, width, position, depth_position,
                        expiry_date, capacity, product_number, brand, notes,
                        cas_no, remaining_percent
                    )
                    select
                        i.id, v_destination_cabinet_id, v_shelf_id, v_template,
                        i.name, v_width, v_position, v_depth,
                        i.expiry_date, i.capacity, i.product_number, i.brand, i.memo,
                        i.cas_number, i.remaining_percent
                    from public.inventory i
                    where i.id = v_inventory_item_id
                    returning id into v_cabinet_item_id;
                else
                    update public.cabinet_items
                    set cabinet_id = v_destination_cabinet_id,
                        shelf_id = v_shelf_id,
                        template = v_template,
                        width = v_width,
                        position = v_position,
                        depth_position = v_depth
                    where id = v_cabinet_item_id;
                end if;

                update public.inventory
                set storage_type = 'cabinet',
                    cabinet_id = v_destination_cabinet_id,
                    storage_location_id = null,
                    updated_at = now()
                where id = v_inventory_item_id;

                if v_cabinet_item_source_cabinet_id is not null then
                    insert into public.cabinet_activity_logs (
                        cabinet_id, action_type, item_name, reason, performed_by
                    ) values (
                        v_cabinet_item_source_cabinet_id, 'remove', v_item_name,
                        'Moved to another cabinet through atomic bulk move', v_user_id
                    );
                end if;
                insert into public.cabinet_activity_logs (
                    cabinet_id, action_type, item_name, reason, performed_by
                ) values (
                    v_destination_cabinet_id, 'add', v_item_name,
                    'Moved from inventory through atomic bulk move', v_user_id
                );

                select to_jsonb(ci.*)
                into v_cabinet_item_after
                from public.cabinet_items ci
                where ci.id = v_cabinet_item_id;
            end if;

            select to_jsonb(i.*)
            into v_inventory_after
            from public.inventory i
            where i.id = v_inventory_item_id;

            insert into public.audit_logs (
                actor_user_id, actor_name, lab_id, entity_type, entity_id,
                action, before_data, after_data, diff_data, source, request_id
            ) values (
                v_user_id,
                private.actor_display_name_v2(v_user_id, v_destination_lab_id),
                v_destination_lab_id,
                'inventory',
                v_inventory_item_id,
                'update',
                jsonb_build_object('inventory', v_inventory_before, 'cabinet_item', v_cabinet_item_before),
                jsonb_build_object('inventory', v_inventory_after, 'cabinet_item', v_cabinet_item_after),
                jsonb_build_object('destination', v_normalized_destination),
                'rpc',
                p_request_id
            );
        else
            select to_jsonb(ci.*), ci.inventory_item_id, ci.name, ci.cabinet_id
            into v_cabinet_item_before, v_inventory_item_id, v_item_name, v_source_cabinet_id
            from public.cabinet_items ci
            where ci.id = v_item_id;
            v_cabinet_item_id := v_item_id;

            if v_inventory_item_id is not null then
                select to_jsonb(i.*)
                into v_inventory_before
                from public.inventory i
                where i.id = v_inventory_item_id;
            end if;

            v_shelf_id := (v_placement->>'shelf_id')::uuid;
            v_template := v_placement->>'template';
            v_width := (v_placement->>'width')::numeric;
            v_position := (v_placement->>'position')::numeric;
            v_depth := (v_placement->>'depth_position')::numeric;

            update public.cabinet_items
            set cabinet_id = v_destination_cabinet_id,
                shelf_id = v_shelf_id,
                template = v_template,
                width = v_width,
                position = v_position,
                depth_position = v_depth
            where id = v_cabinet_item_id;

            if v_inventory_item_id is not null then
                update public.inventory
                set storage_type = 'cabinet',
                    cabinet_id = v_destination_cabinet_id,
                    storage_location_id = null,
                    updated_at = now()
                where id = v_inventory_item_id;
                select to_jsonb(i.*)
                into v_inventory_after
                from public.inventory i
                where i.id = v_inventory_item_id;
            end if;

            select to_jsonb(ci.*)
            into v_cabinet_item_after
            from public.cabinet_items ci
            where ci.id = v_cabinet_item_id;

            insert into public.cabinet_activity_logs (
                cabinet_id, action_type, item_name, reason, performed_by
            ) values
                (v_source_cabinet_id, 'remove', v_item_name,
                    'Moved to another cabinet through atomic bulk move', v_user_id),
                (v_destination_cabinet_id, 'add', v_item_name,
                    'Moved from another cabinet through atomic bulk move', v_user_id);

            insert into public.audit_logs (
                actor_user_id, actor_name, lab_id, entity_type, entity_id,
                action, before_data, after_data, diff_data, source, request_id
            ) values (
                v_user_id,
                private.actor_display_name_v2(v_user_id, v_destination_lab_id),
                v_destination_lab_id,
                'cabinet_item',
                v_cabinet_item_id,
                'update',
                jsonb_build_object('cabinet_item', v_cabinet_item_before, 'inventory', v_inventory_before),
                jsonb_build_object('cabinet_item', v_cabinet_item_after, 'inventory', v_inventory_after),
                jsonb_build_object('destination', v_normalized_destination),
                'rpc',
                p_request_id
            );
        end if;

        v_moved_items := v_moved_items || jsonb_build_array(jsonb_build_object(
            'item_id', v_item_id,
            'item_source', v_item_source,
            'inventory_item_id', v_inventory_item_id,
            'cabinet_item_id', v_cabinet_item_id,
            'source', case
                when v_item_source = 'inventory' then jsonb_build_object(
                    'storage_type', v_inventory_before->>'storage_type',
                    'cabinet_id', v_inventory_before->'cabinet_id',
                    'storage_location_id', v_inventory_before->'storage_location_id'
                )
                else jsonb_build_object(
                    'storage_type', 'cabinet',
                    'cabinet_id', v_cabinet_item_before->'cabinet_id'
                )
            end,
            'destination', v_normalized_destination
        ));
    end loop;

    if jsonb_array_length(v_moved_items) <> jsonb_array_length(v_normalized_targets) then
        raise exception 'Atomic move did not produce an exact receipt' using errcode = 'P0001';
    end if;

    v_receipt := jsonb_build_object(
        'request_id', p_request_id,
        'moved_count', jsonb_array_length(v_moved_items),
        'moved_items', v_moved_items,
        'destination', v_normalized_destination,
        'idempotent', false
    );

    insert into public.inventory_move_receipts (
        request_id, actor_user_id, targets_hash, destination_hash, receipt
    ) values (
        p_request_id, v_user_id, v_targets_hash, v_destination_hash, v_receipt
    );

    return v_receipt;
end;
$$;

revoke all on function public.remove_inventory_record_v2(jsonb, uuid, text, text) from public, anon;
revoke all on function public.record_inventory_disposal_v2(uuid, jsonb, jsonb, uuid, text) from public, anon;
revoke all on function public.record_inventory_usage_completion_v2(uuid, uuid, text) from public, anon;
revoke all on function public.move_inventory_records_v2(jsonb, jsonb, uuid) from public, anon;

grant execute on function public.remove_inventory_record_v2(jsonb, uuid, text, text)
    to authenticated, service_role;
grant execute on function public.record_inventory_disposal_v2(uuid, jsonb, jsonb, uuid, text)
    to authenticated, service_role;
grant execute on function public.record_inventory_usage_completion_v2(uuid, uuid, text)
    to authenticated, service_role;
grant execute on function public.move_inventory_records_v2(jsonb, jsonb, uuid)
    to authenticated, service_role;

comment on function public.record_inventory_usage_completion_v2(uuid, uuid, text) is
'Records one fully used or empty linked cabinet container. Decrements inventory by exactly one, removes inventory and placement only at zero, writes activity/audit records, and never creates a waste log.';

comment on function public.move_inventory_records_v2(jsonb, jsonb, uuid) is
'Moves 1..100 inventory/cabinet records in one authenticated transaction. Validates exact scope, destination, cabinet shelf geometry, and idempotency before returning an exact receipt.';

commit;
