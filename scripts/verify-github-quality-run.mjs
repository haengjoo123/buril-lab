import { pathToFileURL } from 'node:url'

const MAX_RESPONSE_BYTES = 1024 * 1024
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/

export function findTrustedQualityRun(runs, { repository, commitSha }) {
  if (!Array.isArray(runs)) throw new Error('GitHub quality-run response is malformed.')
  const run = runs.find((candidate) => (
    candidate?.conclusion === 'success'
    && candidate?.event === 'push'
    && candidate?.head_branch === 'main'
    && candidate?.head_sha === commitSha
    && candidate?.head_repository?.full_name === repository
  ))
  if (!run) throw new Error('No successful trusted main Quality and security run exists for this commit.')
  return run
}

async function readBoundedJson(response) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error('GitHub quality-run response is too large.')
  if (!response.body) throw new Error('GitHub quality-run response is empty.')

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new Error('GitHub quality-run response is too large.')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('GitHub quality-run response is not JSON.')
  }
}

export async function fetchTrustedQualityRun(environment = process.env) {
  const token = environment.GITHUB_TOKEN?.trim()
  const repository = environment.GITHUB_REPOSITORY?.trim()
  const commitSha = environment.DEPLOY_COMMIT_SHA?.trim()
  if (!token || !repository || !commitSha) throw new Error('GitHub quality verification inputs are missing.')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY is malformed.')
  }
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('DEPLOY_COMMIT_SHA must be a lowercase, full 40-character Git SHA.')
  }

  const endpoint = new URL(
    `/repos/${repository}/actions/workflows/quality.yml/runs`,
    'https://api.github.com',
  )
  endpoint.searchParams.set('head_sha', commitSha)
  endpoint.searchParams.set('status', 'completed')
  endpoint.searchParams.set('per_page', '100')

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`GitHub quality-run lookup failed with HTTP ${response.status}.`)
  const payload = await readBoundedJson(response)
  return findTrustedQualityRun(payload.workflow_runs, { repository, commitSha })
}

async function main() {
  const run = await fetchTrustedQualityRun()
  console.log(`Verified trusted Quality and security run ${run.id} for ${run.head_sha}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'GitHub quality-run verification failed.')
    process.exitCode = 1
  })
}
