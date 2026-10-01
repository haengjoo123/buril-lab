import { spawn } from 'node:child_process'
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyPostgresPortableArtifacts } from './verify-supabase-recovery-preflight.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [selectedBin, selectedArchive, ...extra] = process.argv.slice(2)
if (process.platform !== 'win32' || !selectedBin || !selectedArchive || extra.length) {
  throw new Error('Usage (Windows only): node scripts/test-cabinet-local-postgres.mjs <reviewed-pgsql-bin> <reviewed-official-zip>')
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
  if (!condition) throw new Error(`CABINET native assertion failed: ${label}`)
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
    const timer = setTimeout(() => fail(`CABINET local ${path.basename(executable)} exceeded its 60-second limit`), 60_000)
    child.once('error', () => fail('CABINET local child failed to start'))
    child.stdin.once('error', () => fail('CABINET local child input failed'))
    const collect = (target, chunk) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) return fail('CABINET local output exceeded its limit')
      target.push(chunk)
    }
    child.stdout.on('data', (chunk) => collect(out, chunk))
    child.stderr.on('data', (chunk) => collect(err, chunk))
    child.once(daemonLauncher ? 'exit' : 'close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (daemonLauncher) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy() }
      if (code !== 0) return reject(new Error(`CABINET local ${path.basename(executable)} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0,3000)}`))
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
    && /^burillab-cabinet-native-[a-zA-Z0-9]+$/.test(path.basename(ownedRoot)), 'exact temporary child')
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


try {
  await verifyPostgresPortableArtifacts({ pgDumpPath: path.join(pgBin, 'pg_dump.exe'), pgRestorePath: path.join(pgBin, 'pg_restore.exe'), psqlPath: path.join(pgBin, 'psql.exe'), archivePath: archive, allowedRoot: path.dirname(archive) })
  ownedRoot = realpathSync(mkdtempSync(path.join(realpathSync(os.tmpdir()), 'burillab-cabinet-native-')))
  cluster = path.join(ownedRoot,'data')
  const port = await availableLoopbackPort()
  await command(path.join(pgBin,'initdb.exe'), ['-D',cluster,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale','--no-sync'])
  serverMayBeRunning = true
  await command(path.join(pgBin,'pg_ctl.exe'), ['-D',cluster,'-l',path.join(ownedRoot,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -c logging_collector=off`,'-w','-t','30','start'], '', true)
  const query = sql => command(path.join(pgBin,'psql.exe'), ['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres'], sql)
  await query('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;')
  await query(readFileSync(path.join(repository,'scripts/fixtures/ops5-local-bootstrap.sql'),'utf8'))
  for (const file of readdirSync(path.join(repository,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) {
    await query(readFileSync(path.join(repository,'supabase/migrations',file),'utf8'))
  }
  console.log(await query(`select jsonb_build_object(
    'publicTables',count(*),'rlsTables',count(*) filter (where c.relrowsecurity),
    'anonTableGrants',count(*) filter (where exists(select 1 from pg_catalog.aclexplode(c.relacl) acl join pg_catalog.pg_roles r on r.oid=acl.grantee where r.rolname='anon')),
    'authenticatedTableGrants',count(*) filter (where exists(select 1 from pg_catalog.aclexplode(c.relacl) acl join pg_catalog.pg_roles r on r.oid=acl.grantee where r.rolname='authenticated')),
    'serviceRoleTableGrants',count(*) filter (where exists(select 1 from pg_catalog.aclexplode(c.relacl) acl join pg_catalog.pg_roles r on r.oid=acl.grantee where r.rolname='service_role'))
  ) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p');`))
  console.log(await query(readFileSync(path.join(repository,'scripts/fixtures/cabinet-trash-assertions.sql'),'utf8')))
} finally {
  if (serverMayBeRunning) { await command(path.join(pgBin,'pg_ctl.exe'), ['-D',cluster,'-m','fast','-w','-t','30','stop']); serverStopped=true }
  else serverStopped=true
  if (ownedRoot && serverStopped) removeOwnedStoppedCluster()
}
