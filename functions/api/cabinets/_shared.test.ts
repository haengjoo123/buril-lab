// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  boundedCabinetPhotoFetch, checkedSignedUrl, isWebp, validPhotoPath, validPhotoPrefix,
} from './_shared'

afterEach(() => vi.unstubAllGlobals())

describe('cabinet photo server boundaries', () => {
  const origin = 'https://project.supabase.co'
  const cabinetId = '22222222-2222-4222-8222-222222222222'
  const path = `labs/11111111-1111-4111-8111-111111111111/cabinets/${cabinetId}/33333333-3333-4333-8333-333333333333.webp`

  it('checks WebP bytes, ownership paths and signed URL origins', () => {
    expect(isWebp(new Uint8Array([82, 73, 70, 70, 1, 0, 0, 0, 87, 69, 66, 80]))).toBe(true)
    expect(isWebp(new Uint8Array([82, 73, 70, 70]))).toBe(false)
    expect(validPhotoPath(path, cabinetId)).toBe(true)
    expect(validPhotoPrefix(path.slice(0, path.lastIndexOf('/')), cabinetId)).toBe(true)
    expect(validPhotoPath(path.replace('labs/', 'labs/../'), cabinetId)).toBe(false)
    expect(checkedSignedUrl(`${origin}/storage/v1/object/sign/cabinets/${path}?token=x`, origin, path)).toContain(origin)
    expect(checkedSignedUrl(`https://evil.example/storage/v1/object/sign/cabinets/${path}?token=x`, origin, path)).toBeNull()
    expect(checkedSignedUrl(`${origin}/storage/v1/object/public/cabinets/${path}?token=x`, origin, path)).toBeNull()
    const otherPath = path.replace('33333333-3333-4333-8333-333333333333.webp',
      '66666666-6666-4666-8666-666666666666.webp')
    expect(checkedSignedUrl(`${origin}/storage/v1/object/sign/cabinets/${otherPath}?token=x`, origin, path)).toBeNull()
  })

  it('allows only bounded, non-redirected calls to the selected Supabase origin', async () => {
    const upstream = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', upstream)
    const controller = new AbortController()
    const fetcher = boundedCabinetPhotoFetch(origin, controller.signal, ['/rest/v1/'], 1)
    const response = await fetcher(`${origin}/rest/v1/rpc/get_cabinet_image_state_v1`, {})
    expect(response.status).toBe(200)
    expect(upstream.mock.calls[0][1]).toMatchObject({ redirect: 'manual', signal: controller.signal })
    await expect(fetcher(`${origin}/rest/v1/second`, {})).rejects.toThrow('REQUEST_REFUSED')
  })

  it('rejects foreign origins, redirects, oversized results and aborted work', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } })))
    await expect(boundedCabinetPhotoFetch(origin, controller.signal, ['/rest/v1/'], 1)(`${origin}/rest/v1/a`, {}))
      .rejects.toThrow('RESPONSE_REFUSED')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(512 * 1024 + 1))))
    await expect(boundedCabinetPhotoFetch(origin, controller.signal, ['/rest/v1/'], 1)(`${origin}/rest/v1/a`, {}))
      .rejects.toThrow('RESPONSE_REFUSED')
    const foreign = boundedCabinetPhotoFetch(origin, controller.signal, ['/rest/v1/'], 1)
    await expect(foreign('https://evil.example/rest/v1/a', {})).rejects.toThrow('TARGET_REFUSED')
    controller.abort()
    await expect(boundedCabinetPhotoFetch(origin, controller.signal, ['/rest/v1/'], 1)(`${origin}/rest/v1/a`, {}))
      .rejects.toThrow('REQUEST_REFUSED')
  })
})
