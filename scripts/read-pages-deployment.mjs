import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const MAX_DEPLOYMENT_PAYLOAD_BYTES = 5 * 1024 * 1024
const DEPLOYMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEPLOYMENT_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const DEPLOYMENT_TARGETS = Object.freeze({
  staging: Object.freeze({
    project: 'buril-lab-staging',
    pagesApex: 'buril-lab-staging.pages.dev',
  }),
  production: Object.freeze({
    project: 'buril-lab',
    pagesApex: 'buril-lab.pages.dev',
  }),
})

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name.startsWith('--')) throw new Error(`Unexpected argument: ${name}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
    values.set(name.slice(2), value)
    index += 1
  }
  return values
}

function deploymentCommit(deployment) {
  return deployment?.deployment_trigger?.metadata?.commit_hash || null
}

function deploymentTarget(environment, project) {
  const target = DEPLOYMENT_TARGETS[environment]
  if (!target) throw new Error('Release environment must be staging or production.')
  if (project !== target.project) {
    throw new Error(`Release environment ${environment} must use Pages project ${target.project}.`)
  }
  return target
}

function isImmutablePagesHostname(hostname, pagesApex) {
  const labels = hostname.split('.')
  const apexLabels = pagesApex.split('.')
  return (
    labels.length === apexLabels.length + 1
    && labels.slice(1).join('.') === pagesApex
    && DEPLOYMENT_LABEL_PATTERN.test(labels[0])
  )
}

export function findPagesDeployment(payload, commitSha, {
  environment = 'staging',
  project = DEPLOYMENT_TARGETS[environment]?.project,
} = {}) {
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('Expected deployment commit must be a lowercase, full Git SHA.')
  }
  const target = deploymentTarget(environment, project)
  if (payload && !Array.isArray(payload) && payload.success !== true) {
    throw new Error('Cloudflare Pages deployment query was not successful.')
  }
  const deployments = Array.isArray(payload) ? payload : payload?.result
  if (!Array.isArray(deployments)) throw new Error('Pages deployment list has an unexpected shape.')

  const matches = deployments
    .filter((deployment) => (
      deploymentCommit(deployment) === commitSha
      && deployment?.project_name === target.project
      && deployment?.environment === 'production'
      && deployment?.production_branch === 'main'
      && deployment?.deployment_trigger?.metadata?.branch === 'main'
      && deployment?.latest_stage?.name === 'deploy'
      && deployment?.latest_stage?.status === 'success'
    ))
    .sort((left, right) => {
      const rightTime = Date.parse(right.created_on || '')
      const leftTime = Date.parse(left.created_on || '')
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
    })
  const deployment = matches[0]
  if (!deployment) {
    throw new Error(
      `No successful ${target.project} main/production Pages deployment matches the selected commit SHA.`,
    )
  }
  if (!DEPLOYMENT_ID_PATTERN.test(deployment.id || '')) {
    throw new Error('Pages deployment ID is malformed.')
  }

  let url
  try {
    url = new URL(deployment.url)
  } catch {
    throw new Error('Pages deployment URL is malformed.')
  }
  if (
    url.protocol !== 'https:'
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !isImmutablePagesHostname(url.hostname, target.pagesApex)
    || url.hostname.split('.')[0] !== deployment.short_id
  ) {
    throw new Error(`Pages deployment URL is not an immutable ${target.project} deployment hostname.`)
  }
  const createdTime = Date.parse(deployment.created_on || '')
  if (Number.isNaN(createdTime)) {
    throw new Error('Pages deployment creation time is malformed.')
  }

  return {
    id: deployment.id,
    url: url.origin,
    commitSha,
    createdOn: new Date(createdTime).toISOString(),
    environment,
    pagesEnvironment: 'production',
    project: target.project,
    branch: 'main',
  }
}

async function readBoundedStream(stream) {
  let bytes = 0
  const chunks = []
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > MAX_DEPLOYMENT_PAYLOAD_BYTES) {
      throw new Error('Pages deployment evidence exceeds the permitted size.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function readPagesDeployment({
  file,
  input = process.stdin,
  commitSha,
  environment = 'staging',
  project = DEPLOYMENT_TARGETS[environment]?.project,
  outputPath = process.env.GITHUB_OUTPUT,
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
}) {
  let deployments
  try {
    const raw = file === '-'
      ? await readBoundedStream(input)
      : await readFile(resolve(file), 'utf8')
    deployments = JSON.parse(raw)
  } catch {
    throw new Error('Pages deployment evidence is not valid JSON.')
  }
  const result = findPagesDeployment(deployments, commitSha, { environment, project })
  if (outputPath) {
    await appendFile(
      outputPath,
      [
        `deployment_id=${result.id}`,
        `deployment_url=${result.url}`,
        `deployment_commit_sha=${result.commitSha}`,
        `deployment_project=${result.project}`,
        `deployment_environment=${result.environment}`,
        '',
      ].join('\n'),
      'utf8',
    )
  }
  if (summaryPath) {
    await appendFile(
      summaryPath,
      [
        `### Cloudflare Pages ${result.environment} deployment evidence`,
        '',
        `- Pages project: \`${result.project}\``,
        `- Pages environment / branch: \`${result.pagesEnvironment}\` / \`${result.branch}\``,
        `- Cloudflare deployment ID: \`${result.id}\``,
        `- Immutable deployment URL: ${result.url}`,
        `- Release commit: \`${result.commitSha}\``,
        `- Created at: \`${result.createdOn}\``,
        '',
      ].join('\n'),
      'utf8',
    )
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const file = args.get('file')
  const commitSha = args.get('commit')
  const environment = args.get('environment')
  const project = args.get('project')
  if (!file || !commitSha || !environment || !project) {
    throw new Error(
      'Usage: node scripts/read-pages-deployment.mjs --file <json|-> --commit <sha> --environment <staging|production> --project <name>',
    )
  }
  const deployment = await readPagesDeployment({ file, commitSha, environment, project })
  console.log(`Selected Pages deployment ${deployment.id} for ${deployment.commitSha}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Pages deployment evidence failed.')
    process.exitCode = 1
  })
}
