import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  attestationEnvelopeHash,
  publicKeyFingerprint,
  signAttestation,
  verifySignedAttestation,
} from './ephemeral-release-attestation.mjs'

function keys() {
  return generateKeyPairSync('ed25519')
}

describe('ephemeral release attestations', () => {
  it('signs and verifies an exact Ed25519 payload', () => {
    const { privateKey, publicKey } = keys()
    const payload = {
      kind: 'lease_grant',
      supervisor_key_id: publicKeyFingerprint(publicKey),
      lease_id: 'a'.repeat(32),
    }
    const envelope = signAttestation(payload, privateKey)
    expect(verifySignedAttestation(envelope, publicKey, 'lease_grant')).toMatchObject({
      payload,
      envelopeHash: attestationEnvelopeHash(envelope),
    })
  })

  it('rejects tampering, the wrong key, wrong kind, and non-Ed25519 keys', () => {
    const { privateKey, publicKey } = keys()
    const other = keys()
    const payload = {
      kind: 'cleanup_receipt',
      supervisor_key_id: publicKeyFingerprint(publicKey),
    }
    const envelope = signAttestation(payload, privateKey)
    const parsed = JSON.parse(envelope)
    parsed.payload = Buffer.from(JSON.stringify({ ...payload, changed: true })).toString('base64url')

    expect(() => verifySignedAttestation(JSON.stringify(parsed), publicKey, 'cleanup_receipt'))
      .toThrow(/signature is invalid/)
    expect(() => verifySignedAttestation(envelope, other.publicKey, 'cleanup_receipt'))
      .toThrow(/signature is invalid|pinned supervisor key/)
    expect(() => verifySignedAttestation(envelope, publicKey, 'lease_grant'))
      .toThrow(/must be lease_grant/)

    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    expect(() => publicKeyFingerprint(rsa.publicKey)).toThrow(/must be Ed25519/)
    expect(() => signAttestation(payload, rsa.privateKey)).toThrow(/must be Ed25519/)
  })

  it('rejects non-canonical or oversized envelopes', () => {
    const { privateKey, publicKey } = keys()
    const payload = {
      kind: 'cleanup_receipt',
      supervisor_key_id: publicKeyFingerprint(publicKey),
    }
    const envelope = signAttestation(payload, privateKey)
    expect(() => verifySignedAttestation(` ${envelope}`, publicKey, 'cleanup_receipt'))
      .toThrow(/surrounding whitespace/)
    expect(() => verifySignedAttestation('x'.repeat(50 * 1024), publicKey, 'cleanup_receipt'))
      .toThrow(/oversized/)

    expect(() => signAttestation({
      kind: 'cleanup_receipt',
      supervisor_key_id: publicKeyFingerprint(publicKey),
      padding: 'x'.repeat(37 * 1024),
    }, privateKey)).toThrow(/envelope is oversized/)
  })
})
