import { defineConfig, devices } from '@playwright/test'

const DEFAULT_BASE_URL = 'http://127.0.0.1:4173'
const baseUrl = new URL(process.env.GATE0_BASE_URL || DEFAULT_BASE_URL)
const allowedHosts = new Set(['127.0.0.1', 'localhost'])

if (baseUrl.protocol !== 'http:' || !allowedHosts.has(baseUrl.hostname)) {
  throw new Error(`Gate0 browser tests require a loopback HTTP base URL; received ${baseUrl.origin}`)
}
if (baseUrl.username || baseUrl.password || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
  throw new Error('GATE0_BASE_URL must be an origin without credentials, path, query, or fragment.')
}

const webMode = process.env.GATE0_WEB_MODE || 'preview'
if (!['preview', 'dev'].includes(webMode)) {
  throw new Error('GATE0_WEB_MODE must be either preview or dev.')
}

const port = baseUrl.port || '4173'
const isListOnly = process.argv.includes('--list')
if (process.env.CI && !isListOnly && process.env.VITE_ENABLE_CHEMICAL_ENRICHMENT !== 'false') {
  throw new Error('CI must build Gate0 with VITE_ENABLE_CHEMICAL_ENRICHMENT=false.')
}
if (process.env.CI && !isListOnly) {
  const supabaseUrl = new URL(process.env.VITE_SUPABASE_URL || 'https://invalid.example')
  if (!allowedHosts.has(supabaseUrl.hostname)) {
    throw new Error('CI must build Gate0 against a localhost/127.0.0.1 Supabase stack.')
  }
}

const command = webMode === 'dev'
  ? `npm run dev -- --host ${baseUrl.hostname} --port ${port} --strictPort`
  : `npm run preview -- --host ${baseUrl.hostname} --port ${port} --strictPort`

// CI contract: the quality workflow builds the app first with the local
// Supabase URL/key and VITE_ENABLE_CHEMICAL_ENRICHMENT=false, then seeds that
// local stack. This config only starts the already-built preview. Developers
// may explicitly opt into Vite dev mode with GATE0_WEB_MODE=dev.
export default defineConfig({
  testDir: './e2e/gate0',
  testMatch: 'gate0.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: 'output/playwright/gate0/internal/test-results',
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'output/playwright/gate0/internal/report', open: 'never' }]]
    : 'list',
  use: {
    baseURL: baseUrl.origin,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  }],
  webServer: process.env.GATE0_EXTERNAL_WEB_SERVER === 'true'
    ? undefined
    : {
        command,
        url: `${baseUrl.origin}/login`,
        reuseExistingServer: process.env.GATE0_REUSE_SERVER === 'true',
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
        env: {
          ...process.env,
          VITE_ENABLE_CHEMICAL_ENRICHMENT: 'false',
        },
      },
})
