import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'
import { REQUIRED_SERVER_SECRETS } from './verify-pages-project-config.mjs'
const FORBIDDEN_PREP0_WORKFLOW_TERMS = [
  'account deletion',
  'deletion-scheduler',
  'deploy_scheduler',
  'mfa',
  'paid release',
]
const FORBIDDEN_PRODUCTION_STORAGE_BACKUP_TERMS = [
  'workers/storage-backup/wrangler.staging.jsonc',
  'buril-lab-storage-backup-staging',
  'qpgnomuqdcucjmxrunnw',
  'dcaa52254fa6447bbe7c21f54354ad0d',
  'buril-lab-cabinet-backups-staging',
  'staging_supabase_service_role_key',
  'staging_cloudflare_api_token',
  'staging_worker_ephemeral_token',
  '--secrets-file',
  'wrangler secret put',
  'wrangler secret bulk',
  'wrangler secret delete',
  'wrangler kv key put',
  'wrangler kv key delete',
  'wrangler kv bulk put',
  'wrangler kv bulk delete',
  '--keep-vars',
  'storage_backup_enabled=true',
  '"storage_backup_enabled":true',
  '"storage_backup_enabled": true',
]
const FORBIDDEN_STAGING_STORAGE_BACKUP_TERMS = [
  'workers/storage-backup/wrangler.production.jsonc',
  'buril-lab-storage-backup-production',
  'zafxzidbtbryiksemlwc',
  'dd6866f35f794a91b0fb5a24cbe57cf3',
  'buril-lab-cabinet-backups-production',
  'wrangler secret put',
  'wrangler secret bulk',
  'wrangler secret delete',
  'wrangler kv key put',
  'wrangler kv key delete',
  'wrangler kv bulk put',
  'wrangler kv bulk delete',
  '--keep-vars',
  'storage_backup_enabled=true',
  '"storage_backup_enabled":true',
  '"storage_backup_enabled": true',
]
const STAGING_RELEASE_WORKFLOW_SHA256 = [
  'edcaeb0f2ccbcce5',
  '133cd415602e4de0',
  '415230b07427ef11',
  '98d58e398f8e8936',
].join('')
const STAGING_CREDENTIAL_INJECTION_PROBE_WORKFLOW_SHA256 = [
  '0c986e96cb6324fb',
  '3e5a667639170280',
  '8fc72c88d0324308',
  '1f71f2eb2ed1f0e8',
].join('')
const STAGING_ROLLBACK_VERIFICATION_WORKFLOW_SHA256 = 'd278ccb8f65af20551fbc065fa84b21a36953804944bf35c53f08f2885aedc89'
const STAGING_STORAGE_BACKUP_ACCEPTANCE_WORKFLOW_SHA256 = '98ed65a9c1934a4c0583dae60030d765465dab797badafb76d1553cb7ee077c5'
const PINNED_RELEASE_WORKFLOW_SHA256 = Object.freeze({
  staging: STAGING_RELEASE_WORKFLOW_SHA256,
  production: '2cd59ed92644fe7edea197fdf91ecc9d2ff761ac651df6235475541453d4ec82',
  quality: '0d457dda7b5ee48057de3591de3a1fe169116569a96cc19bdebdf07f9406dead',
  'ios-testflight.yml': '02b5d6c03f8abdb5ebee17fd823e77fed8ec4560a332a6ead20915af6ade7f87',
  'verify-ops3-staging-live.yml': '23971e8c0e147d55c2cdec555560c8e7a1146f60a5d54be20f41011714128d17',
  'verify-staging-ephemeral-credentials.yml': STAGING_CREDENTIAL_INJECTION_PROBE_WORKFLOW_SHA256,
  'verify-staging-rollback.yml': STAGING_ROLLBACK_VERIFICATION_WORKFLOW_SHA256,
  'verify-staging-storage-backup.yml': STAGING_STORAGE_BACKUP_ACCEPTANCE_WORKFLOW_SHA256,
})
const PINNED_CLOUDFLARE_HELPER_DIGEST = '50353a0f5b6fa7702d5e1fa01c77a31bd48368d009fbf7a734e73f451c80086b'
const PINNED_GITHUB_ARTIFACT_DIGEST_HELPER_SHA256 = 'e9a649faa2f59ef515b62260abe29f7b0c73393c138223c838ee444a11dd8bbe'
const PINNED_WRANGLER_OUTPUT_HELPER_SHA256 = 'f6f7f7f615d022fd971e0df2b39c8e6e6be2dde23efdb6e7f604c90b4041d299'
const PINNED_STAGING_ROLLBACK_PREPARATION_HELPER_SHA256 = '85695732038b715b4d62c0ebacd240ff35255423de726a452effba99d03c50af'
const PINNED_STAGING_STORAGE_BACKUP_ACCEPTANCE_HELPER_SHA256 = 'dbf45ed48652f9eeff6895e0691c9c06728de2aec8d8d47c5ccdeaebb32c6c03'
const APPROVED_WORKFLOW_ACTION_REFERENCES = Object.freeze({
  staging: [
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  ],
  production: [
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  ],
  quality: [
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e',
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'supabase/setup-cli@ab058987d8d6c725971f6cf9d0b5c98467e30bd1',
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'supabase/setup-cli@ab058987d8d6c725971f6cf9d0b5c98467e30bd1',
  ],
  'verify-ops3-staging-live.yml': [
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  ],
  'verify-staging-ephemeral-credentials.yml': [
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  ],
  'verify-staging-rollback.yml': [
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  ],
  'verify-staging-storage-backup.yml': [
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  ],
  'ios-testflight.yml': [],
})

function parseConfig(raw, name) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${name} must remain strict JSON inside its .jsonc file.`)
  }
  return parsed
}

function requireExactObjectKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} has an invalid shape.`)
  }
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains missing or unapproved fields.`)
  }
}

function occurrenceCount(text, needle) {
  return text.split(needle).length - 1
}

function exactTrimmedLineCount(text, expected) {
  return text.split(/\r?\n/).filter((line) => line.trim() === expected).length
}

function normalizeLineEndings(value) {
  return String(value).replace(/\r\n/g, '\n')
}

function normalizedWorkflowHash(workflow) {
  const normalized = normalizeLineEndings(workflow).trimEnd()
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

function rawSourceHash(source) {
  return createHash('sha256').update(normalizeLineEndings(source), 'utf8').digest('hex')
}

function externalActionReferences(workflow) {
  return [...String(workflow).matchAll(/^\s*(?:-\s*)?uses:\s+([^\s#]+)/gm)]
    .map((match) => match[1])
    .filter((reference) => !reference.startsWith('./'))
}

export function verifyCloudflareApiHelperSource(source) {
  if (rawSourceHash(source) !== PINNED_CLOUDFLARE_HELPER_DIGEST) {
    throw new Error('Cloudflare API helper differs from the fully reviewed token-handling contract.')
  }
  return true
}

export function verifyStorageBackupWorkerTokenDocumentation(source) {
  const requiredPermissions = [
    '**Workers Scripts Edit**',
    '**Workers KV Storage Read**',
    '**Workers R2 Storage Read**',
  ]
  const tokenSection = String(source).match(
    /`STAGING_WORKER_EPHEMERAL_TOKEN`[\s\S]*?The Pages and Worker token values must differ\./,
  )?.[0]
  if (!tokenSection || requiredPermissions.some((permission) => !tokenSection.includes(permission))) {
    throw new Error('Storage-backup Worker token documentation must require Scripts Edit, KV Read, and R2 Read.')
  }
  if (
    !tokenSection.includes('GET /accounts/{account_id}/r2/buckets/{bucket_name}')
    || !tokenSection.includes('https://developers.cloudflare.com/fundamentals/api/reference/permissions/')
    || !tokenSection.includes('https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/list/')
  ) {
    throw new Error('Storage-backup Worker token documentation must pin the Wrangler R2 lookup and official permission evidence.')
  }
  const productionTokenSection = String(source).match(
    /`PRODUCTION_WORKER_EPHEMERAL_TOKEN`[\s\S]*?existing provider\s+secret remains intact\./,
  )?.[0]
  if (
    !productionTokenSection
    || requiredPermissions.some((permission) => !productionTokenSection.includes(permission))
    || !/never uses\s+`--secrets-file`/.test(productionTokenSection)
    || !productionTokenSection.includes('`SUPABASE_SERVICE_ROLE_KEY`')
  ) {
    throw new Error('Production Worker token documentation must require the exact read-only code-deploy contract.')
  }
  const acceptanceSection = String(source).match(
    /`STAGING_CLOUDFLARE_STORAGE_BACKUP_ACCEPTANCE_TOKEN`[\s\S]*?must\s+never\s+be\s+delivered\s+to\s+`production`\./,
  )?.[0]
  if (
    !acceptanceSection
    || !acceptanceSection.includes('**Workers R2 Storage Read**')
    || !acceptanceSection.includes('**Workers R2 Storage Write**')
    || !acceptanceSection.includes('https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/delete/')
  ) {
    throw new Error('Storage-backup acceptance token documentation must require R2 Read/Write and pin the official delete API evidence.')
  }
  return true
}

function cloudflareTokenSecretNames(workflow) {
  return [...workflow.matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)]
    .map((match) => match[1])
    .filter((name) => {
      const normalized = name.toUpperCase()
      return (normalized.includes('CLOUDFLARE') && normalized.includes('TOKEN'))
        || normalized.includes('PAGES_EPHEMERAL_TOKEN')
        || normalized.includes('WORKER_EPHEMERAL_TOKEN')
    })
}

function requireExactCloudflareTokenSecretNames(workflow, expectedNames, label) {
  const actualNames = new Set(cloudflareTokenSecretNames(workflow))
  const expected = new Set(expectedNames)
  if (
    actualNames.size !== expected.size
    || [...actualNames].some((name) => !expected.has(name))
    || [...expected].some((name) => !actualNames.has(name))
  ) {
    throw new Error(`${label} workflow references an unexpected or legacy Cloudflare deployment-token secret.`)
  }
}

function workflowStepBlock(workflow, stepName) {
  const marker = `      - name: ${stepName}`
  const start = workflow.indexOf(marker)
  if (start < 0) throw new Error(`Workflow lacks required step: ${stepName}`)
  const end = workflow.indexOf('\n      - ', start + marker.length)
  return workflow.slice(start, end < 0 ? workflow.length : end)
}

function workflowJobBlock(workflow, jobName) {
  const marker = `  ${jobName}:\n`
  const start = workflow.indexOf(marker)
  if (start < 0) throw new Error(`Workflow lacks required job: ${jobName}`)
  const next = workflow.slice(start + marker.length).search(/^  [A-Za-z0-9_-]+:\s*$/m)
  const end = next < 0 ? workflow.length : start + marker.length + next
  return workflow.slice(start, end)
}

function requireStepCondition(workflow, stepName, condition) {
  const block = workflowStepBlock(workflow, stepName)
  if (!block.includes(`\n        if: ${condition}\n`)) {
    throw new Error(`${stepName} must use the exact supervised condition: ${condition}`)
  }
  return block
}

function requireImmediateNextStep(workflow, firstStep, secondStep) {
  const marker = `      - name: ${firstStep}`
  const start = workflow.indexOf(marker)
  if (start < 0) throw new Error(`Workflow lacks required step: ${firstStep}`)
  const next = workflow.indexOf('\n      - ', start + marker.length)
  if (next < 0 || !workflow.slice(next + 1).startsWith(`      - name: ${secondStep}`)) {
    throw new Error(`${firstStep} must be immediately followed by ${secondStep}.`)
  }
}

function requireFailClosedStep(workflow, stepName, allowedCondition = null) {
  const block = workflowStepBlock(workflow, stepName)
  if (/^\s*continue-on-error\s*:/m.test(block)) {
    throw new Error(`${stepName} must not allow continue-on-error.`)
  }
  if (/(?:\|\|\s*(?:true|:|exit\s+0|return\s+0)|;\s*(?:true|exit\s+0|return\s+0)\b|\bset\s+\+e\b)/.test(block)) {
    throw new Error(`${stepName} must not suppress command failures.`)
  }
  const shellDeclarations = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('shell:'))
  if (shellDeclarations.some((line) => line !== 'shell: bash')) {
    throw new Error(`${stepName} uses an unapproved shell override.`)
  }
  const conditions = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('if:'))
  if (allowedCondition === null && conditions.length > 0) {
    throw new Error(`${stepName} must be unconditional and must not define an if guard.`)
  }
  if (
    allowedCondition !== null
    && (conditions.length !== 1 || conditions[0] !== `if: ${allowedCondition}`)
  ) {
    throw new Error(`${stepName} must use only the exact condition: ${allowedCondition}`)
  }
  return block
}

function requireExecutableShellLine(block, line, label) {
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!new RegExp(`^\\s{10}${escaped}\\r?$`, 'm').test(block)) {
    throw new Error(`${label} must remain an executable fail-closed shell guard.`)
  }
}

function runCommandsFromStep(block, stepName) {
  const lines = block.split(/\r?\n/)
  const runIndex = lines.findIndex((line) => /^\s{8}run:/.test(line))
  if (runIndex < 0) throw new Error(`${stepName} lacks an executable run command.`)
  const declaration = lines[runIndex].trim()
  if (declaration !== 'run: |' && declaration !== 'run: >-') {
    return [declaration.slice('run:'.length).trim()]
  }
  return lines
    .slice(runIndex + 1)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trim())
}

function requireExactRunCommands(workflow, stepName, expectedCommands) {
  const block = requireFailClosedStep(workflow, stepName)
  const actual = runCommandsFromStep(block, stepName)
  if (JSON.stringify(actual) !== JSON.stringify(expectedCommands)) {
    throw new Error(`${stepName} must use only the exact approved commands in the approved order.`)
  }
  return block
}

function requireExactRunCommandsWithCondition(workflow, stepName, condition, expectedCommands) {
  const block = requireFailClosedStep(workflow, stepName, condition)
  const actual = runCommandsFromStep(block, stepName)
  if (JSON.stringify(actual) !== JSON.stringify(expectedCommands)) {
    throw new Error(`${stepName} must use only the exact approved commands in the approved order.`)
  }
  return block
}

function requireExecutableFailureBranch(block, conditionLine, label) {
  const lines = block.split(/\r?\n/).map((line) => line.trim())
  const index = lines.indexOf(conditionLine)
  if (index < 0 || lines[index + 2] !== 'exit 1' || lines[index + 3] !== 'fi') {
    throw new Error(`${label} must execute exit 1 in its exact failure branch.`)
  }
}

function requireOnlyEnvMappings(workflow, envName, allowedMappings, expectedCount, label) {
  const mappings = workflow
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${envName}:`))
  const allowed = new Set(allowedMappings)
  if (mappings.length !== expectedCount || mappings.some((line) => !allowed.has(line))) {
    throw new Error(`${label} workflow has an unexpected ${envName} mapping.`)
  }
}

function verifyStagingRollbackVerificationWorkflow(workflow) {
  const requiredMarkers = [
    'name: Verify Staging rollback target',
    'group: cloudflare-staging',
    'cancel-in-progress: false',
    'name: staging',
    'Validate the protected-main rollback verification request before checkout',
    'Check out the protected-main verification code',
    'Prepare the exact Staging rollback verification target',
    'Verify that the selected rollback commit is trusted main history',
    'Verify custom and immutable Staging origins remain Access-protected',
    'Verify the custom-domain rollback release identity',
    'Verify the immutable rollback release identity',
    'Reset the exact Staging Gate 0 synthetic fixture for the custom domain',
    'Run the protected custom-domain Staging Gate 0 rollback flow',
    'Reset the exact Staging Gate 0 synthetic fixture for the immutable deployment',
    'Run the protected immutable Staging Gate 0 rollback flow',
    'Record safe rollback-verification evidence',
    'node scripts/prepare-staging-rollback-verification.mjs',
    'git merge-base --is-ancestor',
    'node scripts/verify-staging-access.mjs',
    'node scripts/verify-release-manifest.mjs',
    'node scripts/seed-gate0-e2e.mjs',
    'npm run test:e2e:gate0:staging',
    'STAGING_ACCESS_CLIENT_ID: ${{ secrets.STAGING_ACCESS_CLIENT_ID }}',
    'STAGING_ACCESS_CLIENT_SECRET: ${{ secrets.STAGING_ACCESS_CLIENT_SECRET }}',
    'SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}',
    'GATE0_STAGING_SEED_CONFIRMATION: SEED GATE0 SYNTHETIC DATA qpgnomuqdcucjmxrunnw',
    'target_immutable_origin',
  ]
  if (requiredMarkers.some((marker) => !workflow.includes(marker))) {
    throw new Error('Staging rollback verification workflow lacks a required protected-target guard.')
  }
  if (
    workflow.includes('buril-lab-storage-backup')
    || workflow.includes('CLOUDFLARE_API_TOKEN')
    || workflow.includes('secrets.STAGING_PAGES_EPHEMERAL_TOKEN')
    || workflow.includes('secrets.STAGING_WORKER_EPHEMERAL_TOKEN')
    || workflow.includes('inputs.target_origin')
    || /\bproduction\b/i.test(workflow)
  ) {
    throw new Error('Staging rollback verification workflow must not receive production, deployment-token, or caller-supplied-origin scope.')
  }
  if (
    occurrenceCount(workflow, 'npm ci --ignore-scripts') !== 1
    || occurrenceCount(workflow, 'npx playwright install --with-deps chromium') !== 1
    || occurrenceCount(workflow, 'node scripts/seed-gate0-e2e.mjs') !== 2
    || occurrenceCount(workflow, 'npm run test:e2e:gate0:staging') !== 2
    || occurrenceCount(workflow, 'node scripts/verify-staging-access.mjs') !== 2
    || occurrenceCount(workflow, 'node scripts/verify-release-manifest.mjs') !== 2
  ) {
    throw new Error('Staging rollback verification workflow must run each protected-origin check exactly once and each Gate 0 flow exactly once.')
  }
  const order = [
    'Validate the protected-main rollback verification request before checkout',
    'Check out the protected-main verification code',
    'Prepare the exact Staging rollback verification target',
    'Verify that the selected rollback commit is trusted main history',
    'Verify custom and immutable Staging origins remain Access-protected',
    'Verify the custom-domain rollback release identity',
    'Verify the immutable rollback release identity',
    'Reset the exact Staging Gate 0 synthetic fixture for the custom domain',
    'Run the protected custom-domain Staging Gate 0 rollback flow',
    'Reset the exact Staging Gate 0 synthetic fixture for the immutable deployment',
    'Run the protected immutable Staging Gate 0 rollback flow',
  ].map((marker) => workflow.indexOf(marker))
  if (order.some((position) => position < 0) || order.some((position, index) => index > 0 && position <= order[index - 1])) {
    throw new Error('Staging rollback verification guards, target identity checks, and Gate 0 flows are out of order.')
  }
  return true
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

export function verifyStagingStorageBackupAcceptanceConfig(raw) {
  const config = parseConfig(
    normalizeLineEndings(raw),
    'Staging storage-backup acceptance Wrangler config',
  )
  requireExactObjectKeys(config, [
    '$schema',
    'name',
    'main',
    'compatibility_date',
    'compatibility_flags',
    'workers_dev',
    'preview_urls',
    'send_metrics',
    'upload_source_maps',
    'limits',
    'secrets',
    'kv_namespaces',
    'r2_buckets',
    'vars',
  ], 'Staging storage-backup acceptance Wrangler config')
  if (
    config.$schema !== '../../node_modules/wrangler/config-schema.json'
    || config.name !== 'buril-lab-storage-backup-staging-acceptance-local'
    || config.main !== 'src/index.ts'
    || config.compatibility_date !== '2026-08-20'
    || JSON.stringify(config.compatibility_flags) !== JSON.stringify(['nodejs_compat'])
    || config.workers_dev !== false
    || config.preview_urls !== false
    || config.send_metrics !== false
    || config.upload_source_maps !== false
  ) {
    throw new Error('Staging storage-backup acceptance runtime identity is invalid.')
  }
  requireExactObjectKeys(config.limits, ['subrequests'], 'Staging acceptance limits')
  requireExactObjectKeys(config.secrets, ['required'], 'Staging acceptance required secrets')
  if (
    config.limits.subrequests !== 4000
    || JSON.stringify(config.secrets.required) !== JSON.stringify(['SUPABASE_SERVICE_ROLE_KEY'])
  ) {
    throw new Error('Staging storage-backup acceptance runtime limits or secret contract is invalid.')
  }
  if (!Array.isArray(config.kv_namespaces) || config.kv_namespaces.length !== 1) {
    throw new Error('Staging storage-backup acceptance must have exactly one KV binding.')
  }
  requireExactObjectKeys(
    config.kv_namespaces[0],
    ['binding', 'id', 'remote'],
    'Staging acceptance KV binding',
  )
  if (
    config.kv_namespaces[0].binding !== 'BURILLAB_RUNTIME_CONFIG'
    || config.kv_namespaces[0].id !== 'dcaa52254fa6447bbe7c21f54354ad0d'
    || config.kv_namespaces[0].remote !== true
  ) {
    throw new Error('Staging storage-backup acceptance KV binding is not exact remote Staging.')
  }
  if (!Array.isArray(config.r2_buckets) || config.r2_buckets.length !== 1) {
    throw new Error('Staging storage-backup acceptance must have exactly one R2 binding.')
  }
  requireExactObjectKeys(
    config.r2_buckets[0],
    ['binding', 'bucket_name', 'remote'],
    'Staging acceptance R2 binding',
  )
  if (
    config.r2_buckets[0].binding !== 'CABINET_BACKUPS'
    || config.r2_buckets[0].bucket_name !== 'buril-lab-cabinet-backups-staging'
    || config.r2_buckets[0].remote !== true
  ) {
    throw new Error('Staging storage-backup acceptance R2 binding is not exact remote Staging.')
  }
  const expectedVars = {
    BACKUP_ENVIRONMENT: 'staging',
    SUPABASE_PROJECT_REF: 'qpgnomuqdcucjmxrunnw',
    SUPABASE_URL: 'https://qpgnomuqdcucjmxrunnw.supabase.co',
    SOURCE_POINTER_MODE: 'legacy_url',
    SOURCE_STORAGE_BUCKET: 'cabinets',
    WORKERS_SUBREQUEST_LIMIT: '4000',
    WORKERS_USAGE_PLAN: 'paid',
  }
  requireExactObjectKeys(config.vars, Object.keys(expectedVars), 'Staging acceptance vars')
  if (Object.entries(expectedVars).some(([key, value]) => config.vars[key] !== value)) {
    throw new Error('Staging storage-backup acceptance vars are not exact Staging.')
  }
  return true
}

export function verifyReleaseConfiguration({ productionRaw, stagingRaw, workflows, browser = {} }) {
  productionRaw = normalizeLineEndings(productionRaw)
  stagingRaw = normalizeLineEndings(stagingRaw)
  workflows = Object.fromEntries(Object.entries(workflows || {}).map(([name, workflow]) => [
    name,
    normalizeLineEndings(workflow),
  ]))
  browser = Object.fromEntries(Object.entries(browser || {}).map(([name, source]) => [
    name,
    normalizeLineEndings(source),
  ]))
  const workflowNames = Object.keys(workflows || {}).sort()
  const approvedWorkflowNames = Object.keys(APPROVED_WORKFLOW_ACTION_REFERENCES).sort()
  if (JSON.stringify(workflowNames) !== JSON.stringify(approvedWorkflowNames)) {
    throw new Error('GitHub workflow files differ from the exact reviewed allow-list.')
  }
  for (const [workflowName, workflow] of Object.entries(workflows || {})) {
    const actionReferences = externalActionReferences(workflow)
    if (actionReferences.some((reference) => !/@[0-9a-f]{40}$/.test(reference))) {
      throw new Error(`${workflowName} workflow contains a mutable external Action reference.`)
    }
    const approved = APPROVED_WORKFLOW_ACTION_REFERENCES[workflowName]
    if (!approved && actionReferences.length > 0) {
      throw new Error(`${workflowName} workflow contains an unreviewed external Action reference.`)
    }
    if (approved && (
      actionReferences.length !== approved.length
      || actionReferences.some((reference, index) => reference !== approved[index])
    )) {
      throw new Error(`${workflowName} workflow external Actions differ from the exact reviewed sequence.`)
    }
  }
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
  const productionWorkflow = workflows.production || ''
  const qualityWorkflow = workflows.quality || ''
  const credentialProbeWorkflow = workflows['verify-staging-ephemeral-credentials.yml'] || ''
  const rollbackVerificationWorkflow = workflows['verify-staging-rollback.yml'] || ''
  verifyStagingRollbackVerificationWorkflow(rollbackVerificationWorkflow)
  if (
    occurrenceCount(stagingWorkflow, 'npm ci --ignore-scripts') !== 3
    || occurrenceCount(productionWorkflow, 'npm ci --ignore-scripts') !== 3
    || occurrenceCount(qualityWorkflow, 'npm ci --ignore-scripts') !== 3
    || /\bnpm\s+(?:ci|install)(?![^\r\n]*--ignore-scripts)/.test(
      `${stagingWorkflow}\n${productionWorkflow}\n${qualityWorkflow}`,
    )
  ) {
    throw new Error('Every workflow dependency install must suppress lifecycle scripts.')
  }
  for (const [label, workflow] of [['Staging', stagingWorkflow], ['Production', productionWorkflow]]) {
    if (/^\s*defaults\s*:/m.test(workflow)) {
      throw new Error(`${label} workflow must not inject a default shell.`)
    }
  }

  const stagingBuildJob = workflowJobBlock(stagingWorkflow, 'build')
  const stagingDeployJob = workflowJobBlock(stagingWorkflow, 'deploy')
  const stagingWorkerJob = workflowJobBlock(stagingWorkflow, 'worker')
  const productionBuildJob = workflowJobBlock(productionWorkflow, 'build')
  const productionDeployJob = workflowJobBlock(productionWorkflow, 'deploy')
  const productionWorkerJob = workflowJobBlock(productionWorkflow, 'worker')
  const jobNames = (workflow) => {
    const jobsStart = workflow.indexOf('\njobs:\n')
    if (jobsStart < 0) return []
    return [...workflow.slice(jobsStart + '\njobs:\n'.length).matchAll(/^  ([A-Za-z0-9_-]+):\r?$/gm)]
      .map((match) => match[1])
  }
  if (JSON.stringify(jobNames(stagingWorkflow)) !== JSON.stringify(['build', 'deploy', 'worker'])) {
    throw new Error('Staging workflow must contain only the exact build, deploy, and optional fresh Worker jobs.')
  }
  if (JSON.stringify(jobNames(productionWorkflow)) !== JSON.stringify(['build', 'deploy', 'worker'])) {
    throw new Error('Production workflow must contain only the exact build, deploy, and optional Worker jobs.')
  }
  const credentialProbeJob = workflowJobBlock(credentialProbeWorkflow, 'verify')
  if (
    JSON.stringify(jobNames(credentialProbeWorkflow)) !== JSON.stringify(['verify'])
    || credentialProbeJob.includes('\n    needs:')
    || credentialProbeJob.includes('\n    if:')
    || credentialProbeJob.includes('${{ github.token }}')
    || !credentialProbeJob.includes('\n    environment:\n      name: staging\n')
  ) {
    throw new Error('The Staging credential-injection probe must contain only one unconditional Staging verification job.')
  }
  if (
    !stagingDeployJob.includes('\n    needs: build\n')
    || !productionDeployJob.includes('\n    needs: build\n')
    || !stagingWorkerJob.includes('\n    needs: deploy\n')
    || !stagingWorkerJob.includes('\n    if: ${{ inputs.deploy_storage_backup }}\n')
    || !productionWorkerJob.includes('\n    needs: deploy\n')
    || !productionWorkerJob.includes('\n    if: ${{ inputs.deploy_storage_backup }}\n')
    || /\n    if:/.test(stagingBuildJob)
    || /\n    if:/.test(stagingDeployJob)
    || /\n    if:/.test(productionBuildJob)
    || /\n    if:/.test(productionDeployJob)
  ) {
    throw new Error('Release jobs must preserve the exact unconditional build-to-deploy and optional deploy-to-Worker dependency chain.')
  }
  const stagingWorkerHeader = stagingWorkerJob.slice(0, stagingWorkerJob.indexOf('\n    steps:\n'))
  const productionWorkerHeader = productionWorkerJob.slice(0, productionWorkerJob.indexOf('\n    steps:\n'))
  if (
    occurrenceCount(
      stagingWorkerHeader,
      'SUPABASE_PROJECT_REF: ${{ vars.SUPABASE_PROJECT_REF }}',
    ) !== 1
  ) {
    throw new Error('Staging Worker job must receive the exact environment-scoped Supabase project reference.')
  }
  if (
    occurrenceCount(
      productionWorkerHeader,
      'SUPABASE_PROJECT_REF: ${{ vars.SUPABASE_PROJECT_REF }}',
    ) !== 1
  ) {
    throw new Error('Production Worker job must receive the exact environment-scoped Supabase project reference.')
  }

  const allowedBuildSecretMappings = new Set([
    'VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}',
    'VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}',
  ])
  for (const [label, buildJob] of [['Staging', stagingBuildJob], ['Production', productionBuildJob]]) {
    const secretMappings = buildJob
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes('${{ secrets.'))
    if (
      secretMappings.length !== allowedBuildSecretMappings.size
      || secretMappings.some((line) => !allowedBuildSecretMappings.has(line))
      || buildJob.includes('${{ github.token }}')
      || /(?:EPHEMERAL|ACCESS_CLIENT|SERVICE_ROLE|GATE0_E2E|CLOUDFLARE_API_TOKEN)/.test(buildJob)
    ) {
      throw new Error(`${label} build job must not receive provider, Access, service-role, Gate0, or ephemeral deployment credentials.`)
    }
  }

  const uploadAction = 'uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
  const downloadAction = 'uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093'
  for (const [label, workflow, buildJob, deployJob, environment] of [
    ['Staging', stagingWorkflow, stagingBuildJob, stagingDeployJob, 'staging'],
    ['Production', productionWorkflow, productionBuildJob, productionDeployJob, 'production'],
  ]) {
    if (
      occurrenceCount(buildJob, uploadAction) !== 1
      || occurrenceCount(deployJob, downloadAction) !== 1
      || exactTrimmedLineCount(buildJob, 'artifact_id: ${{ steps.upload-release-artifact.outputs.artifact-id }}') !== 1
      || exactTrimmedLineCount(buildJob, 'artifact_service_digest: ${{ steps.upload-release-artifact.outputs.artifact-digest }}') !== 1
      || exactTrimmedLineCount(buildJob, 'manifest_sha256: ${{ steps.release-artifact-manifest.outputs.manifest_sha256 }}') !== 1
      || !buildJob.includes('node scripts/verify-release-artifact-paths.mjs')
      || exactTrimmedLineCount(deployJob, 'artifact-ids: ${{ needs.build.outputs.artifact_id }}') !== 1
      || exactTrimmedLineCount(deployJob, 'merge-multiple: true') !== 1
      || /^\s+name:\s+buril-lab-/m.test(workflowStepBlock(deployJob, `Download the exact ${label} release artifact`))
      || exactTrimmedLineCount(deployJob, 'EXPECTED_ARTIFACT_SERVICE_DIGEST: ${{ needs.build.outputs.artifact_service_digest }}') !== 2
      || exactTrimmedLineCount(deployJob, 'EXPECTED_MANIFEST_SHA256: ${{ needs.build.outputs.manifest_sha256 }}') !== 1
      || !deployJob.includes('node "$GITHUB_WORKSPACE/scripts/verify-release-artifact-paths.mjs"')
      || !deployJob.includes('/usr/bin/sha256sum --check --strict .release-artifact.sha256')
      || !buildJob.includes('--outdir "$GITHUB_WORKSPACE/dist/_worker.js"')
      || !buildJob.includes('--output-routes-path "$GITHUB_WORKSPACE/dist/_routes.json"')
      || !buildJob.includes('test -s dist/_worker.js/index.js')
      || occurrenceCount(buildJob, 'node scripts/verify-pages-functions-routes.mjs dist/_routes.json') !== 1
      || !deployJob.includes('test -s "$ARTIFACT_ROOT/dist/_worker.js/index.js"')
      || occurrenceCount(deployJob, 'node scripts/verify-pages-functions-routes.mjs "$ARTIFACT_ROOT/dist/_routes.json"') !== 1
      || !deployJob.includes(`--environment ${environment}`)
    ) {
      throw new Error(`${label} must transfer only the exact ID-selected, digest-verified release artifact between fresh runners.`)
    }
    if (
      occurrenceCount(buildJob, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" pages functions build functions') !== 1
      || deployJob.includes('pages functions build functions')
      || occurrenceCount(deployJob, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" pages deploy dist') !== 1
      || occurrenceCount(deployJob, '--no-bundle') !== 1
      || !deployJob.includes('/usr/bin/mv functions "$disabled_functions"')
      || !deployJob.includes('test ! -e functions')
      || !deployJob.includes('trap restore_functions EXIT')
      || !deployJob.includes('env -u CLOUDFLARE_API_TOKEN node scripts/verify-wrangler-pages-deploy-output.mjs')
    ) {
      throw new Error(`${label} Pages Functions compilation must remain credential-free and outside the deploy runner.`)
    }
    requireFailClosedStep(workflow, `Create the exact ${label} artifact manifest`)
    const artifactDigestBlock = requireFailClosedStep(
      workflow,
      `Independently verify the uploaded ${label} artifact archive digest`,
    )
    const artifactIntegrityLine = `printf '%s  %s\\n' '${PINNED_GITHUB_ARTIFACT_DIGEST_HELPER_SHA256}' scripts/verify-github-artifact-digest.mjs`
    if (
      occurrenceCount(artifactDigestBlock, artifactIntegrityLine) !== 1
      || occurrenceCount(artifactDigestBlock, 'node scripts/verify-github-artifact-digest.mjs') !== 1
      || occurrenceCount(artifactDigestBlock, 'GITHUB_TOKEN: ${{ github.token }}') !== 1
      || artifactDigestBlock.includes('GITHUB_TOKEN"')
      || artifactDigestBlock.includes('--token')
    ) {
      throw new Error(`${label} must independently hash the exact GitHub artifact-ID archive with a pinned no-argv helper.`)
    }
    requireFailClosedStep(workflow, `Verify and activate the exact ${label} release artifact`)
    const pagesDeployBlock = workflowStepBlock(workflow, `Deploy the exact commit to ${label === 'Staging' ? 'Staging' : 'production'} Pages`)
    const wranglerOutputIntegrityLine = `printf '%s  %s\\n' '${PINNED_WRANGLER_OUTPUT_HELPER_SHA256}' scripts/verify-wrangler-pages-deploy-output.mjs`
    if (
      occurrenceCount(pagesDeployBlock, wranglerOutputIntegrityLine) !== 1
      || occurrenceCount(pagesDeployBlock, '/usr/bin/git diff --quiet --exit-code') !== 1
      || occurrenceCount(pagesDeployBlock, '/usr/bin/git diff --cached --quiet --exit-code') !== 1
      || !pagesDeployBlock.includes('git fetch --no-tags origin main')
      || !pagesDeployBlock.includes('/usr/bin/timeout --signal=TERM --kill-after=5s 30s git fetch --no-tags origin main')
      || !pagesDeployBlock.includes('test "$(git rev-parse HEAD)" = "$DEPLOY_COMMIT_SHA"')
      || !pagesDeployBlock.includes('test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"')
      || occurrenceCount(pagesDeployBlock, 'node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 600') !== 1
      || !pagesDeployBlock.includes('/usr/bin/timeout --signal=TERM --kill-after=15s 540s')
      || pagesDeployBlock.indexOf('node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 600')
        >= pagesDeployBlock.indexOf('"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" pages deploy dist')
    ) {
      throw new Error(`${label} Pages mutation must pin its output parser and recheck the exact current main worktree immediately before Wrangler.`)
    }
  }
  if (
    stagingWorkflow.includes('npx wrangler')
    || productionWorkflow.includes('npx wrangler')
    || /npm\s+exec(?:\s+--)?\s+wrangler/.test(stagingWorkflow)
    || /npm\s+exec(?:\s+--)?\s+wrangler/.test(productionWorkflow)
  ) {
    throw new Error('Release workflows must invoke only the locked local Wrangler binary without package-execution fallback.')
  }
  if (/\bcurl\b/.test(`${stagingWorkflow}\n${productionWorkflow}`)) {
    throw new Error('Release workflows must use only the bounded provider API helpers and never invoke curl directly.')
  }

  const verifySecretShellBoundary = (job, boundaryId, label) => {
    const stepBlocks = job.split(/\n(?=      - name: )/).filter((block) => block.startsWith('      - name: '))
    for (const block of stepBlocks) {
      if (!block.includes('${{ secrets.') && !block.includes('${{ github.token }}')) continue
      const stepName = block.split(/\r?\n/, 1)[0].slice('      - name: '.length)
      for (const required of [
        'BASH_ENV: /dev/null',
        'ENV: /dev/null',
        'NODE_OPTIONS: ""',
        `PATH: \${{ steps.${boundaryId}.outputs.trusted_path }}`,
      ]) {
        const matchingLines = block.split(/\r?\n/).filter((line) => line.trim() === required)
        if (matchingLines.length !== 1) {
          throw new Error(`${label} secret-bearing step lacks the fixed fresh-runner shell boundary: ${stepName}`)
        }
      }
    }
  }
  verifySecretShellBoundary(stagingDeployJob, 'deploy-runner-boundary', 'Staging')
  verifySecretShellBoundary(stagingWorkerJob, 'worker-runner-boundary', 'Staging Worker')
  verifySecretShellBoundary(productionDeployJob, 'deploy-runner-boundary', 'Production')
  verifySecretShellBoundary(productionWorkerJob, 'worker-runner-boundary', 'Production Worker')

  for (const [label, workflow, stepName] of [
    ['Staging', stagingWorkflow, 'Validate the credential-free Staging build request'],
    ['Production', productionWorkflow, 'Validate the credential-free Production build request'],
  ]) {
    const block = requireFailClosedStep(workflow, stepName)
    for (const condition of [
      'if [[ "$GITHUB_EVENT_NAME" != "workflow_dispatch" || "$GITHUB_REPOSITORY" != "haengjoo123/buril-lab" || "$GITHUB_REF" != "refs/heads/main" ]]; then',
      'if [[ "$GITHUB_RUN_ATTEMPT" != "1" ]]; then',
      `if [[ ! "$DEPLOY_COMMIT_SHA" =~ ^[0-9a-f]{40}$ || "$DEPLOY_COMMIT_SHA" != "$GITHUB_SHA" ]]; then`,
    ]) {
      requireExecutableShellLine(block, condition, `${label} build boundary`)
      requireExecutableFailureBranch(block, condition, `${label} build boundary`)
    }
  }
  if (
    stagingWorkflow.includes('EPHEMERAL_ACTIVE_LEASE')
    || productionWorkflow.includes('EPHEMERAL_ACTIVE_LEASE')
    || stagingWorkflow.includes('Verify the previous ephemeral credential cleanup receipt')
    || productionWorkflow.includes('Verify the previous ephemeral credential cleanup receipt')
  ) {
    throw new Error('Unsigned legacy ephemeral lease or cleanup controls are forbidden.')
  }
  if (
    occurrenceCount(stagingWorkflow, 'node scripts/verify-ephemeral-lease-grant.mjs') !== 6
    || occurrenceCount(productionWorkflow, 'node scripts/verify-ephemeral-lease-grant.mjs') !== 6
    || occurrenceCount(stagingWorkflow, 'EPHEMERAL_LEASE_MIN_REMAINING_SECONDS: "600"') !== 4
    || occurrenceCount(productionWorkflow, 'EPHEMERAL_LEASE_MIN_REMAINING_SECONDS: "600"') !== 4
    || occurrenceCount(stagingWorkflow, 'node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 600') !== 4
    || occurrenceCount(productionWorkflow, 'node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 600') !== 4
    || occurrenceCount(stagingWorkflow, 'node scripts/verify-ephemeral-cleanup-receipt.mjs') !== 4
    || occurrenceCount(productionWorkflow, 'node scripts/verify-ephemeral-cleanup-receipt.mjs') !== 4
    || occurrenceCount(productionWorkflow, 'STAGING_EPHEMERAL_CLEANUP_RECEIPT: ${{ vars.STAGING_EPHEMERAL_CLEANUP_RECEIPT }}') !== 2
  ) {
    throw new Error('Signed lease, cumulative cleanup, and cross-environment cleanup gates are incomplete.')
  }
  requireExactCloudflareTokenSecretNames(stagingWorkflow, [
    'STAGING_PAGES_EPHEMERAL_TOKEN',
    'STAGING_WORKER_EPHEMERAL_TOKEN',
  ], 'Staging')
  requireExactCloudflareTokenSecretNames(productionWorkflow, [
    'PRODUCTION_PAGES_EPHEMERAL_TOKEN',
    'PRODUCTION_WORKER_EPHEMERAL_TOKEN',
  ], 'Production')
  for (const [name, workflow] of Object.entries(workflows)) {
    if (name === 'staging' || name === 'production' || name === 'verify-staging-ephemeral-credentials.yml') continue
    if (name === 'verify-staging-storage-backup.yml') {
      requireExactCloudflareTokenSecretNames(workflow, [
        'STAGING_CLOUDFLARE_STORAGE_BACKUP_ACCEPTANCE_TOKEN',
      ], 'Staging storage-backup acceptance')
      if (
        occurrenceCount(workflow, 'secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY') !== 1
        || workflow.includes('SUPABASE_ACCESS_TOKEN')
        || workflow.includes('SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN')
      ) {
        throw new Error('Staging storage-backup acceptance must use only the exact Staging service credential.')
      }
      continue
    }
    if (cloudflareTokenSecretNames(workflow).length > 0) {
      throw new Error(`${name} workflow must not receive a Cloudflare deployment-token secret.`)
    }
    if (
      workflow.includes('SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN')
      || workflow.includes('SUPABASE_ACCESS_TOKEN')
      || workflow.includes('security:supabase-advisors:hosted')
    ) {
      throw new Error(`${name} workflow must not receive or use a Supabase Management PAT.`)
    }
  }
  if (/--(?:output|file)\s+\S*deployments\.json/.test(productionWorkflow)) {
    throw new Error('Production workflow must not persist the raw Pages deployment-list response.')
  }
  const forbiddenProductionStorageBackup = FORBIDDEN_PRODUCTION_STORAGE_BACKUP_TERMS
    .filter((term) => productionWorkflow.toLowerCase().includes(term))
  if (forbiddenProductionStorageBackup.length > 0) {
    throw new Error(`Production storage-backup deployment contains a forbidden credential or mutation: ${forbiddenProductionStorageBackup.join(', ')}`)
  }
  const forbiddenStagingStorageBackup = FORBIDDEN_STAGING_STORAGE_BACKUP_TERMS
    .filter((term) => stagingWorkflow.toLowerCase().includes(term))
  if (forbiddenStagingStorageBackup.length > 0) {
    throw new Error(`Staging storage-backup deployment contains a forbidden mutation or Production target: ${forbiddenStagingStorageBackup.join(', ')}`)
  }
  if (stagingWorkflow.includes('secrets.SUPABASE_SERVICE_ROLE_KEY')) {
    throw new Error('Staging must use the existing staging-prefixed Supabase service-role secret.')
  }
  for (const required of [
    'workflow_dispatch:',
    'commit_sha:',
    'confirmation:',
    'lease_id:',
    'deploy_storage_backup:',
    'lease_grant:',
    'type: boolean',
    'default: false',
    'actions: read',
    'if [[ "$GITHUB_EVENT_NAME" != "workflow_dispatch" || "$GITHUB_REPOSITORY" != "haengjoo123/buril-lab" || "$GITHUB_REF" != "refs/heads/main" ]]',
    'if [[ "$GITHUB_RUN_ATTEMPT" != "1" ]]',
    'DEPLOY_COMMIT_SHA: ${{ inputs.commit_sha }}',
    'DEPLOY_CONFIRMATION: ${{ inputs.confirmation }}',
    'DEPLOY_LEASE_ID: ${{ inputs.lease_id }}',
    'DEPLOY_STORAGE_BACKUP: ${{ inputs.deploy_storage_backup }}',
    'EPHEMERAL_LEASE_GRANT: ${{ inputs.lease_grant }}',
    'EPHEMERAL_CLEANUP_RECEIPT: ${{ vars.EPHEMERAL_CLEANUP_RECEIPT }}',
    'DEPLOY buril-lab-staging $DEPLOY_COMMIT_SHA LEASE $DEPLOY_LEASE_ID WITH EPHEMERAL TOKENS',
    'if [[ "$DEPLOY_COMMIT_SHA" != "$GITHUB_SHA" ]]',
    'ref: ${{ inputs.commit_sha }}',
    'node scripts/verify-github-quality-run.mjs',
    'node scripts/verify-ephemeral-lease-grant.mjs',
    'Verify exact ephemeral credentials reached the runner',
    'node scripts/verify-ephemeral-credential-injection.mjs --mode lease',
    'node scripts/verify-ephemeral-cleanup-receipt.mjs',
    'STAGING_KOSHA_CONTENT_MODE: link_only',
    'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    'Recheck that Staging still targets the current main tip',
    'Recheck the exact commit still passes trusted main quality',
    'Recheck the active Staging Pages token and deployment inputs at the mutation boundary',
    'Recheck the signed Staging cleanup receipt at the Pages mutation boundary',
    'Recheck the signed Staging lease with ten minutes remaining for Pages mutation',
    'steps.staging-deployment.outputs.deployment_url',
    'env -u CLOUDFLARE_API_TOKEN node scripts/read-pages-deployment.mjs',
    'set -euo pipefail',
    '--file -',
    'api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$CLOUDFLARE_PAGES_PROJECT/deployments?env=production',
    '--environment staging',
    '--project "$CLOUDFLARE_PAGES_PROJECT"',
    'npx playwright install --with-deps chromium',
    'SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}',
    'GATE0_E2E_EMAIL: ${{ secrets.GATE0_E2E_EMAIL }}',
    'GATE0_E2E_PASSWORD: ${{ secrets.GATE0_E2E_PASSWORD }}',
    'GATE0_BASE_URL: https://staging.burillab.com',
    'GATE0_BASE_URL: ${{ steps.staging-deployment.outputs.deployment_url }}',
    'GATE0_EXPECTED_COMMIT_SHA: ${{ steps.staging-deployment.outputs.deployment_commit_sha }}',
    'GATE0_EXPECTED_DEPLOYMENT_ID: ${{ steps.staging-deployment.outputs.deployment_id }}',
    'GATE0_STAGING_TARGET_CONFIRMATION: RUN GATE0 buril-lab-staging',
    'GATE0_STAGING_SEED_CONFIRMATION: SEED GATE0 SYNTHETIC DATA qpgnomuqdcucjmxrunnw',
    'SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}',
    'node scripts/seed-gate0-e2e.mjs',
    'npm run test:e2e:gate0:staging',
    'node scripts/verify-staging-kosha-link-only.mjs',
    'Verify the explicitly requested Worker ephemeral token',
    'VERIFY_CLOUDFLARE_DEPLOY_INPUT_SCOPE: worker',
    'PAGES_EPHEMERAL_TOKEN: ${{ secrets.STAGING_PAGES_EPHEMERAL_TOKEN }}',
    'WORKER_EPHEMERAL_TOKEN: ${{ secrets.STAGING_WORKER_EPHEMERAL_TOKEN }}',
    'Recheck that Staging still targets the current main tip before backup Worker deployment',
    'Recheck trusted main quality before backup Worker deployment',
    'Recheck the active Worker token set at the mutation boundary',
    'Recheck Staging storage backup is exactly OFF at the mutation boundary',
    'Recheck the signed Worker cleanup receipt at the mutation boundary',
    'Recheck the signed Worker lease with ten minutes remaining for mutation',
    'CLOUDFLARE_API_TOKEN: ${{ secrets.STAGING_WORKER_EPHEMERAL_TOKEN }}',
    'Verify Staging storage backup remains exactly OFF before Worker deployment',
    'Recheck Staging storage backup is exactly OFF at the mutation boundary',
    '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" kv key get runtime_config',
    '--config workers/storage-backup/wrangler.staging.jsonc',
    '--namespace-id "$BURILLAB_RUNTIME_CONFIG_KV_ID"',
    '--remote',
    '--text',
    'env -u CLOUDFLARE_API_TOKEN node scripts/verify-storage-backup-runtime-off.mjs',
    'Verify no unapproved Staging Worker secrets exist before deployment',
    '/workers/scripts/$STORAGE_BACKUP_WORKER_NAME/secrets',
    'env -u CLOUDFLARE_API_TOKEN node scripts/verify-storage-backup-worker-deployment.mjs preflight',
    'Create isolated temporary Worker secret file',
    'id: storage-backup-secret-file',
    'RUNNER_TEMP: ${{ runner.temp }}',
    'node scripts/storage-backup-secret-file.mjs create',
    'Deploy the OFF-only Staging storage backup Worker',
    '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" deploy',
    '--secrets-file "${{ steps.storage-backup-secret-file.outputs.secret_file }}"',
    '--strict',
    '--autoconfig=false',
    '--tag "$worker_tag"',
    '--message "$worker_message"',
    'worker_tag="r$GITHUB_RUN_ID-l$DEPLOY_LEASE_ID"',
    'worker_message="quality-approved staging storage backup run $GITHUB_RUN_ID lease $DEPLOY_LEASE_ID commit $DEPLOY_COMMIT_SHA"',
    'env -u CLOUDFLARE_API_TOKEN node scripts/verify-storage-backup-worker-deployment.mjs wrangler-output',
    'Always remove temporary Worker secret material',
    'if: always()',
    'node scripts/storage-backup-secret-file.mjs cleanup',
    'Verify the active Staging storage backup Worker deployment',
    'STORAGE_BACKUP_WORKER_NAME: buril-lab-storage-backup-staging',
    '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" deployments status',
    '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" versions list',
    '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" secret list',
    'cloudflare_worker_surface_get() {',
    'Refusing an unapproved Worker control-plane surface.',
    'workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/bindings',
    'workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/routes?show_zonename=true',
    'workers/domains?service=$STORAGE_BACKUP_WORKER_NAME&environment=production',
    'workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/subdomain',
    'workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production',
    'workers/scripts/$STORAGE_BACKUP_WORKER_NAME/schedules',
    'node scripts/cloudflare-api-get.mjs',
    '--include-status true',
    '--include-status false',
    'STORAGE_BACKUP_BINDINGS_JSON="$bindings_json"',
    'STORAGE_BACKUP_ROUTES_JSON="$routes_json"',
    'STORAGE_BACKUP_DOMAINS_JSON="$domains_json"',
    'STORAGE_BACKUP_SUBDOMAIN_JSON="$subdomain_json"',
    'STORAGE_BACKUP_SERVICE_JSON="$service_json"',
    'STORAGE_BACKUP_SCHEDULES_JSON="$schedules_json"',
    '--name "$STORAGE_BACKUP_WORKER_NAME"',
    '--format json',
    'worker_verified=false',
    'for attempt in 1 2 3 4 5 6; do',
    'The exact Staging storage backup Worker deployment did not become verifiable.',
    'env -u CLOUDFLARE_API_TOKEN node scripts/verify-storage-backup-worker-deployment.mjs active',
    'Verify Staging storage backup remains exactly OFF after Worker deployment',
    'Record optional storage backup Worker evidence',
    'Record cleanup pending before the next lease',
  ]) {
    if (!stagingWorkflow.includes(required)) {
      throw new Error(`Staging workflow lacks trusted-quality guard: ${required}`)
    }
  }
  if (/--(?:output|file)\s+\S*deployments\.json/.test(stagingWorkflow)) {
    throw new Error('Staging workflow must not persist the raw Pages deployment-list response.')
  }
  if (
    occurrenceCount(stagingWorkflow, 'node scripts/cloudflare-api-get.mjs') !== 3
    || occurrenceCount(stagingWorkflow, '--include-status false') !== 2
    || occurrenceCount(stagingWorkflow, '--include-status true') !== 1
    || occurrenceCount(stagingWorkflow, '--url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/') !== 3
    || occurrenceCount(stagingWorkflow, 'env -u CLOUDFLARE_API_TOKEN node scripts/read-pages-deployment.mjs') !== 1
    || /Authorization\s*:\s*Bearer|curl\b[^\n]*(?:CLOUDFLARE|TOKEN)|--header\b[^\n]*(?:CLOUDFLARE|TOKEN)/i.test(stagingWorkflow)
  ) {
    throw new Error('Every Staging Cloudflare API lookup must use only the bounded token-from-environment helper.')
  }
  if (
    occurrenceCount(stagingWorkflow, 'PAGES_EPHEMERAL_TOKEN: ${{ secrets.STAGING_PAGES_EPHEMERAL_TOKEN }}') !== 3
    || occurrenceCount(stagingWorkflow, 'WORKER_EPHEMERAL_TOKEN: ${{ secrets.STAGING_WORKER_EPHEMERAL_TOKEN }}') !== 2
    || occurrenceCount(stagingWorkflow, 'CLOUDFLARE_API_TOKEN: ${{ secrets.STAGING_PAGES_EPHEMERAL_TOKEN }}') !== 4
    || occurrenceCount(stagingWorkflow, 'CLOUDFLARE_API_TOKEN: ${{ secrets.STAGING_WORKER_EPHEMERAL_TOKEN }}') !== 6
    || occurrenceCount(productionWorkflow, 'PAGES_EPHEMERAL_TOKEN: ${{ secrets.PRODUCTION_PAGES_EPHEMERAL_TOKEN }}') !== 2
    || occurrenceCount(productionWorkflow, 'CLOUDFLARE_API_TOKEN: ${{ secrets.PRODUCTION_PAGES_EPHEMERAL_TOKEN }}') !== 5
    || occurrenceCount(productionWorkflow, 'WORKER_EPHEMERAL_TOKEN: ${{ secrets.PRODUCTION_WORKER_EPHEMERAL_TOKEN }}') !== 2
    || occurrenceCount(productionWorkflow, 'CLOUDFLARE_API_TOKEN: ${{ secrets.PRODUCTION_WORKER_EPHEMERAL_TOKEN }}') !== 6
  ) {
    throw new Error('Cloudflare deployment steps must use only the exact supervised ephemeral-token mappings.')
  }
  requireOnlyEnvMappings(stagingWorkflow, 'CLOUDFLARE_API_TOKEN', [
    'CLOUDFLARE_API_TOKEN: ${{ secrets.STAGING_PAGES_EPHEMERAL_TOKEN }}',
    'CLOUDFLARE_API_TOKEN: ${{ secrets.STAGING_WORKER_EPHEMERAL_TOKEN }}',
  ], 10, 'Staging')
  requireOnlyEnvMappings(stagingWorkflow, 'PAGES_EPHEMERAL_TOKEN', [
    'PAGES_EPHEMERAL_TOKEN: ${{ secrets.STAGING_PAGES_EPHEMERAL_TOKEN }}',
  ], 3, 'Staging')
  requireOnlyEnvMappings(stagingWorkflow, 'WORKER_EPHEMERAL_TOKEN', [
    'WORKER_EPHEMERAL_TOKEN: ${{ secrets.STAGING_WORKER_EPHEMERAL_TOKEN }}',
  ], 2, 'Staging')
  requireOnlyEnvMappings(productionWorkflow, 'CLOUDFLARE_API_TOKEN', [
    'CLOUDFLARE_API_TOKEN: ${{ secrets.PRODUCTION_PAGES_EPHEMERAL_TOKEN }}',
    'CLOUDFLARE_API_TOKEN: ${{ secrets.PRODUCTION_WORKER_EPHEMERAL_TOKEN }}',
  ], 11, 'Production')
  requireOnlyEnvMappings(productionWorkflow, 'PAGES_EPHEMERAL_TOKEN', [
    'PAGES_EPHEMERAL_TOKEN: ${{ secrets.PRODUCTION_PAGES_EPHEMERAL_TOKEN }}',
  ], 2, 'Production')
  requireOnlyEnvMappings(productionWorkflow, 'WORKER_EPHEMERAL_TOKEN', [
    'WORKER_EPHEMERAL_TOKEN: ${{ secrets.PRODUCTION_WORKER_EPHEMERAL_TOKEN }}',
  ], 2, 'Production')
  if (
    occurrenceCount(stagingWorkflow, 'node scripts/verify-github-quality-run.mjs') !== 4
    || stagingWorkflow.includes('workflow_run:')
  ) {
    throw new Error('Staging must be manually dispatched and verify trusted main quality early, before Pages, and before optional Worker mutation.')
  }
  if (
    occurrenceCount(stagingWorkflow, 'GATE0_E2E_EMAIL: ${{ secrets.GATE0_E2E_EMAIL }}') < 3
    || occurrenceCount(stagingWorkflow, 'GATE0_E2E_PASSWORD: ${{ secrets.GATE0_E2E_PASSWORD }}') < 3
    || occurrenceCount(stagingWorkflow, 'SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}') !== 5
    || occurrenceCount(stagingWorkflow, 'GATE0_STAGING_SEED_CONFIRMATION: SEED GATE0 SYNTHETIC DATA qpgnomuqdcucjmxrunnw') < 2
  ) {
    throw new Error('Staging secrets must remain scoped to input verification, two fixture resets, and one isolated Worker secret-file step.')
  }
  if (
    occurrenceCount(stagingWorkflow, 'npm run test:e2e:gate0:staging') !== 2
    || occurrenceCount(stagingWorkflow, 'node scripts/seed-gate0-e2e.mjs') !== 2
    || occurrenceCount(stagingWorkflow, 'GATE0_EXPECTED_COMMIT_SHA: ${{ steps.staging-deployment.outputs.deployment_commit_sha }}') !== 2
    || occurrenceCount(stagingWorkflow, 'GATE0_EXPECTED_DEPLOYMENT_ID: ${{ steps.staging-deployment.outputs.deployment_id }}') !== 2
    || occurrenceCount(stagingWorkflow, 'GATE0_STAGING_TARGET_CONFIRMATION: RUN GATE0 buril-lab-staging') !== 2
    || occurrenceCount(stagingWorkflow, 'GATE0_BASE_URL: https://staging.burillab.com') !== 1
    || occurrenceCount(stagingWorkflow, 'GATE0_BASE_URL: ${{ steps.staging-deployment.outputs.deployment_url }}') !== 1
  ) {
    throw new Error('Staging must reset and run Gate0 once on each exact custom and immutable deployment target.')
  }
  if (
    occurrenceCount(stagingWorkflow, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" kv key get runtime_config') !== 3
    || occurrenceCount(stagingWorkflow, '--namespace-id "$BURILLAB_RUNTIME_CONFIG_KV_ID"') !== 3
    || occurrenceCount(stagingWorkflow, '--remote') !== 3
    || occurrenceCount(stagingWorkflow, '--text') !== 3
    || occurrenceCount(stagingWorkflow, '--config workers/storage-backup/wrangler.staging.jsonc') !== 7
    || occurrenceCount(stagingWorkflow, 'node scripts/verify-storage-backup-runtime-off.mjs') !== 3
    || occurrenceCount(stagingWorkflow, 'env -u CLOUDFLARE_API_TOKEN node scripts/verify-storage-backup-worker-deployment.mjs preflight') !== 1
    || occurrenceCount(stagingWorkflow, 'RUNNER_TEMP: ${{ runner.temp }}') !== 3
    || occurrenceCount(stagingWorkflow, 'node scripts/storage-backup-secret-file.mjs create') !== 1
    || occurrenceCount(stagingWorkflow, 'node scripts/storage-backup-secret-file.mjs cleanup') !== 1
    || occurrenceCount(stagingWorkflow, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" deploy \\') !== 1
    || occurrenceCount(stagingWorkflow, '--secrets-file') !== 1
    || occurrenceCount(stagingWorkflow, '--secrets-file "${{ steps.storage-backup-secret-file.outputs.secret_file }}"') !== 1
    || occurrenceCount(stagingWorkflow, '--strict') !== 8
    || occurrenceCount(stagingWorkflow, '--autoconfig=false') !== 1
    || occurrenceCount(stagingWorkflow, '--tag "$worker_tag"') !== 1
    || occurrenceCount(stagingWorkflow, '--message "$worker_message"') !== 1
    || occurrenceCount(stagingWorkflow, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" deployments status') !== 1
    || occurrenceCount(stagingWorkflow, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" versions list') !== 1
    || occurrenceCount(stagingWorkflow, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" secret list') !== 1
    || occurrenceCount(stagingWorkflow, '--name "$STORAGE_BACKUP_WORKER_NAME"') !== 3
    || occurrenceCount(stagingWorkflow, 'env -u CLOUDFLARE_API_TOKEN node scripts/verify-storage-backup-worker-deployment.mjs active') !== 1
    || occurrenceCount(stagingWorkflow, 'cloudflare_worker_surface_get() {') !== 1
    || occurrenceCount(stagingWorkflow, 'cloudflare_worker_surface_get bindings') !== 1
    || occurrenceCount(stagingWorkflow, 'cloudflare_worker_surface_get routes') !== 1
    || occurrenceCount(stagingWorkflow, 'cloudflare_worker_surface_get domains') !== 1
    || occurrenceCount(stagingWorkflow, 'cloudflare_worker_surface_get subdomain') !== 1
    || occurrenceCount(stagingWorkflow, 'cloudflare_worker_surface_get service') !== 1
    || occurrenceCount(stagingWorkflow, 'cloudflare_worker_surface_get schedules') !== 1
    || occurrenceCount(stagingWorkflow, 'node scripts/cloudflare-api-get.mjs') !== 3
    || occurrenceCount(stagingWorkflow, 'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/bindings"') !== 1
    || occurrenceCount(stagingWorkflow, 'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/routes?show_zonename=true"') !== 1
    || occurrenceCount(stagingWorkflow, 'endpoint="workers/domains?service=$STORAGE_BACKUP_WORKER_NAME&environment=production"') !== 1
    || occurrenceCount(stagingWorkflow, 'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/subdomain"') !== 1
    || occurrenceCount(stagingWorkflow, 'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production"') !== 1
    || occurrenceCount(stagingWorkflow, 'endpoint="workers/scripts/$STORAGE_BACKUP_WORKER_NAME/schedules"') !== 1
    || occurrenceCount(stagingWorkflow, 'endpoint="workers/') !== 6
    || occurrenceCount(stagingWorkflow, '/usr/bin/timeout --signal=TERM --kill-after=5s 30s') !== 9
    || occurrenceCount(stagingWorkflow, '/usr/bin/timeout --signal=TERM --kill-after=15s 540s') !== 2
  ) {
    throw new Error('Staging must verify exact-OFF twice and deploy and verify the backup Worker exactly once with isolated secret cleanup.')
  }
  const workerDeployBlock = workflowStepBlock(
    stagingWorkflow,
    'Deploy the OFF-only Staging storage backup Worker',
  )
  const workerMutationMarkers = [
    '/usr/bin/timeout --signal=TERM --kill-after=5s 30s git fetch --no-tags origin main',
    'test "$(git rev-parse HEAD)" = "$DEPLOY_COMMIT_SHA"',
    'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    'worker_tag="r$GITHUB_RUN_ID-l$DEPLOY_LEASE_ID"',
    'worker_message="quality-approved staging storage backup run $GITHUB_RUN_ID lease $DEPLOY_LEASE_ID commit $DEPLOY_COMMIT_SHA"',
    'node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 600',
    '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" deploy',
    'env -u CLOUDFLARE_API_TOKEN node scripts/verify-storage-backup-worker-deployment.mjs wrangler-output',
  ].map((marker) => workerDeployBlock.indexOf(marker))
  if (
    workerMutationMarkers.some((position) => position < 0)
    || workerMutationMarkers.some((position, index) => index > 0 && position <= workerMutationMarkers[index - 1])
    || !workerDeployBlock.includes('WRANGLER_OUTPUT_FILE_PATH: ${{ runner.temp }}/burillab-staging-worker-deploy.jsonl')
    || !workerDeployBlock.includes('/usr/bin/timeout --signal=TERM --kill-after=15s 540s')
    || !workflowStepBlock(stagingWorkflow, 'Verify the active Staging storage backup Worker deployment')
      .includes('EXPECTED_WORKER_VERSION_ID: ${{ steps.worker-deploy-command.outputs.worker_version_id }}')
  ) {
    throw new Error('The Staging Worker mutation and evidence must bind the current run, lease, and newly created version on a bounded current-main runner.')
  }
  for (const stepName of [
    'Verify the explicitly requested Worker ephemeral token',
    'Recheck that Staging still targets the current main tip before backup Worker deployment',
    'Recheck trusted main quality before backup Worker deployment',
    'Recheck the current Staging Supabase Advisor state before backup Worker deployment',
    'Verify Staging storage backup remains exactly OFF before Worker deployment',
    'Verify no unapproved Staging Worker secrets exist before deployment',
    'Create isolated temporary Worker secret file',
    'Deploy the OFF-only Staging storage backup Worker',
    'Verify the active Staging storage backup Worker deployment',
    'Verify Staging storage backup remains exactly OFF after Worker deployment',
    'Record optional storage backup Worker evidence',
  ]) {
    requireFailClosedStep(stagingWorkflow, stepName)
  }
  requireImmediateNextStep(
    stagingWorkflow,
    'Recheck the current Staging Supabase Advisor state before Pages deployment',
    'Recheck the active Staging Pages token and deployment inputs at the mutation boundary',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Recheck the active Staging Pages token and deployment inputs at the mutation boundary',
    'Recheck the signed Staging cleanup receipt at the Pages mutation boundary',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Recheck the signed Staging cleanup receipt at the Pages mutation boundary',
    'Recheck the signed Staging lease with ten minutes remaining for Pages mutation',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Recheck the signed Staging lease with ten minutes remaining for Pages mutation',
    'Materialize the Staging Wrangler config after final guards',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Materialize the Staging Wrangler config after final guards',
    'Deploy the exact commit to Staging Pages',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Recheck the current Staging Supabase Advisor state before backup Worker deployment',
    'Recheck the active Worker token set at the mutation boundary',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Recheck the active Worker token set at the mutation boundary',
    'Recheck Staging storage backup is exactly OFF at the mutation boundary',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Recheck Staging storage backup is exactly OFF at the mutation boundary',
    'Recheck the signed Worker cleanup receipt at the mutation boundary',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Recheck the signed Worker cleanup receipt at the mutation boundary',
    'Create isolated temporary Worker secret file',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Create isolated temporary Worker secret file',
    'Recheck the signed Worker lease with ten minutes remaining for mutation',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Recheck the signed Worker lease with ten minutes remaining for mutation',
    'Deploy the OFF-only Staging storage backup Worker',
  )
  requireImmediateNextStep(
    productionWorkflow,
    'Recheck the current production Supabase Advisor state immediately before deployment',
    'Recheck the active production Pages token and deployment inputs at the mutation boundary',
  )
  requireImmediateNextStep(
    productionWorkflow,
    'Recheck the active production Pages token and deployment inputs at the mutation boundary',
    'Recheck the signed production cleanup receipt at the Pages mutation boundary',
  )
  requireImmediateNextStep(
    productionWorkflow,
    'Recheck the signed production cleanup receipt at the Pages mutation boundary',
    'Recheck the signed production lease with ten minutes remaining for Pages mutation',
  )
  requireImmediateNextStep(
    productionWorkflow,
    'Recheck the signed production lease with ten minutes remaining for Pages mutation',
    'Materialize the production Wrangler config after final guards',
  )
  requireImmediateNextStep(
    productionWorkflow,
    'Materialize the production Wrangler config after final guards',
    'Deploy the exact commit to production Pages',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Verify the signed current ephemeral lease',
    'Verify exact ephemeral credentials reached the runner',
  )
  requireImmediateNextStep(
    stagingWorkflow,
    'Verify exact ephemeral credentials reached the runner',
    'Verify the signed cumulative credential cleanup receipt',
  )
  for (const stepName of [
    'Verify the signed current ephemeral lease',
    'Verify exact ephemeral credentials reached the runner',
    'Verify the signed cumulative credential cleanup receipt',
    'Verify the exact commit passed trusted main quality',
    'Verify environment-scoped deployment inputs',
    'Verify Pages control-plane safeguards before deployment',
    'Recheck that Staging still targets the current main tip',
    'Recheck the exact commit still passes trusted main quality',
    'Deploy the exact commit to Staging Pages',
  ]) {
    requireFailClosedStep(stagingWorkflow, stepName)
  }
  for (const stepName of [
    'Verify the explicitly requested Worker ephemeral token',
    'Recheck the active Worker token set at the mutation boundary',
  ]) {
    const block = workflowStepBlock(stagingWorkflow, stepName)
    if (
      !block.includes('WORKER_EPHEMERAL_TOKEN: ${{ secrets.STAGING_WORKER_EPHEMERAL_TOKEN }}')
      || block.includes('PAGES_EPHEMERAL_TOKEN')
    ) {
      throw new Error(`${stepName} must expose only the signed Staging Worker token.`)
    }
  }
  const workerSecretFileBlock = workflowStepBlock(
    stagingWorkflow,
    'Create isolated temporary Worker secret file',
  )
  if (
    !workerSecretFileBlock.includes('SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}')
    || workerSecretFileBlock.includes('SUPABASE_ACCESS_TOKEN:')
    || workerSecretFileBlock.includes('CLOUDFLARE_API_TOKEN:')
  ) {
    throw new Error('The Worker service-role secret may be exposed only in the final isolated secret-file step.')
  }
  requireExactRunCommands(
    stagingWorkflow,
    'Create isolated temporary Worker secret file',
    ['node scripts/storage-backup-secret-file.mjs create'],
  )
  for (const stepName of [
    'Verify the explicitly requested Worker ephemeral token',
    'Recheck that Staging still targets the current main tip before backup Worker deployment',
    'Recheck trusted main quality before backup Worker deployment',
    'Verify Staging storage backup remains exactly OFF before Worker deployment',
    'Verify no unapproved Staging Worker secrets exist before deployment',
    'Create isolated temporary Worker secret file',
    'Deploy the OFF-only Staging storage backup Worker',
    'Verify the active Staging storage backup Worker deployment',
    'Verify Staging storage backup remains exactly OFF after Worker deployment',
  ]) {
    requireFailClosedStep(stagingWorkflow, stepName)
  }
  for (const stepName of [
    'Verify the signed current ephemeral lease',
    'Verify the signed cumulative credential cleanup receipt',
    'Verify the exact commit passed trusted main quality',
    'Verify the exact approved Staging workflow succeeded',
    'Verify environment-scoped deployment inputs',
    'Verify Pages control-plane safeguards before deployment',
    'Recheck high and critical runtime advisories',
    'Recheck the exact commit still passes trusted main quality',
    'Recheck the exact approved Staging workflow still succeeded',
    'Recheck that production still targets the current main tip',
    'Recheck the active production Pages token and deployment inputs at the mutation boundary',
    'Recheck the signed production cleanup receipt at the Pages mutation boundary',
    'Recheck the signed production lease with ten minutes remaining for Pages mutation',
    'Deploy the exact commit to production Pages',
  ]) {
    requireFailClosedStep(productionWorkflow, stepName)
  }
  for (const stepName of [
    'Verify the exact commit passed trusted main quality',
    'Recheck the exact commit still passes trusted main quality',
  ]) {
    requireExactRunCommands(
      stagingWorkflow,
      stepName,
      ['node scripts/verify-github-quality-run.mjs'],
    )
  }
  requireExactRunCommands(
    stagingWorkflow,
    'Recheck trusted main quality before backup Worker deployment',
    ['node scripts/verify-github-quality-run.mjs'],
  )
  for (const stepName of [
    'Verify the exact commit passed trusted main quality',
    'Recheck the exact commit still passes trusted main quality',
  ]) {
    requireExactRunCommands(
      productionWorkflow,
      stepName,
      ['node scripts/verify-github-quality-run.mjs'],
    )
  }
  for (const stepName of [
    'Verify the exact approved Staging workflow succeeded',
    'Recheck the exact approved Staging workflow still succeeded',
  ]) {
    requireExactRunCommands(
      productionWorkflow,
      stepName,
      ['node scripts/verify-github-staging-run.mjs'],
    )
  }
  requireExactRunCommands(
    stagingWorkflow,
    'Verify the signed current ephemeral lease',
    ['node scripts/verify-ephemeral-lease-grant.mjs'],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Verify exact ephemeral credentials reached the runner',
    ['node scripts/verify-ephemeral-credential-injection.mjs --mode lease'],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Verify the signed cumulative credential cleanup receipt',
    ['node scripts/verify-ephemeral-cleanup-receipt.mjs'],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Recheck the signed Staging lease with ten minutes remaining for Pages mutation',
    ['node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 600'],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Recheck the signed Staging cleanup receipt at the Pages mutation boundary',
    ['node scripts/verify-ephemeral-cleanup-receipt.mjs'],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Verify the signed Worker lease',
    ['node scripts/verify-ephemeral-lease-grant.mjs'],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Verify the signed Worker cleanup receipt',
    ['node scripts/verify-ephemeral-cleanup-receipt.mjs'],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Verify trusted main quality for the Worker',
    ['node scripts/verify-github-quality-run.mjs'],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Recheck the signed Worker lease with ten minutes remaining for mutation',
    ['node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 600'],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Recheck the signed Worker cleanup receipt at the mutation boundary',
    ['node scripts/verify-ephemeral-cleanup-receipt.mjs'],
  )
  requireExactRunCommands(
    productionWorkflow,
    'Verify the signed current ephemeral lease',
    ['node scripts/verify-ephemeral-lease-grant.mjs'],
  )
  requireExactRunCommands(
    productionWorkflow,
    'Verify the signed cumulative credential cleanup receipt',
    ['node scripts/verify-ephemeral-cleanup-receipt.mjs'],
  )
  requireExactRunCommands(
    productionWorkflow,
    'Recheck the signed production lease with ten minutes remaining for Pages mutation',
    ['node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 600'],
  )
  requireExactRunCommands(
    productionWorkflow,
    'Recheck the signed production cleanup receipt at the Pages mutation boundary',
    ['node scripts/verify-ephemeral-cleanup-receipt.mjs'],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Verify the commit is trusted main history',
    [
      'test "$(git rev-parse HEAD)" = "$DEPLOY_COMMIT_SHA"',
      'git fetch --no-tags origin main',
      'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    ],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Recheck that Staging still targets the current main tip',
    [
      'git fetch --no-tags origin main',
      'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    ],
  )
  requireExactRunCommands(
    stagingWorkflow,
    'Recheck that Staging still targets the current main tip before backup Worker deployment',
    [
      'git fetch --no-tags origin main',
      'test "$(git rev-parse HEAD)" = "$DEPLOY_COMMIT_SHA"',
      'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    ],
  )
  requireExactRunCommands(
    productionWorkflow,
    'Verify the selected commit is trusted main history',
    [
      'test "$(git rev-parse HEAD)" = "$DEPLOY_COMMIT_SHA"',
      'git fetch --no-tags origin main',
      'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    ],
  )
  requireExactRunCommands(
    productionWorkflow,
    'Recheck that production still targets the current main tip',
    [
      'git fetch --no-tags origin main',
      'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    ],
  )
  requireStepCondition(
    stagingWorkflow,
    'Always remove temporary Worker secret material',
    'always()',
  )
  for (const stepName of [
    'Verify Pages control-plane safeguards before deployment',
    'Deploy the exact commit to Staging Pages',
    'Resolve the immutable Staging deployment URL',
    'Verify the applied Staging KV binding remains isolated',
  ]) {
    const block = workflowStepBlock(stagingWorkflow, stepName)
    if (
      !block.includes('CLOUDFLARE_API_TOKEN: ${{ secrets.STAGING_PAGES_EPHEMERAL_TOKEN }}')
      || block.includes('STAGING_WORKER_EPHEMERAL_TOKEN')
    ) {
      throw new Error(`${stepName} must use only the Staging Pages ephemeral token.`)
    }
  }
  const stagingValidationBlock = requireFailClosedStep(
    stagingWorkflow,
    'Validate the supervised Staging confirmation',
  )
  requireExecutableShellLine(
    stagingValidationBlock,
    'if [[ "$GITHUB_RUN_ATTEMPT" != "1" ]]; then',
    'Staging workflow re-run guard',
  )
  requireExecutableFailureBranch(
    stagingValidationBlock,
    'if [[ "$GITHUB_RUN_ATTEMPT" != "1" ]]; then',
    'Staging workflow re-run guard',
  )
  requireExecutableShellLine(
    stagingValidationBlock,
    'if [[ "$GITHUB_EVENT_NAME" != "workflow_dispatch" || "$GITHUB_REPOSITORY" != "haengjoo123/buril-lab" || "$GITHUB_REF" != "refs/heads/main" ]]; then',
    'Staging canonical dispatch guard',
  )
  requireExecutableFailureBranch(
    stagingValidationBlock,
    'if [[ "$GITHUB_EVENT_NAME" != "workflow_dispatch" || "$GITHUB_REPOSITORY" != "haengjoo123/buril-lab" || "$GITHUB_REF" != "refs/heads/main" ]]; then',
    'Staging canonical dispatch guard',
  )
  const stagingJobConditions = stagingWorkflow
    .split(/\r?\n/)
    .filter((line) => /^    if:/.test(line))
  if (
    stagingJobConditions.length !== 1
    || stagingJobConditions[0] !== '    if: ${{ inputs.deploy_storage_backup }}'
  ) {
    throw new Error('Only the isolated Staging Worker job may use the exact explicit backup-request condition.')
  }
  for (const stepName of [
    'Verify Staging storage backup remains exactly OFF before Worker deployment',
    'Recheck Staging storage backup is exactly OFF at the mutation boundary',
    'Verify no unapproved Staging Worker secrets exist before deployment',
    'Deploy the OFF-only Staging storage backup Worker',
    'Verify the active Staging storage backup Worker deployment',
    'Verify Staging storage backup remains exactly OFF after Worker deployment',
  ]) {
    const block = workflowStepBlock(stagingWorkflow, stepName)
    if (
      !block.includes('CLOUDFLARE_API_TOKEN: ${{ secrets.STAGING_WORKER_EPHEMERAL_TOKEN }}')
      || block.includes('CLOUDFLARE_API_TOKEN: ${{ secrets.STAGING_PAGES_EPHEMERAL_TOKEN }}')
    ) {
      throw new Error(`${stepName} must use only the explicitly requested Staging Worker ephemeral token.`)
    }
  }
  const stagingGateOrder = [
    'Validate the supervised Staging confirmation',
    'Verify the signed current ephemeral lease',
    'Verify the signed cumulative credential cleanup receipt',
    'Verify the exact commit passed trusted main quality',
    'Verify the current Staging Supabase Advisor state',
    'Verify environment-scoped deployment inputs',
    'Recheck that Staging still targets the current main tip',
    'Recheck the exact commit still passes trusted main quality',
    'Recheck the current Staging Supabase Advisor state before Pages deployment',
    'Recheck the active Staging Pages token and deployment inputs at the mutation boundary',
    'Recheck the signed Staging cleanup receipt at the Pages mutation boundary',
    'Recheck the signed Staging lease with ten minutes remaining for Pages mutation',
    'Deploy the exact commit to Staging Pages',
    'Verify the protected Staging release manifest',
    'Verify the Staging KOSHA link-only runtime contract',
    'Reset the exact Staging Gate 0 synthetic fixture for the custom domain',
    'Run the protected custom-domain Staging Gate 0 browser flow',
    'Reset the exact Staging Gate 0 synthetic fixture for the immutable deployment',
    'Run the protected immutable-deployment Staging Gate 0 browser flow',
  ].map((marker) => stagingWorkflow.indexOf(marker))
  if (stagingGateOrder.some((position) => position < 0)
      || stagingGateOrder.some((position, index) => index > 0 && position <= stagingGateOrder[index - 1])) {
    throw new Error('Staging preflight, deployment, release, KOSHA, exact-target resets, and browser gates are out of order.')
  }
  const stagingWorkerOrder = [
    'Verify the applied Staging KV binding remains isolated',
    'Verify the explicitly requested Worker ephemeral token',
    'Verify Staging storage backup remains exactly OFF before Worker deployment',
    'Verify no unapproved Staging Worker secrets exist before deployment',
    'Recheck that Staging still targets the current main tip before backup Worker deployment',
    'Recheck trusted main quality before backup Worker deployment',
    'Recheck the current Staging Supabase Advisor state before backup Worker deployment',
    'Recheck the active Worker token set at the mutation boundary',
    'Recheck Staging storage backup is exactly OFF at the mutation boundary',
    'Recheck the signed Worker cleanup receipt at the mutation boundary',
    'Create isolated temporary Worker secret file',
    'Recheck the signed Worker lease with ten minutes remaining for mutation',
    'Deploy the OFF-only Staging storage backup Worker',
    'Always remove temporary Worker secret material',
    'Verify the active Staging storage backup Worker deployment',
    'Verify Staging storage backup remains exactly OFF after Worker deployment',
    'Record optional storage backup Worker evidence',
    'Record Worker cleanup pending before the next lease',
  ].map((marker) => stagingWorkflow.indexOf(marker))
  if (stagingWorkerOrder.some((position) => position < 0)
      || stagingWorkerOrder.some((position, index) => index > 0 && position <= stagingWorkerOrder[index - 1])) {
    throw new Error('Staging backup Worker main-tip, exact-OFF, deploy, cleanup, active-version, and evidence gates are out of order.')
  }

  const stagingPlaywrightConfig = browser.stagingConfig || ''
  const gate0Spec = browser.gate0Spec || ''
  const gate0AccessRoute = browser.accessRoute || ''
  const gate0TargetConfig = browser.targetConfig || ''
  if (stagingPlaywrightConfig.includes('extraHTTPHeaders')) {
    throw new Error('Staging Playwright must not send Access credentials through context-wide headers.')
  }
  if (!stagingPlaywrightConfig.includes("trace: 'off'")) {
    throw new Error('Staging Playwright traces must remain off while Access credentials are in memory.')
  }
  for (const required of [
    "import { resolveStagingGate0Target } from './scripts/gate0-staging-target.mjs'",
    'const gate0Target = resolveStagingGate0Target(process.env)',
    'baseURL: gate0Target.origin',
    "'GATE0_EXPECTED_COMMIT_SHA'",
    "'GATE0_EXPECTED_DEPLOYMENT_ID'",
    "'GATE0_STAGING_TARGET_CONFIRMATION'",
  ]) {
    if (!stagingPlaywrightConfig.includes(required)) {
      throw new Error(`Staging Playwright target selection lacks a required exact-target control: ${required}`)
    }
  }
  for (const required of [
    "from '../../scripts/gate0-staging-target.mjs'",
    'isStagingGate0AccessRequest,',
    "import { verifyReleaseManifest } from '../../scripts/verify-release-manifest.mjs'",
    'for (const routePattern of stagingTarget.accessRoutePatterns)',
    'context.route(routePattern',
    "import { fulfillStagingAccessRoute } from '../../scripts/gate0-access-route.mjs'",
    'targetOrigin: stagingTarget.origin',
    'deploymentId: stagingTarget.deploymentId',
    '/release.json?gate0-commit=${stagingTarget.commitSha}',
    'expectExactStagingTargetOrigin(',
    'manifestResponse.url()',
    'verifyReleaseManifest(manifest, {',
    'unapprovedAccessHeaderRequests',
    'unexpectedTopLevelNavigations',
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
  if (gate0Spec.includes("context.route('**/*'") || gate0Spec.includes('context.route("**/*"')) {
    throw new Error('Gate0 Access routing must not use a broad all-origin route.')
  }
  for (const required of [
    'if (!isStagingGate0AccessRequest({',
    'requestUrl: route.request().url()',
    'deploymentId,',
    '.filter(([name]) => !ACCESS_HEADER_PATTERN.test(name))',
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
  for (const required of [
    "export const GATE0_STAGING_CUSTOM_ORIGIN = 'https://staging.burillab.com'",
    "const GATE0_STAGING_PAGES_APEX = 'buril-lab-staging.pages.dev'",
    'labels.length === 4',
    'const DEPLOYMENT_LABEL_PATTERN = /^[0-9a-f]{8}$/',
    'FULL_SHA_PATTERN',
    'DEPLOYMENT_ID_PATTERN',
    'target.immutableLabel !== canonicalDeploymentId.slice(0, 8)',
    'GATE0_STAGING_TARGET_CONFIRMATION !== expectedConfirmation',
    'stagingGate0AccessRoutePatterns({',
    '`${GATE0_STAGING_CUSTOM_ORIGIN}/api/**`',
    "request.pathname.startsWith('/api/')",
  ]) {
    if (!gate0TargetConfig.includes(required)) {
      throw new Error(`Gate0 target validation lacks a required exact-deployment control: ${required}`)
    }
  }
  if (
    gate0TargetConfig.includes('buril-lab.pages.dev')
    || gate0TargetConfig.includes("'https://burillab.com'")
    || gate0TargetConfig.includes('*.pages.dev')
  ) {
    throw new Error('Gate0 target validation must not allow production or broad Pages origins.')
  }
  if (
    stagingWorkflow.includes('convert-gate0-legacy-owner.mjs')
    || stagingWorkflow.includes('GATE0_LEGACY_CONVERSION_CONFIRMATION')
  ) {
    throw new Error('Legacy Gate0 ownership conversion must remain an explicit manual-only operation.')
  }

  if (occurrenceCount(qualityWorkflow, 'npm run storage-backup:check') !== 1) {
    throw new Error('Quality workflow must run the storage backup contract exactly once.')
  }
  if (
    [qualityWorkflow, stagingWorkflow, productionWorkflow]
      .some((workflow) => workflow.includes('secrets.SUPABASE_ACCESS_TOKEN'))
    || qualityWorkflow.includes('npm run security:supabase-advisors:hosted --')
  ) {
    throw new Error('Generic or automatic-quality Supabase Management PAT access is forbidden.')
  }
  const ephemeralAdvisorMapping = 'SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN }}'
  requireOnlyEnvMappings(stagingWorkflow, 'SUPABASE_ACCESS_TOKEN', [ephemeralAdvisorMapping], 5, 'Staging')
  requireOnlyEnvMappings(productionWorkflow, 'SUPABASE_ACCESS_TOKEN', [ephemeralAdvisorMapping], 4, 'Production')
  requireOnlyEnvMappings(credentialProbeWorkflow, 'SUPABASE_ACCESS_TOKEN', [ephemeralAdvisorMapping], 1, 'Staging credential-injection probe')
  requireOnlyEnvMappings(stagingWorkflow, 'EPHEMERAL_CREDENTIAL_SESSION', [], 0, 'Staging')
  requireOnlyEnvMappings(productionWorkflow, 'EPHEMERAL_CREDENTIAL_SESSION', [], 0, 'Production')
  requireOnlyEnvMappings(credentialProbeWorkflow, 'EPHEMERAL_CREDENTIAL_SESSION', [], 0, 'Staging credential-injection probe')
  requireOnlyEnvMappings(credentialProbeWorkflow, 'PAGES_EPHEMERAL_TOKEN', [
    'PAGES_EPHEMERAL_TOKEN: ${{ secrets.STAGING_PAGES_EPHEMERAL_TOKEN }}',
  ], 1, 'Staging credential-injection probe')
  requireOnlyEnvMappings(credentialProbeWorkflow, 'CLOUDFLARE_API_TOKEN', [], 0, 'Staging credential-injection probe')
  requireExactCloudflareTokenSecretNames(credentialProbeWorkflow, [
    'STAGING_PAGES_EPHEMERAL_TOKEN',
  ], 'Staging credential-injection probe')
  if (
    !credentialProbeWorkflow.includes('name: Verify staging ephemeral credentials')
    || !credentialProbeWorkflow.includes('run-name: Verify staging ephemeral credential injection ${{ inputs.commit_sha }} (probe=${{ inputs.probe_id }})')
    || !credentialProbeWorkflow.includes('permissions:\n  contents: read')
    || !credentialProbeWorkflow.includes('group: cloudflare-staging')
    || !credentialProbeWorkflow.includes('cancel-in-progress: false')
    || !credentialProbeWorkflow.includes('DEPLOY_ENVIRONMENT: staging')
    || !credentialProbeWorkflow.includes('DEPLOY_COMMIT_SHA: ${{ inputs.commit_sha }}')
    || !credentialProbeWorkflow.includes('DEPLOY_PROBE_ID: ${{ inputs.probe_id }}')
    || !credentialProbeWorkflow.includes('DEPLOY_CONFIRMATION: ${{ inputs.confirmation }}')
    || !credentialProbeWorkflow.includes('EPHEMERAL_CREDENTIAL_PROBE_GRANT: ${{ inputs.probe_grant }}')
    || !credentialProbeWorkflow.includes('EPHEMERAL_CLEANUP_RECEIPT: ${{ vars.EPHEMERAL_CLEANUP_RECEIPT }}')
    || !credentialProbeWorkflow.includes('VERIFY buril-lab-staging credential injection $DEPLOY_COMMIT_SHA PROBE $DEPLOY_PROBE_ID')
    || !credentialProbeWorkflow.includes('node scripts/verify-ephemeral-credential-injection.mjs --mode probe')
    || !credentialProbeWorkflow.includes('PATH: ${{ steps.credential-probe-runner-boundary.outputs.trusted_path }}')
    || /(?:\bwrangler\b|pages\s+deploy|workers\/|api\.cloudflare\.com|security:supabase-advisors:hosted|\bnpm\b|\bcurl\b|CLOUDFLARE_API_TOKEN|SUPABASE_SERVICE_ROLE_KEY)/i.test(credentialProbeWorkflow)
  ) {
    throw new Error('The Staging credential-injection probe must be a non-deploying exact-secret verifier.')
  }
  for (const stepName of [
    'Validate the Staging credential-injection probe request',
    'Verify the probe commit is current main',
    'Capture the clean credential-injection probe runner boundary',
    'Verify exact environment-secret injection',
  ]) {
    requireFailClosedStep(credentialProbeWorkflow, stepName)
  }
  requireExactRunCommands(
    credentialProbeWorkflow,
    'Verify exact environment-secret injection',
    ['node scripts/verify-ephemeral-credential-injection.mjs --mode probe'],
  )
  for (const stepName of [
    'Verify the current Staging Supabase Advisor state',
    'Recheck the current Staging Supabase Advisor state before Pages deployment',
    'Verify the current Staging Supabase Advisor state for the Worker',
    'Recheck the current Staging Supabase Advisor state before backup Worker deployment',
  ]) {
    const leaseCommand = 'node scripts/verify-ephemeral-supabase-lease.mjs'
    const advisorCommand = 'npm run security:supabase-advisors:hosted -- --environment staging'
    const block = requireExactRunCommands(stagingWorkflow, stepName, [leaseCommand, advisorCommand])
    if (
      !block.includes(ephemeralAdvisorMapping)
      || !block.includes(leaseCommand)
      || !block.includes(advisorCommand)
      || block.indexOf(leaseCommand) >= block.indexOf(advisorCommand)
      || block.includes('SUPABASE_SERVICE_ROLE_KEY')
    ) {
      throw new Error(`${stepName} must receive only the ephemeral Supabase PAT and inspect Staging directly.`)
    }
  }
  for (const stepName of [
    'Verify the current production Supabase Advisor state',
    'Recheck the current production Supabase Advisor state immediately before deployment',
  ]) {
    const leaseCommand = 'node scripts/verify-ephemeral-supabase-lease.mjs'
    const advisorCommand = 'npm run security:supabase-advisors:hosted -- --environment production'
    const block = requireExactRunCommands(
      productionWorkflow,
      stepName,
      [leaseCommand, advisorCommand],
    )
    if (
      !block.includes(ephemeralAdvisorMapping)
      || !block.includes(leaseCommand)
      || !block.includes(advisorCommand)
      || block.indexOf(leaseCommand) >= block.indexOf(advisorCommand)
      || block.includes('SUPABASE_SERVICE_ROLE_KEY')
    ) {
      throw new Error(`${stepName} must receive only the ephemeral Supabase PAT and inspect production directly.`)
    }
  }

  for (const required of [
    'workflow_dispatch:',
    'lease_id:',
    'staging_run_id:',
    'deploy_storage_backup:',
    'type: boolean',
    'default: false',
    'if [[ "$GITHUB_EVENT_NAME" != "workflow_dispatch" || "$GITHUB_REPOSITORY" != "haengjoo123/buril-lab" || "$GITHUB_REF" != "refs/heads/main" ]]',
    'if [[ "$GITHUB_RUN_ATTEMPT" != "1" ]]',
    'DEPLOY_LEASE_ID: ${{ inputs.lease_id }}',
    'DEPLOY_STAGING_RUN_ID: ${{ inputs.staging_run_id }}',
    'EPHEMERAL_LEASE_GRANT: ${{ vars.EPHEMERAL_LEASE_GRANT }}',
    'EPHEMERAL_CLEANUP_RECEIPT: ${{ vars.EPHEMERAL_CLEANUP_RECEIPT }}',
    'STAGING_EPHEMERAL_CLEANUP_RECEIPT: ${{ vars.STAGING_EPHEMERAL_CLEANUP_RECEIPT }}',
    'DEPLOY buril-lab production $DEPLOY_COMMIT_SHA STAGING $DEPLOY_STAGING_RUN_ID LEASE $DEPLOY_LEASE_ID WITH EPHEMERAL TOKENS',
    'DEPLOY_STORAGE_BACKUP: ${{ inputs.deploy_storage_backup }}',
    'PAGES_EPHEMERAL_TOKEN: ${{ secrets.PRODUCTION_PAGES_EPHEMERAL_TOKEN }}',
    'WORKER_EPHEMERAL_TOKEN: ${{ secrets.PRODUCTION_WORKER_EPHEMERAL_TOKEN }}',
    'STAGING_KOSHA_CONTENT_MODE: link_only',
    'if [[ "$DEPLOY_COMMIT_SHA" != "$GITHUB_SHA" ]]',
    'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    'node scripts/verify-github-quality-run.mjs',
    'node scripts/verify-ephemeral-lease-grant.mjs',
    'node scripts/verify-ephemeral-cleanup-receipt.mjs',
    'node scripts/verify-github-staging-run.mjs',
    'npm run security:supabase-advisors:hosted -- --environment production',
    'npm audit --omit=dev --audit-level=high',
    'Recheck the current production Supabase Advisor state immediately before deployment',
    'Recheck the exact commit still passes trusted main quality',
    'Recheck the exact approved Staging workflow still succeeded',
    'https://staging.burillab.com/release.json',
    'https://buril-lab-staging.pages.dev/release.json',
    'steps.staging-deployment.outputs.deployment_url',
    'env -u CLOUDFLARE_API_TOKEN node scripts/read-pages-deployment.mjs',
    'set -euo pipefail',
    '--file -',
    'id: production-deployment',
    'api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$CLOUDFLARE_PAGES_PROJECT/deployments?env=production',
    '--environment production',
    '--project "$CLOUDFLARE_PAGES_PROJECT"',
    'steps.production-deployment.outputs.deployment_url',
    'Record cleanup pending before the next lease',
  ]) {
    if (!productionWorkflow.includes(required)) {
      throw new Error(`Production workflow lacks a manual release guard: ${required}`)
    }
  }
  const productionValidationBlock = requireFailClosedStep(
    productionWorkflow,
    'Validate the manual confirmation',
  )
  requireExecutableShellLine(
    productionValidationBlock,
    'if [[ "$GITHUB_RUN_ATTEMPT" != "1" ]]; then',
    'Production workflow re-run guard',
  )
  requireExecutableFailureBranch(
    productionValidationBlock,
    'if [[ "$GITHUB_RUN_ATTEMPT" != "1" ]]; then',
    'Production workflow re-run guard',
  )
  requireExecutableShellLine(
    productionValidationBlock,
    'if [[ ! "$DEPLOY_STAGING_RUN_ID" =~ ^[1-9][0-9]*$ ]]; then',
    'Production exact Staging-run guard',
  )
  requireExecutableFailureBranch(
    productionValidationBlock,
    'if [[ ! "$DEPLOY_STAGING_RUN_ID" =~ ^[1-9][0-9]*$ ]]; then',
    'Production exact Staging-run guard',
  )
  requireExecutableShellLine(
    productionValidationBlock,
    'if [[ "$GITHUB_EVENT_NAME" != "workflow_dispatch" || "$GITHUB_REPOSITORY" != "haengjoo123/buril-lab" || "$GITHUB_REF" != "refs/heads/main" ]]; then',
    'Production canonical dispatch guard',
  )
  requireExecutableFailureBranch(
    productionValidationBlock,
    'if [[ "$GITHUB_EVENT_NAME" != "workflow_dispatch" || "$GITHUB_REPOSITORY" != "haengjoo123/buril-lab" || "$GITHUB_REF" != "refs/heads/main" ]]; then',
    'Production canonical dispatch guard',
  )
  const productionJobConditions = productionWorkflow
    .split(/\r?\n/)
    .filter((line) => /^    if:/.test(line))
  if (
    productionJobConditions.length !== 1
    || productionJobConditions[0] !== '    if: ${{ inputs.deploy_storage_backup }}'
  ) {
    throw new Error('Only the isolated Production Worker job may use the exact explicit backup-request condition.')
  }
  const productionInitialOrder = [
    'Validate the manual confirmation',
    'Verify the signed current ephemeral lease',
    'Verify the signed cumulative credential cleanup receipt',
    'Verify the exact commit passed trusted main quality',
    'Verify the exact approved Staging workflow succeeded',
    'Verify the current production Supabase Advisor state',
    'Verify environment-scoped deployment inputs',
  ].map((marker) => productionWorkflow.indexOf(marker))
  if (
    productionInitialOrder.some((position) => position < 0)
    || productionInitialOrder.some((position, index) => index > 0 && position <= productionInitialOrder[index - 1])
  ) {
    throw new Error('Production signed lease, cleanup, Staging cleanup, Advisor, and input guards are out of order.')
  }
  for (const stepName of [
    'Resolve the immutable Staging deployment for this SHA',
    'Verify Pages control-plane safeguards before deployment',
    'Deploy the exact commit to production Pages',
    'Resolve the exact immutable production deployment',
    'Verify both applied KV bindings remain isolated',
  ]) {
    const block = workflowStepBlock(productionWorkflow, stepName)
    if (!block.includes('CLOUDFLARE_API_TOKEN: ${{ secrets.PRODUCTION_PAGES_EPHEMERAL_TOKEN }}')) {
      throw new Error(`${stepName} must use only the Production Pages ephemeral token.`)
    }
  }
  requireStepCondition(productionWorkflow, 'Record cleanup pending before the next lease', 'always()')

  if (
    !productionWorkerJob.includes('\n    environment:\n      name: production\n')
    || !productionWorkerJob.includes('name: Supervised fresh-runner deploy of the OFF-only Production backup Worker')
    || productionWorkerJob.includes('PRODUCTION_PAGES_EPHEMERAL_TOKEN')
    || productionBuildJob.includes('PRODUCTION_WORKER_EPHEMERAL_TOKEN')
    || productionDeployJob.includes('PRODUCTION_WORKER_EPHEMERAL_TOKEN')
    || productionWorkflow.includes('secrets.SUPABASE_SERVICE_ROLE_KEY')
    || productionWorkflow.includes('storage-backup-secret-file')
  ) {
    throw new Error('Production Worker deployment must remain isolated, code-only, and must never receive Pages or service-role secret material.')
  }
  const productionWorkerValidationBlock = requireFailClosedStep(
    productionWorkflow,
    'Validate the supervised Production Worker confirmation',
  )
  for (const condition of [
    'if [[ "$GITHUB_EVENT_NAME" != "workflow_dispatch" || "$GITHUB_REPOSITORY" != "haengjoo123/buril-lab" || "$GITHUB_REF" != "refs/heads/main" ]]; then',
    'if [[ "$GITHUB_RUN_ATTEMPT" != "1" || "$DEPLOY_STORAGE_BACKUP" != "true" ]]; then',
    'if [[ ! "$DEPLOY_COMMIT_SHA" =~ ^[0-9a-f]{40}$ || "$DEPLOY_COMMIT_SHA" != "$GITHUB_SHA" ]]; then',
    'if [[ ! "$DEPLOY_LEASE_ID" =~ ^[0-9a-f]{32}$ || ! "$DEPLOY_STAGING_RUN_ID" =~ ^[1-9][0-9]*$ ]]; then',
    'if [[ "$DEPLOY_CONFIRMATION" != "DEPLOY buril-lab production $DEPLOY_COMMIT_SHA STAGING $DEPLOY_STAGING_RUN_ID LEASE $DEPLOY_LEASE_ID WITH EPHEMERAL TOKENS" ]]; then',
  ]) {
    requireExecutableShellLine(productionWorkerValidationBlock, condition, 'Production Worker request boundary')
    requireExecutableFailureBranch(productionWorkerValidationBlock, condition, 'Production Worker request boundary')
  }
  for (const stepName of [
    'Verify the Production Worker commit is current main',
    'Verify the signed Production Worker lease',
    'Verify the signed Production Worker cleanup receipt',
    'Verify trusted main quality for the Production Worker',
    'Verify the exact cleaned Staging run for the Production Worker',
    'Verify the current production Supabase Advisor state for the Worker',
    'Verify the explicitly requested Production Worker token',
    'Verify Production storage backup remains exactly OFF before Worker deployment',
    'Verify the existing Production Worker secret allow-list before deployment',
    'Recheck Production Worker current main, quality, Staging, and Advisor gates',
    'Recheck the active Production Worker token and OFF switch at the mutation boundary',
    'Recheck the signed Production Worker cleanup and lease at mutation',
    'Deploy the OFF-only Production storage backup Worker',
    'Verify the active Production storage backup Worker deployment',
    'Verify Production storage backup remains exactly OFF after Worker deployment',
    'Record Production storage backup Worker evidence',
  ]) {
    requireFailClosedStep(productionWorkflow, stepName)
  }
  requireStepCondition(
    productionWorkflow,
    'Record Production Worker cleanup pending before the next lease',
    'always()',
  )
  requireExactRunCommands(
    productionWorkflow,
    'Verify the Production Worker commit is current main',
    [
      'test "$(git rev-parse HEAD)" = "$DEPLOY_COMMIT_SHA"',
      'git fetch --no-tags origin main',
      'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    ],
  )
  requireExactRunCommands(
    productionWorkflow,
    'Verify the signed Production Worker lease',
    ['node scripts/verify-ephemeral-lease-grant.mjs'],
  )
  requireExactRunCommands(
    productionWorkflow,
    'Verify the signed Production Worker cleanup receipt',
    ['node scripts/verify-ephemeral-cleanup-receipt.mjs'],
  )
  requireExactRunCommands(
    productionWorkflow,
    'Verify trusted main quality for the Production Worker',
    ['node scripts/verify-github-quality-run.mjs'],
  )
  requireExactRunCommands(
    productionWorkflow,
    'Verify the exact cleaned Staging run for the Production Worker',
    ['node scripts/verify-github-staging-run.mjs'],
  )
  const productionWorkerAdvisorBlock = requireExactRunCommands(
    productionWorkflow,
    'Verify the current production Supabase Advisor state for the Worker',
    [
      'node scripts/verify-ephemeral-supabase-lease.mjs',
      'npm run security:supabase-advisors:hosted -- --environment production',
    ],
  )
  if (
    !productionWorkerAdvisorBlock.includes(ephemeralAdvisorMapping)
    || productionWorkerAdvisorBlock.includes('SUPABASE_SERVICE_ROLE_KEY')
  ) {
    throw new Error('Production Worker Advisor verification may receive only the ephemeral Management PAT.')
  }
  const productionWorkerRecheckBlock = requireExactRunCommands(
    productionWorkflow,
    'Recheck Production Worker current main, quality, Staging, and Advisor gates',
    [
      'set -euo pipefail',
      'git fetch --no-tags origin main',
      'test "$(git rev-parse HEAD)" = "$DEPLOY_COMMIT_SHA"',
      'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
      'node scripts/verify-github-quality-run.mjs',
      'node scripts/verify-github-staging-run.mjs',
      'node scripts/verify-ephemeral-supabase-lease.mjs',
      'npm run security:supabase-advisors:hosted -- --environment production',
    ],
  )
  if (
    !productionWorkerRecheckBlock.includes(ephemeralAdvisorMapping)
    || productionWorkerRecheckBlock.includes('SUPABASE_SERVICE_ROLE_KEY')
  ) {
    throw new Error('Production Worker final current-state gate may receive only the ephemeral Management PAT.')
  }
  requireExactRunCommands(
    productionWorkflow,
    'Verify the explicitly requested Production Worker token',
    ['node scripts/verify-cloudflare-deploy-inputs.mjs'],
  )
  requireExactRunCommands(
    productionWorkflow,
    'Recheck the signed Production Worker cleanup and lease at mutation',
    [
      'node scripts/verify-ephemeral-cleanup-receipt.mjs',
      'node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 600',
    ],
  )
  for (const stepName of [
    'Verify the explicitly requested Production Worker token',
    'Verify Production storage backup remains exactly OFF before Worker deployment',
    'Verify the existing Production Worker secret allow-list before deployment',
    'Recheck the active Production Worker token and OFF switch at the mutation boundary',
    'Deploy the OFF-only Production storage backup Worker',
    'Verify the active Production storage backup Worker deployment',
    'Verify Production storage backup remains exactly OFF after Worker deployment',
  ]) {
    const block = workflowStepBlock(productionWorkflow, stepName)
    if (
      !block.includes('secrets.PRODUCTION_WORKER_EPHEMERAL_TOKEN')
      || block.includes('secrets.PRODUCTION_PAGES_EPHEMERAL_TOKEN')
    ) {
      throw new Error(`${stepName} must use only the explicitly requested Production Worker ephemeral token.`)
    }
  }
  if (
    occurrenceCount(productionWorkflow, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" kv key get runtime_config') !== 3
    || occurrenceCount(productionWorkflow, '--namespace-id "$BURILLAB_RUNTIME_CONFIG_KV_ID"') !== 3
    || occurrenceCount(productionWorkflow, '--remote') !== 3
    || occurrenceCount(productionWorkflow, '--text') !== 3
    || occurrenceCount(productionWorkflow, '--config workers/storage-backup/wrangler.production.jsonc') !== 7
    || occurrenceCount(productionWorkflow, 'node scripts/verify-storage-backup-runtime-off.mjs') !== 3
    || occurrenceCount(productionWorkflow, 'env -u CLOUDFLARE_API_TOKEN node scripts/verify-cloudflare-deploy-inputs.mjs') !== 1
    || occurrenceCount(productionWorkflow, 'env -u CLOUDFLARE_API_TOKEN node scripts/verify-storage-backup-worker-deployment.mjs preflight') !== 1
    || occurrenceCount(productionWorkflow, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" deploy \\') !== 1
    || occurrenceCount(productionWorkflow, '--secrets-file') !== 0
    || occurrenceCount(productionWorkflow, '--strict') !== 9
    || occurrenceCount(productionWorkflow, '--autoconfig=false') !== 1
    || occurrenceCount(productionWorkflow, '--tag "$worker_tag"') !== 1
    || occurrenceCount(productionWorkflow, '--message "$worker_message"') !== 1
    || occurrenceCount(productionWorkflow, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" deployments status') !== 1
    || occurrenceCount(productionWorkflow, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" versions list') !== 1
    || occurrenceCount(productionWorkflow, '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" secret list') !== 1
    || occurrenceCount(productionWorkflow, '--name "$STORAGE_BACKUP_WORKER_NAME"') !== 3
    || occurrenceCount(productionWorkflow, 'env -u CLOUDFLARE_API_TOKEN node scripts/verify-storage-backup-worker-deployment.mjs active') !== 1
    || occurrenceCount(productionWorkflow, 'cloudflare_worker_surface_get() {') !== 1
    || occurrenceCount(productionWorkflow, 'cloudflare_worker_surface_get bindings') !== 1
    || occurrenceCount(productionWorkflow, 'cloudflare_worker_surface_get routes') !== 1
    || occurrenceCount(productionWorkflow, 'cloudflare_worker_surface_get domains') !== 1
    || occurrenceCount(productionWorkflow, 'cloudflare_worker_surface_get subdomain') !== 1
    || occurrenceCount(productionWorkflow, 'cloudflare_worker_surface_get service') !== 1
    || occurrenceCount(productionWorkflow, 'cloudflare_worker_surface_get schedules') !== 1
    || occurrenceCount(productionWorkflow, 'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/bindings"') !== 1
    || occurrenceCount(productionWorkflow, 'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/routes?show_zonename=true"') !== 1
    || occurrenceCount(productionWorkflow, 'endpoint="workers/domains?service=$STORAGE_BACKUP_WORKER_NAME&environment=production"') !== 1
    || occurrenceCount(productionWorkflow, 'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production/subdomain"') !== 1
    || occurrenceCount(productionWorkflow, 'endpoint="workers/services/$STORAGE_BACKUP_WORKER_NAME/environments/production"') !== 1
    || occurrenceCount(productionWorkflow, 'endpoint="workers/scripts/$STORAGE_BACKUP_WORKER_NAME/schedules"') !== 1
    || occurrenceCount(productionWorkflow, '/usr/bin/timeout --signal=TERM --kill-after=5s 30s') !== 9
    || occurrenceCount(productionWorkflow, '/usr/bin/timeout --signal=TERM --kill-after=15s 540s') !== 2
  ) {
    throw new Error('Production must verify exact-OFF three times and deploy and verify the code-only backup Worker exactly once.')
  }
  const productionWorkerDeployBlock = workflowStepBlock(
    productionWorkflow,
    'Deploy the OFF-only Production storage backup Worker',
  )
  const productionWorkerMutationMarkers = [
    '/usr/bin/timeout --signal=TERM --kill-after=5s 30s git fetch --no-tags origin main',
    'test "$(git rev-parse HEAD)" = "$DEPLOY_COMMIT_SHA"',
    'test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"',
    'worker_tag="r$GITHUB_RUN_ID-l$DEPLOY_LEASE_ID"',
    'worker_message="quality-approved production storage backup run $GITHUB_RUN_ID lease $DEPLOY_LEASE_ID commit $DEPLOY_COMMIT_SHA"',
    'node scripts/verify-ephemeral-lease-grant.mjs --minimum-remaining-seconds 600',
    '"$GITHUB_WORKSPACE/node_modules/.bin/wrangler" deploy',
    'env -u CLOUDFLARE_API_TOKEN node scripts/verify-storage-backup-worker-deployment.mjs wrangler-output',
  ].map((marker) => productionWorkerDeployBlock.indexOf(marker))
  if (
    productionWorkerMutationMarkers.some((position) => position < 0)
    || productionWorkerMutationMarkers.some((position, index) => index > 0 && position <= productionWorkerMutationMarkers[index - 1])
    || !productionWorkerDeployBlock.includes('WRANGLER_OUTPUT_FILE_PATH: ${{ runner.temp }}/burillab-production-worker-deploy.jsonl')
    || !productionWorkerDeployBlock.includes('--config workers/storage-backup/wrangler.production.jsonc')
    || productionWorkerDeployBlock.includes('--secrets-file')
    || !workflowStepBlock(productionWorkflow, 'Verify the active Production storage backup Worker deployment')
      .includes('EXPECTED_WORKER_VERSION_ID: ${{ steps.worker-deploy-command.outputs.worker_version_id }}')
  ) {
    throw new Error('The Production Worker mutation must preserve the existing secret and bind current main, lease, and the newly created version.')
  }
  const productionWorkerOrder = [
    'Validate the supervised Production Worker confirmation',
    'Verify the signed Production Worker lease',
    'Verify the signed Production Worker cleanup receipt',
    'Verify trusted main quality for the Production Worker',
    'Verify the exact cleaned Staging run for the Production Worker',
    'Verify the current production Supabase Advisor state for the Worker',
    'Verify the explicitly requested Production Worker token',
    'Verify Production storage backup remains exactly OFF before Worker deployment',
    'Verify the existing Production Worker secret allow-list before deployment',
    'Recheck Production Worker current main, quality, Staging, and Advisor gates',
    'Recheck the active Production Worker token and OFF switch at the mutation boundary',
    'Recheck the signed Production Worker cleanup and lease at mutation',
    'Deploy the OFF-only Production storage backup Worker',
    'Verify the active Production storage backup Worker deployment',
    'Verify Production storage backup remains exactly OFF after Worker deployment',
    'Record Production storage backup Worker evidence',
    'Record Production Worker cleanup pending before the next lease',
  ].map((marker) => productionWorkflow.indexOf(marker))
  if (
    productionWorkerOrder.some((position) => position < 0)
    || productionWorkerOrder.some((position, index) => index > 0 && position <= productionWorkerOrder[index - 1])
  ) {
    throw new Error('Production backup Worker main-tip, exact-OFF, code-only deploy, active-version, and cleanup gates are out of order.')
  }
  requireImmediateNextStep(
    productionWorkflow,
    'Recheck Production Worker current main, quality, Staging, and Advisor gates',
    'Recheck the active Production Worker token and OFF switch at the mutation boundary',
  )
  requireImmediateNextStep(
    productionWorkflow,
    'Recheck the active Production Worker token and OFF switch at the mutation boundary',
    'Recheck the signed Production Worker cleanup and lease at mutation',
  )
  requireImmediateNextStep(
    productionWorkflow,
    'Recheck the signed Production Worker cleanup and lease at mutation',
    'Deploy the OFF-only Production storage backup Worker',
  )

  const qualityRunVerifier = 'node scripts/verify-github-quality-run.mjs'
  if (productionWorkflow.split(qualityRunVerifier).length - 1 < 2) {
    throw new Error('Production workflow must verify trusted main quality both early and immediately before deployment.')
  }
  const stagingRunVerifier = 'node scripts/verify-github-staging-run.mjs'
  if (productionWorkflow.split(stagingRunVerifier).length - 1 < 2) {
    throw new Error('Production workflow must verify the exact approved Staging run both early and immediately before deployment.')
  }
  const hostedAdvisorCommand = 'npm run security:supabase-advisors:hosted --'
  if (occurrenceCount(stagingWorkflow, hostedAdvisorCommand) !== 4
      || occurrenceCount(productionWorkflow, hostedAdvisorCommand) !== 4) {
    throw new Error('Hosted Advisor checks must run directly before every Pages or optional Worker mutation.')
  }
  if (
    occurrenceCount(productionWorkflow, 'node scripts/cloudflare-api-get.mjs') !== 4
    || occurrenceCount(productionWorkflow, '--include-status false') !== 3
    || occurrenceCount(productionWorkflow, '--include-status true') !== 1
    || occurrenceCount(productionWorkflow, '--url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/') !== 4
    || occurrenceCount(productionWorkflow, 'env -u CLOUDFLARE_API_TOKEN node scripts/read-pages-deployment.mjs') !== 2
    || /Authorization\s*:\s*Bearer|curl\b[^\n]*(?:CLOUDFLARE|TOKEN)|--header\b[^\n]*(?:CLOUDFLARE|TOKEN)/i.test(productionWorkflow)
  ) {
    throw new Error('Every Production Cloudflare API lookup must use only the bounded token-from-environment helper.')
  }
  const approvedStagingRunBlock = workflowStepBlock(
    productionWorkflow,
    'Verify the exact approved Staging workflow succeeded',
  )
  const productionStagingResolverBlock = workflowStepBlock(
    productionWorkflow,
    'Resolve the immutable Staging deployment for this SHA',
  )
  if (
    !approvedStagingRunBlock.includes('id: approved-staging-run')
    || !productionStagingResolverBlock.includes('--not-before "${{ steps.approved-staging-run.outputs.staging_run_started_at }}"')
    || !productionStagingResolverBlock.includes('--not-after "${{ steps.approved-staging-run.outputs.staging_run_updated_at }}"')
    || !productionStagingResolverBlock.includes('--commit-message "${{ steps.approved-staging-run.outputs.staging_commit_message }}"')
  ) {
    throw new Error('Production must bind the approved Staging Pages evidence to the exact cleaned Staging run and lease message.')
  }
  for (const [workflow, resolverName] of [
    [stagingWorkflow, 'Resolve the immutable Staging deployment URL'],
    [productionWorkflow, 'Resolve the exact immutable production deployment'],
  ]) {
    const block = workflowStepBlock(workflow, resolverName)
    for (const required of [
      '--deployment-id "${{ steps.pages-deploy-command.outputs.deployment_id }}"',
      '--deployment-url "${{ steps.pages-deploy-command.outputs.deployment_url }}"',
      '--not-before "${{ steps.pages-deploy-command.outputs.deployment_started_at }}"',
      '--commit-message',
    ]) {
      if (!block.includes(required)) {
        throw new Error(`${resolverName} must bind evidence to the exact just-created Pages deployment ID and unique run/lease marker.`)
      }
    }
  }
  const helperIntegrityLine = `printf '%s  %s\\n' '${PINNED_CLOUDFLARE_HELPER_DIGEST}' scripts/cloudflare-api-get.mjs`
  for (const [workflow, stepNames] of [
    [stagingWorkflow, [
      'Resolve the immutable Staging deployment URL',
      'Verify no unapproved Staging Worker secrets exist before deployment',
      'Verify the active Staging storage backup Worker deployment',
    ]],
    [productionWorkflow, [
      'Resolve the immutable Staging deployment for this SHA',
      'Resolve the exact immutable production deployment',
      'Verify the existing Production Worker secret allow-list before deployment',
      'Verify the active Production storage backup Worker deployment',
    ]],
  ]) {
    for (const stepName of stepNames) {
      const block = workflowStepBlock(workflow, stepName)
      const helperPosition = block.indexOf('node scripts/cloudflare-api-get.mjs')
      if (
        occurrenceCount(block, '/usr/bin/git diff --quiet --exit-code') !== 1
        || occurrenceCount(block, '/usr/bin/git diff --cached --quiet --exit-code') !== 1
        || occurrenceCount(block, helperIntegrityLine) !== 1
        || occurrenceCount(block, '/usr/bin/sha256sum --check --strict') !== 1
        || block.indexOf(helperIntegrityLine) < 0
        || block.indexOf(helperIntegrityLine) >= helperPosition
      ) {
        throw new Error(`${stepName} must recheck the pristine worktree and pinned helper immediately before token use.`)
      }
    }
  }
  const finalGuardOrder = [
    'Recheck the exact commit still passes trusted main quality',
    'Recheck the exact approved Staging workflow still succeeded',
    'Recheck that production still targets the current main tip',
    'Recheck the current production Supabase Advisor state immediately before deployment',
    'Recheck the active production Pages token and deployment inputs at the mutation boundary',
    'Recheck the signed production cleanup receipt at the Pages mutation boundary',
    'Recheck the signed production lease with ten minutes remaining for Pages mutation',
    'Deploy the exact commit to production Pages',
  ].map((marker) => productionWorkflow.indexOf(marker))
  if (finalGuardOrder.some((position) => position < 0)
      || finalGuardOrder.some((position, index) => index > 0 && position <= finalGuardOrder[index - 1])) {
    throw new Error('Production current-state Advisor, quality, Staging-run, main-tip, and Pages deploy guards are out of order.')
  }

  for (const [name, expectedHash] of Object.entries(PINNED_RELEASE_WORKFLOW_SHA256)) {
    if (normalizedWorkflowHash(workflows[name] || '') !== expectedHash) {
      throw new Error(`${name} deployment workflow differs from the fully reviewed command contract.`)
    }
  }

  return { projectCount: 2, requiredServerSecretCount: REQUIRED_SERVER_SECRETS.length }
}

async function main() {
  const workflowFiles = (await readdir('.github/workflows'))
    .filter((name) => /\.ya?ml$/i.test(name))
  const additionalWorkflowEntries = await Promise.all(
    workflowFiles
      .filter((name) => ![
        'deploy-staging.yml',
        'deploy-production.yml',
        'quality.yml',
      ].includes(name))
      .map(async (name) => [name, await readFile(`.github/workflows/${name}`, 'utf8')]),
  )
  const [
    productionRaw,
    stagingRaw,
    stagingWorkflow,
    productionWorkflow,
    qualityWorkflow,
    stagingPlaywrightConfig,
    gate0AccessRoute,
    gate0TargetConfig,
    gate0Spec,
    cloudflareApiHelper,
    githubArtifactDigestHelper,
    wranglerOutputHelper,
    stagingRollbackPreparationHelper,
    stagingStorageBackupAcceptanceHelper,
    stagingStorageBackupAcceptanceConfig,
    storageBackupReadme,
  ] = await Promise.all([
    readFile('wrangler.jsonc', 'utf8'),
    readFile('wrangler.staging.jsonc', 'utf8'),
    readFile('.github/workflows/deploy-staging.yml', 'utf8'),
    readFile('.github/workflows/deploy-production.yml', 'utf8'),
    readFile('.github/workflows/quality.yml', 'utf8'),
    readFile('playwright.staging.config.ts', 'utf8'),
    readFile('scripts/gate0-access-route.mjs', 'utf8'),
    readFile('scripts/gate0-staging-target.mjs', 'utf8'),
    readFile('e2e/gate0/gate0.spec.ts', 'utf8'),
    readFile('scripts/cloudflare-api-get.mjs', 'utf8'),
    readFile('scripts/verify-github-artifact-digest.mjs', 'utf8'),
    readFile('scripts/verify-wrangler-pages-deploy-output.mjs', 'utf8'),
    readFile('scripts/prepare-staging-rollback-verification.mjs', 'utf8'),
    readFile('scripts/staging-storage-backup-acceptance.mjs', 'utf8'),
    readFile('workers/storage-backup/wrangler.acceptance.jsonc', 'utf8'),
    readFile('workers/storage-backup/README.md', 'utf8'),
  ])
  verifyCloudflareApiHelperSource(cloudflareApiHelper)
  if (rawSourceHash(githubArtifactDigestHelper) !== PINNED_GITHUB_ARTIFACT_DIGEST_HELPER_SHA256) {
    throw new Error('GitHub artifact digest helper differs from the fully reviewed archive-binding contract.')
  }
  if (rawSourceHash(wranglerOutputHelper) !== PINNED_WRANGLER_OUTPUT_HELPER_SHA256) {
    throw new Error('Wrangler output helper differs from the fully reviewed exact-deployment contract.')
  }
  if (rawSourceHash(stagingRollbackPreparationHelper) !== PINNED_STAGING_ROLLBACK_PREPARATION_HELPER_SHA256) {
    throw new Error('Staging rollback preparation helper differs from the fully reviewed target-binding contract.')
  }
  if (rawSourceHash(stagingStorageBackupAcceptanceHelper) !== PINNED_STAGING_STORAGE_BACKUP_ACCEPTANCE_HELPER_SHA256) {
    throw new Error('Staging storage-backup acceptance helper differs from the fully reviewed mutation contract.')
  }
  verifyStagingStorageBackupAcceptanceConfig(stagingStorageBackupAcceptanceConfig)
  verifyStorageBackupWorkerTokenDocumentation(storageBackupReadme)
  const result = verifyReleaseConfiguration({
    productionRaw,
    stagingRaw,
    workflows: {
      staging: stagingWorkflow,
      production: productionWorkflow,
      quality: qualityWorkflow,
      ...Object.fromEntries(additionalWorkflowEntries),
    },
    browser: {
      stagingConfig: stagingPlaywrightConfig,
      accessRoute: gate0AccessRoute,
      targetConfig: gate0TargetConfig,
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
