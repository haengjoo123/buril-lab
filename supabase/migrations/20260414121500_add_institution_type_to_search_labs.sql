drop function if exists public.search_labs(text);

create function public.search_labs(search_query text)
returns table(
    id uuid,
    name text,
    created_by uuid,
    created_at timestamp with time zone,
    institution_type text,
    has_password boolean
)
language plpgsql
security definer
as $function$
begin
    if auth.uid() is null then
        raise exception 'Not authenticated';
    end if;

    return query
    select
        l.id,
        l.name,
        l.created_by,
        l.created_at,
        l.institution_type,
        (l.join_password is not null and l.join_password <> '') as has_password
    from public.labs l
    where l.name ilike '%' || search_query || '%'
    order by l.name asc
    limit 20;
end;
$function$;

grant execute on function public.search_labs(text) to anon, authenticated, service_role;
