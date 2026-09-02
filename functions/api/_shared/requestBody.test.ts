import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readLimitedFormData, readLimitedJson, readLimitedRequestBytes,
  REQUEST_BODY_TIMEOUT_MS, RequestBodyError, requestBodyErrorResponse,
} from './requestBody'

function streamingRequest(body: ReadableStream<Uint8Array>, headers?: HeadersInit) {
  return new Request('https://example.com/api/test', {
    method: 'POST', body, headers, duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

afterEach(() => vi.useRealTimers())

describe('bounded request body reading', () => {
  it('rejects an oversized declared body before acquiring its reader', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', body: 'small', headers: { 'Content-Length': '101' },
    })
    const readerSpy = vi.spyOn(request.body!, 'getReader')
    await expect(readLimitedRequestBytes(request, 100)).rejects.toMatchObject({ status: 413 })
    expect(readerSpy).not.toHaveBeenCalled()
  })

  it.each(['-1', '1.5', 'NaN', '1e3', '12,12'])('rejects invalid Content-Length %s', async (value) => {
    const request = new Request('https://example.com', {
      method: 'POST', body: 'ok', headers: { 'Content-Length': value },
    })
    await expect(readLimitedRequestBytes(request, 100)).rejects.toMatchObject({ status: 400 })
  })

  it.each([undefined, { 'Content-Length': '1' }])('bounds streamed bytes regardless of declared length: %#', async (headers) => {
    const cancel = vi.fn()
    const request = streamingRequest(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4))
        controller.enqueue(new Uint8Array(4))
      }, cancel,
    }), headers)
    await expect(readLimitedRequestBytes(request, 7)).rejects.toMatchObject({ status: 413 })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('accepts exactly the byte limit and preserves binary bytes across tiny chunks', async () => {
    const expected = new Uint8Array(40_000).map((_, i) => i % 256)
    let offset = 0
    const request = streamingRequest(new ReadableStream({
      pull(controller) {
        if (offset === expected.length) controller.close()
        else controller.enqueue(expected.slice(offset, ++offset))
      },
    }))
    await expect(readLimitedRequestBytes(request, expected.length)).resolves.toEqual(expected)
  })

  it('counts UTF-8 bytes rather than JavaScript characters', async () => {
    const request = new Request('https://example.com', { method: 'POST', body: '한글' })
    await expect(readLimitedRequestBytes(request, 5)).rejects.toMatchObject({ status: 413 })
  })

  it('ends a stalled body read and cancels the reader', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const request = streamingRequest(new ReadableStream({ cancel }))
    const result = readLimitedRequestBytes(request, 100).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(REQUEST_BODY_TIMEOUT_MS)
    expect(await result).toMatchObject({ status: 408, code: 'REQUEST_BODY_TIMEOUT' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('returns generic JSON errors without fragments from a malformed payload', async () => {
    const request = new Request('https://example.com', { method: 'POST', body: '{PRIVATE_PAYLOAD' })
    const error = await readLimitedJson(request, 100).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(RequestBodyError)
    const response = requestBodyErrorResponse(error as RequestBodyError)
    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.text()).resolves.not.toContain('PRIVATE_PAYLOAD')
  })

  it('rejects malformed multipart input as a client error', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', body: 'broken', headers: { 'Content-Type': 'multipart/form-data; boundary=missing' },
    })
    await expect(readLimitedFormData(request, 100)).rejects.toMatchObject({ status: 400 })
  })
})
