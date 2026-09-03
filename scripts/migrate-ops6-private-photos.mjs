import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises'
import path, { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadProtectedEphemeralReleaseKey } from './ephemeral-release-key-store.mjs'
import {
  publicKeyFingerprint,
  signAttestation,
  verifySignedAttestation,
} from './ephemeral-release-attestation.mjs'
import {
  OPS6_CABINET_BUCKET,
  OPS6_MAX_CABINETS,
  OPS6_MAX_IMAGE_BYTES,
  OPS6_MAX_OBJECTS,
  buildPhotoMigrationInventory,
  derivePrivatePath,
  inspectWebp,
  nextManifestJournalLine,
  verifyManifestJournal,
} from './ops6-private-photo-migration-core.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_REF = /^[a-z]{20}$/
const SHA = /^[0-9a-f]{40}$/
const MAX_API_RESPONSE_BYTES = 4 * 1024 * 1024
const EVIDENCE_FILES = new Set(['header.json', 'journal.jsonl', 'receipt.json'])

function fail(message) {
  throw new Error(`[ops6-photo-migration] ${message}`)
}

function isInside(root, candidate) {
  const child = relative(root, candidate)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function requireSafeText(value, name, minimum = 1, maximum = 4096) {
  if (typeof value !== 'string' || value !== value.trim() || value.length < minimum || value.length > maximum
    || /[\x00-\x1f\x7f]/.test(value)) fail(`${name} is missing or malformed`)
  return value
}

export function parseOps6SupabaseTarget(urlValue, expectedProjectRef) {
  if (typeof expectedProjectRef !== 'string' || !PROJECT_REF.test(expectedProjectRef)) fail('expected project ref is invalid')
  let url
  try { url = new URL(urlValue) } catch { fail('Supabase URL is malformed') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/'
    || url.search || url.hash || url.hostname !== `${expectedProjectRef}.supabase.co`) {
    fail('Supabase URL does not match the exact approved project ref')
  }
  return Object.freeze({ origin: url.origin, projectRef: expectedProjectRef })
}

function decodeJwtPart(value) {
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) } catch { fail('Supabase backend credential is malformed') }
}

export function verifyOps6BackendCredential(value, projectRef) {
  const credential = requireSafeText(value, 'SUPABASE_SERVICE_ROLE_KEY', 20)
  if (/^sb_secret_[A-Za-z0-9_-]{20,512}$/.test(credential)) return credential
  const parts = credential.split('.')
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) fail('Supabase backend credential is unsupported')
  const header = decodeJwtPart(parts[0])
  const payload = decodeJwtPart(parts[1])
  if (header?.alg !== 'HS256' || header?.typ !== 'JWT' || payload?.iss !== 'supabase'
    || payload?.role !== 'service_role' || payload?.ref !== projectRef) {
    fail('Supabase backend credential is not the exact project service credential')
  }
  return credential
}

async function readBoundedResponse(response, maximumBytes) {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maximumBytes) fail('Supabase response exceeded its byte limit')
  if (!response.body) return response
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximumBytes) {
        await reader.cancel()
        fail('Supabase response exceeded its byte limit')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return new Response(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export function createBoundedSupabaseFetch(origin, fetchImpl = fetch) {
  let requests = 0
  return async (input, init = {}) => {
    let target
    try { target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url) } catch { fail('Supabase request URL is invalid') }
    if (target.origin !== origin || ++requests > 20_000) fail('Supabase request escaped its approved boundary')
    const response = await fetchImpl(input, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    })
    if (response.status >= 300 && response.status < 400) fail('Supabase redirect was refused')
    return readBoundedResponse(response, MAX_API_RESPONSE_BYTES)
  }
}

function requireResult(result, label) {
  if (result?.error) fail(`${label} failed`)
  return result?.data
}

export async function createOps6SupabaseAdapter({ origin, credential, createClientImpl = createClient }) {
  const client = createClientImpl(origin, credential, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createBoundedSupabaseFetch(origin) },
  })
  return Object.freeze({
    async listCabinets() {
      const rows = []
      for (let offset = 0; ; offset += 1000) {
        const page = requireResult(await client.from('cabinets')
          .select('id,user_id,lab_id,image_url,image_path').order('id').range(offset, offset + 999), 'cabinet listing')
        if (!Array.isArray(page) || page.length > 1000) fail('cabinet listing shape is invalid')
        rows.push(...page)
        if (rows.length > OPS6_MAX_CABINETS) fail('cabinet listing exceeded its boundary')
        if (page.length < 1000) return rows
      }
    },
    async listStorageObjects() {
      const queue = ['']
      const visited = new Set()
      const objects = []
      let pages = 0
      while (queue.length) {
        const prefix = queue.shift()
        if (visited.has(prefix)) fail('Storage listing repeated a prefix')
        visited.add(prefix)
        for (let offset = 0; ; offset += 100) {
          if (++pages > 200) fail('Storage listing page boundary exceeded')
          const items = requireResult(await client.storage.from(OPS6_CABINET_BUCKET).list(prefix, {
            limit: 100, offset, sortBy: { column: 'name', order: 'asc' },
          }), 'Storage listing')
          if (!Array.isArray(items) || items.length > 100) fail('Storage listing shape is invalid')
          for (const item of items) {
            if (!item || typeof item.name !== 'string' || /[\\/\x00-\x1f\x7f]/.test(item.name)) fail('Storage listing item is invalid')
            const objectPath = prefix ? `${prefix}/${item.name}` : item.name
            if (item.id === null) queue.push(objectPath)
            else objects.push(objectPath)
            if (objects.length + queue.length > OPS6_MAX_OBJECTS) fail('Storage object boundary exceeded')
          }
          if (items.length < 100) break
        }
      }
      return objects.sort((a,b) => a.localeCompare(b, 'en'))
    },
    async download(objectPath) {
      const result = await client.storage.from(OPS6_CABINET_BUCKET).download(objectPath)
      if (result.error || !result.data || typeof result.data.arrayBuffer !== 'function'
        || (Number.isFinite(result.data.size) && result.data.size > OPS6_MAX_IMAGE_BYTES)) {
        fail('cabinet object download failed')
      }
      const body = Buffer.from(await result.data.arrayBuffer())
      inspectWebp(body)
      return body
    },
    async tryDownload(objectPath) {
      const result = await client.storage.from(OPS6_CABINET_BUCKET).download(objectPath)
      if (result.error || !result.data || typeof result.data.arrayBuffer !== 'function') return null
      const body = Buffer.from(await result.data.arrayBuffer())
      inspectWebp(body)
      return body
    },
    async upload(objectPath, body) {
      const result = await client.storage.from(OPS6_CABINET_BUCKET).upload(objectPath, body, {
        contentType: 'image/webp', cacheControl: '3600', upsert: false,
      })
      return !result.error
    },
    async migrate({ cabinetId, sourcePath, privatePath, sha256, sizeBytes }) {
      const result = await client.rpc('migrate_cabinet_image_path_v1', {
        p_cabinet_id: cabinetId,
        p_legacy_path: sourcePath,
        p_private_path: privatePath,
        p_sha256: sha256,
        p_size_bytes: sizeBytes,
      })
      return !result.error && result.data?.success === true
    },
    async readCabinet(cabinetId) {
      const result = await client.from('cabinets').select('id,user_id,lab_id,image_url,image_path').eq('id', cabinetId).maybeSingle()
      if (result.error || !result.data) fail('cabinet verification read failed')
      return result.data
    },
  })
}

function equalBody(left, right) {
  return left.length === right.length && createHash('sha256').update(left).digest('hex') === createHash('sha256').update(right).digest('hex')
}

export async function migrateOps6PhotoSet({ inventory, adapter, priorEntries = [], appendEntry, now = () => new Date() }) {
  if (!inventory || !adapter || typeof appendEntry !== 'function' || inventory.missing.length) fail('migration input is incomplete')
  const priorByCabinet = new Map(priorEntries.map((entry) => [entry.cabinetId, entry]))
  if (priorByCabinet.size !== priorEntries.length) fail('prior migration evidence repeats a cabinet')
  const candidates = [...inventory.pending, ...inventory.migrated.filter((row) => row.legacyPath)]
    .sort((a,b) => a.id.localeCompare(b.id, 'en'))
  const completed = []
  for (const row of candidates) {
    const source = await adapter.download(row.legacyPath)
    const evidence = inspectWebp(source)
    const expectedPrivatePath = derivePrivatePath({ id: row.id, lab_id: row.labId, user_id: row.userId }, row.legacyPath, evidence.sha256)
    if (row.privatePath && row.privatePath !== expectedPrivatePath) fail('existing private path does not match deterministic verified evidence')
    const previous = priorByCabinet.get(row.id)
    if (previous && (previous.sourcePath !== row.legacyPath || previous.privatePath !== expectedPrivatePath
      || previous.sha256 !== evidence.sha256 || previous.sizeBytes !== evidence.sizeBytes)) {
      fail('prior migration evidence no longer matches provider state')
    }
    let privateBody = await adapter.tryDownload(expectedPrivatePath)
    if (!privateBody) {
      const uploaded = await adapter.upload(expectedPrivatePath, source)
      privateBody = await adapter.tryDownload(expectedPrivatePath)
      if (!uploaded && !privateBody) fail('private object upload failed')
    }
    if (!privateBody || !equalBody(source, privateBody)) fail('private object failed its download SHA-256 verification')
    const current = await adapter.readCabinet(row.id)
    if (!current.image_path) {
      const acknowledged = await adapter.migrate({
        cabinetId: row.id,
        sourcePath: row.legacyPath,
        privatePath: expectedPrivatePath,
        sha256: evidence.sha256,
        sizeBytes: evidence.sizeBytes,
      })
      const after = await adapter.readCabinet(row.id)
      if ((!acknowledged && after.image_path !== expectedPrivatePath) || after.image_path !== expectedPrivatePath) {
        fail('database did not bind the verified private object')
      }
    } else if (current.image_path !== expectedPrivatePath) {
      fail('cabinet was migrated to a different private object')
    }
    const entry = Object.freeze({
      cabinetId: row.id,
      sourcePath: row.legacyPath,
      privatePath: expectedPrivatePath,
      sha256: evidence.sha256,
      sizeBytes: evidence.sizeBytes,
      verifiedAt: now().toISOString(),
    })
    if (!previous) await appendEntry(entry)
    completed.push(entry)
  }
  return Object.freeze({ candidates: candidates.length, completed: Object.freeze(completed) })
}

async function prepareEvidenceDirectory(candidate, header) {
  if (!isAbsolute(candidate)) fail('OPS6_EVIDENCE_DIRECTORY must be absolute')
  const repositoryRoot = await realpath(repository)
  const requested = resolve(candidate)
  if (requested === repositoryRoot || isInside(repositoryRoot, requested)) fail('evidence directory must remain outside the repository')
  const parent = await realpath(dirname(requested))
  if (resolve(parent, path.basename(requested)) !== requested) fail('evidence directory path is not canonical')
  try { await mkdir(requested, { mode: 0o700 }) } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  const details = await lstat(requested)
  if (!details.isDirectory() || details.isSymbolicLink() || await realpath(requested) !== requested) fail('evidence directory is not a real local directory')
  await chmod(requested, 0o700)
  const names = await readdir(requested)
  if (names.some((name) => !EVIDENCE_FILES.has(name))) fail('evidence directory contains an unreviewed file')
  const headerPath = path.join(requested, 'header.json')
  try { await writeFile(headerPath, `${JSON.stringify(header)}\n`, { flag: 'wx', mode: 0o600 }) } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const stored = JSON.parse(await readFile(headerPath, 'utf8'))
    if (JSON.stringify(stored) !== JSON.stringify(header)) fail('existing evidence header does not match this exact run')
  }
  return requested
}

async function readJournal(directory) {
  try {
    const raw = await readFile(path.join(directory, 'journal.jsonl'), 'utf8')
    if (Buffer.byteLength(raw, 'utf8') > 20 * 1024 * 1024 || !raw.endsWith('\n')) fail('migration journal is malformed')
    const lines = raw.split('\n').filter(Boolean).map((line) => {
      if (Buffer.byteLength(line, 'utf8') > 4096) fail('migration journal line is oversized')
      try { return JSON.parse(line) } catch { fail('migration journal line is invalid JSON') }
    })
    return verifyManifestJournal(lines)
  } catch (error) {
    if (error?.code === 'ENOENT') return { entries: [], finalHash: null, count: 0 }
    throw error
  }
}

async function appendJournal(directory, line) {
  const target = path.join(directory, 'journal.jsonl')
  const handle = await open(target, 'a', 0o600)
  try {
    await handle.write(`${JSON.stringify(line)}\n`, null, 'utf8')
    await handle.sync()
  } finally { await handle.close() }
}

async function writeSyncedExclusive(target, value) {
  const handle = await open(target, 'wx', 0o600)
  try {
    await handle.writeFile(value, 'utf8')
    await handle.sync()
  } finally { await handle.close() }
}

async function readExistingReceipt(directory, expected, journal) {
  let raw
  try { raw = await readFile(path.join(directory, 'receipt.json'), 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  const publicKey = await readFile(path.join(repository, 'config/ephemeral-release-public-key.pem'), 'utf8')
  const signed = verifySignedAttestation(raw, publicKey, 'ops6_private_photo_copy_receipt')
  const payload = signed.payload
  if (payload.environment !== expected.environment || payload.project_ref !== expected.projectRef
    || payload.commit_sha !== expected.commitSha || payload.journal_final_hash !== journal.finalHash
    || payload.migrated_count !== journal.count || payload.deletion_count !== 0) {
    fail('existing signed migration receipt does not match current evidence')
  }
  return Object.freeze({ receipt: raw, receiptSha256: createHash('sha256').update(raw, 'utf8').digest('hex') })
}

function git(args) {
  try { return execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim() }
  catch { fail('Git preparation boundary could not be verified') }
}

async function run() {
  const mode = process.argv[2]
  if (!['plan','apply'].includes(mode) || process.argv.length !== 3) fail('usage: migrate-ops6-private-photos.mjs plan|apply')
  const environment = requireSafeText(process.env.OPS6_ENVIRONMENT, 'OPS6_ENVIRONMENT')
  if (!['staging','production'].includes(environment)) fail('OPS6_ENVIRONMENT must be staging or production')
  const projectRef = requireSafeText(process.env.OPS6_EXPECTED_PROJECT_REF, 'OPS6_EXPECTED_PROJECT_REF')
  const target = parseOps6SupabaseTarget(process.env.SUPABASE_URL, projectRef)
  const credential = verifyOps6BackendCredential(process.env.SUPABASE_SERVICE_ROLE_KEY, projectRef)
  const adapter = await createOps6SupabaseAdapter({ origin: target.origin, credential })
  const [rows, objects] = await Promise.all([adapter.listCabinets(), adapter.listStorageObjects()])
  const inventory = buildPhotoMigrationInventory(rows, objects, target.origin)
  const safePlan = {
    result: 'ops6-private-photo-plan', environment, projectRef,
    cabinetRows: inventory.cabinetRows, storageObjects: inventory.storageObjects,
    pending: inventory.pending.length, migrated: inventory.migrated.length,
    missing: inventory.missing.length, quarantine: inventory.quarantine.length,
    scopesAtWarning: inventory.scopes.filter((scope) => scope.warning).length,
    complete: inventory.complete,
    writes: false,
  }
  if (mode === 'plan') {
    console.log(JSON.stringify(safePlan))
    return
  }
  if (inventory.missing.length) fail('referenced source or private Storage bodies are missing')
  const expectedSha = requireSafeText(process.env.OPS6_EXPECTED_SHA, 'OPS6_EXPECTED_SHA')
  if (!SHA.test(expectedSha) || git(['rev-parse','HEAD']) !== expectedSha || git(['status','--porcelain'])) fail('apply requires the exact clean reviewed commit')
  const confirmation = `APPLY OPS6 PRIVATE PHOTO COPY ${environment} ${projectRef} ${expectedSha}`
  if (process.env.OPS6_PHOTO_MIGRATION_CONFIRM !== confirmation) fail('exact action-time confirmation is missing')
  const header = {
    version: 1, kind: 'ops6_private_photo_copy', environment, projectRef, commitSha: expectedSha,
    initialPending: inventory.pending.length,
    initialMigratedWithLegacy: inventory.migrated.filter((row) => row.legacyPath).length,
    initialQuarantine: inventory.quarantine.length,
  }
  const directory = await prepareEvidenceDirectory(requireSafeText(process.env.OPS6_EVIDENCE_DIRECTORY, 'OPS6_EVIDENCE_DIRECTORY'), header)
  const journal = await readJournal(directory)
  const existingReceipt = await readExistingReceipt(directory, {
    environment, projectRef, commitSha: expectedSha,
  }, journal)
  if (existingReceipt) {
    if (inventory.pending.length || inventory.missing.length) fail('provider state regressed after the signed migration receipt')
    console.log(JSON.stringify({
      result: 'ops6-private-photo-copy-complete', environment, projectRef,
      migrated: journal.count, quarantine: inventory.quarantine.length,
      receiptSha256: existingReceipt.receiptSha256,
      switchApplied: false, deletions: 0, resumed: true,
    }))
    return
  }
  let previousHash = journal.finalHash
  const result = await migrateOps6PhotoSet({
    inventory, adapter, priorEntries: journal.entries,
    appendEntry: async (entry) => {
      const line = nextManifestJournalLine(previousHash, entry)
      await appendJournal(directory, line)
      previousHash = line.entryHash
    },
  })
  const [finalRows, finalObjects] = await Promise.all([adapter.listCabinets(), adapter.listStorageObjects()])
  const finalInventory = buildPhotoMigrationInventory(finalRows, finalObjects, target.origin)
  if (finalInventory.pending.length || finalInventory.missing.length) fail('final provider state is not ready for Switch')
  const finalJournal = await readJournal(directory)
  if (finalJournal.count !== result.candidates || finalJournal.finalHash !== previousHash) fail('final migration journal is incomplete')
  const privateKey = await loadProtectedEphemeralReleaseKey()
  const supervisorKeyId = publicKeyFingerprint(privateKey)
  const receipt = signAttestation({
    kind: 'ops6_private_photo_copy_receipt', supervisor_key_id: supervisorKeyId,
    environment, project_ref: projectRef, commit_sha: expectedSha,
    journal_final_hash: finalJournal.finalHash, migrated_count: finalJournal.count,
    quarantine_count: finalInventory.quarantine.length,
    completed_at: new Date().toISOString(), deletion_count: 0,
  }, privateKey)
  await writeSyncedExclusive(path.join(directory, 'receipt.json'), receipt)
  console.log(JSON.stringify({
    result: 'ops6-private-photo-copy-complete', environment, projectRef,
    migrated: finalJournal.count, quarantine: finalInventory.quarantine.length,
    receiptSha256: createHash('sha256').update(receipt, 'utf8').digest('hex'),
    switchApplied: false, deletions: 0,
  }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Ops6 photo migration failed.')
    process.exitCode = 1
  })
}
