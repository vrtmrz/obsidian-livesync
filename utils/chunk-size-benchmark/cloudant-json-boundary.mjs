import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.resolve('@vrtmrz/livesync-commonlib/package.json')));
const { splitPiecesRabinKarp } = await import(pathToFileURL(join(packageRoot, 'dist/string_and_binary/chunks.js')).href);
const { getConfiguredFunctionsForEncryption } = await import(pathToFileURL(join(packageRoot, 'dist/pouchdb/encryption.js')).href);
const { compressDoc } = await import(pathToFileURL(join(packageRoot, 'dist/pouchdb/compress.js')).href);
const output = resolve(process.argv[2] || '.bench/rabin-window-fixed/cloudant-json-boundary');
await fs.mkdir(output, { recursive: true });
const uri = 'http://127.0.0.1:15994';
const headers = { Authorization: `Basic ${Buffer.from('bench:benchmark-only-password').toString('base64')}`, 'Content-Type': 'application/json' };
const configPath = '/_node/_local/_config/couchdb/max_document_size';
const previousResponse = await fetch(uri + configPath, { headers });
assert(previousResponse.ok || previousResponse.status === 404);
const previous = previousResponse.ok ? await previousResponse.json() : undefined;
const requestConfigPath = '/_node/_local/_config/chttpd/max_http_request_size';
const previousRequestResponse = await fetch(uri + requestConfigPath, { headers });
assert(previousRequestResponse.ok || previousRequestResponse.status === 404);
const previousRequestLimit = previousRequestResponse.ok ? await previousRequestResponse.json() : undefined;
const database = `chunkbench-json-budget-${Date.now()}`;
const inputs = {
    binary: new Blob([new Uint8Array(4 * 1024 * 1024)], { type: 'application/octet-stream' }),
    nulText: new Blob(['\0'.repeat(4 * 1024 * 1024)], { type: 'text/plain' }),
    escapedText: new Blob(['\\'.repeat(4 * 1024 * 1024)], { type: 'text/plain' }),
};
const cases = [
    { kind: 'binary', customChunkSize: 4, encryption: 'v1', compression: false, expectedAccepted: true },
    { kind: 'binary', customChunkSize: 4, encryption: 'v2', compression: false, expectedAccepted: true },
    { kind: 'binary', customChunkSize: 5, encryption: 'v2', compression: false, expectedAccepted: false },
    { kind: 'nulText', customChunkSize: 0, encryption: 'none', compression: false, expectedAccepted: true },
    { kind: 'nulText', customChunkSize: 4, encryption: 'none', compression: false },
    { kind: 'escapedText', customChunkSize: 4, encryption: 'none', compression: false },
    { kind: 'nulText', customChunkSize: 4, encryption: 'v2', compression: false, expectedAccepted: true },
    { kind: 'nulText', customChunkSize: 4, encryption: 'none', compression: true, expectedAccepted: true },
];
const records = [];
const record = { scope: 'Synthetic leaf-document probes using the installed splitter, compression, encryption, and JSON serialisation, sent to the owned CouchDB fixture with a 1,000,000-byte document limit and 64,000,000-byte request limit. This is not an IBM Cloudant service measurement or a whole-file synchronisation test. CouchDB 3.5.0 estimates document size from parsed strings and does not count JSON escapes; Cloudant internal size accounting has not been verified.', source: 'https://cloud.ibm.com/docs/Cloudant?topic=Cloudant-limits', sizeCalculationSource: 'https://github.com/apache/couchdb/blob/3.5.0/src/couch/src/couch_ejson_size.erl', documentLimitBytes: 1000000, requestLimitBytes: 64000000, previousDocumentLimit: previous ?? null, previousRequestLimit: previousRequestLimit ?? null, cases: records, batches: [] };
try {
    assert((await fetch(uri + configPath, { method: 'PUT', headers, body: JSON.stringify('1000000') })).ok);
    assert((await fetch(uri + requestConfigPath, { method: 'PUT', headers, body: JSON.stringify('64000000') })).ok);
    assert((await fetch(`${uri}/${database}`, { method: 'PUT', headers })).ok);
    for (const condition of cases) {
        const input = inputs[condition.kind];
        const chunks = await splitPiecesRabinKarp(input, 102400 * (condition.customChunkSize + 1), condition.kind !== 'binary', 20);
        let largest = '';
        for await (const chunk of chunks()) if (chunk.length > largest.length) largest = chunk;
        const id = `h:+${createHash('sha256').update(JSON.stringify(condition)).digest('hex')}`;
        let doc = { _id: id, type: 'leaf', data: largest };
        if (condition.compression) doc = await compressDoc(doc);
        if (condition.encryption !== 'none') {
            const { incoming, outgoing } = getConfiguredFunctionsForEncryption('public-json-budget-probe-passphrase', false, false, async () => new Uint8Array(16), condition.encryption);
            const encrypted = await incoming(doc);
            assert.equal(encrypted.e_, true);
            const decoded = await outgoing(structuredClone(encrypted));
            assert.equal(decoded.data, doc.data);
            doc = encrypted;
        }
        doc = { ...doc, _rev: `1-${'0'.repeat(32)}`, _revisions: { start: 1, ids: ['0'.repeat(32)] } };
        const jsonBytes = Buffer.byteLength(JSON.stringify(doc));
        const body = JSON.stringify({ docs: [doc], new_edits: false });
        const response = await fetch(`${uri}/${database}/_bulk_docs`, { method: 'POST', headers, body });
        const result = await response.json();
        const accepted = response.ok && Array.isArray(result) && result.every(entry => !entry.error);
        const measurement = { ...condition, largestPieceUtf8Bytes: Buffer.byteLength(largest), jsonBytes, jsonBytesUnderLimit: jsonBytes < record.documentLimitBytes, requestBodyBytes: Buffer.byteLength(body), status: response.status, accepted, response: result };
        records.push(measurement);
        await fs.writeFile(join(output, 'results.json'), JSON.stringify(record, null, 2));
        if (condition.expectedAccepted !== undefined) assert.equal(accepted, condition.expectedAccepted, JSON.stringify(measurement));
        assert(Buffer.byteLength(body) < record.requestLimitBytes);
        console.log(JSON.stringify({ ...measurement, response: undefined }));
    }
    const batchInput = new Uint8Array(512000 * 25);
    for (let index = 0; index < 25; index++) batchInput[(index + 1) * 512000 - 1] = index + 1;
    const splitBatch = await splitPiecesRabinKarp(new Blob([batchInput], { type: 'text/plain' }), 512000, true, 20);
    const batchPieces = [];
    for await (const piece of splitBatch()) batchPieces.push(piece);
    assert.equal(batchPieces.length, 25);
    assert(batchPieces.every(piece => Buffer.byteLength(piece) === 512000));
    assert.equal(new Set(batchPieces).size, 25);
    for (const count of [25, 20]) {
        const docs = batchPieces.slice(0, count).map((piece, index) => ({
            _id: `h:+${createHash('sha256').update(`escaped-batch-${count}-${index}`).digest('hex')}`,
            type: 'leaf', data: piece,
            _rev: `1-${'0'.repeat(32)}`, _revisions: { start: 1, ids: ['0'.repeat(32)] },
        }));
        const body = JSON.stringify({ docs, new_edits: false });
        const response = await fetch(`${uri}/${database}/_bulk_docs`, { method: 'POST', headers, body });
        const result = await response.json();
        const accepted = response.ok && Array.isArray(result) && result.every(entry => !entry.error);
        const measurement = { count, rawBytesPerLeaf: 512000, requestBodyBytes: Buffer.byteLength(body), largestDocumentJsonBytes: Math.max(...docs.map(doc => Buffer.byteLength(JSON.stringify(doc)))), status: response.status, accepted, response: result };
        record.batches.push(measurement);
        await fs.writeFile(join(output, 'results.json'), JSON.stringify(record, null, 2));
        assert.equal(accepted, count === 20, JSON.stringify(measurement));
        if (count === 25) assert.equal(response.status, 413);
        console.log(JSON.stringify({ ...measurement, response: undefined }));
    }
} finally {
    await fetch(`${uri}/${database}`, { method: 'DELETE', headers });
    const restored = await fetch(uri + configPath, previous === undefined ? { method: 'DELETE', headers } : { method: 'PUT', headers, body: JSON.stringify(previous) });
    record.configurationRestored = restored.ok;
    const requestRestored = await fetch(uri + requestConfigPath, previousRequestLimit === undefined ? { method: 'DELETE', headers } : { method: 'PUT', headers, body: JSON.stringify(previousRequestLimit) });
    record.requestConfigurationRestored = requestRestored.ok;
    await fs.writeFile(join(output, 'results.json'), JSON.stringify(record, null, 2));
    assert(record.configurationRestored);
    assert(record.requestConfigurationRestored);
}
