import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), single: vi.fn(), download: vi.fn(), parse: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mocks.getUser }, from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }), storage: { from: () => ({ download: mocks.download }) } }) }))
vi.mock('./_openai', async original => ({ ...await original<typeof import('./_openai')>(), parseOpenAIResponse: mocks.parse }))
import { checkedDocument, checkedMapping, onRequestPost } from './inventory-import'

const jobId = 'd2000000-0000-4000-8000-000000000001'
const sourceId = 'd2000000-0000-4000-8000-000000000002'
const environment = { INVENTORY_IMPORT_AI_ENABLED: 'true', OPENAI_API_KEY: 'fixture-no-network', OPENAI_SAFETY_HMAC_SECRET: 'fixture-secret', SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'fixture' }
const request = (body: object) => new Request('https://example.com/api/ai/inventory-import', { method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify({ jobId, sourceId, gridId: 'page-1', mode: 'document', ...body }) })

describe('inventory document extraction boundaries', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null }) })
  it('does not accept nonexistent column IDs or proposals without evidence', () => {
    expect(checkedMapping({ mappings: [{ field: 'name', columns: ['c0'], evidence: '시약명' }, { field: 'quantity', columns: ['c20'], evidence: 'qty' }, { field: 'capacity', columns: ['c0'], evidence: '' }], notes: [] }, [{ id: 'c0', label: '시약명' }])).toEqual({ name: ['c0'] })
  })
  it('keeps handwriting, missing coverage and unsupported text reviewable', () => {
    const checked = checkedDocument({ headers: ['시약명'], rows: [{ cells: [{ text: 'A', evidence: '', bounds: [0, 0, 0.5, 0.2] }], handwritten: true }], detectedRowCount: 2, complete: false, notes: [] }, { id: 'p1', label: 'Page 1', page: 1, cells: [] })
    expect(checked.handwriting).toBe(true)
    expect(checked.analysisWarnings?.[0]).toContain('행 누락')
    expect(checked.cells[1][0].issue).toBeTruthy()
  })
  it('rejects uneven columns rather than shifting chemical values into the next field', () => {
    expect(() => checkedDocument({ headers: ['시약명', '수량'], rows: [{ cells: [{ text: 'A', evidence: 'A', bounds: null }], handwritten: false }], detectedRowCount: 1, complete: true, notes: [] }, { id: 'p', label: 'P', cells: [] })).toThrow('align')
  })
  it('fails closed before paid work when the feature flag is disabled', async () => {
    const response = await onRequestPost({ request: new Request('https://example.com/api/ai/inventory-import', { method: 'POST', body: '{}' }), env: {} })
    expect(response.status).toBe(503)
    expect(mocks.parse).not.toHaveBeenCalled()
  })
  it('rejects expired or anonymous sessions and another user’s private job before provider calls', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('expired') })
    expect((await onRequestPost({ request: request({}), env: environment })).status).toBe(401)
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: 'guest', is_anonymous: true } } })
    expect((await onRequestPost({ request: request({}), env: environment })).status).toBe(401)
    mocks.single.mockResolvedValueOnce({ data: null, error: new Error('RLS denied') })
    expect((await onRequestPost({ request: request({}), env: environment })).status).toBe(403)
    expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.parse).not.toHaveBeenCalled()
  })
  it('never downloads an object outside the authorized source namespace', async () => {
    mocks.single.mockResolvedValueOnce({ data: { metadata: { sources: [{ id: sourceId, grids: [{ id: 'page-1', imagePath: 'foreign-job/image.jpg', cells: [] }] }], tables: [] } } })
    expect((await onRequestPost({ request: request({}), env: environment })).status).toBe(400)
    expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.parse).not.toHaveBeenCalled()
  })
  it('uses independent bounded model settings, stores source evidence, and returns a review draft', async () => {
    mocks.single.mockResolvedValueOnce({ data: { metadata: { sources: [{ id: sourceId, grids: [{ id: 'page-1', imagePath: `${jobId}/${sourceId}/page-1.jpg`, page: 1, cells: [] }] }], tables: [] } } })
    mocks.download.mockResolvedValueOnce({ data: new Blob(['synthetic-image'], { type: 'image/jpeg' }) })
    mocks.parse.mockResolvedValueOnce({ model: 'import-model', usage: { inputTokens: 4, outputTokens: 3 }, data: { headers: ['시약명', '수량'], rows: [{ cells: [{ text: 'A', evidence: 'A', bounds: [0, 0, 0.5, 0.5] }, { text: '0', evidence: '0', bounds: null }], handwritten: true }], detectedRowCount: 1, complete: true, notes: [] } })
    const response = await onRequestPost({ request: request({}), env: { ...environment, OPENAI_INVENTORY_IMPORT_MODEL: 'import-model', OPENAI_INVENTORY_IMPORT_TIMEOUT_MS: '999999', OPENAI_INVENTORY_IMPORT_DOCUMENT_TOKENS: '999999' } })
    expect(response.status).toBe(200)
    const output = await response.json() as { grid: { handwriting: boolean; cells: Array<Array<{ text: string }>> } }
    expect(output.grid.handwriting).toBe(true); expect(output.grid.cells[1][1].text).toBe('0')
    expect(mocks.parse.mock.calls[0][1]).toMatchObject({ model: 'import-model', timeoutMs: 60000, maxRetries: 0, maxOutputTokens: 20000 })
  })
  it('bounds the control request size', async () => {
    expect((await onRequestPost({ request: request({ padding: 'x'.repeat(9000) }), env: environment })).status).toBe(413)
    expect(mocks.parse).not.toHaveBeenCalled()
  })
})
