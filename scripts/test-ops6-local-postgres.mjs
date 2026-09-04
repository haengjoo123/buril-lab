import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyPostgresPortableArtifacts } from './verify-supabase-recovery-preflight.mjs'

// Starts only a verified, disposable loopback PostgreSQL cluster. It has no
// remote URL or credential input and is not a substitute for hosted Supabase
// Storage acceptance.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [selectedBin, selectedArchive, ...extra] = process.argv.slice(2)
if (process.platform !== 'win32' || !selectedBin || !selectedArchive || extra.length) {
  throw new Error('Usage (Windows only): node scripts/test-ops6-local-postgres.mjs <reviewed-pgsql-bin> <reviewed-official-zip>')
}
const pgBin = realpathSync(selectedBin)
const archive = realpathSync(selectedArchive)
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['systemroot', 'windir', 'temp', 'tmp', 'userprofile', 'homedrive', 'homepath', 'appdata', 'localappdata'].includes(key.toLowerCase())))
cleanEnvironment.Path = `${pgBin};C:\\Windows\\System32;C:\\Windows`
cleanEnvironment.ComSpec = 'C:\\Windows\\System32\\cmd.exe'
cleanEnvironment.PGCLIENTENCODING = 'UTF8'
cleanEnvironment.PGCONNECT_TIMEOUT = '5'
let ownedRoot
let cluster
let serverMayBeRunning = false
let serverStopped = false

function command(executable, args, input = '', onOutput, daemonLauncher = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: repository, env: cleanEnvironment, shell: false, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const out = [], err = []
    let size = 0, settled = false
    const fail = (message) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      reject(new Error(`${message}: ${Buffer.concat([...out, ...err]).toString('utf8').slice(-2400)}`))
    }
    const timer = setTimeout(() => fail(`OPS6 local ${path.basename(executable)} exceeded its 60-second limit`), 60_000)
    child.once('error', () => fail('OPS6 local child failed to start'))
    child.stdin.once('error', () => fail('OPS6 local child input failed'))
    const collect = (target, chunk) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) return fail('OPS6 local output exceeded its limit')
      target.push(chunk)
      if (target === out) onOutput?.(chunk.toString('utf8'))
    }
    child.stdout.on('data', (chunk) => collect(out, chunk))
    child.stderr.on('data', (chunk) => collect(err, chunk))
    child.once(daemonLauncher ? 'exit' : 'close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (daemonLauncher) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy() }
      if (code !== 0) return reject(new Error(`OPS6 local ${path.basename(executable)} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 3000)}`))
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

function ensure(condition, label) {
  if (!condition) throw new Error(`OPS6 native assertion failed: ${label}`)
}

function removeOwnedStoppedCluster() {
  ensure(serverStopped && ownedRoot && realpathSync(ownedRoot) === ownedRoot, 'stopped owned directory')
  ensure(path.dirname(ownedRoot) === realpathSync(os.tmpdir()) && /^burillab-ops6-native-[a-zA-Z0-9]+$/.test(path.basename(ownedRoot)), 'exact temporary child')
  const inspect = (directory) => {
    ensure(!lstatSync(directory).isSymbolicLink() && realpathSync(directory).startsWith(`${ownedRoot}${path.sep}`), 'regular child directory')
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      ensure(!entry.isSymbolicLink() && realpathSync(target).startsWith(`${ownedRoot}${path.sep}`), 'regular child path')
      if (entry.isDirectory()) inspect(target)
      else ensure(entry.isFile(), 'regular file')
    }
  }
  ensure(!lstatSync(ownedRoot).isSymbolicLink(), 'regular root')
  for (const entry of readdirSync(ownedRoot, { withFileTypes: true })) {
    const target = path.join(ownedRoot, entry.name)
    ensure(!entry.isSymbolicLink() && realpathSync(target).startsWith(`${ownedRoot}${path.sep}`), 'root child')
    if (entry.isDirectory()) inspect(target)
    else ensure(entry.isFile(), 'root file')
  }
  rmSync(ownedRoot, { recursive: true, force: false })
}

const sources = Object.fromEntries(Object.entries({
  bootstrap: 'scripts/fixtures/ops5-local-bootstrap.sql',
  baseline: 'supabase/migrations/20260824000000_production_baseline.sql',
  ops5: 'supabase/migrations/20260903162850_ops5_expand_server_join.sql',
  expand: 'supabase/migrations/20260904020000_ops6_private_cabinet_photos_expand.sql',
  switchMigration: 'supabase/migrations/20260904021000_ops6_private_cabinet_photos_switch.sql',
  assertions: 'scripts/fixtures/ops6-photo-assertions.sql',
}).map(([key, relative]) => [key, readFileSync(path.join(repository, relative), 'utf8')]))
const digest = (text) => createHash('sha256').update(text).digest('hex')
let evidence
try {
  const verified = await verifyPostgresPortableArtifacts({
    pgDumpPath: path.join(pgBin, 'pg_dump.exe'),
    pgRestorePath: path.join(pgBin, 'pg_restore.exe'),
    psqlPath: path.join(pgBin, 'psql.exe'),
    archivePath: archive,
    allowedRoot: path.dirname(archive),
  })
  console.log(JSON.stringify({ stage: 'verified_official_postgres', binFiles: verified.binManifest.length }))
  ownedRoot = realpathSync(mkdtempSync(path.join(realpathSync(os.tmpdir()), 'burillab-ops6-native-')))
  cluster = path.join(ownedRoot, 'data')
  const port = await availableLoopbackPort()
  await command(path.join(pgBin, 'initdb.exe'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale', '--no-sync'])
  serverMayBeRunning = true
  await command(path.join(pgBin, 'pg_ctl.exe'), ['-D', cluster, '-l', path.join(ownedRoot, 'server.log'),
    '-o', `-h 127.0.0.1 -p ${port} -c max_connections=90 -c logging_collector=off -c shared_preload_libraries=`,
    '-w', '-t', '30', 'start'], '', undefined, true)
  const query = (database, sql, onOutput) => command(path.join(pgBin, 'psql.exe'),
    ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database], sql, onOutput)
  ensure(realpathSync(await query('postgres', "select current_setting('data_directory');")).toLowerCase() === realpathSync(cluster).toLowerCase(), 'server belongs to this fresh cluster')
  await query('postgres', 'create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;')

  for (const database of ['ops6_empty_a', 'ops6_empty_b']) {
    await query('postgres', `create database ${database};`)
    await query(database, sources.bootstrap)
    await query(database, sources.baseline)
    await query(database, sources.ops5)
    await query(database, sources.expand)
    ensure((await query(database, sources.assertions)).endsWith('OPS6_EXPAND_SQL_ASSERTIONS_PASSED'), 'real Expand SQL assertions completed')
    console.log(JSON.stringify({ stage: 'empty_install_and_expand_tests', database, success: true }))
  }

  const db = 'ops6_empty_b'
  const actor = (n) => `51000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const lab = (n) => `61000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const cabinet = (n) => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const photo = (cabinetNumber, photoNumber = cabinetNumber) =>
    `labs/${lab(1)}/cabinets/${cabinet(cabinetNumber)}/81000000-0000-4000-8000-${String(photoNumber).padStart(12, '0')}.webp`
  await query(db, `
    insert into auth.users(id,email) values
      ('${actor(1)}','ops6-race-one@example.invalid'),('${actor(2)}','ops6-race-two@example.invalid');
    insert into public.labs(id,name,created_by) values
      ('${lab(1)}','OPS6 race lab','${actor(1)}'),('${lab(2)}','OPS6 other lab','${actor(2)}');
    insert into public.lab_members(lab_id,user_id,role) values
      ('${lab(1)}','${actor(1)}','admin'),('${lab(2)}','${actor(2)}','admin');
    insert into public.cabinets(id,name,user_id,lab_id)
      select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
        'OPS6 race cabinet '||n,'${actor(1)}','${lab(1)}' from generate_series(1,51) n;
  `)
  const attach = (n) => query(db, `set request.jwt.claims='{"role":"service_role"}';
    select public.set_cabinet_image_path_v1('${actor(1)}','${cabinet(n)}','${photo(n)}',null,'${'a'.repeat(64)}',${1000 + n});`)
  const raced = await Promise.allSettled(Array.from({ length: 51 }, (_, index) => attach(index + 1)))
  ensure(raced.filter((result) => result.status === 'fulfilled').length === 50, 'concurrent cap permits exactly fifty attachments')
  const rejected = raced.filter((result) => result.status === 'rejected')
  ensure(rejected.length === 1 && String(rejected[0].reason).includes('cabinet_image_limit_reached'), 'concurrent 51st attachment is rejected by the database')
  ensure(await query(db, `select count(*) from public.cabinets where lab_id='${lab(1)}' and image_path is not null;`) === '50', 'concurrent cap persists exactly fifty references')
  console.log(JSON.stringify({ stage: 'concurrent_scope_limit', accepted: 50, rejected: 1 }))

  // A single incomplete legacy reference must make Switch fail atomically.
  const legacyCabinet = cabinet(900)
  await query(db, `insert into public.cabinets(id,name,user_id,lab_id,image_url)
    values('${legacyCabinet}','OPS6 incomplete legacy','${actor(1)}','${lab(1)}',
      'https://project.invalid/storage/v1/object/public/cabinets/legacy/incomplete.webp');`)
  let failedSwitch = false
  try { await query(db, sources.switchMigration) } catch (error) {
    failedSwitch = String(error).includes('Referenced public cabinet photos have not all been migrated')
  }
  ensure(failedSwitch, 'Switch refuses an incomplete public-photo backfill')
  ensure(await query(db, `select public::text from storage.buckets where id='cabinets';`) === 'true', 'failed Switch rolls back bucket mutation')
  ensure(await query(db, `select count(*) from pg_constraint where conrelid='public.cabinets'::regclass and conname='cabinets_image_url_private_v1_check';`) === '0', 'failed Switch leaves no partial constraint')

  const legacyPrivate = `labs/${lab(1)}/cabinets/${legacyCabinet}/82000000-0000-4000-8000-000000000900.webp`
  await query(db, `set request.jwt.claims='{"role":"service_role"}';
    select public.migrate_cabinet_image_path_v1('${legacyCabinet}','legacy/incomplete.webp','${legacyPrivate}','${'b'.repeat(64)}',1900);`)
  await query(db, sources.switchMigration)
  ensure(await query(db, `select (not public and file_size_limit=2097152 and allowed_mime_types=array['image/webp']::text[])::text from storage.buckets where id='cabinets';`) === 'true', 'successful Switch makes the bucket private and bounded')
  ensure(await query(db, `select count(*) from pg_policy where polrelid='storage.objects'::regclass and polname in ('Auth Users Insert','Auth Users Update','Auth Users Delete');`) === '0', 'successful Switch removes broad Storage policies')
  ensure(await query(db, `select count(*) from public.cabinets where image_url is not null;`) === '0', 'successful Switch removes public URL fallbacks')
  ensure(await query(db, `select count(*) from pg_constraint where conrelid='public.cabinets'::regclass and conname='cabinets_image_url_private_v1_check' and convalidated;`) === '1', 'successful Switch validates the null-only public URL constraint')

  let browserPathDenied = false
  try {
    await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${actor(1)}"}'; set role authenticated;
      update public.cabinets set image_path='${photo(51,999)}' where id='${cabinet(51)}';`)
  } catch (error) { browserPathDenied = /server managed|permission denied/i.test(String(error)) }
  ensure(browserPathDenied, 'browser cannot plant a private path after Switch')
  let browserUrlDenied = false
  try {
    await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${actor(1)}"}'; set role authenticated;
      update public.cabinets set image_url='https://public.invalid/reopen.webp' where id='${cabinet(51)}';`)
  } catch (error) { browserUrlDenied = /check constraint|violates check/i.test(String(error)) }
  ensure(browserUrlDenied, 'browser cannot restore a public URL after Switch')

  let crossLabDenied = false
  try {
    await query(db, `set request.jwt.claims='{"role":"service_role"}';
      select public.get_cabinet_image_state_v1('${actor(2)}','${cabinet(1)}');`)
  } catch (error) { crossLabDenied = /access denied/i.test(String(error)) }
  ensure(crossLabDenied, 'service RPC refuses a caller from another lab')
  evidence = {
    syntheticOnly: true,
    remoteCalls: 0,
    nativeEmptyInstalls: 2,
    expandSqlSuites: 2,
    concurrencyAccepted: 50,
    concurrencyRejected: 1,
    switchFailClosed: true,
    switchSucceededAfterCompleteBackfill: true,
    postgresArchiveSha256: verified.archiveSha256,
    ops6ExpandSha256: digest(sources.expand),
    ops6SwitchSha256: digest(sources.switchMigration),
    hostedSupabaseAcceptance: false,
  }
} finally {
  if (serverMayBeRunning) {
    await command(path.join(pgBin, 'pg_ctl.exe'), ['-D', cluster, '-m', 'fast', '-w', '-t', '30', 'stop'])
    serverStopped = true
  } else serverStopped = true
  if (ownedRoot && serverStopped) removeOwnedStoppedCluster()
}
console.log(JSON.stringify({ ...evidence, clusterStopped: serverStopped, syntheticDirectoryRemoved: true }))
