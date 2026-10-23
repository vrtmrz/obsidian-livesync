import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] || '.bench/chunk-size');
const local = JSON.parse(await fs.readFile(join(directory, 'results.json'), 'utf8'));
const optionalJson = async (path) => { try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };
const remote = await optionalJson(join(directory, 'remote/results-rtt0.json'));
const p2p = await optionalJson(join(directory, 'p2p/results.json'));
const median = (numbers) => { const sorted = [...numbers].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const stats = (numbers) => ({ n: numbers.length, median: median(numbers), min: Math.min(...numbers), max: Math.max(...numbers) });

let normalMarkdownFileStages = 0;
for (const stage of local.candidates[0].stages) {
    for (const file of stage.files.filter((file) => file.kind === 'markdown' && file.sourceBytes < 4 * 1024 * 1024)) {
        const fingerprints = local.candidates.map((candidate) => candidate.stages.find((entry) => entry.name === stage.name).files.find((entry) => entry.path === file.path).chunkFingerprintSha256);
        assert.equal(new Set(fingerprints).size, 1, `${stage.name}/${file.path}`); normalMarkdownFileStages++;
    }
}

const localRows = local.candidates.flatMap((candidate) => candidate.stages.map((stage) => {
    const binary = stage.byKind.find((group) => group.kind === 'binary');
    const markdown = stage.byKind.find((group) => group.kind === 'markdown');
    const random = stage.files.find((file) => file.path === 'benchmark/random-8m.bin');
    return {
        customChunkSize: candidate.customChunkSize, stage: stage.name, rawCeilingBytes: candidate.chunkSizeCeilingBytes,
        allChunks: stage.files.reduce((sum, file) => sum + file.chunkCount, 0), binaryChunks: binary.chunkCount,
        randomBinaryChunks: random.chunkCount, randomBinaryCpuMs: random.timing.primarySplitAndIdCpuMsMedian,
        binaryNewRawBytes: binary.newUniqueChunkRawBytesVsHistory, markdownNewRawBytes: markdown.newUniqueChunkRawBytesVsHistory,
        splitAndIdCpuMs: binary.timing.primarySplitAndIdCpuMsMedian + markdown.timing.primarySplitAndIdCpuMsMedian,
    };
}));

function grouped(entries, makeRow) {
    const groups = new Map();
    for (const entry of entries) for (const stage of entry.stages) {
        const key = `${entry.provider || 'p2p'}/${entry.customChunkSize}/${stage.name}`;
        const group = groups.get(key) || { provider: entry.provider || 'p2p', customChunkSize: entry.customChunkSize, stage: stage.name, samples: [] };
        group.samples.push(stage); groups.set(key, group);
    }
    return [...groups.values()].map(makeRow);
}

const remoteRows = grouped((remote?.results || []).filter((entry) => entry.complete), (group) => {
    const result = { provider: group.provider, customChunkSize: group.customChunkSize, stage: group.stage, repeats: group.samples.length };
    for (const direction of ['mirror', 'upload', 'download']) {
        for (const metric of ['elapsedMs', 'userCpuMs', 'systemCpuMs', 'maxResidentSetKiB']) result[`${direction}_${metric}`] = stats(group.samples.map((stage) => stage[direction][metric]));
        if (direction !== 'mirror') for (const metric of ['requests', 'requestBodyBytes', 'responseBodyBytes', 'maxRequestBodyBytes']) {
            const values = group.samples.map((stage) => stage[direction].http[metric]).filter(Number.isFinite);
            if (values.length) result[`${direction}_${metric}`] = stats(values);
        }
    }
    for (const metric of ['objectCount', 'storedObjectBytes', 'chunkCount', 'newChunkCount', 'chunkJsonBytes', 'largestChunkJsonBytes', 'largestDocumentJsonBytes']) {
        const values = group.samples.map((stage) => stage.remote[metric]).filter(Number.isFinite);
        if (values.length) result[metric] = stats(values);
    }
    result.verifiedFilesPerSample = group.samples.map((stage) => stage.verifiedFiles);
    return result;
});

const p2pRows = grouped((p2p?.results || []).filter((entry) => entry.complete), (group) => {
    const result = { provider: 'p2p', customChunkSize: group.customChunkSize, stage: group.stage, repeats: group.samples.length };
    for (const metric of ['elapsedMs', 'userCpuMs', 'systemCpuMs', 'maxResidentSetKiB']) result[metric] = stats(group.samples.map((stage) => stage.sync[metric]));
    result.currentRoundTripTime = stats(group.samples.map((stage) => stage.stats.selectedPair.currentRoundTripTime));
    for (const side of ['host', 'target']) for (const metric of ['payloadBytesSent', 'messagesSent']) result[`${side}_${metric}`] = stats(group.samples.map((stage) => stage.dataChannel[side][metric]));
    for (const side of ['host', 'target']) for (const metric of ['userCpuMs', 'systemCpuMs', 'maxResidentSetKiB']) result[`${side}_${metric}`] = stats(group.samples.map((stage) => stage.dataChannel[side].processUsage[metric]));
    result.paths = [...new Set(group.samples.map((stage) => stage.stats.selectedPath))];
    result.verifiedFilesPerSample = group.samples.map((stage) => stage.verifiedFiles);
    return result;
});

const summary = { version: local.runtime.projectVersion, commonlib: local.runtime.commonlibVersion, variant: local.runtime.variant, commonlibChunksSha256: local.runtime.commonlibChunksSha256, corpus: local.corpus,
    assertions: { ...local.assertions, normalMarkdownIdenticalAcrossAllSevenValues: true, normalMarkdownFileStages }, local: localRows, remote: remoteRows, p2p: p2pRows };
await fs.writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));

function csv(rows, fields) {
    const cell = (value) => JSON.stringify(typeof value === 'object' && value !== null ? value.median : value ?? '');
    return `${fields.join(',')}\n${rows.map((row) => fields.map((field) => cell(row[field])).join(',')).join('\n')}\n`;
}
await fs.writeFile(join(directory, 'local-summary.csv'), csv(localRows, Object.keys(localRows[0])));
if (remoteRows.length) await fs.writeFile(join(directory, 'remote-summary.csv'), csv(remoteRows, Object.keys(remoteRows[0]).filter((key) => key !== 'verifiedFilesPerSample')));
if (p2pRows.length) await fs.writeFile(join(directory, 'p2p-summary.csv'), csv(p2pRows, Object.keys(p2pRows[0]).filter((key) => !['paths', 'verifiedFilesPerSample'].includes(key))));
console.log(JSON.stringify({ directory, completeRemoteCases: remote?.results.filter((entry) => entry.complete).length || 0, completeP2PCases: p2p?.results.filter((entry) => entry.complete).length || 0, assertions: summary.assertions }));
