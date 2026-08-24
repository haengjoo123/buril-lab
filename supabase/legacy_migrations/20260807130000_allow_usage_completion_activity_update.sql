-- Usage completion decrements a linked inventory record without removing the
-- cabinet placement until the quantity reaches zero. The RPC records that
-- intermediate state as an `update` activity, so the activity log constraint
-- must accept it alongside add/remove/clear_all.
alter table public.cabinet_activity_logs
    drop constraint if exists cabinet_activity_logs_action_type_check;

alter table public.cabinet_activity_logs
    add constraint cabinet_activity_logs_action_type_check
    check (action_type in ('add', 'update', 'remove', 'clear_all'));
