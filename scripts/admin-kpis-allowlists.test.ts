import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { translations } from '../src/locales/translations'

const root = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const migration = read('supabase/migrations/20261106090000_admin_kpis_v1.sql')

// The admin KPI migration copies two closed lists from app code. A new storage
// rule or a reworded void-reason preset needs a new migration, or the KPI
// silently stops naming that rule or counts the preset as "other".
describe('admin KPI allowlists', () => {
  it('names every storage rule id the app can send', () => {
    const ids = [...read('src/utils/storageCompatibilityChecker.ts').matchAll(/ruleId: '([a-z0-9_]+)'/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(migration).toContain(`'${id}'`)
  })
  it('maps every void-reason preset to its category', () => {
    for (const language of ['ko', 'en'] as const) {
      for (const key of ['log_void_reason_amount', 'log_void_reason_duplicate', 'log_void_reason_category'] as const) {
        expect(migration).toContain(`'${translations[language][key].toLowerCase()}'`)
      }
    }
  })
})
