-- Transactional checks for public.save_cabinet_state_atomic. The final rollback
-- leaves the database unchanged.

begin;

insert into auth.users (id, email, raw_user_meta_data)
values (
    '10000000-0000-4000-8000-000000000001'::uuid,
    'cabinet-save@example.test',
    '{"name":"Cabinet save test actor"}'::jsonb
);

insert into public.labs (id, name, created_by)
values (
    '10000000-0000-4000-8000-000000000002'::uuid,
    'Atomic cabinet save test lab',
    '10000000-0000-4000-8000-000000000001'::uuid
);

insert into public.lab_members (lab_id, user_id, role, nickname)
values (
    '10000000-0000-4000-8000-000000000002'::uuid,
    '10000000-0000-4000-8000-000000000001'::uuid,
    'student',
    'Cabinet save test actor'
);

insert into public.cabinets (id, lab_id, user_id, name, width, height, depth)
values (
    '10000000-0000-4000-8000-000000000003'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid,
    '10000000-0000-4000-8000-000000000001'::uuid,
    'Atomic save test cabinet',
    5,
    9,
    2
);

select set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-8000-000000000001',
    true
);
set local role authenticated;

select public.save_cabinet_state_atomic(
    '10000000-0000-4000-8000-000000000003'::uuid,
    jsonb_build_array(jsonb_build_object(
        'id', '10000000-0000-4000-8000-000000000004',
        'level', 1,
        'dividers', jsonb_build_array(50),
        'items', jsonb_build_array(jsonb_build_object(
            'id', '10000000-0000-4000-8000-000000000005',
            'template', 'A',
            'name', 'Acetone',
            'width', 8,
            'position', 40,
            'depth_position', 50,
            'cas_no', '67-64-1',
            'remaining_percent', 75
        ))
    )),
    6,
    10,
    3
);

do $$
begin
    if not exists (
        select 1
        from public.cabinet_shelves cs
        where cs.id = '10000000-0000-4000-8000-000000000004'::uuid
          and cs.cabinet_id = '10000000-0000-4000-8000-000000000003'::uuid
          and cs.level = 1
          and cs.dividers = '[50]'::jsonb
    ) then
        raise exception 'atomic cabinet save did not persist the shelf';
    end if;

    if not exists (
        select 1
        from public.cabinet_items ci
        where ci.id = '10000000-0000-4000-8000-000000000005'::uuid
          and ci.shelf_id = '10000000-0000-4000-8000-000000000004'::uuid
          and ci.position = 40
          and ci.remaining_percent = 75
    ) then
        raise exception 'atomic cabinet save did not persist the item';
    end if;

    if not exists (
        select 1
        from public.cabinets c
        where c.id = '10000000-0000-4000-8000-000000000003'::uuid
          and c.width = 6
          and c.height = 10
          and c.depth = 3
    ) then
        raise exception 'atomic cabinet save did not persist cabinet dimensions';
    end if;
end;
$$;

do $$
declare
    v_failed boolean := false;
begin
    begin
        perform public.save_cabinet_state_atomic(
            '10000000-0000-4000-8000-000000000003'::uuid,
            jsonb_build_array(jsonb_build_object(
                'id', '10000000-0000-4000-8000-000000000004',
                'level', 7,
                'dividers', '[]'::jsonb,
                'items', jsonb_build_array(jsonb_build_object(
                    'id', '10000000-0000-4000-8000-000000000005',
                    'template', 'A',
                    'name', 'Acetone',
                    'width', 8,
                    'position', 70,
                    'depth_position', 50,
                    'expiry_date', 'not-a-date'
                ))
            )),
            7,
            11,
            4
        );
    exception
        when others then
            v_failed := true;
    end;

    if not v_failed then
        raise exception 'invalid cabinet payload unexpectedly succeeded';
    end if;

    if not exists (
        select 1
        from public.cabinet_shelves cs
        where cs.id = '10000000-0000-4000-8000-000000000004'::uuid
          and cs.level = 1
    ) then
        raise exception 'failed save did not roll back the shelf update';
    end if;

    if not exists (
        select 1
        from public.cabinet_items ci
        where ci.id = '10000000-0000-4000-8000-000000000005'::uuid
          and ci.position = 40
    ) then
        raise exception 'failed save did not roll back the item update';
    end if;

    if not exists (
        select 1
        from public.cabinets c
        where c.id = '10000000-0000-4000-8000-000000000003'::uuid
          and c.width = 6
          and c.height = 10
          and c.depth = 3
    ) then
        raise exception 'failed save did not preserve cabinet dimensions';
    end if;
end;
$$;

reset role;
rollback;
