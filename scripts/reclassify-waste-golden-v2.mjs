import { spawnSync } from 'node:child_process';
import path from 'node:path';

const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'rebalance-waste-golden-v2.mjs')], {
    cwd: process.cwd(),
    env: { ...process.env, V2_RECLASS_ONLY: '1' },
    stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
