import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * Runs the real purchase request migration in an embedded Postgres with
 * minimal stand-ins for the tables and helpers it depends on. The hosted pgTAP
 * suite (supabase/tests/inventory_purchase_requests_behavior.sql) covers the
 * same rules against the full schema.
 */
const migration = readFileSync(
    new URL('../../../supabase/migrations/20261115090000_inventory_purchase_requests.sql', import.meta.url),
    'utf8',
);

const STUBS = `
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create table public.labs(id uuid primary key, name text not null);
create table public.lab_members(lab_id uuid not null references public.labs(id), user_id uuid not null references auth.users(id), role text not null);
create table public.inventory(id uuid primary key, lab_id uuid, user_id uuid, name text not null);
create table public.inventory_usage_completion_receipts(
  request_id uuid primary key default gen_random_uuid(), inventory_item_id uuid not null, created_at timestamptz not null default now());
create table public.audit_logs(
  id uuid primary key default gen_random_uuid(), actor_user_id uuid, actor_name text, lab_id uuid, entity_type text, entity_id uuid,
  action text, location_context text, before_data jsonb, after_data jsonb, diff_data jsonb, source text);
create function public.is_lab_admin(target_lab_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.lab_members lm where lm.lab_id = target_lab_id and lm.user_id = auth.uid() and lm.role = 'admin')$$;
create function private.actor_display_name_v2(uuid, uuid) returns text language sql stable as $$select 'tester'::text$$;
`;

const ADMIN = 'e1000000-0000-4000-8000-000000000001';
const STUDENT = 'e1000000-0000-4000-8000-000000000002';
const OTHER_STUDENT = 'e1000000-0000-4000-8000-000000000003';
const OUTSIDER = 'e1000000-0000-4000-8000-000000000004';
const LAB = 'e2000000-0000-4000-8000-000000000001';
const OTHER_LAB = 'e2000000-0000-4000-8000-000000000002';
const ACETONE = 'e3000000-0000-4000-8000-000000000001';
const OTHER_LAB_ITEM = 'e3000000-0000-4000-8000-000000000002';
const PERSONAL_ITEM = 'e3000000-0000-4000-8000-000000000003';

const SEED = `
insert into auth.users values ('${ADMIN}'),('${STUDENT}'),('${OTHER_STUDENT}'),('${OUTSIDER}');
insert into public.labs values ('${LAB}','Purchase lab'),('${OTHER_LAB}','Other lab');
insert into public.lab_members values ('${LAB}','${ADMIN}','admin'),('${LAB}','${STUDENT}','student'),('${LAB}','${OTHER_STUDENT}','student'),('${OTHER_LAB}','${OUTSIDER}','researcher');
insert into public.inventory values ('${ACETONE}','${LAB}',null,'Acetone'),('${OTHER_LAB_ITEM}','${OTHER_LAB}',null,'Ethanol'),('${PERSONAL_ITEM}',null,'${STUDENT}','Toluene');
insert into public.inventory_usage_completion_receipts(inventory_item_id, created_at) values
  ('${ACETONE}', now() - interval '10 days'), ('${ACETONE}', now() - interval '40 days'), ('${ACETONE}', now() - interval '400 days'),
  ('${OTHER_LAB_ITEM}', now()), ('${PERSONAL_ITEM}', now() - interval '1 day');
`;

interface RequestJson {
    id: string;
    status: string;
    item_name: string;
    quantity: number;
    cas_number: string | null;
    requested_by: string | null;
    requester_name: string | null;
    decided_by: string | null;
    decision_note: string | null;
    note: string | null;
}

describe('inventory purchase request database boundary', () => {
    it('enforces who may ask, decide, withdraw and read', async () => {
        const db = new PGlite();
        try {
            await db.exec(STUBS);
            await db.exec(migration);
            await db.exec(SEED);

            const asUser = (id: string) =>
                db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`);
            const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r;
            const create = (fields: { lab?: string; name?: string; quantity?: number; cas?: string | null; note?: string | null; source?: string | null }) =>
                one<RequestJson>(
                    'select public.create_inventory_purchase_request_v1($1, $2, $3, null, null, $4, $5, $6, $7) as r',
                    [fields.lab ?? LAB, fields.name ?? 'Acetone', fields.quantity ?? 1, fields.cas ?? null, '500 mL', fields.note ?? null, fields.source ?? null],
                );
            const move = (id: string, status: string, note: string | null = null) =>
                one<RequestJson>('select public.update_inventory_purchase_request_v1($1, $2, $3) as r', [id, status, note]);
            const list = (lab = LAB) => one<RequestJson[]>('select public.list_inventory_purchase_requests_v1($1) as r', [lab]);

            // A member asks; the same inventory row cannot pile up duplicate open requests.
            await asUser(STUDENT);
            const first = await create({ name: '  Acetone   HPLC ', quantity: 2, cas: '67-64-1', note: 'running low', source: ACETONE });
            expect(first).toMatchObject({ status: 'requested', item_name: 'Acetone HPLC', quantity: 2, requested_by: STUDENT, requester_name: 'tester' });
            expect((await create({ source: ACETONE })).id).toBe(first.id);
            await expect(create({ cas: '67641' })).rejects.toThrow('PURCHASE_REQUEST_INVALID_INPUT');
            await expect(create({ quantity: 0 })).rejects.toThrow('PURCHASE_REQUEST_INVALID_INPUT');
            await expect(create({ source: OTHER_LAB_ITEM })).rejects.toThrow('PURCHASE_REQUEST_INVALID_INPUT');
            await expect(db.query('select * from public.inventory_purchase_requests')).rejects.toThrow('permission denied');

            // Members cannot decide; a classmate cannot withdraw someone else's request.
            await expect(move(first.id, 'approved')).rejects.toThrow('PURCHASE_REQUEST_ADMIN_REQUIRED');
            await asUser(OTHER_STUDENT);
            await expect(move(first.id, 'cancelled')).rejects.toThrow('PURCHASE_REQUEST_ADMIN_REQUIRED');
            expect((await list()).map((row) => row.id)).toEqual([first.id]);

            // Another lab sees and touches nothing.
            await asUser(OUTSIDER);
            await expect(list()).rejects.toThrow('PURCHASE_REQUEST_ACCESS_DENIED');
            await expect(move(first.id, 'cancelled')).rejects.toThrow('PURCHASE_REQUEST_ACCESS_DENIED');
            await expect(create({})).rejects.toThrow('PURCHASE_REQUEST_ACCESS_DENIED');
            await db.exec('reset role; set role anon;');
            await expect(list()).rejects.toThrow('permission denied');

            // The admin approves, orders and records arrival; steps cannot be skipped or reversed.
            await asUser(ADMIN);
            await expect(move(first.id, 'received')).rejects.toThrow('PURCHASE_REQUEST_INVALID_TRANSITION');
            expect(await move(first.id, 'approved', 'order from vendor A')).toMatchObject({ status: 'approved', decided_by: ADMIN, decision_note: 'order from vendor A' });
            expect((await move(first.id, 'approved')).status).toBe('approved');
            expect((await move(first.id, 'ordered')).decision_note).toBe('order from vendor A');
            expect((await move(first.id, 'received')).status).toBe('received');
            await expect(move(first.id, 'cancelled')).rejects.toThrow('PURCHASE_REQUEST_INVALID_TRANSITION');

            // Once closed, the same row can be asked for again; the requester may withdraw an undecided one.
            await asUser(STUDENT);
            const second = await create({ source: ACETONE });
            expect(second.id).not.toBe(first.id);
            await expect(move(second.id, 'approved')).rejects.toThrow('PURCHASE_REQUEST_ADMIN_REQUIRED');
            expect((await move(second.id, 'cancelled')).status).toBe('cancelled');
            const third = await create({ name: 'Methanol' });
            await asUser(ADMIN);
            expect((await move(third.id, 'rejected', 'we still have two')).status).toBe('rejected');
            await asUser(STUDENT);
            await expect(move(third.id, 'cancelled')).rejects.toThrow('PURCHASE_REQUEST_INVALID_TRANSITION');
            expect((await list()).map((row) => row.item_name)).toEqual(['Methanol', 'Acetone', 'Acetone HPLC']);

            // Usage counts: the last 180 days of the caller's lab, or of the caller's personal inventory.
            const usage = async (lab: string | null) =>
                (await db.query<{ inventory_item_id: string; used_count: number | string }>(
                    'select * from public.get_inventory_usage_counts_v1($1, 180)', [lab],
                )).rows.map((row) => [row.inventory_item_id, Number(row.used_count)]);
            expect(await usage(LAB)).toEqual([[ACETONE, 2]]);
            expect(await usage(null)).toEqual([[PERSONAL_ITEM, 1]]);
            await asUser(OUTSIDER);
            await expect(usage(LAB)).rejects.toThrow('PURCHASE_REQUEST_ACCESS_DENIED');
            expect(await usage(null)).toEqual([]);

            // Every step is audited without the free-text notes.
            await db.exec('reset role;');
            const audit = (await db.query<{ action: string; n: number | string }>(
                `select action, count(*) as n from public.audit_logs where entity_type = 'purchase_request' group by 1 order by 1`,
            )).rows.map((row) => [row.action, Number(row.n)]);
            expect(audit).toEqual([['insert', 3], ['update', 5]]);
            const leaked = await one<number | string>(
                `select count(*) as r from public.audit_logs where coalesce(before_data::text, '') || coalesce(after_data::text, '') || coalesce(diff_data::text, '') ~ 'running low|vendor A|still have two'`,
            );
            expect(Number(leaked)).toBe(0);
        } finally {
            await db.close();
        }
    }, 120_000);
});
