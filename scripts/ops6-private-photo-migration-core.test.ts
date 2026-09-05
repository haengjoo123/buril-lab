import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildPhotoMigrationInventory,
  canonicalManifestEntry,
  derivePrivatePath,
  expectedScopePrefix,
  inspectSourceImage,
  inspectWebp,
  nextManifestJournalLine,
  normalizeObjectPath,
  optimizedLongEdges,
  parseLegacyCabinetPublicUrl,
  scaledDimensions,
  validatePrivatePath,
  verifyManifestJournal,
} from './ops6-private-photo-migration-core.mjs'

const origin = 'https://abcdefghijklmnopqrst.supabase.co'
const actor = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const lab = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const cabinet = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const privatePath = (n: number, scope = lab(1)) =>
  `labs/${scope}/cabinets/${cabinet(n)}/80000000-0000-4000-8000-${String(n).padStart(12, '0')}.webp`
const publicUrl = (path: string) => `${origin}/storage/v1/object/public/cabinets/${path.split('/').map(encodeURIComponent).join('/')}`
const row = (n: number, values: Record<string, unknown> = {}) => ({
  id: cabinet(n), user_id: actor(1), lab_id: lab(1), image_url: null, image_path: null, ...values,
})

describe('Ops6 private photo migration core', () => {
  it('parses only canonical same-origin cabinet public URLs', () => {
    expect(parseLegacyCabinetPublicUrl(publicUrl('기존 사진/시약장 1.webp'), origin)).toBe('기존 사진/시약장 1.webp')
    expect(() => parseLegacyCabinetPublicUrl('https://evil.invalid/storage/v1/object/public/cabinets/a.webp', origin)).toThrow(/exact Supabase origin/)
    expect(() => parseLegacyCabinetPublicUrl(`${origin}/storage/v1/object/public/cabinets/a%2Fb.webp`, origin)).toThrow(/encoded separator/)
    expect(() => parseLegacyCabinetPublicUrl(`${origin}/storage/v1/object/public/products/a.webp`, origin)).toThrow(/outside/)
    expect(() => parseLegacyCabinetPublicUrl(`${origin}/storage/v1/object/public/cabinets/a.webp?token=x`, origin)).toThrow(/exact Supabase origin/)
  })

  it.each(['', '/absolute.webp', '../escape.webp', 'a//b.webp', 'a\\b.webp', 'a/./b.webp'])('rejects a non-canonical object path: %s', (path) => {
    expect(() => normalizeObjectPath(path)).toThrow(/ops6-photo-migration/)
  })

  it('binds lab and personal paths to exact ownership scopes', () => {
    expect(expectedScopePrefix(row(1))).toBe(`labs/${lab(1)}/cabinets/${cabinet(1)}`)
    expect(expectedScopePrefix(row(2, { lab_id: null, user_id: actor(2) }))).toBe(`users/${actor(2)}/cabinets/${cabinet(2)}`)
    expect(validatePrivatePath(row(1), privatePath(1))).toBe(privatePath(1))
    expect(() => validatePrivatePath(row(1), privatePath(1, lab(2)))).toThrow(/ownership scope/)
    expect(() => expectedScopePrefix(row(2, { lab_id: null, user_id: null }))).toThrow(/owner is missing/)
  })

  it('derives a stable UUID path from cabinet, legacy path, and verified hash', () => {
    const hash = 'a'.repeat(64)
    const first = derivePrivatePath(row(1), 'legacy/one.webp', hash)
    const second = derivePrivatePath(row(1), 'legacy/one.webp', hash)
    expect(first).toBe(second)
    expect(first).toMatch(new RegExp(`^labs/${lab(1)}/cabinets/${cabinet(1)}/[0-9a-f-]{36}\\.webp$`))
    expect(derivePrivatePath(row(1), 'legacy/two.webp', hash)).not.toBe(first)
  })

  it('accepts only a bounded WebP body and returns exact evidence', () => {
    const body = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('synthetic')])
    expect(inspectWebp(body)).toEqual({
      sizeBytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    })
    expect(() => inspectWebp(Buffer.from('not-webp'))).toThrow(/bounded WebP/)
    expect(() => inspectWebp(Buffer.alloc(2 * 1024 * 1024 + 1))).toThrow(/bounded WebP/)
  })

  it('accepts only bounded JPEG, PNG, or WebP source bytes and checks declared content type', () => {
    const jpeg = Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10])
    const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00])
    expect(inspectSourceImage(jpeg, 'image/jpeg')).toMatchObject({ mimeType: 'image/jpeg', sizeBytes: jpeg.length })
    expect(inspectSourceImage(png)).toMatchObject({ mimeType: 'image/png', sizeBytes: png.length })
    expect(() => inspectSourceImage(jpeg, 'image/png')).toThrow(/does not match/)
    expect(() => inspectSourceImage(Buffer.from('not-an-image'))).toThrow(/unsupported/)
    expect(() => inspectSourceImage(Buffer.alloc(20 * 1024 * 1024 + 1))).toThrow(/byte boundary/)
  })

  it('uses the same bounded resize ladder as browser photo optimization', () => {
    expect(optimizedLongEdges(4000)).toEqual([1920, 1536, 1280])
    expect(optimizedLongEdges(1500)).toEqual([1500, 1280])
    expect(optimizedLongEdges(900)).toEqual([900])
    expect(scaledDimensions(4000, 2250, 1920)).toEqual({ width: 1920, height: 1080 })
  })

  it('builds pending, migrated, missing, quarantine, and warning evidence', () => {
    const pendingPath = 'legacy/pending.webp'
    const migratedSource = 'legacy/migrated.webp'
    const migratedPrivate = privatePath(2)
    const rows = [
      row(1, { image_url: publicUrl(pendingPath) }),
      row(2, { image_url: publicUrl(migratedSource), image_path: migratedPrivate }),
      row(3, { image_url: publicUrl('legacy/missing.webp') }),
      ...Array.from({ length: 37 }, (_, index) => row(100 + index, { image_path: privatePath(100 + index) })),
    ]
    const objects = [pendingPath, migratedSource, migratedPrivate, 'orphan/quarantine.webp',
      ...Array.from({ length: 37 }, (_, index) => privatePath(100 + index))]
    const result = buildPhotoMigrationInventory(rows, objects, origin)
    expect(result.pending).toHaveLength(2)
    expect(result.migrated).toHaveLength(38)
    expect(result.missing).toEqual([{ cabinetId: cabinet(3), path: 'legacy/missing.webp', kind: 'legacy' }])
    expect(result.quarantine).toEqual(['orphan/quarantine.webp'])
    expect(result.scopes).toEqual([{ scope: `lab:${lab(1)}`, referencedCount: 40, warning: true }])
    expect(result.complete).toBe(false)
  })

  it('rejects duplicate ownership and the 51st referenced photo in a scope', () => {
    const duplicate = 'legacy/shared.webp'
    expect(() => buildPhotoMigrationInventory([
      row(1, { image_url: publicUrl(duplicate) }), row(2, { image_url: publicUrl(duplicate) }),
    ], [duplicate], origin)).toThrow(/multiple cabinets/)
    const fiftyOne = Array.from({ length: 51 }, (_, index) => row(index + 1, { image_path: privatePath(index + 1) }))
    expect(() => buildPhotoMigrationInventory(fiftyOne, fiftyOne.map((item) => item.image_path), origin)).toThrow(/exceeds fifty/)
  })

  it('chains canonical migration entries and detects tampering or duplicates', () => {
    const entry = canonicalManifestEntry({
      cabinetId: cabinet(1), sourcePath: 'legacy/one.webp', privatePath: privatePath(1),
      sha256: 'a'.repeat(64), sizeBytes: 1234, verifiedAt: '2026-09-04T00:00:00+09:00',
      sourceSha256: 'b'.repeat(64), sourceSizeBytes: 4321, sourceMimeType: 'image/jpeg',
    })
    const first = nextManifestJournalLine(null, entry)
    const second = nextManifestJournalLine(first.entryHash, {
      ...entry, cabinetId: cabinet(2), sourcePath: 'legacy/two.webp', privatePath: privatePath(2),
    })
    expect(verifyManifestJournal([first, second])).toMatchObject({ count: 2, finalHash: second.entryHash })
    expect(() => verifyManifestJournal([{ ...first, entryHash: 'b'.repeat(64) }])).toThrow(/entry hash/)
    expect(() => verifyManifestJournal([first, nextManifestJournalLine(first.entryHash, entry)])).toThrow(/repeats a cabinet/)
    expect(() => canonicalManifestEntry({ ...entry, sourceMimeType: undefined })).toThrow(/source evidence/)
  })
})
