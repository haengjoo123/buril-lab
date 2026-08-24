import { defineConfig, devices } from '@playwright/test'
import { resolveStagingGate0Target } from './scripts/gate0-staging-target.mjs'

const required = [
  'GATE0_BASE_URL',
  'GATE0_E2E_EMAIL',
  'GATE0_E2E_PASSWORD',
  'GATE0_EXPECTED_COMMIT_SHA',
  'GATE0_EXPECTED_DEPLOYMENT_ID',
  'GATE0_STAGING_TARGET_CONFIRMATION',
  'STAGING_ACCESS_CLIENT_ID',
  'STAGING_ACCESS_CLIENT_SECRET',
] as const
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`Staging Gate0 tests require ${name}.`)
}
const gate0Target = resolveStagingGate0Target(process.env)

export default defineConfig({
  testDir: './e2e/gate0',
  testMatch: 'gate0.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: 'output/playwright/gate0-staging/internal/test-results',
  reporter: [['list']],
  use: {
    baseURL: gate0Target.origin,
    serviceWorkers: 'block',
    // Access headers are installed by the Gate0 spec only on the exact
    // approved Staging origins. Context-wide headers would reach Supabase.
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  }],
})
