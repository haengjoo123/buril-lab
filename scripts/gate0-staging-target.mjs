export const GATE0_STAGING_CUSTOM_ORIGIN = 'https://staging.burillab.com'

const GATE0_STAGING_PAGES_APEX = 'buril-lab-staging.pages.dev'
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const DEPLOYMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DEPLOYMENT_LABEL_PATTERN = /^[0-9a-f]{8}$/

function canonicalGate0Origin(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error('GATE0_BASE_URL must be an exact approved Staging origin.')
  }

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('GATE0_BASE_URL must be an exact approved Staging origin.')
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || parsed.origin !== value
  ) {
    throw new Error('GATE0_BASE_URL must be an exact approved Staging origin.')
  }

  if (parsed.origin === GATE0_STAGING_CUSTOM_ORIGIN) {
    return { origin: parsed.origin, immutableLabel: null }
  }

  const labels = parsed.hostname.split('.')
  const immutable = (
    labels.length === 4
    && labels.slice(1).join('.') === GATE0_STAGING_PAGES_APEX
    && DEPLOYMENT_LABEL_PATTERN.test(labels[0])
  )
  if (!immutable) {
    throw new Error('GATE0_BASE_URL must identify the exact BurilLab Staging custom or immutable deployment origin.')
  }
  return { origin: parsed.origin, immutableLabel: labels[0] }
}

function requireCommitSha(value) {
  if (!FULL_SHA_PATTERN.test(value || '')) {
    throw new Error('GATE0_EXPECTED_COMMIT_SHA must be a lowercase full 40-character Git SHA.')
  }
  return value
}

function requireDeploymentId(value) {
  if (!DEPLOYMENT_ID_PATTERN.test(value || '')) {
    throw new Error('GATE0_EXPECTED_DEPLOYMENT_ID must be a lowercase deployment UUID.')
  }
  return value
}

export function buildStagingGate0TargetConfirmation({ origin, commitSha, deploymentId }) {
  const target = canonicalGate0Origin(origin)
  const canonicalCommitSha = requireCommitSha(commitSha)
  const canonicalDeploymentId = requireDeploymentId(deploymentId)
  if (target.immutableLabel && target.immutableLabel !== canonicalDeploymentId.slice(0, 8)) {
    throw new Error('The immutable Staging hostname must match the deployment UUID prefix.')
  }
  return `RUN GATE0 buril-lab-staging ${canonicalDeploymentId} ${canonicalCommitSha} ${target.origin}`
}

function validatedTarget({ targetOrigin, deploymentId }) {
  const target = canonicalGate0Origin(targetOrigin)
  const canonicalDeploymentId = requireDeploymentId(deploymentId)
  if (target.immutableLabel && target.immutableLabel !== canonicalDeploymentId.slice(0, 8)) {
    throw new Error('The immutable Staging hostname must match the deployment UUID prefix.')
  }
  return target
}

export function stagingGate0AccessRoutePatterns({ targetOrigin, deploymentId }) {
  const target = validatedTarget({ targetOrigin, deploymentId })
  if (!target.immutableLabel) return Object.freeze([`${target.origin}/**`])
  return Object.freeze([
    `${target.origin}/**`,
    `${GATE0_STAGING_CUSTOM_ORIGIN}/api/**`,
  ])
}

export function isStagingGate0AccessRequest({ targetOrigin, deploymentId, requestUrl }) {
  const target = validatedTarget({ targetOrigin, deploymentId })
  let request
  try {
    request = new URL(requestUrl)
  } catch {
    return false
  }
  if (request.username || request.password) return false
  if (request.origin === target.origin) return true
  return Boolean(
    target.immutableLabel
    && request.origin === GATE0_STAGING_CUSTOM_ORIGIN
    && request.pathname.startsWith('/api/')
  )
}

export function resolveStagingGate0Target(environment = process.env) {
  const target = canonicalGate0Origin(environment.GATE0_BASE_URL)
  const commitSha = requireCommitSha(environment.GATE0_EXPECTED_COMMIT_SHA)
  const deploymentId = requireDeploymentId(environment.GATE0_EXPECTED_DEPLOYMENT_ID)
  const expectedConfirmation = buildStagingGate0TargetConfirmation({
    origin: target.origin,
    commitSha,
    deploymentId,
  })
  if (environment.GATE0_STAGING_TARGET_CONFIRMATION !== expectedConfirmation) {
    throw new Error('GATE0_STAGING_TARGET_CONFIRMATION does not match the exact Staging deployment target.')
  }

  return Object.freeze({
    origin: target.origin,
    commitSha,
    deploymentId,
    accessRoutePatterns: stagingGate0AccessRoutePatterns({
      targetOrigin: target.origin,
      deploymentId,
    }),
  })
}
