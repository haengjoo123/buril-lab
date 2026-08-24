import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./chemicalEnrichmentService', () => ({
  chemicalFromEnrichment: vi.fn(),
  enrichChemical: vi.fn(),
}))

import { fetchChemicalInfoLegacy as fetchChemicalInfo } from './pubchemApi'

const fetchMock = vi.fn()

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue(data),
  }
}

function mockCompoundLookup(synonyms: string[]) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({
      PropertyTable: {
        Properties: [{
          CID: 999999,
          Title: 'Testium',
          IUPACName: 'testium',
          MolecularFormula: 'C2H6O',
          MolecularWeight: '46.07',
        }],
      },
    }))
    .mockResolvedValueOnce(jsonResponse({ Record: {} }))
    .mockResolvedValueOnce(jsonResponse({
      InformationList: {
        Information: [{ Synonym: synonyms }],
      },
    }))
}

function primaryCasRecord(...casNumbers: string[]) {
  return {
    Record: {
      Section: [{
        TOCHeading: 'Names and Identifiers',
        Section: [{
          TOCHeading: 'Other Identifiers',
          Section: [{
            TOCHeading: 'CAS',
            Information: casNumbers.map((casNumber) => ({
              Value: { StringWithMarkup: [{ String: casNumber }] },
            })),
          }, {
            TOCHeading: 'Related CAS',
            Information: [{
              Value: { StringWithMarkup: [{ String: '6131-90-4' }] },
            }],
          }],
        }],
      }],
    },
  }
}

describe('fetchChemicalInfo CAS handling', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects an invalid checksum before calling PubChem', async () => {
    await expect(fetchChemicalInfo('67-64-2')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the CAS field empty when PubChem provides no valid CAS synonym', async () => {
    mockCompoundLookup([])

    const result = await fetchChemicalInfo('Testium')

    expect(result?.name).toBe('Testium')
    expect(result?.casNumber).toBe('')
  })

  it('rejects a CAS lookup when the returned compound does not confirm that CAS', async () => {
    mockCompoundLookup(['64-17-5'])

    await expect(fetchChemicalInfo('67-64-1')).resolves.toBeNull()
  })

  it('recovers a unique primary CAS from an equivalent InChIKey record', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        PropertyTable: {
          Properties: [{
            CID: 31372,
            Title: 'Sodium acetate',
            IUPACName: 'sodium acetate',
            MolecularFormula: 'C2H3NaO2',
            MolecularWeight: '82.034',
            ConnectivitySMILES: 'CC(=O)[O-].[Na+]',
            InChIKey: 'VMHLLURERBWHNL-UHFFFAOYSA-M',
          }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ Record: {} }))
      .mockResolvedValueOnce(jsonResponse({
        InformationList: {
          Information: [{ Synonym: ['CHEMBL1354', 'Sodium acetate'] }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        IdentifierList: { CID: [31372, 517045] },
      }))
      .mockResolvedValueOnce(jsonResponse(primaryCasRecord('127-09-3')))

    const result = await fetchChemicalInfo('sodium acetate')

    expect(result).toMatchObject({
      id: '31372',
      name: 'Sodium acetate',
      casNumber: '127-09-3',
      molecularFormula: 'C2H3NaO2',
      connectivitySmiles: 'CC(=O)[O-].[Na+]',
    })
    expect(fetchMock.mock.calls[0]?.[0]).toContain('ConnectivitySMILES')
    expect(fetchMock.mock.calls[3]?.[0]).toContain(
      '/compound/inchikey/VMHLLURERBWHNL-UHFFFAOYSA-M/cids/JSON',
    )
  })

  it('does not auto-select when equivalent records expose conflicting primary CAS values', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        PropertyTable: {
          Properties: [{
            CID: 100,
            Title: 'Ambiguous structure',
            IUPACName: 'ambiguous structure',
            MolecularFormula: 'C2H6O',
            MolecularWeight: '46.07',
            InChIKey: 'TESTINCHIKEY-UHFFFAOYSA-N',
          }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ Record: {} }))
      .mockResolvedValueOnce(jsonResponse({
        InformationList: { Information: [{ Synonym: ['Ambiguous structure'] }] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        IdentifierList: { CID: [100, 101, 102] },
      }))
      .mockResolvedValueOnce(jsonResponse(primaryCasRecord('64-17-5')))
      .mockResolvedValueOnce(jsonResponse(primaryCasRecord('67-64-1')))

    const result = await fetchChemicalInfo('Ambiguous structure')

    expect(result?.casNumber).toBe('')
  })
})
