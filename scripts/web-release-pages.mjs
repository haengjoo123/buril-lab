import { spawnSync } from 'node:child_process'
import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'
import { renderWranglerConfig, writePagesDeployRedirect } from './render-wrangler-config.mjs'
import { readWranglerPagesDeployOutput } from './verify-wrangler-pages-deploy-output.mjs'
import { findPagesDeployment } from './read-pages-deployment.mjs'
import { fetchAndVerifyPagesProjectPair } from './verify-pages-project-config.mjs'
import { loadAndVerifyReleaseManifest } from './verify-release-manifest.mjs'
import { verifyStagingAccessProtection } from './verify-staging-access.mjs'
import { verifyStagingKoshaLinkOnly } from './verify-staging-kosha-link-only.mjs'
import { featureProfile } from './web-release.mjs'

function run(file, args, env) {
  const result = spawnSync(file, args, { env, stdio: 'inherit', timeout: 10 * 60 * 1000, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`Release command failed: ${file}`)
}

function target() {
  const env = process.env
  const selected = RELEASE_ENVIRONMENTS[env.DEPLOY_ENVIRONMENT]
  if (!selected || !/^[0-9a-f]{40}$/.test(env.DEPLOY_COMMIT_SHA || '')) throw new Error('Invalid release target.')
  return selected
}

async function deploy() {
  const env = process.env
  const selected = target()
  if (!/^[0-9a-f]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Set the environment WEB_PAGES_TOKEN and CLOUDFLARE_ACCOUNT_ID before enabling Web release.')
  }
  await fetchAndVerifyPagesProjectPair(env)
  const input = env.DEPLOY_ENVIRONMENT === 'staging' ? 'wrangler.staging.jsonc' : 'wrangler.jsonc'
  const output = `wrangler.${env.DEPLOY_ENVIRONMENT}.generated.jsonc`
  const values = { ...env, [`BURILLAB_${env.DEPLOY_ENVIRONMENT.toUpperCase()}_RUNTIME_CONFIG_KV_ID`]: env.BURILLAB_RUNTIME_CONFIG_KV_ID }
  // Renderer receives only the selected binding; the tracked config remains untouched.
  await renderWranglerConfig({ input, output, environment: values })
  await writePagesDeployRedirect({ config: output, output: '.wrangler/deploy/config.json' })
  const started = new Date().toISOString()
  const outputFile = `${env.RUNNER_TEMP}/web-pages-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}.jsonl`
  const message = `web release ${env.GITHUB_RUN_ID} attempt ${env.GITHUB_RUN_ATTEMPT}`
  // The artifact already contains the compiled Worker. Do not rebuild functions
  // in the process that has the deployment token.
  await rename('functions', '.web-release-functions')
  try {
    run(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'pages', 'deploy', 'dist',
      '--project-name', selected.project, '--branch', 'main', '--commit-hash', env.DEPLOY_COMMIT_SHA,
      '--commit-message', message, '--commit-dirty=false', '--no-bundle'], { ...env, WRANGLER_OUTPUT_FILE_PATH: outputFile })
  } finally {
    await rename('.web-release-functions', 'functions')
  }
  const command = await readWranglerPagesDeployOutput({ file: outputFile, commitSha: env.DEPLOY_COMMIT_SHA,
    environment: env.DEPLOY_ENVIRONMENT, project: selected.project, startedAt: started, outputPath: null })
  let verified
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${selected.project}/deployments/${command.deploymentId}`, {
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Cannot verify the deployed Pages version (${response.status}).`)
    const payload = await response.json()
    try {
      if (payload.success !== true) throw new Error('Pages API rejected deployment evidence.')
      verified = findPagesDeployment([payload.result], env.DEPLOY_COMMIT_SHA, { environment: env.DEPLOY_ENVIRONMENT,
        project: selected.project, deploymentId: command.deploymentId, deploymentUrl: command.deploymentUrl,
        notBefore: started, commitMessage: message })
      break
    } catch (error) {
      if (attempt === 5) throw error
      await delay(5000)
    }
  }
  await fetchAndVerifyPagesProjectPair({ ...env, VERIFY_CURRENT_RUNTIME_BINDING: 'true' })
  await appendFile(env.GITHUB_OUTPUT, `deployment_id=${verified.id}\ndeployment_url=${verified.url}\n`)
}

async function verify() {
  const env = process.env
  const selected = target()
  const isStaging = env.DEPLOY_ENVIRONMENT === 'staging'
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(env.DEPLOYMENT_ID || '')
    || env.DEPLOYMENT_URL !== `https://${env.DEPLOYMENT_ID.slice(0, 8)}.${selected.project}.pages.dev`) {
    throw new Error('Immutable deployment identity is invalid.')
  }
  const urls = [selected.origin, env.DEPLOYMENT_URL, ...(isStaging ? [`https://${selected.project}.pages.dev`] : [])]
  for (const url of urls) {
    if (isStaging) await verifyStagingAccessProtection(`${url}/release.json`)
    await loadAndVerifyReleaseManifest({ url: `${url}/release.json`, commitSha: env.DEPLOY_COMMIT_SHA,
      environment: env.DEPLOY_ENVIRONMENT, retries: 6 })
  }
  if (isStaging) {
    await verifyStagingKoshaLinkOnly({ environment: env })
    for (const url of [selected.origin, env.DEPLOYMENT_URL]) {
      run(process.execPath, ['scripts/seed-gate0-e2e.mjs'], { ...env,
        SUPABASE_URL: env.VITE_SUPABASE_URL,
        GATE0_STAGING_SEED_CONFIRMATION: 'SEED GATE0 SYNTHETIC DATA qpgnomuqdcucjmxrunnw' })
      run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.staging.config.ts'], {
        ...env, GATE0_BASE_URL: url, GATE0_EXPECTED_COMMIT_SHA: env.DEPLOY_COMMIT_SHA,
        GATE0_EXPECTED_DEPLOYMENT_ID: env.DEPLOYMENT_ID,
        GATE0_STAGING_TARGET_CONFIRMATION: `RUN GATE0 ${selected.project} ${env.DEPLOYMENT_ID} ${env.DEPLOY_COMMIT_SHA} ${url}`,
        // Only the fixture seeder needs backend authority. Browser workers never do.
        SUPABASE_SERVICE_ROLE_KEY: '',
      })
    }
    await mkdir('release-evidence', { recursive: true })
    await writeFile('release-evidence/staging.json', JSON.stringify({ version: 1, repository: env.GITHUB_REPOSITORY,
      environment: 'staging', commit: env.DEPLOY_COMMIT_SHA, run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT,
      quality_run_id: env.QUALITY_RUN_ID, deployment_id: env.DEPLOYMENT_ID, deployment_url: env.DEPLOYMENT_URL,
      features: featureProfile(env) }))
  } else {
    for (const path of ['/api/ai/classify', '/api/ai/scan-label', '/api/ai/disposal-guide', '/api/voice/query']) {
      const response = await fetch(`${selected.origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: '{}', redirect: 'manual', signal: AbortSignal.timeout(15_000) })
      await response.body?.cancel()
      if (response.status !== 401) throw new Error(`Production authentication smoke failed: ${path} (${response.status})`)
    }
  }
  await appendFile(env.GITHUB_STEP_SUMMARY, `## ${isStaging ? 'Staging verified — ready for production' : 'Production verified'}\n\nCommit: \`${env.DEPLOY_COMMIT_SHA}\`\n\nDeployment: ${env.DEPLOYMENT_URL}\n\n${isStaging ? '[Run Web release on main to publish this candidate](https://github.com/haengjoo123/buril-lab/actions/workflows/web-release.yml). No inputs are required.' : 'Public release identity and authentication boundaries passed.'}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2] === 'deploy' ? deploy : process.argv[2] === 'verify' ? verify : null
  if (!action) throw new Error('Usage: web-release-pages.mjs deploy|verify')
  action().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
