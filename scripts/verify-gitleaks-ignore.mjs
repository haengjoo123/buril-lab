import { readFile } from 'node:fs/promises'

const EXACT_FINGERPRINT = /^[0-9a-f]{40}:[^:\r\n]+:[a-z0-9][a-z0-9_-]*:[1-9][0-9]*$/

const source = await readFile(new URL('../.gitleaksignore', import.meta.url), 'utf8')
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

console.log(`Verified ${fingerprints.length} exact Gitleaks fingerprints.`)
