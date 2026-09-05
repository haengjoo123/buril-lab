import { createHash } from 'node:crypto'

export const OPS6_CABINET_BUCKET = 'cabinets'
export const OPS6_MAX_REFERENCED_PER_SCOPE = 50
export const OPS6_WARNING_REFERENCED_PER_SCOPE = 40
export const OPS6_MAX_CABINETS = 5_000
export const OPS6_MAX_OBJECTS = 10_000
export const OPS6_MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024
export const OPS6_MAX_SOURCE_PIXELS = 64_000_000
export const OPS6_MAX_LONG_EDGE = 1920
export const OPS6_MIN_LONG_EDGE = 1280
export const OPS6_WEBP_QUALITY_STEPS = Object.freeze([84, 78, 72])
export const OPS6_MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const OPS6_WEBP_MIME = 'image/webp'
export const OPS6_SOURCE_IMAGE_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', OPS6_WEBP_MIME])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const PRIVATE_PATH = /^(labs|users)\/([0-9a-f-]{36})\/cabinets\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.webp$/i

function fail(message) {
  throw new Error(`[ops6-photo-migration] ${message}`)
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value)
}

export function normalizeObjectPath(value, label = 'Storage object path') {
  if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > 1024
    || value.startsWith('/') || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value)) {
    fail(`${label} is invalid`)
  }
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail(`${label} is not canonical`)
  }
  return value
}

export function parseLegacyCabinetPublicUrl(value, supabaseOrigin) {
  if (typeof value !== 'string' || !value || typeof supabaseOrigin !== 'string') {
    fail('legacy public URL input is invalid')
  }
  let url
  let origin
  try {
    url = new URL(value)
    origin = new URL(supabaseOrigin).origin
  } catch {
    fail('legacy public URL is malformed')
  }
  if (url.origin !== origin || url.username || url.password || url.search || url.hash) {
    fail('legacy public URL does not belong to the exact Supabase origin')
  }
  const prefix = `/storage/v1/object/public/${OPS6_CABINET_BUCKET}/`
  if (!url.pathname.startsWith(prefix)) fail('legacy public URL is outside the cabinet bucket')
  const encoded = url.pathname.slice(prefix.length)
  if (/%2f|%5c/i.test(encoded)) fail('legacy public URL contains an encoded separator')
  let decoded
  try { decoded = decodeURIComponent(encoded) } catch { fail('legacy public URL has invalid encoding') }
  return normalizeObjectPath(decoded, 'Legacy cabinet object path')
}

export function expectedScopePrefix(row) {
  if (!isRecord(row) || !isUuid(row.id)) fail('cabinet id is invalid')
  if (row.lab_id !== null && row.lab_id !== undefined) {
    if (!isUuid(row.lab_id)) fail('cabinet lab id is invalid')
    return `labs/${row.lab_id.toLowerCase()}/cabinets/${row.id.toLowerCase()}`
  }
  if (!isUuid(row.user_id)) fail('personal cabinet owner is missing')
  return `users/${row.user_id.toLowerCase()}/cabinets/${row.id.toLowerCase()}`
}

export function validatePrivatePath(row, value) {
  const path = normalizeObjectPath(value, 'Private cabinet object path')
  const match = PRIVATE_PATH.exec(path)
  if (!match || !isUuid(match[2]) || !isUuid(match[3]) || !isUuid(match[4])
    || !path.toLowerCase().startsWith(`${expectedScopePrefix(row)}/`)) {
    fail('private cabinet path is outside its exact ownership scope')
  }
  return path.toLowerCase()
}

function deterministicUuid(seed) {
  const bytes = createHash('sha256').update(seed, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

export function derivePrivatePath(row, legacyPath, sha256) {
  const source = normalizeObjectPath(legacyPath, 'Legacy cabinet object path')
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) fail('cabinet image SHA-256 is invalid')
  const id = deterministicUuid(`burillab:ops6:cabinet-photo:${row.id.toLowerCase()}:${source}:${sha256}`)
  return `${expectedScopePrefix(row)}/${id}.webp`
}

export function inspectWebp(bytes) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? [])
  if (value.length < 12 || value.length > OPS6_MAX_IMAGE_BYTES
    || value.subarray(0,4).toString('ascii') !== 'RIFF'
    || value.subarray(8,12).toString('ascii') !== 'WEBP') {
    fail('cabinet image is not a bounded WebP body')
  }
  return Object.freeze({
    sizeBytes: value.length,
    sha256: createHash('sha256').update(value).digest('hex'),
  })
}

export function inspectSourceImage(bytes, declaredMime = '') {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? [])
  if (!value.length || value.length > OPS6_MAX_SOURCE_IMAGE_BYTES) {
    fail('cabinet source image exceeds its byte boundary')
  }
  let mimeType = null
  if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) {
    mimeType = 'image/jpeg'
  } else if (value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) {
    mimeType = 'image/png'
  } else if (value.length >= 12 && value.subarray(0,4).toString('ascii') === 'RIFF'
    && value.subarray(8,12).toString('ascii') === 'WEBP') {
    mimeType = OPS6_WEBP_MIME
  }
  if (!mimeType) fail('cabinet source image type is unsupported')
  const normalizedDeclared = typeof declaredMime === 'string' ? declaredMime.trim().toLowerCase() : ''
  if (normalizedDeclared && (!OPS6_SOURCE_IMAGE_MIME_TYPES.includes(normalizedDeclared) || normalizedDeclared !== mimeType)) {
    fail('cabinet source image content type does not match its bytes')
  }
  return Object.freeze({
    mimeType,
    sizeBytes: value.length,
    sha256: createHash('sha256').update(value).digest('hex'),
  })
}

export function optimizedLongEdges(sourceLongEdge) {
  if (!Number.isSafeInteger(sourceLongEdge) || sourceLongEdge < 1) fail('cabinet source dimensions are invalid')
  const initial = Math.min(sourceLongEdge, OPS6_MAX_LONG_EDGE)
  const reduced = Math.min(initial, Math.max(OPS6_MIN_LONG_EDGE, Math.floor(initial * 0.8)))
  const minimum = Math.min(initial, OPS6_MIN_LONG_EDGE)
  return Object.freeze([...new Set([initial, reduced, minimum])])
}

export function scaledDimensions(width, height, maxLongEdge) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(maxLongEdge) || maxLongEdge < 1) {
    fail('cabinet source dimensions are invalid')
  }
  const longEdge = Math.max(width, height)
  if (longEdge <= maxLongEdge) return Object.freeze({ width, height })
  const scale = maxLongEdge / longEdge
  return Object.freeze({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  })
}

function normalizeRow(row) {
  if (!isRecord(row) || !isUuid(row.id)
    || !(row.lab_id === null || row.lab_id === undefined || isUuid(row.lab_id))
    || !(row.user_id === null || row.user_id === undefined || isUuid(row.user_id))
    || !(row.image_url === null || row.image_url === undefined || typeof row.image_url === 'string')
    || !(row.image_path === null || row.image_path === undefined || typeof row.image_path === 'string')) {
    fail('cabinet row has an invalid shape')
  }
  if ((row.lab_id === null || row.lab_id === undefined) && !isUuid(row.user_id)) {
    fail('personal cabinet has no owner')
  }
  return Object.freeze({
    id: row.id.toLowerCase(),
    labId: row.lab_id?.toLowerCase() ?? null,
    userId: row.user_id?.toLowerCase() ?? null,
    imageUrl: row.image_url || null,
    imagePath: row.image_path || null,
  })
}

function scopeKey(row) {
  return row.labId ? `lab:${row.labId}` : `user:${row.userId}`
}

export function buildPhotoMigrationInventory(rows, storageObjectPaths, supabaseOrigin) {
  if (!Array.isArray(rows) || rows.length > OPS6_MAX_CABINETS) fail('cabinet row boundary exceeded')
  if (!Array.isArray(storageObjectPaths) || storageObjectPaths.length > OPS6_MAX_OBJECTS) fail('Storage object boundary exceeded')
  const objectPaths = storageObjectPaths.map((value) => normalizeObjectPath(value))
  if (new Set(objectPaths).size !== objectPaths.length) fail('Storage listing contains duplicate paths')
  const objectSet = new Set(objectPaths)
  const references = new Set()
  const sourceOwners = new Map()
  const privateOwners = new Map()
  const scopes = new Map()
  const pending = []
  const migrated = []
  const missing = []
  const normalizedRows = rows.map(normalizeRow).sort((a,b) => a.id.localeCompare(b.id, 'en'))
  if (new Set(normalizedRows.map((row) => row.id)).size !== normalizedRows.length) fail('cabinet rows contain duplicate ids')

  for (const row of normalizedRows) {
    const legacyPath = row.imageUrl ? parseLegacyCabinetPublicUrl(row.imageUrl, supabaseOrigin) : null
    const privatePath = row.imagePath ? validatePrivatePath({ id: row.id, lab_id: row.labId, user_id: row.userId }, row.imagePath) : null
    if (!legacyPath && !privatePath) continue
    const key = scopeKey(row)
    const count = (scopes.get(key) ?? 0) + 1
    if (count > OPS6_MAX_REFERENCED_PER_SCOPE) fail(`scope ${key} exceeds fifty referenced photos`)
    scopes.set(key, count)
    if (legacyPath) {
      if (sourceOwners.has(legacyPath) && sourceOwners.get(legacyPath) !== row.id) fail('one legacy object is referenced by multiple cabinets')
      sourceOwners.set(legacyPath, row.id)
      references.add(legacyPath)
      if (!objectSet.has(legacyPath)) missing.push({ cabinetId: row.id, path: legacyPath, kind: 'legacy' })
    }
    if (privatePath) {
      if (privateOwners.has(privatePath) && privateOwners.get(privatePath) !== row.id) fail('one private object is referenced by multiple cabinets')
      privateOwners.set(privatePath, row.id)
      references.add(privatePath)
      if (!objectSet.has(privatePath)) missing.push({ cabinetId: row.id, path: privatePath, kind: 'private' })
      migrated.push({ ...row, legacyPath, privatePath })
    } else {
      pending.push({ ...row, legacyPath })
    }
  }
  const scopeSummary = [...scopes.entries()].sort(([a],[b]) => a.localeCompare(b, 'en')).map(([scope,count]) => ({
    scope,
    referencedCount: count,
    warning: count >= OPS6_WARNING_REFERENCED_PER_SCOPE,
  }))
  return Object.freeze({
    cabinetRows: normalizedRows.length,
    storageObjects: objectPaths.length,
    pending: Object.freeze(pending),
    migrated: Object.freeze(migrated),
    missing: Object.freeze(missing.sort((a,b) => a.path.localeCompare(b.path, 'en'))),
    quarantine: Object.freeze(objectPaths.filter((path) => !references.has(path)).sort((a,b) => a.localeCompare(b, 'en'))),
    scopes: Object.freeze(scopeSummary),
    complete: pending.length === 0 && missing.length === 0,
  })
}

export function canonicalManifestEntry(entry) {
  if (!isRecord(entry) || !isUuid(entry.cabinetId)) fail('manifest cabinet id is invalid')
  const sourcePath = normalizeObjectPath(entry.sourcePath, 'Manifest source path')
  const privatePath = normalizeObjectPath(entry.privatePath, 'Manifest private path')
  if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)
    || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 1 || entry.sizeBytes > OPS6_MAX_IMAGE_BYTES
    || typeof entry.verifiedAt !== 'string' || Number.isNaN(Date.parse(entry.verifiedAt))) {
    fail('manifest verification evidence is invalid')
  }
  const hasAnySourceEvidence = entry.sourceSha256 !== undefined || entry.sourceSizeBytes !== undefined
    || entry.sourceMimeType !== undefined
  if (hasAnySourceEvidence && (typeof entry.sourceSha256 !== 'string' || !SHA256.test(entry.sourceSha256)
    || !Number.isSafeInteger(entry.sourceSizeBytes) || entry.sourceSizeBytes < 1
    || entry.sourceSizeBytes > OPS6_MAX_SOURCE_IMAGE_BYTES
    || !OPS6_SOURCE_IMAGE_MIME_TYPES.includes(entry.sourceMimeType))) {
    fail('manifest source evidence is invalid')
  }
  const canonical = {
    cabinetId: entry.cabinetId.toLowerCase(),
    sourcePath,
    privatePath,
    sha256: entry.sha256,
    sizeBytes: entry.sizeBytes,
    verifiedAt: new Date(entry.verifiedAt).toISOString(),
  }
  if (hasAnySourceEvidence) Object.assign(canonical, {
    sourceSha256: entry.sourceSha256,
    sourceSizeBytes: entry.sourceSizeBytes,
    sourceMimeType: entry.sourceMimeType,
  })
  return Object.freeze(canonical)
}

export function nextManifestJournalLine(previousHash, entry) {
  if (previousHash !== null && (typeof previousHash !== 'string' || !SHA256.test(previousHash))) {
    fail('manifest journal predecessor hash is invalid')
  }
  const canonical = canonicalManifestEntry(entry)
  const payload = { version: 1, previousHash, entry: canonical }
  const entryHash = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
  return Object.freeze({ ...payload, entryHash })
}

export function verifyManifestJournal(lines) {
  if (!Array.isArray(lines) || lines.length > OPS6_MAX_CABINETS) fail('manifest journal boundary exceeded')
  const entries = []
  let previousHash = null
  const cabinets = new Set()
  for (const line of lines) {
    if (!isRecord(line) || line.version !== 1 || line.previousHash !== previousHash || typeof line.entryHash !== 'string') {
      fail('manifest journal chain is invalid')
    }
    const expected = nextManifestJournalLine(previousHash, line.entry)
    if (line.entryHash !== expected.entryHash) fail('manifest journal entry hash is invalid')
    if (cabinets.has(expected.entry.cabinetId)) fail('manifest journal repeats a cabinet')
    cabinets.add(expected.entry.cabinetId)
    entries.push(expected.entry)
    previousHash = expected.entryHash
  }
  return Object.freeze({ entries: Object.freeze(entries), finalHash: previousHash, count: entries.length })
}
