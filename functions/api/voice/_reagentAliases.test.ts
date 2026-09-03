import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceMatch } from '../../../src/utils/voiceAgent'
import {
  generateAliasesForMatch, resolveCandidateWithOpenAI,
  VOICE_REFERENCE_TIMEOUT_MS, VOICE_REFERENCE_MAX_BYTES,
} from './_reagentAliases'

const originalFetch = globalThis.fetch
const matches: VoiceMatch[] = [
  { source: 'inventory', id: 'one', name: 'Acetone', matchedBy: 'contains' },
  { source: 'inventory', id: 'two', name: 'Acetonitrile', matchedBy: 'contains' },
]

afterEach(() => {
  vi.useRealTimers()
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const referenceMatch: VoiceMatch = {
  source: 'inventory', id: 'reference-fixture', name: 'Water', casNumber: '7732-18-5', matchedBy: 'name_exact',
}
const propertyBody = { PropertyTable: { Properties: [{ CID: 962, Title: 'Water' }] } }
const koshaBody = '<response><body><items><item><casNo>7732-18-5</casNo><chemNameKor>정제수</chemNameKor></item></items></body></response>'

describe('bounded optional voice reference lookups', () => {
  it('preserves valid PubChem and exact-CAS KOSHA aliases without retries or redirects', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(propertyBody))
      .mockResolvedValueOnce(Response.json({ InformationList: { Information: [{ Synonym: ['Aqua', '7732-18-5'] }] } }))
      .mockResolvedValueOnce(new Response(koshaBody))
    vi.stubGlobal('fetch', fetchMock)
    const aliases = await generateAliasesForMatch({ KOSHA_API_KEY: 'test-only-kosha' }, referenceMatch, '0'.repeat(64))
    expect(aliases).toEqual(expect.arrayContaining(['Water', 'Aqua', '정제수']))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toMatchObject({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) })
    }
  })

  it('aborts a stalled header request at the deadline and falls back to existing names', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let receivedSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url, options: RequestInit) => {
      receivedSignal = options.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => receivedSignal?.addEventListener('abort', () => reject(new Error('private upstream detail'))))
    })
    vi.stubGlobal('fetch', fetchMock)
    const pending = generateAliasesForMatch({}, referenceMatch, '0'.repeat(64))
    await vi.advanceTimersByTimeAsync(VOICE_REFERENCE_TIMEOUT_MS)
    await expect(pending).resolves.toContain('Water')
    expect(receivedSignal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls).toEqual([['[voice/aliases] Reference lookup unavailable:', { provider: 'pubchem' }]])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('includes a stalled body and non-settling cancellation in the same bounded lookup', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const pending = generateAliasesForMatch({}, referenceMatch, '0'.repeat(64))
    await vi.advanceTimersByTimeAsync(VOICE_REFERENCE_TIMEOUT_MS)
    await expect(pending).resolves.toContain('Water')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not reset the deadline when headers arrive near its end', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      setTimeout(() => resolve(new Response(new ReadableStream<Uint8Array>())), VOICE_REFERENCE_TIMEOUT_MS - 1)
    })))
    let completed = false
    const pending = generateAliasesForMatch({}, referenceMatch, '0'.repeat(64)).then((value) => { completed = true; return value })
    await vi.advanceTimersByTimeAsync(VOICE_REFERENCE_TIMEOUT_MS - 1)
    expect(completed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toContain('Water')
    expect(completed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a declared oversized response before consuming it', async () => {
    const pull = vi.fn()
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }), {
      headers: { 'content-length': String(VOICE_REFERENCE_MAX_BYTES + 1) },
    })))
    await expect(generateAliasesForMatch({}, referenceMatch, '0'.repeat(64))).resolves.toContain('Water')
    expect(pull).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, '1'])('enforces the actual byte limit when content-length is %s', async (declared) => {
    let chunks = 0
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1
        if (chunks > 2) throw new Error('must not consume another chunk')
        controller.enqueue(new Uint8Array(chunks === 1 ? VOICE_REFERENCE_MAX_BYTES : 1))
      }, cancel,
    }, { highWaterMark: 0 }), { headers: declared ? { 'content-length': declared } : {} })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(generateAliasesForMatch({}, referenceMatch, '0'.repeat(64))).resolves.toContain('Water')
    expect(chunks).toBe(2)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('continues with KOSHA if PubChem is unavailable without retrying PubChem', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(koshaBody))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateAliasesForMatch({ KOSHA_API_KEY: 'test-only-kosha' }, referenceMatch, '0'.repeat(64))).resolves.toContain('정제수')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not attach the Korean name for a different CAS match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(koshaBody.replace('7732-18-5', '67-64-1'))))
    const aliases = await generateAliasesForMatch({ KOSHA_API_KEY: 'test-only-kosha' }, referenceMatch, '0'.repeat(64))
    expect(aliases).toContain('Water')
    expect(aliases).not.toContain('정제수')
  })

  it('does not turn a KOSHA network failure into a failed matched-inventory result or log its key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockRejectedValueOnce(new Error('https://provider.invalid?serviceKey=test-only-kosha&query=private')))
    await expect(generateAliasesForMatch({ KOSHA_API_KEY: 'test-only-kosha' }, referenceMatch, '0'.repeat(64))).resolves.toContain('Water')
    expect(warn.mock.calls).toEqual([['[voice/aliases] Reference lookup unavailable:', { provider: 'kosha' }]])
  })

  it.each([
    { PropertyTable: { Properties: [{ CID: '../other', Title: 'bad' }] } },
    { PropertyTable: { Properties: [{ CID: 962, Title: { private: true } }] } },
  ])('refuses malformed provider identities before a follow-up request', async (data) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(data))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateAliasesForMatch({}, referenceMatch, '0'.repeat(64))).resolves.toContain('Water')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid JSON and UTF-8 without printing the response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('private invalid json'))
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xfe]))))
    await expect(generateAliasesForMatch({}, referenceMatch, '0'.repeat(64))).resolves.toContain('Water')
    await expect(generateAliasesForMatch({}, referenceMatch, '0'.repeat(64))).resolves.toContain('Water')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private invalid json')
    expect(warn.mock.calls).toHaveLength(2)
  })
})

function modelResponse(candidateId: string, confidence: number) {
  return new Response(JSON.stringify({
    id: 'resp_candidate',
    object: 'response',
    status: 'completed',
    model: 'gpt-5.6-luna',
    output: [{
      id: 'msg_candidate',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: JSON.stringify({ candidateId, confidence, queryAliases: ['acetone'] }),
        annotations: [],
      }],
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('ambiguous voice candidate resolution', () => {
  it('keeps an ambiguous candidate unresolved when the model is uncertain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelResponse('', 0.2)))

    await expect(resolveCandidateWithOpenAI(
      { OPENAI_API_KEY: 'test-key' },
      'acetone 계열 시약 어디 있어',
      'ko',
      matches,
      '0'.repeat(64),
    )).resolves.toBeNull()
  })

  it('rejects a candidate id that was not supplied by the inventory query', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelResponse('inventory:other', 0.99)))

    await expect(resolveCandidateWithOpenAI(
      { OPENAI_API_KEY: 'test-key' },
      'acetone',
      'en',
      matches,
      '0'.repeat(64),
    )).resolves.toBeNull()
  })
})
