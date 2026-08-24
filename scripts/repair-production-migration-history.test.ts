import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')
const scriptPath = resolve(repoRoot, 'scripts/repair-production-migration-history.ps1')
const snapshot = JSON.parse(
  readFileSync(resolve(repoRoot, 'supabase/legacy_migrations/application-history-before-baseline.json'), 'utf8'),
) as {
  production_project_ref: string
  migrations: Array<{ remote?: string }>
}
const legacyVersions = snapshot.migrations.map((row) => row.remote).filter(Boolean) as string[]
const baselineVersion = '20260824000000'
const legacyHash = 'ff169071822bd12de18c5485473e000aa50ad092ec6544fab25d045a471b113b'
const snapshotHash = 'c72f031e8d459e2db425352d9f97daadecada97e3f0c57060fe2b57217a964d6'

const pwshProbe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
  encoding: 'utf8',
})
const hasPwsh = pwshProbe.status === 0

describe.skipIf(!hasPwsh)('production migration-history repair script', () => {
  let fixtureDirectory = ''
  let statePath = ''

  beforeAll(() => {
    fixtureDirectory = mkdtempSync(resolve(tmpdir(), 'burillab-migration-repair-'))
    statePath = resolve(fixtureDirectory, 'state.json')
    const mockModulePath = resolve(fixtureDirectory, 'mock-npx.mjs')
    writeFileSync(mockModulePath, `
import { readFileSync, writeFileSync } from 'node:fs'
const statePath = process.env.MOCK_MIGRATION_STATE
const args = process.argv.slice(2)
if (args[0] === '--no-install') args.shift()
const state = JSON.parse(readFileSync(statePath, 'utf8'))
if (args[0] !== 'supabase') process.exit(90)
if (args[1] === '--version') {
  console.log('2.115.0')
  process.exit(0)
}
if (args[1] !== 'migration') process.exit(90)
if (args[2] === 'list') {
  console.log(JSON.stringify(state.versions.map((remote) => ({ local: '', remote, time: '' }))))
  process.exit(0)
}
if (args[2] === 'repair') {
  const statusIndex = args.indexOf('--status')
  if (statusIndex < 4) process.exit(91)
  const versions = args.slice(3, statusIndex)
  const status = args[statusIndex + 1]
  const current = new Set(state.versions)
  for (const version of versions) {
    if (status === 'applied') current.add(version)
    else if (status === 'reverted') current.delete(version)
    else process.exit(92)
  }
  state.versions = [...current].sort()
  writeFileSync(statePath, JSON.stringify(state))
  console.log(JSON.stringify({ ok: true }))
  process.exit(0)
}
process.exit(93)
`.trimStart())

    if (process.platform === 'win32') {
      writeFileSync(
        resolve(fixtureDirectory, 'npx.cmd'),
        `@echo off\r\n"${process.execPath}" "${mockModulePath}" %*\r\n`,
      )
    } else {
      const mockExecutable = resolve(fixtureDirectory, 'npx')
      writeFileSync(mockExecutable, `#!/bin/sh\nexec "${process.execPath}" "${mockModulePath}" "$@"\n`)
      chmodSync(mockExecutable, 0o755)
    }
  })

  afterAll(() => {
    if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
  })

  function setVersions(versions: string[]) {
    writeFileSync(statePath, JSON.stringify({ versions }))
  }

  function getVersions() {
    return (JSON.parse(readFileSync(statePath, 'utf8')) as { versions: string[] }).versions
  }

  function run(mode: 'plan' | 'apply' | 'restore-legacy', confirmation = '') {
    const args = [
      '-NoProfile',
      '-File',
      scriptPath,
      '-Mode',
      mode,
      '-ProjectRef',
      snapshot.production_project_ref,
    ]
    if (confirmation) args.push('-Confirmation', confirmation)

    return spawnSync('pwsh', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixtureDirectory}${delimiter}${process.env.PATH || ''}`,
        BURILLAB_PRODUCTION_DB_PASSWORD: 'test-only-password',
        MOCK_MIGRATION_STATE: statePath,
      },
    })
  }

  it('plans only when the remote set is an exact approved state', () => {
    setVersions(legacyVersions)
    const result = run('plan')
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      operation: 'plan',
      changed: false,
      state_before: 'legacy',
      state_after: 'legacy',
      reviewed_legacy_count: 89,
      reviewed_snapshot_sha256: snapshotHash,
      remote_count_before: 89,
    })
    expect(getVersions()).toEqual(legacyVersions)

    setVersions(legacyVersions.slice(1))
    const mismatch = run('plan')
    expect(mismatch.status).not.toBe(0)
    expect(mismatch.stderr).toContain('No repair was attempted')
    expect(getVersions()).toEqual(legacyVersions.slice(1))
  }, 15_000)

  it('applies the marker and restores all 89 legacy rows with exact confirmations', () => {
    setVersions(legacyVersions)
    const apply = run(
      'apply',
      `APPLY BASELINE ${snapshot.production_project_ref} ${legacyHash}`,
    )
    expect(apply.status, apply.stderr).toBe(0)
    expect(JSON.parse(apply.stdout)).toMatchObject({
      state_before: 'legacy',
      state_after: 'baseline',
      changed: true,
      remote_count_after: 1,
    })
    expect(getVersions()).toEqual([baselineVersion])

    const restore = run(
      'restore-legacy',
      `RESTORE LEGACY ${snapshot.production_project_ref} ${legacyHash}`,
    )
    expect(restore.status, restore.stderr).toBe(0)
    expect(JSON.parse(restore.stdout)).toMatchObject({
      state_before: 'baseline',
      state_after: 'legacy',
      changed: true,
      remote_count_after: 89,
    })
    expect(getVersions()).toEqual(legacyVersions)
  }, 15_000)

  it('refuses a mutating mode without its full hash-bound confirmation', () => {
    setVersions(legacyVersions)
    const result = run('apply', `APPLY BASELINE ${snapshot.production_project_ref}`)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Confirmation must exactly match')
    expect(getVersions()).toEqual(legacyVersions)
  }, 15_000)

  it('keeps the database password out of process arguments', () => {
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).toContain("SetEnvironmentVariable('SUPABASE_DB_PASSWORD'")
    expect(source).not.toContain("'--password'")
    expect(source).toContain("'--output-format', 'json'")
    expect(source).toContain("npx '--no-install'")
    expect(source).toContain("$expectedSupabaseCliVersion = '2.115.0'")
    expect(source).not.toContain("'db', 'push'")
    expect(source).not.toContain("'db', 'reset'")
  })
})
