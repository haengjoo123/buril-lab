import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { SignJWT } from 'jose'

const execFileAsync = promisify(execFile)
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const WRANGLER = path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js')
const HOST = '127.0.0.1'
const TEST_SUBJECT = 'cc395340-43a7-477e-a4df-96e1aec8b621'
// Deliberately public fixture material, like a unit-test key. This is not a
// Supabase credential and is never accepted by any hosted project.
const LOCAL_ONLY_JWT_FIXTURE = 'pages-boundary-local-only-fake-signing-material-never-deploy'

export function validateBoundaryPort(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) {
    throw new Error('The local Pages boundary port must be an integer between 0 and 65535.')
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('The local Pages boundary port must be an integer between 0 and 65535.')
  }
  return port
}

// No provider credential, Supabase URL/key, Upstash URL/key, proxy, or Node
// preload setting is inherited by this local-only child process. In particular,
// this helper does not call `deploy`, `secret`, or any remote-binding command.
export function localBoundaryChildEnvironment(source = process.env) {
  const allowed = /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|LANG|LC_ALL)$/i
  return {
    ...Object.fromEntries(Object.entries(source).filter(([key]) => allowed.test(key))),
    CI: 'true',
    NO_COLOR: '1',
    WRANGLER_SEND_METRICS: 'false',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  }
}

export function assertIsolatedClientSource(source) {
  if (/https?:\/\/[a-z0-9-]+\.supabase\.(?:co|in)\b/i.test(source)) {
    throw new Error('Local Pages boundary tests refuse a hosted Supabase client bundle.')
  }
}

async function verifyIsolatedClientBuild() {
  const assetsDirectory = path.join(ROOT, 'dist/assets')
  let hasQualityEndpoint = false
  for (const entry of await readdir(assetsDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue
    const source = await readFile(path.join(assetsDirectory, entry.name), 'utf8')
    assertIsolatedClientSource(source)
    if (source.includes('https://quality.invalid')) hasQualityEndpoint = true
  }
  if (!hasQualityEndpoint) {
    throw new Error('Build this local-only boundary suite with VITE_SUPABASE_URL=https://quality.invalid.')
  }
}

async function availablePort() {
  const server = createServer()
  server.listen(0, HOST)
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Cannot reserve a loopback test port.')
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function removeOwnedRuntimeDirectory(directory) {
  const parent = await realpath(path.join(ROOT, '.wrangler'))
  const resolved = await realpath(directory)
  if (path.dirname(resolved).toLowerCase() !== parent.toLowerCase()
    || !path.basename(resolved).startsWith('pages-boundary-local-')) {
    throw new Error('Refusing to clean a directory outside this local Pages test run.')
  }
  await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
}

async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit').catch(() => undefined)
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, timeout: 10_000,
    }).catch(() => undefined)
  } else {
    // This child alone starts a new process group; never kill by executable name.
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* already exited */ }
  }
  let deadline
  try {
    await Promise.race([exited, new Promise((resolve) => { deadline = setTimeout(resolve, 5_000) })])
  } finally { clearTimeout(deadline) }
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error('The owned Pages test process did not stop; test artifacts were retained.')
  }
}

export async function startPagesBoundaryLocal({ port: requestedPort = 0 } = {}) {
  const selectedPort = validateBoundaryPort(requestedPort) || await availablePort()
  const deployedConfig = JSON.parse(await readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8'))
  await verifyIsolatedClientBuild()
  const staticHeaders = await readFile(path.join(ROOT, 'public/_headers'), 'utf8')
  const builtHeaders = await readFile(path.join(ROOT, 'dist/_headers'), 'utf8')
  if (builtHeaders !== staticHeaders) throw new Error('Rebuild the app: dist/_headers differs from public/_headers.')
  await mkdir(path.join(ROOT, '.wrangler'), { recursive: true })
  const directory = await mkdtemp(path.join(ROOT, '.wrangler/pages-boundary-local-'))
  const assets = path.join(directory, 'assets')
  const probe = randomBytes(24).toString('hex')
  const probePath = `/__pages_boundary_probe_${probe}.txt`
  const childEnv = localBoundaryChildEnvironment()
  let child
  let closed = false
  const close = async () => {
    if (closed) return
    await stopOwnedChild(child)
    await removeOwnedRuntimeDirectory(directory)
    closed = true
  }

  try {
    await cp(path.join(ROOT, 'dist'), assets, { recursive: true, errorOnExist: true })
    // A unique static probe proves this is our runtime, not another developer's
    // server that happens to occupy the selected port and serve similar headers.
    await writeFile(path.join(assets, probePath.slice(1)), probe)
    await writeFile(path.join(directory, 'wrangler.jsonc'), `${JSON.stringify({
      name: 'buril-lab-pages-boundary-local-only',
      pages_build_output_dir: './assets',
      compatibility_date: deployedConfig.compatibility_date,
      compatibility_flags: deployedConfig.compatibility_flags,
      send_metrics: false,
      vars: {
        APP_ENVIRONMENT: 'production',
        PUBLIC_APP_ORIGIN: 'https://burillab.com',
      },
    }, null, 2)}\n`)
    const bundle = path.join(directory, 'bundle')
    await execFileAsync(process.execPath, [
      WRANGLER, 'pages', 'functions', 'build', path.join(ROOT, 'functions'),
      '--cwd', directory, '--outdir', bundle,
      '--project-directory', ROOT,
      '--output-routes-path', path.join(assets, '_routes.json'),
      '--compatibility-date', deployedConfig.compatibility_date,
      ...deployedConfig.compatibility_flags.flatMap((flag) => ['--compatibility-flag', flag]),
    ], { cwd: directory, env: childEnv, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 })
    await cp(path.join(bundle, 'index.js'), path.join(assets, '_worker.js'))

    child = spawn(process.execPath, [
      WRANGLER, 'pages', 'dev', assets, '--cwd', directory,
      '--ip', HOST, '--port', String(selectedPort), '--inspector-port', '0',
      '--binding', `SUPABASE_JWT_SECRET=${LOCAL_ONLY_JWT_FIXTURE}`,
      '--persist-to', path.join(directory, 'state'), '--log-level', 'error',
      '--show-interactive-dev-session=false',
    ], {
      cwd: directory, env: childEnv, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    })
    let failedToStart = false
    child.on('error', () => { failedToStart = true })
    // Drain logs without publishing request contents.
    child.stdout.resume()
    child.stderr.resume()
    const origin = `http://${HOST}:${selectedPort}`
    const deadline = Date.now() + 60_000
    let ready = false
    while (Date.now() < deadline) {
      if (failedToStart || child.exitCode !== null) throw new Error('The local Pages runtime could not start.')
      try {
        const response = await fetch(`${origin}${probePath}`, { redirect: 'error', signal: AbortSignal.timeout(1_000) })
        const headersMatch = response.headers.get('content-security-policy')
          === staticHeaders.match(/^  Content-Security-Policy: (.+)$/m)?.[1]
        const body = await response.text()
        if (response.status === 200 && headersMatch && body === probe) { ready = true; break }
      } catch { /* wait for the owned runtime, never reuse an existing server */ }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (!ready) throw new Error('The local Pages runtime did not serve the unchanged security headers in time.')
    return {
      origin,
      close,
      async syntheticAuthorization({ subject = TEST_SUBJECT, expiresIn = '2m' } = {}) {
        const token = await new SignJWT({ role: 'authenticated' })
          .setProtectedHeader({ alg: 'HS256' }).setSubject(subject)
          .setIssuedAt().setExpirationTime(expiresIn)
          .sign(new TextEncoder().encode(LOCAL_ONLY_JWT_FIXTURE))
        return { Authorization: `Bearer ${token}` }
      },
    }
  } catch (error) {
    await close()
    // Child-process exceptions include captured output/arguments; do not print them.
    if (error?.cmd) throw new Error('Local Pages compilation failed. No remote deployment was attempted.')
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1])) {
    throw new Error('Usage: node scripts/pages-boundary-local.mjs --port <loopback-port>')
  }
  const runtime = await startPagesBoundaryLocal({ port: args[1] })
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await runtime.close()
    process.exitCode = 0
  }
  process.once('SIGINT', () => { void stop() })
  process.once('SIGTERM', () => { void stop() })
  console.log(`Local-only Pages boundary ready at ${runtime.origin}; no provider credentials or remote bindings.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Local Pages boundary failed.')
    process.exitCode = 1
  })
}
