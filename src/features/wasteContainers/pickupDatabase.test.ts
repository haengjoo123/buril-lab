import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * Runs the real waste container and pickup migrations in an embedded Postgres
 * with minimal stand-ins for the tables and helpers they depend on. The hosted
 * pgTAP suite (supabase/tests/waste_container_pickup_behavior.sql) covers the
 * same rules against the full schema.
 */
const migration = (name: string) =>
    readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');

const STUBS = `
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create table public.labs(id uuid primary key, name text not null);
create table public.lab_members(lab_id uuid not null references public.labs(id), user_id uuid not null references auth.users(id), role text not null);
grant select on public.lab_members to authenticated;
create table public.waste_stream_catalog(code text primary key);
create table public.waste_logs(
  id uuid primary key default gen_random_uuid(), lab_id uuid, created_at timestamptz not null default now(),
  normalized_amount_value numeric, normalized_amount_unit text, amount_is_unknown boolean not null default false, voided_at timestamptz);
create table public.audit_logs(
  id uuid primary key default gen_random_uuid(), actor_user_id uuid, actor_name text, lab_id uuid, entity_type text, entity_id uuid,
  action text, location_context text, before_data jsonb, after_data jsonb, diff_data jsonb, source text);
create function public.is_lab_admin(target_lab_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.lab_members lm where lm.lab_id = target_lab_id and lm.user_id = auth.uid() and lm.role = 'admin')$$;
create function private.actor_display_name_v2(uuid, uuid) returns text language sql stable as $$select 'tester'::text$$;
create table public.safety_centers(id uuid primary key, status text not null);
create table public.safety_center_members(center_id uuid not null, user_id uuid not null, role text not null);
create table public.safety_center_lab_links(id uuid primary key, center_id uuid not null, lab_id uuid not null, status text not null, scope text[] not null);
create function public.is_safety_center_member(target_center_id uuid, allowed_roles text[] default null) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.safety_center_members m where m.center_id = target_center_id and m.user_id = auth.uid())$$;
`;

const ADMIN = 'd1000000-0000-4000-8000-000000000001';
const STUDENT = 'd1000000-0000-4000-8000-000000000002';
const OTHER_STUDENT = 'd1000000-0000-4000-8000-000000000003';
const OUTSIDER = 'd1000000-0000-4000-8000-000000000004';
const CENTER_USER = 'd1000000-0000-4000-8000-000000000005';
const SUMMARY_CENTER_USER = 'd1000000-0000-4000-8000-000000000006';
const LAB = 'd2000000-0000-4000-8000-000000000001';
const OTHER_LAB = 'd2000000-0000-4000-8000-000000000002';
const WASTE_CENTER = 'd3000000-0000-4000-8000-000000000001';
const SUMMARY_CENTER = 'd3000000-0000-4000-8000-000000000002';
const WASTE_LINK = 'd4000000-0000-4000-8000-000000000001';

const SEED = `
insert into auth.users values ('${ADMIN}'),('${STUDENT}'),('${OTHER_STUDENT}'),('${OUTSIDER}'),('${CENTER_USER}'),('${SUMMARY_CENTER_USER}');
insert into public.labs values ('${LAB}','Pickup lab A'),('${OTHER_LAB}','Pickup lab B');
insert into public.lab_members values ('${LAB}','${ADMIN}','admin'),('${LAB}','${STUDENT}','student'),('${LAB}','${OTHER_STUDENT}','student'),('${OTHER_LAB}','${OUTSIDER}','researcher');
insert into public.waste_stream_catalog values ('ORGANIC_NON_HALOGENATED');
insert into public.safety_centers values ('${WASTE_CENTER}','approved'),('${SUMMARY_CENTER}','approved');
insert into public.safety_center_members values ('${WASTE_CENTER}','${CENTER_USER}','owner'),('${SUMMARY_CENTER}','${SUMMARY_CENTER_USER}','owner');
insert into public.safety_center_lab_links values
  ('${WASTE_LINK}','${WASTE_CENTER}','${LAB}','approved',array['summary','waste_management']),
  ('d4000000-0000-4000-8000-000000000002','${SUMMARY_CENTER}','${LAB}','approved',array['summary']);
`;

interface PickupJson {
    id: string;
    status: string;
    pickup_requested_at: string | null;
    pickup_requested_by: string | null;
    pickup_request_note: string | null;
}

describe('waste container pickup database boundary', () => {
    it('enforces who may request, withdraw and read pickup requests', async () => {
        const db = new PGlite();
        try {
            await db.exec(STUBS);
            await db.exec(migration('20261017090000_waste_containers.sql'));
            await db.exec(migration('20261113090000_waste_container_pickup_requests.sql'));
            await db.exec(SEED);

            const asUser = (id: string) =>
                db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`);
            const asOwner = () => db.exec('reset role;');
            const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r;
            const request = (id: string, note: string | null) =>
                one<PickupJson>('select public.request_waste_container_pickup_v1($1, $2) as r', [id, note]);
            const cancel = (id: string) => one<PickupJson>('select public.cancel_waste_container_pickup_v1($1) as r', [id]);
            const pickups = async (centerId: string) =>
                (await db.query<{ label: string; lab_name: string; deposit_count: number | string; total_ml: number | string; pickup_request_note: string | null }>(
                    'select * from public.get_safety_center_waste_pickups_v1($1)', [centerId],
                )).rows;

            await asUser(ADMIN);
            const create = (label: string) => one<{ id: string }>(
                `select public.create_waste_container_v1($1, 'ORGANIC_NON_HALOGENATED', $2, 'Room 202', 20000) as r`, [LAB, label],
            );
            const first = (await create('pickup-1')).id;
            const second = (await create('pickup-2')).id;

            // A member asks; asking again keeps the first request.
            await asUser(STUDENT);
            const asked = await request(first, '  full,   please   collect ');
            expect(asked).toMatchObject({ pickup_requested_by: STUDENT, pickup_request_note: 'full, please collect' });
            expect(asked.pickup_requested_at).toBeTruthy();
            expect((await request(first, 'second note')).pickup_request_note).toBe('full, please collect');
            await expect(request(first, 'x'.repeat(501))).rejects.toThrow('WASTE_CONTAINER_INVALID_INPUT');
            await expect(db.query('update public.waste_containers set pickup_requested_at = null where id = $1', [first]))
                .rejects.toThrow('permission denied');

            // Only the requester or a lab admin may withdraw; other labs can do neither.
            await asUser(OTHER_STUDENT);
            await expect(cancel(first)).rejects.toThrow('WASTE_CONTAINER_ADMIN_REQUIRED');
            await asUser(OUTSIDER);
            await expect(request(second, null)).rejects.toThrow('WASTE_CONTAINER_ACCESS_DENIED');
            await expect(cancel(first)).rejects.toThrow('WASTE_CONTAINER_ACCESS_DENIED');
            await db.exec('reset role; set role anon;');
            await expect(request(first, null)).rejects.toThrow('permission denied');
            await expect(pickups(WASTE_CENTER)).rejects.toThrow('permission denied');

            // The center that manages the lab's waste sees the request with recorded totals.
            await asOwner();
            await db.query(
                `insert into public.waste_logs(lab_id, container_id, normalized_amount_value, normalized_amount_unit) values ($1, $2, 500, 'mL'), ($1, $2, 250, 'mL')`,
                [LAB, first],
            );
            await db.query(`insert into public.waste_logs(lab_id, container_id, normalized_amount_value, normalized_amount_unit, voided_at) values ($1, $2, 9999, 'mL', now())`, [LAB, first]);
            await asUser(CENTER_USER);
            const seen = await pickups(WASTE_CENTER);
            expect(seen).toHaveLength(1);
            expect(seen[0]).toMatchObject({ label: 'pickup-1', lab_name: 'Pickup lab A', pickup_request_note: 'full, please collect' });
            expect(Number(seen[0].deposit_count)).toBe(2);
            expect(Number(seen[0].total_ml)).toBe(750);
            expect(await pickups(SUMMARY_CENTER)).toEqual([]);
            await asUser(SUMMARY_CENTER_USER);
            expect(await pickups(SUMMARY_CENTER)).toEqual([]);
            expect(await pickups(WASTE_CENTER)).toEqual([]);

            // A revoked link, or a center that is no longer approved, shows nothing.
            await asOwner();
            await db.query(`update public.safety_center_lab_links set status = 'revoked' where id = $1`, [WASTE_LINK]);
            await asUser(CENTER_USER);
            expect(await pickups(WASTE_CENTER)).toEqual([]);
            await asOwner();
            await db.query(`update public.safety_center_lab_links set status = 'approved' where id = $1`, [WASTE_LINK]);
            await db.query(`update public.safety_centers set status = 'rejected' where id = $1`, [WASTE_CENTER]);
            await asUser(CENTER_USER);
            expect(await pickups(WASTE_CENTER)).toEqual([]);
            await asOwner();
            await db.query(`update public.safety_centers set status = 'approved' where id = $1`, [WASTE_CENTER]);

            // The requester withdraws; the admin withdraws another member's request.
            await asUser(STUDENT);
            expect((await cancel(first)).pickup_requested_at).toBeNull();
            await request(first, null);
            await request(second, 'second container');
            await asUser(ADMIN);
            expect((await cancel(second)).pickup_requested_at).toBeNull();

            // Sealing keeps the request; collecting ends it, and a collected container takes no new one.
            await one(`select public.set_waste_container_status_v1($1, 'sealed') as r`, [first]);
            await asUser(CENTER_USER);
            expect((await pickups(WASTE_CENTER)).map((row) => row.label)).toEqual(['pickup-1']);
            await asUser(ADMIN);
            await one(`select public.set_waste_container_status_v1($1, 'collected', 'contractor A') as r`, [first]);
            await expect(request(first, null)).rejects.toThrow('WASTE_CONTAINER_COLLECTED');
            await asUser(CENTER_USER);
            expect(await pickups(WASTE_CENTER)).toEqual([]);

            await asOwner();
            const state = (await db.query<{ status: string; pickup_requested_at: string | null; pickup_requested_by: string | null; pickup_request_note: string | null }>(
                'select status, pickup_requested_at, pickup_requested_by, pickup_request_note from public.waste_containers where id = $1', [first],
            )).rows[0];
            expect(state).toEqual({ status: 'collected', pickup_requested_at: null, pickup_requested_by: null, pickup_request_note: null });
            // Even a direct write by the table owner cannot leave a request on a collected container.
            await db.query(`update public.waste_containers set pickup_requested_at = now() where id = $1`, [first]);
            expect(await one<string | null>('select pickup_requested_at as r from public.waste_containers where id = $1', [first])).toBeNull();
            await expect(db.query(
                `insert into public.waste_containers(lab_id, stream_code, label, status, collected_at, pickup_requested_at) values ($1, 'ORGANIC_NON_HALOGENATED', 'bad', 'collected', now(), now())`,
                [LAB],
            )).rejects.toThrow('waste_containers_pickup_state_check');

            // Requests and withdrawals are audited; the free-text note is not stored there.
            const audit = (await db.query<{ to: string; n: number | string }>(
                `select diff_data->'pickup'->>'to' as to, count(*) as n from public.audit_logs where diff_data ? 'pickup' group by 1 order by 1`,
            )).rows.map((row) => [row.to, Number(row.n)]);
            expect(audit).toEqual([['none', 2], ['requested', 3]]);
            const leaked = await one<number | string>(
                `select count(*) as r from public.audit_logs where coalesce(before_data::text, '') || coalesce(after_data::text, '') || coalesce(diff_data::text, '') like '%please collect%'`,
            );
            expect(Number(leaked)).toBe(0);
        } finally {
            await db.close();
        }
    }, 120_000);
});
