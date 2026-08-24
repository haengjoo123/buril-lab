import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { detectDatabaseQualityGate, validateDatabaseQualityContract } from './detect-database-quality-gate.mjs'
import { detectGate0BrowserQuality, validateGate0BrowserContract } from './detect-gate0-browser-quality.mjs'
import { findPagesDeployment, readPagesDeployment } from './read-pages-deployment.mjs'
import {
  materializeWranglerConfig,
  renderWranglerConfig,
  writePagesDeployRedirect,
} from './render-wrangler-config.mjs'
import { verifyReleaseConfiguration } from './verify-cloudflare-release-config.mjs'
import { verifyCloudflareDeployInputs } from './verify-cloudflare-deploy-inputs.mjs'
import { findTrustedQualityRun } from './verify-github-quality-run.mjs'
import { verifyPagesProjectPair } from './verify-pages-project-config.mjs'
import { loadAndVerifyReleaseManifest, verifyReleaseManifest } from './verify-release-manifest.mjs'
import {
  isApprovedStagingHostname,
  verifyStagingAccessChallenge,
  verifyStagingAccessProtection,
} from './verify-staging-access.mjs'
import { createReleaseManifest, writeReleaseManifest } from './write-release-manifest.mjs'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const REQUIRED_SECRETS = [
  'FEEDBACK_ADMIN_EMAILS',
  'GEMINI_API_KEY',
  'GOOGLE_VISION_API_KEY',
  'KOSHA_API_KEY',
  'OPENAI_API_KEY',
  'OPS_ADMIN_EMAILS',
  'OPS_ANALYTICS_EXPORT_EMAILS',
  'SUPABASE_ANON_KEY',
  'SUPABASE_JWT_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
]

function projectFixture(environment: 'staging' | 'production', kvId: string | null) {
  const production = environment === 'production'
  const envVars = Object.fromEntries(
    REQUIRED_SECRETS.map((name) => [name, { type: 'secret_text', value: 'not-returned' }]),
  )
  return {
    name: production ? 'buril-lab' : 'buril-lab-staging',
    production_branch: 'main',
    domains: production
      ? ['burillab.com', 'www.burillab.com', 'buril-lab.pages.dev']
      : ['staging.burillab.com', 'buril-lab-staging.pages.dev'],
    source: production
      ? {
          type: 'github',
          config: {
            production_deployments_enabled: false,
            preview_deployment_setting: 'none',
          },
        }
      : null,
    deployment_configs: {
      production: {
        fail_open: false,
        env_vars: envVars,
        kv_namespaces: kvId
          ? { BURILLAB_RUNTIME_CONFIG: { namespace_id: kvId } }
          : {},
      },
      preview: { env_vars: {}, kv_namespaces: {} },
    },
  }
}

function validDeployEnvironment(environment: 'staging' | 'production') {
  const staging = environment === 'staging'
  return {
    DEPLOY_ENVIRONMENT: environment,
    CLOUDFLARE_PAGES_PROJECT: staging ? 'buril-lab-staging' : 'buril-lab',
    CLOUDFLARE_ACCOUNT_ID: '1'.repeat(32),
    CLOUDFLARE_API_TOKEN: 'token-value-that-is-long-enough',
    BURILLAB_RUNTIME_CONFIG_KV_ID: staging ? '2'.repeat(32) : '3'.repeat(32),
    DEPLOY_COMMIT_SHA: COMMIT,
    VITE_PUBLIC_APP_URL: staging ? 'https://staging.burillab.com' : 'https://burillab.com',
    VITE_INTERNAL_API_BASE_URL: staging ? 'https://staging.burillab.com' : 'https://burillab.com',
    VITE_AUTH_REDIRECT_URL: staging
      ? 'https://staging.burillab.com/auth/callback'
      : 'https://burillab.com/auth/callback',
    SUPABASE_PROJECT_REF: staging ? 'qpgnomuqdcucjmxrunnw' : 'zafxzidbtbryiksemlwc',
    VITE_SUPABASE_URL: staging
      ? 'https://qpgnomuqdcucjmxrunnw.supabase.co'
      : 'https://zafxzidbtbryiksemlwc.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon-key-value-that-is-long-enough',
    STAGING_ACCESS_CLIENT_ID: 'access-client-id',
    STAGING_ACCESS_CLIENT_SECRET: 'access-client-secret-value',
  }
}

function deploymentFixture(environment: 'staging' | 'production', overrides = {}) {
  const production = environment === 'production'
  const shortId = production ? 'production-id' : 'staging-id'
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    short_id: shortId,
    url: `https://${shortId}.${production ? 'buril-lab' : 'buril-lab-staging'}.pages.dev`,
    environment: 'production',
    production_branch: 'main',
    project_name: production ? 'buril-lab' : 'buril-lab-staging',
    created_on: '2026-08-24T01:00:00Z',
    deployment_trigger: {
      metadata: {
        branch: 'main',
        commit_hash: COMMIT,
      },
    },
    latest_stage: { name: 'deploy', status: 'success' },
    ...overrides,
  }
}

describe('Prep 0 Cloudflare release controls', () => {
  it('writes and verifies immutable release identities for both Pages projects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'burillab-release-'))
    const output = join(directory, 'release.json')
    try {
      const written = await writeReleaseManifest({
        output,
        commitSha: COMMIT,
        environment: 'staging',
        builtAt: '2026-08-24T01:02:03Z',
      })
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(written)
      expect(verifyReleaseManifest(written, {
        commitSha: COMMIT,
        environment: 'staging',
      })).toEqual(written)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects abbreviated or uppercase SHAs and release schema drift', () => {
    expect(() => createReleaseManifest({
      commitSha: 'abc123',
      environment: 'production',
      builtAt: '2026-08-24T00:00:00Z',
    })).toThrow(/lowercase, full 40-character/)
    expect(() => createReleaseManifest({
      commitSha: COMMIT.toUpperCase(),
      environment: 'production',
      builtAt: '2026-08-24T00:00:00Z',
    })).toThrow(/lowercase, full 40-character/)

    const manifest = createReleaseManifest({
      commitSha: COMMIT,
      environment: 'production',
      builtAt: '2026-08-24T00:00:00Z',
    })
    expect(() => verifyReleaseManifest(
      { ...manifest, extra: true },
      { commitSha: COMMIT, environment: 'production' },
    )).toThrow(/fields/)
  })

  it('never sends Staging Access credentials to production', async () => {
    await expect(loadAndVerifyReleaseManifest({
      url: 'https://burillab.com/release.json',
      commitSha: COMMIT,
      environment: 'production',
      processEnvironment: {
        STAGING_ACCESS_CLIENT_ID: 'staging-client-id',
        STAGING_ACCESS_CLIENT_SECRET: 'staging-client-secret',
      },
    })).rejects.toThrow(/only be sent to staging/)
  })

  it('requires an unauthenticated Cloudflare Access challenge on Staging', () => {
    expect(verifyStagingAccessChallenge({ status: 403, location: null })).toBe(true)
    expect(verifyStagingAccessChallenge({
      status: 302,
      location: 'https://burillab.cloudflareaccess.com/cdn-cgi/access/login/staging',
    })).toBe(true)
    expect(() => verifyStagingAccessChallenge({ status: 200, location: null })).toThrow(/reachable/)
    expect(() => verifyStagingAccessChallenge({
      status: 302,
      location: 'https://attacker.example/login',
    })).toThrow(/Cloudflare Access/)
  })

  it('checks both the Staging custom domain and Pages subdomain for Access protection', async () => {
    const challenge = vi.fn(async () => new Response(null, { status: 403 }))
    await expect(verifyStagingAccessProtection(
      'https://staging.burillab.com/release.json',
      challenge,
    )).resolves.toBe(true)
    await expect(verifyStagingAccessProtection(
      'https://buril-lab-staging.pages.dev/release.json',
      challenge,
    )).resolves.toBe(true)
    await expect(verifyStagingAccessProtection(
      'https://abc123.buril-lab-staging.pages.dev/release.json',
      challenge,
    )).resolves.toBe(true)
    expect(isApprovedStagingHostname('foo.bar.buril-lab-staging.pages.dev')).toBe(false)
    await expect(verifyStagingAccessProtection(
      'https://burillab.com/release.json',
      challenge,
    )).rejects.toThrow(/approved BurilLab Staging/)
  })

  it('selects the newest immutable Staging deployment for the exact SHA', () => {
    const older = deploymentFixture('staging', {
      short_id: 'older',
      url: 'https://older.buril-lab-staging.pages.dev',
    })
    const newer = {
      ...older,
      id: '123e4567-e89b-42d3-a456-426614174001',
      short_id: 'newer',
      url: 'https://newer.buril-lab-staging.pages.dev',
      created_on: '2026-08-24T02:00:00Z',
    }
    expect(findPagesDeployment({ success: true, result: [older, newer] }, COMMIT, {
      environment: 'staging',
      project: 'buril-lab-staging',
    })).toMatchObject({
      id: newer.id,
      url: newer.url,
      environment: 'staging',
      project: 'buril-lab-staging',
    })
    expect(() => findPagesDeployment([{ ...newer, url: 'https://buril-lab-staging.pages.dev' }], COMMIT))
      .toThrow(/immutable buril-lab-staging/)
  })

  it('accepts only the exact successful main production deployment and immutable production host', () => {
    const production = deploymentFixture('production')
    const options = { environment: 'production', project: 'buril-lab' }
    expect(findPagesDeployment({ success: true, result: [production] }, COMMIT, options)).toMatchObject({
      id: production.id,
      url: production.url,
      commitSha: COMMIT,
      environment: 'production',
      pagesEnvironment: 'production',
      project: 'buril-lab',
      branch: 'main',
    })

    for (const url of [
      'https://burillab.com',
      'https://buril-lab.pages.dev',
      'https://staging.burillab.com',
      'https://staging-id.buril-lab-staging.pages.dev',
      'https://nested.production-id.buril-lab.pages.dev',
    ]) {
      expect(() => findPagesDeployment([{ ...production, url }], COMMIT, options))
        .toThrow(/immutable buril-lab deployment hostname/)
    }

    for (const invalid of [
      { ...production, project_name: 'buril-lab-staging' },
      { ...production, environment: 'preview' },
      { ...production, production_branch: 'release' },
      {
        ...production,
        deployment_trigger: { metadata: { branch: 'release', commit_hash: COMMIT } },
      },
      { ...production, latest_stage: { name: 'deploy', status: 'failure' } },
      { ...production, latest_stage: { name: 'build', status: 'success' } },
    ]) {
      expect(() => findPagesDeployment([invalid], COMMIT, options))
        .toThrow(/No successful buril-lab main\/production/)
    }
    expect(() => findPagesDeployment([production], COMMIT, {
      environment: 'production',
      project: 'buril-lab-staging',
    })).toThrow(/must use Pages project buril-lab/)
  })

  it('records exact production deployment evidence in GitHub outputs and step summary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'burillab-deployment-evidence-'))
    const evidence = join(directory, 'deployments.json')
    const output = join(directory, 'github-output.txt')
    const summary = join(directory, 'github-summary.md')
    try {
      const production = deploymentFixture('production')
      await writeFile(evidence, JSON.stringify({ success: true, result: [production] }), 'utf8')
      await readPagesDeployment({
        file: evidence,
        commitSha: COMMIT,
        environment: 'production',
        project: 'buril-lab',
        outputPath: output,
        summaryPath: summary,
      })
      await expect(readFile(output, 'utf8')).resolves.toContain(`deployment_id=${production.id}`)
      await expect(readFile(output, 'utf8')).resolves.toContain(`deployment_commit_sha=${COMMIT}`)
      await expect(readFile(output, 'utf8')).resolves.toContain('deployment_project=buril-lab')
      await expect(readFile(summary, 'utf8')).resolves.toContain('Cloudflare Pages production deployment evidence')
      await expect(readFile(summary, 'utf8')).resolves.toContain(`Release commit: \`${COMMIT}\``)
      await expect(readFile(summary, 'utf8')).resolves.toContain(`Immutable deployment URL: ${production.url}`)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('materializes one protected KV ID without overwriting templates', async () => {
    const source = '{"id":"__BURILLAB_STAGING_RUNTIME_CONFIG_KV_ID__"}'
    expect(materializeWranglerConfig(source, {
      BURILLAB_STAGING_RUNTIME_CONFIG_KV_ID: 'a'.repeat(32),
    }).rendered).toBe(`{"id":"${'a'.repeat(32)}"}`)
    expect(() => materializeWranglerConfig(source, {
      BURILLAB_STAGING_RUNTIME_CONFIG_KV_ID: 'not-an-id',
    })).toThrow(/lowercase, 32-character/)

    const directory = await mkdtemp(join(tmpdir(), 'burillab-wrangler-'))
    const template = join(directory, 'wrangler.jsonc')
    const generated = join(directory, 'wrangler.generated.jsonc')
    const redirect = join(directory, '.wrangler', 'deploy', 'config.json')
    try {
      await writeFile(template, source, 'utf8')
      await expect(renderWranglerConfig({ input: template, output: template })).rejects.toThrow(/overwrite/)
      await renderWranglerConfig({
        input: template,
        output: generated,
        environment: { BURILLAB_STAGING_RUNTIME_CONFIG_KV_ID: 'a'.repeat(32) },
      })
      const result = await writePagesDeployRedirect({ config: generated, output: redirect })
      expect(result.relativeConfigPath).toBe('../../wrangler.generated.jsonc')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('binds public URLs and Supabase project refs to the selected environment', () => {
    expect(verifyCloudflareDeployInputs(validDeployEnvironment('staging'))).toMatchObject({
      environment: 'staging',
      project: 'buril-lab-staging',
    })
    expect(verifyCloudflareDeployInputs(validDeployEnvironment('production'))).toMatchObject({
      environment: 'production',
      project: 'buril-lab',
    })
    expect(() => verifyCloudflareDeployInputs({
      ...validDeployEnvironment('staging'),
      SUPABASE_PROJECT_REF: 'zafxzidbtbryiksemlwc',
      VITE_SUPABASE_URL: 'https://zafxzidbtbryiksemlwc.supabase.co',
    })).toThrow(/selected release environment/)
  })

  it('rejects shared production and Staging runtime-config namespaces', () => {
    const staging = projectFixture('staging', 'a'.repeat(32))
    const production = projectFixture('production', 'b'.repeat(32))
    expect(verifyPagesProjectPair({
      staging,
      production,
      selectedEnvironment: 'production',
      selectedRuntimeConfigKvId: 'b'.repeat(32),
      requireCurrentBinding: true,
    })).toMatchObject({ currentBindingVerified: true, peerBindingPresent: true })

    expect(() => verifyPagesProjectPair({
      staging,
      production,
      selectedEnvironment: 'production',
      selectedRuntimeConfigKvId: 'a'.repeat(32),
    })).toThrow(/must not share/)
  })

  it('rejects missing server secrets and old client-prefixed provider secrets', () => {
    const staging = projectFixture('staging', 'a'.repeat(32))
    const production = projectFixture('production', 'b'.repeat(32))
    delete staging.deployment_configs.production.env_vars.KOSHA_API_KEY
    expect(() => verifyPagesProjectPair({
      staging,
      production,
      selectedEnvironment: 'staging',
      selectedRuntimeConfigKvId: 'a'.repeat(32),
    })).toThrow(/lacks encrypted server secrets/)

    staging.deployment_configs.production.env_vars.KOSHA_API_KEY = {
      type: 'secret_text',
      value: 'not-returned',
    }
    staging.deployment_configs.preview.env_vars.VITE_KOSHA_API_KEY = {
      type: 'secret_text',
      value: 'not-returned',
    }
    expect(() => verifyPagesProjectPair({
      staging,
      production,
      selectedEnvironment: 'staging',
      selectedRuntimeConfigKvId: 'a'.repeat(32),
    })).toThrow(/forbidden client-prefixed/)
  })

  it('accepts only a successful trusted push-to-main quality run for production', () => {
    const trusted = {
      id: 1,
      conclusion: 'success',
      event: 'push',
      head_branch: 'main',
      head_sha: COMMIT,
      head_repository: { full_name: 'owner/buril-lab' },
    }
    expect(findTrustedQualityRun([trusted], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
    })).toBe(trusted)
    expect(() => findTrustedQualityRun([
      { ...trusted, event: 'pull_request' },
    ], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
    })).toThrow(/No successful trusted/)
  })

  it('keeps the database reset job off until Prep 1 supplies the exact contract', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'burillab-db-quality-'))
    try {
      expect(await detectDatabaseQualityGate({
        path: join(directory, 'missing.json'),
        outputPath: undefined,
      })).toMatchObject({ enabled: false })
      expect(validateDatabaseQualityContract({
        schema_version: 1,
        enabled: true,
        reset_count: 2,
        permission_tests: true,
      })).toMatchObject({ reset_count: 2 })
      expect(() => validateDatabaseQualityContract({
        schema_version: 1,
        enabled: true,
        reset_count: 1,
        permission_tests: true,
      })).toThrow(/two resets/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps Gate 0 browser CI off until its reviewed spec contract exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'burillab-browser-quality-'))
    try {
      expect(await detectGate0BrowserQuality({
        path: join(directory, 'missing.json'),
        outputPath: undefined,
      })).toMatchObject({ enabled: false })
      expect(validateGate0BrowserContract({
        schema_version: 1,
        enabled: true,
        browser: 'chromium',
        config: 'playwright.gate0.config.ts',
        spec: 'e2e/gate0/gate0.spec.ts',
      })).toMatchObject({ browser: 'chromium' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps the committed release workflows inside Prep 0 scope', async () => {
    const [productionRaw, stagingRaw, stagingWorkflow, productionWorkflow, qualityWorkflow] = await Promise.all([
      readFile('wrangler.jsonc', 'utf8'),
      readFile('wrangler.staging.jsonc', 'utf8'),
      readFile('.github/workflows/deploy-staging.yml', 'utf8'),
      readFile('.github/workflows/deploy-production.yml', 'utf8'),
      readFile('.github/workflows/quality.yml', 'utf8'),
    ])
    expect(verifyReleaseConfiguration({
      productionRaw,
      stagingRaw,
      workflows: {
        staging: stagingWorkflow,
        production: productionWorkflow,
        quality: qualityWorkflow,
      },
    })).toMatchObject({ projectCount: 2 })
  })
})
