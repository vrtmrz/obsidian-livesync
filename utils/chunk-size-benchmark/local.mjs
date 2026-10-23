import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { HashManager } from "@vrtmrz/livesync-commonlib/hashing";
import { createCorpus } from "./corpus.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, "../..");
const DEFAULT_SIZES = [0, 1, 4, 10, 20, 40, 60];
const DEFAULT_REPEATS = 3;
const ID_DERIVATION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const LEGACY_PASSPHRASE = "public-local-chunk-size-benchmark-fixture";
const CHUNK_MANAGER_WITHOUT_CACHE = {
  getCachedChunk: () => undefined,
  getChunkIDFromCache: () => false,
};

const COMMONLIB_PACKAGE_JSON = fileURLToPath(import.meta.resolve("@vrtmrz/livesync-commonlib/package.json"));
const COMMONLIB_ROOT = path.dirname(COMMONLIB_PACKAGE_JSON);
const COMMONLIB_PACKAGE = JSON.parse(await readFile(COMMONLIB_PACKAGE_JSON, "utf8"));
const { ContentSplitterRabinKarp } = await import(
  pathToFileURL(path.join(COMMONLIB_ROOT, "dist/ContentSplitter/ContentSplitterRabinKarp.js")).href
);
const { prepareChunk } = await import(
  pathToFileURL(path.join(COMMONLIB_ROOT, "dist/managers/EntryManager/EntryManagerImpls.js")).href
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArguments(args) {
  const parsed = { output: undefined, sizes: [...DEFAULT_SIZES], repeats: DEFAULT_REPEATS, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    if (argument === "--output") {
      parsed.output = value;
    } else if (argument === "--sizes") {
      parsed.sizes = value.split(",").map((item) => {
        const trimmed = item.trim();
        if (!/^\d+$/u.test(trimmed)) throw new Error(`Invalid customChunkSize value: ${item}`);
        const size = Number(trimmed);
        if (!Number.isSafeInteger(size) || size > 10000) throw new Error(`customChunkSize is out of range: ${item}`);
        return size;
      });
      if (parsed.sizes.length === 0 || new Set(parsed.sizes).size !== parsed.sizes.length) {
        throw new Error("--sizes must contain one or more distinct integers.");
      }
    } else if (argument === "--repeats") {
      if (!/^\d+$/u.test(value)) throw new Error(`Invalid repeat count: ${value}`);
      parsed.repeats = Number(value);
      if (!Number.isSafeInteger(parsed.repeats) || parsed.repeats < 1 || parsed.repeats > 100) {
        throw new Error("--repeats must be an integer from 1 to 100.");
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
    index += 1;
  }
  if (!parsed.help && !parsed.output) throw new Error("--output <dir> is required.");
  return parsed;
}

function usage() {
  return "Usage: node utils/chunk-size-benchmark/local.mjs --output <dir> [--sizes 0,1,4,10,20,40,60] [--repeats 3]";
}

function settingsFor(customChunkSize, mode) {
  return {
    chunkSplitterVersion: "v3-rabin-karp",
    customChunkSize,
    minimumChunkSize: 20,
    disableWorkerForGeneratingChunks: true,
    processSmallFilesInUIThread: false,
    encrypt: true,
    E2EEAlgorithm: "v2",
    hashAlg: "xxhash64",
    passphrase: mode === "legacy" ? LEGACY_PASSPHRASE : "",
    idDerivationVersion: mode === "primary" ? 1 : 0,
    idDerivationKey: mode === "primary" ? ID_DERIVATION_KEY : "",
    enableCompression: false,
    useEden: false,
  };
}

async function createCondition(customChunkSize) {
  const primarySettings = settingsFor(customChunkSize, "primary");
  const legacySettings = settingsFor(customChunkSize, "legacy");
  const primarySettingService = { currentSettings: () => primarySettings };
  const legacySettingService = { currentSettings: () => legacySettings };
  const splitter = new ContentSplitterRabinKarp({ settingService: primarySettingService });
  const primaryHashManager = new HashManager({ settingService: primarySettingService });
  const legacyHashManager = new HashManager({ settingService: legacySettingService });
  await Promise.all([splitter.initialised, primaryHashManager.initialise(), legacyHashManager.initialise()]);
  return { customChunkSize, splitter, primaryHashManager, legacyHashManager };
}

async function warmCondition(condition, file) {
  await splitAndHashFile(condition, file, new Map(), new Map());
}

async function loadCorpus(manifest, corpusDirectory) {
  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const loadedStages = [];
  for (const stage of manifest.stages) {
    const stageDirectory = path.join(corpusDirectory, stage.directory);
    const loadedFiles = [];
    for (const expected of stage.files) {
      const metadata = filesByPath.get(expected.path);
      if (!metadata) throw new Error(`Corpus manifest has no file metadata for ${expected.path}.`);
      const data = await readFile(path.join(stageDirectory, expected.path));
      if (data.byteLength !== expected.bytes || sha256(data) !== expected.sha256) {
        throw new Error(`Corpus file does not match its manifest: ${stage.name}/${expected.path}`);
      }
      loadedFiles.push({ ...metadata, expectedSha256: expected.sha256, data });
    }
    loadedStages.push({ name: stage.name, files: loadedFiles });
  }
  return loadedStages;
}

function decodeChunk(kind, piece) {
  return kind === "markdown" ? Buffer.from(piece, "utf8") : Buffer.from(piece, "base64");
}

function assertSameContentForId(idsToPieces, id, piece, label) {
  const existing = idsToPieces.get(id);
  if (existing !== undefined && existing !== piece) {
    throw new Error(`${label} collision: chunk ID ${id} was produced for different content.`);
  }
  if (existing === undefined) idsToPieces.set(id, piece);
}

async function splitAndHashFile(condition, file, primaryIdContents, legacyIdContents) {
  const blobType = file.kind === "markdown" ? "text/plain" : "application/octet-stream";
  const blob = new Blob([file.data], { type: blobType });
  const entry = { path: file.path, data: blob };
  const primaryChunks = [];
  const primaryCpuStart = process.cpuUsage();
  const primaryStart = process.hrtime.bigint();
  const generator = await condition.splitter.splitContent(entry);
  for await (const piece of generator) {
    const prepared = await prepareChunk(
      { hashManager: condition.primaryHashManager, chunkManager: CHUNK_MANAGER_WITHOUT_CACHE },
      piece,
    );
    assertSameContentForId(primaryIdContents, prepared.id, piece, "Primary keyed hash");
    primaryChunks.push({ piece, id: prepared.id });
  }
  const primaryElapsedMs = Number(process.hrtime.bigint() - primaryStart) / 1e6;
  const primaryCpu = process.cpuUsage(primaryCpuStart);
  const primaryCpuMs = (primaryCpu.user + primaryCpu.system) / 1000;

  const legacyCpuStart = process.cpuUsage();
  const legacyStart = process.hrtime.bigint();
  for (const chunk of primaryChunks) {
    const prepared = await prepareChunk(
      { hashManager: condition.legacyHashManager, chunkManager: CHUNK_MANAGER_WITHOUT_CACHE },
      chunk.piece,
    );
    assertSameContentForId(legacyIdContents, prepared.id, chunk.piece, "Legacy encrypted xxhash64");
    chunk.legacyId = prepared.id;
  }
  const legacyIdElapsedMs = Number(process.hrtime.bigint() - legacyStart) / 1e6;
  const legacyCpu = process.cpuUsage(legacyCpuStart);
  const legacyIdCpuMs = (legacyCpu.user + legacyCpu.system) / 1000;

  const decoded = primaryChunks.map((chunk) => decodeChunk(file.kind, chunk.piece));
  const reconstructed = Buffer.concat(decoded);
  if (!reconstructed.equals(file.data) || sha256(reconstructed) !== file.expectedSha256) {
    throw new Error(`Splitter output did not reconstruct ${file.path} in the ${file.kind} encoding.`);
  }

  const chunks = primaryChunks.map((chunk, index) => {
    const raw = decoded[index];
    return {
      id: chunk.id,
      legacyId: chunk.legacyId,
      rawBytes: raw.byteLength,
      storedUtf8Bytes: Buffer.byteLength(chunk.piece, "utf8"),
      dataSha256: sha256(raw),
      idUtf8Bytes: Buffer.byteLength(chunk.id, "utf8"),
      legacyIdUtf8Bytes: Buffer.byteLength(chunk.legacyId, "utf8"),
      piece: chunk.piece,
    };
  });
  const fingerprintInput = chunks.map(({ id, legacyId, rawBytes, dataSha256 }) => [id, legacyId, rawBytes, dataSha256]);
  const chunkFingerprintSha256 = sha256(Buffer.from(JSON.stringify(fingerprintInput), "utf8"));
  return {
    chunks,
    primaryElapsedMs,
    primaryCpuMs,
    legacyIdElapsedMs,
    legacyIdCpuMs,
    chunkFingerprintSha256,
  };
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return 0;
  return sortedValues[Math.max(0, Math.ceil(sortedValues.length * fraction) - 1)];
}

function summarizeRawChunkBytes(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? 0,
  };
}

function summariseIdLengths(chunks, key) {
  const lengths = chunks.map((chunk) => Buffer.byteLength(chunk[key], "utf8")).sort((left, right) => left - right);
  const uniqueLengths = new Map();
  for (const chunk of chunks) uniqueLengths.set(chunk[key], Buffer.byteLength(chunk[key], "utf8"));
  const uniqueValues = [...uniqueLengths.values()].sort((left, right) => left - right);
  return {
    occurrences: lengths.length,
    totalUtf8Bytes: lengths.reduce((sum, value) => sum + value, 0),
    minLengthBytes: lengths[0] ?? 0,
    medianLengthBytes: percentile(lengths, 0.5),
    maxLengthBytes: lengths.at(-1) ?? 0,
    uniqueIds: uniqueValues.length,
    uniqueTotalUtf8Bytes: uniqueValues.reduce((sum, value) => sum + value, 0),
  };
}

function uniqueById(chunks, idKey = "id") {
  const unique = new Map();
  for (const chunk of chunks) {
    if (!unique.has(chunk[idKey])) unique.set(chunk[idKey], chunk);
  }
  return unique;
}

function dataBytes(chunks, key) {
  return chunks.reduce((sum, chunk) => sum + chunk[key], 0);
}

function summarizeFile(file, measured, includeChunkArray) {
  const { chunks } = measured;
  const unique = uniqueById(chunks);
  const fileMetric = {
    path: file.path,
    kind: file.kind,
    sourceBytes: file.data.byteLength,
    chunkCount: chunks.length,
    uniqueChunkCount: unique.size,
    storedChunkDataUtf8Bytes: dataBytes(chunks, "storedUtf8Bytes"),
    uniqueChunkDataUtf8Bytes: dataBytes([...unique.values()], "storedUtf8Bytes"),
    uniqueChunkRawBytes: dataBytes([...unique.values()], "rawBytes"),
    rawChunkBytes: summarizeRawChunkBytes(chunks.map((chunk) => chunk.rawBytes)),
    primaryId: summariseIdLengths(chunks, "id"),
    legacyId: summariseIdLengths(chunks, "legacyId"),
    chunkFingerprintSha256: measured.chunkFingerprintSha256,
    timing: {
      primarySplitAndIdElapsedMs: measured.primaryElapsedMs,
      primarySplitAndIdCpuMs: measured.primaryCpuMs,
      legacyIdElapsedMs: measured.legacyIdElapsedMs,
      legacyIdCpuMs: measured.legacyIdCpuMs,
    },
  };
  if (includeChunkArray) {
    fileMetric.chunks = chunks.map(({ id, legacyId, rawBytes, storedUtf8Bytes, dataSha256, idUtf8Bytes, legacyIdUtf8Bytes }) => ({
      id,
      legacyId,
      rawBytes,
      storedUtf8Bytes,
      dataSha256,
      idUtf8Bytes,
      legacyIdUtf8Bytes,
    }));
  }
  return fileMetric;
}

function aggregateKind(stage, kind, fileResults, historyIds, previousIds) {
  const files = fileResults.filter((item) => item.file.kind === kind);
  const chunks = files.flatMap((item) => item.measured.chunks);
  const unique = uniqueById(chunks);
  const uniqueChunks = [...unique.values()];
  const newVsHistory = uniqueChunks.filter((chunk) => !historyIds.has(chunk.id));
  const newVsPrevious = previousIds === null ? null : uniqueChunks.filter((chunk) => !previousIds.has(chunk.id));
  const storedBytes = dataBytes(chunks, "storedUtf8Bytes");
  const primaryIds = summariseIdLengths(chunks, "id");
  const legacyIds = summariseIdLengths(chunks, "legacyId");

  return {
    kind,
    fileCount: files.length,
    sourceBytes: files.reduce((sum, item) => sum + item.file.data.byteLength, 0),
    chunkCount: chunks.length,
    uniqueChunkCount: unique.size,
    storedChunkDataUtf8Bytes: storedBytes,
    uniqueChunkDataUtf8Bytes: dataBytes(uniqueChunks, "storedUtf8Bytes"),
    uniqueChunkRawBytes: dataBytes(uniqueChunks, "rawBytes"),
    rawChunkBytes: summarizeRawChunkBytes(chunks.map((chunk) => chunk.rawBytes)),
    primaryId: primaryIds,
    legacyId: legacyIds,
    newUniqueChunksVsHistory: newVsHistory.length,
    newUniqueChunkDataUtf8BytesVsHistory: dataBytes(newVsHistory, "storedUtf8Bytes"),
    newUniqueChunkRawBytesVsHistory: dataBytes(newVsHistory, "rawBytes"),
    newUniqueChunksVsPreviousStage: newVsPrevious === null ? null : newVsPrevious.length,
    newUniqueChunkDataUtf8BytesVsPreviousStage: newVsPrevious === null ? null : dataBytes(newVsPrevious, "storedUtf8Bytes"),
    newUniqueChunkRawBytesVsPreviousStage: newVsPrevious === null ? null : dataBytes(newVsPrevious, "rawBytes"),
    primaryElapsedMs: files.reduce((sum, item) => sum + item.measured.primaryElapsedMs, 0),
    primaryCpuMs: files.reduce((sum, item) => sum + item.measured.primaryCpuMs, 0),
    legacyIdElapsedMs: files.reduce((sum, item) => sum + item.measured.legacyIdElapsedMs, 0),
    legacyIdCpuMs: files.reduce((sum, item) => sum + item.measured.legacyIdCpuMs, 0),
  };
}

async function runCondition(condition, stages, repeat, order, includeChunkArray) {
  const primaryIdContents = new Map();
  const legacyIdContents = new Map();
  const historyIds = new Set();
  let previousIds = null;
  const stageResults = [];

  for (const stage of stages) {
    const fileResults = [];
    for (const file of stage.files) {
      const measured = await splitAndHashFile(condition, file, primaryIdContents, legacyIdContents);
      fileResults.push({ file, measured });
    }

    const currentIds = new Set();
    for (const item of fileResults) {
      for (const chunk of item.measured.chunks) currentIds.add(chunk.id);
    }
    const kinds = [...new Set(fileResults.map((item) => item.file.kind))].sort();
    const byKind = kinds.map((kind) => aggregateKind(stage, kind, fileResults, historyIds, previousIds));
    const stageFingerprint = fileResults
      .map((item) => `${item.file.path}\0${item.measured.chunkFingerprintSha256}`)
      .sort()
      .join("\n");
    stageResults.push({
      name: stage.name,
      fingerprintSha256: sha256(Buffer.from(stageFingerprint, "utf8")),
      byKind,
      files: fileResults.map((item) => summarizeFile(item.file, item.measured, includeChunkArray)),
    });

    for (const id of currentIds) historyIds.add(id);
    previousIds = currentIds;
  }

  return { repeat, conditionOrder: order, stages: stageResults };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function orderForRepeat(sizes, repeat) {
  const offset = repeat % sizes.length;
  return [...sizes.slice(offset), ...sizes.slice(0, offset)];
}

function timingsForRuns(runs, stageName, kind) {
  const samples = runs.map((run) => {
    const stage = run.stages.find((item) => item.name === stageName);
    const group = stage.byKind.find((item) => item.kind === kind);
    return {
      repeat: run.repeat,
      primaryElapsedMs: group.primaryElapsedMs,
      primaryCpuMs: group.primaryCpuMs,
      legacyIdElapsedMs: group.legacyIdElapsedMs,
      legacyIdCpuMs: group.legacyIdCpuMs,
    };
  });
  return {
    primarySplitAndIdElapsedMsMedian: median(samples.map((sample) => sample.primaryElapsedMs)),
    primarySplitAndIdCpuMsMedian: median(samples.map((sample) => sample.primaryCpuMs)),
    legacyIdElapsedMsMedian: median(samples.map((sample) => sample.legacyIdElapsedMs)),
    legacyIdCpuMsMedian: median(samples.map((sample) => sample.legacyIdCpuMs)),
    repeats: samples,
  };
}

function timingsForFile(runs, stageName, filePath) {
  const samples = runs.map((run) => {
    const stage = run.stages.find((item) => item.name === stageName);
    const file = stage.files.find((item) => item.path === filePath);
    return { repeat: run.repeat, ...file.timing };
  });
  return {
    primarySplitAndIdElapsedMsMedian: median(samples.map((sample) => sample.primarySplitAndIdElapsedMs)),
    primarySplitAndIdCpuMsMedian: median(samples.map((sample) => sample.primarySplitAndIdCpuMs)),
    legacyIdElapsedMsMedian: median(samples.map((sample) => sample.legacyIdElapsedMs)),
    legacyIdCpuMsMedian: median(samples.map((sample) => sample.legacyIdCpuMs)),
    repeats: samples,
  };
}

function assertRepeatStability(runs, customChunkSize) {
  const first = runs[0];
  for (const run of runs.slice(1)) {
    for (const stage of first.stages) {
      const currentStage = run.stages.find((item) => item.name === stage.name);
      if (currentStage.fingerprintSha256 !== stage.fingerprintSha256) {
        throw new Error(`Chunk boundaries or IDs changed across repeats for customChunkSize=${customChunkSize}, stage=${stage.name}.`);
      }
      for (const file of stage.files) {
        const currentFile = currentStage.files.find((item) => item.path === file.path);
        if (currentFile.chunkFingerprintSha256 !== file.chunkFingerprintSha256) {
          throw new Error(`Chunk IDs changed across repeats for ${stage.name}/${file.path} at customChunkSize=${customChunkSize}.`);
        }
      }
    }
  }
}

function compareCandidateBoundaries(candidates, sizes) {
  const candidate40 = candidates.get(40);
  const candidate60 = candidates.get(60);
  if (!sizes.includes(40) || !sizes.includes(60)) return null;
  for (const stage of candidate40.stages) {
    const otherStage = candidate60.stages.find((item) => item.name === stage.name);
    for (const file of stage.files) {
      const other = otherStage.files.find((item) => item.path === file.path);
      if (file.chunkFingerprintSha256 !== other.chunkFingerprintSha256) {
        throw new Error(`customChunkSize=40 and 60 differ for ${stage.name}/${file.path}.`);
      }
    }
  }
  return {
    customChunkSize40And60SamePerFileBoundariesAndIds: true,
    comparedStages: candidate40.stages.length,
    comparedFilesPerStage: candidate40.stages[0]?.files.length ?? 0,
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const outputDirectory = path.resolve(args.output);
  const corpusDirectory = path.join(outputDirectory, "corpus");
  const resultPath = path.join(outputDirectory, "results.json");
  await mkdir(outputDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  if (COMMONLIB_PACKAGE.version !== "0.1.44") {
    throw new Error(`Expected @vrtmrz/livesync-commonlib 0.1.44, found ${COMMONLIB_PACKAGE.version}.`);
  }
  const manifest = await createCorpus(corpusDirectory, PROJECT_ROOT);
  const manifestJson = JSON.stringify(manifest);
  const corpusManifestSha256 = sha256(Buffer.from(manifestJson, "utf8"));
  const stages = await loadCorpus(manifest, corpusDirectory);
  const packageJson = JSON.parse(await readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"));

  if (ID_DERIVATION_KEY.length !== 64 || !/^[0-9a-f]{64}$/u.test(ID_DERIVATION_KEY)) {
    throw new Error("The benchmark ID derivation fixture must be 64 lower-case hex characters.");
  }

  const conditions = new Map();
  for (const size of args.sizes) {
    const condition = await createCondition(size);
    const warmupFile = stages[0].files.find((file) => file.kind === "markdown" && file.source.startsWith("repo:"));
    if (!warmupFile) throw new Error("Corpus has no repository Markdown file for warm-up.");
    await warmCondition(condition, warmupFile);
    conditions.set(size, condition);
  }

  const runsBySize = new Map(args.sizes.map((size) => [size, []]));
  for (let repeat = 0; repeat < args.repeats; repeat += 1) {
    const order = orderForRepeat(args.sizes, repeat);
    for (const size of order) {
      const includeChunkArray = repeat === 0 && (size === 40 || size === 60);
      const run = await runCondition(conditions.get(size), stages, repeat + 1, order, includeChunkArray);
      runsBySize.get(size).push(run);
    }
  }

  const candidates = new Map();
  for (const size of args.sizes) {
    const runs = runsBySize.get(size);
    assertRepeatStability(runs, size);
    const firstRun = runs[0];
    const detailedStages = firstRun.stages.map((stage) => ({
      name: stage.name,
      fingerprintSha256: stage.fingerprintSha256,
      byKind: stage.byKind.map((group) => {
        const { primaryElapsedMs, primaryCpuMs, legacyIdElapsedMs, legacyIdCpuMs, ...metrics } = group;
        return {
          ...metrics,
          timing: timingsForRuns(runs, stage.name, group.kind),
        };
      }),
      files: stage.files.map(({ timing, ...file }) => ({
        ...file,
        timing: timingsForFile(runs, stage.name, file.path),
      })),
    }));
    const candidate = {
      customChunkSize: size,
      chunkSizeCeilingBytes: Math.floor(102400 * (size + 1)),
      stages: detailedStages,
      runs: runs.map((run) => ({
        repeat: run.repeat,
        conditionOrder: run.conditionOrder,
        stages: run.stages.map((stage) => ({ name: stage.name, fingerprintSha256: stage.fingerprintSha256 })),
      })),
    };
    candidates.set(size, candidate);
  }

  const comparisons = compareCandidateBoundaries(candidates, args.sizes);
  const results = {
    schemaVersion: 1,
    benchmark: "local Rabin-Karp splitting and chunk-ID measurement",
    startedAt,
    completedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      logicalCpuCount: os.cpus().length,
      projectVersion: packageJson.version,
      commonlibVersion: COMMONLIB_PACKAGE.version,
      variant: process.env.LIVESYNC_BENCH_VARIANT || "unlabelled",
      commonlibChunksSha256: sha256(await readFile(path.join(COMMONLIB_ROOT, "dist/string_and_binary/chunks.js"))),
    },
    settings: {
      splitter: "v3-rabin-karp",
      minimumChunkSize: 20,
      workerDisabled: true,
      E2EEAlgorithm: "v2",
      encrypt: true,
      hashAlg: "xxhash64",
      primaryIdDerivation: {
        version: 1,
        keyFixture: "fixed public benchmark fixture; 64 lower-case hex characters omitted",
      },
      legacyIdComparison: {
        idDerivationVersion: 0,
        algorithm: "encrypted xxhash64 with the fixed public legacy passphrase fixture",
        passphrase: "omitted",
      },
      enableCompression: false,
      useEden: false,
      customChunkSizeValues: args.sizes,
      warmup: "one actual repository Markdown file per condition; excluded from timings",
      timings: "primary includes splitting and actual EntryManager prepareChunk hashing; legacy timing hashes the same emitted chunks separately",
    },
    corpus: {
      seed: manifest.seed,
      manifestSha256: corpusManifestSha256,
      fileCount: manifest.files.length,
      stages: manifest.stages.map((stage) => ({
        name: stage.name,
        directory: stage.directory,
        fileCount: stage.files.length,
        sourceBytes: stage.files.reduce((sum, file) => sum + file.bytes, 0),
      })),
    },
    assertions: {
      everyFileReconstructedFromSplitterOutput: true,
      duplicateIdsHadIdenticalChunkContent: true,
      sameBoundariesAndIdsAcrossRepeats: true,
      ...(comparisons ?? {}),
    },
    candidates: [...candidates.values()],
    scope: "Local splitting and hashing only; no network or request timing is measured.",
  };

  await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ resultPath, corpusManifestSha256, candidateCount: args.sizes.length, repeats: args.repeats })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
