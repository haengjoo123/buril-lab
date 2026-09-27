import { expect, it, vi } from 'vitest'
import { readAllPages } from './readAllPages'

it('reads more than the 1000 row API cap without losing records', async () => {
  const data = Array.from({ length: 1537 }, (_, id) => ({ id }))
  const fetch = vi.fn(async (from: number, to: number) => ({ data: data.slice(from, to + 1), error: null }))
  expect(await readAllPages(fetch)).toEqual(data)
  expect(fetch).toHaveBeenCalledTimes(4)
})
it('does not return a partial inventory when a later page fails', async () => {
  await expect(readAllPages(async from => from ? { data: null, error: new Error('connection lost') } : { data: Array(500).fill(1), error: null })).rejects.toThrow('connection lost')
})
