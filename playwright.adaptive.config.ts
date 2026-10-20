import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/adaptive', testMatch: '*.spec.ts', workers: 1, timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'output/playwright/adaptive/results', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4199', screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npx vite build --config e2e/adaptive/vite.config.ts && npx vite preview --config e2e/adaptive/vite.config.ts --host 127.0.0.1 --port 4199 --strictPort',
    timeout: 180_000,
    url: 'http://127.0.0.1:4199/e2e/adaptive/fixture.html', reuseExistingServer: false,
  },
});
