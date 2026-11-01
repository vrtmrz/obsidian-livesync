import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { CLI_DIR, CLI_DIST } from "./helpers/cli.ts";
import { startIsolatedMinio, type IsolatedMinioFixture } from "./helpers/docker.ts";
import { applyRemoteSyncSettings, generateSetupUriFromSettings, initSettingsFile } from "./helpers/settings.ts";
import { TempDir } from "./helpers/temp.ts";
import { spawnProcess, type RunningProcess } from "./helpers/process.ts";

type RemoteSettings = {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    evidenceDir: string;
};

type CliResult = { code: number; stdout: string; stderr: string; combined: string };
type ScenarioMode = "reproduction" | "write-settings-control";

const SETUP_PASSPHRASE = "issue-1304-setup-passphrase";
const RESOLUTION_MARKER = "Resolving [same]: Conflicted revision has been deleted";
const INITIAL_REPLICATION_COMPLETE = "[Daemon] Initial replication complete";
const INITIAL_REPLICATION_FAILED = "[Daemon] Initial replication failed";
const VERIFY_LEGACY_FAILURE = process.env["LIVESYNC_ISSUE1304_VERIFY_LEGACY_FAILURE"] === "1";
const EXPLICIT_FIXTURE_VARIABLES = [
    "LIVESYNC_ISSUE1304_MINIO_ENDPOINT",
    "LIVESYNC_ISSUE1304_MINIO_ACCESS_KEY",
    "LIVESYNC_ISSUE1304_MINIO_SECRET_KEY",
    "LIVESYNC_ISSUE1304_MINIO_BUCKET",
];
const EXPLICIT_FIXTURE = EXPLICIT_FIXTURE_VARIABLES.some((name) => process.env[name]?.trim());

if (EXPLICIT_FIXTURE && EXPLICIT_FIXTURE_VARIABLES.some((name) => !process.env[name]?.trim())) {
    throw new Error(`External fixture mode requires all of: ${EXPLICIT_FIXTURE_VARIABLES.join(", ")}`);
}

let managedFixture: IsolatedMinioFixture | undefined;
if (!EXPLICIT_FIXTURE) {
    before(async () => {
        managedFixture = await startIsolatedMinio(
            process.env["accessKey"]?.trim() ?? "minioadmin",
            process.env["secretKey"]?.trim() ?? "minioadmin"
        );
    });
    after(async () => {
        await managedFixture?.stop();
    });
}

function requiredEnv(...names: string[]): string {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) return value;
    }
    throw new Error(`Required environment variable is missing: ${names.join(" or ")}`);
}

function evidenceDirectory(): string {
    return resolve(
        process.env["LIVESYNC_ISSUE1304_EVIDENCE_DIR"]?.trim() || join(tmpdir(), "livesync-cli-issue1304-evidence")
    );
}

function remoteSettings(): RemoteSettings {
    return {
        endpoint: requiredEnv("LIVESYNC_ISSUE1304_MINIO_ENDPOINT").replace(/\/$/, ""),
        accessKey: requiredEnv("LIVESYNC_ISSUE1304_MINIO_ACCESS_KEY"),
        secretKey: requiredEnv("LIVESYNC_ISSUE1304_MINIO_SECRET_KEY"),
        bucket: requiredEnv("LIVESYNC_ISSUE1304_MINIO_BUCKET"),
        evidenceDir: evidenceDirectory(),
    };
}

async function createManagedBucket(remote: Pick<RemoteSettings, "endpoint" | "accessKey" | "secretKey">, mode: ScenarioMode): Promise<string> {
    const shortMode = mode === "reproduction" ? "repro" : "control";
    const bucket = `livesync-ci-1304-${shortMode}-${randomUUID().replaceAll("-", "")}`;
    const client = new S3Client({
        endpoint: remote.endpoint,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId: remote.accessKey, secretAccessKey: remote.secretKey },
    });
    try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } finally {
        client.destroy();
    }
    return bucket;
}

async function scenarioRemoteSettings(mode: ScenarioMode): Promise<RemoteSettings> {
    if (EXPLICIT_FIXTURE) {
        const remote = remoteSettings();
        if (mode === "write-settings-control") remote.bucket = requiredEnv("LIVESYNC_ISSUE1304_POSITIVE_CONTROL_BUCKET");
        return remote;
    }

    if (!managedFixture) throw new Error("The managed S3 fixture was not started");
    const remote = {
        endpoint: managedFixture.endpoint,
        accessKey: managedFixture.accessKey,
        secretKey: managedFixture.secretKey,
    };
    return {
        ...remote,
        bucket: await createManagedBucket(remote, mode),
        evidenceDir: evidenceDirectory(),
    };
}

function redactText(value: string, secrets: readonly string[]): string {
    let redacted = value;
    for (const secret of secrets) {
        if (!secret) continue;
        redacted = redacted.split(secret).join("[redacted]");
        const encoded = encodeURIComponent(secret);
        if (encoded !== secret) redacted = redacted.split(encoded).join("[redacted]");
    }
    return redacted;
}

async function streamText(stream: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) onText(decoder.decode(value, { stream: true }));
        }
        const tail = decoder.decode();
        if (tail) onText(tail);
    } finally {
        reader.releaseLock();
    }
}

class CapturedCliProcess {
    readonly child: RunningProcess;
    #stdout = "";
    #stderr = "";
    #secrets = [
        process.env["LIVESYNC_ISSUE1304_MINIO_ENDPOINT"] ?? "",
        process.env["LIVESYNC_ISSUE1304_MINIO_ACCESS_KEY"] ?? "",
        process.env["LIVESYNC_ISSUE1304_MINIO_SECRET_KEY"] ?? "",
        SETUP_PASSPHRASE,
        "issue-1304-content-passphrase",
    ];
    #streamsDone: Promise<void>;

    constructor(args: string[]) {
        this.child = spawnProcess(process.execPath, {
            args: [CLI_DIST, ...args],
            cwd: CLI_DIR,
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
        });
        this.#streamsDone = Promise.all([
            streamText(this.child.stdout, (text) => (this.#stdout += text)),
            streamText(this.child.stderr, (text) => (this.#stderr += text)),
        ]).then(() => undefined);
    }

    get combined(): string {
        return this.#stdout + this.#stderr;
    }

    async waitUntil(predicate: (output: string) => boolean, description: string, timeoutMs = 60_000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (predicate(this.combined)) return;
            const tick = Math.min(100, deadline - Date.now());
            const event = await Promise.race([
                this.child.status.then((status) => ({ kind: "exit" as const, status })),
                new Promise<{ kind: "tick" }>((resolveTick) => setTimeout(() => resolveTick({ kind: "tick" }), tick)),
            ]);
            if (event.kind === "exit") {
                await this.#streamsDone;
                if (predicate(this.combined)) return;
                throw new Error(
                    `${description}; process exited with ${event.status.code}\n${redactText(this.combined, this.#secrets).slice(-5000)}`
                );
            }
        }
        throw new Error(`Timed out waiting for ${description}\n${redactText(this.combined, this.#secrets).slice(-5000)}`);
    }

    async stop(): Promise<number> {
        try {
            this.child.kill("SIGTERM");
        } catch {
            // A completed process needs no further signal.
        }
        const status = await this.child.status;
        await this.#streamsDone;
        return status.code;
    }
}

async function runCliQuietly(args: string[], input?: string): Promise<CliResult> {
    const child = spawnProcess(process.execPath, {
        args: [CLI_DIST, ...args],
        cwd: CLI_DIR,
        stdin: input === undefined ? "null" : "piped",
        stdout: "piped",
        stderr: "piped",
    });
    let stdout = "";
    let stderr = "";
    const streamsDone = Promise.all([
        streamText(child.stdout, (text) => (stdout += text)),
        streamText(child.stderr, (text) => (stderr += text)),
    ]);
    if (input !== undefined) {
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(input));
        await writer.close();
    }
    const [status] = await Promise.all([child.status, streamsDone]);
    return { code: status.code, stdout, stderr, combined: stdout + stderr };
}

function countOccurrences(value: string, needle: string): number {
    return value.split(needle).length - 1;
}

function safeCommand(
    label: string,
    result: CliResult,
    commandLog: Array<{ label: string; code: number; output: string }>,
    secrets: readonly string[]
): void {
    const output = redactText(result.combined, secrets);
    commandLog.push({ label, code: result.code, output });
    assert.equal(result.code, 0, `${label} failed with exit code ${result.code}\n${output.slice(-5000)}`);
}

async function fileState(filePath: string): Promise<{ exists: boolean; bytes?: number; sha256?: string }> {
    try {
        const contents = await readFile(filePath);
        return {
            exists: true,
            bytes: contents.byteLength,
            sha256: createHash("sha256").update(contents).digest("hex"),
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
        throw error;
    }
}

async function collectDatabaseTree(root: string, relative = ""): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
    const result: Array<{ path: string; bytes: number; sha256: string }> = [];
    let entries;
    try {
        entries = await readdir(join(root, relative), { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
        throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        if (!relative && entry.name === ".livesync") continue;
        const child = relative ? join(relative, entry.name) : entry.name;
        const absolute = join(root, child);
        if (entry.isDirectory()) {
            result.push(...(await collectDatabaseTree(root, child)));
        } else if (entry.isFile()) {
            const contents = await readFile(absolute);
            result.push({
                path: child,
                bytes: contents.byteLength,
                sha256: createHash("sha256").update(contents).digest("hex"),
            });
        }
    }
    return result;
}

async function copyDatabaseTree(source: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true });
    let entries;
    try {
        entries = await readdir(source, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    for (const entry of entries) {
        if (entry.name === ".livesync") continue;
        await cp(join(source, entry.name), join(destination, entry.name), { recursive: true, errorOnExist: false });
    }
}

async function sanitisedRuntimeState(root: string, secrets: readonly string[]): Promise<Record<string, string>> {
    const runtimeRoot = join(root, ".livesync", "runtime");
    const files: Record<string, string> = {};
    let entries;
    try {
        entries = await readdir(runtimeRoot, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return files;
        throw error;
    }
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const text = await readFile(join(runtimeRoot, entry.name), "utf8");
        try {
            files[entry.name] = JSON.stringify(JSON.parse(text), (_key, value: unknown) => {
                return typeof value === "string" ? redactText(value, secrets) : value;
            }, 2);
        } catch {
            files[entry.name] = redactText(text, secrets);
        }
    }
    return files;
}

async function settingsSummary(settingsPath: string): Promise<Record<string, unknown> | null> {
    try {
        const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
        return {
            additionalSuffixOfDatabaseName: settings.additionalSuffixOfDatabaseName ?? null,
            remoteType: settings.remoteType ?? null,
            liveSync: settings.liveSync ?? null,
            syncOnStart: settings.syncOnStart ?? null,
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

async function runScenario(mode: ScenarioMode, remote: RemoteSettings): Promise<void> {
    const evidenceRoot = remote.evidenceDir;
    const evidenceName = `${mode}-${Date.now()}-${process.pid}`;
    const evidenceDir = join(evidenceRoot, evidenceName);
    const workDir = await TempDir.create(`livesync-cli-issue1304-${mode}`);
    const scenarioId = `${Date.now()}-${process.pid}`;
    const suffix = `issue1304-${scenarioId}`;
    const targetPath = `notes/issue1304-${scenarioId}/continuity.md`;
    const initialContent = `issue-1304 initial ${scenarioId}\n`;
    const finalContent = `issue-1304 final ${scenarioId}\n`;
    const finalBytes = new TextEncoder().encode(finalContent);
    const secrets = [remote.endpoint, remote.accessKey, remote.secretKey, SETUP_PASSPHRASE, "issue-1304-content-passphrase"];
    const commandLog: Array<{ label: string; code: number; output: string }> = [];
    const processes: Record<string, CapturedCliProcess | undefined> = {};
    const settingsTimeline: Record<string, unknown> = {};
    const postResolutionInfo: Record<string, Record<string, unknown> | null> = {};
    let observedFinalFileA: { exists: boolean; bytes?: number; sha256?: string } | undefined;
    let observedFinalContentA: string | undefined;
    let setupUri: string | undefined;
    let failure: unknown;

    const databaseSeed = workDir.join("database-seed");
    const databaseA = workDir.join("database-a");
    const databaseB = workDir.join("database-b");
    const vaultSeed = workDir.join("vault-seed");
    const vaultA = workDir.join("vault-a");
    const vaultB = workDir.join("vault-b");
    const settingsSeed = workDir.join("settings-seed.json");
    const settingsA = workDir.join("settings-a.json");
    const settingsB = workDir.join("settings-b.json");
    const finalFileA = join(vaultA, targetPath);
    const finalFileB = join(vaultB, targetPath);

    try {
        await Promise.all([
            mkdir(databaseSeed, { recursive: true }),
            mkdir(databaseA, { recursive: true }),
            mkdir(databaseB, { recursive: true }),
            mkdir(vaultSeed, { recursive: true }),
            mkdir(vaultA, { recursive: true }),
            mkdir(vaultB, { recursive: true }),
        ]);
        await initSettingsFile(settingsSeed);
        await applyRemoteSyncSettings(settingsSeed, {
            remoteType: "MINIO",
            minioBucket: remote.bucket,
            minioEndpoint: remote.endpoint,
            minioAccessKey: remote.accessKey,
            minioSecretKey: remote.secretKey,
            encrypt: true,
            passphrase: "issue-1304-content-passphrase",
            usePathObfuscation: true,
        });
        const seedSettings = JSON.parse(await readFile(settingsSeed, "utf8")) as Record<string, unknown>;
        seedSettings.additionalSuffixOfDatabaseName = suffix;
        await writeFile(settingsSeed, JSON.stringify(seedSettings, null, 2));
        settingsTimeline.setupSuffix = suffix;
        setupUri = await generateSetupUriFromSettings(settingsSeed, SETUP_PASSPHRASE, true);
        secrets.push(setupUri);

        const seedRun = async (label: string, args: string[], input?: string) => {
            const result = await runCliQuietly(args, input);
            safeCommand(label, result, commandLog, secrets);
            return result;
        };

        await seedRun("seed-put-initial", [databaseSeed, "--vault", vaultSeed, "--settings", settingsSeed, "put", targetPath], initialContent);
        await seedRun("seed-sync-initial", [databaseSeed, "--vault", vaultSeed, "--settings", settingsSeed, "sync"]);
        await seedRun("seed-put-final", [databaseSeed, "--vault", vaultSeed, "--settings", settingsSeed, "put", targetPath], finalContent);
        await seedRun("seed-sync-final", [databaseSeed, "--vault", vaultSeed, "--settings", settingsSeed, "sync"]);
        const seedInfoResult = await seedRun("seed-info", [databaseSeed, "--vault", vaultSeed, "--settings", settingsSeed, "info", targetPath]);
        const seedInfo = JSON.parse(seedInfoResult.stdout) as { revision?: string; revisions?: string[] };
        const seedRevisionGeneration = Number(seedInfo.revision?.split("-")[0] ?? 0);
        assert(
            seedRevisionGeneration >= 2 && (seedInfo.revisions?.length ?? 0) >= 1,
            `Expected a remote seed revision with generation >= 2; got ${JSON.stringify({ revision: seedInfo.revision, revisions: seedInfo.revisions })}`
        );
        settingsTimeline.seedRevision = seedInfo.revision;

        await initSettingsFile(settingsA);
        await initSettingsFile(settingsB);
        const setupA = await runCliQuietly(
            [databaseA, "--vault", vaultA, "--settings", settingsA, "setup", setupUri],
            `${SETUP_PASSPHRASE}\n`
        );
        safeCommand("setup-client-a", setupA, commandLog, secrets);
        const setupB = await runCliQuietly(
            [databaseB, "--vault", vaultB, "--settings", settingsB, "setup", setupUri],
            `${SETUP_PASSPHRASE}\n`
        );
        safeCommand("setup-client-b", setupB, commandLog, secrets);

        const bFetchArgs = [databaseB, "--vault", vaultB, "--settings", settingsB, "--force", "fetch", "--write-settings"];
        const bFetch = await runCliQuietly(bFetchArgs);
        safeCommand("fetch-client-b", bFetch, commandLog, secrets);
        assert.equal(await readFile(finalFileB, "utf8"), finalContent, "Client B did not fetch the final file bytes");
        settingsTimeline.clientBSuffixAfterFetch = (await settingsSummary(settingsB))?.additionalSuffixOfDatabaseName;
        assert.equal(settingsTimeline.clientBSuffixAfterFetch, "headless-app");

        // Client B remains live so it can resolve the equal-content root after A
        // scans its old database and uploads a new root.
        processes.clientB = new CapturedCliProcess([
            "-v",
            databaseB,
            "--vault",
            vaultB,
            "--settings",
            settingsB,
            "--interval",
            "1",
            "daemon",
        ]);
        await processes.clientB.waitUntil((output) => output.includes(INITIAL_REPLICATION_COMPLETE), "Client B initial replication");

        settingsTimeline.clientASuffixBeforeFetch = (await settingsSummary(settingsA))?.additionalSuffixOfDatabaseName;
        assert.equal(settingsTimeline.clientASuffixBeforeFetch, suffix);
        const aFetchArgs = [databaseA, "--vault", vaultA, "--settings", settingsA, "--force", "fetch"];
        if (mode === "write-settings-control") aFetchArgs.push("--write-settings");
        const aFetch = await runCliQuietly(aFetchArgs);
        safeCommand("fetch-client-a", aFetch, commandLog, secrets);
        assert.equal(await readFile(finalFileA, "utf8"), finalContent, "Client A did not fetch the final file bytes");
        settingsTimeline.clientASuffixAfterFetch = (await settingsSummary(settingsA))?.additionalSuffixOfDatabaseName;
        assert.equal(
            settingsTimeline.clientASuffixAfterFetch,
            mode === "reproduction" && VERIFY_LEGACY_FAILURE ? suffix : "headless-app",
            "Client A settings suffix did not match the selected fetch mode"
        );

        // This startup selects A's persisted suffix. In the reproduction mode it
        // scans the old, empty database while the fetched bytes are in the vault.
        processes.clientAStartup = new CapturedCliProcess([
            "-v",
            databaseA,
            "--vault",
            vaultA,
            "--settings",
            settingsA,
            "daemon",
        ]);
        await processes.clientAStartup.waitUntil(
            (output) => output.includes(INITIAL_REPLICATION_COMPLETE) || output.includes(INITIAL_REPLICATION_FAILED),
            "Client A startup replication result",
            45_000
        );
        await processes.clientAStartup.stop();

        const markResolved = await runCliQuietly([databaseA, "--vault", vaultA, "--settings", settingsA, "mark-resolved"]);
        safeCommand("mark-resolved-client-a", markResolved, commandLog, secrets);

        if (mode === "reproduction" && VERIFY_LEGACY_FAILURE) {
            processes.clientA = new CapturedCliProcess([
                "-v",
                databaseA,
                "--vault",
                vaultA,
                "--settings",
                settingsA,
                "--interval",
                "1",
                "daemon",
            ]);
            await processes.clientA.waitUntil((output) => output.includes(INITIAL_REPLICATION_COMPLETE), "Client A interval daemon initial replication");

            const processingMarker = `Processing ${targetPath}`;
            const aProcessingBeforeResolution = countOccurrences(processes.clientA.combined, processingMarker);
            await processes.clientB.waitUntil((output) => output.includes(RESOLUTION_MARKER), "Client B automatic same-content resolution");
            await processes.clientA.waitUntil(
                (output) => countOccurrences(output, processingMarker) > aProcessingBeforeResolution,
                "Client A to reflect the post-resolution revision",
                45_000
            );
        } else {
            processes.clientA = new CapturedCliProcess([
                "-v",
                databaseA,
                "--vault",
                vaultA,
                "--settings",
                settingsA,
                "--interval",
                "1",
                "daemon",
            ]);
            await processes.clientA.waitUntil((output) => output.includes(INITIAL_REPLICATION_COMPLETE), "Client A control daemon initial replication");
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_500));
            assert.equal(await readFile(finalFileA, "utf8"), finalContent, "Client A control lost the fetched file");
        }
    } catch (error) {
        failure = error;
    }

    for (const processCapture of Object.values(processes)) {
        if (!processCapture) continue;
        try {
            await processCapture.stop();
        } catch (error) {
            if (failure === undefined) failure = error;
        }
    }

    try {
        await mkdir(evidenceDir, { recursive: true });
        for (const [name, database, vault, settingsPath] of [
            ["clientA", databaseA, vaultA, settingsA],
            ["clientB", databaseB, vaultB, settingsB],
        ] as const) {
            const result = await runCliQuietly([database, "--vault", vault, "--settings", settingsPath, "info", targetPath]);
            const output = redactText(result.combined, secrets);
            commandLog.push({ label: `post-resolution-info-${name}`, code: result.code, output });
            if (result.code === 0) {
                try {
                    postResolutionInfo[name] = JSON.parse(result.stdout) as Record<string, unknown>;
                } catch {
                    postResolutionInfo[name] = null;
                }
            } else {
                postResolutionInfo[name] = null;
            }
        }
        observedFinalFileA = await fileState(finalFileA);
        if (observedFinalFileA.exists) observedFinalContentA = await readFile(finalFileA, "utf8");
        const databaseTrees: Record<string, Array<{ path: string; bytes: number; sha256: string }>> = {};
        const runtimeState: Record<string, Record<string, string>> = {};
        const databasePaths = { seed: databaseSeed, clientA: databaseA, clientB: databaseB };
        for (const [name, path] of Object.entries(databasePaths)) {
            databaseTrees[name] = await collectDatabaseTree(path);
            await copyDatabaseTree(path, join(evidenceDir, `database-${name}`));
            runtimeState[name] = await sanitisedRuntimeState(path, secrets);
            if (Object.keys(runtimeState[name]).length > 0) {
                const runtimeDir = join(evidenceDir, `runtime-${name}`);
                await mkdir(runtimeDir, { recursive: true });
                for (const [fileName, contents] of Object.entries(runtimeState[name])) {
                    await writeFile(join(runtimeDir, fileName), contents);
                }
            }
        }
        const logs = Object.fromEntries(
            Object.entries(processes).map(([name, processCapture]) => [
                name,
                processCapture ? redactText(processCapture.combined, secrets) : "",
            ])
        );
        const fileStates = {
            clientA: await fileState(finalFileA),
            clientB: await fileState(finalFileB),
        };
        const evidence = {
            scenario: mode,
            targetPath,
            expectedContentBytes: finalBytes.byteLength,
            expectedContentSha256: createHash("sha256").update(finalBytes).digest("hex"),
            settingsTimeline,
            settings: {
                seed: await settingsSummary(settingsSeed),
                clientA: await settingsSummary(settingsA),
                clientB: await settingsSummary(settingsB),
            },
            fileStates,
            postResolutionInfo,
            databaseTrees,
            runtimeState,
            commands: commandLog,
            processLogs: logs,
            remote: { endpoint: "[configured]", bucket: remote.bucket },
            failure: failure instanceof Error ? redactText(failure.stack ?? failure.message, secrets) : String(failure ?? ""),
        };
        await writeFile(join(evidenceDir, "evidence.json"), JSON.stringify(evidence, null, 2));
    } catch (error) {
        if (failure === undefined) failure = error;
        else if (failure instanceof Error) {
            failure = new Error(`${failure.message}\nEvidence capture failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    await workDir[Symbol.asyncDispose]();
    if (failure !== undefined) throw failure;
    assert.equal(observedFinalFileA?.exists, true, "Client A file is absent after the resolved journal was applied");
    assert.equal(observedFinalContentA, finalContent, "Client A lost the fetched file after remote conflict resolution");
    if (!VERIFY_LEGACY_FAILURE) {
        const infoA = postResolutionInfo.clientA;
        const infoB = postResolutionInfo.clientB;
        assert(infoA && infoB, "Could not inspect both local databases after the remote resolution");
        assert.equal(infoA.conflicts, "N/A", "Client A still has a duplicate root revision after the resolution");
        assert.equal(infoA.revision, infoB.revision, "Client A did not apply the revision selected by Client B after the resolved journal");
        assert.equal(infoA.revision, settingsTimeline.seedRevision, "Daemon startup replaced the fetched revision ancestry");
        assert.equal(processes.clientB?.combined.includes(RESOLUTION_MARKER), false, "Client A created an unnecessary competing root");
    }
}

test("CLI fetch: files remain after same-content duplicate root resolution", async () => {
    await runScenario("reproduction", await scenarioRemoteSettings("reproduction"));
});

if (!EXPLICIT_FIXTURE || process.env["LIVESYNC_ISSUE1304_POSITIVE_CONTROL"] === "1") {
    test("CLI fetch: --write-settings keeps the selected database across daemon startup", async () => {
        await runScenario("write-settings-control", await scenarioRemoteSettings("write-settings-control"));
    });
}
