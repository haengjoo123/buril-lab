import { spawnSync } from 'node:child_process'
import process from 'node:process'

const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'functions/api/chemicals/_pipeline.live.test.ts', '--reporter=verbose'],
  {
    stdio: 'inherit',
    env: { ...process.env, RUN_CHEMICAL_LIVE_SMOKE: 'true' },
  },
)

if (result.error) throw result.error
process.exit(result.status ?? 1)
