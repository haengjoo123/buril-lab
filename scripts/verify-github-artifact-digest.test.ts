import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { verifyGithubArtifactDigest } from './verify-github-artifact-digest.mjs'

const TOKEN = 'github-token-must-not-appear-in-errors'
const ARTIFACT_ID = '1234567'
const ZIP = Buffer.from('PK\u0003\u0004bounded-test-archive')
const DIGEST = createHash('sha256').update(ZIP).digest('hex')
const SIGNED_URL = 'https://pipelinesghubeus1.blob.core.windows.net/results/archive.zip?sig=redacted'

function redirect(url = SIGNED_URL) {
  return new Response(null, { status: 302, headers: { location: url } })
}

function archive(body: BodyInit = ZIP, headers: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-length': String(ZIP.byteLength),
      ...headers,
    },
  })
}

async function fixture() {
  const runnerTemp = await mkdtemp(join(tmpdir(), 'burillab-artifact-digest-'))
  return {
    runnerTemp,
    environment: {
      GITHUB_TOKEN: TOKEN,
      GITHUB_REPOSITORY: 'haengjoo123/buril-lab',
      EXPECTED_ARTIFACT_ID: ARTIFACT_ID,
      EXPECTED_ARTIFACT_SERVICE_DIGEST: DIGEST,
      RUNNER_TEMP: runnerTemp,
    },
  }
}

describe('GitHub artifact archive digest verifier', () => {
  it('downloads the exact artifact ID, keeps auth off the signed hop, verifies digest, and deletes the archive', async () => {
    const value = await fixture()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(redirect())
      .mockResolvedValueOnce(archive())
    try {
      await expect(verifyGithubArtifactDigest(value.environment, {
        fetchImpl,
        uuid: () => 'fixed',
      })).resolves.toEqual({ artifactId: ARTIFACT_ID, digest: DIGEST })
      expect(String(fetchImpl.mock.calls[0][0])).toBe(
        `https://api.github.com/repos/haengjoo123/buril-lab/actions/artifacts/${ARTIFACT_ID}/zip`,
      )
      expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`)
      expect(String(fetchImpl.mock.calls[1][0])).toBe(SIGNED_URL)
      expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBeUndefined()
      await expect(readdir(value.runnerTemp)).resolves.toEqual([])
    } finally {
      await rm(value.runnerTemp, { recursive: true, force: true })
    }
  })

  it.each([
    'http://pipelinesghubeus1.blob.core.windows.net/results/archive.zip?sig=x',
    'https://blob.core.windows.net/results/archive.zip?sig=x',
    'https://pipelinesghubeus1.blob.core.windows.net/results/archive.zip',
    'https://pipelinesghubeus1.blob.core.windows.net/results/archive.zip?sig=x#fragment',
    'https://evil.example/results/archive.zip?sig=x',
  ])('rejects an unsafe artifact redirect without making a second request', async (url) => {
    const value = await fixture()
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirect(url))
    try {
      await expect(verifyGithubArtifactDigest(value.environment, { fetchImpl }))
        .rejects.toThrow(/redirect|approved signed origin/)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      await rm(value.runnerTemp, { recursive: true, force: true })
    }
  })

  it('fails closed on a digest mismatch and removes the downloaded archive', async () => {
    const value = await fixture()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(redirect())
      .mockResolvedValueOnce(archive())
    try {
      await expect(verifyGithubArtifactDigest({
        ...value.environment,
        EXPECTED_ARTIFACT_SERVICE_DIGEST: '0'.repeat(64),
      }, { fetchImpl, uuid: () => 'mismatch' })).rejects.toThrow(/digest does not match/)
      await expect(readdir(value.runnerTemp)).resolves.toEqual([])
    } finally {
      await rm(value.runnerTemp, { recursive: true, force: true })
    }
  })

  it('rejects invalid type and oversized content length without leaking credentials or redirect URL', async () => {
    const value = await fixture()
    for (const response of [
      archive(ZIP, { 'content-type': 'text/html' }),
      archive(ZIP, { 'content-length': String(512 * 1024 * 1024 + 1) }),
    ]) {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(redirect())
        .mockResolvedValueOnce(response)
      let message = ''
      try {
        await verifyGithubArtifactDigest(value.environment, { fetchImpl })
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).not.toContain(TOKEN)
      expect(message).not.toContain(SIGNED_URL)
      expect(message).toMatch(/content type|size limit/)
    }
    await rm(value.runnerTemp, { recursive: true, force: true })
  })
})
