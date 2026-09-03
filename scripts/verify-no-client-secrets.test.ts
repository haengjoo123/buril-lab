import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scanner = path.join(repositoryRoot, 'scripts', 'verify-no-client-secrets.mjs')
const temporaryRoots: string[] = []
const sentinel = 'ops5-client-bundle-leak-sentinel-0123456789'

function makeFixture({ source = '', artifact = 'safe build output' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'burillab-ops5-secret-scan-'))
  temporaryRoots.push(root)
  mkdirSync(path.join(root, 'src'))
  mkdirSync(path.join(root, 'dist'))
  writeFileSync(path.join(root, 'vite.config.ts'), '')
  writeFileSync(path.join(root, 'src', 'entry.ts'), source)
  writeFileSync(path.join(root, 'dist', 'entry.js'), artifact)
  return root
}

function runScanner(root: string) {
  return execFileSync(process.execPath, [scanner], {
    cwd: root,
    encoding: 'utf8',
    env: {
      COMSPEC: process.env.COMSPEC,
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      LAB_JOIN_RATE_LIMIT_SECRET: sentinel,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

afterEach(() => {
  const allowedParent = `${realpathSync(tmpdir())}${path.sep}`.toLowerCase()
  for (const root of temporaryRoots.splice(0)) {
    const resolved = realpathSync(root)
    expect(resolved.toLowerCase().startsWith(allowedParent)).toBe(true)
    expect(path.basename(resolved)).toMatch(/^burillab-ops5-secret-scan-/)
    rmSync(resolved, { recursive: true, force: false })
  }
})

describe('client secret scanner Ops5 coverage', () => {
  it('accepts a clean build while checking the server-only join secret', () => {
    expect(runScanner(makeFixture())).toContain('1 server-only entries checked')
  })

  it.each([
    ['server-only identifier', 'LAB_JOIN_RATE_LIMIT_SECRET'],
    ['client-prefixed identifier', 'VITE_LAB_JOIN_RATE_LIMIT_SECRET'],
    ['resolved server-only value', sentinel],
  ])('rejects a build containing the %s', (_label, artifact) => {
    expect(() => runScanner(makeFixture({ artifact }))).toThrow()
  })

  it('rejects client source that tries to read the join secret', () => {
    expect(() => runScanner(makeFixture({
      source: 'export const leaked = import.meta.env.VITE_LAB_JOIN_RATE_LIMIT_SECRET',
    }))).toThrow()
  })
})
