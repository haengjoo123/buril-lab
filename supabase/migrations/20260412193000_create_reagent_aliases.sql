create table if not exists public.reagent_aliases (
    id uuid primary key default gen_random_uuid(),
    source_item_type text not null check (source_item_type in ('cabinet_item', 'inventory')),
    source_item_id uuid not null,
    canonical_name text not null,
    alias text not null,
    normalized_alias text not null,
    cas_number text,
    metadata jsonb not null default '{}'::jsonb,
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    lab_id uuid references public.labs (id) on delete set null,
    created_at timestamptz not null default now()
);

create unique index if not exists reagent_aliases_unique_source_alias_idx
    on public.reagent_aliases (source_item_type, source_item_id, normalized_alias);

create index if not exists reagent_aliases_lab_alias_idx
    on public.reagent_aliases (lab_id, normalized_alias);

create index if not exists reagent_aliases_source_item_idx
    on public.reagent_aliases (source_item_type, source_item_id);

insert into public.reagent_aliases (
    source_item_type,
    source_item_id,
    canonical_name,
    alias,
    normalized_alias,
    cas_number,
    user_id,
    lab_id,
    metadata
)
select distinct
    seed.source_item_type,
    seed.source_item_id,
    seed.canonical_name,
    seed.alias,
    lower(trim(regexp_replace(seed.alias, '\s+', ' ', 'g'))) as normalized_alias,
    seed.cas_number,
    seed.user_id,
    seed.lab_id,
    jsonb_build_object('seeded_by', 'migration')
from (
    select
        'inventory'::text as source_item_type,
        inventory.id as source_item_id,
        inventory.name as canonical_name,
        inventory.name as alias,
        inventory.cas_number,
        coalesce(inventory.user_id, auth.uid()) as user_id,
        inventory.lab_id
    from public.inventory
    where nullif(trim(inventory.name), '') is not null

    union all

    select
        'inventory'::text,
        inventory.id,
        inventory.name,
        inventory.cas_number,
        inventory.cas_number,
        coalesce(inventory.user_id, auth.uid()),
        inventory.lab_id
    from public.inventory
    where nullif(trim(inventory.cas_number), '') is not null

    union all

    select
        'inventory'::text,
        inventory.id,
        inventory.name,
        inventory.product_number,
        inventory.cas_number,
        coalesce(inventory.user_id, auth.uid()),
        inventory.lab_id
    from public.inventory
    where nullif(trim(inventory.product_number), '') is not null

    union all

    select
        'cabinet_item'::text as source_item_type,
        cabinet_items.id as source_item_id,
        cabinet_items.name as canonical_name,
        cabinet_items.name as alias,
        cabinet_items.cas_no as cas_number,
        coalesce(cabinets.user_id, auth.uid()) as user_id,
        cabinets.lab_id
    from public.cabinet_items
    join public.cabinets on cabinets.id = cabinet_items.cabinet_id
    where nullif(trim(cabinet_items.name), '') is not null

    union all

    select
        'cabinet_item'::text,
        cabinet_items.id,
        cabinet_items.name,
        cabinet_items.cas_no,
        cabinet_items.cas_no,
        coalesce(cabinets.user_id, auth.uid()),
        cabinets.lab_id
    from public.cabinet_items
    join public.cabinets on cabinets.id = cabinet_items.cabinet_id
    where nullif(trim(cabinet_items.cas_no), '') is not null

    union all

    select
        'cabinet_item'::text,
        cabinet_items.id,
        cabinet_items.name,
        cabinet_items.product_number,
        cabinet_items.cas_no,
        coalesce(cabinets.user_id, auth.uid()),
        cabinets.lab_id
    from public.cabinet_items
    join public.cabinets on cabinets.id = cabinet_items.cabinet_id
    where nullif(trim(cabinet_items.product_number), '') is not null
) as seed
where nullif(trim(seed.alias), '') is not null
on conflict (source_item_type, source_item_id, normalized_alias) do nothing;

alter table public.reagent_aliases enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'reagent_aliases'
          and policyname = 'reagent_aliases_select_accessible'
    ) then
        create policy reagent_aliases_select_accessible
            on public.reagent_aliases
            for select
            to authenticated
            using (
                auth.uid() = user_id
                or (
                    lab_id is not null
                    and exists (
                        select 1
                        from public.lab_members
                        where lab_members.lab_id = reagent_aliases.lab_id
                          and lab_members.user_id = auth.uid()
                    )
                )
            );
    end if;

    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'reagent_aliases'
          and policyname = 'reagent_aliases_insert_accessible'
    ) then
        create policy reagent_aliases_insert_accessible
            on public.reagent_aliases
            for insert
            to authenticated
            with check (
                auth.uid() = coalesce(user_id, auth.uid())
                and (
                    lab_id is null
                    or exists (
                        select 1
                        from public.lab_members
                        where lab_members.lab_id = reagent_aliases.lab_id
                          and lab_members.user_id = auth.uid()
                    )
                )
            );
    end if;
end
$$;
