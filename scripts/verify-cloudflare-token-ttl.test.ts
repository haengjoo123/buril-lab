import { describe, expect, it, vi } from 'vitest'
import {
  CLOUDFLARE_TOKEN_MAX_REMAINING_MS,
  verifyCloudflareTokenMetadata,
  verifyCloudflareTokenTtl,
} from './verify-cloudflare-token-ttl.mjs'

const NOW = Date.parse('2026-08-25T03:00:00Z')
const ACCOUNT_ID = 'a'.repeat(32)
const TOKEN_ID = 'b'.repeat(32)

function payload(expiresOffsetMs = 2 * 60 * 60 * 1000) {
  return {
    success: true,
    errors: [],
    messages: [],
    result: {
      id: TOKEN_ID,
      status: 'active',
      expires_on: new Date(NOW + expiresOffsetMs).toISOString(),
      not_before: new Date(NOW - 60_000).toISOString(),
    },
  }
}

describe('Cloudflare ephemeral token TTL verification', () => {
  it('accepts an active token with a bounded expiry', () => {
    expect(verifyCloudflareTokenMetadata(payload(), { now: NOW })).toMatchObject({
      expiresAt: NOW + 2 * 60 * 60 * 1000,
    })
  })

  it('accepts the dashboard date-picker boundary while keeping a hard upper limit', () => {
    expect(verifyCloudflareTokenMetadata(payload(CLOUDFLARE_TOKEN_MAX_REMAINING_MS), { now: NOW }))
      .toMatchObject({ expiresAt: NOW + CLOUDFLARE_TOKEN_MAX_REMAINING_MS })
  })

  it.each([
    [{ ...payload(), success: false }, /successful result/],
    [{ ...payload(), result: { ...payload().result, status: 'disabled' } }, /not active/],
    [{ ...payload(), result: { ...payload().result, expires_on: undefined } }, /expires_on is missing/],
    [payload(30 * 60 * 1000), /expires too soon/],
    [payload(CLOUDFLARE_TOKEN_MAX_REMAINING_MS + 1000), /exceeds 48 hours/],
  ])('rejects unsafe token metadata', (value, message) => {
    expect(() => verifyCloudflareTokenMetadata(value, { now: NOW })).toThrow(message)
  })

  it('falls back from user-token verification to account-token verification without logging the token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    await expect(verifyCloudflareTokenTtl({
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_EPHEMERAL_TOKEN: 'x'.repeat(40),
    }, { now: NOW, fetchImpl: fetchMock })).resolves.toMatchObject({
      expiresAt: NOW + 2 * 60 * 60 * 1000,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
