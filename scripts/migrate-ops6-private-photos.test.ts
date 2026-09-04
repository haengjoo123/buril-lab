import { describe, expect, it, vi } from 'vitest'
import {
  createBoundedSupabaseFetch,
  migrateOps6PhotoSet,
  parseOps6SupabaseTarget,
  verifyOps6BackendCredential,
} from './migrate-ops6-private-photos.mjs'
import {
  buildPhotoMigrationInventory,
  derivePrivatePath,
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
  })

  it('copies, downloads, hashes, binds, and journals one pending photo without deletion', async () => {
    const fixture = adapterFixture()
    const entries: unknown[] = []
    const result = await migrateOps6PhotoSet({
      inventory: inventory(), adapter: fixture.adapter,
      appendEntry: async (entry: unknown) => { entries.push(entry) },
      now: () => new Date('2026-09-04T01:00:00Z'),
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
    })).resolves.toMatchObject({ candidates: 1 })
    expect(entries).toHaveLength(1)
  })

  it('fails closed when upload bytes or provider commit state differ', async () => {
    const wrongBody = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('wrong')])
    const mismatch = adapterFixture({ existingBody: wrongBody })
    await expect(migrateOps6PhotoSet({
      inventory: inventory([sourcePath, mismatch.target]), adapter: mismatch.adapter,
      appendEntry: async () => undefined,
    })).rejects.toThrow(/SHA-256 verification/)

    const unknown = adapterFixture({ acknowledge: false, commit: false })
    await expect(migrateOps6PhotoSet({
      inventory: inventory(), adapter: unknown.adapter,
      appendEntry: async () => undefined,
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
      adapter: fixture.adapter, priorEntries: [prior], appendEntry,
    })
    expect(appendEntry).not.toHaveBeenCalled()
    await expect(migrateOps6PhotoSet({
      inventory: inventory(), adapter: fixture.adapter,
      priorEntries: [{ ...prior, sha256: 'f'.repeat(64) }], appendEntry,
    })).rejects.toThrow(/no longer matches/)
  })
})
