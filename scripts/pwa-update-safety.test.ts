import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')

describe('PWA update safety', () => {
  it('activates deployed application updates automatically', () => {
    expect(viteConfig).toContain("registerType: 'autoUpdate'")
    expect(viteConfig).toContain('cleanupOutdatedCaches: true')
  })

  it('never replaces operational endpoints with the cached SPA shell', () => {
    expect(viteConfig).toContain("/^\\/api(?:\\/|$)/")
    expect(viteConfig).toContain("/^\\/release\\.json$/")
    expect(viteConfig).toContain("/^\\/sw\\.js$/")
    expect(viteConfig).toContain("/^\\/cdn-cgi(?:\\/|$)/")
  })
})
