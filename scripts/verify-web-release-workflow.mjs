import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { load } from 'js-yaml'

function check(condition, message) {
  if (!condition) throw new Error(`Web release workflow: ${message}`)
}

export function verifyWebReleaseWorkflow(source) {
  const workflow = load(source)
  check(JSON.stringify(Object.keys(workflow.on).sort()) === JSON.stringify(['workflow_dispatch', 'workflow_run']),
    'only trusted quality completion and manual production dispatch are allowed')
  check(workflow.on.workflow_dispatch === null, 'production must not require manual identifiers or accept unchecked overrides')
  check(JSON.stringify(workflow.on.workflow_run) === JSON.stringify({ workflows: ['Quality and security'], types: ['completed'], branches: ['main'] }),
    'staging must follow main quality completion')
  check(JSON.stringify(workflow.permissions) === JSON.stringify({ contents: 'read', actions: 'read' }), 'token permissions must remain read-only')
  check(workflow.concurrency?.['cancel-in-progress'] === false
    && workflow.concurrency.group === "${{ github.event_name == 'workflow_run' && 'cloudflare-staging' || 'cloudflare-production' }}",
  'deployments must share non-cancelling environment locks with maintenance')
  check(JSON.stringify(Object.keys(workflow.jobs).sort()) === JSON.stringify(['build', 'deploy', 'select']), 'expected separate selection, build, and deployment jobs')
  const { select, build, deploy } = workflow.jobs
  for (const guard of ["vars.WEB_RELEASE_ENABLED == 'true'", "github.repository == 'haengjoo123/buril-lab'",
    "github.ref == 'refs/heads/main'", "github.event.workflow_run.conclusion == 'success'",
    'github.event.workflow_run.head_repository.full_name == github.repository']) {
    check(select.if.includes(guard), 'trusted-event and activation guards must remain present')
  }
  check(build.needs === 'select' && JSON.stringify(deploy.needs) === JSON.stringify(['select', 'build']), 'deployment must depend on successful selection and build')
  check(build.environment === '${{ needs.select.outputs.environment }}'
    && deploy.environment.name === '${{ needs.select.outputs.environment }}', 'environments must come from validated selection')
  const allowedActions = new Set([
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
  ])
  for (const job of Object.values(workflow.jobs)) {
    check(job['runs-on'] === 'ubuntu-latest' && job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 35, 'use bounded fresh hosted runners')
    check(!job['continue-on-error'], 'jobs may not suppress failures')
    check(!JSON.stringify(job.env || {}).includes('WEB_PAGES_TOKEN') && !JSON.stringify(job.env || {}).includes('WEB_ADVISOR_TOKEN'), 'provider credentials may not be job-scoped')
    for (const step of job.steps) {
      check(!step['continue-on-error'], 'steps may not suppress failures')
      if (step.uses) check(allowedActions.has(step.uses), 'external actions must use reviewed immutable references')
      if (step.uses?.startsWith('actions/checkout@')) check(step.with['persist-credentials'] === false, 'checkouts must not retain GitHub credentials')
      if (JSON.stringify(step).includes('secrets.WEB_PAGES_TOKEN')) check(step.run === 'node scripts/web-release-pages.mjs deploy', 'Pages token must only reach the deploy process')
      if (JSON.stringify(step).includes('secrets.WEB_ADVISOR_TOKEN')) check(step.run === 'npm run security:supabase-advisors:hosted -- --environment "$DEPLOY_ENVIRONMENT"', 'advisor token must only reach the security check')
    }
  }
  check(!/WEB_PAGES_TOKEN|WEB_ADVISOR_TOKEN|SERVICE_ROLE_KEY/.test(JSON.stringify(build)), 'build must not receive provider or backend credentials')
  const runs = deploy.steps.map((step) => step.run).filter(Boolean)
  for (const required of ['node scripts/verify-github-artifact-digest.mjs', 'node scripts/web-release-artifact.mjs verify',
    'npm audit --omit=dev --audit-level=high', 'npm run security:supabase-advisors:hosted -- --environment "$DEPLOY_ENVIRONMENT"',
    'node scripts/web-release.mjs guard', 'node scripts/web-release-pages.mjs deploy', 'node scripts/web-release-pages.mjs verify']) {
    check(runs.includes(required), `missing safety gate: ${required}`)
    check(!deploy.steps.find((step) => step.run === required).if, `safety gate cannot be conditional: ${required}`)
  }
  check(runs.indexOf('node scripts/web-release.mjs guard') < runs.indexOf('node scripts/web-release-pages.mjs deploy'), 'promotion checks must precede mutation')
  const evidence = deploy.steps.find((step) => step.with?.name?.startsWith('web-evidence-'))
  check(evidence && !evidence.if.includes('always') && deploy.steps.indexOf(evidence) > deploy.steps.findIndex((step) => step.run === 'node scripts/web-release-pages.mjs verify'),
    'staging evidence must only be published after successful live verification')
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyWebReleaseWorkflow(await readFile('.github/workflows/web-release.yml', 'utf8'))
  console.log('Three-step web release workflow safety checks passed.')
}
