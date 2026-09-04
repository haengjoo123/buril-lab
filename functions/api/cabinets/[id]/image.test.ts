// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(),
  upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocked.createClient }))

import { onRequestPost } from './image'

const cabinetId = '22222222-2222-4222-8222-222222222222'
const userId = '11111111-1111-4111-8111-111111111111'
const labId = '33333333-3333-4333-8333-333333333333'
const previousPath = `labs/${labId}/cabinets/${cabinetId}/44444444-4444-4444-8444-444444444444.webp`
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'synthetic-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' }

function webp(): Uint8Array {
  return new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 1, 2, 3, 4])
}

function request(body: BodyInit = webp(), contentType = 'image/webp'): Request {
  return new Request(`https://staging.burillab.com/api/cabinets/${cabinetId}/image`, {
    method: 'POST', body, headers: { Authorization: 'Bearer aaa.bbb.ccc', 'Content-Type': contentType },
  })
}

function context(req = request(), id = cabinetId) {
  return { request: req, env, data: { userId }, params: { id } }
}

function state(imagePath: string | null = null, referencedCount = 1, legacyImagePending = false) {
  return { success: true, image_path: imagePath,
    legacy_image_pending: legacyImagePending,
    scope_prefix: `labs/${labId}/cabinets/${cabinetId}`,
    referenced_count: referencedCount, warning: referencedCount >= 40 }
}

describe('private cabinet photo endpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocked.getUser.mockResolvedValue({ data: { user: { id: userId, is_anonymous: false } }, error: null })
    mocked.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'get_cabinet_image_state_v1') return { data: state(), error: null }
      if (name === 'set_cabinet_image_path_v1') return { data: { success: true,
        image_path: args.p_image_path, previous_path: args.p_expected_previous_path,
        referenced_count: args.p_image_path ? 2 : 0, warning: false }, error: null }
      return { data: null, error: { code: 'UNKNOWN' } }
    })
    mocked.upload.mockResolvedValue({ data: {}, error: null })
    mocked.remove.mockResolvedValue({ data: {}, error: null })
    mocked.createSignedUrl.mockImplementation(async (path: string) => ({ data: {
      signedUrl: `${env.SUPABASE_URL}/storage/v1/object/sign/cabinets/${path}?token=synthetic`,
    }, error: null }))
    mocked.createClient.mockImplementation((_url: string, key: string) => key === env.SUPABASE_SERVICE_ROLE_KEY
      ? { rpc: mocked.rpc, storage: { from: () => ({ upload: mocked.upload,
        remove: mocked.remove, createSignedUrl: mocked.createSignedUrl }) } }
      : { auth: { getUser: mocked.getUser } })
  })

  it('uploads verified WebP bytes through a scoped path and returns only a signed URL', async () => {
    const response = await onRequestPost(context())
    expect(response.status).toBe(200)
    const result = await response.json() as Record<string, unknown>
    expect(result).toMatchObject({ success: true, referencedCount: 2, warning: false, urlUnavailable: false })
    expect(result.imageUrl).toMatch(/^https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\/cabinets\//)
    const [path, body, options] = mocked.upload.mock.calls[0]
    expect(path).toMatch(new RegExp(`^labs/${labId}/cabinets/${cabinetId}/[0-9a-f-]{36}\\.webp$`))
    expect(Array.from(body as Uint8Array)).toEqual(Array.from(webp()))
    expect(options).toEqual({ upsert: false, contentType: 'image/webp', cacheControl: '31536000' })
    expect(mocked.rpc.mock.calls[1][0]).toBe('set_cabinet_image_path_v1')
    expect(result).not.toHaveProperty('imagePath')
  })

  it('rejects malformed bodies, content types and IDs before any provider call', async () => {
    for (const value of [
      context(request(new Uint8Array([1, 2, 3]))),
      context(request('{}', 'text/plain')),
      context(request(), 'not-a-uuid'),
    ]) {
      const response = await onRequestPost(value)
      expect(response.status).toBeGreaterThanOrEqual(400)
    }
    expect(mocked.createClient).not.toHaveBeenCalled()
  })

  it('refuses the fifty-first photo before uploading and keeps the database limit as a second guard', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: state(null, 50), error: null })
    const response = await onRequestPost(context())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'CABINET_IMAGE_LIMIT' })
    expect(mocked.upload).not.toHaveBeenCalled()
  })

  it('blocks photo changes until a legacy public reference is migrated', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: state(null, 0, true), error: null })
    const response = await onRequestPost(context())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'CABINET_IMAGE_MIGRATION_REQUIRED' })
    expect(mocked.upload).not.toHaveBeenCalled()
    expect(mocked.createSignedUrl).not.toHaveBeenCalled()
  })

  it('removes only the DB pointer and leaves deletion to the retention workflow', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: state(previousPath, 1), error: null })
    const response = await onRequestPost(context(request(JSON.stringify({ action: 'remove' }), 'application/json')))
    expect(response.status).toBe(200)
    expect(mocked.rpc).toHaveBeenLastCalledWith('set_cabinet_image_path_v1', {
      p_user_id: userId, p_cabinet_id: cabinetId, p_image_path: null,
      p_expected_previous_path: previousPath, p_sha256: null, p_size_bytes: null,
    })
    expect(mocked.remove).not.toHaveBeenCalled()
  })

  it('cleans up a definitely unreferenced new object after an attach failure', async () => {
    mocked.rpc
      .mockResolvedValueOnce({ data: state(), error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'cabinet_image_limit_reached' } })
      .mockResolvedValueOnce({ data: state(), error: null })
    const response = await onRequestPost(context())
    expect(response.status).toBe(409)
    expect(mocked.remove).toHaveBeenCalledOnce()
  })

  it('never deletes an uploaded body when the commit state cannot be determined', async () => {
    mocked.rpc
      .mockResolvedValueOnce({ data: state(), error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'TIMEOUT', message: 'sensitive' } })
      .mockResolvedValueOnce({ data: null, error: { code: 'NETWORK', message: 'sensitive' } })
    const response = await onRequestPost(context())
    expect(response.status).toBe(503)
    expect(mocked.remove).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('sensitive')
  })

  it('does not issue or upload anything for another-lab access', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'private' } })
    const response = await onRequestPost(context())
    expect(response.status).toBe(403)
    expect(mocked.upload).not.toHaveBeenCalled()
    expect(mocked.createSignedUrl).not.toHaveBeenCalled()
  })
})
