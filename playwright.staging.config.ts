import { defineConfig, devices } from '@playwright/test'

const STAGING_ORIGIN = 'https://staging.burillab.com'
const baseUrl = process.env.GATE0_BASE_URL || STAGING_ORIGIN

if (baseUrl !== STAGING_ORIGIN) {
  throw new Error(`Staging Gate0 tests require the exact protected origin ${STAGING_ORIGIN}.`)
}

const required = [
  'GATE0_E2E_EMAIL',
  'GATE0_E2E_PASSWORD',
  'STAGING_ACCESS_CLIENT_ID',
  'STAGING_ACCESS_CLIENT_SECRET',
] as const
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`Staging Gate0 tests require ${name}.`)
}

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
    baseURL: STAGING_ORIGIN,
    serviceWorkers: 'block',
    // Access headers are installed by the Gate0 spec on the exact Staging
    // origin only. Context-wide headers would also be sent to Supabase.
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  }],
})
