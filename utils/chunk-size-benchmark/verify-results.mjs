import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] || '.bench/rabin-window-fixed');
const load = async name => JSON.parse(await fs.readFile(join(directory, name), 'utf8'));
const local = await load('results.json');
const summary = await load('summary.json');
const remote = await load('remote/results-rtt0.json');
const p2p = await load('p2p/results.json');
const manifest = await load('corpus/manifest.json');
const sha256 = value => createHash('sha256').update(value).digest('hex');
assert.equal(remote.corpusDigest, p2p.corpusDigest);
assert.equal(remote.corpusDigest, sha256(JSON.stringify(manifest.stages.map(stage => ({ name: stage.name, files: stage.files })))));
assert.equal(local.corpus.manifestSha256, sha256(JSON.stringify(manifest)));
assert.equal(remote.results.length, 30);
assert.equal(p2p.results.length, 12);
let verified = 0;
let configurations = 0;
for (const [subdirectory, result] of [['remote', remote], ['p2p', p2p]]) {
    assert(result.variant === 'rolling-window-fixed');
    const groups = new Map();
    for (const entry of result.results) {
        assert(entry.complete && !entry.error, entry.name);
        assert.equal(entry.stages.length, 3);
        const key = `${entry.provider || 'p2p'}/${entry.customChunkSize}`;
        groups.set(key, (groups.get(key) || 0) + 1);
        for (const stage of entry.stages) { assert.equal(stage.verifiedFiles, 15); verified += stage.verifiedFiles; }
        for (const side of ['source', 'target']) {
            const settings = await load(join(subdirectory, entry.name, `${side}-settings.json`));
            assert.equal(settings.customChunkSize, entry.customChunkSize);
            assert.equal(settings.chunkSplitterVersion, 'v3-rabin-karp');
            assert.equal(settings.minimumChunkSize, 20);
            assert.equal(settings.idDerivationVersion, 1);
            assert.equal(settings.encrypt, true);
            assert.equal(settings.E2EEAlgorithm, 'v2');
            assert.equal(settings.useEden, false);
            assert.equal(settings.enableCompression, false);
            assert.equal(settings.autoAcceptCompatibleTweak, false);
            assert.equal(settings.batch_size, 25);
            configurations++;
        }
    }
    assert([...groups.values()].every(count => count === 3));
}
assert.equal(verified, 1890);
assert.equal(configurations, 84);
let mixedVerified = 0;
const compatibility = [];
for (const name of ['compatibility-old-to-new', 'compatibility-new-to-old']) {
    const result = await load(`${name}/remote/results-rtt0.json`);
    const completed = result.results.filter(entry => entry.complete);
    assert.equal(completed.length, 1);
    assert.notEqual(result.sourceCliSha256, result.targetCliSha256);
    const entry = completed[0];
    assert(entry.complete && !entry.error);
    assert.equal(entry.stages.length, 3);
    for (const stage of entry.stages) { assert.equal(stage.verifiedFiles, 15); mixedVerified += stage.verifiedFiles; }
    compatibility.push({ name, sourceCliSha256: result.sourceCliSha256, targetCliSha256: result.targetCliSha256, verifiedFiles: 45, retainedIncompleteSetupAttempts: result.results.filter(entry => !entry.complete).length });
}
const model = await load('cloudant-model/constraint-result.json');
assert(model.configurationRestored && model.sizeRejectionObserved);
assert(model.cases.some(entry => entry.customChunkSize === 4 && entry.complete));
assert(model.cases.some(entry => entry.customChunkSize === 10 && !entry.complete));
const boundary = await load('cloudant-json-boundary/results.json');
assert(boundary.configurationRestored && boundary.requestConfigurationRestored);
assert.equal(boundary.cases.length, 8);
assert.equal(boundary.batches.length, 2);
assert(boundary.batches.some(entry => entry.count === 25 && entry.status === 413 && !entry.accepted));
assert(boundary.batches.some(entry => entry.count === 20 && entry.accepted));
assert(Object.values(local.assertions).every(value => value === true || typeof value === 'number'));
const result = { completedRemoteCases: 30, completedP2PCases: 12, repeatsPerCondition: 3,
    verifiedFileStages: verified, checkedPersistedConfigurations: configurations,
    sameCorpusDigestForRemoteAndP2P: true, localAssertions: summary.assertions,
    compatibility, mixedVersionVerifiedFileStages: mixedVerified,
    cloudantConstraintModel: { candidate4Completed: true, candidate10RejectedWith413: true, fixtureConfigurationRestored: true },
    cloudantJSONBoundary: { cases: boundary.cases.length, batches: boundary.batches.length, request25RejectedWith413: true, request20Accepted: true, fixtureConfigurationRestored: true, cloudantServiceMeasured: false },
    rabinWindowDiagnostic: { command: 'node --test utils/chunk-size-benchmark/rabin-window.test.mjs', exitCode: 0, productionFixApplied: true },
};
await fs.writeFile(join(directory, 'validation.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
