import { defineConfig, devices } from '@playwright/test'

// The spec starts its own loopback-only Pages runtime in a worker fixture and
// awaits cleanup in finally. No external URL, existing server, token, or remote
// binding can be selected with an environment-variable override.
export default defineConfig({
  testDir: './e2e/pages-boundary',
  testMatch: 'pages-boundary.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: 'output/playwright/pages-boundary/internal/test-results',
  reporter: process.env.CI ? [['github']] : [['list']],
  use: {
    serviceWorkers: 'block',
    bypassCSP: false,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      // Synthetic devices only: never inspect the user's camera/microphone.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
