import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyPostgresPortableArtifacts } from './verify-supabase-recovery-preflight.mjs'

// This command has no database URL/host/credential option. It starts its own
// verified, disposable PostgreSQL, asserts its data directory, then uses only
// newly created databases. Native checks are NOT hosted Supabase acceptance.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [selectedBin, selectedArchive, ...extra] = process.argv.slice(2)
if (process.platform !== 'win32' || !selectedBin || !selectedArchive || extra.length) {
  throw new Error('Usage (Windows only): node scripts/test-ops5-local-postgres.mjs <reviewed-pgsql-bin> <reviewed-official-zip>')
}
const pgBin = realpathSync(selectedBin)
const archive = realpathSync(selectedArchive)
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['systemroot', 'windir', 'temp', 'tmp', 'userprofile', 'homedrive', 'homepath', 'appdata', 'localappdata'].includes(key.toLowerCase())))
cleanEnvironment.Path = `${pgBin};C:\\Windows\\System32;C:\\Windows`
cleanEnvironment.ComSpec = 'C:\\Windows\\System32\\cmd.exe'
cleanEnvironment.PGCLIENTENCODING = 'UTF8'
cleanEnvironment.PGCONNECT_TIMEOUT = '5'
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
let ownedRoot
let cluster
let serverMayBeRunning = false
let serverStopped = false

function command(executable, args, input = '', onOutput, daemonLauncher = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: repository, env: cleanEnvironment,
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const out = [], err = []
    let size = 0, settled = false
    const fail = (message) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      reject(new Error(`${message}: ${Buffer.concat([...out, ...err]).toString('utf8').slice(-1800)}`))
    }
    const timer = setTimeout(() => fail(`OPS5 local ${path.basename(executable)} exceeded its 45-second limit`), 45_000)
    child.once('error', () => fail('OPS5 local child failed to start'))
    child.stdin.once('error', () => fail('OPS5 local child input failed'))
    const collect = (target, chunk) => {
      size += chunk.length
      if (size > 3 * 1024 * 1024) return fail('OPS5 local output exceeded its limit')
      target.push(chunk)
      if (target === out) onOutput?.(chunk.toString('utf8'))
    }
    child.stdout.on('data', (chunk) => collect(out, chunk))
    child.stderr.on('data', (chunk) => collect(err, chunk))
    // On Windows the background server can inherit a launcher pipe. pg_ctl -w
    // has already verified startup when it exits; waiting for pipe closure here
    // would instead wait for the whole database server to exit.
    child.once(daemonLauncher ? 'exit' : 'close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (daemonLauncher) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy() }
      if (code !== 0) return reject(new Error(`OPS5 local ${path.basename(executable)} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 2400)}`))
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
  if (!condition) throw new Error(`OPS5 native assertion failed: ${label}`)
}

function removeOwnedStoppedCluster() {
  // Resolve the exact minted directory and inspect every entry before recursive
  // deletion. Never follow a junction, use an environment root, or remove a
  // cluster that might still be running. All contents are synthetic test data.
  ensure(serverStopped && ownedRoot && realpathSync(ownedRoot) === ownedRoot, 'stopped owned directory')
  ensure(path.dirname(ownedRoot) === realpathSync(os.tmpdir()) && /^burillab-ops5-native-[a-zA-Z0-9]+$/.test(path.basename(ownedRoot)), 'exact temporary child')
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

const baselinePath = path.join(repository, 'supabase/migrations/20260824000000_production_baseline.sql')
const migrationPath = path.join(repository, 'supabase/migrations/20260903162850_ops5_expand_server_join.sql')
const bootstrap = readFileSync(path.join(repository, 'scripts/fixtures/ops5-local-bootstrap.sql'), 'utf8')
const assertions = readFileSync(path.join(repository, 'scripts/fixtures/ops5-join-assertions.sql'), 'utf8')
const baseline = readFileSync(baselinePath, 'utf8')
const migration = readFileSync(migrationPath, 'utf8')
const digest = (text) => createHash('sha256').update(text).digest('hex')
let evidence
try {
  const verified = await verifyPostgresPortableArtifacts({
    pgDumpPath: path.join(pgBin, 'pg_dump.exe'), pgRestorePath: path.join(pgBin, 'pg_restore.exe'),
    psqlPath: path.join(pgBin, 'psql.exe'), archivePath: archive, allowedRoot: path.dirname(archive),
  })
  // The existing verifier covers all 69 bin files. Verify runtime libraries and
  // initialization/extension SQL against the same pinned archive as well.
  const encodedPaths = Buffer.from(JSON.stringify([archive, path.dirname(pgBin)]), 'utf8').toString('base64')
  const runtimeAssetScript = `
$ErrorActionPreference = 'Stop'
$paths = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPaths}')) | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($paths[0])
try {
  $count = 0
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName -notmatch '^pgsql/(lib/[^/]+[.]dll|share/.*[.](sql|bki|control))$') { continue }
    $relative = $entry.FullName.Substring(6).Replace('/', [IO.Path]::DirectorySeparatorChar)
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($paths[1], $relative))
    if (-not $target.StartsWith($paths[1] + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Library path escaped' }
    $item = Get-Item -LiteralPath $target -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Library path is not regular' }
    $a = $entry.Open(); $b = [IO.File]::OpenRead($target); $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $left = [Convert]::ToBase64String($sha.ComputeHash($a)); $right = [Convert]::ToBase64String($sha.ComputeHash($b))
      if ($left -ne $right -or $item.Length -ne $entry.Length) { throw 'Runtime library or SQL differs from archive' }
    } finally { $a.Dispose(); $b.Dispose(); $sha.Dispose() }
    $count++
  }
  if ($count -lt 10) { throw 'Incomplete runtime verification' }
  'OPS5_RUNTIME_ASSETS_VERIFIED'
} finally { $zip.Dispose() }
`
  const runtimeAssets = await command(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive',
    '-EncodedCommand', Buffer.from(runtimeAssetScript, 'utf16le').toString('base64')])
  ensure(runtimeAssets === 'OPS5_RUNTIME_ASSETS_VERIFIED', 'runtime assets were verified completely')
  console.log(JSON.stringify({ stage: 'verified_official_postgres', binFiles: verified.binManifest.length }))
  ownedRoot = realpathSync(mkdtempSync(path.join(realpathSync(os.tmpdir()), 'burillab-ops5-native-')))
  cluster = path.join(ownedRoot, 'data')
  const port = await availableLoopbackPort()
  // This cluster is discarded after SQL semantics tests, not durability tests.
  await command(path.join(pgBin, 'initdb.exe'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale', '--no-sync'])
  console.log(JSON.stringify({ stage: 'initialized_disposable_cluster' }))
  serverMayBeRunning = true
  await command(path.join(pgBin, 'pg_ctl.exe'), ['-D', cluster, '-l', path.join(ownedRoot, 'server.log'),
    '-o', `-h 127.0.0.1 -p ${port} -c max_connections=50 -c logging_collector=off -c shared_preload_libraries=`, '-w', '-t', '30', 'start'], '', undefined, true)
  console.log(JSON.stringify({ stage: 'started_disposable_cluster' }))
  const query = (database, sql, onOutput) => command(path.join(pgBin, 'psql.exe'),
    ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database], sql, onOutput)
  const expectedCluster = realpathSync(cluster).toLowerCase()
  ensure(realpathSync(await query('postgres', "select current_setting('data_directory');")).toLowerCase() === expectedCluster, 'server belongs to this fresh cluster')
  await query('postgres', 'create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;')
  const legacyFingerprint = `select md5(string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text,''), E'\\n' order by p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
      and p.prokind='f' and not (
        (n.nspname='public' and p.proname in ('join_lab_server_v1','record_cabinet_activity_v2'))
        or (n.nspname='private' and p.proname='guard_cabinet_image_path_v1')
      );`
  for (const database of ['ops5_empty_a', 'ops5_empty_b']) {
    await query('postgres', `create database ${database};`)
    await query(database, bootstrap)
    await query(database, baseline)
    const before = await query(database, legacyFingerprint)
    await query(database, migration)
    ensure(await query(database, legacyFingerprint) === before, 'legacy function bodies/configuration/ACL unchanged')
    ensure((await query(database, assertions)).endsWith('OPS5_SQL_ASSERTIONS_PASSED'), 'real SQL assertions completed')
    console.log(JSON.stringify({ stage: 'empty_install_and_sql_tests', database, success: true }))
  }

  const db = 'ops5_empty_b'
  const actor = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const lab = (n) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const subject = (n) => digest(String(n))
  await query(db, `insert into auth.users(id,email) select ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    'concurrent-synthetic-'||n||'@example.invalid' from generate_series(1,100) n;
    insert into public.labs(id,name,join_password) select ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    'OPS5 concurrency '||n,'Synthetic#JoinSafe' from generate_series(1,8) n;`)
  const join = async (user, labNumber, ip, password = 'wrong') => JSON.parse(await query(db,
    `set request.jwt.claims='{"role":"service_role"}'; set role service_role;
     select public.join_lab_server_v1('${actor(user)}','${lab(labNumber)}','${password}','${subject(user)}','${subject(ip)}');`))
  const sameUser = await Promise.all(Array.from({ length: 12 }, () => join(1, 1, 1000)))
  ensure(sameUser.filter((r) => r.code === 'incorrect_password').length === 4 && sameUser.filter((r) => r.code === 'join_locked').length === 8, 'concurrent user threshold is exactly five')
  ensure(await query(db, `select cardinality(failure_times) from private.lab_join_attempts_v1 where lab_id='${lab(1)}' and subject_type='user';`) === '5', 'concurrent failed attempts do not overcount')
  const sameIp = await Promise.all(Array.from({ length: 25 }, (_, i) => join(10 + i, 2, 2000)))
  ensure(sameIp.filter((r) => r.code === 'incorrect_password').length === 19 && sameIp.filter((r) => r.code === 'join_locked').length === 6, 'concurrent shared IP threshold is exactly twenty')
  ensure(await query(db, `select cardinality(failure_times) from private.lab_join_attempts_v1 where lab_id='${lab(2)}' and subject_type='ip';`) === '20', 'shared IP cannot exceed twenty failures')

  // Race duplicate joins at the third membership boundary.
  await query(db, `insert into public.lab_members(lab_id,user_id,role) values
    ('${lab(3)}','${actor(40)}','student'),('${lab(4)}','${actor(40)}','student');`)
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => join(40, 5, 3000, 'Synthetic#JoinSafe')))
  ensure(duplicates.filter((r) => r.success === true).length === 1 && duplicates.filter((r) => r.code === 'already_member').length === 7, 'concurrent duplicates are not misreported as membership cap')

  // The row lock outlives an active account lock. The waiting join must compare
  // against the clock AFTER acquiring that row, not its request start time.
  await query(db, `insert into private.lab_join_attempts_v1(lab_id,subject_type,subject_hash)
    values('${lab(6)}','ip','${subject(4000)}'),('${lab(6)}','user','${subject(50)}');`)
  let signalReady
  const ready = new Promise((resolve) => { signalReady = resolve })
  let output = ''
  const holder = query(db, `begin;
    update private.lab_join_attempts_v1 set locked_until=clock_timestamp()+interval '1 second'
      where lab_id='${lab(6)}' and subject_type='user';
    select 'OPS5_LOCK_HELD'; select pg_sleep(1.3); commit;`, (text) => {
    output += text
    if (output.includes('OPS5_LOCK_HELD')) signalReady()
  })
  await Promise.race([ready, holder.then(() => { throw new Error('Lock holder did not signal readiness') })])
  const afterWait = await join(50, 6, 4000, 'Synthetic#JoinSafe')
  await holder
  ensure(afterWait.success === true, 'lock expiry uses current time after waiting')
  evidence = { syntheticOnly: true, remoteCalls: 0, nativeEmptyInstalls: 2, sqlSuites: 2, concurrencyScenarios: 4,
    postgresArchiveSha256: verified.archiveSha256, baselineSha256: digest(baseline), migrationSha256: digest(migration),
    hostedSupabaseAcceptance: false }
} finally {
  if (serverMayBeRunning) {
    await command(path.join(pgBin, 'pg_ctl.exe'), ['-D', cluster, '-m', 'fast', '-w', '-t', '30', 'stop'])
    serverStopped = true
  } else serverStopped = true
  if (ownedRoot && serverStopped) removeOwnedStoppedCluster()
}
console.log(JSON.stringify({ ...evidence, clusterStopped: serverStopped, syntheticDirectoryRemoved: true }))
