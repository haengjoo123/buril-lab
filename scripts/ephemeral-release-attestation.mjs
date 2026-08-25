import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto'

const ENVELOPE_VERSION = 1
export const MAX_ATTESTATION_ENVELOPE_BYTES = 48 * 1024
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has unexpected or missing fields.`)
  }
}

function decodeBase64Url(value, label, maximumBytes) {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) {
    throw new Error(`${label} is not canonical base64url.`)
  }
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length === 0 || bytes.length > maximumBytes || bytes.toString('base64url') !== value) {
    throw new Error(`${label} is empty, oversized, or non-canonical.`)
  }
  return bytes
}

export function publicKeyFingerprint(publicKeyInput) {
  let key
  try {
    key = publicKeyInput?.type === 'public' ? publicKeyInput : createPublicKey(publicKeyInput)
  } catch {
    throw new Error('Ephemeral release public key is invalid.')
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Ephemeral release public key must be Ed25519.')
  }
  const der = key.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex')
}

export function attestationEnvelopeHash(rawEnvelope) {
  if (typeof rawEnvelope !== 'string' || rawEnvelope.length === 0 || Buffer.byteLength(rawEnvelope, 'utf8') > MAX_ATTESTATION_ENVELOPE_BYTES) {
    throw new Error('Ephemeral release attestation envelope is missing or oversized.')
  }
  return createHash('sha256').update(rawEnvelope, 'utf8').digest('hex')
}

export function verifySignedAttestation(rawEnvelope, publicKeyInput, expectedKind) {
  if (typeof rawEnvelope !== 'string' || rawEnvelope.length === 0 || Buffer.byteLength(rawEnvelope, 'utf8') > MAX_ATTESTATION_ENVELOPE_BYTES) {
    throw new Error('Ephemeral release attestation envelope is missing or oversized.')
  }
  if (rawEnvelope !== rawEnvelope.trim()) {
    throw new Error('Ephemeral release attestation envelope must not contain surrounding whitespace.')
  }
  let envelope
  try {
    envelope = JSON.parse(rawEnvelope)
  } catch {
    throw new Error('Ephemeral release attestation envelope is not valid JSON.')
  }
  exactKeys(envelope, ['version', 'algorithm', 'payload', 'signature'], 'Ephemeral release attestation envelope')
  if (envelope.version !== ENVELOPE_VERSION || envelope.algorithm !== 'Ed25519') {
    throw new Error('Ephemeral release attestation envelope version or algorithm is not approved.')
  }
  const payloadBytes = decodeBase64Url(envelope.payload, 'Ephemeral release attestation payload', MAX_ATTESTATION_ENVELOPE_BYTES)
  const signatureBytes = decodeBase64Url(envelope.signature, 'Ephemeral release attestation signature', 64)
  if (signatureBytes.length !== 64) throw new Error('Ephemeral release attestation signature has the wrong length.')

  let publicKey
  try {
    publicKey = publicKeyInput?.type === 'public' ? publicKeyInput : createPublicKey(publicKeyInput)
  } catch {
    throw new Error('Ephemeral release public key is invalid.')
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Ephemeral release public key must be Ed25519.')
  }
  if (!verify(null, payloadBytes, publicKey, signatureBytes)) {
    throw new Error('Ephemeral release attestation signature is invalid.')
  }

  let payload
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'))
  } catch {
    throw new Error('Ephemeral release attestation payload is not valid JSON.')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.kind !== expectedKind) {
    throw new Error(`Ephemeral release attestation payload must be ${expectedKind}.`)
  }
  const fingerprint = publicKeyFingerprint(publicKey)
  if (payload.supervisor_key_id !== fingerprint) {
    throw new Error('Ephemeral release attestation was not bound to the pinned supervisor key.')
  }
  return Object.freeze({
    payload,
    envelopeHash: attestationEnvelopeHash(rawEnvelope),
    supervisorKeyId: fingerprint,
  })
}

export function signAttestation(payload, privateKeyInput) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Ephemeral release attestation payload must be an object.')
  }
  let privateKey
  try {
    privateKey = privateKeyInput?.type === 'private' ? privateKeyInput : createPrivateKey(privateKeyInput)
  } catch {
    throw new Error('Ephemeral release private key is invalid.')
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Ephemeral release private key must be Ed25519.')
  }
  const publicKey = createPublicKey(privateKey)
  const expectedKeyId = publicKeyFingerprint(publicKey)
  if (payload.supervisor_key_id !== expectedKeyId) {
    throw new Error('Ephemeral release payload does not match the signing key.')
  }
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8')
  if (payloadBytes.length === 0 || payloadBytes.length > MAX_ATTESTATION_ENVELOPE_BYTES) {
    throw new Error('Ephemeral release attestation payload is oversized.')
  }
  const signature = sign(null, payloadBytes, privateKey)
  const envelope = JSON.stringify({
    version: ENVELOPE_VERSION,
    algorithm: 'Ed25519',
    payload: payloadBytes.toString('base64url'),
    signature: signature.toString('base64url'),
  })
  if (Buffer.byteLength(envelope, 'utf8') > MAX_ATTESTATION_ENVELOPE_BYTES) {
    throw new Error('Ephemeral release attestation envelope is oversized.')
  }
  return envelope
}

export { exactKeys }
