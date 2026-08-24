import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'

const EXPECTED_REQUIRED_SECRETS = [
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
const FORBIDDEN_PREP0_WORKFLOW_TERMS = [
  'account deletion',
  'deletion-scheduler',
  'deploy_scheduler',
  'mfa',
  'paid release',
  'storage-backup',
]

function parseConfig(raw, name) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${name} must remain strict JSON inside its .jsonc file.`)
  }
  return parsed
}

function verifyWranglerConfig(config, {
  name,
  environment,
  origin,
  placeholder,
  requireEmptyPreview,
}) {
  if (config.name !== name || config.pages_build_output_dir !== './dist') {
    throw new Error(`${name} Wrangler identity or build output is invalid.`)
  }
  if (config.compatibility_date !== '2026-08-24') {
    throw new Error(`${name} Wrangler compatibility date is not pinned to the release baseline.`)
  }
  if (!Array.isArray(config.compatibility_flags) || !config.compatibility_flags.includes('nodejs_compat')) {
    throw new Error(`${name} must enable nodejs_compat.`)
  }
  if (config.keep_vars !== true || config.send_metrics !== false) {
    throw new Error(`${name} Wrangler variable preservation or telemetry policy is invalid.`)
  }
  if (
    !Array.isArray(config.kv_namespaces)
    || config.kv_namespaces.length !== 1
    || config.kv_namespaces[0]?.binding !== 'BURILLAB_RUNTIME_CONFIG'
    || config.kv_namespaces[0]?.id !== placeholder
  ) {
    throw new Error(`${name} runtime-config KV template is invalid.`)
  }
  if (config.vars?.APP_ENVIRONMENT !== environment || config.vars?.PUBLIC_APP_ORIGIN !== origin) {
    throw new Error(`${name} public environment identity is invalid.`)
  }

  const requiredSecrets = [...(config.secrets?.required || [])].sort()
  if (JSON.stringify(requiredSecrets) !== JSON.stringify(EXPECTED_REQUIRED_SECRETS)) {
    throw new Error(`${name} required server-secret names drifted.`)
  }

  if (requireEmptyPreview) {
    if (
      !Array.isArray(config.env?.preview?.kv_namespaces)
      || config.env.preview.kv_namespaces.length !== 0
      || config.env.preview.vars?.APP_ENVIRONMENT !== 'production-preview-disabled'
    ) {
      throw new Error('Production preview must not inherit the production runtime-config KV binding.')
    }
  }
}

export function verifyReleaseConfiguration({ productionRaw, stagingRaw, workflows }) {
  const production = parseConfig(productionRaw, 'Production Wrangler config')
  const staging = parseConfig(stagingRaw, 'Staging Wrangler config')

  verifyWranglerConfig(production, {
    name: RELEASE_ENVIRONMENTS.production.project,
    environment: 'production',
    origin: RELEASE_ENVIRONMENTS.production.origin,
    placeholder: '__BURILLAB_PRODUCTION_RUNTIME_CONFIG_KV_ID__',
    requireEmptyPreview: true,
  })
  verifyWranglerConfig(staging, {
    name: RELEASE_ENVIRONMENTS.staging.project,
    environment: 'staging',
    origin: RELEASE_ENVIRONMENTS.staging.origin,
    placeholder: '__BURILLAB_STAGING_RUNTIME_CONFIG_KV_ID__',
    requireEmptyPreview: false,
  })

  if (RELEASE_ENVIRONMENTS.staging.supabaseProjectRef === RELEASE_ENVIRONMENTS.production.supabaseProjectRef) {
    throw new Error('Staging and production Supabase project references must differ.')
  }
  if (productionRaw.includes('__BURILLAB_STAGING_RUNTIME_CONFIG_KV_ID__')) {
    throw new Error('Production Wrangler template references the Staging KV placeholder.')
  }
  if (stagingRaw.includes('__BURILLAB_PRODUCTION_RUNTIME_CONFIG_KV_ID__')) {
    throw new Error('Staging Wrangler template references the Production KV placeholder.')
  }

  const workflowText = Object.values(workflows).join('\n').toLowerCase()
  const forbidden = FORBIDDEN_PREP0_WORKFLOW_TERMS.filter((term) => workflowText.includes(term))
  if (forbidden.length > 0) {
    throw new Error(`Prep 0 workflows contain deferred scope: ${forbidden.join(', ')}`)
  }

  const stagingWorkflow = workflows.staging || ''
  for (const required of [
    'workflow_run:',
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    'github.event.workflow_run.head_repository.full_name == github.repository',
    'ref: ${{ github.event.workflow_run.head_sha }}',
    'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    'Recheck that Staging still targets the current main tip',
    'steps.staging-deployment.outputs.deployment_url',
    'node scripts/read-pages-deployment.mjs',
    'api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$CLOUDFLARE_PAGES_PROJECT/deployments?env=production',
    '--environment staging',
    '--project "$CLOUDFLARE_PAGES_PROJECT"',
  ]) {
    if (!stagingWorkflow.includes(required)) {
      throw new Error(`Staging workflow lacks trusted-quality guard: ${required}`)
    }
  }

  const qualityWorkflow = workflows.quality || ''
  const hostedAdvisorGuard = "if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main' && github.repository == 'haengjoo123/buril-lab'"
  if (!qualityWorkflow.includes(hostedAdvisorGuard)) {
    throw new Error('Quality workflow lacks the exact hosted Advisor push/manual-main guard.')
  }

  const productionWorkflow = workflows.production || ''
  for (const required of [
    'workflow_dispatch:',
    "if: github.event_name == 'workflow_dispatch' && github.repository == 'haengjoo123/buril-lab' && github.ref == 'refs/heads/main'",
    'DEPLOY buril-lab production $DEPLOY_COMMIT_SHA',
    'if [[ "$DEPLOY_COMMIT_SHA" != "$GITHUB_SHA" ]]',
    'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    'node scripts/verify-github-quality-run.mjs',
    'version: 2.115.0',
    'npm audit --omit=dev --audit-level=high',
    'npm run security:supabase-advisors:hosted --',
    '--environment production',
    'SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}',
    'Recheck the exact commit still passes trusted main quality',
    'https://staging.burillab.com/release.json',
    'https://buril-lab-staging.pages.dev/release.json',
    'steps.staging-deployment.outputs.deployment_url',
    'node scripts/read-pages-deployment.mjs',
    'id: production-deployment',
    'api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$CLOUDFLARE_PAGES_PROJECT/deployments?env=production',
    '--environment production',
    '--project "$CLOUDFLARE_PAGES_PROJECT"',
    'steps.production-deployment.outputs.deployment_url',
  ]) {
    if (!productionWorkflow.includes(required)) {
      throw new Error(`Production workflow lacks a manual release guard: ${required}`)
    }
  }

  const qualityRunVerifier = 'node scripts/verify-github-quality-run.mjs'
  if (productionWorkflow.split(qualityRunVerifier).length - 1 < 2) {
    throw new Error('Production workflow must verify trusted main quality both early and immediately before deployment.')
  }
  const finalGuardOrder = [
    'Recheck production Supabase Security Advisor immediately before deployment',
    'Recheck the exact commit still passes trusted main quality',
    'Recheck that production still targets the current main tip',
    'Deploy the exact commit to production Pages',
  ].map((marker) => productionWorkflow.indexOf(marker))
  if (finalGuardOrder.some((position) => position < 0)
      || finalGuardOrder.some((position, index) => index > 0 && position <= finalGuardOrder[index - 1])) {
    throw new Error('Production final Advisor, quality, main-tip, and Pages deploy guards are out of order.')
  }

  return { projectCount: 2, requiredServerSecretCount: EXPECTED_REQUIRED_SECRETS.length }
}

async function main() {
  const [productionRaw, stagingRaw, stagingWorkflow, productionWorkflow, qualityWorkflow] = await Promise.all([
    readFile('wrangler.jsonc', 'utf8'),
    readFile('wrangler.staging.jsonc', 'utf8'),
    readFile('.github/workflows/deploy-staging.yml', 'utf8'),
    readFile('.github/workflows/deploy-production.yml', 'utf8'),
    readFile('.github/workflows/quality.yml', 'utf8'),
  ])
  const result = verifyReleaseConfiguration({
    productionRaw,
    stagingRaw,
    workflows: {
      staging: stagingWorkflow,
      production: productionWorkflow,
      quality: qualityWorkflow,
    },
  })
  console.log(
    `Cloudflare release configuration passed (${result.projectCount} isolated Pages projects; ${result.requiredServerSecretCount} required server-secret names).`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Cloudflare release configuration failed.')
    process.exitCode = 1
  })
}
