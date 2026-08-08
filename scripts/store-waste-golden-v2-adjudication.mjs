/* Store the deterministic adjudication returned by the offline regression run. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const directory = path.join(root, 'data', 'waste-golden-set-v2');
const datasetPath = path.join(directory, 'materials.json');
const manifestPath = path.join(directory, 'source-manifest.json');
const reportPath = path.join(directory, 'baseline-report.json');
const sha = (value) => createHash('sha256').update(value).digest('hex');

async function main() {
    const [rows, report, manifest] = await Promise.all([
        readFile(datasetPath, 'utf8').then(JSON.parse),
        readFile(reportPath, 'utf8').then(JSON.parse),
        readFile(manifestPath, 'utf8').then(JSON.parse),
    ]);
    const byId = new Map(report.mismatches.map(({ id, adjudication }) => [id, adjudication]));
    const updated = rows.map((row) => {
        const adjudication = byId.get(row.id);
        if (!adjudication) {
            const { adjudication: _discarded, ...withoutAdjudication } = row;
            return withoutAdjudication;
        }
        return { ...row, adjudication };
    });
    const serialized = `${JSON.stringify(updated, null, 2)}\n`;
    manifest.datasetSha256 = sha(serialized);
    manifest.generatedAt = new Date().toISOString();
    manifest.adjudication = {
        method: 'offline_sds_evidence_rules',
        evaluatedAt: manifest.generatedAt,
        mismatchCount: byId.size,
    };
    await writeFile(datasetPath, serialized, 'utf8');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`Stored automated adjudication for ${byId.size} current mismatch records.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
