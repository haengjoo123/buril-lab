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
  throw new Error('Usage (Windows only): node scripts/test-ops11-local-postgres.mjs <reviewed-pgsql-bin> <reviewed-official-zip>')
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
  if (!condition) throw new Error(`OPS11 native assertion failed: ${label}`)
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
    const timer = setTimeout(() => fail(`OPS11 local ${path.basename(executable)} exceeded its 60-second limit`), 60_000)
    child.once('error', () => fail('OPS11 local child failed to start'))
    child.stdin.once('error', () => fail('OPS11 local child input failed'))
    const collect = (target, chunk) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) return fail('OPS11 local output exceeded its limit')
      target.push(chunk)
    }
    child.stdout.on('data', (chunk) => collect(out, chunk))
    child.stderr.on('data', (chunk) => collect(err, chunk))
    child.once(daemonLauncher ? 'exit' : 'close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (daemonLauncher) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy() }
      if (code !== 0) return reject(new Error(`OPS11 local ${path.basename(executable)} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0,3000)}`))
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
    && /^burillab-ops11-native-[a-zA-Z0-9]+$/.test(path.basename(ownedRoot)), 'exact temporary child')
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
  ops10: 'supabase/migrations/20260904060000_ops10_operator_roles_mfa.sql',
  ops11: 'supabase/migrations/20260904070000_ops11_deletion_worker.sql',
  assertions: 'scripts/fixtures/ops11-deletion-worker-assertions.sql',
}
const sources = Object.fromEntries(Object.entries(sourceFiles).map(([key, relative]) => [
  key, readFileSync(path.join(repository, relative), 'utf8'),
]))
const digest = (value) => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex')
const user = (n) => `b1000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const requestId = (n) => `b2000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const entity = (n) => `b3000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let evidence

try {
  const verified = await verifyPostgresPortableArtifacts({
    pgDumpPath: path.join(pgBin, 'pg_dump.exe'), pgRestorePath: path.join(pgBin, 'pg_restore.exe'),
    psqlPath: path.join(pgBin, 'psql.exe'), archivePath: archive, allowedRoot: path.dirname(archive),
  })
  ownedRoot = realpathSync(mkdtempSync(path.join(realpathSync(os.tmpdir()), 'burillab-ops11-native-')))
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

  for (const database of ['ops11_empty_a','ops11_empty_b']) {
    await query('postgres', `create database ${database};`)
    for (const name of ['bootstrap','baseline','ops5','ops6Expand','ops6Switch','ops7','ops8','ops9','ops10','ops11']) {
      await query(database, sources[name])
    }
    ensure((await query(database, sources.assertions)).endsWith('OPS11_DELETION_WORKER_SQL_ASSERTIONS_PASSED'),
      'deletion worker catalog assertions completed')
    console.log(JSON.stringify({ stage: 'empty_install_and_permission_tests', database, success: true }))
  }

  const db = 'ops11_empty_b'
  const account = user(1), labAdmin = user(2), lab = entity(1)
  const personalCabinet = entity(2), labCabinet = entity(3), personalInventory = entity(4), labInventory = entity(5)
  const personalPath = `users/${account}/cabinets/${personalCabinet}/${entity(10)}.webp`
  const labPath = `labs/${lab}/cabinets/${labCabinet}/${entity(11)}.webp`
  const service = (sql) => `set request.jwt.claims='{"role":"service_role"}'; set role service_role; ${sql}`
  await query(db, `insert into auth.users(id,email) values
    ('${account}','ops11-account@example.invalid'),('${labAdmin}','ops11-admin@example.invalid');
    insert into public.labs(id,name,created_by) values('${lab}','Synthetic Lab','${labAdmin}');
    insert into public.lab_members(lab_id,user_id,role) values
      ('${lab}','${labAdmin}','admin'),('${lab}','${account}','researcher');
    insert into public.cabinets(id,name,user_id,lab_id,image_path) values
      ('${personalCabinet}','Personal','${account}',null,'${personalPath}'),
      ('${labCabinet}','Shared','${account}','${lab}','${labPath}');
    insert into private.cabinet_image_objects_v1(path,cabinet_id,lab_id,owner_user_id,sha256,size_bytes) values
      ('${personalPath}','${personalCabinet}',null,'${account}',repeat('a',64),100),
      ('${labPath}','${labCabinet}','${lab}','${account}',repeat('b',64),100);
    insert into public.inventory(id,lab_id,user_id,name) values
      ('${personalInventory}',null,'${account}','Personal synthetic'),
      ('${labInventory}','${lab}','${account}','Shared synthetic');
    insert into private.operator_role_assignments_v1(user_id,role,reason_code)
      values('${account}','reader','INITIAL_PROVISION');`)

  const enqueued = JSON.parse(await query(db, service(`select public.enqueue_account_deletion_v1(
    '${account}','${requestId(1)}')::text;`)))
  ensure(enqueued.success === true, 'account job queued')
  const claim = JSON.parse(await query(db, service('select public.claim_deletion_jobs_v1(1)::text;'))).jobs[0]
  ensure(claim.kind === 'account' && claim.attempt_count === 1, 'account job claimed once')
  const prepared = JSON.parse(await query(db, service(`select public.prepare_deletion_job_database_v1(
    '${claim.job_id}','${claim.lease_token}')::text;`)))
  ensure(prepared.stage === 'storage' && prepared.target_count === 1, 'account database stage captured one personal photo')
  ensure(await query(db, `select count(*) from public.cabinets where id='${personalCabinet}';`) === '0', 'personal cabinet deleted')
  ensure(await query(db, `select user_id is null from public.inventory where id='${labInventory}';`) === 't', 'shared inventory attribution removed')
  ensure(await query(db, `select count(*) from public.lab_members where user_id='${account}';`) === '0', 'shared membership revoked')
  ensure(await query(db, `select count(*) from private.operator_role_assignments_v1 where user_id='${account}';`) === '0', 'operator role revoked')
  const targets = JSON.parse(await query(db, service(`select public.list_deletion_file_targets_v1(
    '${claim.job_id}','${claim.lease_token}')::text;`))).targets
  ensure(targets.length === 1 && targets[0].path === personalPath, 'only personal Storage target returned')
  await query(db, service(`select public.mark_deletion_storage_complete_v1('${claim.job_id}','${claim.lease_token}');`))
  await query(db, `delete from auth.users where id='${account}';`)
  await query(db, service(`select public.mark_deletion_auth_complete_v1('${claim.job_id}','${claim.lease_token}');
    select public.finalize_deletion_job_v1('${claim.job_id}','${claim.lease_token}');`))
  ensure(await query(db, `select status from private.deletion_jobs_v1 where id='${claim.job_id}';`) === 'completed', 'account job completed')
  ensure(await query(db, `select count(*) from private.deletion_file_targets_v1 where job_id='${claim.job_id}';`) === '0', 'sensitive target paths purged')
  ensure(await query(db, `select count(*) from private.cabinet_image_objects_v1 where path='${personalPath}';`) === '0', 'personal photo metadata purged')
  ensure(await query(db, `select count(*) from private.cabinet_image_objects_v1 where path='${labPath}';`) === '1', 'shared lab photo preserved')

  const labQueued = JSON.parse(await query(db, service(`select public.enqueue_lab_deletion_v1(
    '${labAdmin}','${lab}','${requestId(2)}')::text;`)))
  ensure(labQueued.success === true, 'lab job queued')
  const labClaim = JSON.parse(await query(db, service('select public.claim_deletion_jobs_v1(1)::text;'))).jobs[0]
  const labPrepared = JSON.parse(await query(db, service(`select public.prepare_deletion_job_database_v1(
    '${labClaim.job_id}','${labClaim.lease_token}')::text;`)))
  ensure(labPrepared.target_count === 1, 'lab database stage captured lab photo')
  ensure(await query(db, `select count(*) from public.labs where id='${lab}';`) === '0', 'lab root deleted atomically')
  ensure(await query(db, `select count(*) from auth.users where id='${labAdmin}';`) === '1', 'lab deletion preserves admin account')
  await query(db, service(`select public.mark_deletion_storage_complete_v1('${labClaim.job_id}','${labClaim.lease_token}');
    select public.mark_deletion_auth_complete_v1('${labClaim.job_id}','${labClaim.lease_token}');
    select public.finalize_deletion_job_v1('${labClaim.job_id}','${labClaim.lease_token}');`))
  ensure(await query(db, `select status from private.deletion_jobs_v1 where id='${labClaim.job_id}';`) === 'completed', 'lab job completed')

  const leaseA = requestId(20), leaseB = requestId(21)
  const firstLease = JSON.parse(await query(db, service(`select public.acquire_deletion_worker_run_v1('${leaseA}',55)::text;`)))
  const secondLease = JSON.parse(await query(db, service(`select public.acquire_deletion_worker_run_v1('${leaseB}',55)::text;`)))
  ensure(firstLease.acquired === true && secondLease.acquired === false, 'overlapping worker run denied')
  await query(db, service(`select public.release_deletion_worker_run_v1('${leaseA}');`))

  evidence = {
    syntheticOnly: true, remoteCalls: 0, nativeEmptyInstalls: 2,
    accountStages: ['database','storage','auth','finalize'], labStages: ['database','storage','finalize'],
    accountAuthDeleted: true, labAdminAuthPreserved: true, workerOverlapDenied: true,
    sensitivePathsPurged: true, maxAttempts: 12, hostedSupabaseAcceptance: false,
    postgresArchiveSha256: verified.archiveSha256,
    ops11MigrationSha256: digest(sources.ops11), assertionsSha256: digest(sources.assertions),
  }
} finally {
  if (serverMayBeRunning) {
    await command(path.join(pgBin, 'pg_ctl.exe'), ['-D',cluster,'-m','fast','-w','-t','30','stop'])
    serverStopped = true
  } else serverStopped = true
  if (ownedRoot && serverStopped) removeOwnedStoppedCluster()
}

console.log(JSON.stringify(evidence))
