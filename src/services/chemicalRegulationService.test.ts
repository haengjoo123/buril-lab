import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChemicalRegulationBatchResponse, ChemicalRegulationLookup } from '../utils/chemicalRegulations'

const postJson = vi.fn<(url: string, body: { cas: string[] }) => Promise<ChemicalRegulationBatchResponse>>()
const getJson = vi.fn<(url: string) => Promise<ChemicalRegulationLookup>>()
vi.mock('./internalApi', () => ({
  postJson: (url: string, body: { cas: string[] }) => postJson(url, body),
  getJson: (url: string) => getJson(url),
}))

import {
  clearChemicalRegulationSession,
  fetchChemicalRegulations,
  fetchChemicalRegulationsBatch,
  loadChemicalRegulations,
} from './chemicalRegulationService'

const HCL = '7647-01-0'
const ACETONE = '67-64-1'
const ETHANOL = '64-17-5'
const found = (casNumber: string): ChemicalRegulationLookup => ({
  status: 'found',
  record: { casNumber, entries: [{ category: 'accident_preparedness', typeName: '사고대비물질' }] },
})

describe('chemical regulation batch lookups', () => {
  beforeEach(() => clearChemicalRegulationSession())
  afterEach(() => vi.clearAllMocks())

  it('asks only for CAS numbers this session does not know and keeps definitive answers', async () => {
    getJson.mockResolvedValueOnce(found(HCL))
    await fetchChemicalRegulations(HCL)
    postJson.mockResolvedValueOnce({ results: {
      [ACETONE]: { status: 'not_found' },
      [ETHANOL]: { status: 'pending' },
    } })

    const round = await fetchChemicalRegulationsBatch([HCL, ` ${ACETONE}`, ETHANOL, '67-64-2', ACETONE])

    expect(postJson).toHaveBeenCalledWith('/api/chemicals/regulations-batch', { cas: [ACETONE, ETHANOL] })
    expect([...round.resolved.keys()].sort()).toEqual([ACETONE, HCL].sort())
    expect(round.pending).toEqual([ETHANOL])
    // The detail card now reads the batch answer without another request.
    await expect(fetchChemicalRegulations(ACETONE)).resolves.toEqual({ status: 'not_found' })
    expect(getJson).toHaveBeenCalledTimes(1)
  })

  it('reports a failed request without remembering it', async () => {
    postJson.mockRejectedValueOnce(new Error('429'))
    const round = await fetchChemicalRegulationsBatch([HCL])
    expect(round).toEqual({ resolved: new Map(), pending: [], failed: [HCL] })

    postJson.mockResolvedValueOnce({ results: { [HCL]: found(HCL) } })
    expect((await fetchChemicalRegulationsBatch([HCL])).resolved.get(HCL)).toEqual(found(HCL))
  })

  it('asks again for pending CAS numbers until they are answered or progress stops', async () => {
    postJson
      .mockResolvedValueOnce({ results: { [HCL]: found(HCL), [ACETONE]: { status: 'pending' }, [ETHANOL]: { status: 'pending' } } })
      .mockResolvedValueOnce({ results: { [ACETONE]: { status: 'not_found' }, [ETHANOL]: { status: 'pending' } } })
      .mockResolvedValueOnce({ results: { [ETHANOL]: { status: 'pending' } } })
    const progress: number[] = []

    const resolved = await loadChemicalRegulations([HCL, ACETONE, ETHANOL], {
      retryDelayMs: 0,
      onProgress: (known) => progress.push(known.size),
    })

    expect(postJson.mock.calls.map(([, body]) => body.cas)).toEqual([[HCL, ACETONE, ETHANOL], [ACETONE, ETHANOL], [ETHANOL]])
    expect([...resolved.keys()].sort()).toEqual([ACETONE, HCL].sort())
    expect(progress).toEqual([1, 2, 2])
  })
})
