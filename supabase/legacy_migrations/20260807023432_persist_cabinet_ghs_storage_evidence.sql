-- Keep authoritative storage evidence with the cabinet item. Legacy rows are
-- intentionally left as an empty, not-verified state and are re-enriched by
-- the client when a CAS number is available.
alter table public.cabinet_items
    add column if not exists h_codes jsonb not null default '[]'::jsonb,
    add column if not exists ghs_status text,
    add column if not exists ghs_checked_at timestamptz;

alter table public.cabinet_items
    drop constraint if exists cabinet_items_h_codes_array_check;

alter table public.cabinet_items
    add constraint cabinet_items_h_codes_array_check
    check (jsonb_typeof(h_codes) = 'array');

alter table public.cabinet_items
    drop constraint if exists cabinet_items_ghs_status_check;

alter table public.cabinet_items
    add constraint cabinet_items_ghs_status_check
    check (
        ghs_status is null
        or ghs_status in (
            'not_checked', 'pending', 'success', 'no_ghs',
            'not_found', 'transient_error', 'invalid_cas'
        )
    );

-- The existing atomic writer remains the validation and layout authority. This
-- wrapper updates the new evidence columns in the same transaction so a
-- failed evidence write rolls back the layout write as well.
create or replace function public.save_cabinet_state_with_ghs(
    p_cabinet_id uuid,
    p_shelves jsonb,
    p_width integer,
    p_height integer,
    p_depth integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_shelf jsonb;
    v_item jsonb;
    v_item_id uuid;
    v_h_codes jsonb;
    v_ghs_status text;
begin
    perform public.save_cabinet_state_atomic(
        p_cabinet_id,
        p_shelves,
        p_width,
        p_height,
        p_depth
    );

    for v_shelf in
        select value from jsonb_array_elements(p_shelves)
    loop
        for v_item in
            select value from jsonb_array_elements(v_shelf->'items')
        loop
            begin
                v_item_id := (v_item->>'id')::uuid;
            exception
                when invalid_text_representation or null_value_not_allowed then
                    raise exception 'Cabinet item id must be valid' using errcode = '22023';
            end;

            v_h_codes := coalesce(v_item->'h_codes', '[]'::jsonb);
            if jsonb_typeof(v_h_codes) is distinct from 'array' then
                raise exception 'Cabinet item h_codes must be a JSON array' using errcode = '22023';
            end if;

            v_ghs_status := nullif(trim(v_item->>'ghs_status'), '');
            if v_ghs_status is not null and v_ghs_status not in (
                'not_checked', 'pending', 'success', 'no_ghs',
                'not_found', 'transient_error', 'invalid_cas'
            ) then
                raise exception 'Unsupported cabinet item ghs_status: %', v_ghs_status
                    using errcode = '22023';
            end if;

            update public.cabinet_items
            set h_codes = v_h_codes,
                ghs_status = v_ghs_status,
                ghs_checked_at = nullif(trim(v_item->>'ghs_checked_at'), '')::timestamptz
            where id = v_item_id
              and cabinet_id = p_cabinet_id;

            if not found then
                raise exception 'Cabinet item not found or access denied: %', v_item_id
                    using errcode = 'P0002';
            end if;
        end loop;
    end loop;
end;
$$;

revoke all on function public.save_cabinet_state_with_ghs(uuid, jsonb, integer, integer, integer)
    from public, anon;
grant execute on function public.save_cabinet_state_with_ghs(uuid, jsonb, integer, integer, integer)
    to authenticated;
