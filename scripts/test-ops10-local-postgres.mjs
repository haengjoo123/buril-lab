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
  throw new Error('Usage (Windows only): node scripts/test-ops10-local-postgres.mjs <reviewed-pgsql-bin> <reviewed-official-zip>')
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
  if (!condition) throw new Error(`OPS10 native assertion failed: ${label}`)
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
    const timer = setTimeout(() => fail(`OPS10 local ${path.basename(executable)} exceeded its 60-second limit`), 60_000)
    child.once('error', () => fail('OPS10 local child failed to start'))
    child.stdin.once('error', () => fail('OPS10 local child input failed'))
    const collect = (target, chunk) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) return fail('OPS10 local output exceeded its limit')
      target.push(chunk)
    }
    child.stdout.on('data', (chunk) => collect(out, chunk))
    child.stderr.on('data', (chunk) => collect(err, chunk))
    child.once(daemonLauncher ? 'exit' : 'close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (daemonLauncher) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy() }
      if (code !== 0) return reject(new Error(`OPS10 local ${path.basename(executable)} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0,3000)}`))
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
    && /^burillab-ops10-native-[a-zA-Z0-9]+$/.test(path.basename(ownedRoot)), 'exact temporary child')
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
  assertions: 'scripts/fixtures/ops10-operator-assertions.sql',
}
const sources = Object.fromEntries(Object.entries(sourceFiles).map(([key, relative]) => [
  key, readFileSync(path.join(repository, relative), 'utf8'),
]))
const digest = (value) => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex')
const user = (n) => `a1000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const requestId = (n) => `a2000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const item = (n) => `a3000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let evidence

try {
  const verified = await verifyPostgresPortableArtifacts({
    pgDumpPath: path.join(pgBin, 'pg_dump.exe'),
    pgRestorePath: path.join(pgBin, 'pg_restore.exe'),
    psqlPath: path.join(pgBin, 'psql.exe'),
    archivePath: archive,
    allowedRoot: path.dirname(archive),
  })
  ownedRoot = realpathSync(mkdtempSync(path.join(realpathSync(os.tmpdir()), 'burillab-ops10-native-')))
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

  for (const database of ['ops10_empty_a','ops10_empty_b']) {
    await query('postgres', `create database ${database};`)
    for (const name of ['bootstrap','baseline','ops5','ops6Expand','ops6Switch','ops7','ops8','ops9','ops10']) {
      await query(database, sources[name])
    }
    ensure((await query(database, sources.assertions)).endsWith('OPS10_OPERATOR_SQL_ASSERTIONS_PASSED'),
      'operator catalog assertions completed')
    console.log(JSON.stringify({ stage: 'empty_install_and_permission_tests', database, success: true }))
  }

  const db = 'ops10_empty_b'
  const operator = user(1)
  const unassigned = user(2)
  const expired = user(3)
  await query(db, `insert into auth.users(id,email) values
    ('${operator}','ops10-operator@example.invalid'),
    ('${unassigned}','ops10-unassigned@example.invalid'),
    ('${expired}','ops10-expired@example.invalid');
    insert into public.feedback(id,type,message,status) values('${item(1)}','general','synthetic','new');`)
  const service = (sql) => `set request.jwt.claims='{"role":"service_role"}'; set role service_role; ${sql}`
  async function rejected(sql, pattern, label) {
    try { await query(db, sql) } catch (error) {
      if (pattern.test(String(error))) return
      throw error
    }
    throw new Error(`OPS10 native assertion failed: ${label}`)
  }

  for (const [index, role] of ['reader','approver','raw_exporter'].entries()) {
    const result = JSON.parse(await query(db, service(`select public.set_operator_role_v1(
      '${operator}','${role}',true,'${operator}','${requestId(10 + index)}','INITIAL_PROVISION')::text;`)))
    ensure(result.success === true && result.role === role && result.enabled === true, `${role} is provisioned`)
  }
  await query(db, service(`select public.set_operator_role_v1(
    '${expired}','reader',true,'${operator}','${requestId(20)}','INITIAL_PROVISION');`))
  await query(db, `update private.operator_role_assignments_v1 set
    reviewed_at=clock_timestamp()-interval '32 days', review_due_at=clock_timestamp()-interval '1 day'
    where user_id='${expired}' and role='reader';`)

  const mfaDenied = JSON.parse(await query(db, service(`select public.authorize_operator_action_v1(
    '${operator}','reader','analytics.summary','analytics_summary',null,'${requestId(1)}','aal1')::text;`)))
  ensure(mfaDenied.success === false && mfaDenied.code === 'mfa_required', 'AAL1 is denied')
  const authorized = JSON.parse(await query(db, service(`select public.authorize_operator_action_v1(
    '${operator}','reader','analytics.summary','analytics_summary',null,'${requestId(2)}','aal2')::text;`)))
  ensure(authorized.success === true && authorized.role === 'reader', 'AAL2 reader is authorized')
  const noRole = JSON.parse(await query(db, service(`select public.authorize_operator_action_v1(
    '${unassigned}','reader','analytics.summary','analytics_summary',null,'${requestId(3)}','aal2')::text;`)))
  ensure(noRole.success === false && noRole.code === 'operator_role_required', 'unassigned operator is denied')
  const reviewDue = JSON.parse(await query(db, service(`select public.authorize_operator_action_v1(
    '${expired}','reader','analytics.summary','analytics_summary',null,'${requestId(4)}','aal2')::text;`)))
  ensure(reviewDue.success === false && reviewDue.code === 'operator_review_required', 'expired monthly review is denied')
  const fallbackMfa = JSON.parse(await query(db, service(`select public.authorize_operator_fallback_v1(
    '${operator}','reader','analytics.summary','analytics_summary','${requestId(5)}','aal1')::text;`)))
  ensure(fallbackMfa.success === false && fallbackMfa.code === 'mfa_required', 'fallback still requires MFA')
  const fallback = JSON.parse(await query(db, service(`select public.authorize_operator_fallback_v1(
    '${operator}','reader','analytics.summary','analytics_summary','${requestId(6)}','aal2')::text;`)))
  ensure(fallback.success === true, 'explicit AAL2 fallback is audited')

  await rejected(service(`select public.authorize_operator_action_v1(
    '${operator}','reader','unreviewed.action','analytics_summary',null,'${requestId(7)}','aal2');`),
  /Unreviewed operator action mapping/i, 'unreviewed action is rejected')
  await rejected(`set request.jwt.claims='{"role":"authenticated","sub":"${operator}"}'; set role authenticated;
    select public.authorize_operator_action_v1('${operator}','reader','analytics.summary','analytics_summary',null,'${requestId(8)}','aal2');`,
  /permission denied/i, 'authenticated role cannot call service RPC')
  await rejected(service('select * from private.operator_role_assignments_v1;'),
    /permission denied/i, 'service role cannot read role table directly')

  const statusResult = JSON.parse(await query(db, service(`select public.operator_feedback_status_v1(
    '${operator}','${item(1)}','resolved','${requestId(30)}','aal2')::text;`)))
  ensure(statusResult.success === true && statusResult.item.status === 'resolved', 'atomic feedback mutation succeeds')
  ensure(await query(db, `select count(*) from private.operator_action_audit_v1
    where request_id='${requestId(30)}' and outcome='succeeded';`) === '1', 'successful mutation audit is appended')

  await query(db, `update public.feedback set status='new',resolved_at=null,resolved_by=null where id='${item(1)}';
    insert into private.operator_action_audit_v1(
      request_id,actor_user_id,role,action,resource_type,resource_id,outcome,assurance_level
    ) values('${requestId(31)}','${operator}','approver','feedback.status','feedback',null,'succeeded','aal2');`)
  await rejected(service(`select public.operator_feedback_status_v1(
    '${operator}','${item(1)}','resolved','${requestId(31)}','aal2');`),
  /already bound/i, 'audit conflict fails the entire mutation')
  ensure(await query(db, `select status from public.feedback where id='${item(1)}';`) === 'new',
    'failed audit rolls back the data mutation')

  await rejected(`update private.operator_action_audit_v1 set reason_code='FORGED' where request_id='${requestId(2)}';`,
    /append only/i, 'operator audit update is denied')
  await rejected(`delete from private.operator_action_audit_v1 where request_id='${requestId(2)}';`,
    /append only/i, 'operator audit delete is denied')
  await rejected('truncate private.operator_action_audit_v1;', /append only/i, 'operator audit truncate is denied')

  ensure(await query(db, `select count(*) from private.operator_action_audit_v1
    where outcome='denied' and reason_code in ('MFA_REQUIRED','OPERATOR_ROLE_REQUIRED','OPERATOR_REVIEW_REQUIRED');`) === '4',
  'MFA, role, review and fallback denials are all audited')

  evidence = {
    syntheticOnly: true,
    remoteCalls: 0,
    nativeEmptyInstalls: 2,
    serverRoles: ['reader','approver','raw_exporter'],
    aal1Denied: true,
    aal2Authorized: true,
    monthlyReviewEnforced: true,
    emergencyFallbackRequiresAal2: true,
    auditAppendOnly: true,
    auditFailureRollsBackMutation: true,
    hostedSupabaseAcceptance: false,
    postgresArchiveSha256: verified.archiveSha256,
    ops10MigrationSha256: digest(sources.ops10),
    assertionsSha256: digest(sources.assertions),
  }
} finally {
  if (serverMayBeRunning) {
    await command(path.join(pgBin, 'pg_ctl.exe'), ['-D',cluster,'-m','fast','-w','-t','30','stop'])
    serverStopped = true
  } else serverStopped = true
  if (ownedRoot && serverStopped) removeOwnedStoppedCluster()
}

console.log(JSON.stringify(evidence))
