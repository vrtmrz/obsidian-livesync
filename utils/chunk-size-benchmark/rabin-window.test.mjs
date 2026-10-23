import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const packageRoot = dirname(fileURLToPath(import.meta.resolve('@vrtmrz/livesync-commonlib/package.json')));
const { splitPiecesRabinKarp } = await import(pathToFileURL(join(packageRoot, 'dist/string_and_binary/chunks.js')).href);

test('zero windows lose the contribution of a marker in the preceding chunk', async () => {
    const blockBytes = 300 * 1024;
    const input = new Uint8Array(blockBytes * 3);
    for (let end = blockBytes; end <= input.length; end += blockBytes) input[end - 1] = 1;
    const pieces = await splitPiecesRabinKarp(new Blob([input], { type: 'application/octet-stream' }), 1100 * 1024, false, 20, 'markers.bin', false);
    const chunks = [];
    for await (const encoded of pieces()) chunks.push(Buffer.from(encoded, 'base64'));
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(input), 'all input bytes must survive splitting');
    // A 48-byte zero window hashes to zero; each isolated marker hashes to one.
    // Markers are further apart than the 256 KiB minimum and below the maximum.
    assert.deepEqual(chunks.map((chunk) => chunk.length), [blockBytes, blockBytes, blockBytes]);
});
