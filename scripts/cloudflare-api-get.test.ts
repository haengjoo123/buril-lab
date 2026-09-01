import { describe, expect, it, vi } from 'vitest'
import { cloudflareApiGet, parseArguments } from './cloudflare-api-get.mjs'

const ACCOUNT_ID = 'a'.repeat(32)
const TOKEN = 'cfut_test_token_material_12345678901234567890'
const URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/buril-lab-staging/deployments?env=production`
const WORKER_DOMAINS_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/domains?service=buril-lab-storage-backup-staging&environment=production`
const PRODUCTION_WORKER_DOMAINS_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/domains?service=buril-lab-storage-backup-production&environment=production`
const PRODUCTION_WORKER_SECRETS_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/buril-lab-storage-backup-production/secrets`

function responseFor(body: BodyInit | null, init?: ResponseInit, responseUrl = URL) {
  const response = new Response(body, init)
  Object.defineProperties(response, {
    redirected: { value: false, configurable: true },
    url: { value: responseUrl, configurable: true },
  })
  return response
}

describe('Cloudflare API GET helper', () => {
  it('accepts only the exact two CLI options', () => {
    expect(parseArguments(['--include-status', 'false', '--url', URL])).toEqual(new Map([
      ['--include-status', 'false'],
      ['--url', URL],
    ]))
    expect(() => parseArguments(['--include-status', 'false', '--url', URL, '--extra', 'value']))
      .toThrow(/requires exactly/)
    expect(() => parseArguments(['--include-status', 'false', '--target', URL]))
      .toThrow(/accepts only/)
  })

  it('keeps authorization in the fetch header and returns bounded JSON', async () => {
    const fetchMock = vi.fn(async () => responseFor('{"success":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const result = await cloudflareApiGet({
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: TOKEN,
    }, URL, { fetchImpl: fetchMock })
    expect(result.body.toString('utf8')).toBe('{"success":true}')
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` })
  })

  it('allows the current Worker custom-domain endpoint and rejects the removed records endpoint', async () => {
    const environment = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: TOKEN }
    const fetchMock = vi.fn(async () => responseFor('{"success":true,"result":[]}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }, WORKER_DOMAINS_URL))

    await expect(cloudflareApiGet(environment, WORKER_DOMAINS_URL, { fetchImpl: fetchMock }))
      .resolves.toMatchObject({ status: 200 })
    await expect(cloudflareApiGet(
      environment,
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/domains/records?page=0&per_page=5&service=buril-lab-storage-backup-staging&environment=production`,
    )).rejects.toThrow(/not an approved read-only release endpoint/)
  })

  it('allows only the exact Production Worker read surfaces added for code-only deployment', async () => {
    const environment = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: TOKEN }
    for (const target of [PRODUCTION_WORKER_DOMAINS_URL, PRODUCTION_WORKER_SECRETS_URL]) {
      const fetchMock = vi.fn(async () => responseFor('{"success":true,"result":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }, target))
      await expect(cloudflareApiGet(environment, target, { fetchImpl: fetchMock }))
        .resolves.toMatchObject({ status: 200 })
    }
    await expect(cloudflareApiGet(
      environment,
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/buril-lab-storage-backup-production/settings`,
    )).rejects.toThrow(/not an approved read-only release endpoint/)
  })

  it('rejects another host, non-JSON, oversized data, and HTTP errors by default', async () => {
    const environment = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: TOKEN }
    await expect(cloudflareApiGet(environment, 'https://example.com/test'))
      .rejects.toThrow(/outside the approved account surface/)
    await expect(cloudflareApiGet(
      environment,
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/members?include=everything`,
    )).rejects.toThrow(/not an approved read-only release endpoint/)
    await expect(cloudflareApiGet(environment, `${URL}&extra=true`))
      .rejects.toThrow(/not an approved read-only release endpoint/)
    await expect(cloudflareApiGet(environment, URL, {
      fetchImpl: vi.fn(async () => responseFor('{}', {
        status: 200,
        headers: { 'content-type': 'text/application/jsonp' },
      })),
    })).rejects.toThrow(/not JSON/)
    await expect(cloudflareApiGet(environment, URL, {
      fetchImpl: vi.fn(async () => responseFor('{"error":true}', {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })),
    })).rejects.toThrow(/HTTP 403/)
  })

  it('sanitizes transport errors and rejects a changed response URL', async () => {
    const environment = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: TOKEN }
    const request = cloudflareApiGet(environment, URL, {
      fetchImpl: vi.fn(async () => {
        throw new Error(`transport leaked ${TOKEN}`)
      }),
    })
    await expect(request).rejects.toThrow('Cloudflare API request could not be completed.')
    await request.catch((error) => {
      expect(String(error)).not.toContain(TOKEN)
    })

    const redirected = responseFor('{"success":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    Object.defineProperties(redirected, {
      redirected: { value: true },
      url: { value: 'https://api.cloudflare.com/unexpected' },
    })
    await expect(cloudflareApiGet(environment, URL, {
      fetchImpl: vi.fn(async () => redirected),
    })).rejects.toThrow(/response URL changed unexpectedly/)
  })

  it('cancels an oversized streamed response', async () => {
    const cancel = vi.fn(async () => undefined)
    const releaseLock = vi.fn()
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(1024 * 1024 + 1) })
        .mockResolvedValue({ done: true, value: undefined }),
      cancel,
      releaseLock,
    }
    const response = {
      redirected: false,
      url: URL,
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { getReader: () => reader, cancel },
    } as unknown as Response
    await expect(cloudflareApiGet({
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: TOKEN,
    }, URL, { fetchImpl: vi.fn(async () => response) })).rejects.toThrow(/oversized/)
    expect(cancel).toHaveBeenCalledOnce()
    expect(releaseLock).toHaveBeenCalledOnce()
  })

  it('sanitizes streamed transport errors and rejects a missing final URL', async () => {
    const environment = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: TOKEN }
    const cancel = vi.fn(async () => undefined)
    const releaseLock = vi.fn()
    const reader = {
      read: vi.fn(async () => {
        throw new Error(`body transport leaked ${TOKEN}`)
      }),
      cancel,
      releaseLock,
    }
    const streamedResponse = {
      redirected: false,
      url: URL,
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { getReader: () => reader, cancel },
    } as unknown as Response
    const request = cloudflareApiGet(environment, URL, {
      fetchImpl: vi.fn(async () => streamedResponse),
    })
    await expect(request).rejects.toThrow('Cloudflare API response could not be read.')
    await request.catch((error) => expect(String(error)).not.toContain(TOKEN))
    expect(cancel).toHaveBeenCalledOnce()
    expect(releaseLock).toHaveBeenCalledOnce()

    const missingFinalUrl = responseFor('{"success":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    Object.defineProperty(missingFinalUrl, 'url', { value: '' })
    await expect(cloudflareApiGet(environment, URL, {
      fetchImpl: vi.fn(async () => missingFinalUrl),
    })).rejects.toThrow(/response URL changed unexpectedly/)
  })

  it('can return an expected HTTP status for a fail-closed response verifier', async () => {
    const result = await cloudflareApiGet({
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: TOKEN,
    }, URL, {
      includeStatus: true,
      fetchImpl: vi.fn(async () => responseFor('{"error":true}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })),
    })
    expect(result.status).toBe(404)
  })
})
