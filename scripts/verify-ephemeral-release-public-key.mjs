import { createPublicKey } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { publicKeyFingerprint } from './ephemeral-release-attestation.mjs'

export const PINNED_EPHEMERAL_RELEASE_PUBLIC_KEY_FINGERPRINT = 'b5fc8397c8eeb2e2a16b1ffc0feb0b0563f76302ee7b78c08b754651ae455cb2'

export function verifyEphemeralReleasePublicKey(
  pem,
  expectedFingerprint = PINNED_EPHEMERAL_RELEASE_PUBLIC_KEY_FINGERPRINT,
) {
  if (typeof pem !== 'string' || pem.length === 0 || Buffer.byteLength(pem, 'utf8') > 8 * 1024) {
    throw new Error('Pinned ephemeral release public key is missing or oversized.')
  }
  const platformCanonicalPem = pem.replace(/\r\n/g, '\n')
  let key
  try {
    key = createPublicKey(platformCanonicalPem)
  } catch {
    throw new Error('Pinned ephemeral release public key is invalid.')
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Pinned ephemeral release public key must be Ed25519.')
  }
  const canonicalPem = key.export({ type: 'spki', format: 'pem' })
  if (platformCanonicalPem !== canonicalPem) {
    throw new Error('Pinned ephemeral release public key must use canonical PEM encoding.')
  }
  const fingerprint = publicKeyFingerprint(key)
  if (fingerprint !== expectedFingerprint) {
    throw new Error('Pinned ephemeral release public key fingerprint differs from the reviewed key.')
  }
  return fingerprint
}

async function main() {
  const pem = await readFile('config/ephemeral-release-public-key.pem', 'utf8')
  const fingerprint = verifyEphemeralReleasePublicKey(pem)
  console.log(`Pinned ephemeral release public key passed (${fingerprint}).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Pinned ephemeral release public-key verification failed.')
    process.exitCode = 1
  })
}
