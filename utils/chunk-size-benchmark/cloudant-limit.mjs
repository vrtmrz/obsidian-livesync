import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
    assert(['--output', '--corpus'].includes(process.argv[index]), `Unknown option: ${process.argv[index]}`);
    assert(process.argv[index + 1], `Missing value for ${process.argv[index]}`);
    options.set(process.argv[index], process.argv[index + 1]);
}
const output = resolve(options.get('--output') || '.bench/chunk-size-cloudant-model');
const corpusPath = resolve(options.get('--corpus') || '.bench/chunk-size/corpus/manifest.json');
const configUri = 'http://127.0.0.1:15994/_node/_local/_config/couchdb/max_document_size';
const headers = { Authorization: `Basic ${Buffer.from('bench:benchmark-only-password').toString('base64')}`, 'Content-Type': 'application/json' };
const previousResponse = await fetch(configUri, { headers });
assert(previousResponse.ok || previousResponse.status === 404);
const previous = previousResponse.ok ? await previousResponse.json() : undefined;
const manifest = JSON.parse(await fs.readFile(corpusPath, 'utf8'));
manifest.stages = manifest.stages.filter((stage) => stage.name === 'initial');
for (const stage of manifest.stages) stage.directory = resolve(dirname(corpusPath), stage.directory);
await fs.mkdir(output, { recursive: true });
const initialManifest = join(output, 'initial-only-manifest.json');
await fs.writeFile(initialManifest, JSON.stringify(manifest, null, 2));
const record = { scope: 'CouchDB with a 1,000,000-byte document limit, modelling the published Cloudant document-size constraint. The IBM Cloudant service itself is not measured.', source: 'https://cloud.ibm.com/docs/Cloudant?topic=Cloudant-limits', limitBytes: 1000000, publishedRequestLimitBytes: 64000000, variant: process.env.LIVESYNC_BENCH_VARIANT || 'unlabelled', previousConfiguredValue: previous ?? null };
try {
    const configured = await fetch(configUri, { method: 'PUT', headers, body: JSON.stringify(String(record.limitBytes)) });
    assert(configured.ok, `Could not set fixture document limit: ${configured.status}`);
    const child = spawn(process.execPath, [join(root, 'utils/chunk-size-benchmark/remote.mjs'), '--output', output, '--corpus', initialManifest, '--providers', 'couchdb', '--sizes', '4,10', '--repeats', '1'], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=3072' },
    });
    let log = ''; child.stdout.on('data', (data) => { log += data; process.stdout.write(data); }); child.stderr.on('data', (data) => { log += data; });
    record.exitCode = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
    await fs.writeFile(join(output, 'run.log'), log);
    const measured = JSON.parse(await fs.readFile(join(output, 'remote/results-rtt0.json'), 'utf8'));
    record.cases = measured.results.map((entry) => ({ name: entry.name, customChunkSize: entry.customChunkSize, complete: entry.complete, error: entry.error, stages: entry.stages.map((stage) => ({ name: stage.name, largestDocumentJsonBytes: stage.remote.largestDocumentJsonBytes, maxUploadRequestBodyBytes: stage.upload.http.maxRequestBodyBytes, verifiedFiles: stage.verifiedFiles })) }));
    assert(record.cases.some((entry) => entry.customChunkSize === 4 && entry.complete), 'The 500 KiB candidate must complete under the modelled limit');
    assert(record.cases.some((entry) => entry.customChunkSize === 10 && !entry.complete), 'The 1,100 KiB candidate must hit the modelled document limit');
    const rejectionLog = await fs.readFile(join(output, 'remote/couchdb-c10-r1/logs/initial-upload.txt'), 'utf8');
    record.sizeRejectionObserved = /413|document_too_large|document.*too large|too_large|request entity too large/iu.test(rejectionLog);
    assert(record.sizeRejectionObserved, 'The rejection log must identify the document-size limit');
} finally {
    const restored = await fetch(configUri, previous === undefined ? { method: 'DELETE', headers } : { method: 'PUT', headers, body: JSON.stringify(previous) });
    record.configurationRestored = restored.ok;
    await fs.writeFile(join(output, 'constraint-result.json'), JSON.stringify(record, null, 2));
    assert(record.configurationRestored, 'Fixture document limit restoration failed');
}
console.log(JSON.stringify(record));
