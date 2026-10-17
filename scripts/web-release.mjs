import { appendFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { findTrustedQualityRun } from './verify-github-quality-run.mjs'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'
import { verifyStagingAccessProtection } from './verify-staging-access.mjs'

export const REPOSITORY = 'haengjoo123/buril-lab'
export const WORKFLOW = '.github/workflows/web-release.yml'
export const MAX_AGE = 8 * 24 * 60 * 60 * 1000
const SHA = /^[0-9a-f]{40}$/
const REQUIRED_CHECKS = ['Application checks', 'Cloudflare release contract', 'Blank database interface', 'Gate 0 browser interface']
export const FEATURE_FLAGS = ['VITE_ENABLE_WASTE_V2', 'VITE_ENABLE_PH_PREDICTION', 'VITE_ENABLE_CHEMICAL_ENRICHMENT', 'VITE_ENABLE_SEARCH_ANALYTICS', 'VITE_ENABLE_WASTE_CONTAINERS']

export function featureProfile(env) {
  return Object.fromEntries(FEATURE_FLAGS.map((name) => {
    requireThat(['true', 'false'].includes(env[name]), `Feature flag is missing or invalid: ${name}`)
    return [name, env[name]]
  }))
}

function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

export function validateRun(run, { path, events, now = Date.now(), completed = true }) {
  requireThat(run?.repository?.full_name === REPOSITORY && run?.head_repository?.full_name === REPOSITORY,
    'Release evidence must come from this repository, never a fork.')
  requireThat(run.path === path && events.includes(run.event) && run.head_branch === 'main' && SHA.test(run.head_sha),
    'Release evidence has the wrong workflow, event, branch, or commit.')
  requireThat(Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0,
    'Release evidence has an invalid run identity.')
  const created = Date.parse(run.created_at)
  const updated = Date.parse(run.updated_at)
  requireThat(Number.isFinite(created) && Number.isFinite(updated) && updated >= created && created <= now + 300_000
    && updated <= now + 300_000 && now - created <= MAX_AGE, 'Release evidence is expired or has invalid timestamps.')
  if (completed) requireThat(run.status === 'completed' && run.conclusion === 'success', 'The selected run has not succeeded.')
  return run
}

export function validateQualityJobs(jobs) {
  for (const name of REQUIRED_CHECKS) {
    const matches = jobs.filter((job) => job.name === name)
    requireThat(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success',
      `Required quality check did not pass: ${name}`)
  }
}

// Choose the latest staging attempt that existed when the button was pressed.
// Never silently fall back to an older success when the newer staging failed.
export function selectStagingRun(runs, cutoff, now = Date.now()) {
  const timestamp = Date.parse(cutoff)
  requireThat(Number.isFinite(timestamp), 'Production selection cutoff is invalid.')
  const candidates = runs.filter((run) => run.path === WORKFLOW && run.event === 'workflow_run'
    && run.head_branch === 'main' && Date.parse(run.created_at) <= timestamp)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
  requireThat(candidates.length > 0, 'No automatic staging run exists. Merge the PR and wait for Web release to finish.')
  const run = validateRun(candidates[0], { path: WORKFLOW, events: ['workflow_run'], now })
  requireThat(Date.parse(run.updated_at) <= timestamp, 'Staging finished after this production request. Start a new production run.')
  requireThat(/^Web staging [0-9a-f]{40}$/.test(run.display_title), 'Staging candidate identity is invalid.')
  return run
}

export function validateEvidence(evidence, run) {
  const commit = run.display_title?.match(/^Web staging ([0-9a-f]{40})$/)?.[1]
  requireThat(evidence?.version === 1 && evidence.repository === REPOSITORY && evidence.environment === 'staging'
    && evidence.run_id === String(run.id) && evidence.run_attempt === String(run.run_attempt)
    && evidence.commit === commit && SHA.test(commit)
    && /^[1-9][0-9]*$/.test(evidence.quality_run_id), 'Staging evidence does not match the exact successful run and attempt.')
  requireThat(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(evidence.deployment_id),
    'Staging deployment ID is invalid.')
  requireThat(evidence.deployment_url === `https://${evidence.deployment_id.slice(0, 8)}.buril-lab-staging.pages.dev`,
    'Staging evidence must identify the exact immutable deployment URL.')
  requireThat(JSON.stringify(featureProfile(evidence.features || {})) === JSON.stringify(evidence.features), 'Invalid staging feature profile.')
  return evidence
}

export function assertPromotion({ current, candidate, isAncestor, changedFiles, reviewedDatabaseSha }) {
  requireThat(SHA.test(current) && SHA.test(candidate), 'Live or candidate release identity is invalid.')
  requireThat(isAncestor(current, candidate), 'Production has a newer or divergent release. Refusing an implicit rollback.')
  const databaseChanges = changedFiles.filter((file) => file.startsWith('supabase/migrations/'))
  requireThat(databaseChanges.length === 0 || reviewedDatabaseSha === candidate,
    'This release changes database migrations. Apply and verify them through the database procedure, then set WEB_DATABASE_REVIEWED_SHA to this candidate. Web release never runs migrations.')
}

export async function github(path, env = process.env) {
  requireThat(env.GITHUB_REPOSITORY === REPOSITORY && Boolean(env.GITHUB_TOKEN), 'Trusted GitHub context is missing.')
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  requireThat(response.ok, `GitHub release lookup failed (${response.status}).`)
  const raw = await response.text()
  requireThat(raw.length <= 5 * 1024 * 1024, 'GitHub response exceeds the release evidence limit.')
  return JSON.parse(raw)
}

async function list(path, key) {
  const rows = []
  for (let page = 1; page <= 10; page++) {
    const result = await github(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    requireThat(Array.isArray(result[key]), 'GitHub list response is invalid.')
    rows.push(...result[key])
    if (result[key].length < 100) return rows
  }
  throw new Error('Release history exceeds the bounded lookup; no candidate was guessed.')
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: 30_000, windowsHide: true }).trim()
}

function isAncestor(ancestor, descendant) {
  try { git('merge-base', '--is-ancestor', ancestor, descendant); return true } catch { return false }
}

async function outputs(values) {
  for (const [key, value] of Object.entries(values)) {
    requireThat(/^[a-z_]+$/.test(key) && !/[\r\n\0]/.test(String(value)), 'Invalid release output.')
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  }
}

async function quality(commit, exactId) {
  requireThat(SHA.test(commit), 'Invalid candidate SHA.')
  const runs = await list(`actions/workflows/quality.yml/runs?head_sha=${commit}&branch=main`, 'workflow_runs')
  const run = findTrustedQualityRun(runs, { repository: REPOSITORY, commitSha: commit })
  validateRun(run, { path: '.github/workflows/quality.yml', events: ['push', 'workflow_dispatch'] })
  if (exactId && String(run.id) !== String(exactId)) {
    // A newer successful check for identical source is harmless. Still verify
    // the original evidence; a rerun must not erase a previously failed gate.
    const original = await github(`actions/runs/${exactId}`)
    validateRun(original, { path: '.github/workflows/quality.yml', events: ['push', 'workflow_dispatch'] })
    requireThat(original.head_sha === commit, 'Original quality evidence belongs to another commit.')
    validateQualityJobs(await list(`actions/runs/${original.id}/attempts/${original.run_attempt}/jobs`, 'jobs'))
  }
  validateQualityJobs(await list(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs'))
  return run
}

async function selectedRun() {
  const env = process.env
  requireThat(env.GITHUB_REF === 'refs/heads/main' && SHA.test(env.GITHUB_SHA || '') && env.WEB_RELEASE_ENABLED === 'true',
    'Web release must be enabled and run from protected main.')
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'))
  requireThat(event.repository?.full_name === REPOSITORY, 'Wrong event repository.')
  if (env.GITHUB_EVENT_NAME === 'workflow_run') {
    const run = await github(`actions/runs/${event.workflow_run?.id}`)
    validateRun(run, { path: '.github/workflows/quality.yml', events: ['push', 'workflow_dispatch'] })
    requireThat(event.workflow_run.head_sha === run.head_sha, 'Quality event identity changed.')
    await quality(run.head_sha, run.id)
    requireThat(isAncestor(run.head_sha, env.GITHUB_SHA), 'Staging candidate is not in trusted main history.')
    // Obsolete automatic events must not overwrite a newer staging candidate.
    const main = await github('git/ref/heads/main')
    requireThat(main.object.sha === run.head_sha, 'A newer main commit exists. Its quality run will stage it automatically.')
    await outputs({ environment: 'staging', commit: run.head_sha, quality_run_id: run.id })
  } else {
    requireThat(env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'Unsupported release event.')
    const current = await github(`actions/runs/${env.GITHUB_RUN_ID}`)
    const runs = await list('actions/workflows/web-release.yml/runs?event=workflow_run&branch=main', 'workflow_runs')
    const run = selectStagingRun(runs, current.created_at)
    const artifacts = await list(`actions/runs/${run.id}/artifacts`, 'artifacts')
    const matches = artifacts.filter((artifact) => artifact.name === `web-evidence-${run.id}-${run.run_attempt}` && !artifact.expired)
    requireThat(matches.length === 1 && Number.isSafeInteger(matches[0].id) && matches[0].id > 0
      && /^sha256:[0-9a-f]{64}$/.test(matches[0].digest), 'Staging evidence artifact is missing, expired, or ambiguous.')
    await outputs({ environment: 'production', staging_run_id: run.id, evidence_artifact_id: matches[0].id,
      evidence_digest: matches[0].digest.slice(7) })
  }
}

async function confirmSelection() {
  const run = await github(`actions/runs/${process.env.STAGING_RUN_ID}`)
  validateRun(run, { path: WORKFLOW, events: ['workflow_run'] })
  const evidence = validateEvidence(JSON.parse(await readFile('release-evidence/staging.json', 'utf8')), run)
  requireThat(isAncestor(evidence.commit, process.env.GITHUB_SHA), 'Selected candidate is not part of the approved main history.')
  await quality(evidence.commit, evidence.quality_run_id)
  await outputs({ commit: evidence.commit, quality_run_id: evidence.quality_run_id,
    staging_url: evidence.deployment_url, staging_deployment_id: evidence.deployment_id,
    staging_run_attempt: run.run_attempt, staging_features: JSON.stringify(evidence.features) })
}

async function guard() {
  const env = process.env
  const target = RELEASE_ENVIRONMENTS[env.DEPLOY_ENVIRONMENT]
  requireThat(Boolean(target) && env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REF === 'refs/heads/main'
    && env.WEB_RELEASE_ENABLED === 'true', 'Invalid release environment or activation state.')
  requireThat(git('rev-parse', 'HEAD') === env.DEPLOY_COMMIT_SHA, 'Checkout differs from selected release.')
  await quality(env.DEPLOY_COMMIT_SHA, env.QUALITY_RUN_ID)
  requireThat(env.VITE_SUPABASE_URL === `https://${target.supabaseProjectRef}.supabase.co`
    && env.SUPABASE_PROJECT_REF === target.supabaseProjectRef
    && env.BURILLAB_RUNTIME_CONFIG_KV_ID === target.runtimeConfigKvId, 'Release environment bindings are crossed or incomplete.')
  const features = featureProfile(env)
  const buildProfile = JSON.parse(await readFile('dist/web-build-profile.json', 'utf8'))
  requireThat(buildProfile.commit === env.DEPLOY_COMMIT_SHA && buildProfile.environment === env.DEPLOY_ENVIRONMENT
    && buildProfile.supabase_url === env.VITE_SUPABASE_URL && JSON.stringify(buildProfile.features) === JSON.stringify(features),
  'Build configuration changed between build and deploy. Start a new release.')
  if (env.DEPLOY_ENVIRONMENT === 'staging') {
    const main = await github('git/ref/heads/main')
    requireThat(main.object.sha === env.DEPLOY_COMMIT_SHA, 'A newer main commit will replace this staging candidate.')
  } else {
    requireThat(JSON.stringify(features) === env.STAGING_FEATURES, 'Production feature flags differ from the tested staging build.')
    const run = await github(`actions/runs/${env.STAGING_RUN_ID}`)
    validateRun(run, { path: WORKFLOW, events: ['workflow_run'] })
    requireThat(run.display_title === `Web staging ${env.DEPLOY_COMMIT_SHA}`
      && String(run.run_attempt) === env.STAGING_RUN_ATTEMPT, 'Staging evidence was replaced after selection.')
    for (const origin of [env.STAGING_URL, 'https://staging.burillab.com', 'https://buril-lab-staging.pages.dev']) {
      await verifyStagingAccessProtection(`${origin}/release.json`)
    }
    const { loadAndVerifyReleaseManifest } = await import('./verify-release-manifest.mjs')
    await loadAndVerifyReleaseManifest({ url: `${env.STAGING_URL}/release.json`, commitSha: env.DEPLOY_COMMIT_SHA, environment: 'staging' })
    const response = await fetch(`https://burillab.com/release.json?web_release=${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) })
    requireThat(response.ok, 'Cannot establish the current production release for rollback protection.')
    const current = await response.json()
    const { verifyReleaseManifest } = await import('./verify-release-manifest.mjs')
    verifyReleaseManifest(current, { commitSha: current.commit_sha, environment: 'production' })
    assertPromotion({ current: current.commit_sha, candidate: env.DEPLOY_COMMIT_SHA, isAncestor,
      changedFiles: git('diff', '--name-only', current.commit_sha, env.DEPLOY_COMMIT_SHA, '--', 'supabase/migrations/').split('\n').filter(Boolean),
      reviewedDatabaseSha: env.WEB_DATABASE_REVIEWED_SHA })
  }
}

async function main() {
  const command = process.argv[2]
  if (command === 'select') await selectedRun()
  else if (command === 'confirm') await confirmSelection()
  else if (command === 'guard') await guard()
  else throw new Error('Usage: node scripts/web-release.mjs select|confirm|guard')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
