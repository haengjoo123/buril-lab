import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

describe('20261116100000_cabinet_locked', () => {
    it('adds a nullable lock column that keeps existing cabinets unset', async () => {
        const db = new PGlite();
        await db.exec(`create table public.cabinets(id uuid primary key default gen_random_uuid(), name text not null);
            insert into public.cabinets(name) values ('existing');`);
        await db.exec(readFileSync(new URL('../../../supabase/migrations/20261116100000_cabinet_locked.sql', import.meta.url), 'utf8'));
        await db.exec(`insert into public.cabinets(name, locked) values ('with lock', true), ('without lock', false);`);
        const { rows } = await db.query<{ name: string; locked: boolean | null }>('select name, locked from public.cabinets order by name');
        expect(rows).toEqual([
            { name: 'existing', locked: null },
            { name: 'with lock', locked: true },
            { name: 'without lock', locked: false },
        ]);
        await db.close();
    });
});
