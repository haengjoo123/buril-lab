import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'
import { REQUIRED_SERVER_SECRETS } from './verify-pages-project-config.mjs'
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

function occurrenceCount(text, needle) {
  return text.split(needle).length - 1
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
  if ('keep_vars' in config || 'secrets' in config) {
    throw new Error(`${name} contains Wrangler keys that Pages does not support.`)
  }
  if (config.send_metrics !== false) {
    throw new Error(`${name} Wrangler telemetry policy is invalid.`)
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

export function verifyReleaseConfiguration({ productionRaw, stagingRaw, workflows, browser = {} }) {
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
  if (stagingWorkflow.includes('secrets.SUPABASE_SERVICE_ROLE_KEY')) {
    throw new Error('Staging must use the existing staging-prefixed Supabase service-role secret.')
  }
  for (const required of [
    'workflow_run:',
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    'github.event.workflow_run.head_repository.full_name == github.repository',
    'ref: ${{ github.event.workflow_run.head_sha }}',
    'STAGING_KOSHA_CONTENT_MODE: link_only',
    'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    'Recheck that Staging still targets the current main tip',
    'steps.staging-deployment.outputs.deployment_url',
    'node scripts/read-pages-deployment.mjs',
    'set -o pipefail',
    '--file -',
    'api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$CLOUDFLARE_PAGES_PROJECT/deployments?env=production',
    '--environment staging',
    '--project "$CLOUDFLARE_PAGES_PROJECT"',
    'npx playwright install --with-deps chromium',
    'SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}',
    'GATE0_E2E_EMAIL: ${{ secrets.GATE0_E2E_EMAIL }}',
    'GATE0_E2E_PASSWORD: ${{ secrets.GATE0_E2E_PASSWORD }}',
    'GATE0_STAGING_SEED_CONFIRMATION: SEED GATE0 SYNTHETIC DATA qpgnomuqdcucjmxrunnw',
    'SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}',
    'node scripts/seed-gate0-e2e.mjs',
    'npm run test:e2e:gate0:staging',
    'node scripts/verify-staging-kosha-link-only.mjs',
  ]) {
    if (!stagingWorkflow.includes(required)) {
      throw new Error(`Staging workflow lacks trusted-quality guard: ${required}`)
    }
  }
  if (/--(?:output|file)\s+\S*deployments\.json/.test(stagingWorkflow)) {
    throw new Error('Staging workflow must not persist the raw Pages deployment-list response.')
  }
  if (
    occurrenceCount(stagingWorkflow, '--connect-timeout 10') !== 1
    || occurrenceCount(stagingWorkflow, '--max-time 30') !== 1
  ) {
    throw new Error('Every Staging deployment lookup must have bounded curl timeouts.')
  }
  if (
    occurrenceCount(stagingWorkflow, 'GATE0_E2E_EMAIL: ${{ secrets.GATE0_E2E_EMAIL }}') < 3
    || occurrenceCount(stagingWorkflow, 'GATE0_E2E_PASSWORD: ${{ secrets.GATE0_E2E_PASSWORD }}') < 3
    || occurrenceCount(stagingWorkflow, 'SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}') < 2
    || occurrenceCount(stagingWorkflow, 'GATE0_STAGING_SEED_CONFIRMATION: SEED GATE0 SYNTHETIC DATA qpgnomuqdcucjmxrunnw') < 2
  ) {
    throw new Error('Staging Gate0 secrets must be checked before deployment and scoped to fixture reset/test steps.')
  }
  const stagingGateOrder = [
    'Verify environment-scoped deployment inputs',
    'Deploy the exact commit to Staging Pages',
    'Verify the protected Staging release manifest',
    'Verify the Staging KOSHA link-only runtime contract',
    'Reset the exact Staging Gate 0 synthetic fixture',
    'Run the protected Staging Gate 0 browser flow',
  ].map((marker) => stagingWorkflow.indexOf(marker))
  if (stagingGateOrder.some((position) => position < 0)
      || stagingGateOrder.some((position, index) => index > 0 && position <= stagingGateOrder[index - 1])) {
    throw new Error('Staging preflight, deployment, release, KOSHA, synthetic reset, and browser gates are out of order.')
  }

  const stagingPlaywrightConfig = browser.stagingConfig || ''
  const gate0Spec = browser.gate0Spec || ''
  const gate0AccessRoute = browser.accessRoute || ''
  if (stagingPlaywrightConfig.includes('extraHTTPHeaders')) {
    throw new Error('Staging Playwright must not send Access credentials through context-wide headers.')
  }
  if (!stagingPlaywrightConfig.includes("trace: 'off'")) {
    throw new Error('Staging Playwright traces must remain off while Access credentials are in memory.')
  }
  for (const required of [
    "const STAGING_ORIGIN = 'https://staging.burillab.com'",
    'context.route(`${STAGING_ORIGIN}/**`',
    "import { fulfillStagingAccessRoute } from '../../scripts/gate0-access-route.mjs'",
    'fulfillStagingAccessRoute(route, { clientId, clientSecret })',
    "page.route('**/api/chemicals/enrich'",
    "route.abort('blockedbyclient')",
    'verifyGate0EnrichmentIsolation({',
  ]) {
    if (!gate0Spec.includes(required)) {
      throw new Error(`Gate0 Access routing lacks an exact-origin control: ${required}`)
    }
  }
  if (gate0Spec.includes('route.continue(')) {
    throw new Error('Gate0 Access routing must not continue credentials across a redirect chain.')
  }
  for (const required of [
    'const response = await route.fetch({',
    "'CF-Access-Client-Id': clientId",
    "'CF-Access-Client-Secret': clientSecret",
    'maxRedirects: 0',
    'await route.fulfill({ response })',
  ]) {
    if (!gate0AccessRoute.includes(required)) {
      throw new Error(`Gate0 Access routing lacks a one-hop redirect boundary: ${required}`)
    }
  }
  if (occurrenceCount(gate0AccessRoute, 'route.fetch(') !== 1) {
    throw new Error('Gate0 Access routing must make exactly one bounded protected-origin fetch per route.')
  }
  if (
    stagingWorkflow.includes('convert-gate0-legacy-owner.mjs')
    || stagingWorkflow.includes('GATE0_LEGACY_CONVERSION_CONFIRMATION')
  ) {
    throw new Error('Legacy Gate0 ownership conversion must remain an explicit manual-only operation.')
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
    'STAGING_KOSHA_CONTENT_MODE: link_only',
    'if [[ "$DEPLOY_COMMIT_SHA" != "$GITHUB_SHA" ]]',
    'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    'node scripts/verify-github-quality-run.mjs',
    'node scripts/verify-github-staging-run.mjs',
    'version: 2.115.0',
    'npm audit --omit=dev --audit-level=high',
    'npm run security:supabase-advisors:hosted --',
    '--environment production',
    'SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}',
    'Recheck the exact commit still passes trusted main quality',
    'Recheck the latest exact-SHA Staging workflow still succeeded',
    'https://staging.burillab.com/release.json',
    'https://buril-lab-staging.pages.dev/release.json',
    'steps.staging-deployment.outputs.deployment_url',
    'node scripts/read-pages-deployment.mjs',
    'set -o pipefail',
    '--file -',
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
  const stagingRunVerifier = 'node scripts/verify-github-staging-run.mjs'
  if (productionWorkflow.split(stagingRunVerifier).length - 1 < 2) {
    throw new Error('Production workflow must verify the latest exact-SHA Staging run both early and immediately before deployment.')
  }
  if (/--(?:output|file)\s+\S*deployments\.json/.test(productionWorkflow)) {
    throw new Error('Production workflow must not persist the raw Pages deployment-list response.')
  }
  if (
    occurrenceCount(productionWorkflow, '--connect-timeout 10') !== 2
    || occurrenceCount(productionWorkflow, '--max-time 30') !== 2
  ) {
    throw new Error('Every Production workflow deployment lookup must have bounded curl timeouts.')
  }
  const finalGuardOrder = [
    'Recheck production Supabase Security Advisor immediately before deployment',
    'Recheck the exact commit still passes trusted main quality',
    'Recheck the latest exact-SHA Staging workflow still succeeded',
    'Recheck that production still targets the current main tip',
    'Deploy the exact commit to production Pages',
  ].map((marker) => productionWorkflow.indexOf(marker))
  if (finalGuardOrder.some((position) => position < 0)
      || finalGuardOrder.some((position, index) => index > 0 && position <= finalGuardOrder[index - 1])) {
    throw new Error('Production final Advisor, quality, Staging-run, main-tip, and Pages deploy guards are out of order.')
  }

  return { projectCount: 2, requiredServerSecretCount: REQUIRED_SERVER_SECRETS.length }
}

async function main() {
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
  const result = verifyReleaseConfiguration({
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
