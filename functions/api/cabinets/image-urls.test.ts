// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), createSignedUrls: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocked.createClient }))

import { onRequestPost } from './image-urls'

const userId = '11111111-1111-4111-8111-111111111111'
const cabinetId = '22222222-2222-4222-8222-222222222222'
const secondId = '33333333-3333-4333-8333-333333333333'
const labId = '44444444-4444-4444-8444-444444444444'
const path = `labs/${labId}/cabinets/${cabinetId}/55555555-5555-4555-8555-555555555555.webp`
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'synthetic-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' }

function request(body: unknown = { cabinetIds: [cabinetId, secondId] }): Request {
  return new Request('https://staging.burillab.com/api/cabinets/image-urls', { method: 'POST',
    headers: { Authorization: 'Bearer aaa.bbb.ccc', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

function context(req = request()) { return { request: req, env, data: { userId } } }

describe('private cabinet signed URL batch', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocked.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    mocked.rpc.mockResolvedValue({ data: { success: true, images: [
      { cabinet_id: cabinetId, image_path: path }, { cabinet_id: secondId, image_path: null },
    ] }, error: null })
    mocked.createSignedUrls.mockResolvedValue({ data: [{ path,
      signedUrl: `${env.SUPABASE_URL}/storage/v1/object/sign/cabinets/${path}?token=synthetic`, error: null }], error: null })
    mocked.createClient.mockImplementation((_url: string, key: string) => key === env.SUPABASE_SERVICE_ROLE_KEY
      ? { rpc: mocked.rpc, storage: { from: () => ({ createSignedUrls: mocked.createSignedUrls }) } }
      : { auth: { getUser: mocked.getUser } })
  })

  it('returns one-hour signed URLs without exposing private paths', async () => {
    const response = await onRequestPost(context())
    expect(response.status).toBe(200)
    const result = await response.json() as { urls: Record<string, string | null> }
    expect(result.urls[cabinetId]).toContain('/storage/v1/object/sign/cabinets/')
    expect(result.urls[secondId]).toBeNull()
    expect(mocked.createSignedUrls).toHaveBeenCalledWith([path], 3600)
    expect(result).not.toHaveProperty('paths')
  })

  it.each([
    {}, { cabinetIds: [] }, { cabinetIds: [cabinetId, cabinetId] },
    { cabinetIds: ['not-a-uuid'] }, { cabinetIds: Array.from({ length: 51 }, (_, index) =>
      `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`) },
  ])('rejects malformed batches before authentication: %j', async (body) => {
    const response = await onRequestPost(context(request(body)))
    expect(response.status).toBe(400)
    expect(mocked.createClient).not.toHaveBeenCalled()
  })

  it('fails the whole request for an unauthorized cabinet instead of returning a partial map', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'private details' } })
    const response = await onRequestPost(context())
    expect(response.status).toBe(403)
    expect(mocked.createSignedUrls).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('private details')
  })

  it('rejects provider results with missing, duplicate or foreign signed URLs', async () => {
    mocked.createSignedUrls.mockResolvedValueOnce({ data: [{ path: 'foreign/path.webp',
      signedUrl: 'https://evil.example/photo?token=x', error: null }], error: null })
    const response = await onRequestPost(context())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('foreign/path')
  })

  it('rejects a same-project signed URL for a different private object', async () => {
    const otherPath = `labs/${labId}/cabinets/${cabinetId}/66666666-6666-4666-8666-666666666666.webp`
    mocked.createSignedUrls.mockResolvedValueOnce({ data: [{ path,
      signedUrl: `${env.SUPABASE_URL}/storage/v1/object/sign/cabinets/${otherPath}?token=synthetic`, error: null }], error: null })
    const response = await onRequestPost(context())
    expect(response.status).toBe(503)
  })
})
