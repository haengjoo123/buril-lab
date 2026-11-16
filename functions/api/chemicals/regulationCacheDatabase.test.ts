import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

/**
 * Runs the regulation cache migration in an embedded Postgres against the
 * chemical_source_cache definition from the production baseline.
 */
const migration = readFileSync(
  new URL('../../../supabase/migrations/20261116090000_regulation_source_cache.sql', import.meta.url),
  'utf8',
)

const BASELINE_TABLE = `
create table public.chemical_source_cache (
  id uuid default gen_random_uuid() not null primary key,
  source text not null,
  record_type text not null,
  lookup_key text not null,
  result_version integer not null,
  cache_status text not null,
  result jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint chemical_source_cache_expiry_check check ((expires_at > fetched_at)),
  constraint chemical_source_cache_record_type_check check ((record_type = any (array['identity'::text, 'reference_ph'::text]))),
  constraint chemical_source_cache_result_object_check check ((jsonb_typeof(result) = 'object'::text)),
  constraint chemical_source_cache_source_check check ((source = 'kosha'::text)),
  constraint chemical_source_cache_status_check check ((cache_status = any (array['complete'::text, 'source_absent'::text]))),
  constraint chemical_source_cache_lookup_unique unique (source, record_type, lookup_key, result_version)
);
insert into public.chemical_source_cache(source, record_type, lookup_key, result_version, cache_status, result, fetched_at, expires_at)
values ('kosha', 'identity', '7647-01-0', 3, 'complete', '{}', now(), now() + interval '1 day');
`

const insert = (source: string, recordType: string, key = '50-00-0') => `
insert into public.chemical_source_cache(source, record_type, lookup_key, result_version, cache_status, result, fetched_at, expires_at)
values ('${source}', '${recordType}', '${key}', 1, 'complete', '{"status":"not_found"}', now(), now() + interval '7 days')`

describe('20261116090000_regulation_source_cache', () => {
  it('admits KECO regulation records only, and keeps the existing KOSHA rows', async () => {
    const db = new PGlite()
    await db.exec(BASELINE_TABLE)
    await db.exec(migration)

    await db.exec(insert('keco', 'regulation'))
    await db.exec(insert('kosha', 'reference_ph'))
    await expect(db.exec(insert('keco', 'identity', '64-17-5'))).rejects.toThrow(/source_record_type_check/)
    await expect(db.exec(insert('kosha', 'regulation', '64-17-5'))).rejects.toThrow(/source_record_type_check/)
    await expect(db.exec(insert('pubchem', 'identity', '64-17-5'))).rejects.toThrow(/source_check/)
    await expect(db.exec(insert('keco', 'regulation'))).rejects.toThrow(/lookup_unique/)

    const { rows } = await db.query<{ source: string; record_type: string }>(
      'select source, record_type from public.chemical_source_cache order by source, record_type',
    )
    expect(rows).toEqual([
      { source: 'keco', record_type: 'regulation' },
      { source: 'kosha', record_type: 'identity' },
      { source: 'kosha', record_type: 'reference_ph' },
    ])
    await db.close()
  })
})
