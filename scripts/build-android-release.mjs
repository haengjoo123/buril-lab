import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const origin = 'https://burillab.com'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flags = ['VITE_ENABLE_WASTE_V2', 'VITE_ENABLE_PH_PREDICTION',
  'VITE_ENABLE_CHEMICAL_ENRICHMENT', 'VITE_ENABLE_SEARCH_ANALYTICS', 'VITE_ENABLE_WASTE_CONTAINERS', 'VITE_ENABLE_LAB_TOOLS', 'VITE_ENABLE_INVENTORY_IMPORT_V2', 'VITE_ENABLE_CONTAINER_CONTENT_CHECK', 'VITE_ENABLE_CONTAINER_PICKUP_REQUESTS', 'VITE_ENABLE_DAILY_INSPECTION', 'VITE_ENABLE_QR_LABELS', 'VITE_ENABLE_SDS_ATTACHMENTS']
// Flags added after older deployed profiles were written; absent means the release had them off.
const lateFlags = ['VITE_ENABLE_LAB_TOOLS', 'VITE_ENABLE_INVENTORY_IMPORT_V2', 'VITE_ENABLE_CONTAINER_CONTENT_CHECK', 'VITE_ENABLE_CONTAINER_PICKUP_REQUESTS', 'VITE_ENABLE_DAILY_INSPECTION', 'VITE_ENABLE_QR_LABELS', 'VITE_ENABLE_SDS_ATTACHMENTS']
const hash = (value) => createHash('sha256').update(value).digest('hex')

export function validateWebChanges(changedFiles, untrackedFiles, allowWebChanges) {
  if (untrackedFiles.length) throw new Error('Commit or stage new web inputs before building.')
  if (changedFiles.length && !allowWebChanges) {
    throw new Error('Web inputs differ from production. Review the diff, then explicitly use --allow-web-changes for a new candidate.')
  }
  return { web_inputs_match_production: changedFiles.length === 0, web_changed_files: changedFiles }
}

export function productionEnvironment(release, profile, bundle) {
  if (!/^[a-f0-9]{40}$/.test(release.commit_sha || '') || release.environment !== 'production'
    || release.project !== 'buril-lab' || profile.commit !== release.commit_sha
    || profile.environment !== 'production'
    || profile.supabase_url !== 'https://zafxzidbtbryiksemlwc.supabase.co'
    || !bundle.includes(profile.supabase_url)) throw new Error('Production release/profile mismatch.')
  const keys = [...new Set(bundle.match(/sb_publishable_[A-Za-z0-9_-]+/g))]
  // Only the public key already shipped on the production website is accepted.
  // Fail if the web bundling/key format changes instead of falling back to .env.
  if (keys.length !== 1) throw new Error('Expected one production publishable key.')
  const features = Object.fromEntries(flags.map((name) => {
    // Older deployed profiles predate these flags; preserve the disabled release state.
    const value = profile.features?.[name] ?? (lateFlags.includes(name) ? 'false' : undefined)
    if (!['true', 'false'].includes(value)) throw new Error(`Missing production flag: ${name}`)
    return [name, value]
  }))
  return {
    VITE_PUBLIC_APP_URL: origin,
    VITE_INTERNAL_API_BASE_URL: origin,
    VITE_AUTH_REDIRECT_URL: `${origin}/auth/callback`,
    VITE_SUPABASE_URL: profile.supabase_url,
    VITE_SUPABASE_ANON_KEY: keys[0],
    ...features,
  }
}

async function get(path) {
  const response = await fetch(new URL(path, origin), {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Production read failed (${response.status}): ${path}`)
  return response
}

async function main() {
  process.chdir(root)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const release = await (await get('/release.json')).json()
  const profile = await (await get('/web-build-profile.json')).json()
  const html = await (await get('/')).text()
  const entry = html.match(/src="(\/assets\/index-[^"/]+\.js)"/)?.[1]
  if (!entry) throw new Error('Cannot locate the production entry bundle.')
  const bundle = await (await get(entry)).text()
  const clientEnv = productionEnvironment(release, profile, bundle)
  // Exact production parity is the default. Reviewed UI fixes are stamped as a different candidate.
  const webPaths = ['src', 'public', 'index.html',
    'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json',
    'tsconfig.node.json', 'functions', 'scripts/vite-pdfjs-assets.ts']
  const lines = (value) => value ? value.split(/\r?\n/) : []
  const webChanges = validateWebChanges(
    lines(git('diff', '--name-only', release.commit_sha, '--', ...webPaths)),
    lines(git('ls-files', '--others', '--exclude-standard', '--', ...webPaths)),
    process.argv.includes('--allow-web-changes'),
  )
  const webDiffHash = hash(git('diff', release.commit_sha, '--binary', '--', ...webPaths))
  const gradle = await readFile('android/app/build.gradle', 'utf8')
  const versionName = gradle.match(/versionName "([^"]+)"/)?.[1]
  const versionCode = Number(gradle.match(/versionCode (\d+)/)?.[1])
  if (!versionName || !Number.isInteger(versionCode) || versionCode < 1) throw new Error('Invalid Android version.')
  // Explicit values override all VITE_* values in local dotenv files.
  const env = { ...process.env, ...clientEnv }
  const npmCli = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  execFileSync(process.execPath, [npmCli, 'run', 'build'], { cwd: root, env, stdio: 'inherit' })
  const current = await (await get('/release.json')).json()
  if (current.commit_sha !== release.commit_sha || current.built_at !== release.built_at) {
    throw new Error('Production changed during the build; rebuild against the new release.')
  }
  const manifest = {
    schema_version: 1, platform: 'android', application_id: 'com.burillab.app',
    version_name: versionName, version_code: versionCode,
    source_commit: git('rev-parse', 'HEAD'), web_source_commit: release.commit_sha,
    ...webChanges, web_diff_sha256: webDiffHash,
    source_dirty: git('status', '--porcelain').length > 0,
    tracked_diff_sha256: hash(git('diff', 'HEAD', '--binary')),
    build_script_sha256: hash(await readFile(fileURLToPath(import.meta.url))),
    built_at: new Date().toISOString(), production_release: release,
    production_entry: entry, production_entry_sha256: hash(bundle),
    public_app_url: origin, api_base_url: origin,
    auth_redirect_url: clientEnv.VITE_AUTH_REDIRECT_URL,
    supabase_url: profile.supabase_url,
    publishable_key_sha256: hash(clientEnv.VITE_SUPABASE_ANON_KEY),
    features: Object.fromEntries(flags.map((name) => [name, clientEnv[name]])),
  }
  await writeFile('dist/android-release.json', `${JSON.stringify(manifest, null, 2)}\n`)
  execFileSync(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android'], {
    cwd: root, env, stdio: 'inherit',
  })
  console.log(`Android ${versionName} (${versionCode}) synced from production ${release.commit_sha}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
