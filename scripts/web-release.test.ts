import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertPromotion, featureProfile, selectStagingRun, validateEvidence, validateQualityJobs, validateRun, REPOSITORY, WORKFLOW } from './web-release.mjs'
import { artifactFiles, verifyArtifact } from './web-release-artifact.mjs'
import { verifyWebReleaseWorkflow } from './verify-web-release-workflow.mjs'
import { verifyCabinetRelease } from './verify-cabinet-release.mjs'

const commit = 'a'.repeat(40)
const newer = 'b'.repeat(40)
const now = Date.parse('2026-10-13T20:00:00Z')
const features = { VITE_ENABLE_WASTE_V2: 'true', VITE_ENABLE_PH_PREDICTION: 'true', VITE_ENABLE_CHEMICAL_ENRICHMENT: 'true', VITE_ENABLE_SEARCH_ANALYTICS: 'false' }
function run(overrides = {}) {
  return { id: 100, run_attempt: 1, path: WORKFLOW, event: 'workflow_run', head_branch: 'main', head_sha: commit,
    repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY },
    display_title: `Web staging ${commit}`, created_at: '2026-10-13T19:00:00Z', updated_at: '2026-10-13T19:05:00Z',
    status: 'completed', conclusion: 'success', ...overrides }
}
const evidence = { version: 1, repository: REPOSITORY, environment: 'staging', run_id: '100', run_attempt: '1', commit,
  quality_run_id: '90', deployment_id: '123e4567-e89b-42d3-a456-426614174000',
  deployment_url: 'https://123e4567.buril-lab-staging.pages.dev', features }

describe('automatic release selection', () => {
  it('binds a manual request to staging that finished before the button was pressed', () => {
    const later = run({ id: 101, created_at: '2026-10-13T20:01:00Z', updated_at: '2026-10-13T20:05:00Z' })
    expect(selectStagingRun([later, run()], new Date(now).toISOString(), now).id).toBe(100)
  })
  it.each(['failure', 'cancelled', 'skipped'])('does not fall back to an older success after %s', (conclusion) => {
    const bad = run({ id: 101, conclusion, created_at: '2026-10-13T19:10:00Z', updated_at: '2026-10-13T19:15:00Z' })
    expect(() => selectStagingRun([run(), bad], new Date(now).toISOString(), now)).toThrow(/has not succeeded/)
  })
  it('does not choose an unfinished staging run', () => {
    expect(() => selectStagingRun([run({ status: 'in_progress', conclusion: null })], new Date(now).toISOString(), now)).toThrow()
  })
  it('rejects a run rerun after the production request', () => {
    expect(() => selectStagingRun([run({ updated_at: '2026-10-13T20:01:00Z' })], new Date(now).toISOString(), now)).toThrow(/after this production/)
  })
  it.each([
    { head_repository: { full_name: 'attacker/buril-lab' } },
    { repository: { full_name: 'attacker/buril-lab' } },
    { head_branch: 'feature' }, { path: '.github/workflows/impostor.yml' }, { event: 'pull_request' },
    { head_sha: 'main; echo unsafe' }, { run_attempt: 0 },
    { created_at: '2026-09-01T00:00:00Z' }, { updated_at: 'invalid' },
  ])('rejects untrusted or stale provenance: %j', (override) => {
    expect(() => validateRun(run(override), { path: WORKFLOW, events: ['workflow_run'], now })).toThrow()
  })
  it('requires all four actual quality jobs, even with a successful workflow conclusion', () => {
    const jobs = ['Application checks', 'Cloudflare release contract', 'Blank database interface', 'Gate 0 browser interface']
      .map((name) => ({ name, status: 'completed', conclusion: 'success' }))
    expect(() => validateQualityJobs(jobs)).not.toThrow()
    expect(() => validateQualityJobs(jobs.slice(0, 3))).toThrow(/Gate 0/)
    expect(() => validateQualityJobs([...jobs, jobs[0]])).toThrow()
    expect(() => validateQualityJobs(jobs.map((job) => ({ ...job, conclusion: 'skipped' })))).toThrow()
  })
})

describe('staging evidence and promotion', () => {
  it('accepts the exact immutable staging evidence', () => {
    expect(validateEvidence(evidence, run()).commit).toBe(commit)
  })
  it.each([
    { commit: newer }, { run_id: '101' }, { run_attempt: '2' }, { quality_run_id: 'bad' },
    { environment: 'production' }, { deployment_url: 'https://attacker.example' },
    { deployment_url: 'https://staging.burillab.com' }, { deployment_id: 'invalid' }, { features: {} },
  ])('rejects mismatched evidence: %j', (override) => {
    expect(() => validateEvidence({ ...evidence, ...override }, run())).toThrow()
  })
  it('allows a verified ancestor of main, without demanding the latest main tip', () => {
    expect(() => assertPromotion({ current: commit, candidate: newer, isAncestor: () => true, changedFiles: ['README.md'] })).not.toThrow()
  })
  it('blocks an older or divergent candidate', () => {
    expect(() => assertPromotion({ current: newer, candidate: commit, isAncestor: () => false, changedFiles: [] })).toThrow(/rollback/)
  })
  it('blocks database changes until the exact candidate has database review', () => {
    const input = { current: commit, candidate: newer, isAncestor: () => true, changedFiles: ['supabase/migrations/20261013000000_change.sql'] }
    expect(() => assertPromotion(input)).toThrow(/database/)
    expect(() => assertPromotion({ ...input, reviewedDatabaseSha: commit })).toThrow()
    expect(() => assertPromotion({ ...input, reviewedDatabaseSha: newer })).not.toThrow()
  })
  it('rejects unset flags instead of silently changing a tested feature profile', () => {
    expect(featureProfile(features)).toEqual(features)
    expect(() => featureProfile({ ...features, VITE_ENABLE_PH_PREDICTION: '' })).toThrow()
  })
})

describe('release artifact integrity', () => {
  it('detects changed, missing, additional files and a substituted manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'web-release-'))
    try {
      const dist = join(root, 'dist')
      await mkdir(join(dist, '_worker.js'), { recursive: true })
      for (const file of ['index.html', '_worker.js/index.js', '_routes.json', 'release.json']) await writeFile(join(dist, file), file)
      const raw = JSON.stringify(await artifactFiles(dist))
      const manifest = join(root, 'manifest.json')
      await writeFile(manifest, raw)
      const hash = createHash('sha256').update(raw).digest('hex')
      await expect(verifyArtifact(dist, manifest, hash)).resolves.toBeUndefined()
      await writeFile(join(dist, 'injected.js'), 'bad')
      await expect(verifyArtifact(dist, manifest, hash)).rejects.toThrow(/differ/)
      await rm(join(dist, 'injected.js'))
      await writeFile(join(dist, '_worker.js/index.js'), 'changed')
      await expect(verifyArtifact(dist, manifest, hash)).rejects.toThrow(/differ/)
      await rm(join(dist, 'index.html'))
      await expect(verifyArtifact(dist, manifest, hash)).rejects.toThrow(/incomplete/)
      await writeFile(manifest, '[]')
      await expect(verifyArtifact(dist, manifest, hash)).rejects.toThrow(/digest/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

describe('workflow security boundaries', () => {
  it('allows ongoing web development without dropping historical data and deletion safety gates', () => {
    expect(verifyCabinetRelease()).toMatchObject({ scopeMode: 'continuous-web', hostedAcceptance: false,
      productionReady: false, ops12Included: false, deletionRuntimeDefaultEnabled: false })
  })
  it('keeps the new three-step path valid and rejects weakened gates', async () => {
    const source = (await readFile('.github/workflows/web-release.yml', 'utf8')).replace(/\r\n/g, '\n')
    expect(verifyWebReleaseWorkflow(source)).toBe(true)
    for (const altered of [
      source.replace('actions: read', 'actions: write'),
      source.replace('cancel-in-progress: false', 'cancel-in-progress: true'),
      source.replace('node scripts/web-release.mjs guard', 'echo skip'),
      source.replace('node scripts/web-release-pages.mjs verify', 'echo skip'),
      source.replace('npm audit --omit=dev --audit-level=high', 'echo skip'),
      source.replace('persist-credentials: false', 'persist-credentials: true'),
      source.replace('node scripts/web-release-pages.mjs deploy', 'echo $CLOUDFLARE_API_TOKEN'),
      source.replace('if: needs.select.outputs.environment == \'staging\'\n        uses: actions/upload-artifact', "if: always()\n        uses: actions/upload-artifact"),
      source.replace('if: >-', 'continue-on-error: true\n    if: >-'),
    ]) expect(() => verifyWebReleaseWorkflow(altered)).toThrow()
  })
})
