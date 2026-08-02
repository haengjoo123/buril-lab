import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
  })

  it('rejects an invalid CAS checksum before any external lookup', async () => {
    await expect(searchChemical('67-64-2')).resolves.toBeNull()

    expect(mocks.fetchChemicalInfo).not.toHaveBeenCalled()
    expect(mocks.resolveCasChemical).not.toHaveBeenCalled()
    expect(mocks.resolveKoreanChemical).not.toHaveBeenCalled()
    expect(mocks.resolveWikiCas).not.toHaveBeenCalled()
  })
})
