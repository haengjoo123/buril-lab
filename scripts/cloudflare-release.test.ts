import { lstat, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
import { verifyGate0EnrichmentIsolation } from './gate0-enrichment-policy.mjs'
import {
  buildStagingGate0TargetConfirmation,
  GATE0_STAGING_CUSTOM_ORIGIN,
  isStagingGate0AccessRequest,
  resolveStagingGate0Target,
  stagingGate0AccessRoutePatterns,
} from './gate0-staging-target.mjs'
import { findPagesDeployment, readPagesDeployment } from './read-pages-deployment.mjs'
import { verifyPagesFunctionsRoutes } from './verify-pages-functions-routes.mjs'
import {
  readWranglerPagesDeployOutput,
  verifyWranglerPagesDeployOutput,
} from './verify-wrangler-pages-deploy-output.mjs'
import {
  materializeWranglerConfig,
  renderWranglerConfig,
  writePagesDeployRedirect,
} from './render-wrangler-config.mjs'
import {
  verifyCloudflareApiHelperSource,
  verifyReleaseConfiguration,
  verifyStorageBackupWorkerTokenDocumentation,
} from './verify-cloudflare-release-config.mjs'
import { publicKeyFingerprint, signAttestation } from './ephemeral-release-attestation.mjs'
import {
  verifyCloudflareDeployInputs,
  verifyCloudflareWorkerDeployInputs,
} from './verify-cloudflare-deploy-inputs.mjs'
import {
  cleanupStorageBackupSecretFile,
  createStorageBackupSecretFile,
  verifyStagingSupabaseBackendCredential,
} from './storage-backup-secret-file.mjs'
import { verifyStorageBackupRuntimeOff } from './verify-storage-backup-runtime-off.mjs'
import {
  verifyStorageBackupWorkerDeployment,
  verifyStorageBackupWorkerSecretPreflight,
  verifyStorageBackupWorkerSurface,
  verifyWranglerWorkerDeployOutput,
} from './verify-storage-backup-worker-deployment.mjs'
import {
  fetchTrustedQualityRun,
  findTrustedQualityRun,
  QUALITY_RUN_MAX_AGE_MS,
} from './verify-github-quality-run.mjs'
import {
  fetchTrustedStagingRun,
  findTrustedStagingRun,
  verifyTrustedStagingJobs,
} from './verify-github-staging-run.mjs'
import { CLEANUP_ABSENT_SECRET_NAMES } from './verify-ephemeral-cleanup-receipt.mjs'
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
const STAGING_DEPLOYMENT_ID = '123e4567-e89b-42d3-a456-426614174000'
const STAGING_IMMUTABLE_ORIGIN = 'https://123e4567.buril-lab-staging.pages.dev'
const QUALITY_NOW = Date.parse('2026-08-24T12:00:00Z')
const STAGING_CLOUDFLARE_ACCOUNT_ID = '692fedd5b67a5fd545bb16038bbd4c85'
const STAGING_RUNTIME_CONFIG_KV_ID = 'dcaa52254fa6447bbe7c21f54354ad0d'
const STAGING_BACKUP_BUCKET = 'buril-lab-cabinet-backups-staging'
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

const REQUIRED_STAGING_JOB_STEPS = [
  'Validate the supervised Staging confirmation',
  'Capture the clean Staging deploy runner boundary',
  'Download the exact Staging release artifact',
  'Independently verify the uploaded Staging artifact archive digest',
  'Verify and activate the exact Staging release artifact',
  'Verify the signed current ephemeral lease',
  'Verify exact ephemeral credentials reached the runner',
  'Verify the signed cumulative credential cleanup receipt',
  'Verify the exact commit passed trusted main quality',
  'Verify the current Staging Supabase Advisor state',
  'Verify environment-scoped deployment inputs',
  'Recheck the exact commit still passes trusted main quality',
  'Recheck the current Staging Supabase Advisor state before Pages deployment',
  'Recheck the active Staging Pages token and deployment inputs at the mutation boundary',
  'Recheck the signed Staging cleanup receipt at the Pages mutation boundary',
  'Recheck the signed Staging lease with ten minutes remaining for Pages mutation',
  'Deploy the exact commit to Staging Pages',
  'Verify the protected Staging release manifest',
  'Run the protected custom-domain Staging Gate 0 browser flow',
  'Run the protected immutable-deployment Staging Gate 0 browser flow',
  'Record Pages deployment evidence',
]

const REQUIRED_STAGING_BUILD_JOB_STEPS = [
  'Validate the credential-free Staging build request',
  'Check out the exact Staging build commit',
  'Verify the Staging build commit is current main',
  'Set up Node.js for the Staging build',
  'Install locked Staging build dependencies',
  'Build the Staging artifact',
  'Compile Staging Pages Functions without deployment credentials',
  'Attach and verify the public release identity',
  'Create the exact Staging artifact manifest',
  'Upload the exact Staging release artifact',
]

function trustedStagingJob(runId = 31) {
  return {
    id: 301,
    run_id: runId,
    name: 'Supervised deploy of verified commit to buril-lab-staging',
    status: 'completed',
    conclusion: 'success',
    steps: REQUIRED_STAGING_JOB_STEPS.map((name, index) => ({
      number: index + 1,
      name,
      status: 'completed',
      conclusion: 'success',
    })),
  }
}

function trustedStagingBuildJob(runId = 31) {
  return {
    id: 300,
    run_id: runId,
    name: 'Build exact Staging artifact without deployment credentials',
    status: 'completed',
    conclusion: 'success',
    steps: REQUIRED_STAGING_BUILD_JOB_STEPS.map((name, index) => ({
      number: index + 1,
      name,
      status: 'completed',
      conclusion: 'success',
    })),
  }
}

function trustedStagingWorkerJob(runId = 31) {
  return {
    id: 302,
    run_id: runId,
    name: 'Supervised fresh-runner deploy of the OFF-only Staging backup Worker',
    status: 'completed',
    conclusion: 'skipped',
    steps: [],
  }
}

function trustedStagingJobs(runId = 31) {
  return [trustedStagingBuildJob(runId), trustedStagingJob(runId), trustedStagingWorkerJob(runId)]
}

function signedStagingCleanupReceipt(
  stagingRun: { id: number; run_attempt: number; display_title: string },
  keys: ReturnType<typeof generateKeyPairSync>,
) {
  const title = String(stagingRun.display_title).match(
    /^Deploy staging ([0-9a-f]{40}) \(lease=([0-9a-f]{32}), storage-backup=(true|false)\)$/,
  )
  if (!title) throw new Error('Staging cleanup test fixture title is invalid')
  return signAttestation({
    version: 3,
    kind: 'cleanup_receipt',
    environment: 'staging',
    workflow: 'deploy-staging.yml',
    issued_at: '2026-08-24T11:20:00Z',
    sequence: 1,
    legacy_verification_mode: 'operator_dashboard_attestation',
    github_secrets_absent: [...CLEANUP_ABSENT_SECRET_NAMES],
    legacy_credentials: [
      { provider: 'cloudflare', credential_id_hash: '1'.repeat(64), status: 'operator_verified_absent' },
      { provider: 'supabase', credential_id_hash: '2'.repeat(64), status: 'operator_verified_absent' },
    ],
    leases: [{
      run_id: String(stagingRun.id),
      run_attempt: stagingRun.run_attempt,
      commit_sha: title[1],
      lease_id: title[2],
      storage_backup: title[3] === 'true',
      closed_at: '2026-08-24T11:10:00Z',
      previous_cleanup_receipt_sha256: '9'.repeat(64),
      cloudflare_token_id_hashes: title[3] === 'true'
        ? ['3'.repeat(64), '4'.repeat(64)]
        : ['3'.repeat(64)],
      supabase_pat_label_hash: '5'.repeat(64),
      supabase_pat_sha256: '6'.repeat(64),
      providers_inactive: true,
    }],
    supervisor_key_id: publicKeyFingerprint(keys.publicKey),
  }, keys.privateKey)
}

function cloudflareEnvelope(result: unknown, extras: Record<string, unknown> = {}) {
  return JSON.stringify({
    errors: [],
    messages: [],
    result,
    success: true,
    ...extras,
  })
}

function storageBackupBindingsFixture() {
  return [
    {
      name: 'BURILLAB_RUNTIME_CONFIG',
      namespace_id: STAGING_RUNTIME_CONFIG_KV_ID,
      type: 'kv_namespace',
    },
    {
      bucket_name: STAGING_BACKUP_BUCKET,
      name: 'CABINET_BACKUPS',
      type: 'r2_bucket',
    },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', type: 'secret_text' },
    { name: 'BACKUP_ENVIRONMENT', text: 'staging', type: 'plain_text' },
    { name: 'SUPABASE_PROJECT_REF', text: 'qpgnomuqdcucjmxrunnw', type: 'plain_text' },
    { name: 'SUPABASE_URL', text: 'https://qpgnomuqdcucjmxrunnw.supabase.co', type: 'plain_text' },
    { name: 'SOURCE_POINTER_MODE', text: 'legacy_url', type: 'plain_text' },
    { name: 'SOURCE_STORAGE_BUCKET', text: 'cabinets', type: 'plain_text' },
    { name: 'WORKERS_SUBREQUEST_LIMIT', text: '700', type: 'plain_text' },
    { name: 'WORKERS_USAGE_PLAN', text: 'paid', type: 'plain_text' },
  ]
}

function validStorageBackupSurfaceRaw() {
  return {
    bindingsRaw: cloudflareEnvelope(storageBackupBindingsFixture()),
    routesRaw: cloudflareEnvelope([]),
    domainsRaw: cloudflareEnvelope([], {
      errors: null,
      messages: null,
      result_info: {
        count: 0,
        page: 1,
        per_page: 0,
        total_count: 0,
      },
    }),
    subdomainRaw: cloudflareEnvelope({ enabled: false, previews_enabled: false }),
    serviceRaw: cloudflareEnvelope({
      environment: 'production',
      script: {
        id: 'buril-lab-storage-backup-staging',
        compatibility_date: '2026-08-20',
        compatibility_flags: ['nodejs_compat'],
        handlers: ['scheduled'],
        named_handlers: [],
        tail_consumers: [],
        limits: { subrequests: 700 },
        placement_mode: null,
      },
    }),
    schedulesRaw: cloudflareEnvelope({
      schedules: [{
        cron: '15 17 * * *',
        created_on: '2026-08-25T01:02:03.000Z',
        modified_on: '2026-08-25T01:02:03.000Z',
      }],
    }),
  }
}

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
    PAGES_EPHEMERAL_TOKEN: 'pages-token-value-that-is-long-enough',
    DEPLOY_STORAGE_BACKUP: 'false',
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
        commit_message: production
          ? 'approved production run 42 lease 0123456789abcdef0123456789abcdef'
          : 'quality-approved staging run 42 lease 0123456789abcdef0123456789abcdef',
      },
    },
    latest_stage: { name: 'deploy', status: 'success' },
    ...overrides,
  }
}

function wranglerOutputFixture(environment: 'staging' | 'production') {
  const production = environment === 'production'
  const project = production ? 'buril-lab' : 'buril-lab-staging'
  const url = `https://123e4567.${project}.pages.dev`
  const deployMessage = production
    ? 'approved production run 42 lease 0123456789abcdef0123456789abcdef'
    : 'quality-approved staging run 42 lease 0123456789abcdef0123456789abcdef'
  return [
    {
      type: 'wrangler-session',
      version: 1,
      wrangler_version: '4.125.0',
      command_line_args: [
        'pages', 'deploy', 'dist',
        '--project-name', project,
        '--branch', 'main',
        '--commit-hash', COMMIT,
        '--commit-message', deployMessage,
        '--commit-dirty=false',
        '--no-bundle',
      ],
      log_file_path: '/tmp/wrangler-debug.log',
      timestamp: '2026-08-25T01:00:01.000Z',
    },
    {
      type: 'pages-deploy',
      version: 1,
      pages_project: project,
      deployment_id: '123e4567-e89b-42d3-a456-426614174000',
      url,
      timestamp: '2026-08-25T01:00:02.000Z',
    },
    {
      type: 'pages-deploy-detailed',
      version: 1,
      pages_project: project,
      deployment_id: '123e4567-e89b-42d3-a456-426614174000',
      url,
      alias: `main.${project}.pages.dev`,
      environment: 'production',
      production_branch: 'main',
      deployment_trigger: { metadata: { commit_hash: COMMIT } },
      timestamp: '2026-08-25T01:00:03.000Z',
    },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n'
}

function validGate0TargetEnvironment(origin = STAGING_IMMUTABLE_ORIGIN) {
  const confirmation = buildStagingGate0TargetConfirmation({
    origin,
    commitSha: COMMIT,
    deploymentId: STAGING_DEPLOYMENT_ID,
  })
  return {
    GATE0_BASE_URL: origin,
    GATE0_EXPECTED_COMMIT_SHA: COMMIT,
    GATE0_EXPECTED_DEPLOYMENT_ID: STAGING_DEPLOYMENT_ID,
    GATE0_STAGING_TARGET_CONFIRMATION: confirmation,
  }
}

describe('Prep 0 Cloudflare release controls', () => {
  it('keeps the precompiled Pages Worker routed only to /api/*', () => {
    const routes = {
      version: 1,
      description: 'Generated by wrangler@4.125.0',
      include: ['/api/*'],
      exclude: [],
    }
    expect(verifyPagesFunctionsRoutes(routes)).toBe(true)
    expect(() => verifyPagesFunctionsRoutes({ ...routes, include: ['/*'] })).toThrow(/exact Wrangler/)
    expect(() => verifyPagesFunctionsRoutes({ ...routes, exclude: ['/assets/*'] })).toThrow(/exact Wrangler/)
    expect(() => verifyPagesFunctionsRoutes({ ...routes, unexpected: true })).toThrow(/exact Wrangler/)
  })
  it('keeps Gate0 enrichment disabled locally and bounded behind an abort in Staging', () => {
    expect(verifyGate0EnrichmentIsolation({
      featureFlag: 'false',
      blockedRequests: 0,
    })).toEqual({ featureEnabled: false, blockedRequests: 0 })
    for (const blockedRequests of [1, 2, 3]) {
      expect(verifyGate0EnrichmentIsolation({
        featureFlag: 'true',
        blockedRequests,
      })).toEqual({ featureEnabled: true, blockedRequests })
    }

    expect(() => verifyGate0EnrichmentIsolation({
      featureFlag: 'false',
      blockedRequests: 1,
    })).toThrow(/Disabled chemical enrichment/)
    for (const blockedRequests of [0, 4]) {
      expect(() => verifyGate0EnrichmentIsolation({
        featureFlag: 'true',
        blockedRequests,
      })).toThrow(/attempt budget/)
    }
    for (const blockedRequests of [-1, 1.5]) {
      expect(() => verifyGate0EnrichmentIsolation({
        featureFlag: 'false',
        blockedRequests,
      })).toThrow(/non-negative integer/)
    }
    expect(() => verifyGate0EnrichmentIsolation({
      featureFlag: 'unset',
      blockedRequests: 0,
    })).toThrow(/exactly true or false/)
  })

  it('binds Gate0 to the exact Staging custom or immutable deployment target', () => {
    const immutable = resolveStagingGate0Target(validGate0TargetEnvironment())
    expect(immutable).toEqual({
      origin: STAGING_IMMUTABLE_ORIGIN,
      commitSha: COMMIT,
      deploymentId: STAGING_DEPLOYMENT_ID,
      accessRoutePatterns: [
        `${STAGING_IMMUTABLE_ORIGIN}/**`,
        `${GATE0_STAGING_CUSTOM_ORIGIN}/api/**`,
      ],
    })
    expect(stagingGate0AccessRoutePatterns({
      targetOrigin: STAGING_IMMUTABLE_ORIGIN,
      deploymentId: STAGING_DEPLOYMENT_ID,
    })).toEqual([
      `${STAGING_IMMUTABLE_ORIGIN}/**`,
      `${GATE0_STAGING_CUSTOM_ORIGIN}/api/**`,
    ])

    const customEnvironment = validGate0TargetEnvironment(GATE0_STAGING_CUSTOM_ORIGIN)
    customEnvironment.GATE0_EXPECTED_DEPLOYMENT_ID = 'abcdef01-e89b-42d3-a456-426614174000'
    customEnvironment.GATE0_STAGING_TARGET_CONFIRMATION = buildStagingGate0TargetConfirmation({
      origin: GATE0_STAGING_CUSTOM_ORIGIN,
      commitSha: COMMIT,
      deploymentId: customEnvironment.GATE0_EXPECTED_DEPLOYMENT_ID,
    })
    const custom = resolveStagingGate0Target(customEnvironment)
    expect(custom.origin).toBe(GATE0_STAGING_CUSTOM_ORIGIN)
    expect(custom.accessRoutePatterns).toEqual([`${GATE0_STAGING_CUSTOM_ORIGIN}/**`])
  })

  it('rejects non-exact, production, mutable, nested, and deceptive Gate0 origins', () => {
    const invalidOrigins = [
      'http://staging.burillab.com',
      'https://staging.burillab.com/',
      'https://staging.burillab.com/path',
      'https://staging.burillab.com?query=1',
      'https://staging.burillab.com#fragment',
      'https://user:password@staging.burillab.com',
      'https://staging.burillab.com:443',
      'https://burillab.com',
      'https://buril-lab-staging.pages.dev',
      'https://staging-id.buril-lab.pages.dev',
      'https://main.buril-lab-staging.pages.dev',
      'https://feature-branch.buril-lab-staging.pages.dev',
      'https://arbitrary.buril-lab-staging.pages.dev',
      'https://123e456.buril-lab-staging.pages.dev',
      'https://123e45678.buril-lab-staging.pages.dev',
      'https://ABCDEF01.buril-lab-staging.pages.dev',
      'https://nested.staging-id.buril-lab-staging.pages.dev',
      'https://staging-id.buril-lab-staging.pages.dev.evil.test',
      'https://staging-id.evil.pages.dev',
      ' https://staging-id.buril-lab-staging.pages.dev',
    ]

    for (const origin of invalidOrigins) {
      expect(() => resolveStagingGate0Target({
        ...validGate0TargetEnvironment(),
        GATE0_BASE_URL: origin,
      })).toThrow(/exact|BurilLab Staging/)
    }

    const mismatchedImmutableOrigin = 'https://deadbeef.buril-lab-staging.pages.dev'
    expect(() => resolveStagingGate0Target({
      ...validGate0TargetEnvironment(),
      GATE0_BASE_URL: mismatchedImmutableOrigin,
      GATE0_STAGING_TARGET_CONFIRMATION: `RUN GATE0 buril-lab-staging ${STAGING_DEPLOYMENT_ID} ${COMMIT} ${mismatchedImmutableOrigin}`,
    })).toThrow(/must match the deployment UUID prefix/)
  })

  it('rejects an invalid Gate0 SHA, deployment UUID, or exact confirmation', () => {
    const valid = validGate0TargetEnvironment()
    for (const commitSha of ['01234567', COMMIT.toUpperCase(), `${COMMIT}0`]) {
      expect(() => resolveStagingGate0Target({
        ...valid,
        GATE0_EXPECTED_COMMIT_SHA: commitSha,
      })).toThrow(/full 40-character Git SHA/)
    }
    for (const deploymentId of [
      'not-a-uuid',
      '123e4567-e89b-02d3-a456-426614174000',
      STAGING_DEPLOYMENT_ID.toUpperCase(),
    ]) {
      expect(() => resolveStagingGate0Target({
        ...valid,
        GATE0_EXPECTED_DEPLOYMENT_ID: deploymentId,
      })).toThrow(/deployment UUID/)
    }
    for (const confirmation of [
      '',
      `${valid.GATE0_STAGING_TARGET_CONFIRMATION} `,
      valid.GATE0_STAGING_TARGET_CONFIRMATION.replace(COMMIT, 'f'.repeat(40)),
      valid.GATE0_STAGING_TARGET_CONFIRMATION.replace(STAGING_IMMUTABLE_ORIGIN, GATE0_STAGING_CUSTOM_ORIGIN),
    ]) {
      expect(() => resolveStagingGate0Target({
        ...valid,
        GATE0_STAGING_TARGET_CONFIRMATION: confirmation,
      })).toThrow(/does not match/)
    }
  })

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

  it('binds post-deploy evidence to the exact newly created ID, URL, boundary, and unique message', () => {
    const message = 'quality-approved staging run 42 lease 0123456789abcdef0123456789abcdef'
    const olderSameSha = deploymentFixture('staging', {
      id: '123e4567-e89b-42d3-a456-426614174099',
      short_id: 'old-same',
      url: 'https://old-same.buril-lab-staging.pages.dev',
      created_on: '2026-08-25T00:59:00Z',
    })
    const exact = deploymentFixture('staging', {
      id: '123e4567-e89b-42d3-a456-426614174000',
      short_id: 'staging-id',
      url: 'https://staging-id.buril-lab-staging.pages.dev',
      created_on: '2026-08-25T01:00:03Z',
    })
    const options = {
      environment: 'staging',
      project: 'buril-lab-staging',
      deploymentId: exact.id,
      deploymentUrl: exact.url,
      notBefore: '2026-08-25T01:00:00Z',
      commitMessage: message,
      now: Date.parse('2026-08-25T01:01:00Z'),
    }
    expect(findPagesDeployment({ success: true, result: [olderSameSha, exact] }, COMMIT, options))
      .toMatchObject({ id: exact.id, url: exact.url })
    expect(() => findPagesDeployment({ success: true, result: [olderSameSha] }, COMMIT, options))
      .toThrow(/No successful/)
    expect(() => findPagesDeployment({ success: true, result: [{
      ...exact,
      created_on: '2026-08-25T00:59:59Z',
    }] }, COMMIT, options)).toThrow(/No successful/)
    expect(() => findPagesDeployment({ success: true, result: [{
      ...exact,
      deployment_trigger: {
        metadata: { ...exact.deployment_trigger.metadata, commit_message: 'older release' },
      },
    }] }, COMMIT, options)).toThrow(/No successful/)

    const stagingRunBound = {
      environment: 'staging',
      project: 'buril-lab-staging',
      notBefore: '2026-08-25T01:00:00Z',
      notAfter: '2026-08-25T01:01:00Z',
      commitMessage: message,
      now: Date.parse('2026-08-25T01:02:00Z'),
    }
    expect(findPagesDeployment({ success: true, result: [olderSameSha, exact] }, COMMIT, stagingRunBound))
      .toMatchObject({ id: exact.id })
    expect(() => findPagesDeployment({ success: true, result: [{
      ...exact,
      created_on: '2026-08-25T01:01:01Z',
    }] }, COMMIT, stagingRunBound)).toThrow(/No successful/)
  })

  it('accepts only the exact pinned Wrangler Pages structured-output contract', async () => {
    const raw = wranglerOutputFixture('staging')
    const options = {
      commitSha: COMMIT,
      environment: 'staging',
      project: 'buril-lab-staging',
      startedAt: '2026-08-25T01:00:00Z',
      now: Date.parse('2026-08-25T01:01:00Z'),
    }
    expect(verifyWranglerPagesDeployOutput(raw, options)).toMatchObject({
      deploymentId: '123e4567-e89b-42d3-a456-426614174000',
      deploymentUrl: 'https://123e4567.buril-lab-staging.pages.dev',
      commitSha: COMMIT,
    })
    expect(verifyWranglerPagesDeployOutput(raw.replace(
      '"alias":"main.buril-lab-staging.pages.dev",',
      '',
    ), options)).toMatchObject({
      deploymentId: '123e4567-e89b-42d3-a456-426614174000',
    })
    expect(() => verifyWranglerPagesDeployOutput(raw.replace(
      '"alias":"main.buril-lab-staging.pages.dev",',
      '"alias":false,',
    ), options)).toThrow(/alias is invalid/)
    expect(() => verifyWranglerPagesDeployOutput(raw.replace(COMMIT, 'f'.repeat(40)), options))
      .toThrow(/pinned Wrangler command contract/)
    expect(() => verifyWranglerPagesDeployOutput(raw, {
      ...options,
      startedAt: '2026-08-25T01:02:01Z',
    })).toThrow(/time boundary/)
    expect(() => verifyWranglerPagesDeployOutput(raw.replace(
      '"pages_project":"buril-lab-staging"',
      '"pages_project":"buril-lab-staging","unexpected":true',
    ), options)).toThrow(/fields differ/)
    expect(() => verifyWranglerPagesDeployOutput(raw.replace(
      '"timestamp":"2026-08-25T01:00:01.000Z"',
      '"timestamp":"2026-08-25T00:58:00.000Z"',
    ), options)).toThrow(/time boundary/)
    expect(() => verifyWranglerPagesDeployOutput(raw.replace(
      '"--no-bundle"',
      '"--unsafe-extra-flag"',
    ), options)).toThrow(/pinned Wrangler command contract/)
    expect(() => verifyWranglerPagesDeployOutput(raw.replace(
      '"wrangler_version":"4.125.0"',
      '"wrangler_version":"4.125.1"',
    ), options)).toThrow(/pinned deployment contract/)

    const directory = await mkdtemp(join(tmpdir(), 'burillab-wrangler-output-'))
    const file = join(directory, 'wrangler.jsonl')
    const output = join(directory, 'github-output.txt')
    try {
      await writeFile(file, raw, 'utf8')
      await readWranglerPagesDeployOutput({ ...options, file, outputPath: output })
      await expect(readFile(output, 'utf8')).resolves.toContain(
        'deployment_id=123e4567-e89b-42d3-a456-426614174000',
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('requires ephemeral Pages tokens and rejects legacy Cloudflare deployment inputs', () => {
    expect(() => verifyCloudflareDeployInputs({
      ...validDeployEnvironment('staging'),
      PAGES_EPHEMERAL_TOKEN: '',
    })).toThrow(/PAGES_EPHEMERAL_TOKEN/)
    expect(() => verifyCloudflareDeployInputs({
      ...validDeployEnvironment('staging'),
      CLOUDFLARE_API_TOKEN: 'legacy-token-value-that-is-long-enough',
    })).toThrow(/forbidden legacy/)
    expect(() => verifyCloudflareDeployInputs({
      ...validDeployEnvironment('staging'),
      WORKER_EPHEMERAL_TOKEN: 'worker-token-value-that-is-long-enough',
    })).toThrow(/must not be exposed/)
  })

  it('exposes a distinct Worker token only for an explicit Staging backup request', () => {
    const workerBaseEnvironment = validDeployEnvironment('staging')
    delete workerBaseEnvironment.PAGES_EPHEMERAL_TOKEN
    const workerEnvironment = {
      ...workerBaseEnvironment,
      DEPLOY_STORAGE_BACKUP: 'true',
      WORKER_EPHEMERAL_TOKEN: 'worker-token-value-that-is-long-enough',
    }
    expect(verifyCloudflareWorkerDeployInputs(workerEnvironment)).toMatchObject({
      environment: 'staging',
      tokenScope: 'worker',
    })
    expect(() => verifyCloudflareWorkerDeployInputs({
      ...workerEnvironment,
      DEPLOY_STORAGE_BACKUP: 'false',
    })).toThrow(/explicit storage-backup/)
    expect(() => verifyCloudflareWorkerDeployInputs({
      ...workerEnvironment,
      PAGES_EPHEMERAL_TOKEN: 'pages-token-value-that-must-not-be-exposed',
    })).toThrow(/must not be exposed/)
    expect(() => verifyCloudflareWorkerDeployInputs({
      ...workerEnvironment,
      DEPLOY_ENVIRONMENT: 'production',
    })).toThrow(/exactly staging/)
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

  it('trusts only the synthetic user that owns the complete reserved Gate0 fixture', () => {
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

  it('refuses remote fixture restoration when ownership isolation is incomplete or non-empty', () => {
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
      unexpectedInventoryInsideReservedLab: null,
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

  it('does not forward Access across an immutable-to-custom top-level redirect', async () => {
    const redirectResponse = {
      status: 302,
      headers: { location: `${GATE0_STAGING_CUSTOM_ORIGIN}/login` },
    }
    const fetch = vi.fn(async () => redirectResponse)
    const fulfill = vi.fn(async () => undefined)
    const route = {
      request: () => ({
        url: () => `${STAGING_IMMUTABLE_ORIGIN}/login`,
        headers: () => ({
          accept: 'text/html',
          'cf-access-client-id': 'caller-controlled-id',
          'CF-Access-Client-Secret': 'caller-controlled-secret',
        }),
      }),
      fetch,
      fulfill,
    }

    await fulfillStagingAccessRoute(route, {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      targetOrigin: STAGING_IMMUTABLE_ORIGIN,
      deploymentId: STAGING_DEPLOYMENT_ID,
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
    expect(isStagingGate0AccessRequest({
      targetOrigin: STAGING_IMMUTABLE_ORIGIN,
      deploymentId: STAGING_DEPLOYMENT_ID,
      requestUrl: redirectResponse.headers.location,
    })).toBe(false)
  })

  it('refuses to attach Staging Access credentials to Supabase or production origins', async () => {
    for (const url of [
      'https://qpgnomuqdcucjmxrunnw.supabase.co/rest/v1/inventory',
      'https://burillab.com/api/chemicals/enrich',
      'https://production-id.buril-lab.pages.dev/login',
      'https://other-project.pages.dev/login',
      `${GATE0_STAGING_CUSTOM_ORIGIN}/`,
      `${GATE0_STAGING_CUSTOM_ORIGIN}/login`,
      `${GATE0_STAGING_CUSTOM_ORIGIN}/release.json`,
      `${GATE0_STAGING_CUSTOM_ORIGIN}/api`,
      `${GATE0_STAGING_CUSTOM_ORIGIN}/api-evil`,
      `${GATE0_STAGING_CUSTOM_ORIGIN}/api/../login`,
      'https://user:password@staging.burillab.com/api/analytics/search-event',
    ]) {
      const fetch = vi.fn()
      const fulfill = vi.fn()
      const route = {
        request: () => ({ url: () => url, headers: () => ({ accept: 'application/json' }) }),
        fetch,
        fulfill,
      }

      await expect(fulfillStagingAccessRoute(route, {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        targetOrigin: STAGING_IMMUTABLE_ORIGIN,
        deploymentId: STAGING_DEPLOYMENT_ID,
      })).rejects.toThrow(/approved request origin and path/)
      expect(fetch).not.toHaveBeenCalled()
      expect(fulfill).not.toHaveBeenCalled()
    }
  })

  it('allows only the exact fixed Staging API origin alongside an immutable target', async () => {
    const response = { status: 200 }
    const fetch = vi.fn(async () => response)
    const fulfill = vi.fn(async () => undefined)
    const route = {
      request: () => ({
        url: () => `${GATE0_STAGING_CUSTOM_ORIGIN}/api/analytics/search-event`,
        headers: () => ({ accept: 'application/json' }),
      }),
      fetch,
      fulfill,
    }

    await fulfillStagingAccessRoute(route, {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      targetOrigin: STAGING_IMMUTABLE_ORIGIN,
      deploymentId: STAGING_DEPLOYMENT_ID,
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fulfill).toHaveBeenCalledWith({ response })
    expect(isStagingGate0AccessRequest({
      targetOrigin: STAGING_IMMUTABLE_ORIGIN,
      deploymentId: STAGING_DEPLOYMENT_ID,
      requestUrl: `${GATE0_STAGING_CUSTOM_ORIGIN}/api/kosha/msds`,
    })).toBe(true)
    expect(isStagingGate0AccessRequest({
      targetOrigin: STAGING_IMMUTABLE_ORIGIN,
      deploymentId: STAGING_DEPLOYMENT_ID,
      requestUrl: `${GATE0_STAGING_CUSTOM_ORIGIN}/api-evil`,
    })).toBe(false)
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

  it('restores only reserved fixture identities without deleting rows or users', async () => {
    const seedScript = await readFile('scripts/seed-gate0-e2e.mjs', 'utf8')
    const ownershipCheck = seedScript.indexOf('verifyExistingFixtureOwnership({')
    const isolationCheck = seedScript.indexOf('await verifyRemoteFixtureIsolation(fixtureUser.id)')
    const userRefresh = seedScript.indexOf('supabase.auth.admin.updateUserById(fixtureUser.id')
    const labRestore = seedScript.indexOf("supabase.from('labs').upsert({")
    const outputBlock = seedScript.slice(seedScript.lastIndexOf('console.log(JSON.stringify'))
    expect(ownershipCheck).toBeGreaterThan(-1)
    expect(isolationCheck).toBeGreaterThan(ownershipCheck)
    expect(userRefresh).toBeGreaterThan(isolationCheck)
    expect(labRestore).toBeGreaterThan(userRefresh)
    expect(outputBlock).not.toContain('email:')
    expect(seedScript).not.toContain('deleteUser(')
    expect(seedScript).not.toContain('.delete()')
    expect(seedScript).toContain('verifyExistingFixtureOwnership')
    expect(seedScript).toContain('verifyFixtureIsolationEvidence')
    expect(seedScript).toContain(".not('lab_id', 'is', null).neq('lab_id', LAB_ID)")
    expect(seedScript).toContain(".from('safety_center_lab_links')")
    expect(seedScript).toContain(".from('safety_center_requests')")
    expect(seedScript).toContain("join_password: ''")
    expect(seedScript).toContain("fixtureSessionClient.rpc('set_lab_join_password'")
    expect(seedScript).toContain("fixtureSessionClient.auth.signOut({ scope: 'global' })")
    expect(seedScript).toContain('cabinet_id: null')
    expect(seedScript).toContain('parent_policy_version_id: null')
    expect(seedScript).toContain('replacement_location: null')
    expect(seedScript).toContain('is_disabled: false')
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
      name: 'Deploy staging',
      path: '.github/workflows/deploy-staging.yml',
      display_title: `Deploy staging ${COMMIT} (lease=${'a'.repeat(32)}, storage-backup=false)`,
      status: 'completed',
      conclusion: 'success',
      event: 'workflow_dispatch',
      head_branch: 'main',
      head_sha: COMMIT,
      repository: { full_name: 'owner/buril-lab' },
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
      { ...newerPending, status: 'completed', conclusion: 'success', run_attempt: 2 },
      olderSuccess,
    ], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/forbidden workflow re-run/)
    expect(() => findTrustedStagingRun([
      { ...olderSuccess, event: 'workflow_run' },
      { ...olderSuccess, head_repository: { full_name: 'fork/buril-lab' } },
    ], {
      repository: 'owner/buril-lab',
      commitSha: COMMIT,
      now: QUALITY_NOW,
    })).toThrow(/No trusted Deploy staging run/)
  })

  it('queries the exact approved deploy-staging run ID directly', async () => {
    const trusted = {
      id: 31,
      run_attempt: 1,
      name: 'Deploy staging',
      path: '.github/workflows/deploy-staging.yml',
      display_title: `Deploy staging ${COMMIT} (lease=${'a'.repeat(32)}, storage-backup=false)`,
      status: 'completed',
      conclusion: 'success',
      event: 'workflow_dispatch',
      head_branch: 'main',
      head_sha: COMMIT,
      repository: { full_name: 'haengjoo123/buril-lab' },
      head_repository: { full_name: 'haengjoo123/buril-lab' },
      created_at: '2026-08-24T10:00:00Z',
      run_started_at: '2026-08-24T10:05:00Z',
      updated_at: '2026-08-24T11:00:00Z',
    }
    const keys = generateKeyPairSync('ed25519')
    const cleanupReceipt = signedStagingCleanupReceipt(trusted, keys)
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const isJobsRequest = new URL(String(input)).pathname.endsWith('/actions/runs/31/jobs')
      return new Response(JSON.stringify(isJobsRequest
        ? { jobs: trustedStagingJobs() }
        : trusted), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    await expect(fetchTrustedStagingRun({
        GITHUB_TOKEN: 'not-a-real-token',
        GITHUB_REPOSITORY: 'haengjoo123/buril-lab',
        DEPLOY_COMMIT_SHA: COMMIT,
        DEPLOY_STAGING_RUN_ID: '31',
        STAGING_EPHEMERAL_CLEANUP_RECEIPT: cleanupReceipt,
      }, { now: QUALITY_NOW, publicKey: keys.publicKey, fetchImpl: fetchMock })).resolves.toStrictEqual(trusted)
    const endpoint = new URL(String(fetchMock.mock.calls[0][0]))
    expect(endpoint.pathname).toBe('/repos/haengjoo123/buril-lab/actions/runs/31')
    expect(endpoint.search).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const jobsEndpoint = new URL(String(fetchMock.mock.calls[1][0]))
    expect(jobsEndpoint.pathname).toBe('/repos/haengjoo123/buril-lab/actions/runs/31/jobs')
    expect(jobsEndpoint.searchParams.get('filter')).toBe('latest')
  })

  it('requires the supervised Staging job and every deployment evidence step to succeed', () => {
    expect(verifyTrustedStagingJobs(trustedStagingJobs(), 31)).toMatchObject({
      buildJob: { id: 300 },
      deployJob: { id: 301 },
      workerJob: { id: 302 },
    })
    expect(() => verifyTrustedStagingJobs([
      trustedStagingBuildJob(),
      { ...trustedStagingJob(), conclusion: 'skipped' },
      trustedStagingWorkerJob(),
    ], 31)).toThrow(/did not complete successfully/)
    expect(() => verifyTrustedStagingJobs([
      trustedStagingBuildJob(),
      {
        ...trustedStagingJob(),
        steps: trustedStagingJob().steps.filter((step) => step.name !== 'Deploy the exact commit to Staging Pages'),
      },
      trustedStagingWorkerJob(),
    ], 31)).toThrow(/Deploy the exact commit to Staging Pages/)
    expect(() => verifyTrustedStagingJobs([
      {
        ...trustedStagingBuildJob(),
        steps: trustedStagingBuildJob().steps.filter((step) => step.name !== 'Upload the exact Staging release artifact'),
      },
      trustedStagingJob(),
      trustedStagingWorkerJob(),
    ], 31)).toThrow(/Upload the exact Staging release artifact/)
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

  it('materializes the Staging Worker secret only below RUNNER_TEMP and removes it safely', async () => {
    const runnerTemp = await mkdtemp(join(tmpdir(), 'burillab-worker-secret-test-'))
    const githubOutput = join(runnerTemp, 'github-output.txt')
    const serviceRoleKey = `sb_secret_${'a'.repeat(40)}`
    try {
      expect(verifyStagingSupabaseBackendCredential(serviceRoleKey)).toBe(serviceRoleKey)
      expect(() => verifyStagingSupabaseBackendCredential(`sb_publishable_${'b'.repeat(40)}`))
        .toThrow(/not a supported backend credential/)
      const encodeJwtPart = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const productionServiceRoleJwt = [
        encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
        encodeJwtPart({ iss: 'supabase', role: 'service_role', ref: 'zafxzidbtbryiksemlwc' }),
        'c'.repeat(32),
      ].join('.')
      expect(() => verifyStagingSupabaseBackendCredential(productionServiceRoleJwt))
        .toThrow(/not the Staging backend credential/)
      await expect(createStorageBackupSecretFile({
        runnerTemp,
        serviceRoleKey,
        githubOutput: 'relative-github-output.txt',
      })).rejects.toThrow(/GITHUB_OUTPUT must be an absolute file path/)
      expect(await readdir(runnerTemp)).toStrictEqual([])

      const created = await createStorageBackupSecretFile({
        runnerTemp,
        serviceRoleKey,
        githubOutput,
      })
      expect(JSON.parse(await readFile(created.secretFile, 'utf8'))).toStrictEqual({
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      })
      expect(await readFile(githubOutput, 'utf8')).toBe(`secret_file=${created.secretFile}\n`)

      await expect(cleanupStorageBackupSecretFile({
        runnerTemp,
        secretFile: join(runnerTemp, 'unapproved', 'secrets.json'),
      })).rejects.toThrow(/outside the storage-backup secret boundary/)
      await expect(cleanupStorageBackupSecretFile({
        runnerTemp,
        secretFile: created.secretFile,
      })).resolves.toStrictEqual({ removed: true })
      await expect(readFile(created.secretFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(cleanupStorageBackupSecretFile({
        runnerTemp,
        secretFile: created.secretFile,
      })).resolves.toStrictEqual({ removed: false })
    } finally {
      await rm(runnerTemp, { recursive: true, force: true })
    }
  })

  it('uses owner-only secret permissions and refuses a link swap on Linux', async () => {
    if (process.platform === 'win32') return
    const runnerTemp = await mkdtemp(join(tmpdir(), 'burillab-worker-secret-link-test-'))
    const target = join(runnerTemp, 'unrelated.txt')
    try {
      const created = await createStorageBackupSecretFile({
        runnerTemp,
        serviceRoleKey: `sb_secret_${'d'.repeat(40)}`,
      })
      expect((await lstat(dirname(created.secretFile))).mode & 0o777).toBe(0o700)
      expect((await lstat(created.secretFile)).mode & 0o777).toBe(0o600)

      await writeFile(target, 'not secret material', 'utf8')
      await unlink(created.secretFile)
      await symlink(target, created.secretFile, 'file')
      await expect(cleanupStorageBackupSecretFile({
        runnerTemp,
        secretFile: created.secretFile,
      })).rejects.toThrow(/changed type before cleanup/)
      expect(await readFile(target, 'utf8')).toBe('not secret material')
    } finally {
      await rm(runnerTemp, { recursive: true, force: true })
    }
  })

  it('accepts only the exact five-switch OFF Staging runtime config and exact Cloudflare target', () => {
    const runtimeConfig = {
      voice_disposal_mode: 'redirect',
      kosha_content_mode: 'link_only',
      account_deletion_enabled: false,
      maintenance_worker_enabled: false,
      storage_backup_enabled: false,
    }
    const target = {
      environment: 'staging',
      accountId: STAGING_CLOUDFLARE_ACCOUNT_ID,
      namespaceId: STAGING_RUNTIME_CONFIG_KV_ID,
    }
    expect(verifyStorageBackupRuntimeOff(JSON.stringify(runtimeConfig), target)).toMatchObject({
      environment: 'staging',
      accountId: STAGING_CLOUDFLARE_ACCOUNT_ID,
      namespaceId: STAGING_RUNTIME_CONFIG_KV_ID,
      storageBackupEnabled: false,
    })

    expect(() => verifyStorageBackupRuntimeOff(JSON.stringify({
      ...runtimeConfig,
      unexpected_switch: false,
    }), target)).toThrow(/exactly the five approved safety switches/)
    const missingRuntimeConfig = { ...runtimeConfig }
    delete missingRuntimeConfig.maintenance_worker_enabled
    expect(() => verifyStorageBackupRuntimeOff(JSON.stringify(missingRuntimeConfig), target))
      .toThrow(/exactly the five approved safety switches/)
    expect(() => verifyStorageBackupRuntimeOff(JSON.stringify({
      ...runtimeConfig,
      storage_backup_enabled: true,
    }), target)).toThrow(/unsafe value for storage_backup_enabled/)
    expect(() => verifyStorageBackupRuntimeOff(JSON.stringify({
      ...runtimeConfig,
      kosha_content_mode: 'full',
    }), target)).toThrow(/unsafe value for kosha_content_mode/)
    expect(() => verifyStorageBackupRuntimeOff(JSON.stringify(runtimeConfig), {
      ...target,
      accountId: '00000000000000000000000000000000',
    })).toThrow(/wrong Cloudflare account/)
    expect(() => verifyStorageBackupRuntimeOff(JSON.stringify(runtimeConfig), {
      ...target,
      namespaceId: '00000000000000000000000000000000',
    })).toThrow(/wrong Staging KV namespace/)
    expect(() => verifyStorageBackupRuntimeOff(JSON.stringify(runtimeConfig), {
      ...target,
      environment: 'production',
    })).toThrow(/restricted to Staging/)
  })

  it('verifies one 100-percent active Staging Worker version, SHA annotations, and one secret name', () => {
    const deploymentId = '123e4567-e89b-42d3-a456-426614174010'
    const versionId = '123e4567-e89b-42d3-a456-426614174011'
    const runId = '42'
    const leaseId = 'a'.repeat(32)
    const tag = `r${runId}-l${leaseId}`
    const message = `quality-approved staging storage backup run ${runId} lease ${leaseId} commit ${COMMIT}`
    const deployment = {
      id: deploymentId,
      versions: [{ version_id: versionId, percentage: 100 }],
      annotations: { 'workers/message': message },
    }
    const versions = [{
      id: versionId,
      annotations: {
        'workers/tag': tag,
        'workers/message': message,
      },
    }]
    const verify = ({
      deploymentValue = deployment,
      versionsValue = versions,
      secretsValue = [{ name: 'SUPABASE_SERVICE_ROLE_KEY', type: 'secret_text' }],
      surfaceRaw = validStorageBackupSurfaceRaw(),
      environment = 'staging',
      accountId = STAGING_CLOUDFLARE_ACCOUNT_ID,
      workerName = 'buril-lab-storage-backup-staging',
    } = {}) => verifyStorageBackupWorkerDeployment({
      deploymentRaw: JSON.stringify(deploymentValue),
      versionsRaw: JSON.stringify(versionsValue),
      secretsRaw: JSON.stringify(secretsValue),
      ...surfaceRaw,
      commitSha: COMMIT,
      runId,
      leaseId,
      expectedVersionId: versionId,
      environment,
      accountId,
      workerName,
    })

    expect(verify()).toStrictEqual({
      environment: 'staging',
      workerName: 'buril-lab-storage-backup-staging',
      commitSha: COMMIT,
      runId,
      leaseId,
      deploymentId,
      versionId,
    })
    expect(() => verify({
      deploymentValue: {
        ...deployment,
        versions: [
          { version_id: versionId, percentage: 50 },
          { version_id: deploymentId, percentage: 50 },
        ],
      },
    })).toThrow(/one active version only/)
    expect(() => verify({
      versionsValue: [{
        ...versions[0],
        annotations: { ...versions[0].annotations, 'workers/tag': 'f'.repeat(40) },
      }],
    })).toThrow(/identity does not match/)
    expect(() => verify({
      secretsValue: [
        { name: 'SUPABASE_SERVICE_ROLE_KEY', type: 'secret_text' },
        { name: 'UNAPPROVED_SECRET', type: 'secret_text' },
      ],
    })).toThrow(/unapproved secret set/)
    expect(() => verify({
      secretsValue: [{ name: 'SUPABASE_SERVICE_ROLE_KEY', type: 'plain_text' }],
    })).toThrow(/malformed item/)
    expect(() => verify({ environment: 'production' })).toThrow(/exact Staging account and Worker/)
    expect(() => verify({ accountId: '00000000000000000000000000000000' })).toThrow(/exact Staging account and Worker/)
    expect(() => verify({ workerName: 'buril-lab-storage-backup-production' })).toThrow(/exact Staging account and Worker/)
    expect(() => verify({ versionsValue: [versions[0], versions[0]] }))
      .toThrow(/malformed or duplicate version ID/)
    expect(() => verify({
      deploymentValue: {
        ...deployment,
        versions: [{ version_id: deploymentId, percentage: 100 }],
      },
    })).toThrow(/absent from the bounded version list|exact Wrangler-created/)
  })

  it('extracts only the exact newly-created Wrangler Worker version', () => {
    const runId = '32935279831'
    const leaseId = '126a07448ccfd510791515813928e881'
    const secretFile = '/home/runner/work/_temp/burillab-storage-backup-secrets-RxNoaM/secrets.json'
    const session = {
      type: 'wrangler-session',
      version: 1,
      wrangler_version: '4.125.0',
      command_line_args: [
        'deploy',
        '--config', 'workers/storage-backup/wrangler.staging.jsonc',
        '--secrets-file', secretFile,
        '--strict',
        '--autoconfig=false',
        '--tag', `r${runId}-l${leaseId}`,
        '--message', `quality-approved staging storage backup run ${runId} lease ${leaseId} commit ${COMMIT}`,
      ],
      log_file_path: '/home/runner/.config/.wrangler/logs/wrangler-2026-08-25_01-00-01_000.log',
      timestamp: '2026-08-25T01:00:01.000Z',
    }
    const deploy = {
      type: 'deploy',
      version: 1,
      worker_name: null,
      worker_tag: 'opaque-worker-tag',
      version_id: '123e4567-e89b-42d3-a456-426614174011',
      targets: ['schedule: 15 17 * * *'],
      worker_name_overridden: false,
      timestamp: '2026-08-25T01:00:02.000Z',
    }
    const outputFor = (sessionValue = session, deployValue = deploy) => (
      `${JSON.stringify(sessionValue)}\n${JSON.stringify(deployValue)}\n`
    )
    const output = outputFor()
    const options = {
      workerName: 'buril-lab-storage-backup-staging',
      commitSha: COMMIT,
      runId,
      leaseId,
      startedAt: '2026-08-25T01:00:00Z',
      now: Date.parse('2026-08-25T01:01:00Z'),
    }
    expect(verifyWranglerWorkerDeployOutput(output, options)).toMatchObject({
      versionId: '123e4567-e89b-42d3-a456-426614174011',
    })
    expect(() => verifyWranglerWorkerDeployOutput(outputFor(session, {
      ...deploy,
      timestamp: '2026-08-25T00:59:59.000Z',
    }), options)).toThrow(/outside the guarded deployment time boundary/)
    expect(() => verifyWranglerWorkerDeployOutput(`${output}${output}`, options))
      .toThrow(/exactly one session and one deploy record/)
    expect(() => verifyWranglerWorkerDeployOutput(`${JSON.stringify(deploy)}\n`, options))
      .toThrow(/exactly one session and one deploy record/)
    expect(() => verifyWranglerWorkerDeployOutput(outputFor(deploy, session), options))
      .toThrow(/record order/)
    expect(() => verifyWranglerWorkerDeployOutput(outputFor({
      ...session,
      wrangler_version: '4.126.0',
    }, deploy), options)).toThrow(/pinned deployment contract/)
    expect(() => verifyWranglerWorkerDeployOutput(outputFor({
      ...session,
      command_line_args: session.command_line_args.map((value) => (
        value === secretFile
          ? '/home/runner/work/_temp/not-the-approved-secret-file/secrets.json'
          : value
      )),
    }, deploy), options)).toThrow(/isolated GitHub runner secret file/)
    expect(() => verifyWranglerWorkerDeployOutput(outputFor({
      ...session,
      command_line_args: [...session.command_line_args, '--keep-vars'],
    }, deploy), options)).toThrow(/pinned Wrangler command contract/)
    expect(() => verifyWranglerWorkerDeployOutput(outputFor({
      ...session,
      command_line_args: session.command_line_args.map((value) => (
        value === `r${runId}-l${leaseId}` ? 'unapproved-tag' : value
      )),
    }, deploy), options)).toThrow(/pinned Wrangler command contract/)
    expect(() => verifyWranglerWorkerDeployOutput(outputFor({
      ...session,
      timestamp: '2026-08-25T01:00:03.000Z',
    }, deploy), options)).toThrow(/does not match the guarded mutation/)
  })

  it('accepts only the exact approved Staging Worker control-plane surface', () => {
    const verify = (
      surfaceRaw = validStorageBackupSurfaceRaw(),
      target = {
        environment: 'staging',
        accountId: STAGING_CLOUDFLARE_ACCOUNT_ID,
        workerName: 'buril-lab-storage-backup-staging',
      },
    ) => verifyStorageBackupWorkerSurface({ ...surfaceRaw, ...target })

    expect(verify()).toStrictEqual({
      bindingCount: 10,
      routeCount: 0,
      customDomainCount: 0,
      cron: '15 17 * * *',
    })
    expect(() => verify(validStorageBackupSurfaceRaw(), {
      environment: 'production',
      accountId: STAGING_CLOUDFLARE_ACCOUNT_ID,
      workerName: 'buril-lab-storage-backup-staging',
    })).toThrow(/exact Staging account and Worker/)
    expect(() => verify(validStorageBackupSurfaceRaw(), {
      environment: 'staging',
      accountId: '00000000000000000000000000000000',
      workerName: 'buril-lab-storage-backup-staging',
    })).toThrow(/exact Staging account and Worker/)
    expect(() => verify(validStorageBackupSurfaceRaw(), {
      environment: 'staging',
      accountId: STAGING_CLOUDFLARE_ACCOUNT_ID,
      workerName: 'buril-lab-storage-backup-production',
    })).toThrow(/exact Staging account and Worker/)

    const wrongServiceEnvironment = JSON.parse(
      validStorageBackupSurfaceRaw().serviceRaw,
    ) as { result: { environment: string } }
    wrongServiceEnvironment.result.environment = 'preview'
    expect(() => verify({
      ...validStorageBackupSurfaceRaw(),
      serviceRaw: JSON.stringify(wrongServiceEnvironment),
    })).toThrow(/wrong environment or Worker/)
  })

  it('rejects missing, duplicate, extra, or changed Staging Worker bindings', () => {
    const verifyBindings = (bindings: object[]) => verifyStorageBackupWorkerSurface({
      ...validStorageBackupSurfaceRaw(),
      bindingsRaw: cloudflareEnvelope(bindings),
      environment: 'staging',
      accountId: STAGING_CLOUDFLARE_ACCOUNT_ID,
      workerName: 'buril-lab-storage-backup-staging',
    })
    const bindings = storageBackupBindingsFixture()

    expect(() => verifyBindings(bindings.slice(0, -1))).toThrow(/exactly the approved ten bindings/)
    expect(() => verifyBindings([...bindings, {
      name: 'UNAPPROVED',
      text: 'false',
      type: 'plain_text',
    }])).toThrow(/exactly the approved ten bindings/)
    expect(() => verifyBindings(bindings.map((binding, index) => (
      index === 9 ? { ...binding, name: 'BACKUP_ENVIRONMENT' } : binding
    )))).toThrow(/malformed or duplicate name/)
    expect(() => verifyBindings(bindings.map((binding) => (
      binding.name === 'BURILLAB_RUNTIME_CONFIG'
        ? { ...binding, namespace_id: '00000000000000000000000000000000' }
        : binding
    )))).toThrow(/wrong runtime-config KV binding/)
    expect(() => verifyBindings(bindings.map((binding) => (
      binding.name === 'CABINET_BACKUPS'
        ? { ...binding, bucket_name: 'buril-lab-cabinet-backups-production' }
        : binding
    )))).toThrow(/wrong private R2 binding/)
    expect(() => verifyBindings(bindings.map((binding) => (
      binding.name === 'SUPABASE_SERVICE_ROLE_KEY'
        ? { ...binding, type: 'plain_text' }
        : binding
    )))).toThrow(/not secret text/)
    expect(() => verifyBindings(bindings.map((binding) => (
      binding.name === 'BACKUP_ENVIRONMENT'
        ? { ...binding, text: 'production' }
        : binding
    )))).toThrow(/unsafe value for BACKUP_ENVIRONMENT/)
    expect(() => verifyBindings(bindings.map((binding) => (
      binding.name === 'SUPABASE_URL'
        ? { ...binding, unexpected: true }
        : binding
    )))).toThrow(/missing or unapproved fields/)
  })

  it('rejects every public Worker surface and any Cron drift or duplicate schedule', () => {
    const verify = (overrides: Partial<ReturnType<typeof validStorageBackupSurfaceRaw>>) => (
      verifyStorageBackupWorkerSurface({
        ...validStorageBackupSurfaceRaw(),
        ...overrides,
        environment: 'staging',
        accountId: STAGING_CLOUDFLARE_ACCOUNT_ID,
        workerName: 'buril-lab-storage-backup-staging',
      })
    )

    expect(() => verify({ routesRaw: cloudflareEnvelope([{ pattern: 'example.com/*' }]) }))
      .toThrow(/routes must be exactly empty/)
    expect(() => verify({ domainsRaw: cloudflareEnvelope([{ hostname: 'worker.example.com' }]) }))
      .toThrow(/custom domains must be exactly empty/)
    expect(() => verify({
      routesRaw: cloudflareEnvelope([], { errors: null, messages: null }),
    })).toThrow(/routes did not return one successful, error-free response/)
    expect(() => verify({
      domainsRaw: cloudflareEnvelope([], { errors: null }),
    })).toThrow(/custom domains did not return one successful, error-free response/)
    expect(() => verify({
      domainsRaw: cloudflareEnvelope([], {
        result_info: { count: 0, page: 0, per_page: 5, total_count: 1, total_pages: 1 },
      }),
    })).toThrow(/hidden non-empty result/)
    expect(() => verify({
      subdomainRaw: cloudflareEnvelope({ enabled: true, previews_enabled: false }),
    })).toThrow(/workers\.dev or preview URL is enabled/)
    expect(() => verify({
      subdomainRaw: cloudflareEnvelope({ enabled: false, previews_enabled: true }),
    })).toThrow(/workers\.dev or preview URL is enabled/)
    expect(() => verify({
      schedulesRaw: cloudflareEnvelope({ schedules: [{ cron: '0 * * * *' }] }),
    })).toThrow(/Cron schedule has drifted/)
    expect(() => verify({
      schedulesRaw: cloudflareEnvelope({ schedules: [
        { cron: '15 17 * * *' },
        { cron: '15 17 * * *' },
      ] }),
    })).toThrow(/exactly one Cron schedule/)
    expect(() => verify({
      schedulesRaw: cloudflareEnvelope({ schedules: [{
        cron: '15 17 * * *',
        unexpected: true,
      }] }),
    })).toThrow(/missing or unapproved fields/)
    expect(() => verify({
      schedulesRaw: cloudflareEnvelope({ schedules: [{
        cron: '15 17 * * *',
        modified_on: 'not-a-date',
      }] }),
    })).toThrow(/Cron metadata is malformed/)
  })

  it('rejects compatibility, handler, and execution-surface drift', () => {
    const serviceRaw = (scriptOverrides: Record<string, unknown>) => cloudflareEnvelope({
      environment: 'production',
      script: {
        id: 'buril-lab-storage-backup-staging',
        compatibility_date: '2026-08-20',
        compatibility_flags: ['nodejs_compat'],
        handlers: ['scheduled'],
        named_handlers: [],
        tail_consumers: [],
        limits: { subrequests: 700 },
        placement_mode: null,
        ...scriptOverrides,
      },
    })
    const verify = (scriptOverrides: Record<string, unknown>) => verifyStorageBackupWorkerSurface({
      ...validStorageBackupSurfaceRaw(),
      serviceRaw: serviceRaw(scriptOverrides),
      environment: 'staging',
      accountId: STAGING_CLOUDFLARE_ACCOUNT_ID,
      workerName: 'buril-lab-storage-backup-staging',
    })

    expect(() => verify({ compatibility_date: '2026-08-21' })).toThrow(/compatibility date has drifted/)
    expect(() => verify({ id: 'buril-lab-storage-backup-production' }))
      .toThrow(/wrong environment or Worker/)
    expect(() => verify({ compatibility_flags: [] })).toThrow(/compatibility flags have drifted/)
    expect(() => verify({ compatibility_flags: ['nodejs_compat', 'nodejs_compat'] }))
      .toThrow(/duplicate value/)
    expect(() => verify({ handlers: ['fetch', 'scheduled'] })).toThrow(/only the scheduled handler/)
    expect(() => verify({ handlers: ['scheduled', 'scheduled'] })).toThrow(/duplicate value/)
    expect(() => verify({ named_handlers: ['admin'] })).toThrow(/unapproved execution surface/)
    expect(() => verify({ tail_consumers: [{ service: 'collector' }] })).toThrow(/unapproved execution surface/)
    expect(() => verify({ limits: {} })).toThrow(/missing or unapproved fields/)
    expect(() => verify({ limits: { subrequests: 699 } })).toThrow(/subrequest limit has drifted/)
    expect(() => verify({ limits: { subrequests: 700, cpu_ms: 1000 } }))
      .toThrow(/missing or unapproved fields/)
    expect(() => verify({ placement_mode: 'smart' })).toThrow(/unapproved execution surface/)
  })

  it('fails closed on malformed, error, extra-field, or oversized Cloudflare API envelopes', () => {
    const verifyBindingsRaw = (bindingsRaw: string) => verifyStorageBackupWorkerSurface({
      ...validStorageBackupSurfaceRaw(),
      bindingsRaw,
      environment: 'staging',
      accountId: STAGING_CLOUDFLARE_ACCOUNT_ID,
      workerName: 'buril-lab-storage-backup-staging',
    })

    expect(() => verifyBindingsRaw('{')).toThrow(/not valid JSON/)
    expect(() => verifyBindingsRaw('[]')).toThrow(/invalid shape/)
    expect(() => verifyBindingsRaw(JSON.stringify({
      errors: [],
      result: storageBackupBindingsFixture(),
      success: true,
    }))).toThrow(/missing or unapproved fields/)
    expect(() => verifyBindingsRaw(cloudflareEnvelope(storageBackupBindingsFixture(), {
      unexpected: true,
    }))).toThrow(/missing or unapproved fields/)
    expect(() => verifyBindingsRaw(cloudflareEnvelope(storageBackupBindingsFixture(), {
      errors: [{ code: 10000, message: 'permission denied' }],
      success: false,
    }))).toThrow(/successful, error-free response/)
    expect(() => verifyBindingsRaw(cloudflareEnvelope(storageBackupBindingsFixture(), {
      messages: [{ code: 1000, message: 'warning' }],
    }))).toThrow(/successful, error-free response/)
    expect(() => verifyBindingsRaw(`{"padding":"${'x'.repeat(1024 * 1024)}"}`))
      .toThrow(/missing or too large/)
  })

  it('rejects pagination and result-object extra fields that could hide Worker exposure', () => {
    const verify = (overrides: Partial<ReturnType<typeof validStorageBackupSurfaceRaw>>) => (
      verifyStorageBackupWorkerSurface({
        ...validStorageBackupSurfaceRaw(),
        ...overrides,
        environment: 'staging',
        accountId: STAGING_CLOUDFLARE_ACCOUNT_ID,
        workerName: 'buril-lab-storage-backup-staging',
      })
    )

    expect(() => verify({
      domainsRaw: cloudflareEnvelope([], {
        result_info: {
          count: 0,
          page: 0,
          per_page: 5,
          total_count: 0,
          total_pages: 0,
          cursor: 'hidden-next-page',
        },
      }),
    })).toThrow(/missing or unapproved fields/)
    expect(() => verify({
      domainsRaw: cloudflareEnvelope([], {
        result_info: { count: -1, page: 0, per_page: 5, total_count: 0, total_pages: 0 },
      }),
    })).toThrow(/invalid count/)
    expect(() => verify({
      subdomainRaw: cloudflareEnvelope({
        enabled: false,
        previews_enabled: false,
        unexpected_public_url: false,
      }),
    })).toThrow(/missing or unapproved fields/)
  })

  it('allows only an absent Worker or the approved pre-existing Staging Worker secret set', () => {
    const verify = (response: object, httpStatus = '200') => verifyStorageBackupWorkerSecretPreflight({
      responseRaw: JSON.stringify(response),
      httpStatus,
      environment: 'staging',
      accountId: STAGING_CLOUDFLARE_ACCOUNT_ID,
      workerName: 'buril-lab-storage-backup-staging',
    })

    expect(() => verify({ success: true, result: [] })).toThrow(/unapproved secret set/)
    expect(verify({
      success: true,
      result: [{ name: 'SUPABASE_SERVICE_ROLE_KEY', type: 'secret_text' }],
    })).toStrictEqual({ workerExists: true, approvedSecretCount: 1 })
    expect(verify({
      success: false,
      errors: [{ code: 10007, message: 'not found' }],
    }, '404')).toStrictEqual({ workerExists: false, approvedSecretCount: 0 })

    expect(() => verify({
      success: true,
      result: [{ name: 'UNAPPROVED_SECRET', type: 'secret_text' }],
    })).toThrow(/unapproved secret set/)
    expect(() => verify({
      success: false,
      errors: [{ code: 9109, message: 'forbidden' }],
    }, '404')).toThrow(/did not prove.*absent/)
    expect(() => verify({ success: false, errors: [] }, '403')).toThrow(/unexpected HTTP status/)
  })

  it('keeps the committed release workflows inside Prep 0 scope', async () => {
    const [
      productionRaw,
      stagingRaw,
      stagingWorkflowRaw,
      productionWorkflowRaw,
      qualityWorkflowRaw,
      credentialProbeWorkflowRaw,
      rollbackVerificationWorkflowRaw,
      storageBackupAcceptanceWorkflowRaw,
      iosWorkflowRaw,
      stagingPlaywrightConfig,
      gate0AccessRoute,
      gate0TargetConfig,
      gate0Spec,
      cloudflareApiHelper,
      storageBackupReadme,
    ] = await Promise.all([
      readFile('wrangler.jsonc', 'utf8'),
      readFile('wrangler.staging.jsonc', 'utf8'),
      readFile('.github/workflows/deploy-staging.yml', 'utf8'),
      readFile('.github/workflows/deploy-production.yml', 'utf8'),
      readFile('.github/workflows/quality.yml', 'utf8'),
      readFile('.github/workflows/verify-staging-ephemeral-credentials.yml', 'utf8'),
      readFile('.github/workflows/verify-staging-rollback.yml', 'utf8'),
      readFile('.github/workflows/verify-staging-storage-backup.yml', 'utf8'),
      readFile('.github/workflows/ios-testflight.yml', 'utf8'),
      readFile('playwright.staging.config.ts', 'utf8'),
      readFile('scripts/gate0-access-route.mjs', 'utf8'),
      readFile('scripts/gate0-staging-target.mjs', 'utf8'),
      readFile('e2e/gate0/gate0.spec.ts', 'utf8'),
      readFile('scripts/cloudflare-api-get.mjs', 'utf8'),
      readFile('workers/storage-backup/README.md', 'utf8'),
    ])
    const normalizeLineEndings = (source: string) => source.replace(/\r\n/g, '\n')
    const stagingWorkflow = normalizeLineEndings(stagingWorkflowRaw)
    const productionWorkflow = normalizeLineEndings(productionWorkflowRaw)
    const qualityWorkflow = normalizeLineEndings(qualityWorkflowRaw)
    const credentialProbeWorkflow = normalizeLineEndings(credentialProbeWorkflowRaw)
    const rollbackVerificationWorkflow = normalizeLineEndings(rollbackVerificationWorkflowRaw)
    const storageBackupAcceptanceWorkflow = normalizeLineEndings(storageBackupAcceptanceWorkflowRaw)
    const iosWorkflow = normalizeLineEndings(iosWorkflowRaw)
    expect(verifyCloudflareApiHelperSource(cloudflareApiHelper)).toBe(true)
    expect(verifyStorageBackupWorkerTokenDocumentation(storageBackupReadme)).toBe(true)
    expect(() => verifyStorageBackupWorkerTokenDocumentation(
      storageBackupReadme.replace('**Workers R2 Storage Read**', '**Workers R2 Storage missing**'),
    )).toThrow(/Scripts Edit, KV Read, and R2 Read/)
    expect(createHash('sha256').update(cloudflareApiHelper.replace(/\r\n/g, '\n'), 'utf8').digest('hex'))
      .toBe('fb55977e31c33aebcc229c1fef1febba21ba9b6435b59a85fd6805732b8e3317')
    expect(() => verifyCloudflareApiHelperSource(`${cloudflareApiHelper}\n`))
      .toThrow(/token-handling contract/)
    expect(() => verifyCloudflareApiHelperSource(`${cloudflareApiHelper}\nconsole.log(process.env.CLOUDFLARE_API_TOKEN)`))
      .toThrow(/token-handling contract/)
    const configuration = {
      productionRaw,
      stagingRaw,
      workflows: {
        staging: stagingWorkflow,
        production: productionWorkflow,
        quality: qualityWorkflow,
        'verify-staging-ephemeral-credentials.yml': credentialProbeWorkflow,
        'verify-staging-rollback.yml': rollbackVerificationWorkflow,
        'verify-staging-storage-backup.yml': storageBackupAcceptanceWorkflow,
        'ios-testflight.yml': iosWorkflow,
      },
      browser: {
        stagingConfig: stagingPlaywrightConfig,
        accessRoute: gate0AccessRoute,
        targetConfig: gate0TargetConfig,
        gate0Spec,
      },
    }
    expect(verifyReleaseConfiguration(configuration)).toMatchObject({ projectCount: 2 })

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        'verify-staging-ephemeral-credentials.yml': credentialProbeWorkflow.replace(
          'node scripts/verify-ephemeral-credential-injection.mjs --mode probe',
          'npx wrangler pages deploy dist',
        ),
      },
    })).toThrow(/credential-injection probe|fully reviewed command contract/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        'verify-staging-ephemeral-credentials.yml': credentialProbeWorkflow.replace(
          'secrets.STAGING_PAGES_EPHEMERAL_TOKEN',
          'secrets.STAGING_WORKER_EPHEMERAL_TOKEN',
        ),
      },
    })).toThrow(/credential-injection probe|unexpected or legacy|fully reviewed command contract/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        'verify-staging-rollback.yml': rollbackVerificationWorkflow.replace(
          'secrets.STAGING_ACCESS_CLIENT_SECRET',
          'secrets.STAGING_PAGES_EPHEMERAL_TOKEN',
        ),
      },
    })).toThrow(/rollback verification workflow|fully reviewed command contract/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        'verify-staging-rollback.yml': rollbackVerificationWorkflow.replace(
          'buril-lab-staging',
          'buril-lab',
        ),
      },
    })).toThrow(/rollback verification workflow|fully reviewed command contract/)

    for (const [workflowName, mutatedWorkflow, expectedError] of [
      [
        'staging',
        stagingWorkflow.replace(
          '      VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}',
          '      VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}\n      LEAKED_PROVIDER_TOKEN: ${{ secrets.STAGING_PAGES_EPHEMERAL_TOKEN }}',
        ),
        /build job must not receive/,
      ],
      ['staging', stagingWorkflow.replace('\n    needs: build\n', '\n'), /dependency chain/],
      [
        'staging',
        stagingWorkflow.replace(
          'artifact-ids: ${{ needs.build.outputs.artifact_id }}',
          'name: buril-lab-staging-${{ inputs.commit_sha }}',
        ),
        /ID-selected, digest-verified/,
      ],
      [
        'staging',
        stagingWorkflow.replace(
          'artifact-ids: ${{ needs.build.outputs.artifact_id }}',
          'artifact-ids: ${{ needs.build.outputs.artifact_id }},999',
        ),
        /ID-selected, digest-verified/,
      ],
      ['production', productionWorkflow.replace('merge-multiple: true', 'merge-multiple: false'), /ID-selected, digest-verified/],
      [
        'production',
        productionWorkflow.replace(
          '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" pages functions build functions',
          'echo skipped-functions-compile',
        ),
        /compilation must remain credential-free/,
      ],
      [
        'staging',
        stagingWorkflow.replace('--output-routes-path "$GITHUB_WORKSPACE/dist/_routes.json"', '--output-routes-path /tmp/unbound-routes.json'),
        /ID-selected, digest-verified|fully reviewed command contract/,
      ],
      [
        'production',
        productionWorkflow.replace('              --no-bundle', '              --bundle'),
        /compilation must remain credential-free|fully reviewed command contract/,
      ],
      [
        'staging',
        stagingWorkflow.replace(
          'test -s "$ARTIFACT_ROOT/dist/_worker.js/index.js"',
          'test -d "$ARTIFACT_ROOT/dist"',
        ),
        /ID-selected, digest-verified|fully reviewed command contract/,
      ],
      [
        'staging',
        stagingWorkflow.replace(
          '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" pages deploy dist',
          'npx wrangler pages deploy dist',
        ),
        /locked local Wrangler binary|compilation must remain credential-free/,
      ],
      [
        'production',
        productionWorkflow.replace(
          'node scripts/verify-github-artifact-digest.mjs',
          'node scripts/verify-github-artifact-digest.mjs || exit 0',
        ),
        /must not suppress command failures|fully reviewed command contract/,
      ],
      [
        'staging',
        stagingWorkflow.replace(
          '--deployment-id "${{ steps.pages-deploy-command.outputs.deployment_id }}"',
          '--deployment-id "00000000-0000-4000-8000-000000000000"',
        ),
        /exact just-created Pages deployment|fully reviewed command contract/,
      ],
      [
        'production',
        productionWorkflow.replace(
          '--commit-message "${{ steps.approved-staging-run.outputs.staging_commit_message }}"',
          '--commit-message "any same-SHA staging deployment"',
        ),
        /exact cleaned Staging run|fully reviewed command contract/,
      ],
      [
        'production',
        productionWorkflow.replace(
          'node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 600',
          'node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 0',
        ),
        /Signed lease|fully reviewed command contract/,
      ],
      [
        'staging',
        stagingWorkflow.replace(
          '/usr/bin/timeout --signal=TERM --kill-after=5s 30s git fetch --no-tags origin main',
          'git fetch --no-tags origin main',
        ),
        /bounded current-main runner|immediately before Wrangler|fully reviewed command contract/,
      ],
      [
        'staging',
        stagingWorkflow.replace(
          'EXPECTED_WORKER_VERSION_ID: ${{ steps.worker-deploy-command.outputs.worker_version_id }}',
          'EXPECTED_WORKER_VERSION_ID: 123e4567-e89b-42d3-a456-426614174000',
        ),
        /newly created version|fully reviewed command contract/,
      ],
      [
        'staging',
        stagingWorkflow.replace(
          '          PATH: ${{ steps.deploy-runner-boundary.outputs.trusted_path }}\n          GITHUB_TOKEN: ${{ github.token }}',
          '          GITHUB_TOKEN: ${{ github.token }}',
        ),
        /secret-bearing step lacks the fixed fresh-runner shell boundary/,
      ],
      [
        'staging',
        stagingWorkflow.replace(
          '    if: ${{ inputs.deploy_storage_backup }}',
          '    if: ${{ always() }}',
        ),
        /dependency chain/,
      ],
      [
        'staging',
        stagingWorkflow.replace(
          '      EPHEMERAL_CLEANUP_RECEIPT: ${{ vars.EPHEMERAL_CLEANUP_RECEIPT }}\n      SUPABASE_PROJECT_REF: ${{ vars.SUPABASE_PROJECT_REF }}\n\n    steps:\n      - name: Validate the supervised Staging Worker confirmation',
          '      EPHEMERAL_CLEANUP_RECEIPT: ${{ vars.EPHEMERAL_CLEANUP_RECEIPT }}\n\n    steps:\n      - name: Validate the supervised Staging Worker confirmation',
        ),
        /Staging Worker job.*Supabase project reference/,
      ],
      [
        'production',
        productionWorkflow.replace(
          'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
          'actions/upload-artifact@v4',
        ),
        /mutable external Action reference/,
      ],
      [
        'production',
        productionWorkflow.replace(
          '| node "$GITHUB_WORKSPACE/scripts/verify-release-artifact-paths.mjs"',
          '| node "$GITHUB_WORKSPACE/scripts/verify-release-artifact-paths.mjs" || exit 0',
        ),
        /must not suppress command failures|fully reviewed command contract/,
      ],
    ] as const) {
      expect(() => verifyReleaseConfiguration({
        ...configuration,
        workflows: { ...configuration.workflows, [workflowName]: mutatedWorkflow },
      })).toThrow(expectedError)
    }

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: stagingWorkflow.replace('npm ci --ignore-scripts', 'npm ci'),
      },
    })).toThrow(/suppress lifecycle scripts/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        production: productionWorkflow.replace(
          "/usr/bin/git diff --quiet --exit-code\n          /usr/bin/git diff --cached --quiet --exit-code\n          printf '%s  %s\\n' 'fb55977e31c33aebcc229c1fef1febba21ba9b6435b59a85fd6805732b8e3317' scripts/cloudflare-api-get.mjs \\\n            | /usr/bin/sha256sum --check --strict",
          'echo skipped-integrity-check',
        ),
      },
    })).toThrow(/pristine worktree and pinned helper/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        'evil.yml': 'on: push\njobs:\n  leak:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ secrets.MATCH_PASSWORD }}',
      },
    })).toThrow(/exact reviewed allow-list/)
    const withoutIos = Object.fromEntries(
      Object.entries(configuration.workflows).filter(([name]) => name !== 'ios-testflight.yml'),
    )
    expect(() => verifyReleaseConfiguration({ ...configuration, workflows: withoutIos }))
      .toThrow(/exact reviewed allow-list/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        'ios-testflight.yml': iosWorkflow.replace('exit 1', 'exit 0'),
      },
    })).toThrow(/fully reviewed command contract/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        quality: qualityWorkflow.replace('npm run cloudflare:test', 'echo skipped'),
      },
    })).toThrow(/fully reviewed command contract/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        quality: qualityWorkflow.replace(
          'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
          `attacker/checkout@${'a'.repeat(40)}`,
        ),
      },
    })).toThrow(/exact reviewed sequence/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        quality: qualityWorkflow.replace(
          '    steps:',
          `    steps:\n      - uses: attacker/action@${'b'.repeat(40)}`,
        ),
      },
    })).toThrow(/exact reviewed sequence/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        quality: qualityWorkflow.replace(
          'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
          'actions/checkout@v4',
        ),
      },
    })).toThrow(/mutable external Action reference/)

    const missingStorageBackupCheck = qualityWorkflow.replace(
      'run: npm run storage-backup:check',
      'run: npm run cloudflare:verify',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, quality: missingStorageBackupCheck },
    })).toThrow(/storage backup contract exactly once/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        production: `${productionWorkflow}\n# workers/storage-backup/wrangler.staging.jsonc`,
      },
    })).toThrow(/Production workflow must contain no storage-backup deployment path/)

    for (const workerCommand of [
      'npx wrangler deploy',
      'npx wrangler secret list',
      'npx wrangler versions list',
      'wrangler deployments status',
      './node_modules/.bin/wrangler deploy',
      'timeout 30s npx wrangler deploy',
      'env UNAPPROVED=1 npx wrangler deploy',
      "bash -c 'npx wrangler secret list'",
    ]) {
      expect(() => verifyReleaseConfiguration({
        ...configuration,
        workflows: {
          ...configuration.workflows,
          production: `${productionWorkflow}\n${workerCommand}`,
        },
      })).toThrow(/exact Pages-only allow-list|locked local Wrangler binary/)
    }
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        production: `${productionWorkflow}\ncurl https://api.cloudflare.com/client/v4/accounts/example/workers/scripts/example/secrets`,
      },
    })).toThrow(/no storage-backup deployment path/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        production: `${productionWorkflow}\n--secrets-file /tmp/unapproved.json`,
      },
    })).toThrow(/no storage-backup deployment path/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        production: productionWorkflow.replaceAll(
          'secrets.PRODUCTION_PAGES_EPHEMERAL_TOKEN',
          'secrets.STAGING_WORKER_EPHEMERAL_TOKEN',
        ),
      },
    })).toThrow(/unexpected or legacy|no storage-backup deployment path/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        production: `${productionWorkflow}\ncurl https://api.cloudflare.com/client/v4/accounts/example/workers%2Fscripts/example`,
      },
    })).toThrow(/no storage-backup deployment path/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: stagingWorkflow.replaceAll(
          'secrets.STAGING_PAGES_EPHEMERAL_TOKEN',
          'secrets.CLOUDFLARE_API_TOKEN',
        ),
      },
    })).toThrow(/unexpected or legacy/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: stagingWorkflow.replace(
          '          WORKER_EPHEMERAL_TOKEN: ${{ secrets.STAGING_WORKER_EPHEMERAL_TOKEN }}',
          '          PAGES_EPHEMERAL_TOKEN: ${{ secrets.STAGING_PAGES_EPHEMERAL_TOKEN }}\n          WORKER_EPHEMERAL_TOKEN: ${{ secrets.STAGING_WORKER_EPHEMERAL_TOKEN }}',
        ),
      },
    })).toThrow(/must expose only the signed Staging Worker token|exact supervised ephemeral-token mappings/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: stagingWorkflow
          .replace('Create isolated temporary Worker secret file', 'TEMPORARY WORKER STEP MARKER')
          .replace('Recheck the current Staging Supabase Advisor state before backup Worker deployment', 'Create isolated temporary Worker secret file')
          .replace('TEMPORARY WORKER STEP MARKER', 'Recheck the current Staging Supabase Advisor state before backup Worker deployment'),
      },
    })).toThrow(/out of order|final isolated secret-file step|fully reviewed command contract|must be immediately followed/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        unrelated: 'env:\n  CLOUDFLARE_API_TOKEN: ${{ secrets.UNEXPECTED_CLOUDFLARE_TOKEN }}',
      },
    })).toThrow(/exact reviewed allow-list|must not receive a Cloudflare deployment-token secret/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: `${stagingWorkflow}\nCLOUDFLARE_API_TOKEN: \${{ secrets.UNEXPECTED_TOKEN_ALIAS }}`,
      },
    })).toThrow(/unexpected CLOUDFLARE_API_TOKEN mapping|secret-bearing step lacks/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        production: `${productionWorkflow}\nSUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}`,
      },
    })).toThrow(/Supabase Management PAT access is forbidden|secret-bearing step lacks/)

    for (const forbiddenMutation of [
      'npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY',
      'npx wrangler kv key put runtime_config',
      '--config workers/storage-backup/wrangler.production.jsonc',
      'storage_backup_enabled=true',
    ]) {
      expect(() => verifyReleaseConfiguration({
        ...configuration,
        workflows: {
          ...configuration.workflows,
          staging: `${stagingWorkflow}\n${forbiddenMutation}`,
        },
      })).toThrow(/forbidden mutation or Production target|locked local Wrangler binary/)
    }

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: stagingWorkflow.replace('            --strict \\', '            # removed strict'),
      },
    })).toThrow(/lacks trusted-quality guard: --strict|deploy and verify the backup Worker/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: stagingWorkflow.replace(
          '      - name: Always remove temporary Worker secret material\n        if: always()',
          '      - name: Always remove temporary Worker secret material\n        # removed always guard',
        ),
      },
    })).toThrow(/exact supervised condition: always\(\)|fully reviewed command contract/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: stagingWorkflow.replace(
          '    if: ${{ inputs.deploy_storage_backup }}',
          '    # removed explicit Worker job guard',
        ),
      },
    })).toThrow(/dependency chain/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: stagingWorkflow.replace(
          'node scripts/verify-storage-backup-runtime-off.mjs',
          'node scripts/verify-release-manifest.mjs',
        ),
      },
    })).toThrow(/verify exact-OFF twice/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: stagingWorkflow.replace(
          '/usr/bin/timeout --signal=TERM --kill-after=5s 30s \\\n              "$GITHUB_WORKSPACE/node_modules/.bin/wrangler" kv key get runtime_config',
          '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" kv key get runtime_config',
        ),
      },
    })).toThrow(/deploy and verify the backup Worker exactly once/)

    for (const exactSurfaceEndpoint of [
      'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/bindings"',
      'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/routes?show_zonename=true"',
      'endpoint="workers/domains?service=$STORAGE_BACKUP_WORKER_NAME&environment=production"',
      'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/subdomain"',
      'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production"',
      'endpoint="workers/scripts/$STORAGE_BACKUP_WORKER_NAME/schedules"',
    ]) {
      expect(() => verifyReleaseConfiguration({
        ...configuration,
        workflows: {
          ...configuration.workflows,
          staging: stagingWorkflow.replace(exactSurfaceEndpoint, 'endpoint="workers/unapproved"'),
        },
      })).toThrow(/lacks trusted-quality guard|deploy and verify the backup Worker exactly once/)
    }
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: `${stagingWorkflow}\nendpoint="workers/scripts/$STORAGE_BACKUP_WORKER_NAME/settings"`,
      },
    })).toThrow(/deploy and verify the backup Worker exactly once/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        staging: stagingWorkflow.replace(
          'node scripts/cloudflare-api-get.mjs',
          'curl --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"',
        ),
      },
    })).toThrow(/token-from-environment helper/)

    for (const unsupported of ['keep_vars', 'secrets']) {
      const invalidProduction = JSON.parse(productionRaw)
      invalidProduction[unsupported] = unsupported === 'keep_vars'
        ? true
        : { required: ['SUPABASE_URL'] }
      expect(() => verifyReleaseConfiguration({
        ...configuration,
        productionRaw: JSON.stringify(invalidProduction),
      })).toThrow(/Wrangler keys that Pages does not support/)
    }

    const oneQualityVerification = productionWorkflow.replace(
      'run: node scripts/verify-github-quality-run.mjs',
      'run: echo "removed early quality verification"',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: oneQualityVerification },
    })).toThrow(/both early and immediately before deployment|exact approved commands/)

    const missingWorkerQualityRecheck = stagingWorkflow.replace(
      /(- name: Recheck trusted main quality before backup Worker deployment[\s\S]*?\brun:) node scripts\/verify-github-quality-run\.mjs/,
      '$1 echo "removed Worker quality recheck"',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, staging: missingWorkerQualityRecheck },
    })).toThrow(/early, before Pages, and before optional Worker mutation|exact approved commands/)

    const oneStagingRunVerification = productionWorkflow.replace(
      'run: node scripts/verify-github-staging-run.mjs',
      'run: echo "removed early Staging-run verification"',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: oneStagingRunVerification },
    })).toThrow(/exact approved Staging run both early and immediately before deployment|exact approved commands/)

    const oneAdvisorVerification = productionWorkflow.replace(
      /(Verify the current production Supabase Advisor state[\s\S]*?\n\s*)npm run security:supabase-advisors:hosted -- --environment production/,
      '$1echo "removed direct production Supabase Advisor verification"',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: oneAdvisorVerification },
    })).toThrow(/must receive only the ephemeral Supabase PAT|directly before every Pages|exact approved commands/)

    const outOfOrderFinalGuards = productionWorkflow
      .replace('Recheck the current production Supabase Advisor state immediately before deployment', '__ADVISOR__')
      .replace('Recheck the exact commit still passes trusted main quality', 'Recheck the current production Supabase Advisor state immediately before deployment')
      .replace('__ADVISOR__', 'Recheck the exact commit still passes trusted main quality')
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: outOfOrderFinalGuards },
    })).toThrow(/guards are out of order|must receive only the ephemeral Supabase PAT|must be immediately followed/)

    const unnamedMutationBetweenAdvisorAndDeploy = stagingWorkflow.replace(
      /(\r?\n\r?\n)( {6}- name: Deploy the exact commit to Staging Pages)/,
      '$1      - run: echo "unreviewed mutation"$1$2',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, staging: unnamedMutationBetweenAdvisorAndDeploy },
    })).toThrow(/must be immediately followed/)

    const advisorContinueOnError = productionWorkflow.replace(
      '      - name: Recheck the current production Supabase Advisor state immediately before deployment',
      '      - name: Recheck the current production Supabase Advisor state immediately before deployment\n        continue-on-error: true',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: advisorContinueOnError },
    })).toThrow(/must not allow continue-on-error/)

    const advisorBeforeSession = productionWorkflow.replace(
      '          node scripts/verify-ephemeral-supabase-lease.mjs\n          npm run security:supabase-advisors:hosted -- --environment production',
      '          npm run security:supabase-advisors:hosted -- --environment production\n          node scripts/verify-ephemeral-supabase-lease.mjs',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: advisorBeforeSession },
    })).toThrow(/must receive only the ephemeral Supabase PAT|exact approved commands/)

    const commentedAttemptGuard = stagingWorkflow.replace(
      '          if [[ "$GITHUB_RUN_ATTEMPT" != "1" ]]; then',
      '          # if [[ "$GITHUB_RUN_ATTEMPT" != "1" ]]; then',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, staging: commentedAttemptGuard },
    })).toThrow(/executable fail-closed shell guard/)

    const skippedRerunJob = stagingWorkflow.replace(
      '    name: Supervised deploy of verified commit to buril-lab-staging',
      "    name: Supervised deploy of verified commit to buril-lab-staging\n    if: github.run_attempt == 1",
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, staging: skippedRerunJob },
    })).toThrow(/dependency chain|must execute the validation job and fail visibly/)

    const suppressedRerunFailure = stagingWorkflow.replace(
      '            exit 1',
      '            true',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, staging: suppressedRerunFailure },
    })).toThrow(/must execute exit 1/)

    const skippedFinalAdvisor = productionWorkflow.replace(
      '      - name: Recheck the current production Supabase Advisor state immediately before deployment',
      '      - name: Recheck the current production Supabase Advisor state immediately before deployment\n        if: false',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: skippedFinalAdvisor },
    })).toThrow(/must be unconditional/)

    const alwaysRunPagesDeploy = productionWorkflow.replace(
      '      - name: Deploy the exact commit to production Pages',
      '      - name: Deploy the exact commit to production Pages\n        if: always()',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: alwaysRunPagesDeploy },
    })).toThrow(/must be unconditional/)

    const ignoredFinalQualityFailure = productionWorkflow.replace(
      '      - name: Recheck the exact commit still passes trusted main quality',
      '      - name: Recheck the exact commit still passes trusted main quality\n        continue-on-error: true',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: ignoredFinalQualityFailure },
    })).toThrow(/must not allow continue-on-error/)

    const suppressedAdvisorFailure = productionWorkflow.replace(
      'npm run security:supabase-advisors:hosted -- --environment production',
      'npm run security:supabase-advisors:hosted -- --environment production || true',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: suppressedAdvisorFailure },
    })).toThrow(/must not suppress command failures|exact approved commands/)

    for (const [workflowName, workflow, command] of [
      ['production', productionWorkflow, 'run: npm run ops:verify'],
      ['staging', stagingWorkflow, 'run: node scripts/verify-cloudflare-deploy-inputs.mjs'],
      ['production', productionWorkflow, 'run: npm audit --omit=dev --audit-level=high'],
      ['staging', stagingWorkflow, 'run: node scripts/verify-ephemeral-lease-grant.mjs'],
    ] as const) {
      const forcedSuccess = workflow.replace(command, `${command} || exit 0`)
      expect(() => verifyReleaseConfiguration({
        ...configuration,
        workflows: { ...configuration.workflows, [workflowName]: forcedSuccess },
      })).toThrow(/fully reviewed command contract|exact approved commands|must not suppress/)
    }

    const missingStagingCleanupReceipt = productionWorkflow.replace(
      'STAGING_EPHEMERAL_CLEANUP_RECEIPT: ${{ vars.STAGING_EPHEMERAL_CLEANUP_RECEIPT }}',
      'STAGING_EPHEMERAL_CLEANUP_RECEIPT: unsigned',
    )
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, production: missingStagingCleanupReceipt },
    })).toThrow(/cross-environment cleanup gates are incomplete|fully reviewed command contract/)

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
      browser: {
        ...configuration.browser,
        gate0Spec: `${gate0Spec}\ncontext.route('**/*', () => undefined)`,
      },
    })).toThrow(/broad all-origin route/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      browser: {
        ...configuration.browser,
        targetConfig: gate0TargetConfig.replace('labels.length === 4', 'labels.length >= 4'),
      },
    })).toThrow(/exact-deployment control/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      browser: {
        ...configuration.browser,
        gate0Spec: gate0Spec.replaceAll('expectExactStagingTargetOrigin(', 'removedOriginCheck('),
      },
    })).toThrow(/exact-origin control/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      browser: {
        ...configuration.browser,
        targetConfig: gate0TargetConfig.replaceAll(
          'target.immutableLabel !== canonicalDeploymentId.slice(0, 8)',
          'false',
        ),
      },
    })).toThrow(/exact-deployment control/)

    expect(() => verifyReleaseConfiguration({
      ...configuration,
      browser: {
        ...configuration.browser,
        targetConfig: gate0TargetConfig.replace(
          "request.pathname.startsWith('/api/')",
          "request.pathname.startsWith('/')",
        ),
      },
    })).toThrow(/exact-deployment control/)

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
        staging: stagingWorkflow.replace('--include-status true', '--include-status false'),
      },
    })).toThrow(/include-status true|token-from-environment helper/)
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: {
        ...configuration.workflows,
        production: productionWorkflow.replace(
          'node scripts/cloudflare-api-get.mjs',
          'curl --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"',
        ),
      },
    })).toThrow(/token-from-environment helper/)

    const outOfOrderStagingFixture = stagingWorkflow
      .replace('Reset the exact Staging Gate 0 synthetic fixture for the custom domain', '__FIXTURE__')
      .replace(
        'Run the protected custom-domain Staging Gate 0 browser flow',
        'Reset the exact Staging Gate 0 synthetic fixture for the custom domain',
      )
      .replace('__FIXTURE__', 'Run the protected custom-domain Staging Gate 0 browser flow')
    expect(() => verifyReleaseConfiguration({
      ...configuration,
      workflows: { ...configuration.workflows, staging: outOfOrderStagingFixture },
    })).toThrow(/exact-target resets, and browser gates are out of order/)
  })
})
