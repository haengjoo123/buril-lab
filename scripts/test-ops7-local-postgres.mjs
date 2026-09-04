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
  throw new Error('Usage (Windows only): node scripts/test-ops7-local-postgres.mjs <reviewed-pgsql-bin> <reviewed-official-zip>')
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
  if (!condition) throw new Error(`OPS7 native assertion failed: ${label}`)
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
      reject(new Error(`${message}: ${Buffer.concat([...out,...err]).toString('utf8').slice(-2400)}`))
    }
    const timer = setTimeout(() => fail(`OPS7 local ${path.basename(executable)} exceeded its 60-second limit`), 60_000)
    child.once('error', () => fail('OPS7 local child failed to start'))
    child.stdin.once('error', () => fail('OPS7 local child input failed'))
    const collect = (target, chunk) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) return fail('OPS7 local output exceeded its limit')
      target.push(chunk)
    }
    child.stdout.on('data', (chunk) => collect(out, chunk))
    child.stderr.on('data', (chunk) => collect(err, chunk))
    child.once(daemonLauncher ? 'exit' : 'close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (daemonLauncher) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy() }
      if (code !== 0) return reject(new Error(`OPS7 local ${path.basename(executable)} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0,3000)}`))
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
    && /^burillab-ops7-native-[a-zA-Z0-9]+$/.test(path.basename(ownedRoot)), 'exact temporary child')
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
  assertions: 'scripts/fixtures/ops7-contract-assertions.sql',
}
const sources = Object.fromEntries(Object.entries(sourceFiles).map(([key, relative]) => [
  key, readFileSync(path.join(repository, relative), 'utf8'),
]))
const digest = (value) => createHash('sha256').update(value).digest('hex')
let evidence

try {
  const verified = await verifyPostgresPortableArtifacts({
    pgDumpPath: path.join(pgBin, 'pg_dump.exe'),
    pgRestorePath: path.join(pgBin, 'pg_restore.exe'),
    psqlPath: path.join(pgBin, 'psql.exe'),
    archivePath: archive,
    allowedRoot: path.dirname(archive),
  })
  ownedRoot = realpathSync(mkdtempSync(path.join(realpathSync(os.tmpdir()), 'burillab-ops7-native-')))
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

  for (const database of ['ops7_empty_a','ops7_empty_b']) {
    await query('postgres', `create database ${database};`)
    for (const name of ['bootstrap','baseline','ops5','ops6Expand','ops6Switch','ops7']) {
      await query(database, sources[name])
    }
    ensure((await query(database, sources.assertions)).endsWith('OPS7_CONTRACT_SQL_ASSERTIONS_PASSED'),
      'Contract catalog assertions completed')
    console.log(JSON.stringify({ stage: 'empty_install_and_contract_tests', database, success: true }))
  }

  const db = 'ops7_empty_b'
  const owner = '91000000-0000-4000-8000-000000000001'
  const member = '91000000-0000-4000-8000-000000000002'
  const lab = '92000000-0000-4000-8000-000000000001'
  const cabinet = '93000000-0000-4000-8000-000000000001'
  await query(db, `
    insert into auth.users(id,email) values
      ('${owner}','ops7-owner@example.invalid'),('${member}','ops7-member@example.invalid');
    insert into public.labs(id,name,created_by) values('${lab}','OPS7 contract lab','${owner}');
    insert into public.lab_members(lab_id,user_id,role) values('${lab}','${owner}','admin');
    insert into public.cabinets(id,name,user_id,lab_id) values('${cabinet}','OPS7 cabinet','${owner}','${lab}');
  `)

  const joined = await query(db, `set request.jwt.claims='{"role":"service_role"}'; set role service_role;
    select public.join_lab_server_v1('${member}','${lab}','','${'a'.repeat(64)}','${'b'.repeat(64)}')->>'success';`)
  ensure(joined === 'true', 'new server join remains functional')

  async function denied(sql, label) {
    try { await query(db, sql) } catch (error) {
      if (/permission denied/i.test(String(error))) return
      throw error
    }
    throw new Error(`OPS7 native assertion failed: ${label}`)
  }
  await denied(`set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.join_lab('${lab}','',null);`, 'legacy browser join is denied')
  await denied(`set request.jwt.claims='{"role":"service_role"}'; set role service_role;
    select public.join_lab_with_password('${lab}','${member}','student','',null);`, 'legacy service join helper is denied')
  await denied(`set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.insert_audit_log_rpc('${owner}','forged','${lab}','forged','${cabinet}',
      'create',null,null,null,null,'ui',null);`, 'generic audit writer is denied')

  const activity = await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select public.record_cabinet_activity_v2('${cabinet}','update','OPS7 safe activity',null,null,null)->>'success';`)
  ensure(activity === 'true', 'bounded activity and audit insert remains functional')
  const visible = await query(db, `set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    select count(*) from public.audit_logs where lab_id='${lab}';`)
  ensure(Number(visible) >= 1, 'tenant-scoped audit read remains functional')
  await denied(`set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    insert into public.audit_logs(actor_user_id,lab_id,entity_type,entity_id,action,source)
      values('${owner}','${lab}','forged','${cabinet}','create','ui');`, 'direct audit insert is denied')
  await denied(`set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    update public.audit_logs set action='delete' where lab_id='${lab}';`, 'direct audit update is denied')
  await denied(`set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}'; set role authenticated;
    delete from public.audit_logs where lab_id='${lab}';`, 'direct audit delete is denied')

  evidence = {
    syntheticOnly: true,
    remoteCalls: 0,
    nativeEmptyInstalls: 2,
    legacyJoinDenied: true,
    genericAuditRpcDenied: true,
    directAuditWritesDenied: true,
    boundedServerJoinSucceeded: true,
    boundedActivitySucceeded: true,
    postgresArchiveSha256: verified.archiveSha256,
    ops7MigrationSha256: digest(sources.ops7),
    hostedSupabaseAcceptance: false,
  }
} finally {
  if (serverMayBeRunning) {
    await command(path.join(pgBin, 'pg_ctl.exe'), ['-D',cluster,'-m','fast','-w','-t','30','stop'])
    serverStopped = true
  } else serverStopped = true
  if (ownedRoot && serverStopped) removeOwnedStoppedCluster()
}

console.log(JSON.stringify({ ...evidence, clusterStopped: serverStopped, syntheticDirectoryRemoved: true }))
