import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  GATE0_RESERVED_INVENTORY_ID,
  GATE0_RESERVED_LAB_ID,
  GATE0_RESERVED_POLICY_ID,
  verifyExistingFixtureOwnership,
} from './gate0-seed-safety.mjs'
import { verifyCloudflareTokenTtl } from './verify-cloudflare-token-ttl.mjs'

const STAGING_PROJECT_REF = 'qpgnomuqdcucjmxrunnw'
const STAGING_ORIGIN = `https://${STAGING_PROJECT_REF}.supabase.co`
const CLOUDFLARE_ACCOUNT_ID = '692fedd5b67a5fd545bb16038bbd4c85'
const RUNTIME_CONFIG_KV_ID = 'dcaa52254fa6447bbe7c21f54354ad0d'
const WORKER_NAME = 'buril-lab-storage-backup-staging'
const R2_BUCKET = 'buril-lab-cabinet-backups-staging'
const SOURCE_BUCKET = 'cabinets'
const DAILY_CRON = '15 17 * * *'
const ACCEPTANCE_CRON = '* * * * *'
const CONFIRMATION = `RUN STAGING STORAGE BACKUP ACCEPTANCE ${STAGING_PROJECT_REF} ${WORKER_NAME}`
const MAX_JSON_BYTES = 2 * 1024 * 1024
const MAX_OBJECT_BYTES = 4 * 1024 * 1024
const ENABLE_TTL_SECONDS = 25 * 60
const KV_PROPAGATION_WAIT_MS = 70_000
// Cloudflare documents up to 15 minutes for Cron Trigger changes to reach the
// global network. Keep a bounded five-minute margin for the first invocation
// and the snapshot verification, while the GitHub job remains capped at 35m.
const ACCEPTANCE_TIMEOUT_MS = 20 * 60 * 1000
const POLL_INTERVAL_MS = 15_000
const RUNTIME_CONFIG_OFF = Object.freeze({
  voice_disposal_mode: 'redirect',
  kosha_content_mode: 'link_only',
  account_deletion_enabled: false,
  maintenance_worker_enabled: false,
  storage_backup_enabled: false,
})
const RUNTIME_CONFIG_ON = Object.freeze({
  ...RUNTIME_CONFIG_OFF,
  storage_backup_enabled: true,
})
const FIXTURE = Object.freeze([
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000011',
    name: 'Storage backup synthetic cabinet A',
    path: 'burillab-storage-backup-acceptance/fixture-a.png',
    bytes: 1_700_000,
    rgba: Object.freeze([23, 91, 146, 255]),
  }),
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000012',
    name: 'Storage backup synthetic cabinet B',
    path: 'burillab-storage-backup-acceptance/fixture-b.png',
    bytes: 1_710_853,
    rgba: Object.freeze([20, 132, 92, 255]),
  }),
])
const EXPECTED_TOTAL_BYTES = FIXTURE.reduce((sum, item) => sum + item.bytes, 0)

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) throw new Error(`${label} has an invalid shape.`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains missing or unapproved fields.`)
  }
  return value
}

function validateEnvironment(environment, { needsCloudflare = false, needsSupabase = false } = {}) {
  if (environment.DEPLOY_ENVIRONMENT !== 'staging') {
    throw new Error('Storage backup acceptance is restricted to Staging.')
  }
  if (environment.STAGING_STORAGE_BACKUP_CONFIRMATION !== CONFIRMATION) {
    throw new Error('Storage backup acceptance confirmation is missing or incorrect.')
  }
  if (
    environment.GITHUB_REPOSITORY !== 'haengjoo123/buril-lab'
    || environment.GITHUB_REF !== 'refs/heads/main'
    || environment.GITHUB_RUN_ATTEMPT !== '1'
  ) {
    throw new Error('Storage backup acceptance must be a first-attempt protected-main run.')
  }
  if (needsCloudflare) {
    if (
      environment.CLOUDFLARE_ACCOUNT_ID !== CLOUDFLARE_ACCOUNT_ID
      || environment.BURILLAB_RUNTIME_CONFIG_KV_ID !== RUNTIME_CONFIG_KV_ID
    ) {
      throw new Error('Storage backup acceptance received the wrong Cloudflare target.')
    }
    const token = environment.CLOUDFLARE_STORAGE_BACKUP_ACCEPTANCE_TOKEN
    if (typeof token !== 'string' || token.length < 20 || /[\r\n\0]/.test(token)) {
      throw new Error('Staging storage backup acceptance token is missing or malformed.')
    }
  }
  if (needsSupabase) {
    if (environment.SUPABASE_URL !== STAGING_ORIGIN) {
      throw new Error('Storage backup acceptance received the wrong Supabase target.')
    }
    const key = environment.SUPABASE_SERVICE_ROLE_KEY
    if (typeof key !== 'string' || key.length < 20 || /[\r\n\0]/.test(key)) {
      throw new Error('Staging Supabase service credential is missing or malformed.')
    }
  }
}

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1))
    }
  }
  return (value ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const payload = Buffer.from(data)
  const output = Buffer.alloc(12 + payload.length)
  output.writeUInt32BE(payload.length, 0)
  typeBytes.copy(output, 4)
  payload.copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.length)
  return output
}

export function createExactLengthPng(targetBytes, rgba) {
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 256) {
    throw new Error('Synthetic PNG target size is invalid.')
  }
  if (!Array.isArray(rgba) || rgba.length !== 4 || rgba.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('Synthetic PNG pixel is invalid.')
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const idat = pngChunk('IDAT', deflateSync(Buffer.from([0, ...rgba]), { level: 9 }))
  const fixed = [signature, pngChunk('IHDR', ihdr), idat, pngChunk('IEND', Buffer.alloc(0))]
  const fixedBytes = fixed.reduce((sum, item) => sum + item.length, 0)
  const textLength = targetBytes - fixedBytes - 12
  const keyword = Buffer.from('Comment\0', 'latin1')
  if (textLength < keyword.length) throw new Error('Synthetic PNG target is too small.')
  const text = Buffer.alloc(textLength, 0x53)
  keyword.copy(text)
  const output = Buffer.concat([fixed[0], fixed[1], pngChunk('tEXt', text), fixed[2], fixed[3]])
  if (output.length !== targetBytes) throw new Error('Synthetic PNG length construction failed.')
  return output
}

function fixtureBodies() {
  return FIXTURE.map((item) => {
    const body = createExactLengthPng(item.bytes, item.rgba)
    return {
      ...item,
      body,
      sha256: createHash('sha256').update(body).digest('hex'),
      publicUrl: `${STAGING_ORIGIN}/storage/v1/object/public/${SOURCE_BUCKET}/${item.path}`,
    }
  })
}

function createSupabase(environment) {
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireResult(promise, label) {
  const result = await promise
  if (result.error) throw new Error(`${label} failed.`)
  return result.data
}

async function readGate0Owner(supabase) {
  const [lab, inventory, policy, membership] = await Promise.all([
    requireResult(
      supabase.from('labs').select('id,name,created_by').eq('id', GATE0_RESERVED_LAB_ID).maybeSingle(),
      'Reading the reserved Staging lab',
    ),
    requireResult(
      supabase.from('inventory').select('id,lab_id,user_id,name').eq('id', GATE0_RESERVED_INVENTORY_ID).maybeSingle(),
      'Reading the reserved Staging inventory',
    ),
    requireResult(
      supabase.from('waste_policy_versions').select('id,name,scope_type,created_by,activated_by').eq('id', GATE0_RESERVED_POLICY_ID).maybeSingle(),
      'Reading the reserved Staging policy',
    ),
    requireResult(
      supabase.from('lab_members').select('lab_id,user_id,role').eq('lab_id', GATE0_RESERVED_LAB_ID).maybeSingle(),
      'Reading the reserved Staging membership',
    ),
  ])
  if (!lab || !membership) throw new Error('The reserved Staging fixture is incomplete.')
  const userResult = await supabase.auth.admin.getUserById(membership.user_id)
  if (userResult.error || !userResult.data?.user) {
    throw new Error('Reading the reserved Staging owner failed.')
  }
  return verifyExistingFixtureOwnership({
    user: userResult.data.user,
    lab,
    inventory,
    policy,
    membership,
  })
}

async function listSourceObjects(environment) {
  const queue = ['']
  const visited = new Set()
  const objects = []
  let pages = 0
  while (queue.length > 0) {
    const prefix = queue.shift()
    if (visited.has(prefix)) throw new Error('Staging Storage listing repeated a prefix.')
    visited.add(prefix)
    for (let offset = 0; ; offset += 100) {
      pages += 1
      if (pages > 10) throw new Error('Staging Storage listing exceeded its safety bound.')
      const response = await fetch(`${STAGING_ORIGIN}/storage/v1/object/list/${SOURCE_BUCKET}`, {
        method: 'POST',
        headers: {
          apikey: environment.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${environment.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prefix,
          limit: 100,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok || response.redirected) throw new Error('Staging Storage listing failed.')
      const items = await readResponseJson(response, 'Staging Storage listing', MAX_JSON_BYTES)
      if (!Array.isArray(items) || items.length > 100) throw new Error('Staging Storage listing returned an invalid shape.')
      for (const item of items) {
        if (!isRecord(item) || typeof item.name !== 'string' || /[\\/\0]/.test(item.name)) {
          throw new Error('Staging Storage listing returned an invalid item.')
        }
        const path = prefix ? `${prefix}/${item.name}` : item.name
        if (item.id === null) queue.push(path)
        else objects.push({ path, metadata: item.metadata })
        if (objects.length + queue.length > 50) throw new Error('Staging Storage fixture boundary exceeded 50 objects.')
      }
      if (items.length < 100) break
    }
  }
  return objects.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

async function assertFixtureSourceEmpty(supabase, environment) {
  const cabinetResult = await supabase.from('cabinets').select('id', { count: 'exact' }).limit(1)
  if (cabinetResult.error || cabinetResult.count !== 0 || (cabinetResult.data?.length ?? 0) !== 0) {
    throw new Error('Staging acceptance requires an empty cabinets table.')
  }
  const objects = await listSourceObjects(environment)
  if (objects.length !== 0) throw new Error('Staging acceptance requires an empty cabinets Storage bucket.')
}

async function assertPreparedFixture(supabase, environment) {
  const expected = fixtureBodies()
  const rows = await requireResult(
    supabase.from('cabinets').select('id,name,lab_id,user_id,image_url').in('id', FIXTURE.map((item) => item.id)).order('id'),
    'Reading the prepared Staging cabinets',
  )
  if (!Array.isArray(rows) || rows.length !== FIXTURE.length) {
    throw new Error('Staging cabinet fixture is incomplete.')
  }
  for (const fixture of expected) {
    const row = rows.find((item) => item.id === fixture.id)
    if (
      !row
      || row.name !== fixture.name
      || row.lab_id !== GATE0_RESERVED_LAB_ID
      || row.user_id !== null
      || row.image_url !== fixture.publicUrl
    ) {
      throw new Error('Staging cabinet fixture ownership or pointer differs from the approved fixture.')
    }
    const response = await fetch(fixture.publicUrl, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok || response.redirected) throw new Error('Reading a synthetic Staging image failed.')
    const body = Buffer.from(await readResponseBytes(response, 'Synthetic Staging image', MAX_OBJECT_BYTES))
    if (body.length !== fixture.bytes || createHash('sha256').update(body).digest('hex') !== fixture.sha256) {
      throw new Error('A synthetic Staging image failed its size or SHA-256 check.')
    }
  }
  const objects = await listSourceObjects(environment)
  if (
    objects.length !== FIXTURE.length
    || objects.some((object, index) => object.path !== [...FIXTURE].sort((a, b) => a.path.localeCompare(b.path, 'en'))[index].path)
  ) {
    throw new Error('Staging Storage contains objects outside the exact synthetic fixture.')
  }
}

async function prepareFixture(environment) {
  validateEnvironment(environment, { needsSupabase: true })
  const supabase = createSupabase(environment)
  const owner = await readGate0Owner(supabase)
  await assertFixtureSourceEmpty(supabase, environment)
  const bodies = fixtureBodies()
  try {
    for (const fixture of bodies) {
      const upload = await supabase.storage.from(SOURCE_BUCKET).upload(fixture.path, fixture.body, {
        cacheControl: '0',
        contentType: 'image/png',
        upsert: false,
      })
      if (upload.error) throw new Error('Uploading a synthetic Staging image failed.')
    }
    const inserted = await supabase.from('cabinets').insert(bodies.map((fixture) => ({
      id: fixture.id,
      name: fixture.name,
      width: 1,
      height: 1,
      depth: 1,
      user_id: null,
      lab_id: GATE0_RESERVED_LAB_ID,
      location: 'Synthetic backup acceptance only',
      image_url: fixture.publicUrl,
    })))
    if (inserted.error) throw new Error('Creating the synthetic Staging cabinet pointers failed.')
    await assertPreparedFixture(supabase, environment)
    if (!owner) throw new Error('The reserved Staging owner disappeared during fixture preparation.')
  } catch (error) {
    await cleanupFixture(environment).catch(() => undefined)
    throw error
  }
  console.log(`Prepared ${FIXTURE.length} synthetic Staging images (${EXPECTED_TOTAL_BYTES} bytes).`)
}

async function cleanupFixture(environment) {
  validateEnvironment(environment, { needsSupabase: true })
  const supabase = createSupabase(environment)
  await readGate0Owner(supabase)
  const rows = await requireResult(
    supabase.from('cabinets').select('id,name,lab_id,user_id,image_url').in('id', FIXTURE.map((item) => item.id)),
    'Reading synthetic Staging cabinets for cleanup',
  )
  const expected = fixtureBodies()
  for (const row of rows || []) {
    const fixture = expected.find((item) => item.id === row.id)
    if (
      !fixture
      || row.name !== fixture.name
      || row.lab_id !== GATE0_RESERVED_LAB_ID
      || row.user_id !== null
      || row.image_url !== fixture.publicUrl
    ) {
      throw new Error('Cleanup refused a cabinet outside the exact synthetic fixture.')
    }
  }
  if ((rows || []).length > 0) {
    const deletion = await supabase.from('cabinets').delete().in('id', FIXTURE.map((item) => item.id))
    if (deletion.error) throw new Error('Deleting synthetic Staging cabinet pointers failed.')
  }
  for (const fixture of expected) {
    const response = await fetch(fixture.publicUrl, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    if (response.status === 404) continue
    if (!response.ok || response.redirected) throw new Error('Reading a synthetic Staging image for cleanup failed.')
    const body = Buffer.from(await readResponseBytes(response, 'Synthetic Staging cleanup image', MAX_OBJECT_BYTES))
    if (body.length !== fixture.bytes || createHash('sha256').update(body).digest('hex') !== fixture.sha256) {
      throw new Error('Cleanup refused an image outside the exact synthetic fixture.')
    }
    const removal = await supabase.storage.from(SOURCE_BUCKET).remove([fixture.path])
    if (removal.error) throw new Error('Deleting a synthetic Staging image failed.')
  }
  const remainingRows = await supabase.from('cabinets').select('id', { count: 'exact' }).limit(1)
  if (remainingRows.error || remainingRows.count !== 0) {
    throw new Error('Staging cabinets table is not empty after fixture cleanup.')
  }
  if ((await listSourceObjects(environment)).length !== 0) {
    throw new Error('Staging cabinets Storage bucket is not empty after fixture cleanup.')
  }
  console.log('Removed the exact synthetic Staging cabinet fixture.')
}

function cloudflareBase(path) {
  return `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/${path}`
}

async function readResponseBytes(response, label, maximumBytes) {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`${label} is oversized.`)
  }
  if (!response.body) throw new Error(`${label} has no body.`)
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximumBytes) throw new Error(`${label} is oversized.`)
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((value) => Buffer.from(value)))
}

async function readResponseJson(response, label, maximumBytes = MAX_JSON_BYTES) {
  const bytes = await readResponseBytes(response, label, maximumBytes)
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }
}

async function cloudflareRequest(environment, path, {
  method = 'GET',
  body,
  contentType,
  allowMissing = false,
  raw = false,
  maximumBytes = MAX_JSON_BYTES,
} = {}) {
  const url = cloudflareBase(path)
  let response
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${environment.CLOUDFLARE_STORAGE_BACKUP_ACCEPTANCE_TOKEN}`,
        Accept: raw ? 'application/octet-stream, application/json' : 'application/json',
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new Error('A Cloudflare acceptance request could not be completed.')
  }
  if (response.redirected || response.url !== url) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('A Cloudflare acceptance response changed URL unexpectedly.')
  }
  if (allowMissing && response.status === 404) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`A Cloudflare acceptance request failed with HTTP ${response.status}.`)
  }
  if (raw) return readResponseBytes(response, 'Cloudflare R2 object', maximumBytes)
  const payload = await readResponseJson(response, 'Cloudflare API response', maximumBytes)
  const diagnosticsAreEmpty = isRecord(payload) && (
    (Array.isArray(payload.errors) && payload.errors.length === 0
      && Array.isArray(payload.messages) && payload.messages.length === 0)
    || (payload.errors === null && payload.messages === null)
  )
  if (!isRecord(payload) || payload.success !== true || !diagnosticsAreEmpty) {
    throw new Error('Cloudflare returned an unsuccessful acceptance response.')
  }
  return payload.result
}

function exactRuntimeConfig(value, expected, label) {
  exactKeys(value, Object.keys(expected), label)
  for (const [key, wanted] of Object.entries(expected)) {
    if (value[key] !== wanted) throw new Error(`${label} has an unsafe value for ${key}.`)
  }
  return true
}

async function readRuntimeConfig(environment) {
  const url = cloudflareBase(`storage/kv/namespaces/${RUNTIME_CONFIG_KV_ID}/values/runtime_config`)
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${environment.CLOUDFLARE_STORAGE_BACKUP_ACCEPTANCE_TOKEN}`,
      Accept: 'application/json',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok || response.redirected || response.url !== url) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Reading the Staging runtime config failed.')
  }
  return readResponseJson(response, 'Staging runtime config', 32 * 1024)
}

async function writeRuntimeConfig(environment, value, ttlSeconds = null) {
  const suffix = ttlSeconds === null ? '' : `?expiration_ttl=${ttlSeconds}`
  await cloudflareRequest(
    environment,
    `storage/kv/namespaces/${RUNTIME_CONFIG_KV_ID}/values/runtime_config${suffix}`,
    {
      method: 'PUT',
      body: `${JSON.stringify(value)}\n`,
      contentType: 'application/json',
    },
  )
}

function readScheduleCrons(result) {
  if (!isRecord(result) || !Array.isArray(result.schedules)) {
    throw new Error('Cloudflare Worker schedules have an invalid shape.')
  }
  return result.schedules.map((schedule) => {
    if (!isRecord(schedule) || typeof schedule.cron !== 'string') {
      throw new Error('Cloudflare Worker schedule is malformed.')
    }
    return schedule.cron
  })
}

async function readSchedules(environment) {
  return readScheduleCrons(await cloudflareRequest(environment, `workers/scripts/${WORKER_NAME}/schedules`))
}

async function writeSchedules(environment, crons) {
  await cloudflareRequest(environment, `workers/scripts/${WORKER_NAME}/schedules`, {
    method: 'PUT',
    body: JSON.stringify(crons.map((cron) => ({ cron }))),
    contentType: 'application/json',
  })
}

async function verifyPrivateR2(environment) {
  const managed = await cloudflareRequest(environment, `r2/buckets/${R2_BUCKET}/domains/managed`)
  if (!isRecord(managed) || managed.enabled !== false) {
    throw new Error('Staging backup R2 managed public domain is enabled.')
  }
  const custom = await cloudflareRequest(environment, `r2/buckets/${R2_BUCKET}/domains/custom`)
  if (!isRecord(custom) || !Array.isArray(custom.domains) || custom.domains.some((domain) => !isRecord(domain) || domain.enabled !== false)) {
    throw new Error('Staging backup R2 has an enabled or malformed custom domain.')
  }
}

async function readR2Object(environment, key, { allowMissing = false, maximumBytes = MAX_OBJECT_BYTES } = {}) {
  if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.includes('..') || key.startsWith('/') || key.endsWith('/')) {
    throw new Error('R2 acceptance object key is invalid.')
  }
  return cloudflareRequest(environment, `r2/buckets/${R2_BUCKET}/objects/${key}`, {
    raw: true,
    allowMissing,
    maximumBytes,
  })
}

async function readR2Json(environment, key, { allowMissing = false } = {}) {
  const bytes = await readR2Object(environment, key, { allowMissing, maximumBytes: MAX_JSON_BYTES })
  if (bytes === null) return null
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('R2 acceptance JSON is invalid.')
  }
}

function verifySnapshotDocuments({ latest, complete, manifest, manifestHash, startedAt, previousSnapshotId }) {
  const latestKeys = ['schemaVersion', 'snapshotId', 'environment', 'completeKey', 'manifestSha256', 'completedAt', 'orphanCount']
  exactKeys(latest, latestKeys, 'Staging R2 latest pointer')
  if (
    latest.schemaVersion !== 1
    || latest.environment !== 'staging'
    || latest.snapshotId === previousSnapshotId
    || latest.completeKey !== `snapshots/${latest.snapshotId}/complete.json`
    || latest.orphanCount !== 0
    || !Number.isFinite(Date.parse(latest.completedAt))
    || Date.parse(latest.completedAt) < startedAt
  ) {
    throw new Error('Staging R2 latest pointer does not identify the new acceptance snapshot.')
  }
  exactKeys(complete, [
    'schemaVersion', 'snapshotId', 'environment', 'completedAt', 'manifestKey',
    'manifestSha256', 'objectCount', 'referencedObjectCount', 'orphanCount', 'totalBytes',
  ], 'Staging R2 completion marker')
  if (
    complete.schemaVersion !== 1
    || complete.snapshotId !== latest.snapshotId
    || complete.environment !== 'staging'
    || complete.completedAt !== latest.completedAt
    || complete.manifestKey !== `snapshots/${latest.snapshotId}/manifest.json`
    || complete.manifestSha256 !== latest.manifestSha256
    || complete.objectCount !== FIXTURE.length
    || complete.referencedObjectCount !== FIXTURE.length
    || complete.orphanCount !== 0
    || complete.totalBytes !== EXPECTED_TOTAL_BYTES
  ) {
    throw new Error('Staging R2 completion marker differs from the acceptance contract.')
  }
  const expectedManifestHash = createHash('sha256').update(manifestHash.body).digest('hex')
  if (expectedManifestHash !== manifestHash.sha256 || manifestHash.sha256 !== latest.manifestSha256) {
    throw new Error('Staging R2 manifest SHA-256 chain is invalid.')
  }
  exactKeys(manifest, [
    'schemaVersion', 'snapshotId', 'environment', 'createdAt', 'source',
    'objectCount', 'referencedObjectCount', 'orphanCount', 'totalBytes', 'objects',
  ], 'Staging R2 manifest')
  exactKeys(manifest.source, ['supabaseProjectRef', 'storageBucket', 'pointerMode'], 'Staging R2 manifest source')
  if (
    manifest.schemaVersion !== 1
    || manifest.snapshotId !== latest.snapshotId
    || manifest.environment !== 'staging'
    || manifest.source.supabaseProjectRef !== STAGING_PROJECT_REF
    || manifest.source.storageBucket !== SOURCE_BUCKET
    || manifest.source.pointerMode !== 'legacy_url'
    || manifest.objectCount !== FIXTURE.length
    || manifest.referencedObjectCount !== FIXTURE.length
    || manifest.orphanCount !== 0
    || manifest.totalBytes !== EXPECTED_TOTAL_BYTES
    || !Array.isArray(manifest.objects)
    || manifest.objects.length !== FIXTURE.length
  ) {
    throw new Error('Staging R2 manifest differs from the acceptance contract.')
  }
  return latest.snapshotId
}

export function verifyAcceptanceManifest({ latest, complete, manifestBody, manifestShaText, startedAt, previousSnapshotId }) {
  if (!Buffer.isBuffer(manifestBody) || manifestBody.length < 2) throw new Error('Staging R2 manifest body is missing.')
  const manifestSha256 = createHash('sha256').update(manifestBody).digest('hex')
  if (typeof manifestShaText !== 'string' || !/^[0-9a-f]{64}\n$/.test(manifestShaText)) {
    throw new Error('Staging R2 manifest SHA-256 object is invalid.')
  }
  let manifest
  try {
    manifest = JSON.parse(manifestBody.toString('utf8'))
  } catch {
    throw new Error('Staging R2 manifest body is not valid JSON.')
  }
  const snapshotId = verifySnapshotDocuments({
    latest,
    complete,
    manifest,
    manifestHash: { body: manifestBody, sha256: manifestShaText.trim() },
    startedAt,
    previousSnapshotId,
  })
  if (manifestSha256 !== manifestShaText.trim()) throw new Error('Staging R2 manifest hash object does not match the body.')
  const expected = fixtureBodies().sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const actual = [...manifest.objects].sort((left, right) => String(left?.sourcePath).localeCompare(String(right?.sourcePath), 'en'))
  for (let index = 0; index < expected.length; index += 1) {
    const fixture = expected[index]
    const object = actual[index]
    exactKeys(object, ['sourcePath', 'backupKey', 'bytes', 'sha256', 'classification', 'ownerScope', 'contentType'], 'Staging R2 manifest object')
    if (
      object.sourcePath !== fixture.path
      || object.backupKey !== `snapshots/${snapshotId}/objects/${fixture.path}`
      || object.bytes !== fixture.bytes
      || object.sha256 !== fixture.sha256
      || object.classification !== 'referenced'
      || object.ownerScope !== 'lab'
      || object.contentType !== 'image/png'
    ) {
      throw new Error('Staging R2 manifest object differs from the exact synthetic fixture.')
    }
  }
  return { snapshotId, manifest, expected }
}

async function verifyCompletedSnapshot(environment, latest, startedAt, previousSnapshotId) {
  if (!isRecord(latest) || typeof latest.snapshotId !== 'string') return null
  if (latest.snapshotId === previousSnapshotId || Date.parse(latest.completedAt || '') < startedAt) return null
  const complete = await readR2Json(environment, latest.completeKey)
  const manifestKey = `snapshots/${latest.snapshotId}/manifest.json`
  const manifestHashKey = `snapshots/${latest.snapshotId}/manifest.sha256`
  const [manifestBody, manifestShaBytes] = await Promise.all([
    readR2Object(environment, manifestKey, { maximumBytes: MAX_JSON_BYTES }),
    readR2Object(environment, manifestHashKey, { maximumBytes: 256 }),
  ])
  const verified = verifyAcceptanceManifest({
    latest,
    complete,
    manifestBody,
    manifestShaText: manifestShaBytes.toString('utf8'),
    startedAt,
    previousSnapshotId,
  })
  for (const fixture of verified.expected) {
    const object = await readR2Object(environment, `snapshots/${verified.snapshotId}/objects/${fixture.path}`)
    if (object.length !== fixture.bytes || createHash('sha256').update(object).digest('hex') !== fixture.sha256) {
      throw new Error('A copied Staging R2 image failed its size or SHA-256 check.')
    }
  }
  return verified.snapshotId
}

async function restoreCloudflareSafety(environment) {
  validateEnvironment(environment, { needsCloudflare: true })
  await writeRuntimeConfig(environment, RUNTIME_CONFIG_OFF)
  const crons = await readSchedules(environment)
  if (crons.length !== 1 || crons[0] !== DAILY_CRON) {
    await writeSchedules(environment, [])
    await new Promise((resolve) => setTimeout(resolve, KV_PROPAGATION_WAIT_MS))
    await writeSchedules(environment, [DAILY_CRON])
  }
  exactRuntimeConfig(await readRuntimeConfig(environment), RUNTIME_CONFIG_OFF, 'Restored Staging runtime config')
  const restored = await readSchedules(environment)
  if (restored.length !== 1 || restored[0] !== DAILY_CRON) {
    throw new Error('Staging Worker schedule did not return to the daily contract.')
  }
}

async function preflight(environment) {
  validateEnvironment(environment, { needsCloudflare: true, needsSupabase: true })
  await verifyCloudflareTokenTtl({
    ...environment,
    CLOUDFLARE_EPHEMERAL_TOKEN: environment.CLOUDFLARE_STORAGE_BACKUP_ACCEPTANCE_TOKEN,
  })
  const schedules = await readSchedules(environment)
  if (schedules.length !== 1 || schedules[0] !== DAILY_CRON) {
    throw new Error('Staging Worker does not have the exact daily schedule before acceptance.')
  }
  exactRuntimeConfig(await readRuntimeConfig(environment), RUNTIME_CONFIG_OFF, 'Preflight Staging runtime config')
  await verifyPrivateR2(environment)
  const supabase = createSupabase(environment)
  await readGate0Owner(supabase)
  await assertFixtureSourceEmpty(supabase, environment)
  console.log('Staging storage backup acceptance preflight passed with all safety switches OFF.')
}

async function runAcceptance(environment) {
  validateEnvironment(environment, { needsCloudflare: true, needsSupabase: true })
  const supabase = createSupabase(environment)
  await assertPreparedFixture(supabase, environment)
  await verifyCloudflareTokenTtl({
    ...environment,
    CLOUDFLARE_EPHEMERAL_TOKEN: environment.CLOUDFLARE_STORAGE_BACKUP_ACCEPTANCE_TOKEN,
  })
  exactRuntimeConfig(await readRuntimeConfig(environment), RUNTIME_CONFIG_OFF, 'Pre-run Staging runtime config')
  const schedules = await readSchedules(environment)
  if (schedules.length !== 1 || schedules[0] !== DAILY_CRON) {
    throw new Error('Staging Worker schedule changed before acceptance.')
  }
  const previousLatest = await readR2Json(environment, 'control/latest.json', { allowMissing: true })
  const previousSnapshotId = isRecord(previousLatest) && typeof previousLatest.snapshotId === 'string'
    ? previousLatest.snapshotId
    : null
  const startedAt = Date.now()
  let acceptedSnapshotId = null
  try {
    await writeRuntimeConfig(environment, RUNTIME_CONFIG_ON, ENABLE_TTL_SECONDS)
    await new Promise((resolve) => setTimeout(resolve, KV_PROPAGATION_WAIT_MS))
    exactRuntimeConfig(await readRuntimeConfig(environment), RUNTIME_CONFIG_ON, 'Enabled Staging runtime config')
    await writeSchedules(environment, [ACCEPTANCE_CRON])
    const deadline = startedAt + ACCEPTANCE_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      const latest = await readR2Json(environment, 'control/latest.json', { allowMissing: true })
      acceptedSnapshotId = latest
        ? await verifyCompletedSnapshot(environment, latest, startedAt, previousSnapshotId)
        : null
      if (acceptedSnapshotId) break
    }
    if (!acceptedSnapshotId) throw new Error('Staging storage backup did not produce a complete snapshot before the deadline.')
  } finally {
    await restoreCloudflareSafety(environment)
  }
  console.log(`Staging storage backup acceptance passed (${FIXTURE.length} objects; ${EXPECTED_TOTAL_BYTES} bytes).`)
}

async function cleanup(environment) {
  const failures = []
  try {
    await restoreCloudflareSafety(environment)
  } catch (error) {
    failures.push(error instanceof Error ? error.message : 'Cloudflare safety restoration failed.')
  }
  try {
    await cleanupFixture(environment)
  } catch (error) {
    failures.push(error instanceof Error ? error.message : 'Staging fixture cleanup failed.')
  }
  if (failures.length > 0) throw new Error(`Staging acceptance cleanup failed: ${failures.join(' ')}`)
  console.log('Staging storage backup acceptance cleanup passed.')
}

async function main() {
  const command = process.argv[2]
  if (command === 'preflight') return preflight(process.env)
  if (command === 'prepare') return prepareFixture(process.env)
  if (command === 'run') return runAcceptance(process.env)
  if (command === 'cleanup') return cleanup(process.env)
  throw new Error('Usage: staging-storage-backup-acceptance.mjs preflight|prepare|run|cleanup')
}

export const STAGING_STORAGE_BACKUP_ACCEPTANCE_CONTRACT = Object.freeze({
  projectRef: STAGING_PROJECT_REF,
  accountId: CLOUDFLARE_ACCOUNT_ID,
  kvNamespaceId: RUNTIME_CONFIG_KV_ID,
  workerName: WORKER_NAME,
  r2Bucket: R2_BUCKET,
  dailyCron: DAILY_CRON,
  confirmation: CONFIRMATION,
  objectCount: FIXTURE.length,
  totalBytes: EXPECTED_TOTAL_BYTES,
  fixturePaths: Object.freeze(FIXTURE.map((item) => item.path)),
})

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Staging storage backup acceptance failed.')
    process.exitCode = 1
  })
}
