// Disposable loopback PostgreSQL only. Never accepts a connection string or remote host.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const pgBin = process.argv[2]
if (!pgBin || process.argv.length > 3) throw new Error('Usage: node scripts/test-inventory-import-db.mjs <local PostgreSQL bin directory>')
const binary = name => path.join(realpathSync(pgBin), `${name}${process.platform === 'win32' ? '.exe' : ''}`)
const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'buril-import-tests-')))
const cluster = path.join(root, 'data')
const command = (exe, args, input = '', daemon = false) => new Promise((resolve, reject) => {
  const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' } })
  let out = '', err = ''
  const timer = setTimeout(() => { child.kill(); reject(new Error('Local database test command timed out')) }, 60_000)
  child.stdout.on('data', data => { out += data }); child.stderr.on('data', data => { err += data })
  child.on('error', error => { clearTimeout(timer); reject(error) })
  child.on(daemon ? 'exit' : 'close', code => {
    clearTimeout(timer)
    if (daemon) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy() }
    if (code === 0) resolve(out.trim()); else reject(new Error(err || out))
  })
  child.stdin.end(input)
})
const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) }) })
let running = false
try {
  await command(binary('initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale', '--no-sync'])
  running = true
  await command(binary('pg_ctl'), ['-D', cluster, '-l', path.join(root, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', '-t', '30', 'start'], '', true)
  const query = sql => command(binary('psql'), ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres'], sql)
  if (realpathSync(await query("select current_setting('data_directory')")).toLowerCase() !== realpathSync(cluster).toLowerCase()) throw new Error('Unexpected cluster')
  await query('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;')
  await query(readFileSync('scripts/fixtures/ops5-local-bootstrap.sql', 'utf8'))
  for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()) {
    await query(readFileSync(path.join('supabase/migrations', file), 'utf8'))
  }
  await query(readFileSync('scripts/fixtures/inventory-import-assertions.sql', 'utf8'))
  const asUser = sql => `set role authenticated; set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}'; ${sql}`
  const request = `select public.commit_inventory_import_batch_v1('d2000000-0000-4000-8000-000000000001',1,'[{"rowId":"race","input":{"name":"Concurrent","quantity":2,"storage_type":"other"}}]');`
  const results = await Promise.all([query(asUser(request)), query(asUser(request))])
  if (Number(await query("select count(*) from public.inventory where name='Concurrent'")) !== 1) throw new Error('Concurrent duplicate import')
  if (!results.some(result => result.includes('"idempotent": true'))) throw new Error('Concurrent receipt not reused')
  const asService = sql => `set role service_role; set request.jwt.claims='{"role":"service_role"}'; ${sql}`
  // Storage bytes are mocked locally; verify that deletion queues the correct
  // private paths before ownership and import metadata disappear.
  await query(`set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
    insert into public.lab_members(lab_id,user_id,role) values('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','admin');
    update public.lab_members set role='researcher' where user_id='d1000000-0000-4000-8000-000000000001';
    update public.labs set created_by='d1000000-0000-4000-8000-000000000002' where id='d3000000-0000-4000-8000-000000000001';
    insert into public.inventory_import_jobs(id,user_id,lab_id,name) values('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Shared');
    insert into storage.objects(bucket_id,name) values ('inventory-imports','d2000000-0000-4000-8000-000000000002/source/original.pdf');`)
  const queued = JSON.parse(await query(asService(`select public.enqueue_account_deletion_v1('d1000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001');`)))
  if (!queued.success) throw new Error('Account deletion enqueue failed')
  const claim = JSON.parse(await query(asService('select public.claim_deletion_jobs_v1(1);'))).jobs[0]
  const prepared = JSON.parse(await query(asService(`select public.prepare_deletion_job_database_v1('${claim.job_id}','${claim.lease_token}');`)))
  if (prepared.target_count !== 1) throw new Error('Personal import file was not queued for deletion')
  if (await query("select count(*) from public.inventory_import_jobs where lab_id is null;") !== '0') throw new Error('Personal draft survived deletion')
  if (await query("select count(*) from public.inventory_import_jobs where lab_id is not null;") !== '1') throw new Error('Shared draft removed by personal deletion')
  await query(asService(`select public.mark_deletion_storage_complete_v1('${claim.job_id}','${claim.lease_token}');`))
  await query("delete from auth.users where id='d1000000-0000-4000-8000-000000000001';")
  await query(asService(`select public.mark_deletion_auth_complete_v1('${claim.job_id}','${claim.lease_token}'); select public.finalize_deletion_job_v1('${claim.job_id}','${claim.lease_token}');`))
  await query(asService("select public.enqueue_lab_deletion_v1('d1000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000002');"))
  const labClaim = JSON.parse(await query(asService('select public.claim_deletion_jobs_v1(1);'))).jobs[0]
  const labPrepared = JSON.parse(await query(asService(`select public.prepare_deletion_job_database_v1('${labClaim.job_id}','${labClaim.lease_token}');`)))
  if (labPrepared.target_count !== 1 || await query('select count(*) from public.inventory_import_jobs;') !== '0') throw new Error('Shared import deletion failed')
  console.log('INVENTORY_IMPORT_DATABASE_TESTS_PASSED (migration, RLS, revisions, partial failure, retry, concurrency, deletion integration)')
} finally {
  if (running) await command(binary('pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop'])
  // Delete only the exact temporary directory created by this process.
  if (path.dirname(root).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() || !path.basename(root).startsWith('buril-import-tests-') || realpathSync(root) !== root) throw new Error('Refusing cleanup outside test directory')
  rmSync(root, { recursive: true, force: false })
}
