import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXACT_FINGERPRINT = /^[0-9a-f]{40}:[^:\r\n]+:[a-z0-9][a-z0-9_-]*:[1-9][0-9]*$/

// Human-approved residual risk, not a revoked key or a false positive.
// Fixed dates deliberately cannot be renewed by rerunning CI.
export const TEMPORARY_KOSHA_EXCEPTION = Object.freeze({
  fingerprint: 'eef817db81060fb07dd83a97754be4376b102f60:.env:generic-api-key:1',
  approvedAt: '2026-10-14T03:44:00Z',
  expiresAt: '2026-10-21T03:44:00Z',
})

export function verifyFingerprints(source, now = Date.now()) {
  const fingerprints = source.split(/\r?\n/).filter((line) => line.length > 0)

  if (fingerprints.length === 0) {
    throw new Error('.gitleaksignore must contain reviewed exact fingerprints.')
  }
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw new Error('.gitleaksignore contains a duplicate fingerprint.')
  }
  for (const fingerprint of fingerprints) {
    if (!EXACT_FINGERPRINT.test(fingerprint)) {
      throw new Error('.gitleaksignore may contain only commit:path:rule:line fingerprints.')
    }
  }
  if (fingerprints.includes(TEMPORARY_KOSHA_EXCEPTION.fingerprint)) {
    if (!Number.isFinite(now) || now < Date.parse(TEMPORARY_KOSHA_EXCEPTION.approvedAt)
      || now >= Date.parse(TEMPORARY_KOSHA_EXCEPTION.expiresAt)) {
      throw new Error('Temporary KOSHA history exception is outside its approved 168-hour window. Supplier revocation evidence or renewed human review is required.')
    }
  }
  return fingerprints
}

export function secretVariants(value) {
  const decoded = decodeURIComponent(value)
  return [...new Set([value, decoded, encodeURIComponent(decoded)])]
}

export function assertSecretAbsent(content, variants) {
  if (variants.some(value => content.includes(Buffer.from(value)))) {
    throw new Error('Historical KOSHA credential is present in a current tracked file; temporary exception refused.')
  }
}

export function verifyGitleaksIgnore(root = fileURLToPath(new URL('../', import.meta.url)), now = Date.now()) {
  const fingerprints = verifyFingerprints(readFileSync(path.join(root, '.gitleaksignore'), 'utf8'), now)
  if (fingerprints.includes(TEMPORARY_KOSHA_EXCEPTION.fingerprint)) {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const [commit, filename, , line] = TEMPORARY_KOSHA_EXCEPTION.fingerprint.split(':')
    // Never include the historical line or value in diagnostics or command arguments.
    const historicalLine = git(['show', `${commit}:${filename}`]).split(/\r?\n/)[Number(line) - 1]
    const match = /^VITE_KOSHA_API_KEY\s*=\s*["']?([^"'\s]+)["']?\s*$/.exec(historicalLine ?? '')
    if (!match || match[1].length < 32) throw new Error('Cannot verify the exact historical KOSHA credential.')
    const variants = secretVariants(match[1])
    for (const filename of git(['ls-files', '-z']).split('\0').filter(Boolean)) {
      assertSecretAbsent(readFileSync(path.join(root, filename)), variants)
    }
  }
  return fingerprints.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(`Verified ${verifyGitleaksIgnore()} exact Gitleaks fingerprints and temporary exception validity.`) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
