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
  throw new Error('Usage (Windows only): node scripts/test-ops8-local-postgres.mjs <reviewed-pgsql-bin> <reviewed-official-zip>')
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
  if (!condition) throw new Error(`OPS8 native assertion failed: ${label}`)
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
    const timer = setTimeout(() => fail(`OPS8 local ${path.basename(executable)} exceeded its 60-second limit`), 60_000)
    child.once('error', () => fail('OPS8 local child failed to start'))
    child.stdin.once('error', () => fail('OPS8 local child input failed'))
    const collect = (target, chunk) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) return fail('OPS8 local output exceeded its limit')
      target.push(chunk)
    }
    child.stdout.on('data', (chunk) => collect(out, chunk))
    child.stderr.on('data', (chunk) => collect(err, chunk))
    child.once(daemonLauncher ? 'exit' : 'close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (daemonLauncher) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy() }
      if (code !== 0) return reject(new Error(`OPS8 local ${path.basename(executable)} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0,3000)}`))
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
    && /^burillab-ops8-native-[a-zA-Z0-9]+$/.test(path.basename(ownedRoot)), 'exact temporary child')
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
  assertions: 'scripts/fixtures/ops8-password-assertions.sql',
}
const sources = Object.fromEntries(Object.entries(sourceFiles).map(([key, relative]) => [
  key, readFileSync(path.join(repository, relative), 'utf8'),
]))
const digest = (value) => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex')
const actor = (n) => `81000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const lab = (n) => `82000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let evidence

try {
  const verified = await verifyPostgresPortableArtifacts({
    pgDumpPath: path.join(pgBin, 'pg_dump.exe'),
    pgRestorePath: path.join(pgBin, 'pg_restore.exe'),
    psqlPath: path.join(pgBin, 'psql.exe'),
    archivePath: archive,
    allowedRoot: path.dirname(archive),
  })
  ownedRoot = realpathSync(mkdtempSync(path.join(realpathSync(os.tmpdir()), 'burillab-ops8-native-')))
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

  for (const [index, database] of ['ops8_empty_a','ops8_empty_b'].entries()) {
    await query('postgres', `create database ${database};`)
    for (const name of ['bootstrap','baseline','ops5','ops6Expand','ops6Switch','ops7']) await query(database, sources[name])
    const legacyOwner = actor(100 + index)
    await query(database, `
      insert into auth.users(id,email) values('${legacyOwner}','ops8-legacy-${index}@example.invalid');
      insert into public.labs(id,name,created_by,join_password)
        values('${lab(100 + index)}','OPS8 Legacy ${index}','${legacyOwner}','short-old');
      insert into public.lab_members(lab_id,user_id,role)
        values('${lab(100 + index)}','${legacyOwner}','admin');
    `)
    const beforeHash = await query(database, `select join_password_hash from public.labs where id='${lab(100 + index)}';`)
    await query(database, sources.ops8)
    ensure((await query(database, sources.assertions)).endsWith('OPS8_PASSWORD_SQL_ASSERTIONS_PASSED'),
      'password-policy catalog assertions completed')
    const after = await query(database, `select join_password_needs_change||'|'||(join_password_hash='${beforeHash}') from public.labs where id='${lab(100 + index)}';`)
    ensure(after === 'true|true', 'existing password remains unchanged and is marked for replacement')
    console.log(JSON.stringify({ stage: 'empty_install_and_policy_tests', database, success: true }))
  }

  const db = 'ops8_empty_b'
  const owner = actor(1)
  const legacyLab = lab(101)
  await query(db, `insert into auth.users(id,email) values
    ('${owner}','ops8-owner@example.invalid'),
    ('${actor(2)}','ops8-member-2@example.invalid'),
    ('${actor(3)}','ops8-member-3@example.invalid'),
    ('${actor(4)}','ops8-member-4@example.invalid'),
    ('${actor(5)}','ops8-member-5@example.invalid');`)

  const legacyJoined = await query(db, `set request.jwt.claims='{"role":"service_role"}'; set role service_role;
    select public.join_lab_server_v1('${actor(2)}','${legacyLab}','short-old','${'a'.repeat(64)}','${'b'.repeat(64)}')->>'success';`)
  ensure(legacyJoined === 'true', 'pre-Ops8 short password still joins')

  const shortCode = await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.create_lab_secure('OPS8 New Lab','too-short','owner',null,null,null)->>'code';`)
  ensure(shortCode === 'lab_password_length', 'short new password is rejected')
  const commonCode = await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.create_lab_secure('OPS8 New Lab','Password-1234!','owner',null,null,null)->>'code';`)
  ensure(commonCode === 'lab_password_common', 'common new password is rejected')
  const nameCode = await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.create_lab_secure('Alpha Lab','Safe-Alpha-Lab-2026!','owner',null,null,null)->>'code';`)
  ensure(nameCode === 'lab_password_contains_lab_name', 'lab-name password is rejected')
  const koreanNameCode = await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.create_lab_secure('합성 연구실','2026!합성연구실!safe','owner',null,null,null)->>'code';`)
  ensure(koreanNameCode === 'lab_password_contains_lab_name', 'spaced Korean lab-name password is rejected')

  const createResult = await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.create_lab_secure('OPS8 New Lab','Strong-phrase-2026!','owner',null,null,null)->>'lab_id';`)
  ensure(/^[0-9a-f-]{36}$/.test(createResult), 'strong password creates a lab')
  const newLab = createResult
  const hashState = await query(db, `select left(join_password_hash,7)||'|'||join_password_needs_change from public.labs where id='${newLab}';`)
  ensure(hashState === 'sha256$|false', 'new password uses full-input prehash and clears warning')

  async function rejected(sql, pattern, label) {
    try { await query(db, sql) } catch (error) {
      if (pattern.test(String(error))) return
      throw error
    }
    throw new Error(`OPS8 native assertion failed: ${label}`)
  }

  await rejected(`set request.jwt.claims='{"role":"authenticated","sub":"${actor(3)}"}'; set role authenticated;
    select public.set_lab_join_password('${newLab}','Unauthorized-safe-2026!');`, /Only lab admins/i,
  'non-admin password change is denied')
  await rejected(`set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.set_lab_join_password('${newLab}','${'x'.repeat(129)}');`, /lab_password_length/i,
  'password longer than 128 is rejected')
  await rejected(`set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    update public.labs set join_password_hash='forged' where id='${newLab}';`, /Use set_lab_join_password/i,
  'direct password-hash rewrite is denied')
  await rejected(`set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    update public.labs set join_password_needs_change=true where id='${newLab}';`, /server managed/i,
  'direct replacement-state rewrite is denied')

  await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.set_lab_join_password('${newLab}','Another-safe-phrase-2026!');`)
  const changedJoined = await query(db, `set request.jwt.claims='{"role":"service_role"}'; set role service_role;
    select public.join_lab_server_v1('${actor(3)}','${newLab}','Another-safe-phrase-2026!','${'c'.repeat(64)}','${'d'.repeat(64)}')->>'success';`)
  ensure(changedJoined === 'true', 'changed sha256-prefixed password joins')

  await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    update public.labs set name='OPS8 Renamed Lab' where id='${newLab}';`)
  ensure(await query(db, `select join_password_needs_change::text from public.labs where id='${newLab}';`) === 'true',
    'renaming a protected lab requests a password replacement')
  const afterRenameJoined = await query(db, `set request.jwt.claims='{"role":"service_role"}'; set role service_role;
    select public.join_lab_server_v1('${actor(4)}','${newLab}','Another-safe-phrase-2026!','${'e'.repeat(64)}','${'f'.repeat(64)}')->>'success';`)
  ensure(afterRenameJoined === 'true', 'rename warning does not break the existing password')

  const maxPassword = 'x'.repeat(128)
  await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.set_lab_join_password('${newLab}','${maxPassword}');`)
  ensure(await query(db, `select join_password_needs_change::text from public.labs where id='${newLab}';`) === 'false',
    'a valid 128-character replacement clears the warning')
  const maxJoined = await query(db, `set request.jwt.claims='{"role":"service_role"}'; set role service_role;
    select public.join_lab_server_v1('${actor(5)}','${newLab}','${maxPassword}','${'1'.repeat(64)}','${'2'.repeat(64)}')->>'success';`)
  ensure(maxJoined === 'true', 'all 128 password characters are verified')

  await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.set_lab_join_password('${newLab}',null);`)
  ensure(await query(db, `select (join_password_hash is null)||'|'||join_password_needs_change from public.labs where id='${newLab}';`) === 'true|false',
    'removing a password clears both the hash and warning')

  evidence = {
    syntheticOnly: true,
    remoteCalls: 0,
    nativeEmptyInstalls: 2,
    existingShortPasswordPreserved: true,
    newAndChangedPolicyEnforced: true,
    sha256PrefixedBcryptVerified: true,
    directPolicyTamperingDenied: true,
    hostedSupabaseAcceptance: false,
    postgresArchiveSha256: verified.archiveSha256,
    ops8MigrationSha256: digest(sources.ops8),
  }
} finally {
  if (serverMayBeRunning) {
    await command(path.join(pgBin, 'pg_ctl.exe'), ['-D',cluster,'-m','fast','-w','-t','30','stop'])
    serverStopped = true
  } else serverStopped = true
  if (ownedRoot && serverStopped) removeOwnedStoppedCluster()
}

console.log(JSON.stringify({ ...evidence, clusterStopped: serverStopped, syntheticDirectoryRemoved: true }))
