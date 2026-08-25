import { appendFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const MAX_OUTPUT_BYTES = 64 * 1024
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const DEPLOYMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PINNED_WRANGLER_VERSION = '4.125.0'
const TARGETS = Object.freeze({
  staging: Object.freeze({ project: 'buril-lab-staging', apex: 'buril-lab-staging.pages.dev' }),
  production: Object.freeze({ project: 'buril-lab', apex: 'buril-lab.pages.dev' }),
})

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is malformed.`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} fields differ from the pinned Wrangler contract.`)
}

function timestamp(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is missing.`)
  const result = Date.parse(value)
  if (!Number.isFinite(result)) throw new Error(`${label} is invalid.`)
  return result
}

function outputTimestamp(value, label, { started, now }) {
  const result = timestamp(value, label)
  if (result < started - 60_000 || result > now + 60_000) {
    throw new Error(`${label} is outside the deployment time boundary.`)
  }
  return result
}

function immutableUrl(rawUrl, target, deploymentId) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Wrangler deployment URL is malformed.')
  }
  const labels = url.hostname.split('.')
  const apexLabels = target.apex.split('.')
  if (
    url.protocol !== 'https:'
    || url.port
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || labels.length !== apexLabels.length + 1
    || labels.slice(1).join('.') !== target.apex
    || labels[0] !== deploymentId.slice(0, 8)
  ) {
    throw new Error('Wrangler deployment URL is not the exact immutable deployment URL.')
  }
  return url.origin
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} differs from the pinned Wrangler command contract.`)
  }
}

function verifyWranglerSession(session, { commitSha, environment, target, outputWindow }) {
  exactKeys(session, [
    'type', 'version', 'wrangler_version', 'command_line_args', 'log_file_path', 'timestamp',
  ], 'Wrangler session')
  if (
    session.version !== 1
    || session.wrangler_version !== PINNED_WRANGLER_VERSION
    || typeof session.log_file_path !== 'string'
    || session.log_file_path.length === 0
    || session.log_file_path.length > 4096
    || /[\u0000-\u001f\u007f]/.test(session.log_file_path)
  ) {
    throw new Error('Wrangler session does not match the pinned deployment contract.')
  }
  const messagePattern = environment === 'staging'
    ? /^quality-approved staging run [1-9][0-9]* lease [0-9a-f]{32}$/
    : /^approved production run [1-9][0-9]* lease [0-9a-f]{32}$/
  const args = session.command_line_args
  if (!Array.isArray(args) || typeof args[10] !== 'string' || !messagePattern.test(args[10])) {
    throw new Error('Wrangler session deploy message is invalid.')
  }
  exactArray(args, [
    'pages', 'deploy', 'dist',
    '--project-name', target.project,
    '--branch', 'main',
    '--commit-hash', commitSha,
    '--commit-message', args[10],
    '--commit-dirty=false',
    '--no-bundle',
  ], 'Wrangler session command line')
  return outputTimestamp(session.timestamp, 'Wrangler session timestamp', outputWindow)
}

export function verifyWranglerPagesDeployOutput(raw, {
  commitSha,
  environment,
  project,
  startedAt,
  now = Date.now(),
} = {}) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') === 0 || Buffer.byteLength(raw, 'utf8') > MAX_OUTPUT_BYTES) {
    throw new Error('Wrangler structured output is empty or oversized.')
  }
  const target = TARGETS[environment]
  if (!target || project !== target.project || !FULL_SHA_PATTERN.test(commitSha || '')) {
    throw new Error('Wrangler deployment expectation is invalid.')
  }
  const started = timestamp(startedAt, 'Wrangler deployment start time')
  const nowTime = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(nowTime) || started > nowTime + 60_000) throw new Error('Wrangler deployment time boundary is invalid.')
  let entries
  try {
    entries = raw.trimEnd().split('\n').map((line) => JSON.parse(line))
  } catch {
    throw new Error('Wrangler structured output is not valid JSON Lines.')
  }
  if (entries.length !== 3) throw new Error('Wrangler structured output must contain one session and exactly two deployment records.')
  const byType = (type) => entries.filter((entry) => entry?.type === type)
  const sessions = byType('wrangler-session')
  const summaries = byType('pages-deploy')
  const details = byType('pages-deploy-detailed')
  if (sessions.length !== 1 || summaries.length !== 1 || details.length !== 1) {
    throw new Error('Wrangler structured output record types differ from the pinned contract.')
  }
  const session = sessions[0]
  const summary = summaries[0]
  const detailed = details[0]
  const outputWindow = { started, now: nowTime }
  const sessionTime = verifyWranglerSession(session, { commitSha, environment, target, outputWindow })
  exactKeys(summary, ['type', 'version', 'pages_project', 'deployment_id', 'url', 'timestamp'], 'Wrangler Pages summary')
  exactKeys(detailed, [
    'type', 'version', 'pages_project', 'deployment_id', 'url', 'alias', 'environment',
    'production_branch', 'deployment_trigger', 'timestamp',
  ], 'Wrangler Pages detail')
  exactKeys(detailed.deployment_trigger, ['metadata'], 'Wrangler Pages deployment trigger')
  exactKeys(detailed.deployment_trigger.metadata, ['commit_hash'], 'Wrangler Pages deployment metadata')
  if (
    summary.version !== 1
    || detailed.version !== 1
    || summary.pages_project !== target.project
    || detailed.pages_project !== target.project
    || summary.deployment_id !== detailed.deployment_id
    || summary.url !== detailed.url
    || detailed.environment !== 'production'
    || detailed.production_branch !== 'main'
    || detailed.deployment_trigger.metadata.commit_hash !== commitSha
    || !DEPLOYMENT_ID_PATTERN.test(summary.deployment_id || '')
  ) {
    throw new Error('Wrangler structured output does not match the exact deployment request.')
  }
  const summaryTime = outputTimestamp(summary.timestamp, 'Wrangler Pages summary timestamp', outputWindow)
  const detailedTime = outputTimestamp(detailed.timestamp, 'Wrangler Pages detail timestamp', outputWindow)
  if (summaryTime < sessionTime || detailedTime < summaryTime) {
    throw new Error('Wrangler structured output timestamps are out of order.')
  }
  return Object.freeze({
    deploymentId: summary.deployment_id,
    deploymentUrl: immutableUrl(summary.url, target, summary.deployment_id),
    startedAt: new Date(started).toISOString(),
    commitSha,
    environment,
    project: target.project,
  })
}

export async function readWranglerPagesDeployOutput({
  file,
  commitSha,
  environment,
  project,
  startedAt,
  outputPath = process.env.GITHUB_OUTPUT,
  now = Date.now(),
}) {
  const raw = await readFile(file, 'utf8')
  const result = verifyWranglerPagesDeployOutput(raw, { commitSha, environment, project, startedAt, now })
  if (outputPath) {
    await appendFile(outputPath, [
      `deployment_id=${result.deploymentId}`,
      `deployment_url=${result.deploymentUrl}`,
      `deployment_started_at=${result.startedAt}`,
      '',
    ].join('\n'), 'utf8')
  }
  return result
}

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || !value || value.startsWith('--') || values.has(name)) {
      throw new Error('Wrangler output verifier arguments are invalid.')
    }
    values.set(name, value)
  }
  if (values.size !== 5) throw new Error('Wrangler output verifier requires exactly five arguments.')
  return values
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const result = await readWranglerPagesDeployOutput({
    file: args.get('--file'),
    commitSha: args.get('--commit'),
    environment: args.get('--environment'),
    project: args.get('--project'),
    startedAt: args.get('--started-at'),
  })
  console.log(`Verified newly created Pages deployment ${result.deploymentId}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Wrangler deployment output verification failed.')
    process.exitCode = 1
  })
}
