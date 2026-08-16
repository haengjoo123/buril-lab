import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../locales/i18n'

const mocks = vi.hoisted(() => ({
  fetchChemicalInfo: vi.fn(),
  resolveCasChemical: vi.fn(),
  resolveKoreanChemical: vi.fn(),
  fetchKoshaPH: vi.fn(),
  resolveWikiCas: vi.fn(),
}))

vi.mock('./pubchemApi', () => ({
  fetchChemicalInfo: mocks.fetchChemicalInfo,
}))

vi.mock('./koshaApi', () => ({
  resolveCasChemical: mocks.resolveCasChemical,
  resolveKoreanChemical: mocks.resolveKoreanChemical,
  fetchKoshaPH: mocks.fetchKoshaPH,
}))

vi.mock('./wikiApi', () => ({
  resolveWikiCas: mocks.resolveWikiCas,
}))

import { searchChemical } from './searchService'

describe('searchChemical CAS validation', () => {
  beforeEach(async () => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    await i18n.changeLanguage('en')
  })

  it('uses the PubChem English name in English mode even when KOSHA has a Korean name', async () => {
    mocks.fetchChemicalInfo.mockResolvedValue({
      id: '123',
      name: 'Beef extract',
      casNumber: '68990-09-0',
      molecularFormula: '',
      properties: { isOrganic: false, isHalogenated: false },
    })
    mocks.resolveCasChemical.mockResolvedValue({ chemId: 456, nameKo: '소고기 추출물' })
    mocks.fetchKoshaPH.mockResolvedValue(undefined)

    await expect(searchChemical('68990-09-0')).resolves.toMatchObject({
      name: 'Beef extract',
    })
  })

  it('keeps the Korean source name alongside the English name in Korean mode', async () => {
    await i18n.changeLanguage('ko')
    mocks.fetchChemicalInfo.mockResolvedValue({
      id: '123',
      name: 'Beef extract',
      casNumber: '68990-09-0',
      molecularFormula: '',
      properties: { isOrganic: false, isHalogenated: false },
    })
    mocks.resolveCasChemical.mockResolvedValue({ chemId: 456, nameKo: '소고기 추출물' })
    mocks.fetchKoshaPH.mockResolvedValue(undefined)

    await expect(searchChemical('68990-09-0')).resolves.toMatchObject({
      name: '소고기 추출물 (Beef extract)',
    })
  })

  it('rejects an invalid CAS checksum before any external lookup', async () => {
    await expect(searchChemical('67-64-2')).resolves.toBeNull()

    expect(mocks.fetchChemicalInfo).not.toHaveBeenCalled()
    expect(mocks.resolveCasChemical).not.toHaveBeenCalled()
    expect(mocks.resolveKoreanChemical).not.toHaveBeenCalled()
    expect(mocks.resolveWikiCas).not.toHaveBeenCalled()
  })

  it('stores a KOSHA pH as an external reference value instead of a batch pH', async () => {
    mocks.fetchChemicalInfo.mockResolvedValue({
      id: '962',
      name: 'Water',
      casNumber: '7732-18-5',
      molecularFormula: 'H2O',
      properties: { isOrganic: false, isHalogenated: false },
    })
    mocks.resolveCasChemical.mockResolvedValue({ chemId: 123, nameKo: '물' })
    mocks.fetchKoshaPH.mockResolvedValue(6.5)

    const result = await searchChemical('7732-18-5')

    expect(result?.properties).toMatchObject({
      referencePh: 6.5,
      phSource: 'kosha_reference',
    })
    expect(result?.properties).not.toHaveProperty('ph')
  })
})
