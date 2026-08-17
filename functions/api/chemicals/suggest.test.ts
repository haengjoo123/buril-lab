import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet } from './suggest'

describe('GET /api/chemicals/suggest', () => {
  afterEach(() => vi.unstubAllGlobals())

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
