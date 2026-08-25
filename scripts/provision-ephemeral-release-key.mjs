import { publicKeyFingerprint } from './ephemeral-release-attestation.mjs'
import { generateProtectedEphemeralReleaseKey } from './ephemeral-release-key-store.mjs'

async function main() {
  const result = await generateProtectedEphemeralReleaseKey()
  console.log(JSON.stringify({
    credential_path: result.credentialPath,
    public_key_fingerprint: publicKeyFingerprint(result.publicKeyPem),
    public_key_pem: result.publicKeyPem,
  }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Ephemeral release key provisioning failed.')
  process.exitCode = 1
})
