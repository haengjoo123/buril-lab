revoke all on table public.onboarding_events from anon, authenticated;

grant select, insert on public.onboarding_events to authenticated;
grant select, insert, update, delete on public.onboarding_events to service_role;
