import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { detectDatabaseQualityGate, validateDatabaseQualityContract } from './detect-database-quality-gate.mjs'
import { detectGate0BrowserQuality, validateGate0BrowserContract } from './detect-gate0-browser-quality.mjs'
import {
  GATE0_INVENTORY_NAME,
  GATE0_ISOLATION_EVIDENCE_KEYS,
  GATE0_LAB_NAME,
  GATE0_OWNER_MARKER,
  GATE0_POLICY_NAME,
  GATE0_RESERVED_INVENTORY_ID,
  GATE0_RESERVED_LAB_ID,
  GATE0_RESERVED_POLICY_ID,
  GATE0_STAGING_CONFIRMATION,
  legacyConversionConfirmation,
  selectExistingFixtureUser,
  verifyExistingFixtureOwnership,
  verifyFixtureIsolationEvidence,
  verifyLegacyFixtureConversion,
} from './gate0-seed-safety.mjs'
import { fulfillStagingAccessRoute } from './gate0-access-route.mjs'
import { findPagesDeployment, readPagesDeployment } from './read-pages-deployment.mjs'
import {
  materializeWranglerConfig,
  renderWranglerConfig,
  writePagesDeployRedirect,
} from './render-wrangler-config.mjs'
import { verifyReleaseConfiguration } from './verify-cloudflare-release-config.mjs'
import { verifyCloudflareDeployInputs } from './verify-cloudflare-deploy-inputs.mjs'
import {
  fetchTrustedQualityRun,
  findTrustedQualityRun,
  QUALITY_RUN_MAX_AGE_MS,
} from './verify-github-quality-run.mjs'
import {
  fetchTrustedStagingRun,
  findTrustedStagingRun,
} from './verify-github-staging-run.mjs'
import { verifyPagesProjectPair } from './verify-pages-project-config.mjs'
import { loadAndVerifyReleaseManifest, verifyReleaseManifest } from './verify-release-manifest.mjs'
import {
  verifyStagingKoshaLinkOnly,
  verifyStagingKoshaLinkOnlyPayload,
} from './verify-staging-kosha-link-only.mjs'
import {
  isApprovedStagingHostname,
  verifyStagingAccessChallenge,
  verifyStagingAccessProtection,
} from './verify-staging-access.mjs'
import { createReleaseManifest, writeReleaseManifest } from './write-release-manifest.mjs'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const QUALITY_NOW = Date.parse('2026-08-24T12:00:00Z')
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
    STAGING_KOSHA_CONTENT_MODE: 'link_only',
    CLOUDFLARE_ACCOUNT_ID: '1'.repeat(32),
    CLOUDFLARE_API_TOKEN: 'token-value-that-is-long-enough',
    BURILLAB_RUNTIME_CONFIG_KV_ID: staging
      ? 'dcaa52254fa6447bbe7c21f54354ad0d'
      : 'dd6866f35f794a91b0fb5a24cbe57cf3',
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
    VITE_ENABLE_WASTE_V2: 'true',
    VITE_ENABLE_PH_PREDICTION: 'true',
    VITE_ENABLE_CHEMICAL_ENRICHMENT: 'true',
    VITE_ENABLE_SEARCH_ANALYTICS: 'false',
    STAGING_ACCESS_CLIENT_ID: 'access-client-id',
    STAGING_ACCESS_CLIENT_SECRET: 'access-client-secret-value',
    ...(staging ? {
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-value-that-is-long-enough',
      GATE0_E2E_EMAIL: 'gate0-browser@burillab.test',
      GATE0_E2E_PASSWORD: 'Gate0-staging-password-value',
      GATE0_STAGING_SEED_CONFIRMATION: GATE0_STAGING_CONFIRMATION,
    } : {}),
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

  it('selects deployment evidence from stdin without persisting the raw API response', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'burillab-deployment-stdin-'))
    const output = join(directory, 'github-output.txt')
    const summary = join(directory, 'github-summary.md')
    const rawOnlyMarker = 'must-never-be-persisted'
    try {
      const staging = {
        ...deploymentFixture('staging'),
        env_vars: { SECRET_TEXT: { type: 'secret_text', value: rawOnlyMarker } },
      }
      await readPagesDeployment({
        file: '-',
        input: Readable.from([JSON.stringify({ success: true, result: [staging] })]),
        commitSha: COMMIT,
        environment: 'staging',
        project: 'buril-lab-staging',
        outputPath: output,
        summaryPath: summary,
      })

      const persisted = `${await readFile(output, 'utf8')}\n${await readFile(summary, 'utf8')}`
      expect(persisted).not.toContain(rawOnlyMarker)
      await expect(readdir(directory).then((files) => files.sort())).resolves.toEqual([
        'github-output.txt',
        'github-summary.md',
      ])
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

  it('requires every client feature flag to be an explicit lowercase boolean', () => {
    const featureFlags = [
      'VITE_ENABLE_WASTE_V2',
      'VITE_ENABLE_PH_PREDICTION',
      'VITE_ENABLE_CHEMICAL_ENRICHMENT',
      'VITE_ENABLE_SEARCH_ANALYTICS',
    ]

    for (const name of featureFlags) {
      expect(() => verifyCloudflareDeployInputs({
        ...validDeployEnvironment('staging'),
        [name]: '',
      })).toThrow(`${name} must be exactly true or false.`)
      expect(() => verifyCloudflareDeployInputs({
        ...validDeployEnvironment('staging'),
        [name]: 'TRUE',
      })).toThrow(`${name} must be exactly true or false.`)
    }

    expect(() => verifyCloudflareDeployInputs({
      ...validDeployEnvironment('staging'),
      VITE_ENABLE_SEARCH_ANALYTICS: 'true',
    })).toThrow(/approved Gate0 feature profile/)
  })

  it('requires remote Staging fixture credentials before Pages deployment', () => {
    for (const name of [
      'SUPABASE_SERVICE_ROLE_KEY',
      'GATE0_E2E_EMAIL',
      'GATE0_E2E_PASSWORD',
      'GATE0_STAGING_SEED_CONFIRMATION',
    ]) {
      expect(() => verifyCloudflareDeployInputs({
        ...validDeployEnvironment('staging'),
        [name]: '',
      })).toThrow(name)
    }
    expect(() => verifyCloudflareDeployInputs({
      ...validDeployEnvironment('staging'),
      GATE0_E2E_EMAIL: 'not-an-email',
    })).toThrow(/malformed/)
    expect(() => verifyCloudflareDeployInputs({
      ...validDeployEnvironment('staging'),
      SUPABASE_SERVICE_ROLE_KEY: 'anon-key-value-that-is-long-enough',
    })).toThrow(/must not be identical/)
    expect(verifyCloudflareDeployInputs(validDeployEnvironment('production'))).toMatchObject({
      environment: 'production',
    })
  })

  it('deletes only the synthetic user that owns the complete reserved Gate0 fixture', () => {
    const legacyUser = {
      id: '90000000-0000-4000-8000-000000000010',
      email: 'Gate0-Browser@BurilLab.Test',
      user_metadata: { synthetic: true },
    }
    const user = {
      ...legacyUser,
      app_metadata: {
        synthetic: true,
        gate0_owner_marker: GATE0_OWNER_MARKER,
        gate0_lab_id: GATE0_RESERVED_LAB_ID,
      },
    }
    expect(selectExistingFixtureUser([user], 'gate0-browser@burillab.test')).toBe(user)
    expect(verifyExistingFixtureOwnership({
      user,
      lab: { id: GATE0_RESERVED_LAB_ID, created_by: user.id },
      inventory: { lab_id: GATE0_RESERVED_LAB_ID, user_id: user.id },
      policy: { created_by: user.id, activated_by: user.id },
      membership: { lab_id: GATE0_RESERVED_LAB_ID, user_id: user.id, role: 'admin' },
    })).toBe(user)

    expect(() => verifyExistingFixtureOwnership({
      user: legacyUser,
      lab: { id: GATE0_RESERVED_LAB_ID, created_by: legacyUser.id },
      inventory: { lab_id: GATE0_RESERVED_LAB_ID, user_id: legacyUser.id },
      policy: { created_by: legacyUser.id, activated_by: legacyUser.id },
      membership: { lab_id: GATE0_RESERVED_LAB_ID, user_id: legacyUser.id, role: 'admin' },
    })).toThrow(/trusted reserved app_metadata owner marker/)

    expect(() => verifyExistingFixtureOwnership({
      user: { ...user, user_metadata: {} },
      lab: { id: GATE0_RESERVED_LAB_ID, created_by: user.id },
      inventory: null,
      policy: null,
      membership: { lab_id: GATE0_RESERVED_LAB_ID, user_id: user.id, role: 'admin' },
    })).toThrow(/non-synthetic user/)
    expect(() => verifyExistingFixtureOwnership({
      user,
      lab: { id: GATE0_RESERVED_LAB_ID, created_by: 'another-user' },
      inventory: null,
      policy: null,
      membership: { lab_id: GATE0_RESERVED_LAB_ID, user_id: user.id, role: 'admin' },
    })).toThrow(/does not own the reserved lab/)
    expect(() => verifyExistingFixtureOwnership({
      user: null,
      lab: { id: GATE0_RESERVED_LAB_ID, created_by: user.id },
      inventory: null,
      policy: null,
      membership: null,
    })).toThrow(/without its synthetic owner/)

    const partiallyCleanedUser = user
    expect(verifyExistingFixtureOwnership({
      user: partiallyCleanedUser,
      lab: null,
      inventory: null,
      policy: null,
      membership: null,
    })).toBe(partiallyCleanedUser)
    expect(verifyExistingFixtureOwnership({
      user: partiallyCleanedUser,
      lab: { id: GATE0_RESERVED_LAB_ID, created_by: user.id },
      inventory: null,
      policy: null,
      membership: null,
    })).toBe(partiallyCleanedUser)
    expect(() => verifyExistingFixtureOwnership({
      user: legacyUser,
      lab: { id: GATE0_RESERVED_LAB_ID, created_by: legacyUser.id },
      inventory: null,
      policy: null,
      membership: null,
    })).toThrow(/trusted reserved app_metadata owner marker/)
    expect(() => verifyExistingFixtureOwnership({
      user: partiallyCleanedUser,
      lab: { id: GATE0_RESERVED_LAB_ID, created_by: user.id },
      inventory: null,
      policy: null,
      membership: { lab_id: GATE0_RESERVED_LAB_ID, user_id: 'another-user', role: 'admin' },
    })).toThrow(/mismatched reserved membership/)
    expect(() => verifyExistingFixtureOwnership({
      user: partiallyCleanedUser,
      lab: { id: GATE0_RESERVED_LAB_ID, created_by: user.id },
      inventory: null,
      policy: { created_by: 'another-user', activated_by: 'another-user' },
      membership: null,
    })).toThrow(/policy owned outside/)
  })

  it('refuses remote fixture deletion when ownership isolation is incomplete or non-empty', () => {
    const isolated = Object.fromEntries(GATE0_ISOLATION_EVIDENCE_KEYS.map((key) => [key, 0]))
    expect(verifyFixtureIsolationEvidence(isolated)).toBe(true)

    for (const key of GATE0_ISOLATION_EVIDENCE_KEYS) {
      expect(() => verifyFixtureIsolationEvidence({ ...isolated, [key]: 1 }))
        .toThrow(`${key} is not empty`)
    }
    const incomplete = { ...isolated }
    delete incomplete.fixtureMembershipsOutsideReservedLab
    expect(() => verifyFixtureIsolationEvidence(incomplete)).toThrow(/evidence is incomplete/)
    expect(() => verifyFixtureIsolationEvidence({
      ...isolated,
      otherInventoryInsideReservedLab: null,
    })).toThrow(/evidence is incomplete/)
  })

  it('converts legacy ownership only with a user-specific manual confirmation and a complete fixture', () => {
    const user = {
      id: '90000000-0000-4000-8000-000000000010',
      email: 'Gate0-Browser@BurilLab.Test',
      user_metadata: { synthetic: true },
      app_metadata: { provider: 'email' },
    }
    const fixture = {
      user,
      fixtureEmail: 'gate0-browser@burillab.test',
      expectedUserId: user.id,
      confirmation: legacyConversionConfirmation(user.id),
      lab: {
        id: GATE0_RESERVED_LAB_ID,
        name: GATE0_LAB_NAME,
        created_by: user.id,
      },
      inventory: {
        id: GATE0_RESERVED_INVENTORY_ID,
        lab_id: GATE0_RESERVED_LAB_ID,
        user_id: user.id,
        name: GATE0_INVENTORY_NAME,
      },
      policy: {
        id: GATE0_RESERVED_POLICY_ID,
        name: GATE0_POLICY_NAME,
        scope_type: 'system',
        created_by: user.id,
        activated_by: user.id,
      },
      membership: { lab_id: GATE0_RESERVED_LAB_ID, user_id: user.id, role: 'admin' },
    }
    expect(verifyLegacyFixtureConversion(fixture)).toEqual({
      provider: 'email',
      synthetic: true,
      gate0_owner_marker: GATE0_OWNER_MARKER,
      gate0_lab_id: GATE0_RESERVED_LAB_ID,
    })
    expect(() => verifyLegacyFixtureConversion({
      ...fixture,
      confirmation: 'CONVERT LEGACY GATE0 OWNER',
    })).toThrow(/exact user-specific confirmation/)
    expect(() => verifyLegacyFixtureConversion({
      ...fixture,
      inventory: null,
    })).toThrow(/complete reserved inventory/)
    expect(() => verifyLegacyFixtureConversion({
      ...fixture,
      user: {
        ...user,
        app_metadata: { gate0_owner_marker: 'conflicting-owner' },
      },
    })).toThrow(/existing or conflicting/)
  })

  it('keeps the legacy owner converter manual-only and non-destructive', async () => {
    const converter = await readFile('scripts/convert-gate0-legacy-owner.mjs', 'utf8')
    expect(converter).toContain("process.env.GITHUB_ACTIONS === 'true'")
    expect(converter).toContain('GATE0_LEGACY_USER_ID')
    expect(converter).toContain('GATE0_LEGACY_CONVERSION_CONFIRMATION')
    expect(converter).toContain('updateUserById(expectedUserId')
    expect(converter).not.toContain('.deleteUser(')
    expect(converter).not.toMatch(/\.from\([^)]*\)\.delete\(/)
  })

  it('fulfills one Access-protected hop without following a cross-origin redirect', async () => {
    const redirectResponse = { status: 302, headers: { location: 'https://example.test/landing' } }
    const fetch = vi.fn(async () => redirectResponse)
    const fulfill = vi.fn(async () => undefined)
    const route = {
      request: () => ({ headers: () => ({ accept: 'text/html' }) }),
      fetch,
      fulfill,
    }

    await fulfillStagingAccessRoute(route, {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    })

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith({
      headers: {
        accept: 'text/html',
        'CF-Access-Client-Id': 'test-client-id',
        'CF-Access-Client-Secret': 'test-client-secret',
      },
      maxRedirects: 0,
    })
    expect(fulfill).toHaveBeenCalledOnce()
    expect(fulfill).toHaveBeenCalledWith({ response: redirectResponse })
  })

  it('verifies the live Staging KOSHA link-only response through Access', async () => {
    const payload = {
      mode: 'link_only',
      officialUrl: 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do',
      sections: [],
      missingSections: Array.from({ length: 16 }, (_, index) => index + 1),
      complete: false,
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }))

    await expect(verifyStagingKoshaLinkOnly({
      environment: {
        STAGING_ACCESS_CLIENT_ID: 'staging-access-client',
        STAGING_ACCESS_CLIENT_SECRET: 'staging-access-client-secret',
      },
      fetchImplementation: fetchMock,
      retries: 0,
    })).resolves.toEqual(payload)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://staging.burillab.com/api/kosha/msds',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          'CF-Access-Client-Id': 'staging-access-client',
          'CF-Access-Client-Secret': 'staging-access-client-secret',
        },
        cache: 'no-store',
        redirect: 'error',
      }),
    )
  })

  it('rejects full mode, a non-official link, or cached KOSHA sections', () => {
    const valid = {
      mode: 'link_only',
      officialUrl: 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do',
      sections: [],
    }
    expect(() => verifyStagingKoshaLinkOnlyPayload({ ...valid, mode: 'full' }))
      .toThrow(/not link_only/)
    expect(() => verifyStagingKoshaLinkOnlyPayload({ ...valid, officialUrl: '' }))
      .toThrow(/official reference URL/)
    expect(() => verifyStagingKoshaLinkOnlyPayload({ ...valid, sections: [{}] }))
      .toThrow(/must not contain cached sections/)
  })

  it('cleans the synthetic lab cascade before its restricted policy and omits fixture email output', async () => {
    const seedScript = await readFile('scripts/seed-gate0-e2e.mjs', 'utf8')
    const ownershipCheck = seedScript.indexOf('verifyExistingFixtureOwnership({')
    const isolationCheck = seedScript.indexOf('await verifyRemoteFixtureIsolation(fixtureUser.id)')
    const labCleanup = seedScript.indexOf("supabase.from('labs').delete().eq('id', LAB_ID)")
    const policyCleanup = seedScript.indexOf("supabase.from('waste_policy_versions').delete().eq('id', POLICY_ID)")
    const userCleanup = seedScript.indexOf('supabase.auth.admin.deleteUser(fixtureUser.id)')
    const outputBlock = seedScript.slice(seedScript.lastIndexOf('console.log(JSON.stringify'))
    expect(ownershipCheck).toBeGreaterThan(-1)
    expect(isolationCheck).toBeGreaterThan(ownershipCheck)
    expect(labCleanup).toBeGreaterThan(isolationCheck)
    expect(policyCleanup).toBeGreaterThan(labCleanup)
    expect(userCleanup).toBeGreaterThan(policyCleanup)
    expect(outputBlock).not.toContain('email:')
    expect(seedScript).toContain('verifyExistingFixtureOwnership')
    expect(seedScript).toContain('verifyFixtureIsolationEvidence')
    expect(seedScript).toContain(".from('cabinets')")
    expect(seedScript).toContain(".from('waste_logs')")
    expect(seedScript).toContain(".eq('id', POLICY_ID)")
  })

  it('pins each deployment to its approved runtime-config namespace', () => {
    expect(() => verifyCloudflareDeployInputs({
      ...validDeployEnvironment('staging'),
      BURILLAB_RUNTIME_CONFIG_KV_ID: '4'.repeat(32),
    })).toThrow(/approved namespace/)
  })

  it('requires an explicit valid Staging KOSHA content-mode contract', () => {
    for (const value of ['', 'LINK_ONLY', 'disabled']) {
      expect(() => verifyCloudflareDeployInputs({
        ...validDeployEnvironment('staging'),
        STAGING_KOSHA_CONTENT_MODE: value,
      })).toThrow(/STAGING_KOSHA_CONTENT_MODE/)
    }
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

  it('allows Staging to omit KOSHA only under an explicit link_only contract', () => {
    const staging = projectFixture('staging', 'a'.repeat(32))
    const production = projectFixture('production', 'b'.repeat(32))
    delete staging.deployment_configs.production.env_vars.KOSHA_API_KEY

    expect(verifyPagesProjectPair({
      staging,
      production,
      selectedEnvironment: 'staging',
      selectedRuntimeConfigKvId: 'a'.repeat(32),
      stagingKoshaContentMode: 'link_only',
    })).toMatchObject({ stagingKoshaContentMode: 'link_only' })

    expect(() => verifyPagesProjectPair({
      staging,
      production,
      selectedEnvironment: 'staging',
      selectedRuntimeConfigKvId: 'a'.repeat(32),
      stagingKoshaContentMode: 'full',
    })).toThrow(/lacks encrypted server secrets/)

    expect(() => verifyPagesProjectPair({
      staging,
      production,
      selectedEnvironment: 'staging',
      selectedRuntimeConfigKvId: 'a'.repeat(32),
      stagingKoshaContentMode: 'FULL',
    })).toThrow(/STAGING_KOSHA_CONTENT_MODE/)

    delete production.deployment_configs.production.env_vars.KOSHA_API_KEY
    expect(() => verifyPagesProjectPair({
      staging,
      production,
      selectedEnvironment: 'production',
      selectedRuntimeConfigKvId: 'b'.repeat(32),
      stagingKoshaContentMode: 'link_only',
    })).toThrow(/KOSHA_API_KEY/)
  })

  it('rejects old client-prefixed provider secrets', () => {
    const staging = projectFixture('staging', 'a'.repeat(32))
    const production = projectFixture('production', 'b'.repeat(32))

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

  it('accepts fresh successful push and manual main quality runs from the exact repository', () => {
    const trusted = {
      id: 1,
      status: 'completed',
      conclusion: 'success',
      event: 'push',
      head_branch: 'main',
      head_sha: COMMIT,
      head_repository: { full_name: 'owner/buril-lab' },
      created_at: '2026-08-24T10:00:00Z',
      run_started_at: '2026-08-24T10:05:00Z',
      updated_at: '2026-08-24T11:00:00Z',
    }
    expect(findTrustedQualityRun([trusted], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toBe(trusted)
    expect(findTrustedQualityRun([{ ...trusted, id: 2, event: 'workflow_dispatch' }], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toMatchObject({ id: 2, event: 'workflow_dispatch' })

    expect(() => findTrustedQualityRun([
      { ...trusted, event: 'pull_request' },
    ], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/No trusted main/)
    expect(() => findTrustedQualityRun([
      { ...trusted, event: 'workflow_dispatch', head_branch: 'release' },
      { ...trusted, event: 'workflow_dispatch', head_repository: { full_name: 'fork/buril-lab' } },
    ], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/No trusted main/)
  })

  it('lets the newest trusted run block an older success while it is pending or failed', () => {
    const olderSuccess = {
      id: 1,
      status: 'completed',
      conclusion: 'success',
      event: 'push',
      head_branch: 'main',
      head_sha: COMMIT,
      head_repository: { full_name: 'owner/buril-lab' },
      created_at: '2026-08-24T09:00:00Z',
      run_started_at: '2026-08-24T09:05:00Z',
      updated_at: '2026-08-24T09:30:00Z',
    }
    const newerPending = {
      ...olderSuccess,
      id: 2,
      status: 'in_progress',
      conclusion: null,
      created_at: '2026-08-24T10:00:00Z',
      run_started_at: '2026-08-24T10:05:00Z',
      updated_at: '2026-08-24T10:30:00Z',
    }
    expect(() => findTrustedQualityRun([olderSuccess, newerPending], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/not completed successfully/)
    expect(() => findTrustedQualityRun([
      { ...newerPending, status: 'completed', conclusion: 'failure' },
      olderSuccess,
    ], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/not completed successfully/)
  })

  it('uses the current attempt start so a rerun of an older-created run blocks an older success', () => {
    const laterCreatedSuccess = {
      id: 10,
      run_attempt: 1,
      status: 'completed',
      conclusion: 'success',
      event: 'push',
      head_branch: 'main',
      head_sha: COMMIT,
      head_repository: { full_name: 'owner/buril-lab' },
      created_at: '2026-08-24T10:00:00Z',
      run_started_at: '2026-08-24T10:05:00Z',
      updated_at: '2026-08-24T10:30:00Z',
    }
    const olderCreatedRerun = {
      ...laterCreatedSuccess,
      id: 9,
      run_attempt: 2,
      status: 'completed',
      conclusion: 'failure',
      created_at: '2026-08-24T09:00:00Z',
      run_started_at: '2026-08-24T11:00:00Z',
      updated_at: '2026-08-24T11:30:00Z',
    }
    expect(() => findTrustedQualityRun([laterCreatedSuccess, olderCreatedRerun], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/not completed successfully/)
  })

  it('rejects stale, future-dated, and internally inconsistent quality evidence', () => {
    const trusted = {
      id: 1,
      status: 'completed',
      conclusion: 'success',
      event: 'push',
      head_branch: 'main',
      head_sha: COMMIT,
      head_repository: { full_name: 'owner/buril-lab' },
      created_at: '2026-08-24T10:00:00Z',
      run_started_at: '2026-08-24T10:05:00Z',
      updated_at: '2026-08-24T11:00:00Z',
    }
    expect(() => findTrustedQualityRun([{
      ...trusted,
      created_at: new Date(QUALITY_NOW - QUALITY_RUN_MAX_AGE_MS - 60_000).toISOString(),
      run_started_at: new Date(QUALITY_NOW - QUALITY_RUN_MAX_AGE_MS - 30_000).toISOString(),
      updated_at: new Date(QUALITY_NOW - QUALITY_RUN_MAX_AGE_MS - 1).toISOString(),
    }], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/created more than eight days ago/)
    expect(() => findTrustedQualityRun([{
      ...trusted,
      created_at: new Date(QUALITY_NOW - QUALITY_RUN_MAX_AGE_MS - 1).toISOString(),
      run_started_at: '2026-08-24T10:30:00Z',
      updated_at: '2026-08-24T11:00:00Z',
    }], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/created more than eight days ago/)
    expect(() => findTrustedQualityRun([{
      ...trusted,
      created_at: '2026-08-24T12:06:00Z',
      run_started_at: '2026-08-24T12:06:00Z',
      updated_at: '2026-08-24T12:06:00Z',
    }], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/future timestamp/)
    expect(() => findTrustedQualityRun([{
      ...trusted,
      updated_at: '2026-08-24T09:59:59Z',
    }], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/timestamps are inconsistent/)
    expect(() => findTrustedQualityRun([{
      ...trusted,
      run_started_at: null,
    }], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/lacks run_started_at/)
  })

  it('requests all run states so a newer pending or failed run cannot be hidden', async () => {
    const trusted = {
      id: 1,
      status: 'completed',
      conclusion: 'success',
      event: 'push',
      head_branch: 'main',
      head_sha: COMMIT,
      head_repository: { full_name: 'owner/buril-lab' },
      created_at: '2026-08-24T10:00:00Z',
      run_started_at: '2026-08-24T10:05:00Z',
      updated_at: '2026-08-24T11:00:00Z',
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ workflow_runs: [trusted] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(fetchTrustedQualityRun({
        GITHUB_TOKEN: 'not-a-real-token',
        GITHUB_REPOSITORY: 'owner/buril-lab',
        DEPLOY_COMMIT_SHA: COMMIT,
      }, { now: QUALITY_NOW })).resolves.toStrictEqual(trusted)
      const endpoint = new URL(String(fetchMock.mock.calls[0][0]))
      expect(endpoint.searchParams.get('head_sha')).toBe(COMMIT)
      expect(endpoint.searchParams.has('status')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('requires the latest exact-SHA Deploy staging run to succeed', () => {
    const olderSuccess = {
      id: 31,
      run_attempt: 1,
      status: 'completed',
      conclusion: 'success',
      event: 'workflow_run',
      head_branch: 'main',
      head_sha: COMMIT,
      head_repository: { full_name: 'owner/buril-lab' },
      created_at: '2026-08-24T09:00:00Z',
      run_started_at: '2026-08-24T09:05:00Z',
      updated_at: '2026-08-24T09:30:00Z',
    }
    expect(findTrustedStagingRun([olderSuccess], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toBe(olderSuccess)

    const newerPending = {
      ...olderSuccess,
      id: 32,
      status: 'queued',
      conclusion: null,
      created_at: '2026-08-24T10:00:00Z',
      run_started_at: '2026-08-24T10:05:00Z',
      updated_at: '2026-08-24T10:05:00Z',
    }
    expect(() => findTrustedStagingRun([olderSuccess, newerPending], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/not completed successfully/)
    expect(() => findTrustedStagingRun([
      olderSuccess,
      { ...newerPending, status: 'completed', conclusion: 'failure' },
    ], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/not completed successfully/)
    expect(() => findTrustedStagingRun([
      { ...olderSuccess, event: 'workflow_dispatch' },
      { ...olderSuccess, head_repository: { full_name: 'fork/buril-lab' } },
    ], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/No trusted Deploy staging run/)
  })

  it('queries every status of the exact-SHA deploy-staging workflow', async () => {
    const trusted = {
      id: 31,
      status: 'completed',
      conclusion: 'success',
      event: 'workflow_run',
      head_branch: 'main',
      head_sha: COMMIT,
      head_repository: { full_name: 'owner/buril-lab' },
      created_at: '2026-08-24T10:00:00Z',
      run_started_at: '2026-08-24T10:05:00Z',
      updated_at: '2026-08-24T11:00:00Z',
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ workflow_runs: [trusted] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(fetchTrustedStagingRun({
        GITHUB_TOKEN: 'not-a-real-token',
        GITHUB_REPOSITORY: 'owner/buril-lab',
        DEPLOY_COMMIT_SHA: COMMIT,
      }, { now: QUALITY_NOW })).resolves.toStrictEqual(trusted)
      const endpoint = new URL(String(fetchMock.mock.calls[0][0]))
      expect(endpoint.pathname).toBe('/repos/owner/buril-lab/actions/workflows/deploy-staging.yml/runs')
      expect(endpoint.searchParams.get('head_sha')).toBe(COMMIT)
      expect(endpoint.searchParams.has('status')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
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
    const [
      productionRaw,
      stagingRaw,
      stagingWorkflow,
      productionWorkflow,
      qualityWorkflow,
      stagingPlaywrightConfig,
      gate0AccessRoute,
      gate0Spec,
    ] = await Promise.all([
      readFile('wrangler.jsonc', 'utf8'),
      readFile('wrangler.staging.jsonc', 'utf8'),
      readFile('.github/workflows/deploy-staging.yml', 'utf8'),
      readFile('.github/workflows/deploy-production.yml', 'utf8'),
      readFile('.github/workflows/quality.yml', 'utf8'),
      readFile('playwright.staging.config.ts', 'utf8'),
      readFile('scripts/gate0-access-route.mjs', 'utf8'),
      readFile('e2e/gate0/gate0.spec.ts', 'utf8'),
    ])
    const configuration = {
      productionRaw,
      stagingRaw,
      workflows: {
        staging: stagingWorkflow,
        production: productionWorkflow,
        quality: qualityWorkflow,
      },
      browser: {
        stagingConfig: stagingPlaywrightConfig,
        accessRoute: gate0AccessRoute,
        gate0Spec,
      },
    }
    expect(verifyReleaseConfiguration(configuration)).toMatchObject({ projectCount: 2 })

    for (const unsupported of ['keep_vars', 'secrets']) {
      const invalidProduction = JSON.parse(productionRaw)
      invalidProduction[unsupported] = unsupported === 'keep_vars'
        ? true
        : { required: ['SUPABASE_URL'] }
      expect(() => verifyReleaseConfiguration({
        ...configuration,
        productionRaw: JSON.stringify(invalidProduction),
      })).toThrow(/Worker-only keys that Pages rejects/)
    }

    const oneQualityVerification = productionWorkflow.replace(
      'run: node scripts/verify-github-quality-run.mjs',
      'run: echo "removed early quality verification"',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: oneQualityVerification },
    })).toThrow(/both early and immediately before deployment/)

    const oneStagingRunVerification = productionWorkflow.replace(
      'run: node scripts/verify-github-staging-run.mjs',
      'run: echo "removed early Staging-run verification"',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: oneStagingRunVerification },
    })).toThrow(/latest exact-SHA Staging run both early and immediately before deployment/)

    const outOfOrderFinalGuards = productionWorkflow
      .replace('Recheck production Supabase Security Advisor immediately before deployment', '__ADVISOR__')
      .replace('Recheck the exact commit still passes trusted main quality', 'Recheck production Supabase Security Advisor immediately before deployment')
      .replace('__ADVISOR__', 'Recheck the exact commit still passes trusted main quality')
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: outOfOrderFinalGuards },
    })).toThrow(/guards are out of order/)

    const rawDeploymentFileWorkflow = `${stagingWorkflow}\n--output .wrangler/evidence/staging-deployments.json`
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, staging: rawDeploymentFileWorkflow },
    })).toThrow(/must not persist the raw Pages deployment-list response/)

    const rawProductionDeploymentFileWorkflow = `${productionWorkflow}\n--output .wrangler/evidence/production-deployments.json`
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: rawProductionDeploymentFileWorkflow },
    })).toThrow(/must not persist the raw Pages deployment-list response/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      browser: {
        ...configuration.browser,
        stagingConfig: `${stagingPlaywrightConfig}\nextraHTTPHeaders: {}`,
      },
    })).toThrow(/context-wide headers/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      browser: {
        ...configuration.browser,
        accessRoute: gate0AccessRoute.replace('maxRedirects: 0', 'maxRedirects: 20'),
      },
    })).toThrow(/one-hop redirect boundary/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      browser: {
        ...configuration.browser,
        gate0Spec: `${gate0Spec}\nroute.continue({ headers: {} })`,
      },
    })).toThrow(/must not continue credentials across a redirect chain/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: `${stagingWorkflow}\nnode scripts/convert-gate0-legacy-owner.mjs`,
      },
    })).toThrow(/manual-only operation/)

    const legacyServiceRoleSecret = stagingWorkflow.replaceAll(
      'secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY',
      'secrets.SUPABASE_SERVICE_ROLE_KEY',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, staging: legacyServiceRoleSecret },
    })).toThrow(/staging-prefixed Supabase service-role secret/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: stagingWorkflow.replace('--connect-timeout 10', '--connect-timeout 9'),
      },
    })).toThrow(/bounded curl timeouts/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        production: productionWorkflow.replace('--max-time 30', '--max-time 29'),
      },
    })).toThrow(/bounded curl timeouts/)

    const outOfOrderStagingFixture = stagingWorkflow
      .replace('Reset the exact Staging Gate 0 synthetic fixture', '__FIXTURE__')
      .replace('Run the protected Staging Gate 0 browser flow', 'Reset the exact Staging Gate 0 synthetic fixture')
      .replace('__FIXTURE__', 'Run the protected Staging Gate 0 browser flow')
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, staging: outOfOrderStagingFixture },
    })).toThrow(/synthetic reset, and browser gates are out of order/)
  })
})
