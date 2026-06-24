-- Trigger functions should run only through their attached triggers, not as
-- callable RPC endpoints for signed-in users.
revoke execute on function public.enforce_lab_creation_membership_limit() from authenticated;
revoke execute on function public.enforce_lab_membership_limit() from authenticated;
revoke execute on function public.protect_lab_member_role() from authenticated;
