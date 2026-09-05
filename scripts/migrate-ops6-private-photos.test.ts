import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import {
  createBoundedSupabaseFetch,
  migrateOps6PhotoSet,
  parseOps6SupabaseTarget,
  prepareLegacyCabinetWebp,
  verifyOps6EvidenceHeader,
  verifyOps6BackendCredential,
} from './migrate-ops6-private-photos.mjs'
import {
  buildPhotoMigrationInventory,
  derivePrivatePath,
  inspectSourceImage,
  inspectWebp,
} from './ops6-private-photo-migration-core.mjs'

const ref = 'abcdefghijklmnopqrst'
const origin = `https://${ref}.supabase.co`
const actor = '50000000-0000-4000-8000-000000000001'
const lab = '60000000-0000-4000-8000-000000000001'
const cabinet = '70000000-0000-4000-8000-000000000001'
const sourcePath = 'legacy/cabinet.webp'
const sourceUrl = `${origin}/storage/v1/object/public/cabinets/${sourcePath}`
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('synthetic-body')])
const credential = (projectRef = ref, role = 'service_role') => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ iss: 'supabase', role, ref: projectRef })).toString('base64url'),
  'signature-that-is-long-enough',
].join('.')

async function prepareIdentity(body: Buffer) {
  const source = inspectSourceImage(body)
  const output = inspectWebp(body)
  return {
    body,
    sourceSha256: source.sha256,
    sourceSizeBytes: source.sizeBytes,
    sourceMimeType: source.mimeType,
    sha256: output.sha256,
    sizeBytes: output.sizeBytes,
    width: 1,
    height: 1,
    quality: 84,
    converted: false,
  }
}

function inventory(objects = [sourcePath]) {
  return buildPhotoMigrationInventory([{
    id: cabinet, user_id: actor, lab_id: lab, image_url: sourceUrl, image_path: null,
  }], objects, origin)
}

function adapterFixture({ existingBody = null, acknowledge = true, commit = true } = {}) {
  const objects = new Map<string, Buffer>([[sourcePath, webp]])
  const details = inspectWebp(webp)
  const target = derivePrivatePath({ id: cabinet, user_id: actor, lab_id: lab }, sourcePath, details.sha256)
  if (existingBody) objects.set(target, existingBody)
  const state = { image_path: null as string | null }
  return {
    target,
    state,
    adapter: {
      download: vi.fn(async (path: string) => {
        const value = objects.get(path)
        if (!value) throw new Error('missing')
        return value
      }),
      tryDownload: vi.fn(async (path: string) => objects.get(path) ?? null),
      upload: vi.fn(async (path: string, body: Buffer) => {
        if (objects.has(path)) return false
        objects.set(path, Buffer.from(body))
        return true
      }),
      migrate: vi.fn(async ({ privatePath }: { privatePath: string }) => {
        if (commit) state.image_path = privatePath
        return acknowledge
      }),
      readCabinet: vi.fn(async () => ({ id: cabinet, image_path: state.image_path })),
    },
  }
}

describe('Ops6 private photo migration runtime', () => {
  it('accepts the original evidence header after pending photos become migrated', () => {
    const original = {
      version: 1, kind: 'ops6_private_photo_copy', environment: 'production',
      projectRef: ref, commitSha: 'a'.repeat(40),
      initialPending: 1, initialMigratedWithLegacy: 0, initialQuarantine: 1,
    }
    const afterCopy = {
      ...original, initialPending: 0, initialMigratedWithLegacy: 1,
    }
    expect(verifyOps6EvidenceHeader(original, afterCopy)).toBe(original)
    expect(() => verifyOps6EvidenceHeader(original, { ...afterCopy, projectRef: 'z'.repeat(20) })).toThrow(/exact run/)
    expect(() => verifyOps6EvidenceHeader(original, { ...afterCopy, initialPending: 1 })).toThrow(/exact run/)
    expect(() => verifyOps6EvidenceHeader(original, { ...afterCopy, initialQuarantine: 0 })).toThrow(/exact run/)
  })

  it('binds the exact HTTPS Supabase project and backend credential', () => {
    expect(parseOps6SupabaseTarget(`${origin}/`, ref)).toEqual({ origin, projectRef: ref })
    expect(() => parseOps6SupabaseTarget('https://other-project-ref.supabase.co/', ref)).toThrow(/exact approved project/)
    expect(() => parseOps6SupabaseTarget(`http://${ref}.supabase.co/`, ref)).toThrow(/exact approved project/)
    expect(verifyOps6BackendCredential(credential(), ref)).toBe(credential())
    expect(verifyOps6BackendCredential(`sb_secret_${'a'.repeat(40)}`, ref)).toMatch(/^sb_secret_/)
    expect(() => verifyOps6BackendCredential(credential(ref, 'anon'), ref)).toThrow(/exact project service/)
    expect(() => verifyOps6BackendCredential(credential('zzzzzzzzzzzzzzzzzzzz'), ref)).toThrow(/exact project service/)
    expect(() => verifyOps6BackendCredential(`sb_publishable_${'a'.repeat(40)}`, ref)).toThrow(/unsupported/)
  })

  it('refuses cross-origin requests, redirects, and oversized provider bodies', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'))
    const bounded = createBoundedSupabaseFetch(origin, fetchMock as typeof fetch)
    await expect(bounded('https://evil.invalid/rest/v1/cabinets')).rejects.toThrow(/escaped/)
    expect(fetchMock).not.toHaveBeenCalled()

    const redirecting = createBoundedSupabaseFetch(origin, vi.fn(async () => new Response(null, {
      status: 302, headers: { location: 'https://evil.invalid/' },
    })) as typeof fetch)
    await expect(redirecting(`${origin}/rest/v1/cabinets`)).rejects.toThrow(/redirect/)

    const oversized = createBoundedSupabaseFetch(origin, vi.fn(async () => new Response('x', {
      headers: { 'content-length': String(5 * 1024 * 1024) },
    })) as typeof fetch)
    await expect(oversized(`${origin}/rest/v1/cabinets`)).rejects.toThrow(/byte limit/)

    const cabinetObject = createBoundedSupabaseFetch(origin, vi.fn(async () => new Response('x', {
      headers: { 'content-length': String(5 * 1024 * 1024) },
    })) as typeof fetch)
    await expect(cabinetObject(`${origin}/storage/v1/object/cabinets/legacy/photo.jpg`)).resolves.toBeInstanceOf(Response)
  })

  it('strictly decodes JPEG, PNG, and WebP and creates a bounded single-frame WebP', async () => {
    const inputs = [
      await sharp({ create: { width: 2400, height: 1350, channels: 3, background: '#315f78' } }).jpeg().toBuffer(),
      await sharp({ create: { width: 32, height: 16, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.4 } } }).png().toBuffer(),
      await sharp({ create: { width: 32, height: 16, channels: 3, background: '#abcdef' } }).webp().toBuffer(),
    ]
    const expectedTypes = ['image/jpeg', 'image/png', 'image/webp']
    for (const [index, input] of inputs.entries()) {
      const result = await prepareLegacyCabinetWebp(input)
      expect(result).toMatchObject({ sourceMimeType: expectedTypes[index], quality: 84, converted: true })
      expect(result.sizeBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1920)
      expect(inspectWebp(result.body)).toMatchObject({ sha256: result.sha256, sizeBytes: result.sizeBytes })
      const metadata = await sharp(result.body).metadata()
      expect(metadata).toMatchObject({ format: 'webp', width: result.width, height: result.height })
      expect(metadata.pages ?? 1).toBe(1)
    }
  })

  it('rejects multi-frame or unsafe source metadata before writing anything', async () => {
    const fakeSharp = vi.fn(() => ({
      metadata: vi.fn(async () => ({
        format: 'webp', width: 1, height: 1, autoOrient: { width: 1, height: 1 }, pages: 2,
      })),
    }))
    await expect(prepareLegacyCabinetWebp(webp, fakeSharp as never)).rejects.toThrow(/metadata is unsupported/)
    expect(fakeSharp).toHaveBeenCalledTimes(1)
  })

  it('copies, downloads, hashes, binds, and journals one pending photo without deletion', async () => {
    const fixture = adapterFixture()
    const entries: unknown[] = []
    const result = await migrateOps6PhotoSet({
      inventory: inventory(), adapter: fixture.adapter,
      appendEntry: async (entry: unknown) => { entries.push(entry) },
      now: () => new Date('2026-09-04T01:00:00Z'),
      prepareSource: prepareIdentity,
    })
    expect(result).toMatchObject({ candidates: 1 })
    expect(entries).toEqual([expect.objectContaining({ cabinetId: cabinet, sourcePath, privatePath: fixture.target })])
    expect(fixture.adapter.upload).toHaveBeenCalledTimes(1)
    expect(fixture.adapter.migrate).toHaveBeenCalledTimes(1)
    expect(fixture.state.image_path).toBe(fixture.target)
  })

  it('recovers a lost RPC response when the exact database pointer committed', async () => {
    const fixture = adapterFixture({ acknowledge: false, commit: true })
    const entries: unknown[] = []
    await expect(migrateOps6PhotoSet({
      inventory: inventory(), adapter: fixture.adapter,
      appendEntry: async (entry: unknown) => { entries.push(entry) },
      prepareSource: prepareIdentity,
    })).resolves.toMatchObject({ candidates: 1 })
    expect(entries).toHaveLength(1)
  })

  it('fails closed when upload bytes or provider commit state differ', async () => {
    const wrongBody = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('wrong')])
    const mismatch = adapterFixture({ existingBody: wrongBody })
    await expect(migrateOps6PhotoSet({
      inventory: inventory([sourcePath, mismatch.target]), adapter: mismatch.adapter,
      appendEntry: async () => undefined,
      prepareSource: prepareIdentity,
    })).rejects.toThrow(/SHA-256 verification/)

    const unknown = adapterFixture({ acknowledge: false, commit: false })
    await expect(migrateOps6PhotoSet({
      inventory: inventory(), adapter: unknown.adapter,
      appendEntry: async () => undefined,
      prepareSource: prepareIdentity,
    })).rejects.toThrow(/did not bind/)
  })

  it('revalidates prior evidence and does not append it twice', async () => {
    const fixture = adapterFixture()
    fixture.state.image_path = fixture.target
    const details = inspectWebp(webp)
    const prior = {
      cabinetId: cabinet, sourcePath, privatePath: fixture.target,
      sha256: details.sha256, sizeBytes: details.sizeBytes, verifiedAt: '2026-09-04T01:00:00.000Z',
    }
    const appendEntry = vi.fn()
    await migrateOps6PhotoSet({
      inventory: buildPhotoMigrationInventory([{
        id: cabinet, user_id: actor, lab_id: lab, image_url: sourceUrl, image_path: fixture.target,
      }], [sourcePath, fixture.target], origin),
      adapter: fixture.adapter, priorEntries: [prior], appendEntry, prepareSource: prepareIdentity,
    })
    expect(appendEntry).not.toHaveBeenCalled()
    await expect(migrateOps6PhotoSet({
      inventory: inventory(), adapter: fixture.adapter,
      priorEntries: [{ ...prior, sha256: 'f'.repeat(64) }], appendEntry, prepareSource: prepareIdentity,
    })).rejects.toThrow(/no longer matches/)
  })
})
