import { describe, expect, it, vi } from 'vitest'
import {
  verifyActiveSupabasePat,
  verifyInactiveCloudflareToken,
  verifyInactiveSupabasePat,
} from './verify-ephemeral-provider-lifecycle.mjs'

const TOKEN = 'x'.repeat(40)
const PROJECT_REF = 'a'.repeat(20)
const ACCOUNT_ID = 'b'.repeat(32)
const CLOUDFLARE_TOKEN_ID = 'c'.repeat(32)

function cloudflareJson(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function invalidCloudflareTokenResponse() {
  return cloudflareJson({
    success: false,
    errors: [{ code: 1000, message: 'Invalid API Token' }],
    messages: [],
    result: null,
  }, 401)
}

describe('ephemeral provider credential lifecycle', () => {
  it('requires an active Supabase PAT to see the exact project', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: PROJECT_REF }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    await expect(verifyActiveSupabasePat(TOKEN, PROJECT_REF, { fetchImpl: fetchMock }))
      .resolves.toMatchObject({ active: true, projectRef: PROJECT_REF })
    await expect(verifyActiveSupabasePat(TOKEN, 'c'.repeat(20), { fetchImpl: fetchMock }))
      .rejects.toThrow(/cannot read/)
  })

  it('accepts only an exact 401 as Supabase PAT revocation proof', async () => {
    await expect(verifyInactiveSupabasePat(TOKEN, {
      fetchImpl: vi.fn(async () => new Response('', { status: 401 })),
    })).resolves.toMatchObject({ inactive: true })
    for (const status of [200, 403, 429, 500]) {
      await expect(verifyInactiveSupabasePat(TOKEN, {
        fetchImpl: vi.fn(async () => new Response('', { status })),
      })).rejects.toThrow(/exact HTTP 401/)
    }
  })

  it('requires both Cloudflare verify surfaces to reject or disable the token', async () => {
    const inactive = vi.fn(async () => invalidCloudflareTokenResponse())
    await expect(verifyInactiveCloudflareToken(TOKEN, ACCOUNT_ID, { fetchImpl: inactive }))
      .resolves.toMatchObject({ inactive: true })
    expect(inactive).toHaveBeenCalledTimes(2)

    const active = vi.fn(async () => cloudflareJson({
      success: true,
      errors: [],
      messages: [],
      result: { id: CLOUDFLARE_TOKEN_ID, status: 'active' },
    }))
    await expect(verifyInactiveCloudflareToken(TOKEN, ACCOUNT_ID, { fetchImpl: active }))
      .rejects.toThrow(/still active/)

    const transient = vi.fn(async () => new Response('', { status: 503 }))
    await expect(verifyInactiveCloudflareToken(TOKEN, ACCOUNT_ID, { fetchImpl: transient }))
      .rejects.toThrow(/cannot be proven/)

    const forbidden = vi.fn(async () => new Response('', { status: 403 }))
    await expect(verifyInactiveCloudflareToken(TOKEN, ACCOUNT_ID, { fetchImpl: forbidden }))
      .rejects.toThrow(/cannot be proven/)

    for (const status of ['disabled', 'expired']) {
      const inactiveStatus = vi.fn(async () => cloudflareJson({
        success: true,
        errors: [],
        messages: [],
        result: { id: CLOUDFLARE_TOKEN_ID, status },
      }))
      await expect(verifyInactiveCloudflareToken(TOKEN, ACCOUNT_ID, { fetchImpl: inactiveStatus }))
        .resolves.toMatchObject({ inactive: true })
    }
  })

  it('rejects every HTTP 400 response instead of treating it as token revocation proof', async () => {
    const responses = [
      () => new Response('', { status: 400 }),
      () => new Response('<html>bad request</html>', {
        status: 400,
        headers: { 'content-type': 'text/html' },
      }),
      () => cloudflareJson({
        success: false,
        errors: [{ code: 1001, message: 'Unrelated request error' }],
        messages: [],
        result: null,
      }, 400),
      () => cloudflareJson({
        success: true,
        errors: [],
        messages: [],
        result: { id: CLOUDFLARE_TOKEN_ID, status: 'disabled' },
      }, 400),
      () => cloudflareJson({
        success: false,
        errors: { code: 1000, message: 'Invalid API Token' },
        messages: [],
        result: null,
      }, 400),
      () => cloudflareJson({
        success: false,
        errors: [{ code: 1000, message: 'Invalid API Token' }],
        messages: [],
        result: null,
      }, 400),
    ]

    for (const response of responses) {
      const fetchMock = vi.fn(async () => response())
      await expect(verifyInactiveCloudflareToken(TOKEN, ACCOUNT_ID, { fetchImpl: fetchMock }))
        .rejects.toThrow(/cannot be proven/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('requires the exact official invalid-token envelope for HTTP 401', async () => {
    const invalidEnvelopes = [
      () => new Response('', { status: 401 }),
      () => new Response('<html>unauthorized</html>', {
        status: 401,
        headers: { 'content-type': 'text/html' },
      }),
      () => cloudflareJson({
        success: false,
        errors: [{ code: 1001, message: 'Other authentication failure' }],
        messages: [],
        result: null,
      }, 401),
      () => cloudflareJson({
        success: true,
        errors: [{ code: 1000, message: 'Invalid API Token' }],
        messages: [],
        result: null,
      }, 401),
      () => cloudflareJson({
        success: false,
        errors: [{ code: 1000, message: 'Invalid API Token', unexpected: true }],
        messages: [],
        result: null,
      }, 401),
    ]

    for (const response of invalidEnvelopes) {
      const fetchMock = vi.fn(async () => response())
      await expect(verifyInactiveCloudflareToken(TOKEN, ACCOUNT_ID, { fetchImpl: fetchMock }))
        .rejects.toThrow()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects malformed successful Cloudflare token status responses', async () => {
    const malformed = vi.fn(async () => cloudflareJson({
      success: true,
      errors: [],
      messages: [],
      result: { status: 'disabled' },
    }))
    await expect(verifyInactiveCloudflareToken(TOKEN, ACCOUNT_ID, { fetchImpl: malformed }))
      .rejects.toThrow(/unrecognized successful response/)
  })
})
