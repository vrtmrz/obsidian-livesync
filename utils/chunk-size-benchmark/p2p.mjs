import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createNewVaultSettings, REMOTE_P2P, SALT_OF_PASSPHRASE } from '@vrtmrz/livesync-commonlib/compat/common/types';
import { encryptString } from '@vrtmrz/livesync-commonlib/compat/encryption/stringEncryption';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = join(root, 'src/apps/cli/dist/index.cjs');
const preload = join(root, 'utils/chunk-size-benchmark/datachannel-metrics.cjs');
const args = process.argv.slice(2);
const option = (key, fallback) => { const at = args.indexOf(`--${key}`); return at < 0 ? fallback : args[at + 1]; };
const sourceCli = resolve(option('source-cli', cli));
const targetCli = resolve(option('target-cli', cli));
const output = resolve(option('output', join(root, '.bench/chunk-size')));
const corpusPath = resolve(option('corpus', join(output, 'corpus/manifest.json')));
const sizes = option('sizes', '0,4,10,40').split(',').map(Number);
const repeats = Number(option('repeats', '3'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cliSha256 = sha256(await fs.readFile(cli));
const sourceCliSha256 = sha256(await fs.readFile(sourceCli));
const targetCliSha256 = sha256(await fs.readFile(targetCli));
const environment = { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' };

async function runCli(vault, settings, command, commandArgs, logPath, extraEnvironment = {}, entrypoint = cli) {
    const marker = '__BENCH_TIME__';
    const started = performance.now();
    const nodeArgs = extraEnvironment.LIVESYNC_BENCH_DATACHANNEL_JSON ? ['--require', preload] : [];
    const child = spawn('/usr/bin/time', ['-f', `${marker}%U\t%S\t%M`, process.execPath, ...nodeArgs, entrypoint, vault, '--settings', settings, command, ...commandArgs], {
        cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...environment, ...extraEnvironment },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    const timeout = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }, 240000);
    const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
    clearTimeout(timeout);
    await fs.writeFile(logPath, `${stdout}\n${stderr}`);
    if (code !== 0) throw new Error(`CLI ${command} exited ${code}; ${logPath}\n${stderr.slice(-2000)}`);
    const line = stderr.split(/\r?\n/).find((row) => row.startsWith(marker));
    assert(line, 'GNU time output is missing');
    const [userSeconds, systemSeconds, maxResidentSetKiB] = line.slice(marker.length).split('\t').map(Number);
    return { elapsedMs: performance.now() - started, userCpuMs: userSeconds * 1000, systemCpuMs: systemSeconds * 1000, maxResidentSetKiB };
}

async function startHost(vault, settings, logPath, metricsPath) {
    const child = spawn(process.execPath, ['--require', preload, sourceCli, vault, '--settings', settings, 'p2p-host'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...environment, LIVESYNC_BENCH_DATACHANNEL_JSON: metricsPath } });
    let combined = ''; let ended = false; let failure;
    const closed = new Promise((accept) => { child.once('error', (error) => { failure = error; ended = true; accept(); }); child.once('close', () => { ended = true; accept(); }); });
    child.stdout.on('data', (data) => { combined += data; }); child.stderr.on('data', (data) => { combined += data; });
    const stop = async () => {
        if (!ended) child.kill('SIGTERM');
        const timeout = setTimeout(() => { if (!ended) child.kill('SIGKILL'); }, 10000);
        await closed; clearTimeout(timeout); await fs.writeFile(logPath, combined);
    };
    const started = performance.now();
    try {
        while (!combined.includes('P2P host is running')) {
            if (ended || performance.now() - started > 25000) throw failure || new Error(`P2P host did not start: ${combined.slice(-2500)}`);
            await delay(100);
        }
    } catch (error) { await stop(); throw error; }
    return { stop, readyMs: performance.now() - started };
}

async function settingsFor(size, room, name) {
    return {
        ...createNewVaultSettings(), isConfigured: true, remoteType: REMOTE_P2P,
        encrypt: true, passphrase: 'chunk-size-benchmark-only-passphrase', usePathObfuscation: true, encryptInternalMetadata: true,
        idDerivationVersion: 1, idDerivationKey: '', encryptedIdDerivationKey: await encryptString('0123456789abcdef'.repeat(4), '*' + SALT_OF_PASSPHRASE),
        E2EEAlgorithm: 'v2', hashAlg: 'xxhash64', chunkSplitterVersion: 'v3-rabin-karp', minimumChunkSize: 20, customChunkSize: size,
        enableCompression: false, useEden: false, useIndexedDBAdapter: false, handleFilenameCaseSensitive: false, pathNormalizationVersion: 0,
        autoAcceptCompatibleTweak: false, readChunksOnline: false, liveSync: false, syncOnStart: false, syncOnSave: false, periodicReplication: false,
        syncOnFileOpen: false, syncMaxSizeInMB: 50,
        P2P_Enabled: true, P2P_AutoStart: false, P2P_AutoBroadcast: false, P2P_IsHeadless: true,
        P2P_AppID: 'livesync-chunk-size-benchmark', P2P_roomID: room, P2P_passphrase: 'chunk-size-local-relay-fixture',
        P2P_relays: 'ws://127.0.0.1:14094/', P2P_AutoAcceptingPeers: '~.*', P2P_AutoDenyingPeers: '',
        P2P_turnServers: '', P2P_turnUsername: '', P2P_turnCredential: '', P2P_DevicePeerName: name,
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

await fs.mkdir(join(output, 'p2p'), { recursive: true });
const manifest = JSON.parse(await fs.readFile(corpusPath, 'utf8'));
for (const stage of manifest.stages) stage.directory = resolve(dirname(corpusPath), stage.directory);
const corpusDigest = sha256(JSON.stringify(manifest.stages.map((stage) => ({ name: stage.name, files: stage.files }))));
const resultPath = join(output, 'p2p/results.json');
let results = [];
try { const saved = JSON.parse(await fs.readFile(resultPath, 'utf8')); assert.equal(saved.corpusDigest, corpusDigest); assert.equal(saved.sourceCliSha256 ?? saved.cliSha256, sourceCliSha256); assert.equal(saved.targetCliSha256 ?? saved.cliSha256, targetCliSha256); results = saved.results; } catch (error) { if (error.code !== 'ENOENT') throw error; }
const save = () => fs.writeFile(resultPath, JSON.stringify({ version: '1.0.39', commonlib: '0.1.44', variant: process.env.LIVESYNC_BENCH_VARIANT || 'unlabelled', cliSha256, sourceCliSha256, targetCliSha256, corpusDigest,
    scope: 'Local WebRTC direct path; timed target command includes process start-up, peer discovery, connection establishment, pull and reverse synchronisation. DataChannel payload bytes are measured using werift counters observed through a preload on both endpoints; they exclude transport overhead, transport retransmissions, and relay signalling. ICE byte counters are retained as diagnostics and report zero in this runtime. GNU time covers the target process; the preload also records CPU/RSS on each endpoint. Source mirroring and host start-up are recorded separately. E2EE V2 settings with independent IDs; compression disabled.', results }, null, 2));
for (let repeat = 0; repeat < repeats; repeat++) {
    const rotation = repeat % sizes.length; const order = [...sizes.slice(rotation), ...sizes.slice(0, rotation)];
    for (const size of order) {
        const name = `p2p-c${size}-r${repeat + 1}`;
        if (results.some((result) => result.name === name && result.complete)) continue;
        const work = join(output, 'p2p', name); await fs.mkdir(join(work, 'logs'), { recursive: true });
        const a = join(work, 'source'); const b = join(work, 'target');
        await fs.rm(a, { recursive: true, force: true }); await fs.rm(b, { recursive: true, force: true });
        await fs.mkdir(a, { recursive: true }); await fs.mkdir(b, { recursive: true });
        const room = `chunk-size-${Date.now().toString(36)}-${name}`;
        const hostName = `host-${name}`;
        const settingsA = join(work, 'source-settings.json'); const settingsB = join(work, 'target-settings.json');
        await fs.writeFile(settingsA, JSON.stringify(await settingsFor(size, room, hostName)));
        await fs.writeFile(settingsB, JSON.stringify(await settingsFor(size, room, `target-${name}`)));
        const result = { name, customChunkSize: size, repeat: repeat + 1, stages: [], complete: false };
        results.push(result); await save();
        let previous;
        try {
            for (const stage of manifest.stages) {
                const log = (label) => join(work, 'logs', `${stage.name}-${label}.txt`);
                const changedFiles = await copyStage(stage, a, previous);
                const mirror = await runCli(a, settingsA, 'mirror', [], log('mirror'), {}, sourceCli);
                const hostMetricsPath = join(work, `${stage.name}-host-datachannel.json`);
                const targetMetricsPath = join(work, `${stage.name}-target-datachannel.json`);
                const host = await startHost(a, settingsA, log('host'), hostMetricsPath);
                const statsPath = join(work, `${stage.name}-stats.jsonl`); await fs.rm(statsPath, { force: true });
                let sync;
                try { sync = await runCli(b, settingsB, 'p2p-sync', [hostName, '120'], log('sync'), { LIVESYNC_P2P_STATS_JSONL: statsPath, LIVESYNC_BENCH_DATACHANNEL_JSON: targetMetricsPath }, targetCli); }
                finally { await host.stop(); }
                const rows = (await fs.readFile(statsPath, 'utf8')).trim().split(/\r?\n/);
                const stats = JSON.parse(rows.at(-1));
                assert(stats.candidatePathCollected, 'ICE statistics were not collected');
                assert(!stats.selectedPath.includes('relay'), `Unexpected TURN path: ${stats.selectedPath}`);
                const dataChannel = { host: JSON.parse(await fs.readFile(hostMetricsPath, 'utf8')), target: JSON.parse(await fs.readFile(targetMetricsPath, 'utf8')) };
                assert(dataChannel.host.payloadBytesSent > 0 && dataChannel.target.payloadBytesSent > 0, 'DataChannel counters must record both directions');
                const materialisedByPull = [];
                for (const file of stage.files) {
                    let bytes; try { bytes = await fs.readFile(join(b, file.path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
                    if (!bytes || sha256(bytes) !== file.sha256) {
                        const to = join(work, 'verification', file.path); await fs.mkdir(dirname(to), { recursive: true });
                        const measurement = await runCli(b, settingsB, 'pull', [file.path, to], log(`verify-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`), {}, targetCli);
                        bytes = await fs.readFile(to); materialisedByPull.push({ path: file.path, measurement });
                    }
                    assert.equal(sha256(bytes), file.sha256, `${name} ${stage.name} ${file.path}`);
                }
                result.stages.push({ name: stage.name, changedFiles, mirror, hostReadyMs: host.readyMs, sync, stats, dataChannel, verifiedFiles: stage.files.length, materialisedByPull });
                await save(); console.log(JSON.stringify({ case: name, stage: stage.name, syncMs: Math.round(sync.elapsedMs), selectedPath: stats.selectedPath, hostPayloadBytesSent: dataChannel.host.payloadBytesSent, targetPayloadBytesSent: dataChannel.target.payloadBytesSent }));
                previous = stage;
            }
            result.complete = true; await save();
        } catch (error) { result.error = String(error); await save(); throw error; }
    }
}
console.log(`Completed P2P measurements: ${resultPath}`);
