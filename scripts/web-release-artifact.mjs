import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { featureProfile } from './web-release.mjs'

const digest = (value) => createHash('sha256').update(value).digest('hex')

export async function artifactFiles(root) {
  const files = []
  let bytes = 0
  async function visit(relative) {
    const stat = await lstat(join(root, relative))
    if (stat.isSymbolicLink()) throw new Error('Release artifacts cannot contain symbolic links.')
    if (stat.isDirectory()) {
      for (const name of (await readdir(join(root, relative))).sort()) {
        if (/[\u0000-\u001f\u007f\\:]/.test(name) || name === '..') throw new Error('Unsafe artifact path.')
        await visit(relative ? `${relative}/${name}` : name)
      }
    } else if (stat.isFile()) {
      bytes += stat.size
      if (bytes > 512 * 1024 * 1024 || files.length >= 20_000) throw new Error('Release artifact exceeds the size limit.')
      files.push({ path: relative, sha256: digest(await readFile(join(root, relative))) })
    } else throw new Error('Release artifacts must contain only regular files and directories.')
  }
  await visit('')
  for (const path of ['index.html', '_worker.js/index.js', '_routes.json', 'release.json']) {
    if (!files.some((file) => file.path === path)) throw new Error(`Release artifact is incomplete: ${path}`)
  }
  return files
}

export async function verifyArtifact(root, manifestPath, expectedDigest) {
  if (!/^[0-9a-f]{64}$/.test(expectedDigest || '')) throw new Error('Expected artifact manifest digest is missing.')
  const raw = await readFile(manifestPath, 'utf8')
  if (digest(raw) !== expectedDigest) throw new Error('Artifact manifest digest mismatch.')
  const files = await artifactFiles(root)
  if (JSON.stringify(files) !== JSON.stringify(JSON.parse(raw))) throw new Error('Artifact files differ from the credential-free build.')
}

async function main() {
  if (process.argv[2] === 'create') {
    await writeFile('dist/web-build-profile.json', JSON.stringify({ commit: process.env.DEPLOY_COMMIT_SHA,
      environment: process.env.DEPLOY_ENVIRONMENT, supabase_url: process.env.VITE_SUPABASE_URL,
      features: featureProfile(process.env) }))
    const raw = `${JSON.stringify(await artifactFiles('dist'))}\n`
    await writeFile('release-artifact.json', raw)
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `manifest_digest=${digest(raw)}\n`)
  } else if (process.argv[2] === 'verify') {
    await verifyArtifact('dist', 'release-artifact.json', process.env.EXPECTED_MANIFEST_DIGEST)
  } else throw new Error('Usage: web-release-artifact.mjs create|verify')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
