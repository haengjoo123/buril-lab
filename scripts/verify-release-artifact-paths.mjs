import { pathToFileURL } from 'node:url'

const MAX_PATH_INPUT_BYTES = 1024 * 1024
const MAX_PATH_COUNT = 100_000

export function verifyReleaseArtifactPath(path) {
  if (typeof path !== 'string' || !path.startsWith('dist/')) {
    throw new Error('Release artifact path must be relative to dist/.')
  }
  if (
    path.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(path)
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('Release artifact path contains an unsafe segment or character.')
  }
  return path
}

export function verifyNulSeparatedReleaseArtifactPaths(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_PATH_INPUT_BYTES) {
    throw new Error('Release artifact path list is empty or oversized.')
  }
  let decoded
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Release artifact paths must be valid UTF-8.')
  }
  if (!decoded.endsWith('\0')) throw new Error('Release artifact path list must be NUL terminated.')
  const paths = decoded.slice(0, -1).split('\0')
  if (paths.length === 0 || paths.length > MAX_PATH_COUNT) {
    throw new Error('Release artifact path count is outside the approved range.')
  }
  for (const path of paths) verifyReleaseArtifactPath(path)
  if (new Set(paths).size !== paths.length) throw new Error('Release artifact path list contains duplicates.')
  return Object.freeze([...paths])
}

async function main() {
  const chunks = []
  let total = 0
  for await (const chunk of process.stdin) {
    total += chunk.byteLength
    if (total > MAX_PATH_INPUT_BYTES) throw new Error('Release artifact path list is oversized.')
    chunks.push(chunk)
  }
  const paths = verifyNulSeparatedReleaseArtifactPaths(Buffer.concat(chunks))
  console.log(`Release artifact paths passed (${paths.length} regular files).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Release artifact path validation failed.')
    process.exitCode = 1
  })
}
