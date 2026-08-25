import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './workers/storage-backup/wrangler.staging.jsonc',
      },
      miniflare: {
        bindings: {
          SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_runtimeIntegrationOnly_12345678901234567890',
        },
      },
    }),
  ],
  test: {
    include: ['./workers/storage-backup/runtime-tests/**/*.runtime.ts'],
  },
})
