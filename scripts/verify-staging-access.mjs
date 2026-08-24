import { pathToFileURL } from 'node:url'

const STAGING_FIXED_HOSTS = new Set([
  'staging.burillab.com',
  'buril-lab-staging.pages.dev',
])
const STAGING_PAGES_SUFFIX = 'buril-lab-staging.pages.dev'

export function isApprovedStagingHostname(hostname) {
  if (STAGING_FIXED_HOSTS.has(hostname)) return true
  const labels = hostname.split('.')
  return (
    labels.length === 4
    && labels.slice(1).join('.') === STAGING_PAGES_SUFFIX
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(labels[0])
  )
}

export function verifyStagingAccessChallenge({ status, location }) {
  if (status === 401 || status === 403) return true
  if (![301, 302, 303, 307, 308].includes(status) || !location) {
    throw new Error('Staging is reachable without a Cloudflare Access challenge.')
  }

  let redirect
  try {
    redirect = new URL(location)
  } catch {
    throw new Error('Staging Access challenge returned an invalid redirect.')
  }
  if (redirect.protocol !== 'https:' || !redirect.hostname.endsWith('.cloudflareaccess.com')) {
    throw new Error('Staging challenge did not redirect to Cloudflare Access.')
  }
  return true
}

export async function verifyStagingAccessProtection(url, fetchImplementation = fetch) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !isApprovedStagingHostname(parsed.hostname)) {
    throw new Error('Access probe is restricted to approved BurilLab Staging hostnames.')
  }

  const response = await fetchImplementation(parsed, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  try {
    return verifyStagingAccessChallenge({
      status: response.status,
      location: response.headers.get('location'),
    })
  } finally {
    await response.body?.cancel()
  }
}

async function main() {
  const url = process.argv[2]
  if (!url) throw new Error('Usage: node scripts/verify-staging-access.mjs <https://staging.burillab.com/...>')
  await verifyStagingAccessProtection(url)
  console.log(`Cloudflare Access challenge verified for ${new URL(url).hostname}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Staging Access verification failed.')
    process.exitCode = 1
  })
}
