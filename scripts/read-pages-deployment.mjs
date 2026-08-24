import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isApprovedStagingHostname } from './verify-staging-access.mjs'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const DEPLOYMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
  return deployment?.deployment_trigger?.metadata?.commit_hash
    || deployment?.source?.config?.commit_hash
    || deployment?.commit_hash
    || null
}

export function findPagesDeployment(payload, commitSha) {
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('Expected deployment commit must be a lowercase, full Git SHA.')
  }
  const deployments = Array.isArray(payload) ? payload : payload?.result
  if (!Array.isArray(deployments)) throw new Error('Pages deployment list has an unexpected shape.')

  const matches = deployments
    .filter((deployment) => deploymentCommit(deployment) === commitSha)
    .sort((left, right) => {
      const rightTime = Date.parse(right.created_on || '')
      const leftTime = Date.parse(left.created_on || '')
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
    })
  const deployment = matches[0]
  if (!deployment) throw new Error('No Pages deployment matches the selected commit SHA.')
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
    || url.hostname === 'buril-lab-staging.pages.dev'
    || !isApprovedStagingHostname(url.hostname)
  ) {
    throw new Error('Pages deployment URL is not an isolated Staging deployment hostname.')
  }

  return {
    id: deployment.id,
    url: url.origin,
    commitSha,
    createdOn: typeof deployment.created_on === 'string' ? deployment.created_on : '',
  }
}

export async function readPagesDeployment({ file, commitSha, outputPath = process.env.GITHUB_OUTPUT }) {
  let deployments
  try {
    deployments = JSON.parse(await readFile(resolve(file), 'utf8'))
  } catch {
    throw new Error('Pages deployment evidence is not valid JSON.')
  }
  const result = findPagesDeployment(deployments, commitSha)
  if (outputPath) {
    await appendFile(outputPath, `deployment_id=${result.id}\ndeployment_url=${result.url}\n`, 'utf8')
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `- Cloudflare deployment ID: \`${result.id}\`\n- Deployment URL: ${result.url}\n`,
      'utf8',
    )
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const file = args.get('file')
  const commitSha = args.get('commit')
  if (!file || !commitSha) {
    throw new Error('Usage: node scripts/read-pages-deployment.mjs --file <json> --commit <sha>')
  }
  const deployment = await readPagesDeployment({ file, commitSha })
  console.log(`Selected Pages deployment ${deployment.id} for ${deployment.commitSha}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Pages deployment evidence failed.')
    process.exitCode = 1
  })
}
