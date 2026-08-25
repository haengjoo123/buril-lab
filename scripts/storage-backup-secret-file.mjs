import {
  appendFile,
  chmod,
  lstat,
  mkdtemp,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const SECRET_DIRECTORY_PREFIX = 'burillab-storage-backup-secrets-'
const SECRET_FILE_NAME = 'secrets.json'
const STAGING_PROJECT_REF = 'qpgnomuqdcucjmxrunnw'

function isInside(root, candidate) {
  const child = relative(root, candidate)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function requireSafeText(value, name, { minimum = 1, maximum = 4_096 } = {}) {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || value.length < minimum
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${name} is missing or malformed.`)
  }
  return value
}

function parseBase64UrlJson(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2_048) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not a supported backend credential.')
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid payload')
    return parsed
  } catch {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not a supported backend credential.')
  }
}

export function verifyStagingSupabaseBackendCredential(value) {
  const credential = requireSafeText(value, 'SUPABASE_SERVICE_ROLE_KEY', { minimum: 20 })
  if (/^sb_secret_[A-Za-z0-9_-]{20,512}$/.test(credential)) return credential

  const parts = credential.split('.')
  if (parts.length !== 3 || parts[2].length < 16 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not a supported backend credential.')
  }
  const header = parseBase64UrlJson(parts[0])
  const payload = parseBase64UrlJson(parts[1])
  if (
    header.alg !== 'HS256'
    || header.typ !== 'JWT'
    || payload.iss !== 'supabase'
    || payload.role !== 'service_role'
    || payload.ref !== STAGING_PROJECT_REF
  ) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not the Staging backend credential.')
  }
  return credential
}

async function resolvedRunnerTemp(value) {
  const raw = requireSafeText(value, 'RUNNER_TEMP')
  if (!isAbsolute(raw)) throw new Error('RUNNER_TEMP must be an absolute directory.')
  const root = await realpath(raw)
  const details = await lstat(root)
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error('RUNNER_TEMP must resolve to a real directory.')
  }
  return root
}

async function removeCreatedSecret(secretFile, secretDirectory) {
  if (secretFile) {
    try {
      await unlink(secretFile)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  if (secretDirectory) {
    try {
      await rmdir(secretDirectory)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

export async function createStorageBackupSecretFile({
  runnerTemp,
  serviceRoleKey,
  githubOutput,
}) {
  const root = await resolvedRunnerTemp(runnerTemp)
  const credential = verifyStagingSupabaseBackendCredential(serviceRoleKey)
  let secretDirectory
  let secretFile
  try {
    secretDirectory = await mkdtemp(join(root, SECRET_DIRECTORY_PREFIX))
    if (!isInside(root, secretDirectory)) throw new Error('Temporary secret directory escaped RUNNER_TEMP.')
    await chmod(secretDirectory, 0o700)
    secretFile = join(secretDirectory, SECRET_FILE_NAME)
    await writeFile(
      secretFile,
      JSON.stringify({ SUPABASE_SERVICE_ROLE_KEY: credential }),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    )

    if (githubOutput !== undefined) {
      const output = requireSafeText(githubOutput, 'GITHUB_OUTPUT')
      if (!isAbsolute(output)) throw new Error('GITHUB_OUTPUT must be an absolute file path.')
      await appendFile(output, `secret_file=${secretFile}\n`, 'utf8')
    }
    return { secretFile }
  } catch (error) {
    await removeCreatedSecret(secretFile, secretDirectory)
    throw error
  }
}

export async function cleanupStorageBackupSecretFile({ runnerTemp, secretFile }) {
  if (secretFile === undefined || secretFile === null || secretFile === '') {
    return { removed: false }
  }
  const root = await resolvedRunnerTemp(runnerTemp)
  const rawFile = requireSafeText(secretFile, 'STORAGE_BACKUP_SECRET_FILE')
  if (!isAbsolute(rawFile)) throw new Error('Temporary secret file path must be absolute.')
  const candidate = resolve(rawFile)
  const parent = dirname(candidate)
  if (
    !isInside(root, candidate)
    || basename(candidate) !== SECRET_FILE_NAME
    || !basename(parent).startsWith(SECRET_DIRECTORY_PREFIX)
  ) {
    throw new Error('Refusing to clean a path outside the storage-backup secret boundary.')
  }

  try {
    const parentDetails = await lstat(parent)
    if (!parentDetails.isDirectory() || parentDetails.isSymbolicLink()) {
      throw new Error('Temporary secret directory changed type before cleanup.')
    }
    const actualParent = await realpath(parent)
    if (actualParent !== parent || !isInside(root, actualParent)) {
      throw new Error('Temporary secret directory escaped RUNNER_TEMP before cleanup.')
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { removed: false }
    throw error
  }

  try {
    const fileDetails = await lstat(candidate)
    if (!fileDetails.isFile() || fileDetails.isSymbolicLink()) {
      throw new Error('Temporary secret file changed type before cleanup.')
    }
    await unlink(candidate)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await rmdir(parent)
  return { removed: true }
}

async function main() {
  const command = process.argv[2]
  if (command === 'create') {
    await createStorageBackupSecretFile({
      runnerTemp: process.env.RUNNER_TEMP,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      githubOutput: process.env.GITHUB_OUTPUT,
    })
    console.log('Created an isolated temporary Worker secret file.')
    return
  }
  if (command === 'cleanup') {
    const result = await cleanupStorageBackupSecretFile({
      runnerTemp: process.env.RUNNER_TEMP,
      secretFile: process.env.STORAGE_BACKUP_SECRET_FILE,
    })
    console.log(result.removed ? 'Removed temporary Worker secret material.' : 'No temporary Worker secret material remained.')
    return
  }
  throw new Error('Usage: storage-backup-secret-file.mjs create|cleanup')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Worker secret-file operation failed.')
    process.exitCode = 1
  })
}
