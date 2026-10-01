import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildImportRows, detectTables } from '../features/inventory/import/tables'
import { gridFromText } from '../features/inventory/import/readers'
import { validateImportRows } from '../features/inventory/import/normalize'
import type { ImportJob, ImportSource } from '../features/inventory/import/types'

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { rpc: mock.rpc, from: mock.from } }))
vi.mock('./internalApi', () => ({ postJson: vi.fn() }))
import { inventoryImportService as service } from './inventoryImportService'

function fixture(count: number): ImportJob {
  const source: ImportSource = { id: 'source', name: 'fixture.csv', size: 100, hash: 'hash', kind: 'delimited', grids: [gridFromText([['시약명', '수량'], ...Array.from({ length: count }, (_, n) => [`Reagent ${n}`, '2'])], 'grid', 'Fixture')] }
  const tables = detectTables(source)
  return { id: crypto.randomUUID(), userId: 'user', labId: null, revision: 0, name: 'Fixture', sources: [source], tables, rows: buildImportRows([source], tables) }
}
describe('durable inventory import service', () => {
  beforeEach(() => { mock.rpc.mockReset(); mock.from.mockReset() })
  it('checkpoints successful batches and reuses the uncertain request ID on retry', async () => {
    let job = fixture(201)
    mock.rpc.mockResolvedValueOnce({ data: 1 }).mockResolvedValueOnce({ error: { message: 'Network disconnected' } })
    let savedIds: string[] = []
    await expect(service.save(job, job.rows, true, (checkpoint, ids) => { job = checkpoint; savedIds = [...savedIds, ...ids] })).rejects.toThrow('Network')
    expect(job.revision).toBe(1); expect(savedIds).toHaveLength(100)
    const uncertainRequest = mock.rpc.mock.calls[1][1].p_request_id
    mock.rpc.mockResolvedValueOnce({ data: 2 }).mockResolvedValueOnce({ data: 3 })
    const resumed = await service.save(job, job.rows.filter(row => !savedIds.includes(row.id)), false)
    expect(mock.rpc.mock.calls[2][1].p_request_id).toBe(uncertainRequest)
    expect(mock.rpc.mock.calls.map(call => call[1].p_rows.length)).toEqual([100, 100, 100, 1])
    expect(resumed.revision).toBe(3)
  })
  it('loads more than 1000 draft rows and keeps edits and receipts', async () => {
    const job = fixture(1201)
    const stored = job.rows.map(row => ({ draft: structuredClone(row), inventory_id: null as string | null }))
    stored[1100].draft.fields.quantity = '8'; stored[1200].inventory_id = 'receipt'
    mock.from.mockImplementation((table: string) => {
      const chain = { select: () => chain, eq: () => chain, order: () => chain,
        single: () => Promise.resolve({ data: { ...job, lab_id: null, user_id: job.userId, metadata: { sources: job.sources, tables: job.tables } } }),
        range: (from: number, to: number) => Promise.resolve({ data: table === 'inventory_import_rows' ? stored.slice(from, to + 1) : [] }) }
      return chain
    })
    const loaded = await service.load(job.id, null)
    expect(loaded.rows).toHaveLength(1201)
    expect(loaded.rows[1100].fields.quantity).toBe('8')
    expect(loaded.rows[1200].importedId).toBe('receipt')
    await expect(service.load(job.id, 'another-lab')).rejects.toThrow('다른 연구실')
  })
  it('rejects a missing receipt instead of pretending that every row was registered', async () => {
    const job = fixture(2)
    const rows = validateImportRows(job.rows, { existing: [], locations: [], cabinets: [] })
    mock.rpc.mockResolvedValueOnce({ data: [{ rowId: rows[0].row.id, inventoryId: 'new' }] })
    await expect(service.commit(job, rows)).rejects.toThrow('등록 결과 확인')
    mock.rpc.mockResolvedValueOnce({ data: [{ rowId: rows[0].row.id, inventoryId: 'new', idempotent: true }, { rowId: rows[1].row.id, error: 'Check date' }] })
    expect(await service.commit(job, rows)).toHaveLength(2)
  })
})
