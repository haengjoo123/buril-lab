import { describe, expect, it } from 'vitest'
import { assertIsolatedClientSource, localBoundaryChildEnvironment, validateBoundaryPort } from './pages-boundary-local.mjs'

describe('isolated Pages runtime harness', () => {
  it.each([0, 4173, 65535, '4173'])('accepts a bounded loopback port: %s', (port) => {
    expect(validateBoundaryPort(port)).toBe(Number(port))
  })

  it.each([-1, 65536, 1.5, NaN, Infinity, '', ' ', '4e3', '4173 --remote', null, undefined, true])(
    'rejects malformed ports rather than forwarding command arguments: %s', (port) => {
      expect(() => validateBoundaryPort(port)).toThrow('local Pages boundary port')
    },
  )

  it('does not inherit provider tokens, hosted DBs, proxies, or Node preload settings', () => {
    const env = localBoundaryChildEnvironment({
      Path: 'test-runtime', SYSTEMROOT: 'test-system', TEMP: 'test-temp',
      CLOUDFLARE_API_TOKEN: 'fixture', SUPABASE_ACCESS_TOKEN: 'fixture',
      SUPABASE_SERVICE_ROLE_KEY: 'fixture', SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      UPSTASH_REDIS_REST_TOKEN: 'fixture', OPENAI_API_KEY: 'fixture',
      NODE_OPTIONS: '--require unreviewed.js', HTTPS_PROXY: 'https://proxy.invalid',
      GITHUB_TOKEN: 'fixture', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'true',
    })
    expect(env).toEqual({
      Path: 'test-runtime', SYSTEMROOT: 'test-system', TEMP: 'test-temp',
      CI: 'true', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false',
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    })
  })

  it.each(['https://fixture.supabase.co', 'https://fixture.supabase.in', 'http://fixture.supabase.co'])(
    'refuses hosted Supabase browser bundles even when a quality marker also exists: %s', (url) => {
    expect(() => assertIsolatedClientSource(`https://quality.invalid; endpoint=${url};`)).toThrow('hosted Supabase')
    },
  )

  it('accepts the non-routable quality fixture', () => {
    expect(() => assertIsolatedClientSource('endpoint="https://quality.invalid"')).not.toThrow()
  })
})
