import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchChemicalInfo } from './pubchemApi'

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
})
