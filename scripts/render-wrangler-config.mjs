import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PLACEHOLDER_PATTERN = /__([A-Z][A-Z0-9_]*)__/g
const CLOUDFLARE_ID_PATTERN = /^[0-9a-f]{32}$/

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name.startsWith('--')) throw new Error(`Unexpected argument: ${name}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
    values.set(name.slice(2), value)
    index += 1
  }
  return values
}

function validateReplacement(name, value) {
  if (!value || /[\r\n\0]/.test(value) || value.includes('__')) {
    throw new Error(`Unsafe or empty value for ${name}.`)
  }
  if (name.endsWith('_KV_ID') && !CLOUDFLARE_ID_PATTERN.test(value)) {
    throw new Error(`${name} must be a lowercase, 32-character Cloudflare namespace ID.`)
  }
}

export function materializeWranglerConfig(source, environment = process.env) {
  const names = [...new Set([...source.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]))]
  if (names.length === 0) throw new Error('Wrangler template contains no materialized placeholders.')

  let rendered = source
  for (const name of names) {
    const value = environment[name]
    validateReplacement(name, value)
    rendered = rendered.replaceAll(`__${name}__`, value)
  }

  if (PLACEHOLDER_PATTERN.test(rendered)) {
    throw new Error('Wrangler template still contains unresolved placeholders.')
  }
  return { rendered, replacementCount: names.length }
}

export async function renderWranglerConfig({ input, output, environment = process.env }) {
  const inputPath = resolve(input)
  const outputPath = resolve(output)
  if (inputPath === outputPath) throw new Error('Refusing to overwrite the committed Wrangler template.')
  if (dirname(inputPath) !== dirname(outputPath)) {
    throw new Error('Generated config must stay beside its template so relative paths remain valid.')
  }

  const source = await readFile(inputPath, 'utf8')
  const result = materializeWranglerConfig(source, environment)
  await writeFile(outputPath, result.rendered, { encoding: 'utf8', mode: 0o600 })
  return { outputPath, replacementCount: result.replacementCount }
}

export async function writePagesDeployRedirect({ config, output }) {
  const configPath = resolve(config)
  const outputPath = resolve(output)
  if (!outputPath.replaceAll('\\', '/').endsWith('/.wrangler/deploy/config.json')) {
    throw new Error('Pages deploy redirect must be written to .wrangler/deploy/config.json.')
  }

  const configSource = await readFile(configPath, 'utf8')
  if (PLACEHOLDER_PATTERN.test(configSource)) {
    throw new Error('Refusing to activate a Wrangler config with unresolved placeholders.')
  }

  let parsedConfig
  try {
    parsedConfig = JSON.parse(configSource)
  } catch {
    throw new Error('Pages deploy config must be valid JSON before redirect activation.')
  }
  if (!parsedConfig || typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) {
    throw new Error('Pages deploy config must contain a top-level JSON object.')
  }

  // Wrangler's .wrangler/deploy/config.json redirect rejects every top-level
  // environment block. Direct Pages deploys use the already-materialized root
  // bindings, so remove preview-only environments from the generated copy.
  const environmentsRemoved = Object.hasOwn(parsedConfig, 'env')
  if (environmentsRemoved) {
    delete parsedConfig.env
    await writeFile(
      configPath,
      `${JSON.stringify(parsedConfig, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  }

  const relativeConfigPath = relative(dirname(outputPath), configPath).replaceAll('\\', '/')
  if (!relativeConfigPath || relativeConfigPath.startsWith('/')) {
    throw new Error('Unable to create a relative Pages deploy config redirect.')
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    `${JSON.stringify({ configPath: relativeConfigPath }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  return { outputPath, configPath, relativeConfigPath, environmentsRemoved }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('input')
  const output = args.get('output')
  const pagesDeployRedirect = args.get('pages-deploy-redirect')
  if (!input || !output) {
    throw new Error('Usage: node scripts/render-wrangler-config.mjs --input <template> --output <generated>')
  }

  const result = await renderWranglerConfig({ input, output })
  if (pagesDeployRedirect) {
    await writePagesDeployRedirect({ config: result.outputPath, output: pagesDeployRedirect })
  }
  console.log(`Wrangler config materialized (${result.replacementCount} protected value(s)).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Wrangler config materialization failed.')
    process.exitCode = 1
  })
}
