import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli, runCliOrFail, sanitiseCatStdout } from "./helpers/cli.ts";
import { startMinio, stopMinio } from "./helpers/docker.ts";
import { TempDir } from "./helpers/temp.ts";
import { applyRemoteSyncSettings, initSettingsFile } from "./helpers/settings.ts";

type JsonObject = Record<string, unknown>;

function requireEnv(...keys: string[]): string {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    throw new Error(`Required env var is missing: ${keys.join(" or ")}`);
}

function createJournalReceiveBucketName(baseBucket: string, suffix: string): string {
    const bucketSuffix = `journal-receive-${suffix}`;
    const maxBaseLength = 63 - bucketSuffix.length - 1;
    const truncatedBase = baseBucket.slice(0, maxBaseLength).replace(/-+$/, "");
    return truncatedBase ? `${truncatedBase}-${bucketSuffix}` : bucketSuffix;
}

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listJournalKeys(client: S3Client, bucket: string): Promise<string[]> {
    const result = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    assert.equal(result.IsTruncated, false, "The disposable test bucket should fit in one S3 listing page");
    return (result.Contents ?? [])
        .flatMap(({ Key }) => (Key && /^\d+-docs\.jsonl\.gz$/u.test(Key) ? [Key] : []))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

async function addedJournalKey(client: S3Client, bucket: string, before: Set<string>): Promise<string> {
    const added = (await listJournalKeys(client, bucket)).filter((key) => !before.has(key));
    assert.equal(added.length, 1, `Expected one new Journal object, got: ${added.join(", ")}`);
    const [key] = added;
    assert.ok(key);
    return key;
}

async function withCorruptedJournals(
    client: S3Client,
    bucket: string,
    keys: string[],
    action: () => Promise<void>
): Promise<void> {
    const originals = await Promise.all(
        keys.map(async (key) => {
            const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const body = response.Body;
            assert.ok(body, `Could not read the original Journal bytes for ${key}`);
            const bytes = await body.transformToByteArray();
            assert.ok(bytes.length > 0, `The owned Journal object ${key} was empty`);
            return { key, bytes };
        })
    );

    try {
        await Promise.all(
            originals.map(({ key }) =>
                client.send(
                    new PutObjectCommand({
                        Bucket: bucket,
                        Key: key,
                        Body: Uint8Array.of(0xff, 0xff, 0xff),
                    })
                )
            )
        );
        await action();
    } finally {
        await Promise.all(
            originals.map(({ key, bytes }) =>
                client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }))
            )
        );
    }
}

async function readReceivedJournalKeys(databasePath: string): Promise<Set<string>> {
    const scopeRoot = join(databasePath, ".livesync", "runtime", "scopes");
    const files = await readdir(scopeRoot, { recursive: true });
    for (const relativePath of files.filter((file) => file.endsWith("keyvalue-db.json"))) {
        const stored: unknown = JSON.parse(await readFile(join(scopeRoot, relativePath), "utf8"));
        if (!isJsonObject(stored)) continue;
        const entry = Object.entries(stored).find(([key]) => key.includes("bucketsync-checkpoint-"));
        if (!entry || !isJsonObject(entry[1])) continue;
        const receivedFiles = entry[1]["receivedFiles"];
        if (!isJsonObject(receivedFiles)) continue;
        const values = receivedFiles["values"];
        if (receivedFiles["__nodeKvType"] !== "Set" || !Array.isArray(values)) continue;
        return new Set(values.filter((value): value is string => typeof value === "string"));
    }
    throw new Error(`Journal receive checkpoint was not found under ${scopeRoot}`);
}

async function runScenario(encrypt: boolean): Promise<void> {
    const suffix = `${encrypt ? "enc1" : "enc0"}-${Date.now()}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const minioEndpoint = requireEnv("MINIO_ENDPOINT", "minioEndpoint").replace(/\/$/, "");
    const minioAccessKey = requireEnv("MINIO_ACCESS_KEY", "accessKey");
    const minioSecretKey = requireEnv("MINIO_SECRET_KEY", "secretKey");
    const minioBucket = createJournalReceiveBucketName(requireEnv("MINIO_BUCKET_NAME", "bucketName"), suffix);
    const passphrase = "journal-receive-e2e-passphrase";
    const keepDocker = process.env["LIVESYNC_DEBUG_KEEP_DOCKER"] === "1";
    const stablePath = "e2e/stable.md";
    const middlePath = "e2e/middle.md";
    const secondBrokenPath = "e2e/second-broken.md";
    const laterPath = "e2e/later.md";
    const stableV1 = "Stable file revision one.\n";
    const middleContent = "Content in the intermediate Journal.\n";
    const secondBrokenContent = "Content in the next intermediate Journal.\n";
    const stableV2 = "Stable file revision two.\n";
    const laterContent = "Later Journal content.\n";

    await using workDir = await TempDir.create(`livesync-cli-journal-receive-${suffix}`);
    const sourceDatabase = workDir.join("source-db");
    const sourceVault = workDir.join("source-vault");
    const sourceSettings = workDir.join("source-settings.json");
    const defaultDatabase = workDir.join("default-receiver-db");
    const defaultVault = workDir.join("default-receiver-vault");
    const defaultSettings = workDir.join("default-receiver-settings.json");
    const skipDatabase = workDir.join("skip-receiver-db");
    const skipVault = workDir.join("skip-receiver-vault");
    const skipSettings = workDir.join("skip-receiver-settings.json");
    const sourceStableFile = join(sourceVault, stablePath);
    const sourceMiddleFile = join(sourceVault, middlePath);
    const sourceSecondBrokenFile = join(sourceVault, secondBrokenPath);
    const sourceLaterFile = join(sourceVault, laterPath);
    const commonSettings = {
        remoteType: "MINIO" as const,
        minioBucket,
        minioEndpoint,
        minioAccessKey,
        minioSecretKey,
        encrypt,
        passphrase,
        enableCompression: false,
    };
    const client = new S3Client({
        endpoint: minioEndpoint,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId: minioAccessKey, secretAccessKey: minioSecretKey },
    });

    await Promise.all([
        mkdir(sourceDatabase, { recursive: true }),
        mkdir(sourceVault, { recursive: true }),
        mkdir(defaultDatabase, { recursive: true }),
        mkdir(defaultVault, { recursive: true }),
        mkdir(skipDatabase, { recursive: true }),
        mkdir(skipVault, { recursive: true }),
    ]);
    await mkdir(dirname(sourceStableFile), { recursive: true });
    await writeFile(sourceStableFile, stableV1);

    try {
        await startMinio(minioEndpoint, minioAccessKey, minioSecretKey, minioBucket);
        await Promise.all([
            initSettingsFile(sourceSettings),
            initSettingsFile(defaultSettings),
            initSettingsFile(skipSettings),
        ]);
        await Promise.all([
            applyRemoteSyncSettings(sourceSettings, commonSettings),
            applyRemoteSyncSettings(defaultSettings, commonSettings),
            applyRemoteSyncSettings(skipSettings, commonSettings),
        ]);
        const runSource = (...args: string[]) =>
            runCliOrFail(sourceDatabase, "--settings", sourceSettings, "--vault", sourceVault, ...args);
        const runDefault = (...args: string[]) =>
            runCliOrFail(defaultDatabase, "--settings", defaultSettings, "--vault", defaultVault, ...args);
        const tryDefault = (...args: string[]) =>
            runCli(defaultDatabase, "--settings", defaultSettings, "--vault", defaultVault, ...args);
        const runSkip = (...args: string[]) =>
            runCliOrFail(skipDatabase, "--settings", skipSettings, "--vault", skipVault, ...args);
        const trySkip = (...args: string[]) =>
            runCli(skipDatabase, "--settings", skipSettings, "--vault", skipVault, ...args);

        const beforeInitial = new Set(await listJournalKeys(client, minioBucket));
        await runSource("rebuild", "--force", "--write-settings");
        const firstJournalKey = await addedJournalKey(client, minioBucket, beforeInitial);
        await runDefault("fetch", "--force", "--write-settings");
        await runSkip("fetch", "--force", "--write-settings");
        const firstInfo = JSON.parse(await runSource("info", stablePath)) as JsonObject;
        assert.equal(typeof firstInfo["revision"], "string");
        const firstRevision = firstInfo["revision"] as string;
        for (const receiver of [
            { name: "default receiver", database: defaultDatabase, run: runDefault },
            { name: "skip receiver", database: skipDatabase, run: runSkip },
        ]) {
            assert.equal(
                sanitiseCatStdout(await receiver.run("cat", stablePath)),
                stableV1,
                `${receiver.name} should fetch the initial healthy Journal content`
            );
            const checkpoint = await readReceivedJournalKeys(receiver.database);
            assert.ok(
                checkpoint.has(firstJournalKey),
                `${receiver.name} should checkpoint the initial healthy Journal`
            );
            const info = JSON.parse(await receiver.run("info", stablePath)) as JsonObject;
            assert.equal(info["revision"], firstRevision, `${receiver.name} should retain the first source revision`);
            assert.equal(
                sanitiseCatStdout(await receiver.run("cat-rev", stablePath, firstRevision)),
                stableV1,
                `${receiver.name} should retain the first revision contents`
            );
        }

        await mkdir(dirname(sourceMiddleFile), { recursive: true });
        await writeFile(sourceMiddleFile, middleContent);
        await runSource("push", sourceMiddleFile, middlePath);
        const beforeMiddle = new Set(await listJournalKeys(client, minioBucket));
        await runSource("sync");
        const brokenJournalKey = await addedJournalKey(client, minioBucket, beforeMiddle);

        await mkdir(dirname(sourceSecondBrokenFile), { recursive: true });
        await writeFile(sourceSecondBrokenFile, secondBrokenContent);
        await runSource("push", sourceSecondBrokenFile, secondBrokenPath);
        const beforeSecondBroken = new Set(await listJournalKeys(client, minioBucket));
        await runSource("sync");
        const secondBrokenJournalKey = await addedJournalKey(client, minioBucket, beforeSecondBroken);

        await writeFile(sourceStableFile, stableV2);
        await writeFile(sourceLaterFile, laterContent);
        await runSource("push", sourceStableFile, stablePath);
        await runSource("push", sourceLaterFile, laterPath);
        const beforeLater = new Set(await listJournalKeys(client, minioBucket));
        await runSource("sync");
        const laterJournalKey = await addedJournalKey(client, minioBucket, beforeLater);
        assert.ok(firstJournalKey.localeCompare(brokenJournalKey, undefined, { numeric: true }) < 0);
        assert.ok(brokenJournalKey.localeCompare(secondBrokenJournalKey, undefined, { numeric: true }) < 0);
        assert.ok(secondBrokenJournalKey.localeCompare(laterJournalKey, undefined, { numeric: true }) < 0);

        const finalInfo = JSON.parse(await runSource("info", stablePath)) as JsonObject;
        assert.equal(typeof finalInfo["revision"], "string");
        const finalRevision = finalInfo["revision"] as string;
        assert.notEqual(finalRevision, firstRevision);

        await withCorruptedJournals(client, minioBucket, [brokenJournalKey, secondBrokenJournalKey], async () => {
            const failedSync = await tryDefault("sync");
            assert.equal(failedSync.code, 1, "Default receive must report failure for a corrupt Journal");
            assert.match(failedSync.stderr, /\[Error\] Command 'sync' failed/);
            const debugRetry = await tryDefault("--debug", "sync");
            assert.equal(debugRetry.code, 1, "Debug retry must still report the corrupt Journal");
            assert.ok(debugRetry.stderr.includes(`Receive Journal ${brokenJournalKey} failed at `));

            const checkpoint = await readReceivedJournalKeys(defaultDatabase);
            assert.ok(checkpoint.has(firstJournalKey), "Completed earlier Journal must remain checkpointed");
            assert.equal(checkpoint.has(brokenJournalKey), false, "Failed Journal must not be checkpointed");
            assert.equal(
                checkpoint.has(secondBrokenJournalKey),
                false,
                "A later failed Journal must not be checkpointed"
            );
            assert.equal(checkpoint.has(laterJournalKey), false, "Failure must prevent checkpointing a later Journal");
            assert.equal(
                sanitiseCatStdout(await runDefault("cat", stablePath)),
                stableV1,
                "The earlier Journal content must remain available after the later failure"
            );
            assert.notEqual(
                (await tryDefault("cat", middlePath)).code,
                0,
                "The broken Journal content must not be applied"
            );
            assert.notEqual(
                (await tryDefault("cat", secondBrokenPath)).code,
                0,
                "The next broken Journal content must not be applied"
            );
            assert.notEqual(
                (await tryDefault("cat", laterPath)).code,
                0,
                "A later Journal must not pass the failed Journal"
            );
        });

        await runDefault("sync");
        assert.equal(sanitiseCatStdout(await runDefault("cat", middlePath)), middleContent);
        assert.equal(sanitiseCatStdout(await runDefault("cat", secondBrokenPath)), secondBrokenContent);
        assert.equal(sanitiseCatStdout(await runDefault("cat", stablePath)), stableV2);
        assert.equal(sanitiseCatStdout(await runDefault("cat", laterPath)), laterContent);
        const retriedCheckpoint = await readReceivedJournalKeys(defaultDatabase);
        for (const key of [firstJournalKey, brokenJournalKey, secondBrokenJournalKey, laterJournalKey]) {
            assert.ok(retriedCheckpoint.has(key), `Retry should checkpoint Journal ${key}`);
        }
        const retriedInfo = JSON.parse(await runDefault("info", stablePath)) as JsonObject;
        assert.equal(retriedInfo["revision"], finalRevision, "Retry should preserve the source stable-file revision");
        assert.equal(
            sanitiseCatStdout(await runDefault("cat-rev", stablePath, firstRevision)),
            stableV1,
            "Retry should retain the earlier stable-file revision"
        );

        await withCorruptedJournals(client, minioBucket, [brokenJournalKey, secondBrokenJournalKey], async () => {
            const firstSkip = await trySkip("journal-skip", brokenJournalKey);
            assert.notEqual(
                firstSkip.code,
                0,
                `Skipping the first Journal should stop at the next broken Journal: ${firstSkip.combined}`
            );
            assert.ok(firstSkip.combined.includes(brokenJournalKey), "The first skip must identify its Journal key");
            assert.match(firstSkip.stderr, /\[Error\] Command 'journal-skip' failed/);
            const nextFailure = await trySkip("--debug", "sync");
            assert.equal(nextFailure.code, 1, "Debug retry must stop at the next broken Journal");
            assert.ok(
                nextFailure.stderr.includes(`Receive Journal ${secondBrokenJournalKey} failed at `),
                "Debug retry must identify the next broken Journal and its failure stage"
            );

            const firstSkipCheckpoint = await readReceivedJournalKeys(skipDatabase);
            assert.ok(firstSkipCheckpoint.has(firstJournalKey));
            assert.ok(firstSkipCheckpoint.has(brokenJournalKey), "The requested Journal should be skipped");
            assert.equal(
                firstSkipCheckpoint.has(secondBrokenJournalKey),
                false,
                "The first skip must not acknowledge the next failed Journal"
            );
            assert.equal(firstSkipCheckpoint.has(laterJournalKey), false);
            assert.equal(sanitiseCatStdout(await runSkip("cat", stablePath)), stableV1);
            assert.notEqual((await trySkip("cat", middlePath)).code, 0);
            assert.notEqual((await trySkip("cat", secondBrokenPath)).code, 0);
            assert.notEqual((await trySkip("cat", laterPath)).code, 0);

            const secondSkip = await trySkip("--debug", "journal-skip", secondBrokenJournalKey);
            assert.equal(secondSkip.code, 0, `Explicit second skip should resume replication: ${secondSkip.combined}`);
            assert.ok(secondSkip.combined.includes(secondBrokenJournalKey), "The second skip must identify its key");
            assert.match(
                secondSkip.combined,
                /decrypt|inflate|decompress|decode|parse|persist|apply/i,
                "The second skip attempt must report the failed Journal processing stage"
            );
            const checkpoint = await readReceivedJournalKeys(skipDatabase);
            for (const key of [firstJournalKey, brokenJournalKey, secondBrokenJournalKey, laterJournalKey]) {
                assert.ok(checkpoint.has(key), `Explicit skips should advance past Journal ${key}`);
            }
            assert.equal(sanitiseCatStdout(await runSkip("cat", stablePath)), stableV2);
            assert.equal(sanitiseCatStdout(await runSkip("cat", laterPath)), laterContent);
            assert.notEqual((await trySkip("cat", middlePath)).code, 0);
            assert.notEqual((await trySkip("cat", secondBrokenPath)).code, 0);
            const skippedInfo = JSON.parse(await runSkip("info", stablePath)) as JsonObject;
            assert.equal(skippedInfo["revision"], finalRevision, "Later valid data should retain its source revision");
            assert.equal(
                sanitiseCatStdout(await runSkip("cat-rev", stablePath, firstRevision)),
                stableV1,
                "Later valid data should retain earlier revision history"
            );
        });
    } finally {
        client.destroy();
        if (!keepDocker) {
            await stopMinio().catch(() => {});
        }
    }
}

test("journal receive failure, retry, and targeted skips through MINIO", async (t) => {
    await t.test("without encryption", async () => runScenario(false));
    await t.test("with encryption", async () => runScenario(true));
});
