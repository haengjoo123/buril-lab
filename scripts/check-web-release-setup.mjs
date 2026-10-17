import { execFileSync } from 'node:child_process'

const repository = 'haengjoo123/buril-lab'
const problems = []
function api(path) {
  return JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${path}`], {
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
  }))
}
function names(path, key) {
  const payload = api(`${path}?per_page=100`)
  if (payload.total_count > 100) throw new Error('Setup inventory exceeds the bounded check.')
  return new Set(payload[key].map((item) => item.name))
}
function issue(message) { problems.push(message) }

try {
  const repositorySecrets = names('actions/secrets', 'secrets')
  for (const name of ['WEB_PAGES_TOKEN', 'WEB_ADVISOR_TOKEN']) {
    if (repositorySecrets.has(name)) issue(`${name}: remove the repository-level fallback; use distinct environment secrets.`)
  }
  const protection = api('branches/main/protection')
  const checks = protection.required_status_checks?.contexts || []
  for (const name of ['Application checks', 'Cloudflare release contract', 'Blank database interface', 'Gate 0 browser interface']) {
    if (!checks.includes(name)) issue(`main: missing required check ${name}`)
  }
  if (!protection.enforce_admins?.enabled) issue('main: require checks for administrators as well.')
  for (const environment of ['staging', 'production']) {
    const settings = api(`environments/${environment}`)
    const policies = api(`environments/${environment}/deployment-branch-policies`).branch_policies
    if (settings.deployment_branch_policy?.custom_branch_policies !== true || policies.length !== 1
      || policies[0].name !== 'main' || policies[0].type !== 'branch') issue(`${environment}: allow only the main branch.`)
    if (environment === 'staging' && settings.protection_rules.some((rule) => rule.type !== 'branch_policy')) {
      issue('staging: approval or timer rules would prevent unattended staging.')
    }
    const secrets = names(`environments/${environment}/secrets`, 'secrets')
    for (const name of ['WEB_PAGES_TOKEN', 'WEB_ADVISOR_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'BURILLAB_RUNTIME_CONFIG_KV_ID',
      'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'STAGING_ACCESS_CLIENT_ID', 'STAGING_ACCESS_CLIENT_SECRET',
      ...(environment === 'staging' ? ['STAGING_SUPABASE_SERVICE_ROLE_KEY', 'GATE0_E2E_EMAIL', 'GATE0_E2E_PASSWORD'] : [])]) {
      if (!secrets.has(name)) issue(`${environment}: missing secret ${name}`)
    }
    const variables = names(`environments/${environment}/variables`, 'variables')
    for (const name of ['SUPABASE_PROJECT_REF', 'VITE_ENABLE_WASTE_V2', 'VITE_ENABLE_PH_PREDICTION',
      'VITE_ENABLE_CHEMICAL_ENRICHMENT', 'VITE_ENABLE_SEARCH_ANALYTICS', 'VITE_ENABLE_WASTE_CONTAINERS']) {
      if (!variables.has(name)) issue(`${environment}: missing variable ${name}`)
    }
    for (const name of ['EPHEMERAL_PROVIDER_CREATION_PENDING', 'EPHEMERAL_LEASE_GRANT']) {
      if (variables.has(name)) issue(`${environment}: finish the existing supervised release before activation (${name}).`)
    }
  }
  if (problems.length) {
    console.error('One-time Web release setup is not complete:\n' + problems.map((message) => `- ${message}`).join('\n'))
    process.exitCode = 1
  } else {
    console.log('Web release metadata prerequisites passed. Secret contents and provider scopes still require an actual staging run.')
    console.log('Activate with: gh variable set WEB_RELEASE_ENABLED --repo haengjoo123/buril-lab --body true')
    console.log('Then run Quality and security on main to start the first automatic staging validation.')
  }
} catch {
  console.error('Unable to inspect release settings. Run gh auth status and confirm repository administration access. No settings were changed.')
  process.exitCode = 1
}
