import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDatabaseReleaseSafety } from './verify-database-release-safety.mjs'

export const OPS3_BASE_SHA = '45eba849183935e2dfa675b7355ad0efda5a9644'
export const OPS3_APPROVED_PATHS = Object.freeze([
  '.github/workflows/quality.yml',
  'docs/operations/ops3-api-boundary-preparation.md',
  'e2e/pages-boundary/pages-boundary.spec.ts',
  'functions/api/[[path]].ts',
  'functions/api/_middleware.test.ts',
  'functions/api/_middleware.ts',
  'functions/api/_routePolicy.test.ts',
  'functions/api/_routePolicy.ts',
  'functions/api/_shared/json.test.ts',
  'functions/api/_shared/json.ts',
  'functions/api/_shared/requestBody.test.ts',
  'functions/api/_shared/requestBody.ts',
  'functions/api/_shared/validation.ts',
  'functions/api/account/delete.test.ts',
  'functions/api/account/delete.ts',
  'functions/api/admin/analytics/_shared.ts',
  'functions/api/admin/analytics/export.ts',
  'functions/api/admin/analytics/mixtures.ts',
  'functions/api/admin/analytics/reviews.ts',
  'functions/api/admin/analytics/search.ts',
  'functions/api/admin/analytics/summary.ts',
  'functions/api/admin/boundary.test.ts',
  'functions/api/admin/feedback/_shared.ts',
  'functions/api/admin/feedback/list.ts',
  'functions/api/admin/feedback/status.ts',
  'functions/api/admin/safety-centers/_shared.ts',
  'functions/api/admin/safety-centers/document-url.ts',
  'functions/api/admin/safety-centers/list.ts',
  'functions/api/admin/safety-centers/status.ts',
  'functions/api/analytics/_shared.ts',
  'functions/api/analytics/guest-delete.ts',
  'functions/api/analytics/search-action.ts',
  'functions/api/analytics/search-event.ts',
  'functions/api/analytics/user-delete.ts',
  'functions/api/chemicals/enrich.test.ts',
  'functions/api/chemicals/enrich.ts',
  'functions/api/voice/_shared.ts',
  'functions/api/voice/audio.test.ts',
  'functions/api/voice/query.test.ts',
  'functions/api/voice/query.ts',
  'functions/api/voice/speak.ts',
  'functions/api/voice/transcribe.ts',
  'package.json',
  'playwright.pages-boundary.config.ts',
  'public/_headers',
  'scripts/cloudflare-release.test.ts',
  'scripts/pages-boundary-local.mjs',
  'scripts/pages-boundary-local.test.ts',
  'scripts/static-security-headers.test.ts',
  'scripts/verify-cloudflare-release-config.mjs',
  'scripts/verify-ops3-release-scope.mjs',
  'scripts/verify-ops3-release-scope.test.ts',
  'scripts/verify-pages-boundary-runtime.mjs',
])

const VOICE_FILES = Object.freeze([
  'functions/api/voice/query.ts',
  'src/utils/voiceAgent.ts',
  'src/store/useVoiceAgentStore.ts',
])
const FORBIDDEN_GUIDED_VOICE_TOKENS = Object.freeze([
  'guidedDisposal', 'update_waste_batch_draft', 'draftPatch',
  'decisionStatus', 'componentCandidates',
])
const RELEASABLE_UNTRACKED_ROOTS = /^(?:\.github\/|config\/|e2e\/|functions\/|public\/|scripts\/|src\/|supabase\/|workers\/|package(?:-lock)?\.json$|playwright\.)/

function fail(message) {
  throw new Error(`[ops3-scope] ${message}`)
}

function runGit(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    fail('cannot verify the reviewed Ops3 Git boundary')
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

export function verifyOps3ChangedPaths(paths) {
  const allowed = new Set(OPS3_APPROVED_PATHS)
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !candidate || /[\\\x00-\x1f\x7f]/.test(candidate)
      || candidate.startsWith('/') || candidate.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      fail('a changed path is malformed')
    }
    if (!allowed.has(candidate) && !candidate.startsWith('docs/operations/')) {
      fail(`unreviewed path is present in the Ops3 bundle: ${candidate}`)
    }
  }
  return paths.length
}

export function verifyRedirectOnlyVoiceSource(sources) {
  const combined = Object.values(sources).join('\n')
  for (const token of FORBIDDEN_GUIDED_VOICE_TOKENS) {
    if (combined.includes(token)) fail(`guided voice token is present: ${token}`)
  }
  if (!combined.includes('open_waste_batch_review')) fail('voice disposal redirect action is missing')
  return Object.keys(sources).length
}

function verifyPackageBoundary(root) {
  const basePackage = JSON.parse(runGit(root, ['show', `${OPS3_BASE_SHA}:package.json`]))
  const candidatePackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const expectedScripts = {
    ...basePackage.scripts,
    'test:pages-boundary': 'node scripts/verify-pages-boundary-runtime.mjs && playwright test --config playwright.pages-boundary.config.ts',
  }
  candidatePackage.scripts = {}
  basePackage.scripts = {}
  if (JSON.stringify(canonical(candidatePackage)) !== JSON.stringify(canonical(basePackage))) {
    fail('package metadata or dependency declarations changed outside the reviewed test command')
  }
  const actual = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expectedScripts))) {
    fail('package scripts differ from the base plus the one reviewed Pages-boundary command')
  }
}

export function verifyOps3ReleaseScope(root = fileURLToPath(new URL('../', import.meta.url))) {
  if (!/^[0-9a-f]{40}$/.test(OPS3_BASE_SHA)) fail('base SHA is invalid')
  runGit(root, ['cat-file', '-e', `${OPS3_BASE_SHA}^{commit}`])
  runGit(root, ['merge-base', '--is-ancestor', OPS3_BASE_SHA, 'HEAD'])
  // Include every change type, including file-to-symlink changes; filtering
  // those out would let an unreviewed path bypass the regular-file check.
  const changed = runGit(root, ['diff', '--name-only', OPS3_BASE_SHA, '--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter((value) => RELEASABLE_UNTRACKED_ROOTS.test(value))
  const paths = [...new Set([...changed, ...untracked])].sort()
  verifyOps3ChangedPaths(paths)
  for (const candidate of paths) {
    if (candidate.startsWith('docs/operations/')) continue
    const status = lstatSync(path.join(root, candidate), { throwIfNoEntry: false })
    if (!status?.isFile()) fail(`reviewed release path must be a regular file: ${candidate}`)
  }
  const voiceSources = Object.fromEntries(VOICE_FILES.map((file) => [file, readFileSync(path.join(root, file), 'utf8')]))
  verifyRedirectOnlyVoiceSource(voiceSources)
  verifyPackageBoundary(root)
  verifyDatabaseReleaseSafety(root)
  return {
    baseSha: OPS3_BASE_SHA,
    changedFiles: paths.length,
    approvedPaths: OPS3_APPROVED_PATHS.length,
    activeMigrations: 1,
    voiceMode: 'redirect',
    result: 'ops3-release-scope-ok',
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(verifyOps3ReleaseScope())) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Ops3 release-scope verification failed.')
    process.exitCode = 1
  }
}
