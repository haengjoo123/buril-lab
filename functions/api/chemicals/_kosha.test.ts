import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveKoshaIdentityByCas,
  resolveKoshaIdentityByExactName,
  resolveKoshaReferencePh,
} from './_kosha'

function xmlItems(items: string): string {
  return `<response><body><items>${items}</items></body></response>`
}

describe('server-only KOSHA identity and reference pH', () => {
  afterEach(() => vi.restoreAllMocks())

  it('resolves an exact CAS once and reads section 9 reference pH', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/chemlist?')) {
        return new Response(xmlItems(
          '<item><chemId>3232</chemId><chemNameKor>아세트산 나트륨, 무수</chemNameKor><casNo>127-09-3</casNo></item>',
        ))
      }
      if (url.includes('/chemdetail09?')) {
        return new Response(xmlItems(
          '<item><msdsItemNameKor>라.pH</msdsItemNameKor><itemDetail>20 ℃에서 7.5 (1% 수용액)</itemDetail></item>',
        ))
      }
      return new Response('', { status: 404 })
    }) as typeof fetch

    const identity = await resolveKoshaIdentityByCas('127-09-3', { KOSHA_API_KEY: 'test' }, fetchMock)
    expect(identity).toEqual({
      kind: 'found',
      identity: { casNumber: '127-09-3', chemId: '003232', localizedName: '아세트산 나트륨, 무수' },
    })
    if (identity.kind !== 'found') throw new Error('identity was not resolved')
    await expect(resolveKoshaReferencePh(identity.identity, { KOSHA_API_KEY: 'test' }, fetchMock)).resolves.toMatchObject({
      status: 'available', value: 7.5, source: 'kosha', sourceId: '003232',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not auto-select when an exact name maps to different CAS identities', async () => {
    const fetchMock = vi.fn(async () => new Response(xmlItems([
      '<item><chemId>10</chemId><chemNameKor>시험물질</chemNameKor><casNo>7732-18-5</casNo></item>',
      '<item><chemId>11</chemId><chemNameKor>시험물질</chemNameKor><casNo>67-64-1</casNo></item>',
    ].join('')))) as typeof fetch

    const result = await resolveKoshaIdentityByExactName('시험물질', { KOSHA_API_KEY: 'test' }, fetchMock)
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.candidates.map((candidate) => candidate.casNumber)).toEqual(['7732-18-5', '67-64-1'])
    }
  })

  it('marks section 9 without a defensible pH as source absent', async () => {
    const fetchMock = vi.fn(async () => new Response(xmlItems(
      '<item><msdsItemNameKor>라.pH</msdsItemNameKor><itemDetail>자료없음</itemDetail></item>',
    ))) as typeof fetch
    await expect(resolveKoshaReferencePh(
      { casNumber: '7732-18-5', chemId: '000123' },
      { KOSHA_API_KEY: 'test' },
      fetchMock,
    )).resolves.toMatchObject({ status: 'source_absent', source: 'kosha' })
  })
})
