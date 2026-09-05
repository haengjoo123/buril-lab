import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const PROJECT_REF = 'zafxzidbtbryiksemlwc'
const SUPABASE_ORIGIN = `https://${PROJECT_REF}.supabase.co`
const APP_ORIGIN = 'https://burillab.com'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_RESPONSE_BYTES = 256 * 1024

class SmokeFailure extends Error {
  constructor(code) {
    super(code)
    this.name = 'SmokeFailure'
  }
}

function check(condition, code) {
  if (!condition) throw new SmokeFailure(code)
}

function randomToken(bytes = 18) {
  return randomBytes(bytes).toString('hex')
}

function loadApiKeys() {
  const cli = path.resolve('node_modules/supabase/dist/supabase.js')
  const stdout = execFileSync(process.execPath, [
    cli, 'projects', 'api-keys',
    '--project-ref', PROJECT_REF, '--reveal', '--output', 'json',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024,
  })
  const rows = JSON.parse(stdout)
  check(Array.isArray(rows), 'API_KEYS_SHAPE')
  const value = (name) => rows.find((row) => row?.name === name)?.api_key
  const anon = value('anon')
  const service = value('service_role')
  check(typeof anon === 'string' && anon.length >= 100, 'ANON_KEY_MISSING')
  check(typeof service === 'string' && service.length >= 100, 'SERVICE_KEY_MISSING')
  return { anon, service }
}

async function limitedText(response) {
  const declared = Number(response.headers.get('content-length') || 0)
  check(Number.isFinite(declared) && declared <= MAX_RESPONSE_BYTES, 'RESPONSE_TOO_LARGE')
  check(response.body, 'RESPONSE_BODY_MISSING')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      check(total <= MAX_RESPONSE_BYTES, 'RESPONSE_TOO_LARGE')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

async function request(url, { method = 'GET', headers = {}, body, expected } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })
  const text = await limitedText(response)
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { throw new SmokeFailure(`NON_JSON_HTTP_${response.status}`) }
  }
  if (expected !== undefined && response.status !== expected) {
    const safeCode = typeof data?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(data.code)
      ? data.code : 'NO_SAFE_CODE'
    throw new SmokeFailure(`HTTP_${response.status}_${safeCode}_EXPECTED_${expected}`)
  }
  return { status: response.status, data }
}

function supabaseHeaders(key, bearer = key) {
  return {
    apikey: key,
    Authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json',
  }
}

async function createUser(keys, email, password) {
  const result = await request(`${SUPABASE_ORIGIN}/auth/v1/admin/users`, {
    method: 'POST',
    headers: supabaseHeaders(keys.service),
    body: { email, password, email_confirm: true },
    expected: 200,
  })
  check(UUID.test(result.data?.id), 'CREATE_USER_SHAPE')
  return result.data.id
}

async function signIn(keys, email, password) {
  const result = await request(`${SUPABASE_ORIGIN}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: keys.anon, 'Content-Type': 'application/json' },
    body: { email, password },
    expected: 200,
  })
  check(typeof result.data?.access_token === 'string' && result.data.access_token.split('.').length === 3,
    'SIGN_IN_SHAPE')
  return result.data.access_token
}

async function createLab(keys, jwt, name, password) {
  const result = await request(`${SUPABASE_ORIGIN}/rest/v1/rpc/create_lab_secure`, {
    method: 'POST',
    headers: supabaseHeaders(keys.anon, jwt),
    body: {
      p_name: name,
      p_password: password,
      p_nickname: 'ops5-owner',
      p_institution_type: null,
      p_research_field: null,
      p_institution_name: null,
    },
    expected: 200,
  })
  check(result.data?.success === true && UUID.test(result.data?.lab_id), 'CREATE_LAB_SHAPE')
  return result.data.lab_id
}

async function deleteLab(keys, labId) {
  const result = await request(`${SUPABASE_ORIGIN}/rest/v1/labs?id=eq.${encodeURIComponent(labId)}&select=id`, {
    method: 'DELETE',
    headers: { ...supabaseHeaders(keys.service), Prefer: 'return=representation' },
    expected: 200,
  })
  check(Array.isArray(result.data) && result.data.length === 1 && result.data[0]?.id === labId,
    'LAB_CLEANUP_AMBIGUOUS')
}

async function deleteUser(keys, userId) {
  const result = await request(`${SUPABASE_ORIGIN}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: supabaseHeaders(keys.service),
  })
  check(result.status === 200 || result.status === 204, `USER_CLEANUP_HTTP_${result.status}`)
}

async function countRows(keys, table, column, value) {
  const result = await request(`${SUPABASE_ORIGIN}/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}&select=id`, {
    headers: { ...supabaseHeaders(keys.service), Prefer: 'count=exact' },
    expected: 200,
  })
  check(Array.isArray(result.data), `${table.toUpperCase()}_COUNT_SHAPE`)
  return result.data.length
}

async function verifyUserGone(keys, userId) {
  const result = await request(`${SUPABASE_ORIGIN}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: supabaseHeaders(keys.service),
  })
  check(result.status === 404, `USER_REMAINS_HTTP_${result.status}`)
}

const keys = loadApiKeys()
const tag = randomToken(8)
const labPassword = `Ops5-${randomToken(16)}!`
const actors = ['owner', 'server', 'legacy'].map((role) => ({
  role,
  email: `ops5-${role}-${tag}@example.invalid`,
  password: `Ops5-${randomToken(18)}!`,
  id: null,
  jwt: null,
}))
let labId = null
let completed = false
const evidence = {
  schemaVersion: 1,
  result: 'failed',
  serverJoinStatus: null,
  legacyJoinStatus: null,
  membershipCountBeforeCleanup: null,
  cleanup: 'not-started',
  remainingLabs: null,
  remainingMemberships: null,
  remainingUsers: null,
}

try {
  for (const actor of actors) {
    actor.id = await createUser(keys, actor.email, actor.password)
    actor.jwt = await signIn(keys, actor.email, actor.password)
  }
  labId = await createLab(keys, actors[0].jwt, `OPS5 compatibility ${tag}`, labPassword)

  const serverJoin = await request(`${APP_ORIGIN}/api/labs/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${actors[1].jwt}`, 'Content-Type': 'application/json' },
    body: { labId, password: labPassword, nickname: 'ops5-server' },
    expected: 200,
  })
  check(serverJoin.data?.success === true && serverJoin.data?.labId === labId
    && Object.keys(serverJoin.data).sort().join('|') === 'labId|success', 'SERVER_JOIN_SHAPE')
  evidence.serverJoinStatus = serverJoin.status

  const legacyJoin = await request(`${SUPABASE_ORIGIN}/rest/v1/rpc/join_lab`, {
    method: 'POST',
    headers: supabaseHeaders(keys.anon, actors[2].jwt),
    body: { p_lab_id: labId, p_password: labPassword, p_nickname: 'ops5-legacy' },
    expected: 200,
  })
  check(legacyJoin.data?.success === true, 'LEGACY_JOIN_SHAPE')
  evidence.legacyJoinStatus = legacyJoin.status

  evidence.membershipCountBeforeCleanup = await countRows(keys, 'lab_members', 'lab_id', labId)
  check(evidence.membershipCountBeforeCleanup === 3, 'MEMBERSHIP_COUNT_BEFORE_CLEANUP')
  completed = true
} catch (error) {
  evidence.failureCode = error instanceof SmokeFailure ? error.message : 'UNEXPECTED_FAILURE'
} finally {
  evidence.cleanup = 'started'
  const cleanupFailures = []
  if (labId) {
    try { await deleteLab(keys, labId) } catch (error) {
      cleanupFailures.push(error instanceof SmokeFailure ? error.message : 'LAB_CLEANUP_UNEXPECTED')
    }
  }
  for (const actor of [...actors].reverse()) {
    if (!actor.id) continue
    try { await deleteUser(keys, actor.id) } catch (error) {
      cleanupFailures.push(error instanceof SmokeFailure ? error.message : 'USER_CLEANUP_UNEXPECTED')
    }
  }
  if (labId) {
    try {
      evidence.remainingLabs = await countRows(keys, 'labs', 'id', labId)
      evidence.remainingMemberships = await countRows(keys, 'lab_members', 'lab_id', labId)
    } catch (error) {
      cleanupFailures.push(error instanceof SmokeFailure ? error.message : 'ROW_RECHECK_UNEXPECTED')
    }
  }
  let remainingUsers = 0
  for (const actor of actors) {
    if (!actor.id) continue
    try { await verifyUserGone(keys, actor.id) } catch (error) {
      remainingUsers += 1
      cleanupFailures.push(error instanceof SmokeFailure ? error.message : 'USER_RECHECK_UNEXPECTED')
    }
  }
  evidence.remainingUsers = remainingUsers
  evidence.cleanup = cleanupFailures.length === 0
    && (evidence.remainingLabs ?? 0) === 0
    && (evidence.remainingMemberships ?? 0) === 0
    && remainingUsers === 0 ? 'complete' : 'failed'
  if (cleanupFailures.length) evidence.cleanupFailureCodes = cleanupFailures
}

if (completed && evidence.cleanup === 'complete') evidence.result = 'success'
console.log(JSON.stringify(evidence))
if (evidence.result !== 'success') process.exitCode = 1
