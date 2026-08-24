insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
) values (
    'safety-center-verifications',
    'safety-center-verifications',
    false,
    10485760,
    array[
        'application/pdf',
        'application/x-hwp',
        'application/haansofthwp',
        'application/vnd.hancom.hwp',
        'application/vnd.hancom.hwpx',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg'
    ]::text[]
)
on conflict (id) do update
set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.safety_centers
    add column if not exists verification_document_path text,
    add column if not exists verification_document_name text,
    add column if not exists verification_document_mime_type text,
    add column if not exists verification_document_size bigint
        check (verification_document_size is null or verification_document_size between 1 and 10485760),
    add column if not exists verification_document_uploaded_at timestamptz;

drop policy if exists safety_center_verifications_insert_member on storage.objects;
create policy safety_center_verifications_insert_member
    on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'safety-center-verifications'
        and auth.uid()::text = (storage.foldername(name))[1]
        and exists (
            select 1
            from public.safety_center_members scm
            join public.safety_centers sc on sc.id = scm.center_id
            where scm.center_id::text = (storage.foldername(name))[2]
              and scm.user_id = auth.uid()
              and scm.role in ('owner', 'manager')
              and sc.status in ('pending', 'rejected')
        )
    );

drop policy if exists safety_center_verifications_update_member on storage.objects;
create policy safety_center_verifications_update_member
    on storage.objects
    for update to authenticated
    using (
        bucket_id = 'safety-center-verifications'
        and auth.uid()::text = (storage.foldername(name))[1]
        and exists (
            select 1
            from public.safety_center_members scm
            join public.safety_centers sc on sc.id = scm.center_id
            where scm.center_id::text = (storage.foldername(name))[2]
              and scm.user_id = auth.uid()
              and scm.role in ('owner', 'manager')
              and sc.status in ('pending', 'rejected')
        )
    )
    with check (
        bucket_id = 'safety-center-verifications'
        and auth.uid()::text = (storage.foldername(name))[1]
        and exists (
            select 1
            from public.safety_center_members scm
            join public.safety_centers sc on sc.id = scm.center_id
            where scm.center_id::text = (storage.foldername(name))[2]
              and scm.user_id = auth.uid()
              and scm.role in ('owner', 'manager')
              and sc.status in ('pending', 'rejected')
        )
    );

drop policy if exists safety_center_verifications_delete_member on storage.objects;
create policy safety_center_verifications_delete_member
    on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'safety-center-verifications'
        and auth.uid()::text = (storage.foldername(name))[1]
        and exists (
            select 1
            from public.safety_center_members scm
            join public.safety_centers sc on sc.id = scm.center_id
            where scm.center_id::text = (storage.foldername(name))[2]
              and scm.user_id = auth.uid()
              and scm.role in ('owner', 'manager')
              and sc.status in ('pending', 'rejected')
        )
    );

create or replace function public.create_safety_center(
    p_institution_name text,
    p_institution_domain text,
    p_center_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_center_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if nullif(trim(p_institution_name), '') is null
       or nullif(trim(p_institution_domain), '') is null
       or nullif(trim(p_center_name), '') is null then
        raise exception 'Institution name, domain, and center name are required' using errcode = '22023';
    end if;

    insert into public.safety_centers (
        institution_name,
        institution_domain,
        center_name,
        status,
        created_by
    ) values (
        trim(p_institution_name),
        lower(trim(p_institution_domain)),
        trim(p_center_name),
        'pending',
        v_user_id
    )
    returning id into v_center_id;

    insert into public.safety_center_members (center_id, user_id, role)
    values (v_center_id, v_user_id, 'owner');

    return v_center_id;
end;
$$;

revoke all on function public.create_safety_center(text, text, text) from public, anon;
grant execute on function public.create_safety_center(text, text, text) to authenticated, service_role;

create or replace function public.attach_safety_center_verification_document(
    p_center_id uuid,
    p_path text,
    p_name text,
    p_mime_type text,
    p_size bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_status text;
    v_expected_prefix text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if nullif(trim(p_path), '') is null
       or nullif(trim(p_name), '') is null
       or nullif(trim(p_mime_type), '') is null
       or coalesce(p_size, 0) <= 0 then
        raise exception 'Verification document metadata is required' using errcode = '22023';
    end if;

    if p_size > 10485760 then
        raise exception 'Verification document must be 10MB or smaller' using errcode = '22023';
    end if;

    if lower(trim(p_mime_type)) not in (
        'application/pdf',
        'application/x-hwp',
        'application/haansofthwp',
        'application/vnd.hancom.hwp',
        'application/vnd.hancom.hwpx',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg'
    ) then
        raise exception 'Unsupported verification document type: %', p_mime_type using errcode = '22023';
    end if;

    if not public.is_safety_center_member(p_center_id, array['owner', 'manager']) then
        raise exception 'Only center owners and managers can attach verification documents' using errcode = '42501';
    end if;

    select sc.status
    into v_status
    from public.safety_centers sc
    where sc.id = p_center_id;

    if not found then
        raise exception 'Safety center not found' using errcode = 'P0002';
    end if;

    if v_status not in ('pending', 'rejected') then
        raise exception 'Verification documents can only be attached before approval' using errcode = '42501';
    end if;

    v_expected_prefix := v_user_id::text || '/' || p_center_id::text || '/';
    if trim(p_path) not like (v_expected_prefix || '%') then
        raise exception 'Verification document path is invalid' using errcode = '42501';
    end if;

    update public.safety_centers
    set
        verification_document_path = trim(p_path),
        verification_document_name = trim(p_name),
        verification_document_mime_type = lower(trim(p_mime_type)),
        verification_document_size = p_size,
        verification_document_uploaded_at = now()
    where id = p_center_id;
end;
$$;

revoke all on function public.attach_safety_center_verification_document(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.attach_safety_center_verification_document(uuid, text, text, text, bigint) to authenticated, service_role;
