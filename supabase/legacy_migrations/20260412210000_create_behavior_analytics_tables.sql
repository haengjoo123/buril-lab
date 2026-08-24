create or replace function public.analytics_normalize_text(input text)
returns text
language sql
immutable
as $$
    select nullif(lower(trim(regexp_replace(coalesce(input, ''), '\s+', ' ', 'g'))), '');
$$;

create or replace function public.analytics_normalize_cas(input text)
returns text
language sql
immutable
as $$
    select nullif(regexp_replace(coalesce(input, ''), '[^0-9-]', '', 'g'), '');
$$;

create table if not exists public.commerce_intent_events (
    id uuid primary key default gen_random_uuid(),
    event_type text not null check (
        event_type in (
            'inventory_registered',
            'inventory_updated',
            'cabinet_item_placed',
            'cabinet_item_scanned',
            'cabinet_item_updated'
        )
    ),
    source_screen text,
    storage_type text check (storage_type in ('cabinet', 'other')),
    product_id uuid references public.products (id) on delete set null,
    source_item_type text check (source_item_type in ('inventory', 'cabinet_item', 'product')),
    source_item_id uuid,
    brand_name text,
    brand_normalized text,
    product_number text,
    quantity integer,
    capacity_text text,
    capacity_value numeric,
    capacity_unit text,
    capacity_ml numeric,
    cas_number text,
    cas_number_normalized text,
    cas_input_method text not null default 'unknown' check (
        cas_input_method in ('manual', 'catalog', 'scan', 'ocr', 'voice', 'unknown')
    ),
    metadata jsonb not null default '{}'::jsonb,
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    lab_id uuid references public.labs (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint commerce_intent_events_quantity_check
        check (quantity is null or quantity > 0),
    constraint commerce_intent_events_capacity_value_check
        check (capacity_value is null or capacity_value >= 0),
    constraint commerce_intent_events_capacity_ml_check
        check (capacity_ml is null or capacity_ml >= 0)
);

create index if not exists commerce_intent_events_user_created_at_idx
    on public.commerce_intent_events (user_id, created_at desc);

create index if not exists commerce_intent_events_lab_created_at_idx
    on public.commerce_intent_events (lab_id, created_at desc);

create index if not exists commerce_intent_events_type_created_at_idx
    on public.commerce_intent_events (event_type, created_at desc);

create index if not exists commerce_intent_events_brand_idx
    on public.commerce_intent_events (brand_normalized, created_at desc)
    where brand_normalized is not null;

create index if not exists commerce_intent_events_capacity_ml_idx
    on public.commerce_intent_events (capacity_ml, created_at desc)
    where capacity_ml is not null;

create index if not exists commerce_intent_events_cas_idx
    on public.commerce_intent_events (cas_number_normalized, created_at desc)
    where cas_number_normalized is not null;

create index if not exists commerce_intent_events_product_idx
    on public.commerce_intent_events (product_id, created_at desc)
    where product_id is not null;

create table if not exists public.safety_compliance_events (
    id uuid primary key default gen_random_uuid(),
    event_type text not null check (
        event_type in (
            'storage_warning_ignored',
            'ai_disposal_guide_viewed'
        )
    ),
    source_screen text,
    trigger_source text,
    warning_severity text check (warning_severity in ('DANGER', 'WARNING')),
    rule_id text,
    message_key text,
    cabinet_id uuid references public.cabinets (id) on delete set null,
    shelf_id uuid references public.cabinet_shelves (id) on delete set null,
    primary_chemical_name text,
    primary_chemical_name_normalized text,
    primary_cas_number text,
    primary_cas_number_normalized text,
    secondary_chemical_name text,
    secondary_chemical_name_normalized text,
    secondary_cas_number text,
    secondary_cas_number_normalized text,
    guide_scope text check (guide_scope in ('single', 'mixture')),
    metadata jsonb not null default '{}'::jsonb,
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    lab_id uuid references public.labs (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint safety_compliance_events_storage_warning_fields_check
        check (
            event_type <> 'storage_warning_ignored'
            or (
                rule_id is not null
                and warning_severity is not null
                and primary_chemical_name is not null
                and secondary_chemical_name is not null
            )
        ),
    constraint safety_compliance_events_ai_guide_fields_check
        check (
            event_type <> 'ai_disposal_guide_viewed'
            or primary_chemical_name is not null
        )
);

create index if not exists safety_compliance_events_user_created_at_idx
    on public.safety_compliance_events (user_id, created_at desc);

create index if not exists safety_compliance_events_lab_created_at_idx
    on public.safety_compliance_events (lab_id, created_at desc);

create index if not exists safety_compliance_events_type_created_at_idx
    on public.safety_compliance_events (event_type, created_at desc);

create index if not exists safety_compliance_events_cabinet_created_at_idx
    on public.safety_compliance_events (cabinet_id, created_at desc)
    where cabinet_id is not null;

create index if not exists safety_compliance_events_rule_idx
    on public.safety_compliance_events (rule_id, created_at desc)
    where rule_id is not null;

create index if not exists safety_compliance_events_primary_name_idx
    on public.safety_compliance_events (primary_chemical_name_normalized, created_at desc)
    where primary_chemical_name_normalized is not null;

create index if not exists safety_compliance_events_primary_cas_idx
    on public.safety_compliance_events (primary_cas_number_normalized, created_at desc)
    where primary_cas_number_normalized is not null;

create or replace function public.commerce_intent_events_set_normalized_fields()
returns trigger
language plpgsql
as $$
begin
    new.brand_normalized := public.analytics_normalize_text(new.brand_name);
    new.cas_number_normalized := public.analytics_normalize_cas(new.cas_number);
    return new;
end;
$$;

create or replace function public.safety_compliance_events_set_normalized_fields()
returns trigger
language plpgsql
as $$
begin
    new.primary_chemical_name_normalized := public.analytics_normalize_text(new.primary_chemical_name);
    new.primary_cas_number_normalized := public.analytics_normalize_cas(new.primary_cas_number);
    new.secondary_chemical_name_normalized := public.analytics_normalize_text(new.secondary_chemical_name);
    new.secondary_cas_number_normalized := public.analytics_normalize_cas(new.secondary_cas_number);
    return new;
end;
$$;

drop trigger if exists commerce_intent_events_before_write on public.commerce_intent_events;
create trigger commerce_intent_events_before_write
before insert or update on public.commerce_intent_events
for each row
execute function public.commerce_intent_events_set_normalized_fields();

drop trigger if exists safety_compliance_events_before_write on public.safety_compliance_events;
create trigger safety_compliance_events_before_write
before insert or update on public.safety_compliance_events
for each row
execute function public.safety_compliance_events_set_normalized_fields();

alter table public.commerce_intent_events enable row level security;
alter table public.safety_compliance_events enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'commerce_intent_events'
          and policyname = 'commerce_intent_events_select_accessible'
    ) then
        create policy commerce_intent_events_select_accessible
            on public.commerce_intent_events
            for select
            to authenticated
            using (
                auth.uid() = user_id
                or (
                    lab_id is not null
                    and exists (
                        select 1
                        from public.lab_members
                        where lab_members.lab_id = commerce_intent_events.lab_id
                          and lab_members.user_id = auth.uid()
                    )
                )
            );
    end if;

    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'commerce_intent_events'
          and policyname = 'commerce_intent_events_insert_accessible'
    ) then
        create policy commerce_intent_events_insert_accessible
            on public.commerce_intent_events
            for insert
            to authenticated
            with check (
                auth.uid() = coalesce(user_id, auth.uid())
                and (
                    lab_id is null
                    or exists (
                        select 1
                        from public.lab_members
                        where lab_members.lab_id = commerce_intent_events.lab_id
                          and lab_members.user_id = auth.uid()
                    )
                )
            );
    end if;

    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'safety_compliance_events'
          and policyname = 'safety_compliance_events_select_accessible'
    ) then
        create policy safety_compliance_events_select_accessible
            on public.safety_compliance_events
            for select
            to authenticated
            using (
                auth.uid() = user_id
                or (
                    lab_id is not null
                    and exists (
                        select 1
                        from public.lab_members
                        where lab_members.lab_id = safety_compliance_events.lab_id
                          and lab_members.user_id = auth.uid()
                    )
                )
            );
    end if;

    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'safety_compliance_events'
          and policyname = 'safety_compliance_events_insert_accessible'
    ) then
        create policy safety_compliance_events_insert_accessible
            on public.safety_compliance_events
            for insert
            to authenticated
            with check (
                auth.uid() = coalesce(user_id, auth.uid())
                and (
                    lab_id is null
                    or exists (
                        select 1
                        from public.lab_members
                        where lab_members.lab_id = safety_compliance_events.lab_id
                          and lab_members.user_id = auth.uid()
                    )
                )
            );
    end if;
end
$$;
