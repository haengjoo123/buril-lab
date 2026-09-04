import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyPostgresPortableArtifacts } from './verify-supabase-recovery-preflight.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [selectedBin, selectedArchive, ...extra] = process.argv.slice(2)
if (process.platform !== 'win32' || !selectedBin || !selectedArchive || extra.length) {
  throw new Error('Usage (Windows only): node scripts/test-ops9-local-postgres.mjs <reviewed-pgsql-bin> <reviewed-official-zip>')
}
const pgBin = realpathSync(selectedBin)
const archive = realpathSync(selectedArchive)
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['systemroot','windir','temp','tmp','userprofile','homedrive','homepath','appdata','localappdata'].includes(key.toLowerCase())))
cleanEnvironment.Path = `${pgBin};C:\\Windows\\System32;C:\\Windows`
cleanEnvironment.ComSpec = 'C:\\Windows\\System32\\cmd.exe'
cleanEnvironment.PGCLIENTENCODING = 'UTF8'
cleanEnvironment.PGCONNECT_TIMEOUT = '5'
let ownedRoot
let cluster
let serverMayBeRunning = false
let serverStopped = false

function ensure(condition, label) {
  if (!condition) throw new Error(`OPS9 native assertion failed: ${label}`)
}

function command(executable, args, input = '', daemonLauncher = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: repository, env: cleanEnvironment, shell: false, windowsHide: true,
      stdio: ['pipe','pipe','pipe'],
    })
    const out = [], err = []
    let size = 0, settled = false
    const fail = (message) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      reject(new Error(`${message}: ${Buffer.concat([...out,...err]).toString('utf8').slice(-3000)}`))
    }
    const timer = setTimeout(() => fail(`OPS9 local ${path.basename(executable)} exceeded its 60-second limit`), 60_000)
    child.once('error', () => fail('OPS9 local child failed to start'))
    child.stdin.once('error', () => fail('OPS9 local child input failed'))
    const collect = (target, chunk) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) return fail('OPS9 local output exceeded its limit')
      target.push(chunk)
    }
    child.stdout.on('data', (chunk) => collect(out, chunk))
    child.stderr.on('data', (chunk) => collect(err, chunk))
    child.once(daemonLauncher ? 'exit' : 'close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (daemonLauncher) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy() }
      if (code !== 0) return reject(new Error(`OPS9 local ${path.basename(executable)} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0,3000)}`))
      resolve(Buffer.concat(out).toString('utf8').trim())
    })
    child.stdin.end(input, 'utf8')
  })
}

async function availableLoopbackPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

function removeOwnedStoppedCluster() {
  ensure(serverStopped && ownedRoot && realpathSync(ownedRoot) === ownedRoot, 'stopped owned directory')
  ensure(path.dirname(ownedRoot) === realpathSync(os.tmpdir())
    && /^burillab-ops9-native-[a-zA-Z0-9]+$/.test(path.basename(ownedRoot)), 'exact temporary child')
  const inspect = (directory) => {
    ensure(!lstatSync(directory).isSymbolicLink()
      && realpathSync(directory).startsWith(`${ownedRoot}${path.sep}`), 'regular child directory')
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      ensure(!entry.isSymbolicLink() && realpathSync(target).startsWith(`${ownedRoot}${path.sep}`), 'regular child path')
      if (entry.isDirectory()) inspect(target)
      else ensure(entry.isFile(), 'regular file')
    }
  }
  for (const entry of readdirSync(ownedRoot, { withFileTypes: true })) {
    const target = path.join(ownedRoot, entry.name)
    ensure(!entry.isSymbolicLink() && realpathSync(target).startsWith(`${ownedRoot}${path.sep}`), 'root child')
    if (entry.isDirectory()) inspect(target)
    else ensure(entry.isFile(), 'root file')
  }
  rmSync(ownedRoot, { recursive: true, force: false })
}

const sourceFiles = {
  bootstrap: 'scripts/fixtures/ops5-local-bootstrap.sql',
  baseline: 'supabase/migrations/20260824000000_production_baseline.sql',
  ops5: 'supabase/migrations/20260903162850_ops5_expand_server_join.sql',
  ops6Expand: 'supabase/migrations/20260904020000_ops6_private_cabinet_photos_expand.sql',
  ops6Switch: 'supabase/migrations/20260904021000_ops6_private_cabinet_photos_switch.sql',
  ops7: 'supabase/migrations/20260904030000_ops7_contract_legacy_join_audit.sql',
  ops8: 'supabase/migrations/20260904040000_ops8_lab_password_policy.sql',
  ops9: 'supabase/migrations/20260904050000_ops9_deletion_jobs.sql',
  assertions: 'scripts/fixtures/ops9-deletion-assertions.sql',
}
const sources = Object.fromEntries(Object.entries(sourceFiles).map(([key, relative]) => [
  key, readFileSync(path.join(repository, relative), 'utf8'),
]))
const digest = (value) => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex')
const uuid = (group, n) => `${group}000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const actor = (n) => uuid('91', n)
const lab = (n) => uuid('92', n)
const cabinet = (n) => uuid('93', n)
const requestId = (n) => uuid('94', n)
let evidence

try {
  const verified = await verifyPostgresPortableArtifacts({
    pgDumpPath: path.join(pgBin, 'pg_dump.exe'),
    pgRestorePath: path.join(pgBin, 'pg_restore.exe'),
    psqlPath: path.join(pgBin, 'psql.exe'),
    archivePath: archive,
    allowedRoot: path.dirname(archive),
  })
  ownedRoot = realpathSync(mkdtempSync(path.join(realpathSync(os.tmpdir()), 'burillab-ops9-native-')))
  cluster = path.join(ownedRoot, 'data')
  const port = await availableLoopbackPort()
  await command(path.join(pgBin, 'initdb.exe'), ['-D',cluster,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale','--no-sync'])
  serverMayBeRunning = true
  await command(path.join(pgBin, 'pg_ctl.exe'), ['-D',cluster,'-l',path.join(ownedRoot,'server.log'),
    '-o',`-h 127.0.0.1 -p ${port} -c logging_collector=off -c shared_preload_libraries=`,
    '-w','-t','30','start'], '', true)
  const query = (database, sql) => command(path.join(pgBin, 'psql.exe'),
    ['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',database], sql)
  ensure(realpathSync(await query('postgres', "select current_setting('data_directory');")).toLowerCase()
    === realpathSync(cluster).toLowerCase(), 'server belongs to this fresh cluster')
  await query('postgres', 'create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;')

  for (const database of ['ops9_empty_a','ops9_empty_b']) {
    await query('postgres', `create database ${database};`)
    for (const name of ['bootstrap','baseline','ops5','ops6Expand','ops6Switch','ops7','ops8','ops9']) {
      await query(database, sources[name])
    }
    ensure((await query(database, sources.assertions)).endsWith('OPS9_DELETION_SQL_ASSERTIONS_PASSED'),
      'deletion catalog assertions completed')
    console.log(JSON.stringify({ stage: 'empty_install_and_permission_tests', database, success: true }))
  }

  const db = 'ops9_empty_b'
  const accountUser = actor(1)
  const adminUser = actor(2)
  const memberUser = actor(3)
  const maxUser = actor(4)
  const photoUser = actor(5)
  const labPhotoAdmin = actor(6)
  await query(db, `insert into auth.users(id,email) values
    ('${accountUser}','ops9-account@example.invalid'),
    ('${adminUser}','ops9-admin@example.invalid'),
    ('${memberUser}','ops9-member@example.invalid'),
    ('${maxUser}','ops9-max@example.invalid'),
    ('${photoUser}','ops9-photo@example.invalid'),
    ('${labPhotoAdmin}','ops9-lab-photo@example.invalid');
    insert into public.labs(id,name,created_by) values
    ('${lab(1)}','OPS9 Main Lab','${adminUser}'),
    ('${lab(2)}','OPS9 Photo Lab','${labPhotoAdmin}');
    insert into public.lab_members(lab_id,user_id,role) values
    ('${lab(1)}','${adminUser}','admin'),
    ('${lab(1)}','${memberUser}','student'),
    ('${lab(2)}','${labPhotoAdmin}','admin');`)

  const service = (sql) => `set request.jwt.claims='{"role":"service_role"}'; set role service_role; ${sql}`
  async function rejected(sql, pattern, label) {
    try { await query(db, sql) } catch (error) {
      if (pattern.test(String(error))) return
      throw error
    }
    throw new Error(`OPS9 native assertion failed: ${label}`)
  }

  const accountJob = await query(db, service(
    `select public.enqueue_account_deletion_v1('${accountUser}','${requestId(1)}')->>'job_id';`))
  ensure(/^[0-9a-f-]{36}$/.test(accountJob), 'account deletion is queued')
  const sameAccountJob = await query(db, service(
    `select public.enqueue_account_deletion_v1('${accountUser}','${requestId(2)}')->>'job_id';`))
  ensure(sameAccountJob === accountJob, 'a second active account request is idempotent')
  ensure(await query(db, `select count(*) from private.deletion_job_events_v1 where job_id='${accountJob}' and event_type='requested';`) === '1',
    'idempotent intake writes one request event')

  const claimed = JSON.parse(await query(db, service('select public.claim_deletion_jobs_v1(1)::text;')))
  ensure(claimed.success === true && claimed.jobs.length === 1 && claimed.jobs[0].job_id === accountJob
    && claimed.jobs[0].attempt_count === 1, 'one worker claims the account job once')
  ensure(JSON.parse(await query(db, service('select public.claim_deletion_jobs_v1(1)::text;'))).jobs.length === 0,
    'an active lease prevents a concurrent second claim')
  await rejected(service(`select public.record_deletion_job_result_v1('${accountJob}','${requestId(99)}','retry','database','DB_RETRY');`),
    /lease is not active/i, 'a wrong worker lease is rejected')
  await query(db, service(`select public.record_deletion_job_result_v1(
    '${accountJob}','${claimed.jobs[0].lease_token}','retry','storage','STORAGE_RETRY');`))
  ensure(await query(db, `select status||'|'||attempt_count||'|'||last_error_code from private.deletion_jobs_v1 where id='${accountJob}';`)
    === 'retry_wait|1|STORAGE_RETRY', 'an intermediate failure remains retryable')
  await query(db, `update private.deletion_jobs_v1 set next_attempt_at=clock_timestamp() where id='${accountJob}';`)
  const reclaimed = JSON.parse(await query(db, service('select public.claim_deletion_jobs_v1(1)::text;'))).jobs[0]
  ensure(reclaimed.job_id === accountJob && reclaimed.attempt_count === 2
    && reclaimed.lease_token !== claimed.jobs[0].lease_token, 'a retry gets a new bounded lease')
  await rejected(service(`select public.record_deletion_job_result_v1(
    '${accountJob}','${reclaimed.lease_token}','retry','database','DB_RETRY');`),
    /stage cannot move backward/i, 'a retry cannot repeat an earlier destructive stage')
  await rejected(service(`select public.record_deletion_job_result_v1(
    '${accountJob}','${reclaimed.lease_token}','completed','database',null);`),
    /Invalid deletion job result/i, 'only finalize can complete an entire deletion')
  await query(db, service(`select public.record_deletion_job_result_v1(
    '${accountJob}','${reclaimed.lease_token}','completed','finalize',null);`))
  ensure(await query(db, `select status||'|'||stage from private.deletion_jobs_v1 where id='${accountJob}';`) === 'completed|finalize',
    'a valid final result closes the job')
  ensure(await query(db, service(`select public.get_deletion_job_status_v1('${accountJob}','${accountUser}')->>'status';`)) === 'completed',
    'the service can return a requester-bound generalized status')

  await rejected(service('select count(*) from private.deletion_jobs_v1;'), /permission denied/i,
    'service role has no direct queue access')
  await rejected(`set request.jwt.claims='{"role":"authenticated","sub":"${accountUser}"}'; set role authenticated;
    select public.enqueue_account_deletion_v1('${accountUser}','${requestId(3)}');`, /permission denied/i,
    'authenticated clients cannot call intake RPCs')
  await rejected(`update private.deletion_job_events_v1 set stage='auth' where job_id='${accountJob}';`, /append only/i,
    'event updates are blocked')
  await rejected(`delete from private.deletion_job_events_v1 where job_id='${accountJob}';`, /append only/i,
    'event deletes are blocked')
  await rejected('truncate private.deletion_job_events_v1;', /append only/i,
    'event truncation is blocked')

  ensure(await query(db, service(
    `select public.enqueue_account_deletion_v1('${adminUser}','${requestId(4)}')->>'code';`)) === 'account_transfer_required',
    'account admins must transfer or delete their labs first')
  ensure(await query(db, service(
    `select public.enqueue_lab_deletion_v1('${memberUser}','${lab(1)}','${requestId(5)}')->>'code';`)) === 'lab_admin_required',
    'non-admins cannot queue lab deletion')
  const labJob = await query(db, service(
    `select public.enqueue_lab_deletion_v1('${adminUser}','${lab(1)}','${requestId(6)}')->>'job_id';`))
  ensure(/^[0-9a-f-]{36}$/.test(labJob), 'a lab admin can queue the exact lab')

  await query(db, `insert into public.cabinets(id,name,user_id,image_path)
    values('${cabinet(1)}','Personal photo','${photoUser}','private/users/${photoUser}/${cabinet(1)}/${requestId(20)}.webp');`)
  await rejected(service(`select public.enqueue_account_deletion_v1('${photoUser}','${requestId(7)}');`),
    /deletion_file_ownership_unverified/i, 'unverified personal file ownership blocks intake')
  await query(db, `insert into private.cabinet_image_objects_v1(path,cabinet_id,owner_user_id,sha256,size_bytes)
    values('private/users/${photoUser}/${cabinet(1)}/${requestId(20)}.webp','${cabinet(1)}','${photoUser}','${'a'.repeat(64)}',100);`)
  ensure(/^[0-9a-f-]{36}$/.test(await query(db, service(
    `select public.enqueue_account_deletion_v1('${photoUser}','${requestId(7)}')->>'job_id';`))),
    'verified personal file ownership permits intake')

  await query(db, `insert into public.cabinets(id,name,lab_id,image_path)
    values('${cabinet(2)}','Lab photo','${lab(2)}','private/labs/${lab(2)}/${cabinet(2)}/${requestId(21)}.webp');`)
  await rejected(service(`select public.enqueue_lab_deletion_v1('${labPhotoAdmin}','${lab(2)}','${requestId(8)}');`),
    /deletion_file_ownership_unverified/i, 'unverified lab file ownership blocks intake')
  await query(db, `insert into private.cabinet_image_objects_v1(path,cabinet_id,lab_id,owner_user_id,sha256,size_bytes)
    values('private/labs/${lab(2)}/${cabinet(2)}/${requestId(21)}.webp','${cabinet(2)}','${lab(2)}','${labPhotoAdmin}','${'b'.repeat(64)}',200);`)
  ensure(/^[0-9a-f-]{36}$/.test(await query(db, service(
    `select public.enqueue_lab_deletion_v1('${labPhotoAdmin}','${lab(2)}','${requestId(8)}')->>'job_id';`))),
    'verified lab file ownership permits intake')

  const maxJob = await query(db, service(
    `select public.enqueue_account_deletion_v1('${maxUser}','${requestId(9)}')->>'job_id';`))
  await query(db, `update private.deletion_jobs_v1 set attempt_count=11, next_attempt_at=clock_timestamp()-interval '1 second'
    where id='${maxJob}';`)
  let maxClaim
  for (let i = 0; i < 10 && !maxClaim; i += 1) {
    const candidate = JSON.parse(await query(db, service('select public.claim_deletion_jobs_v1(10)::text;'))).jobs
      .find((job) => job.job_id === maxJob)
    if (candidate) maxClaim = candidate
  }
  ensure(maxClaim?.attempt_count === 12, 'the final claim is attempt twelve')
  await query(db, service(`select public.record_deletion_job_result_v1(
    '${maxJob}','${maxClaim.lease_token}','retry','storage','STORAGE_RETRY');`))
  ensure(await query(db, `select status||'|'||attempt_count from private.deletion_jobs_v1 where id='${maxJob}';`) === 'failed|12',
    'attempt twelve becomes a terminal generalized failure')

  evidence = {
    syntheticOnly: true,
    remoteCalls: 0,
    nativeEmptyInstalls: 2,
    serviceOnlyQueueVerified: true,
    idempotencyAndLeaseVerified: true,
    intermediateRetryVerified: true,
    maximumAttemptsVerified: 12,
    appendOnlyEvidenceVerified: true,
    accountAndLabFileOwnershipVerified: true,
    userFacingDeletionEnabled: false,
    postgresArchiveSha256: verified.archiveSha256,
    ops9MigrationSha256: digest(sources.ops9),
  }
} finally {
  if (serverMayBeRunning) {
    await command(path.join(pgBin, 'pg_ctl.exe'), ['-D',cluster,'-m','fast','-w','-t','30','stop'])
    serverStopped = true
  } else serverStopped = true
  if (ownedRoot && serverStopped) removeOwnedStoppedCluster()
}

console.log(JSON.stringify({ ...evidence, clusterStopped: serverStopped, syntheticDirectoryRemoved: true }))
