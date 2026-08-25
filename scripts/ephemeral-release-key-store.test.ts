import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  defaultEphemeralKeyPath,
  generateProtectedEphemeralReleaseKey,
  loadProtectedEphemeralReleaseKey,
  runDpapi,
} from './ephemeral-release-key-store.mjs'

describe('local protected ephemeral release key store', () => {
  it('keeps the default key outside the repository under LOCALAPPDATA', () => {
    const path = defaultEphemeralKeyPath({ LOCALAPPDATA: 'C:\\Users\\operator\\AppData\\Local' })
    expect(path.toLowerCase()).toContain('appdata\\local\\burillab\\credentials')
    expect(path.toLowerCase()).not.toContain('buril-lab-storage-recovery-integration')
  })

  it('round-trips a protected Ed25519 key and refuses overwrite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'burillab-release-key-'))
    const credentialPath = join(directory, 'key.dpapi')
    const identity = async (bytes: Buffer) => Buffer.from(bytes)
    try {
      const created = await generateProtectedEphemeralReleaseKey({ credentialPath, protectImpl: identity })
      expect(created.publicKeyPem).toContain('BEGIN PUBLIC KEY')
      await expect(loadProtectedEphemeralReleaseKey({ credentialPath, unprotectImpl: identity }))
        .resolves.toMatchObject({ asymmetricKeyType: 'ed25519' })
      await expect(generateProtectedEphemeralReleaseKey({ credentialPath, protectImpl: identity }))
        .rejects.toThrow()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform === 'win32')('round-trips a small value with the current Windows account DPAPI', async () => {
    const expected = Buffer.from('burillab-dpapi-round-trip', 'utf8')
    const protectedBytes = await runDpapi('protect', expected)
    await expect(runDpapi('unprotect', protectedBytes)).resolves.toEqual(expected)
  })
})
