import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createChemicalCacheAdminClient: vi.fn(() => null as unknown) }))
vi.mock('../chemicals/_cache', () => ({ createChemicalCacheAdminClient: mocks.createChemicalCacheAdminClient }))

import { onRequestGet } from './handling-draft'

const USER = { userId: '22222222-2222-4222-8222-222222222222' }

function clientWith(rowsByTable: Record<string, unknown[]>) {
  const calls: { table: string; filters: unknown[][] }[] = []
  return {
    calls,
    client: {
      from(table: string) {
        const call = { table, filters: [] as unknown[][] }
        calls.push(call)
        const builder: Record<string, unknown> = {}
        for (const method of ['select', 'eq', 'neq', 'or']) {
          builder[method] = (...args: unknown[]) => { call.filters.push([method, ...args]); return builder }
        }
        builder.limit = async () => ({ data: rowsByTable[table] || [], error: null })
        return builder
      },
    },
  }
}

const draftRow = {
  id: 'd1',
  name_ko: '디클로로메탄',
  review_status: 'unreviewed',
  record: { handling: { ppe: ['PVA 장갑'] }, storage: { temp: '실온' } },
  verify: null,
}

async function get(query: string, data: Record<string, unknown> = USER) {
  const response = await onRequestGet({
    request: new Request(`https://example.test/api/reagents/handling-draft?${query}`),
    env: {},
    data,
  })
  return { status: response.status, body: await response.json() as Record<string, unknown>, headers: response.headers }
}

describe('GET /api/reagents/handling-draft', () => {
  afterEach(() => {
    mocks.createChemicalCacheAdminClient.mockReset()
    mocks.createChemicalCacheAdminClient.mockReturnValue(null)
  })

  it('requires a signed-in user and a valid identity', async () => {
    expect((await get('cas=75-09-2', {})).status).toBe(401)
    expect((await get('cas=75-09-3')).status).toBe(400)
    expect((await get('name=a')).status).toBe(400)
  })

  it('returns one draft by CAS, excluding rejected and critical drafts, never cached publicly', async () => {
    const db = clientWith({ reagent_reference_drafts: [draftRow] })
    mocks.createChemicalCacheAdminClient.mockReturnValue(db.client)
    const result = await get('cas=75-09-2')
    expect(result.body).toEqual({
      status: 'found',
      draft: { name: '디클로로메탄', reviewStatus: 'unreviewed', handling: { ppe: ['PVA 장갑'] }, storage: { temp: '실온' } },
    })
    expect(result.headers.get('Cache-Control')).toBe('private, no-store')
    const filters = db.calls[0].filters
    expect(filters).toContainEqual(['eq', 'cas_number', '75-09-2'])
    expect(filters).toContainEqual(['neq', 'review_status', 'rejected'])
    expect(filters).toContainEqual(['or', 'verify_overall.is.null,verify_overall.neq.critical'])
  })

  it('shows nothing when two drafts share the CAS', async () => {
    mocks.createChemicalCacheAdminClient.mockReturnValue(clientWith({ reagent_reference_drafts: [draftRow, { ...draftRow, id: 'd2' }] }).client)
    expect((await get('cas=9036-19-5')).body).toEqual({ status: 'not_found' })
  })

  it('looks up by name only through a single matching alias draft', async () => {
    const db = clientWith({ reagent_alias_drafts: [{ draft_id: 'd1' }, { draft_id: 'd1' }], reagent_reference_drafts: [draftRow] })
    mocks.createChemicalCacheAdminClient.mockReturnValue(db.client)
    expect((await get('name=%EC%97%BC%ED%99%94%EB%A9%94%ED%8B%B8%EB%A0%8C')).body).toMatchObject({ status: 'found' })
    expect(db.calls[0].filters).toContainEqual(['eq', 'normalized_alias', '염화메틸렌'])

    mocks.createChemicalCacheAdminClient.mockReturnValue(clientWith({ reagent_alias_drafts: [{ draft_id: 'a' }, { draft_id: 'b' }] }).client)
    expect((await get('name=TEA')).body).toEqual({ status: 'not_found' })
  })

  it('reports unavailable without a server client', async () => {
    expect((await get('cas=75-09-2')).body).toEqual({ status: 'unavailable' })
  })
})
