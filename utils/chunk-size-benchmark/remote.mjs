import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createNewVaultSettings, REMOTE_COUCHDB, REMOTE_MINIO, SALT_OF_PASSPHRASE } from '@vrtmrz/livesync-commonlib/compat/common/types';
import { encryptString } from '@vrtmrz/livesync-commonlib/compat/encryption/stringEncryption';
import { S3Client, CreateBucketCommand, ListObjectsV2Command, DeleteObjectsCommand, DeleteBucketCommand } from '@aws-sdk/client-s3';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const cli = join(root, 'src/apps/cli/dist/index.cjs');
const args = process.argv.slice(2);
const option = (key, fallback) => { const at = args.indexOf(`--${key}`); return at < 0 ? fallback : args[at + 1]; };
const sourceCli = resolve(option('source-cli', cli));
const targetCli = resolve(option('target-cli', cli));
const output = resolve(option('output', join(root, '.bench/chunk-size')));
const corpusPath = resolve(option('corpus', join(output, 'corpus/manifest.json')));
const sizes = option('sizes', '0,4,10,20,40').split(',').map(Number);
const providers = option('providers', 'couchdb,s3').split(',');
const repeats = Number(option('repeats', '3'));
const rttMs = Number(option('rtt-ms', '0'));
const user = 'bench';
const password = 'benchmark-only-password';
const accessKeyId = 'bench-access-key';
const secretAccessKey = 'benchmark-only-secret-key';
const couchUri = 'http://127.0.0.1:15994';
const s3Uri = 'http://127.0.0.1:19094';
const auth = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const key = '0123456789abcdef'.repeat(4);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sourceCliSha256 = sha256(await fs.readFile(sourceCli));
const targetCliSha256 = sha256(await fs.readFile(targetCli));
const credentials = { accessKeyId, secretAccessKey };
const s3 = new S3Client({ endpoint: s3Uri, region: 'us-east-1', forcePathStyle: true, credentials });

function emptyCounters() { return { requests: 0, requestBodyBytes: 0, responseBodyBytes: 0, maxRequestBodyBytes: 0, byMethod: {}, byOperation: {} }; }

async function startProxy(backend) {
    let counters = emptyCounters();
    const server = http.createServer(async (request, response) => {
        counters.requests++;
        counters.byMethod[request.method] = (counters.byMethod[request.method] || 0) + 1;
        const url = new URL(request.url, backend);
        const operation = url.pathname.split('/').find((part) => part.startsWith('_')) || (url.searchParams.has('list-type') ? 'list' : 'object');
        counters.byOperation[operation] = (counters.byOperation[operation] || 0) + 1;
        if (rttMs) await delay(rttMs / 2);
        const target = new URL(request.url, backend);
        const upstream = http.request(target, { method: request.method, headers: request.headers }, async (incoming) => {
            if (rttMs) await delay(rttMs / 2);
            response.writeHead(incoming.statusCode, incoming.headers);
            incoming.on('data', (chunk) => { counters.responseBodyBytes += chunk.length; });
            incoming.pipe(response);
        });
        upstream.on('error', (error) => { response.writeHead(502); response.end(String(error)); });
        let requestBytes = 0;
        request.on('data', (chunk) => { counters.requestBodyBytes += chunk.length; requestBytes += chunk.length; });
        request.on('end', () => { counters.maxRequestBodyBytes = Math.max(counters.maxRequestBodyBytes, requestBytes); });
        request.pipe(upstream);
    });
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    return { uri: `http://127.0.0.1:${server.address().port}`, reset: () => { counters = emptyCounters(); }, snapshot: () => structuredClone(counters), close: () => new Promise((accept) => server.close(accept)) };
}

async function couch(path, method = 'GET', body) {
    const response = await fetch(`${couchUri}${path}`, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`CouchDB ${method} ${path}: ${response.status} ${await response.text()}`);
    return response.json();
}

async function ready() {
    for (let attempt = 0; attempt < 30; attempt++) {
        try { await couch('/_up'); await s3.send(new ListObjectsV2Command({ Bucket: 'missing-benchmark-bucket' })).catch((error) => { if (error.$metadata?.httpStatusCode !== 404) throw error; }); return; }
        catch (error) { if (attempt === 29) throw error; await delay(1000); }
    }
}

async function runCli(directory, settings, command, commandArgs, logPath, entrypoint = cli) {
    const marker = '__BENCH_TIME__';
    const started = performance.now();
    const child = spawn('/usr/bin/time', ['-f', `${marker}%U\t%S\t%M`, process.execPath, entrypoint, directory, '--settings', settings, command, ...commandArgs], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 180000);
    const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', accept); });
    clearTimeout(timeout);
    const elapsedMs = performance.now() - started;
    await fs.writeFile(logPath, `${stdout}\n${stderr}`);
    if (code !== 0) throw new Error(`CLI ${command} exited ${code}; ${logPath}\n${stderr.slice(-2200)}`);
    const line = stderr.split(/\r?\n/).find((row) => row.startsWith(marker));
    assert(line, 'GNU time output is missing');
    const [userSeconds, systemSeconds, maxResidentSetKiB] = line.slice(marker.length).split('\t').map(Number);
    return { elapsedMs, userCpuMs: userSeconds * 1000, systemCpuMs: systemSeconds * 1000, maxResidentSetKiB };
}

async function settingsFor(provider, endpoint, resource, size) {
    return {
        ...createNewVaultSettings(), isConfigured: true, remoteType: provider === 'couchdb' ? REMOTE_COUCHDB : REMOTE_MINIO,
        couchDB_URI: endpoint, couchDB_DBNAME: resource, couchDB_USER: user, couchDB_PASSWORD: password,
        endpoint, bucket: resource, accessKey: accessKeyId, secretKey: secretAccessKey, region: 'us-east-1', forcePathStyle: true,
        encrypt: true, passphrase: 'chunk-size-benchmark-only-passphrase', usePathObfuscation: true, encryptInternalMetadata: true,
        idDerivationVersion: 1, idDerivationKey: '', encryptedIdDerivationKey: await encryptString(key, '*' + SALT_OF_PASSPHRASE), E2EEAlgorithm: 'v2', hashAlg: 'xxhash64',
        chunkSplitterVersion: 'v3-rabin-karp', minimumChunkSize: 20, customChunkSize: size, autoAcceptCompatibleTweak: false,
        enableCompression: false, useEden: false, useIndexedDBAdapter: false, handleFilenameCaseSensitive: false, pathNormalizationVersion: 0,
        readChunksOnline: false, liveSync: false, syncOnStart: false, syncOnSave: false, periodicReplication: false,
        syncOnFileOpen: false, syncMaxSizeInMB: 50, P2P_Enabled: false,
    };
}

async function copyStage(stage, vault, previous) {
    const old = new Map((previous?.files || []).map((file) => [file.path, file.sha256]));
    const changed = [];
    for (const file of stage.files) {
        if (old.get(file.path) === file.sha256) continue;
        const from = join(stage.directory, file.path); const to = join(vault, file.path);
        await fs.mkdir(dirname(to), { recursive: true }); await fs.copyFile(from, to);
        const stat = await fs.stat(from); await fs.utimes(to, stat.atime, stat.mtime); changed.push(file.path);
    }
    return changed;
}

async function inspect(provider, resource, previousIds) {
    if (provider === 'couchdb') {
        const info = await couch(`/${resource}`);
        const all = await couch(`/${resource}/_all_docs?include_docs=true`);
        const chunks = all.rows.filter(({ doc }) => doc?.type === 'leaf');
        const added = chunks.filter(({ id }) => !previousIds.has(id));
        const ids = chunks.map(({ id }) => id);
        const jsonBytes = ({ doc }) => Buffer.byteLength(JSON.stringify(doc));
        return { ids, metrics: { documentCount: info.doc_count, chunkCount: chunks.length, newChunkCount: added.length, chunkJsonBytes: chunks.reduce((sum, row) => sum + jsonBytes(row), 0), newChunkJsonBytes: added.reduce((sum, row) => sum + jsonBytes(row), 0), largestChunkJsonBytes: Math.max(0, ...chunks.map(jsonBytes)), largestDocumentJsonBytes: Math.max(0, ...all.rows.map(jsonBytes)), storedChunkDataBytes: chunks.reduce((sum, { doc }) => sum + Buffer.byteLength(doc.data || ''), 0), sizes: info.sizes, idLengthMin: Math.min(...ids.map((id) => id.length)), idLengthMax: Math.max(...ids.map((id) => id.length)) } };
    }
    const objects = []; let token;
    do { const result = await s3.send(new ListObjectsV2Command({ Bucket: resource, ContinuationToken: token })); objects.push(...result.Contents || []); token = result.NextContinuationToken; } while (token);
    return { ids: objects.map(({ Key }) => Key), metrics: { objectCount: objects.length, storedObjectBytes: objects.reduce((sum, { Size }) => sum + Size, 0), newObjectCount: objects.filter(({ Key }) => !previousIds.has(Key)).length } };
}

async function removeResource(provider, resource) {
    if (provider === 'couchdb') { await couch(`/${resource}`, 'DELETE'); return; }
    let token;
    do {
        const listing = await s3.send(new ListObjectsV2Command({ Bucket: resource, ContinuationToken: token }));
        if (listing.Contents?.length) await s3.send(new DeleteObjectsCommand({ Bucket: resource, Delete: { Objects: listing.Contents.map(({ Key }) => ({ Key })) } }));
        token = listing.NextContinuationToken;
    } while (token);
    await s3.send(new DeleteBucketCommand({ Bucket: resource }));
}

await fs.mkdir(join(output, 'remote'), { recursive: true });
const manifest = JSON.parse(await fs.readFile(corpusPath, 'utf8'));
for (const stage of manifest.stages) stage.directory = resolve(dirname(corpusPath), stage.directory);
const digest = sha256(JSON.stringify(manifest.stages.map((stage) => ({ name: stage.name, files: stage.files }))));
const resultPath = join(output, 'remote', `results-rtt${rttMs}.json`);
let results = [];
try { const saved = JSON.parse(await fs.readFile(resultPath, 'utf8')); assert.equal(saved.corpusDigest, digest); assert.equal(saved.sourceCliSha256, sourceCliSha256); assert.equal(saved.targetCliSha256, targetCliSha256); results = saved.results; } catch (error) { if (error.code !== 'ENOENT') throw error; }
const proxies = { couchdb: await startProxy(couchUri), s3: await startProxy(s3Uri) };
const save = async () => fs.writeFile(resultPath, JSON.stringify({ version: '1.0.39', commonlib: '0.1.44', variant: process.env.LIVESYNC_BENCH_VARIANT || 'unlabelled', sourceCliSha256, targetCliSha256, corpusDigest: digest, rttMs, mode: 'local services; HTTP body bytes exclude headers; full chunk download; E2EE V2 with independent IDs; compression disabled', results }, null, 2));
try {
    await ready();
    for (let repeat = 0; repeat < repeats; repeat++) {
        const rotation = repeat % sizes.length; const order = [...sizes.slice(rotation), ...sizes.slice(0, rotation)];
        for (const provider of (repeat % 2 ? [...providers].reverse() : providers)) for (const size of order) {
            const name = `${provider}-c${size}-r${repeat + 1}`;
            if (results.some((result) => result.name === name && result.complete)) continue;
            const resource = `chunks-${Date.now().toString(36)}-${name}`;
            const work = join(output, 'remote', name); await fs.mkdir(join(work, 'logs'), { recursive: true });
            const a = join(work, 'source'); const b = join(work, 'target');
            await fs.rm(a, { recursive: true, force: true }); await fs.rm(b, { recursive: true, force: true });
            await fs.mkdir(a, { recursive: true }); await fs.mkdir(b, { recursive: true });
            const settingsA = join(work, 'source-settings.json'); const settingsB = join(work, 'target-settings.json');
            const settings = await settingsFor(provider, proxies[provider].uri, resource, size);
            await fs.writeFile(settingsA, JSON.stringify(settings)); await fs.writeFile(settingsB, JSON.stringify(settings));
            if (provider === 'couchdb') await couch(`/${resource}`, 'PUT'); else await s3.send(new CreateBucketCommand({ Bucket: resource }));
            const result = { name, provider, customChunkSize: size, repeat: repeat + 1, stages: [], complete: false };
            results.push(result); await save();
            try {
                let previous; let ids = new Set();
                for (const stage of manifest.stages) {
                    const changedFiles = await copyStage(stage, a, previous);
                    const log = (label) => join(work, 'logs', `${stage.name}-${label}.txt`);
                    const mirror = await runCli(a, settingsA, 'mirror', [], log('mirror'), sourceCli);
                    proxies[provider].reset();
                    const upload = await runCli(a, settingsA, 'sync', [], log('upload'), sourceCli); upload.http = proxies[provider].snapshot();
                    const remote = await inspect(provider, resource, ids); ids = new Set(remote.ids);
                    proxies[provider].reset();
                    const download = await runCli(b, settingsB, 'sync', [], log('download'), targetCli); download.http = proxies[provider].snapshot();
                    const verified = []; const materialisedByPull = [];
                    for (const file of stage.files) {
                        let bytes; try { bytes = await fs.readFile(join(b, file.path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
                        if (!bytes || sha256(bytes) !== file.sha256) {
                            const target = join(work, 'verification', file.path); await fs.mkdir(dirname(target), { recursive: true });
                            const measurement = await runCli(b, settingsB, 'pull', [file.path, target], log(`verify-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`), targetCli);
                            bytes = await fs.readFile(target); materialisedByPull.push({ path: file.path, measurement });
                        }
                        assert.equal(sha256(bytes), file.sha256, `${name} ${stage.name} ${file.path}`); verified.push(file.path);
                    }
                    result.stages.push({ name: stage.name, changedFiles, mirror, upload, download, remote: remote.metrics, verifiedFiles: verified.length, materialisedByPull });
                    await save(); console.log(JSON.stringify({ case: name, stage: stage.name, uploadMs: Math.round(upload.elapsedMs), downloadMs: Math.round(download.elapsedMs), requestBytes: upload.http.requestBodyBytes, responseBytes: download.http.responseBodyBytes, remote: remote.metrics }));
                    previous = stage;
                }
                result.complete = true; await save();
            } catch (error) { result.error = String(error); await save(); throw error; }
            finally { await removeResource(provider, resource); }
        }
    }
} finally { await Promise.all(Object.values(proxies).map((proxy) => proxy.close())); s3.destroy(); }
console.log(`Completed remote measurements: ${resultPath}`);
