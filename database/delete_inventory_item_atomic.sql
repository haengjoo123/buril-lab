-- Atomic delete RPC for inventory domain
-- Apply in Supabase SQL editor before deploying frontend changes.

create or replace function public.delete_inventory_item_atomic(
    p_item_id uuid,
    p_item_source text,
    p_item_name text,
    p_lab_id uuid default null,
    p_cabinet_id uuid default null,
    p_cabinet_name text default null,
    p_storage_location_name text default null,
    p_disposal_reason text default '재고 목록에서 삭제'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_item_name text := p_item_name;
    v_brand text := null;
    v_product_number text := null;
    v_cas text := null;
    v_capacity text := null;
    v_quantity integer := 1;
    v_storage_type text := 'other';
    v_location text := coalesce(p_storage_location_name, '기타 보관장소');
    v_cabinet_id uuid := p_cabinet_id;
    v_lab_id uuid := p_lab_id;
    v_match_cabinet_item_id uuid := null;
    v_chemical jsonb;
begin
    if p_item_source not in ('inventory', 'cabinet_item') then
        raise exception 'Unsupported item source: %', p_item_source;
    end if;

    if p_item_source = 'inventory' then
        select
            i.name,
            i.brand,
            i.product_number,
            i.cas_number,
            i.capacity,
            i.quantity,
            i.storage_type,
            i.cabinet_id,
            i.lab_id
        into
            v_item_name,
            v_brand,
            v_product_number,
            v_cas,
            v_capacity,
            v_quantity,
            v_storage_type,
            v_cabinet_id,
            v_lab_id
        from inventory i
        where i.id = p_item_id
        for update;

        if not found then
            raise exception 'Inventory row not found: %', p_item_id;
        end if;

        if v_storage_type = 'cabinet' and v_cabinet_id is not null then
            v_location := coalesce(p_cabinet_name, '시약장');

            select ci.id
            into v_match_cabinet_item_id
            from cabinet_items ci
            where ci.cabinet_id = v_cabinet_id
              and lower(trim(coalesce(ci.name, ''))) = lower(trim(coalesce(v_item_name, '')))
              and (
                    v_product_number is null
                    or lower(trim(coalesce(ci.product_number, ''))) = lower(trim(v_product_number))
                  )
              and (
                    v_brand is null
                    or lower(trim(coalesce(ci.brand, ''))) = lower(trim(v_brand))
                  )
              and (
                    v_capacity is null
                    or lower(trim(coalesce(ci.capacity, ''))) = lower(trim(v_capacity))
                  )
            order by ci.created_at asc
            limit 1;

            if v_match_cabinet_item_id is null then
                select ci.id
                into v_match_cabinet_item_id
                from cabinet_items ci
                where ci.cabinet_id = v_cabinet_id
                  and lower(trim(coalesce(ci.name, ''))) = lower(trim(coalesce(v_item_name, '')))
                order by ci.created_at asc
                limit 1;
            end if;

            if v_match_cabinet_item_id is not null then
                delete from cabinet_items where id = v_match_cabinet_item_id;
            end if;

            insert into cabinet_disposal_logs (cabinet_id, item_name, reason, disposed_by)
            values (v_cabinet_id, v_item_name, coalesce(p_disposal_reason, '단순 삭제'), v_user_id);

            insert into cabinet_activity_logs (cabinet_id, action_type, item_name, reason, performed_by)
            values (v_cabinet_id, 'remove', v_item_name, coalesce(p_disposal_reason, '단순 삭제'), v_user_id);
        end if;

        delete from inventory where id = p_item_id;
    else
        select
            ci.name,
            ci.brand,
            ci.product_number,
            ci.cas_no,
            ci.capacity,
            ci.cabinet_id
        into
            v_item_name,
            v_brand,
            v_product_number,
            v_cas,
            v_capacity,
            v_cabinet_id
        from cabinet_items ci
        where ci.id = p_item_id
        for update;

        if not found then
            raise exception 'Cabinet item row not found: %', p_item_id;
        end if;

        v_storage_type := 'cabinet';
        v_location := coalesce(p_cabinet_name, '시약장');

        delete from cabinet_items where id = p_item_id;

        if v_cabinet_id is not null then
            insert into cabinet_disposal_logs (cabinet_id, item_name, reason, disposed_by)
            values (v_cabinet_id, v_item_name, coalesce(p_disposal_reason, '단순 삭제'), v_user_id);

            insert into cabinet_activity_logs (cabinet_id, action_type, item_name, reason, performed_by)
            values (v_cabinet_id, 'remove', v_item_name, coalesce(p_disposal_reason, '단순 삭제'), v_user_id);
        end if;
    end if;

    v_chemical := jsonb_build_object(
        'id', p_item_id::text,
        'name', coalesce(v_item_name, p_item_name),
        'brand', v_brand,
        'product_number', v_product_number,
        'cas_number', v_cas,
        'quantity', coalesce(v_quantity, 1),
        'capacity', v_capacity,
        'storage_type', v_storage_type,
        'deleted_location', v_location
    );

    begin
        insert into waste_logs (user_id, lab_id, chemicals, disposal_category, handler_name, memo)
        values (
            v_user_id,
            v_lab_id,
            jsonb_build_array(v_chemical),
            coalesce(v_item_name, p_item_name),
            null,
            coalesce(p_disposal_reason, '단순 삭제')
        );
    exception
        when undefined_column then
            insert into waste_logs (user_id, lab_id, chemicals, disposal_category, memo)
            values (
                v_user_id,
                v_lab_id,
                jsonb_build_array(v_chemical),
                coalesce(v_item_name, p_item_name),
                coalesce(p_disposal_reason, '단순 삭제')
            );
    end;
end;
$$;

comment on function public.delete_inventory_item_atomic is
'Atomically deletes inventory/cabinet item and writes cabinet + waste logs.';
