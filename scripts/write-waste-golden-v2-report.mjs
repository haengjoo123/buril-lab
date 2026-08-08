import { spawnSync } from 'node:child_process';
import path from 'node:path';

const vitestEntrypoint = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(process.execPath, [vitestEntrypoint, 'run', 'scripts/waste-golden-v2.test.ts', '--reporter=dot'], {
    cwd: process.cwd(),
    env: { ...process.env, GOLDEN_SET_WRITE_REPORT: '1' },
    stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
