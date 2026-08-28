import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const root = process.cwd()
const distDir = join(root, 'dist')
const allowedClientEnvNames = new Set([
  'BASE_URL',
  'DEV',
  'MODE',
  'PROD',
  'SSR',
  'VITE_AUTH_REDIRECT_URL',
  'VITE_ENABLE_WASTE_V2',
  'VITE_ENABLE_PH_PREDICTION',
  'VITE_ENABLE_CHEMICAL_ENRICHMENT',
  'VITE_ENABLE_SEARCH_ANALYTICS',
  'VITE_INTERNAL_API_BASE_URL',
  'VITE_PUBLIC_APP_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_URL',
])
const envFiles = readdirSync(root)
  .filter((name) => (
    name === '.env'
    || (name.startsWith('.env.') && name !== '.env.example')
    || name === '.dev.vars'
    || (name.startsWith('.dev.vars.') && name !== '.dev.vars.example')
  ))

const serverOnlyNamePatterns = [
  /^(?:VITE_)?(?:GEMINI|GOOGLE_VISION|KOSHA|OPENAI|ANTHROPIC)_API_KEY$/i,
  /^(?:VITE_)?OPENAI_SAFETY_HMAC_SECRET$/i,
  /^(?:VITE_)?SUPABASE_SERVICE_ROLE_KEY$/i,
  /^(?:VITE_)?SUPABASE_JWT_SECRET$/i,
  /^(?:VITE_)?UPSTASH_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)$/i,
]

const knownServerOnlyNames = [
  'GEMINI_API_KEY',
  'GOOGLE_VISION_API_KEY',
  'KOSHA_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_SAFETY_HMAC_SECRET',
  'ANTHROPIC_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'UPSTASH_REDIS_REST_TOKEN',
  'OPS_ADMIN_EMAILS',
  'OPS_ANALYTICS_EXPORT_EMAILS',
  'FEEDBACK_ADMIN_EMAILS',
]

const isServerOnlyName = (name) => serverOnlyNamePatterns.some((pattern) => pattern.test(name))

const parseEnvValue = (rawValue) => {
  const trimmed = rawValue.trim()
  const quote = trimmed[0]
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1)
  }

  return trimmed.replace(/\s+#.*$/, '').trim()
}

const sensitiveByName = new Map()

const rememberSensitiveValue = (name, rawValue) => {
  if (!isServerOnlyName(name)) return
  sensitiveByName.set(name, parseEnvValue(rawValue))
}

for (const [name, value] of Object.entries(process.env)) {
  if (typeof value === 'string') rememberSensitiveValue(name, value)
}

for (const fileName of envFiles) {
  const lines = readFileSync(join(root, fileName), 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (match) rememberSensitiveValue(match[1], match[2])
  }
}

const clientEnvReferenceFiles = [join(root, 'vite.config.ts')]
const visitClientSource = (directory) => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) visitClientSource(path)
    else if (['.ts', '.tsx', '.js', '.jsx'].includes(extname(path))) clientEnvReferenceFiles.push(path)
  }
}
visitClientSource(join(root, 'src'))

const unexpectedClientEnvNames = new Set()
const clientEnvReferencePattern = /import\.meta\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g
for (const path of clientEnvReferenceFiles) {
  const content = readFileSync(path, 'utf8')
  for (const match of content.matchAll(clientEnvReferencePattern)) {
    const name = match[1] || match[2]
    if (!allowedClientEnvNames.has(name)) unexpectedClientEnvNames.add(name)
  }
}

if (unexpectedClientEnvNames.size > 0) {
  throw new Error(
    `Client source references environment entries outside the allowlist: ${[...unexpectedClientEnvNames].sort().join(', ')}`,
  )
}

if (!existsSync(distDir)) {
  throw new Error('dist was not found; run this check after vite build.')
}

const textExtensions = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.map', '.txt'])
const artifacts = []
const visit = (directory) => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) visit(path)
    else if (textExtensions.has(extname(path))) artifacts.push(path)
  }
}
visit(distDir)

const leakedNames = new Set()
const forbiddenIdentifiers = new Set([
  ...knownServerOnlyNames,
  ...knownServerOnlyNames.map((name) => `VITE_${name}`),
  ...sensitiveByName.keys(),
])

const isRealSecretValue = (value) => (
  value.length >= 8
  && !/^(?:replace|example|your[_-]|test[_-]|xxx|null|undefined)/i.test(value)
)

for (const path of artifacts) {
  const content = readFileSync(path, 'utf8')
  for (const name of forbiddenIdentifiers) {
    if (content.includes(name)) leakedNames.add(name)
  }

  for (const [name, value] of sensitiveByName) {
    if (!isRealSecretValue(value)) continue
    const serializedValue = JSON.stringify(value).slice(1, -1)
    if (content.includes(value) || content.includes(serializedValue)) leakedNames.add(name)
  }
}

if (leakedNames.size > 0) {
  throw new Error(`Client build contains server-only environment entries: ${[...leakedNames].sort().join(', ')}`)
}

console.log(
  `Client secret scan passed (${artifacts.length} build artifacts, ${sensitiveByName.size} server-only entries checked).`,
)
