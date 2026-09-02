import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')

describe('static response security headers', () => {
  it('adds static protections independently of the API middleware', () => {
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('Referrer-Policy: no-referrer')
    expect(headers).toContain("object-src 'none'")
    expect(headers).toContain("frame-ancestors 'none'")
    expect(headers).not.toContain('Access-Control-Allow-Origin: *')
  })

  it('starts production HSTS at exactly one day without subdomains or preload', () => {
    expect(headers).toContain('https://burillab.com/*\n  Strict-Transport-Security: max-age=86400')
    expect(headers).not.toMatch(/includeSubDomains|preload/)
  })

  it('keeps the release manifest fresh and allows required camera/audio/3D resources', () => {
    expect(headers).toContain('/release.json\n  Cache-Control: no-store')
    expect(headers).toContain('camera=(self), microphone=(self)')
    expect(headers).toContain("worker-src 'self' blob:")
    expect(headers).toContain("media-src 'self' data: blob:")
    expect(headers).toContain('https://raw.githack.com')
    expect(headers).not.toMatch(/script-src[^;]*'unsafe-inline'|script-src[^;]*'unsafe-eval'/)
  })
})
