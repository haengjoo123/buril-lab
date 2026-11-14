import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createChemicalCacheAdminClient: vi.fn(() => null as unknown) }))
vi.mock('./_cache', () => ({ createChemicalCacheAdminClient: mocks.createChemicalCacheAdminClient }))

import { onRequestGet } from './suggest'

function adminClientWith(rowsByTable: Record<string, unknown[]>) {
  const calls: { table: string; filters: unknown[][] }[] = []
  return {
    calls,
    client: {
      from(table: string) {
        const call = { table, filters: [] as unknown[][] }
        calls.push(call)
        const builder: Record<string, unknown> = {}
        for (const method of ['select', 'eq', 'neq', 'gte', 'lt', 'order']) {
          builder[method] = (...args: unknown[]) => { call.filters.push([method, ...args]); return builder }
        }
        builder.limit = async () => ({ data: rowsByTable[table] || [], error: null })
        return builder
      },
    },
  }
}

describe('GET /api/chemicals/suggest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    mocks.createChemicalCacheAdminClient.mockReset()
    mocks.createChemicalCacheAdminClient.mockReturnValue(null)
  })

  it('asks for the form when one name fits several reagents, without any CAS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ dictionary_terms: { compound: [] } })))
    const admin = adminClientWith({
      global_reagent_aliases: [],
      reagent_alias_drafts: [
        { draft_id: 'a', reject_reason: null, reagent_reference_drafts: { name_ko: '트리에틸알루미늄', name_en: 'Triethylaluminium' } },
        { draft_id: 'b', reject_reason: '검수자 지적(다른 물질/부적절)', reagent_reference_drafts: { name_ko: '트라이에틸아민', name_en: 'Triethylamine' } },
        { draft_id: 'c', reject_reason: '검수자 지적(다른 물질/부적절)', reagent_reference_drafts: { name_ko: '트라이에탄올아민', name_en: null } },
        { draft_id: 'd', reject_reason: '2자 이하 약어', reagent_reference_drafts: { name_ko: '무관한 시약', name_en: null } },
      ],
    })
    mocks.createChemicalCacheAdminClient.mockReturnValue(admin.client)
    const response = await onRequestGet({
      request: new Request('https://example.test/api/chemicals/suggest?q=TEA&limit=5'),
      env: {},
    })
    const payload = await response.json() as { formChoices?: { name: string }[] }
    expect(payload.formChoices?.map((choice) => choice.name).sort()).toEqual(['트라이에탄올아민', '트라이에틸아민', '트리에틸알루미늄'].sort())
    expect(JSON.stringify(payload)).not.toMatch(/\d{2,7}-\d{2}-\d/)
    const draftCall = admin.calls.find((call) => call.table === 'reagent_alias_drafts')
    expect(draftCall?.filters).toContainEqual(['eq', 'normalized_alias', 'tea'])
    expect(draftCall?.filters).toContainEqual(['neq', 'kind', 'common_typos'])
  })

  it('does not ask for a form when the name fits one reagent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ dictionary_terms: { compound: [] } })))
    const admin = adminClientWith({
      global_reagent_aliases: [{ canonical_name: '디클로로메탄' }],
      reagent_alias_drafts: [
        { draft_id: 'a', reject_reason: null, reagent_reference_drafts: { name_ko: '디클로로메탄', name_en: 'Dichloromethane' } },
      ],
    })
    mocks.createChemicalCacheAdminClient.mockReturnValue(admin.client)
    const response = await onRequestGet({
      request: new Request('https://example.test/api/chemicals/suggest?q=DCM&limit=5'),
      env: {},
    })
    const payload = await response.json() as { suggestions: string[]; formChoices?: unknown }
    expect(payload.suggestions).toContain('디클로로메탄')
    expect(payload).not.toHaveProperty('formChoices')
  })

  it('proxies Korean suggestions through the server KOSHA boundary', async () => {
    const fetchMock = vi.fn(async () => new Response(
      '<response><body><items>' +
      '<item><chemNameKor>아세트산 나트륨</chemNameKor></item>' +
      '<item><chemNameKor>아세트산</chemNameKor></item>' +
      '</items></body></response>',
    ))
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequestGet({
      request: new Request('https://example.test/api/chemicals/suggest?q=아세트산&limit=2'),
      env: { KOSHA_API_KEY: 'test' },
    })
    await expect(response.json()).resolves.toEqual({
      suggestions: ['아세트산 나트륨', '아세트산'],
      source: 'kosha',
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/chemlist?')
  })

  it('proxies non-Korean suggestions through PubChem', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      dictionary_terms: { compound: ['sodium acetate', 'sodium acetate trihydrate'] },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequestGet({
      request: new Request('https://example.test/api/chemicals/suggest?q=sodium%20ace&limit=2'),
      env: {},
    })
    await expect(response.json()).resolves.toMatchObject({
      suggestions: ['sodium acetate', 'sodium acetate trihydrate'],
      source: 'pubchem',
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/rest/autocomplete/compound/')
  })

  it('rejects short queries before upstream lookup', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequestGet({
      request: new Request('https://example.test/api/chemicals/suggest?q=a'),
      env: {},
    })
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
