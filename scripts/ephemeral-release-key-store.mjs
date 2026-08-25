import { generateKeyPairSync, createPrivateKey } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const MAX_DPAPI_OUTPUT_BYTES = 64 * 1024
const DPAPI_TIMEOUT_MS = 15_000
const POWERSHELL_PATH = join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)

const DPAPI_COMMANDS = Object.freeze({
  protect: [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Security',
    '$raw = [Console]::In.ReadToEnd()',
    '$bytes = [Convert]::FromBase64String($raw)',
    '$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($protected))',
  ].join('; '),
  unprotect: [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Security',
    '$raw = [Console]::In.ReadToEnd()',
    '$bytes = [Convert]::FromBase64String($raw)',
    '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($plain))',
  ].join('; '),
})

export function defaultEphemeralKeyPath(environment = process.env) {
  const localAppData = environment.LOCALAPPDATA
  if (!localAppData || !isAbsolute(localAppData)) {
    throw new Error('LOCALAPPDATA is unavailable for the protected release key.')
  }
  const base = resolve(localAppData, 'BurilLab', 'credentials')
  const target = resolve(base, 'ephemeral-release-ed25519.pkcs8.dpapi')
  const relationship = relative(base, target)
  if (relationship.startsWith('..') || isAbsolute(relationship)) {
    throw new Error('Protected release key path escaped its credential directory.')
  }
  return target
}

export async function runDpapi(operation, inputBytes, {
  spawnImpl = spawn,
  platform = process.platform,
} = {}) {
  if (platform !== 'win32') throw new Error('BurilLab release-key protection requires Windows DPAPI.')
  if (!Buffer.isBuffer(inputBytes) || inputBytes.length === 0 || inputBytes.length > MAX_DPAPI_OUTPUT_BYTES) {
    throw new Error('DPAPI input is missing or oversized.')
  }
  const command = DPAPI_COMMANDS[operation]
  if (!command) throw new Error('DPAPI operation must be protect or unprotect.')
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl(POWERSHELL_PATH, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    let total = 0
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) rejectPromise(error)
      else resolvePromise(value)
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(new Error('Windows DPAPI operation timed out.'))
    }, DPAPI_TIMEOUT_MS)
    child.on('error', () => finish(new Error('Windows DPAPI process could not start.')))
    child.stdout.on('data', (chunk) => {
      total += chunk.length
      if (total > MAX_DPAPI_OUTPUT_BYTES) {
        child.kill()
        finish(new Error('Windows DPAPI output was oversized.'))
        return
      }
      stdout.push(chunk)
    })
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) {
        finish(new Error('Windows DPAPI operation failed.'))
        return
      }
      const encoded = Buffer.concat(stdout).toString('utf8').trim()
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        finish(new Error('Windows DPAPI output was malformed.'))
        return
      }
      const bytes = Buffer.from(encoded, 'base64')
      if (bytes.length === 0 || bytes.toString('base64') !== encoded) {
        finish(new Error('Windows DPAPI output was non-canonical.'))
        return
      }
      finish(null, bytes)
    })
    child.stdin.end(inputBytes.toString('base64'))
  })
}

export async function generateProtectedEphemeralReleaseKey({
  credentialPath = defaultEphemeralKeyPath(),
  protectImpl = (bytes) => runDpapi('protect', bytes),
} = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' })
  const protectedBytes = await protectImpl(privateDer)
  if (!Buffer.isBuffer(protectedBytes) || protectedBytes.length === 0) {
    throw new Error('Protected release key material is invalid.')
  }
  await mkdir(dirname(credentialPath), { recursive: true })
  await writeFile(credentialPath, protectedBytes, { flag: 'wx', mode: 0o600 })
  return Object.freeze({
    credentialPath,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
  })
}

export async function loadProtectedEphemeralReleaseKey({
  credentialPath = defaultEphemeralKeyPath(),
  unprotectImpl = (bytes) => runDpapi('unprotect', bytes),
} = {}) {
  const protectedBytes = await readFile(credentialPath)
  if (protectedBytes.length === 0 || protectedBytes.length > MAX_DPAPI_OUTPUT_BYTES) {
    throw new Error('Protected release key file is missing or oversized.')
  }
  const privateDer = await unprotectImpl(protectedBytes)
  let privateKey
  try {
    privateKey = createPrivateKey({ key: privateDer, type: 'pkcs8', format: 'der' })
  } catch {
    throw new Error('Protected release key could not be decoded.')
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Protected release key is not Ed25519.')
  }
  return privateKey
}
