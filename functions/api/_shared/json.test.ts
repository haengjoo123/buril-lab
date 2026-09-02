import { afterEach, describe, expect, it, vi } from 'vitest'
import { internalErrorResponse, json } from './json'
import { isUuid } from './validation'

afterEach(() => vi.restoreAllMocks())

describe('safe API JSON helpers', () => {
  it('preserves Headers instances instead of dropping their entries', () => {
    const response = json({ ok: true }, { headers: new Headers({ 'Cache-Control': 'no-store' }) })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Type')).toContain('application/json')
  })

  it('never returns or logs a raw provider error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = internalErrorResponse('test.query', {
      code: '42501', message: 'private table: never-expose', details: 'token=never-expose',
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'The service is temporarily unavailable.', code: 'INTERNAL_ERROR' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('never-expose')
    expect(JSON.stringify(log.mock.calls)).toContain('42501')
  })

  it.each([null, undefined, 42, '', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'id.eq.injected', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-extra']) (
    'rejects an invalid UUID input %s', (value) => expect(isUuid(value)).toBe(false),
  )

  it('accepts a valid UUID without permitting additional query syntax', () => {
    expect(isUuid('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe(true)
  })
})
