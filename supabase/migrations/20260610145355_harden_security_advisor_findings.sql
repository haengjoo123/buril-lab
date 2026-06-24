-- Harden findings from the Supabase Security Advisor.
-- Keep public buckets publicly addressable by URL, but remove broad Storage API
-- listing/write policies and restrict privileged RPCs to signed-in users.

-- SECURITY DEFINER functions are not protected by table RLS. Revoke anonymous
-- execution from functions that are only expected to run for signed-in users.
revoke execute on function public.create_inventory_item_atomic(text, text, text, text, text, integer, text, uuid, uuid, uuid, date, text, integer, uuid, uuid, text) from public, anon;
revoke execute on function public.update_inventory_item_atomic(uuid, text, jsonb, text) from public, anon;
revoke execute on function public.delete_inventory_item_atomic(uuid, text, text, uuid, uuid, text, text, text, text) from public, anon;
revoke execute on function public.insert_audit_log_rpc(uuid, text, uuid, text, uuid, text, text, jsonb, jsonb, jsonb, text, uuid) from public, anon;
revoke execute on function public.get_cabinet_audit_logs(uuid, integer) from public, anon;
revoke execute on function public.get_cabinet_activity_logs(uuid) from public, anon;
revoke execute on function public.get_cabinet_disposal_logs(uuid) from public, anon;
revoke execute on function public.get_lab_members(uuid) from public, anon;
revoke execute on function public.join_lab_with_password(uuid, uuid, text, text, text) from public, anon;
revoke execute on function public.leave_lab(uuid) from public, anon;
revoke execute on function public.remove_lab_member(uuid, uuid) from public, anon;
revoke execute on function public.transfer_admin(uuid, uuid) from public, anon;
revoke execute on function public.update_lab_member_role(uuid, uuid, text) from public, anon;
revoke execute on function public.delete_user() from public, anon;
revoke execute on function public.is_lab_admin(uuid) from public, anon;
revoke execute on function public.is_safety_center_member(uuid, text[]) from public, anon;
revoke execute on function public.protect_lab_member_role() from public, anon;
revoke execute on function public.enforce_lab_creation_membership_limit() from public, anon;
revoke execute on function public.enforce_lab_membership_limit() from public, anon;

grant execute on function public.create_inventory_item_atomic(text, text, text, text, text, integer, text, uuid, uuid, uuid, date, text, integer, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.update_inventory_item_atomic(uuid, text, jsonb, text) to authenticated, service_role;
grant execute on function public.delete_inventory_item_atomic(uuid, text, text, uuid, uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.insert_audit_log_rpc(uuid, text, uuid, text, uuid, text, text, jsonb, jsonb, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.get_cabinet_audit_logs(uuid, integer) to authenticated, service_role;
grant execute on function public.get_cabinet_activity_logs(uuid) to authenticated, service_role;
grant execute on function public.get_cabinet_disposal_logs(uuid) to authenticated, service_role;
grant execute on function public.get_lab_members(uuid) to authenticated, service_role;
grant execute on function public.join_lab_with_password(uuid, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.leave_lab(uuid) to authenticated, service_role;
grant execute on function public.remove_lab_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.transfer_admin(uuid, uuid) to authenticated, service_role;
grant execute on function public.update_lab_member_role(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.delete_user() to authenticated, service_role;
grant execute on function public.is_lab_admin(uuid) to authenticated, service_role;
grant execute on function public.is_safety_center_member(uuid, text[]) to authenticated, service_role;
grant execute on function public.protect_lab_member_role() to authenticated, service_role;
grant execute on function public.enforce_lab_creation_membership_limit() to authenticated, service_role;
grant execute on function public.enforce_lab_membership_limit() to authenticated, service_role;

-- Fix mutable function search paths reported by the Security Advisor.
alter function public.analytics_normalize_cas(text) set search_path = public;
alter function public.analytics_normalize_text(text) set search_path = public;
alter function public.commerce_intent_events_set_normalized_fields() set search_path = public;
alter function public.delete_user() set search_path = public;
alter function public.get_cabinet_disposal_logs(uuid) set search_path = public;
alter function public.get_lab_members(uuid) set search_path = public;
alter function public.join_lab_with_password(uuid, uuid, text, text, text) set search_path = public;
alter function public.leave_lab(uuid) set search_path = public;
alter function public.protect_lab_member_role() set search_path = public;
alter function public.remove_lab_member(uuid, uuid) set search_path = public;
alter function public.safety_center_set_updated_at() set search_path = public;
alter function public.safety_compliance_events_set_normalized_fields() set search_path = public;
alter function public.transfer_admin(uuid, uuid) set search_path = public;
alter function public.update_inventory_updated_at() set search_path = public;
alter function public.update_lab_member_role(uuid, uuid, text) set search_path = public;

-- Feedback may include free-form message/contact details. Anonymous inserts
-- remain allowed, but anonymous rows are no longer publicly selectable.
drop policy if exists "Anyone can insert feedback" on public.feedback;
create policy "Anyone can insert feedback"
    on public.feedback
    for insert
    to anon, authenticated
    with check (
        (
            (select auth.uid()) is null
            and user_id is null
            and user_email is null
        )
        or (
            (select auth.uid()) = user_id
            and (
                user_email is null
                or user_email = (auth.jwt() ->> 'email')
            )
        )
    );

drop policy if exists "Users can view own feedback" on public.feedback;
create policy "Users can view own feedback"
    on public.feedback
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

-- Public buckets can still serve public object URLs without broad SELECT
-- policies on storage.objects. Remove policies that allow object listing, and
-- close legacy anonymous media write access used only by maintenance scripts.
drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Allow anonymous read from media-products" on storage.objects;
drop policy if exists "Allow anonymous upload to media-products" on storage.objects;
drop policy if exists "Allow anonymous update in media-products" on storage.objects;
