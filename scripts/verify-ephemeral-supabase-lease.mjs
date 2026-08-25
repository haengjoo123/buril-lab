import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { verifyEphemeralLeaseGrant } from './verify-ephemeral-lease-grant.mjs'

export function verifyEphemeralSupabaseLease(environment, publicKey, { now = Date.now() } = {}) {
  const grant = verifyEphemeralLeaseGrant(environment, publicKey, { now })
  const pat = environment.SUPABASE_ACCESS_TOKEN?.trim()
  if (!pat || pat.length < 20 || /[\r\n\0]/.test(pat)) {
    throw new Error('Ephemeral Supabase PAT is missing or malformed.')
  }
  const actualHash = createHash('sha256').update(pat, 'utf8').digest('hex')
  if (actualHash !== grant.supabasePatSha256) {
    throw new Error('Ephemeral Supabase PAT does not match the signed release lease.')
  }
  return Object.freeze({
    environment: grant.environment,
    commitSha: grant.commitSha,
    leaseId: grant.leaseId,
    expiresAt: grant.expiresAt,
  })
}

async function main() {
  const publicKey = await readFile('config/ephemeral-release-public-key.pem', 'utf8')
  const result = verifyEphemeralSupabaseLease(process.env, publicKey)
  console.log(`Ephemeral Supabase PAT matches the signed ${result.environment} release lease.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Ephemeral Supabase lease verification failed.')
    process.exitCode = 1
  })
}
