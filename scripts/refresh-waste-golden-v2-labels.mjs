/* Applies an evidence-only label correction without re-downloading SDS data. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.join(process.cwd(), 'data', 'waste-golden-set-v2');
const dataPath = path.join(directory, 'materials.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const reactiveHCodes = new Set(['H200', 'H201', 'H202', 'H203', 'H204', 'H205', 'H240', 'H241', 'H242', 'H250', 'H251', 'H252', 'H260', 'H261', 'H270', 'H271', 'H272']);

const rows = JSON.parse(await readFile(dataPath, 'utf8'));
for (const row of rows) {
    if (row.stratum !== 'reactive_oxidizer') continue;
    if (row.ghs.hCodes.some((code) => reactiveHCodes.has(code))) {
        row.expected = {
            status: 'blocked',
            reason: 'KOSHA Section 2 classifies a reactive, water-reactive, self-reactive, explosive, or oxidizing hazard; do not automatically authorize container deposit.',
        };
    } else {
        row.expected = {
            status: 'ready',
            streamCode: 'AQUEOUS_OTHER',
            reason: 'The reactive/oxidizer candidate search matched the name, but KOSHA Section 2 has no reactive or oxidizing H-code; use the standard aqueous common stream.',
        };
    }
}
const serialized = `${JSON.stringify(rows, null, 2)}\n`;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.datasetSha256 = createHash('sha256').update(serialized).digest('hex');
await writeFile(dataPath, serialized, 'utf8');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
