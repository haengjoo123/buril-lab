import { describe, expect, it } from 'vitest'
import {
  PINNED_EPHEMERAL_RELEASE_PUBLIC_KEY_FINGERPRINT,
  verifyEphemeralReleasePublicKey,
} from './verify-ephemeral-release-public-key.mjs'

const PINNED_PEM = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA8thUmYpmK9ffwny2Axmo95ruJiUX+G181nmu+Ahz1i8=\n-----END PUBLIC KEY-----\n'

describe('pinned ephemeral release public key', () => {
  it('accepts only the reviewed canonical Ed25519 public key', () => {
    expect(verifyEphemeralReleasePublicKey(PINNED_PEM))
      .toBe(PINNED_EPHEMERAL_RELEASE_PUBLIC_KEY_FINGERPRINT)
  })

  it('rejects a changed or non-canonical key', () => {
    expect(() => verifyEphemeralReleasePublicKey(PINNED_PEM.replace('8thU', '8thV')))
      .toThrow('fingerprint differs')
    expect(() => verifyEphemeralReleasePublicKey(PINNED_PEM.trim()))
      .toThrow('canonical')
  })
})
