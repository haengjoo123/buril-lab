import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, writeFile, appendFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { chromium, expect } from '@playwright/test'
import { fulfillStagingAccessRoute } from './gate0-access-route.mjs'
import { verifyStagingAccessProtection } from './verify-staging-access.mjs'
import { verifyReleaseManifest } from './verify-release-manifest.mjs'
import {
  GATE0_STAGING_ORIGIN, GATE0_STAGING_CONFIRMATION, GATE0_LAB_NAME,
  GATE0_RESERVED_LAB_ID, GATE0_RESERVED_INVENTORY_ID, GATE0_RESERVED_POLICY_ID,
  selectExistingFixtureUser, verifyExistingFixtureOwnership,
} from './gate0-seed-safety.mjs'
import {
  SMOKE_ORIGIN, UUID, SMOKE_API_PATHS, VOICE_LOCATION_INPUT, SmokeError, check, hash,
  safeFailure, resolveSmokeTarget, smokeApiUrl, requestBudget, verifyApiHeaders,
  runSmokeChecks,
  verifyCabinet, verifyPhotoPath, photoPathFromUrl, newOwnedRowIds,
  verifySmokeCacheRow, validateSmokeJournal,
} from './ops3-live-smoke-safety.mjs'

const runFile = promisify(execFile)
const env = process.env
const result = { schemaVersion: 1, phases: [], cleanup: 'not-started' }
// Match the reviewed Gate0 Staging assertion deadline, not standalone expect's 5s default.
const browserExpect = expect.configure({ timeout: 15_000 })
let phase = 'validate'
function mark(value) { phase = value; console.log(JSON.stringify({ event: 'ops3_smoke_phase', phase })) }
function checkedData(value, code) { check(!value.error && value.data !== null, code); return value.data }
function journalPath() {
  check(env.GITHUB_ACTIONS === 'true' && path.isAbsolute(env.RUNNER_TEMP || ''), 'NOT_EPHEMERAL_GITHUB_RUNNER')
  return path.join(env.RUNNER_TEMP, `ops3-live-smoke-${env.GITHUB_RUN_ID}.json`)
}
async function save(state) { await writeFile(journalPath(), JSON.stringify(state), { mode: 0o600 }) }
function requireSecrets() {
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'GATE0_E2E_EMAIL', 'GATE0_E2E_PASSWORD', 'STAGING_ACCESS_CLIENT_ID', 'STAGING_ACCESS_CLIENT_SECRET']) {
    check(typeof env[key] === 'string' && env[key].trim().length > 0, 'MISSING_STAGING_SECRET')
  }
}
function accessHeaders() {
  return { 'CF-Access-Client-Id': env.STAGING_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': env.STAGING_ACCESS_CLIENT_SECRET }
}
function clients() {
  const options = { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    check(url.origin === GATE0_STAGING_ORIGIN, 'SUPABASE_CREDENTIAL_TARGET')
    return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) })
  } } }
  return { admin: createClient(GATE0_STAGING_ORIGIN, env.SUPABASE_SERVICE_ROLE_KEY, options),
    user: createClient(GATE0_STAGING_ORIGIN, env.SUPABASE_ANON_KEY, options) }
}
async function limitedBytes(response, max = 256 * 1024) {
  check(Number(response.headers.get('content-length') || 0) <= max && response.body, 'RESPONSE_BODY_LIMIT')
  const reader = response.body.getReader()
  const parts = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      check(total <= max, 'RESPONSE_BODY_LIMIT')
      parts.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return Buffer.concat(parts, total)
}
async function jsonBody(response) {
  check(response.headers.get('content-type')?.includes('application/json'), 'EXPECTED_JSON')
  try { return JSON.parse((await limitedBytes(response)).toString('utf8')) }
  catch (error) { throw error instanceof SmokeError ? error : new SmokeError('MALFORMED_RESPONSE_JSON') }
}

async function preflight(target) {
  mark('access-and-release')
  for (const origin of [SMOKE_ORIGIN, target.immutableOrigin]) {
    await verifyStagingAccessProtection(`${origin}/release.json`)
    const response = await fetch(`${origin}/release.json?ops3=${target.sha}`, {
      headers: accessHeaders(), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    })
    check(response.status === 200, 'RELEASE_IDENTITY_HTTP')
    verifyReleaseManifest(await jsonBody(response), { commitSha: target.sha, environment: 'staging' })
  }
  result.phases.push('access-and-release')
}

async function owner(admin) {
  const users = checkedData(await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'FIXTURE_USERS_READ')
  const user = selectExistingFixtureUser(users.users, env.GATE0_E2E_EMAIL)
  check(user && UUID.test(user.id), 'FIXTURE_OWNER_MISSING')
  const lab = checkedData(await admin.from('labs').select('id,name,created_by').eq('id', GATE0_RESERVED_LAB_ID).single(), 'FIXTURE_LAB_READ')
  const inventory = checkedData(await admin.from('inventory').select('id,name,lab_id,user_id').eq('id', GATE0_RESERVED_INVENTORY_ID).single(), 'FIXTURE_INVENTORY_READ')
  const policy = checkedData(await admin.from('waste_policy_versions').select('id,created_by,activated_by').eq('id', GATE0_RESERVED_POLICY_ID).single(), 'FIXTURE_POLICY_READ')
  const membership = checkedData(await admin.from('lab_members').select('lab_id,user_id,role').eq('lab_id', lab.id).eq('user_id', user.id).single(), 'FIXTURE_MEMBERSHIP_READ')
  verifyExistingFixtureOwnership({ user, lab, inventory, policy, membership })
  check(lab.name === GATE0_LAB_NAME, 'FIXTURE_LAB_NAME')
  return user.id
}
async function rows(admin, state, kind) {
  const table = kind === 'aliases' ? 'reagent_aliases' : 'voice_query_feedback'
  let query = admin.from(table).select(kind === 'aliases'
    ? 'id,user_id,lab_id,source_item_type,source_item_id,created_at'
    : 'id,user_id,lab_id,raw_input,created_at', { count: 'exact' }).eq('user_id', state.ownerId).eq('lab_id', GATE0_RESERVED_LAB_ID)
  if (kind === 'aliases') query = query.eq('source_item_type', 'inventory').eq('source_item_id', GATE0_RESERVED_INVENTORY_ID)
  else query = query.eq('raw_input', VOICE_LOCATION_INPUT)
  const response = await query.limit(1001)
  const data = checkedData(response, 'FIXTURE_ROWS_READ')
  check(data.length <= 1000 && response.count === data.length, 'FIXTURE_ROWS_LIMIT')
  return data
}
async function cacheRows(admin, state) {
  const data = checkedData(await admin.from('ai_api_cache').select('id,api_type,cache_key,created_at')
    .like('cache_key', `%${state.marker}%`).limit(5), 'CACHE_READ')
  check(data.length <= 4, 'CACHE_ROWS_LIMIT')
  for (const row of data) verifySmokeCacheRow(row, state)
  return data
}
async function matchingCabinet(admin, state) {
  const data = checkedData(await admin.from('cabinets').select('id,name,user_id,lab_id,created_at,image_url')
    .eq('name', state.cabinetName).eq('lab_id', GATE0_RESERVED_LAB_ID).limit(2), 'CABINET_READ')
  check(data.length <= 1, 'CABINET_AMBIGUOUS')
  if (data.length) verifyCabinet(data[0], state)
  return data[0] || null
}

async function cleanup(admin, user, state, target) {
  validateSmokeJournal(state, target)
  check(await owner(admin) === state.ownerId, 'CLEANUP_OWNER_CHANGED')
  const counts = { photos: 0, cabinets: 0, aliases: 0, feedback: 0, caches: 0 }
  const cabinet = await matchingCabinet(admin, state)
  if (cabinet) {
    state.cabinetId = verifyCabinet(cabinet, state)
    await save(state)
    // Never cascade through inventory or disposal data, even inside the reserved lab.
    for (const table of ['cabinet_items', 'inventory', 'cabinet_disposal_logs', 'safety_compliance_events']) {
      const probe = await admin.from(table).select('id', { count: 'exact', head: true }).eq('cabinet_id', cabinet.id)
      check(!probe.error && probe.count === 0, 'CABINET_HAS_UNEXPECTED_DEPENDENTS')
    }
    const shelves = checkedData(await admin.from('cabinet_shelves').select('id,level,created_at').eq('cabinet_id', cabinet.id).limit(5), 'CABINET_SHELVES_READ')
    check(shelves.length <= 4 && shelves.every((row) => UUID.test(row.id)
      && [0, 1, 2, 3].includes(row.level) && Date.parse(row.created_at) >= Date.parse(state.startedAt)), 'CABINET_SHELVES_CHANGED')
    const activities = checkedData(await admin.from('cabinet_activity_logs').select('id,performed_by,performed_at').eq('cabinet_id', cabinet.id).limit(3), 'CABINET_ACTIVITY_READ')
    check(activities.length <= 2 && activities.every((row) => UUID.test(row.id)
      && row.performed_by === state.ownerId && Date.parse(row.performed_at) >= Date.parse(state.startedAt)), 'CABINET_ACTIVITY_OWNER_CHANGED')
  }
  if (state.cabinetId) {
    const files = checkedData(await admin.storage.from('cabinets').list('', { search: `${state.cabinetId}-`, limit: 2 }), 'PHOTO_LIST')
    check(files.length <= 1, 'PHOTO_COUNT_MISMATCH')
    const currentPath = cabinet?.image_url ? photoPathFromUrl(cabinet.image_url, state.cabinetId) : null
    for (const file of files) {
      const key = verifyPhotoPath(file.name, state.cabinetId)
      check(!currentPath || key === currentPath, 'PHOTO_REFERENCE_CHANGED')
      const photoUrl = `${GATE0_STAGING_ORIGIN}/storage/v1/object/public/cabinets/${key}`
      const refs = checkedData(await admin.from('cabinets').select('id').eq('image_url', photoUrl).limit(2), 'PHOTO_REFERENCE_READ')
      check(refs.every((row) => row.id === state.cabinetId), 'PHOTO_REFERENCED_ELSEWHERE')
      checkedData(await admin.storage.from('cabinets').remove([key]), 'PHOTO_REMOVE')
      counts.photos += 1
    }
    check(checkedData(await admin.storage.from('cabinets').list('', { search: `${state.cabinetId}-`, limit: 2 }), 'PHOTO_RECHECK').length === 0, 'PHOTO_CLEANUP_INCOMPLETE')
  }
  if (cabinet) {
    const deleted = checkedData(await admin.from('cabinets').delete().eq('id', cabinet.id)
      .eq('user_id', state.ownerId).eq('lab_id', GATE0_RESERVED_LAB_ID).eq('name', state.cabinetName).select('id'), 'CABINET_REMOVE')
    check(deleted.length === 1, 'CABINET_REMOVE_AMBIGUOUS')
    counts.cabinets = 1
  }
  check(await matchingCabinet(admin, state) === null, 'CABINET_CLEANUP_INCOMPLETE')
  for (const kind of ['aliases', 'feedback']) {
    const before = state[kind === 'aliases' ? 'aliasIds' : 'feedbackIds']
    const ids = newOwnedRowIds(before, await rows(admin, state, kind), { ownerId: state.ownerId, kind, startedAt: state.startedAt })
    check(ids.length <= 20, 'NEW_ROWS_LIMIT')
    if (ids.length) {
      const table = kind === 'aliases' ? 'reagent_aliases' : 'voice_query_feedback'
      const deleted = checkedData(await admin.from(table).delete().in('id', ids)
        .eq('user_id', state.ownerId).eq('lab_id', GATE0_RESERVED_LAB_ID).select('id'), 'VOICE_ROWS_REMOVE')
      check(deleted.length === ids.length, 'VOICE_ROWS_REMOVE_AMBIGUOUS')
    }
    check(newOwnedRowIds(before, await rows(admin, state, kind), { ownerId: state.ownerId, kind, startedAt: state.startedAt }).length === 0, 'VOICE_CLEANUP_INCOMPLETE')
    counts[kind] = ids.length
  }
  for (const row of await cacheRows(admin, state)) {
    const deleted = checkedData(await admin.from('ai_api_cache').delete().eq('id', row.id)
      .eq('api_type', row.api_type).eq('cache_key', row.cache_key).select('id'), 'CACHE_REMOVE')
    check(deleted.length === 1, 'CACHE_REMOVE_AMBIGUOUS')
    counts.caches += 1
  }
  check((await cacheRows(admin, state)).length === 0, 'CACHE_CLEANUP_INCOMPLETE')
  // Only this reusable, app_metadata-owned synthetic account is signed out.
  // Refresh sessions are revoked; already issued JWTs retain their normal expiry.
  checkedData(await user.auth.signInWithPassword({ email: env.GATE0_E2E_EMAIL, password: env.GATE0_E2E_PASSWORD }), 'CLEANUP_FIXTURE_SIGNIN')
  check(!(await user.auth.signOut({ scope: 'global' })).error, 'CLEANUP_FIXTURE_SIGNOUT')
  await unlink(journalPath())
  return { result: 'complete', removed: counts, remainingRunArtifacts: 0, priorVoiceRowsPreserved: true,
    fixtureRetained: true, auditHistoryRetained: true, refreshSessionsRevoked: true, accessJwtRevocationClaimed: false }
}

async function runApis(jwt, state, labelImage) {
  const budget = requestBudget()
  const request = async (apiPath, { body = '{}', auth = true, method = 'POST', expected = 200, paid = false, origin, multipart = false, audio = false } = {}) => {
    budget.take(paid)
    result.api = budget.counts()
    const headers = { ...accessHeaders(), ...(auth ? { Authorization: `Bearer ${jwt}` } : {}),
      ...(!multipart ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) }
    const response = await fetch(smokeApiUrl(apiPath), { method, headers,
      body: ['GET', 'OPTIONS'].includes(method) ? undefined : body,
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(40_000) })
    check(response.status === expected, `API_HTTP_${expected}_GOT_${response.status}`)
    verifyApiHeaders(response.headers)
    if (origin && expected === 403) check(!response.headers.has('access-control-allow-origin'), 'FORBIDDEN_CORS')
    if (audio) {
      check(response.headers.get('content-type')?.includes('audio/mpeg'), 'TTS_CONTENT_TYPE')
      return limitedBytes(response, 2 * 1024 * 1024)
    }
    const data = await jsonBody(response)
    if (expected >= 400) check(typeof data.error === 'string' && !Object.keys(data).some((key) => ['stack', 'details', 'query', 'sql', 'token'].includes(key)), 'ERROR_ENVELOPE')
    return data
  }
  mark('unauthenticated-and-invalid-requests')
  for (const apiPath of SMOKE_API_PATHS.slice(0, 9)) {
    const data = await request(apiPath, { auth: false, expected: 401 })
    check(data.code === 'AUTH_REQUIRED', 'AUTH_BOUNDARY')
  }
  check((await request('/api/ops3-smoke-not-a-route', { method: 'GET', auth: false, expected: 404 })).code === 'API_NOT_FOUND', 'JSON_404')
  check((await request('/api/ai/classify', { method: 'GET', auth: false, expected: 405 })).code === 'METHOD_NOT_ALLOWED', 'JSON_405')
  await request('/api/voice/query', { origin: 'https://untrusted.invalid', expected: 403 })
  await request('/api/voice/query', { body: JSON.stringify({ text: 'location', context: { labId: 'not-a-uuid' } }), expected: 400 })
  check((await request('/api/voice/query', { body: '{', expected: 400 })).code === 'INVALID_REQUEST_BODY', 'MALFORMED_JSON')
  check((await request('/api/voice/speak', { body: JSON.stringify({ text: 'x'.repeat(64 * 1024) }), expected: 413 })).code === 'REQUEST_TOO_LARGE', 'OVERSIZE_JSON')
  result.phases.push('unauthenticated-and-invalid-requests')
  for (const [prefix, variant] of [['ai', 'new'], ['gemini', 'legacy']]) {
    mark(`${variant}-label-classification-guidance`)
    const label = await request(`/api/${prefix}/scan-label`, { body: JSON.stringify({ imageSrc: labelImage }), paid: true })
    check(label.success === true && label.casNumber === '7732-18-5' && typeof label.name === 'string', 'LABEL_CONTRACT')
    const classified = await request(`/api/${prefix}/classify`, { body: JSON.stringify({ chemical: {
      name: `Water ${state.marker} ${variant}`, casNumber: '7732-18-5', molecularFormula: 'H2O',
    } }), paid: true })
    check(classified.responseSource === 'ai' && typeof classified.category === 'string'
      && typeof classified.reason === 'string' && Number.isFinite(classified.confidence), 'CLASSIFICATION_NOT_ACTUAL_AI')
    const guide = await request(`/api/${prefix}/disposal-guide`, { body: JSON.stringify({
      chemicals: [{ name: 'Water', casNumber: '7732-18-5', molecularFormula: 'H2O' }],
      batch: { batchId: `${state.marker}-${variant}`, matrix: 'aqueous', mixingState: 'unknown' },
      decision: { decisionStatus: 'needs_input', missingFields: ['measuredPh', 'amount'], allowedActions: [] },
    }), paid: true })
    check(guide.schemaVersion === 3 && guide.responseSource === 'ai' && guide.availability === 'available'
      && guide.decisionStatus === 'needs_input' && guide.destination?.depositAllowed === false
      && Array.isArray(guide.missingInputs) && guide.missingInputs.length > 0 && typeof guide.guide === 'string', 'GUIDANCE_SAFETY_CONTRACT')
    result.phases.push(`${variant}-label-classification-guidance`)
  }
  mark('voice-and-real-audio')
  const context = { labId: GATE0_RESERVED_LAB_ID, language: 'ko' }
  const redirect = await request('/api/voice/query', { body: JSON.stringify({ text: '폐액을 섞어서 폐기하는 방법', source: 'typed', context }) })
  check(redirect.intent === 'disposal' && redirect.uiAction?.type === 'open_waste_batch_review'
    && redirect.match === null && redirect.answerText === '폐액 배치 검토 화면을 열겠습니다. 필요한 정보를 화면에서 확인해 주세요.', 'VOICE_REDIRECT_CONTRACT')
  const location = await request('/api/voice/query', { body: JSON.stringify({ text: VOICE_LOCATION_INPUT, source: 'typed', context }), paid: true })
  check(location.intent === 'location' && location.match?.id === GATE0_RESERVED_INVENTORY_ID
    && location.match?.labId === GATE0_RESERVED_LAB_ID && !location.clarification, 'VOICE_LOCATION_CONTRACT')
  const spoken = await request('/api/voice/speak', { body: JSON.stringify({ text: 'This is a synthetic audio test.', format: 'mp3' }), paid: true, audio: true })
  check(spoken.byteLength > 100, 'EMPTY_AUDIO')
  const form = new FormData()
  form.append('file', new Blob([spoken], { type: 'audio/mpeg' }), 'ops3-synthetic.mp3')
  form.append('language', 'en')
  const transcript = await request('/api/voice/transcribe', { body: form, multipart: true, paid: true })
  check(typeof transcript.text === 'string' && /synthetic|audio|test/i.test(transcript.text)
    && transcript.model === 'gpt-transcribe', 'STT_CONTRACT')
  result.api = { ...budget.counts(), audioBytes: spoken.byteLength, audioSha256: hash(spoken),
    transcriptionModel: 'gpt-transcribe', voiceLocationProviderProvenance: 'not-exposed-by-contract' }
  result.phases.push('voice-and-real-audio')
}

async function runBrowser(admin, state, target) {
  const browser = await chromium.launch()
  const diagnostics = { cspViolations: 0, escapedCredentials: 0, unexpectedPaidRequests: 0,
    pageErrors: 0, authHttpStatus: null, page: 'not-opened' }
  result.browser = diagnostics
  try {
    const context = await browser.newContext({ baseURL: SMOKE_ORIGIN, locale: 'ko-KR',
      viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
    await context.route(`${SMOKE_ORIGIN}/**`, (route) => fulfillStagingAccessRoute(route, {
      clientId: env.STAGING_ACCESS_CLIENT_ID, clientSecret: env.STAGING_ACCESS_CLIENT_SECRET,
      targetOrigin: SMOKE_ORIGIN, deploymentId: target.deploymentId,
    }))
    const page = await context.newPage()
    page.setDefaultTimeout(20_000)
    page.setDefaultNavigationTimeout(30_000)
    let uploadSha256 = null
    let uploadCount = 0
    let uploadError = false
    page.on('console', (message) => { if (/^OPS3_CSP_VIOLATION [a-z-]+$/.test(message.text())) diagnostics.cspViolations += 1 })
    page.on('pageerror', () => { diagnostics.pageErrors += 1 })
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (url.origin === GATE0_STAGING_ORIGIN && url.pathname === '/auth/v1/token') diagnostics.authHttpStatus = response.status()
    })
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame() || frame.url() === 'about:blank') return
      const url = new URL(frame.url())
      diagnostics.page = url.origin !== SMOKE_ORIGIN ? 'unexpected-origin'
        : ['/login', '/app/inventory', '/app/cabinet'].includes(url.pathname) ? url.pathname : 'other-staging-page'
    })
    page.on('request', (request) => {
      if (Object.keys(request.headers()).some((name) => /^cf-access-client-(id|secret)$/i.test(name))
        && new URL(request.url()).origin !== SMOKE_ORIGIN) diagnostics.escapedCredentials += 1
    })
    // This browser validates only login and photo processing. Paid API checks run once above.
    await page.route(/\/api\/(?:ai|gemini|voice)\//, async (route) => { diagnostics.unexpectedPaidRequests += 1; await route.abort('blockedbyclient') })
    await page.route('**/api/chemicals/enrich', (route) => route.abort('blockedbyclient'))
    await page.route(`${GATE0_STAGING_ORIGIN}/storage/v1/object/cabinets/*`, async (route) => {
      try {
        const request = route.request()
        if (request.method() === 'OPTIONS') { await route.continue(); return }
        check(request.method() === 'POST', 'UNEXPECTED_STORAGE_METHOD')
        verifyPhotoPath(new URL(request.url()).pathname.slice('/storage/v1/object/cabinets/'.length), state.cabinetId)
        const body = request.postDataBuffer()
        check(body && body.byteLength <= 3 * 1024 * 1024 && uploadCount === 0, 'PHOTO_UPLOAD_LIMIT')
        const form = await new Response(body, { headers: { 'Content-Type': request.headers()['content-type'] } }).formData()
        const file = form.get('')
        check(file instanceof Blob && file.type === 'image/webp', 'PHOTO_UPLOAD_FORMAT')
        uploadSha256 = hash(Buffer.from(await file.arrayBuffer()))
        uploadCount += 1
        await route.continue()
      } catch {
        uploadError = true
        await route.abort('blockedbyclient')
      }
    })
    await page.addInitScript(() => {
      window.addEventListener('securitypolicyviolation', (event) => console.info('OPS3_CSP_VIOLATION', event.effectiveDirective))
      localStorage.setItem('i18nextLng', 'ko')
      localStorage.setItem('buril:safety-acknowledgement', JSON.stringify({ version: '2026-08-24.1', acknowledgedAt: '2026-08-24T00:00:00.000Z' }))
    })
    mark('browser-open-login')
    await page.goto('/login?returnTo=%2Fapp%2Finventory')
    mark('browser-submit-login')
    await page.locator('input[type="email"]').fill(env.GATE0_E2E_EMAIL)
    await page.locator('input[type="password"]').fill(env.GATE0_E2E_PASSWORD)
    await page.locator('form').getByRole('button', { name: /로그인|log in/i }).click()
    mark('browser-await-inventory')
    await browserExpect(page).toHaveURL(/\/app\/inventory/)
    mark('browser-select-synthetic-lab')
    const switcher = page.getByRole('banner').getByTitle('연구실 / 개인공간 전환')
    await switcher.click()
    await page.getByRole('button', { name: new RegExp(GATE0_LAB_NAME) }).click()
    await browserExpect(switcher).toContainText(GATE0_LAB_NAME)
    const skip = page.getByRole('button', { name: /온보딩 건너뛰기|건너뛰기|skip onboarding/i }).first()
    await skip.waitFor({ state: 'visible', timeout: 2000 }).then(() => skip.click(), () => undefined)
    mark('browser-open-cabinet-list')
    await page.goto('/app/cabinet')
    check(new URL(page.url()).origin === SMOKE_ORIGIN, 'BROWSER_ORIGIN_CHANGED')
    mark('browser-create-cabinet')
    await page.getByRole('button', { name: '새 시약장 만들기', exact: true }).click()
    const name = page.getByPlaceholder('예: 메인 시약장, 위험물 보관함')
    await name.fill(state.cabinetName)
    await name.press('Enter')
    await browserExpect.poll(async () => Boolean(await matchingCabinet(admin, state)), { timeout: 20_000 }).toBe(true)
    state.cabinetId = verifyCabinet(await matchingCabinet(admin, state), state)
    await save(state)
    const synthetic = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 2400; canvas.height = 1600
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('CANVAS_UNAVAILABLE')
      const gradient = ctx.createLinearGradient(0, 0, 2400, 1600)
      gradient.addColorStop(0, '#1e3a8a'); gradient.addColorStop(1, '#f8fafc')
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2400, 1600)
      ctx.fillStyle = '#ffffff'; ctx.font = '80px sans-serif'; ctx.fillText('SYNTHETIC CABINET - NO USER PHOTO', 80, 180)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    mark('browser-webp-upload')
    // The freshly seeded lab has exactly this one cabinet; the photo menu sets its ID.
    await page.getByTitle('시약장 사진 변경', { exact: true }).first().click()
    await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').setInputFiles({
      name: 'ops3-synthetic.png', mimeType: 'image/png', buffer: Buffer.from(synthetic, 'base64'),
    })
    await browserExpect.poll(async () => Boolean((await matchingCabinet(admin, state))?.image_url), { timeout: 30_000 }).toBe(true)
    const cabinet = await matchingCabinet(admin, state)
    const key = photoPathFromUrl(cabinet.image_url, state.cabinetId)
    const downloaded = checkedData(await admin.storage.from('cabinets').download(key), 'PHOTO_DOWNLOAD')
    const bytes = Buffer.from(await downloaded.arrayBuffer())
    check(downloaded.type === 'image/webp' && bytes.byteLength > 0 && bytes.byteLength <= 2 * 1024 * 1024
      && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP', 'PHOTO_WEBP_CONTRACT')
    check(!uploadError && uploadCount === 1 && uploadSha256 === hash(bytes), 'PHOTO_UPLOAD_DOWNLOAD_HASH_MISMATCH')
    const shape = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }))
      try { return { width: image.width, height: image.height } } finally { image.close() }
    }, bytes.toString('base64'))
    check(Math.max(shape.width, shape.height) === 1920 && Math.min(shape.width, shape.height) > 0, 'PHOTO_RESIZE_CONTRACT')
    await browserExpect(page.getByAltText(state.cabinetName).first()).toBeVisible()
    await browserExpect.poll(() => page.getByAltText(state.cabinetName).first().evaluate((image) => image.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
    const again = checkedData(await admin.storage.from('cabinets').download(key), 'PHOTO_HASH_RECHECK')
    check(hash(Buffer.from(await again.arrayBuffer())) === hash(bytes), 'PHOTO_HASH_MISMATCH')
    check(diagnostics.cspViolations === 0 && diagnostics.escapedCredentials === 0 && diagnostics.unexpectedPaidRequests === 0
      && diagnostics.pageErrors === 0, 'BROWSER_SECURITY_BOUNDARY')
    result.photo = { sourceWidth: 2400, sourceHeight: 1600, ...shape, bytes: bytes.byteLength, sha256: hash(bytes),
      contentType: 'image/webp', cspViolations: diagnostics.cspViolations,
      escapedCredentials: diagnostics.escapedCredentials, unexpectedPaidRequests: diagnostics.unexpectedPaidRequests }
    result.phases.push('browser-webp-upload')
  } finally { await browser.close() }
}

async function makeLabel() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    return await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 450
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('CANVAS_UNAVAILABLE')
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 900, 450); ctx.fillStyle = 'black'; ctx.font = '52px sans-serif'
      for (const [index, line] of ['WATER', 'CAS 7732-18-5', 'H2O / 500 mL', 'SYNTHETIC TEST LABEL'].entries()) ctx.fillText(line, 40, 90 + index * 95)
      return canvas.toDataURL('image/png')
    })
  } finally { await browser.close() }
}

async function main() {
  const target = resolveSmokeTarget(env)
  result.targetSha = target.sha; result.deploymentId = target.deploymentId; result.verificationRunId = target.verificationRunId
  result.verificationScope = target.scope
  requireSecrets()
  const { admin, user } = clients()
  if (process.argv[2] === 'cleanup') {
    let state
    try { state = JSON.parse(await readFile(journalPath(), 'utf8')) }
    catch (error) { if (error?.code === 'ENOENT') { console.log(JSON.stringify({ cleanup: 'no-pending-run-journal' })); return }; throw error }
    result.cleanup = await cleanup(admin, user, state, target)
  } else {
    check(process.argv[2] === 'run', 'INVALID_MODE')
    await preflight(target)
    mark('reset-owned-synthetic-fixture')
    // Capture, do not publish, seed diagnostics (which can contain provider errors).
    try {
      await runFile(process.execPath, ['scripts/seed-gate0-e2e.mjs'], { env: { ...env,
        GATE0_STAGING_SEED_CONFIRMATION: GATE0_STAGING_CONFIRMATION }, timeout: 120_000, maxBuffer: 128 * 1024 })
    } catch { throw new SmokeError('SYNTHETIC_SEED_FAILED_REDACTED') }
    const nonce = randomBytes(16).toString('hex')
    const state = { schemaVersion: 1, verificationRunId: target.verificationRunId, targetSha: target.sha,
      deploymentId: target.deploymentId, nonce, marker: `ops3-${target.verificationRunId}-${nonce}`,
      // Accommodate minor database/client clock skew without broadening the random run identity.
      startedAt: new Date(Date.now() - 5000).toISOString(), ownerId: await owner(admin), cabinetId: null }
    state.cabinetName = `Ops3 synthetic ${state.marker}`
    state.aliasIds = (await rows(admin, state, 'aliases')).map((row) => row.id)
    state.feedbackIds = (await rows(admin, state, 'feedback')).map((row) => row.id)
    check(await matchingCabinet(admin, state) === null && (await cacheRows(admin, state)).length === 0, 'RUN_IDENTITY_ALREADY_EXISTS')
    await save(state)
    let failure
    try {
      const login = checkedData(await user.auth.signInWithPassword({ email: env.GATE0_E2E_EMAIL, password: env.GATE0_E2E_PASSWORD }), 'API_FIXTURE_SIGNIN')
      check(login.user?.id === state.ownerId && login.session?.access_token, 'API_FIXTURE_IDENTITY')
      if (target.scope === 'photo') result.api = { requests: 0, paidRequests: 0, skipped: true }
      await runSmokeChecks({ scope: target.scope,
        api: async () => runApis(login.session.access_token, state, await makeLabel()),
        browser: () => runBrowser(admin, state, target),
      })
    } catch (error) { failure = error; result.failedPhase = phase; result.failure = safeFailure(error) }
    finally {
      mark('exact-synthetic-cleanup')
      try { result.cleanup = await cleanup(admin, user, state, target) }
      catch (error) { result.cleanup = 'incomplete'; failure ||= error; result.cleanupFailure = safeFailure(error) }
    }
    if (failure) throw failure
  }
  result.result = 'success'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    result.result = 'failed'; result.failure ||= safeFailure(error); result.failedPhase ||= phase
    process.exitCode = 1
  }).finally(async () => {
    // Only a fixed-shape anonymous summary leaves this runner. No responses,
    // prompts, screenshots, traces, object paths, user IDs or credentials.
    console.log(JSON.stringify(result))
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `### Ops3 Staging live verification\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`)
  })
}
