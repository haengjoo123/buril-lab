import { describe, expect, it, vi } from 'vitest'
import { enrichChemicalItem } from './_pipeline'

const propertyPayload = (cid: number, title: string) => ({
  PropertyTable: {
    Properties: [{
      CID: cid,
      Title: title,
      MolecularFormula: 'C2H3NaO2',
      MolecularWeight: '82.03',
      ConnectivitySMILES: '[Na+].CC(=O)[O-]',
      InChIKey: 'VMHLLURERBWHNL-UHFFFAOYSA-M',
    }],
  },
})

const casSection = {
  Record: {
    Section: [{
      TOCHeading: 'Other Identifiers',
      Section: [{
        TOCHeading: 'CAS',
        Information: [{ Value: { StringWithMarkup: [{ String: '127-09-3' }] } }],
      }],
    }],
  },
}

const notClassifiedSection = {
  Record: {
    Section: [{
      TOCHeading: 'GHS Classification',
      Information: [{
        Name: 'GHS Classification',
        Value: { StringWithMarkup: [{ String: 'Not Classified' }] },
      }],
    }],
  },
}

describe('chemical enrichment PubChem equivalent-CID pipeline', () => {
  it('recovers sodium acetate CAS and explicit not-classified data from CID 517045', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/compound/name/Sodium%20acetate/property/')) return Response.json(propertyPayload(31372, 'Sodium acetate'))
      if (url.includes('/compound/inchikey/') && url.endsWith('/cids/JSON')) {
        return Response.json({ IdentifierList: { CID: [31372, 517045] } })
      }
      if (url.includes('/compound/cid/31372/property/')) return Response.json(propertyPayload(31372, 'Sodium acetate'))
      if (url.includes('/compound/cid/517045/property/')) return Response.json(propertyPayload(517045, 'Sodium acetate'))
      if (url.includes('/compound/31372/JSON?heading=')) return new Response('', { status: 404 })
      if (url.includes('/compound/517045/JSON?heading=')) return Response.json(notClassifiedSection)
      if (url.endsWith('/compound/31372/JSON')) return Response.json({ Record: { Section: [] } })
      if (url.endsWith('/compound/517045/JSON')) return Response.json(casSection)
      return new Response('', { status: 404 })
    }) as typeof fetch

    const result = await enrichChemicalItem({
      requestId: 'sodium-acetate',
      name: 'Sodium acetate',
    }, {}, fetchMock)

    expect(result.overallStatus).toBe('complete')
    expect(result.identity).toMatchObject({
      status: 'verified',
      casNumber: '127-09-3',
      pubchemCid: 31372,
      equivalentPubchemCids: [31372, 517045],
    })
    expect(result.hazard).toMatchObject({
      status: 'not_classified',
      hCodes: [],
    })
    expect(result.hazard.signalWord).toBeUndefined()
    expect(result.hazard.sources).toEqual([{ source: 'pubchem', sourceId: '517045' }])
    expect(result.phCatalog).toMatchObject({
      status: 'matched',
      id: 'sodium-acetate',
      matchedBy: 'inchi_key',
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('msds.kosha.or.kr'))).toBe(false)
  })

  it('unions H-codes from every exact equivalent CID', async () => {
    const ghs = (statement: string) => ({ Record: { Section: [{
      TOCHeading: 'GHS Classification',
      Information: [{
        Name: 'GHS Hazard Statements',
        Value: { StringWithMarkup: [{ String: statement }] },
      }],
    }] } })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/compound/name/Sodium%20acetate/property/')) return Response.json(propertyPayload(31372, 'Sodium acetate'))
      if (url.includes('/compound/inchikey/') && url.endsWith('/cids/JSON')) return Response.json({ IdentifierList: { CID: [31372, 517045] } })
      if (url.includes('/compound/cid/31372/property/')) return Response.json(propertyPayload(31372, 'Sodium acetate'))
      if (url.includes('/compound/cid/517045/property/')) return Response.json(propertyPayload(517045, 'Sodium acetate'))
      if (url.includes('/compound/31372/JSON?heading=')) return Response.json(ghs('H225 Highly flammable liquid and vapour'))
      if (url.includes('/compound/517045/JSON?heading=')) return Response.json(ghs('H272 May intensify fire; oxidizer'))
      if (url.endsWith('/compound/31372/JSON')) return Response.json(casSection)
      if (url.endsWith('/compound/517045/JSON')) return Response.json({ Record: { Section: [] } })
      return new Response('', { status: 404 })
    }) as typeof fetch

    const result = await enrichChemicalItem({ requestId: 'union', name: 'Sodium acetate' }, {}, fetchMock)
    expect(result.hazard.status).toBe('classified')
    expect(result.hazard.hCodes).toEqual(['H225', 'H272'])
    expect(result.hazard.hazardFlags).toEqual(['FLAMMABLE', 'OXIDIZER'])
    expect(result.hazard.sources).toEqual([
      { source: 'pubchem', sourceId: '31372' },
      { source: 'pubchem', sourceId: '517045' },
    ])
  })

  it('falls back to KOSHA section 2 only after PubChem has no classification data', async () => {
    const koshaProperty = {
      PropertyTable: { Properties: [{
        CID: 999,
        Title: 'Fallback chemical',
        MolecularFormula: 'C3H6O',
        MolecularWeight: '58.08',
        InChIKey: 'AAAAAAAAAAAAAA-BBBBBBBBBB-C',
      }] },
    }
    const fallbackCas = {
      Record: { Section: [{
        TOCHeading: 'Other Identifiers',
        Section: [{ TOCHeading: 'CAS', Information: [{
          Value: { StringWithMarkup: [{ String: '67-64-1' }] },
        }] }],
      }] },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/compound/name/Fallback%20chemical/property/')) return Response.json(koshaProperty)
      if (url.includes('/compound/inchikey/') && url.endsWith('/cids/JSON')) return Response.json({ IdentifierList: { CID: [999] } })
      if (url.includes('/compound/cid/999/property/')) return Response.json(koshaProperty)
      if (url.includes('/compound/999/JSON?heading=')) return new Response('', { status: 404 })
      if (url.endsWith('/compound/999/JSON')) return Response.json(fallbackCas)
      if (url.includes('/chemlist?')) return new Response(
        '<response><body><items><item><chemId>123</chemId><chemNameKor>아세톤</chemNameKor><casNo>67-64-1</casNo></item></items></body></response>',
      )
      if (url.includes('/chemdetail02?')) return new Response(
        '<response><body><items><item><msdsItemNameKor>유해·위험문구</msdsItemNameKor><itemDetail>H225 고인화성 액체 및 증기</itemDetail></item></items></body></response>',
      )
      return new Response('', { status: 404 })
    }) as typeof fetch

    const result = await enrichChemicalItem(
      { requestId: 'kosha', name: 'Fallback chemical' },
      { KOSHA_API_KEY: 'test-key' },
      fetchMock,
    )
    expect(result.hazard).toMatchObject({
      status: 'classified',
      hCodes: ['H225'],
      hazardFlags: ['FLAMMABLE'],
      sources: [{ source: 'kosha', sourceId: '000123' }],
    })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('chemdetail')).map(([url]) => String(url)))
      .toHaveLength(1)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('chemdetail01'))).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('chemdetail03'))).toBe(false)
  })
})
