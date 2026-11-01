import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TempDir } from "./helpers/temp.ts";
import { assertFilesEqual, runCliOrFail, sanitiseCatStdout } from "./helpers/cli.ts";
import { applyRemoteSyncSettings, initSettingsFile } from "./helpers/settings.ts";
import { startMinio, stopMinio } from "./helpers/docker.ts";

function requireEnv(...keys: string[]): string {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    throw new Error(`Required env var is missing: ${keys.join(" or ")}`);
}

function createJournalRecoveryBucketName(baseBucket: string, suffix: string): string {
    const bucketSuffix = `journal-recovery-${suffix}`;
    const maxBaseLength = 63 - bucketSuffix.length - 1;
    const truncatedBase = baseBucket.slice(0, maxBaseLength).replace(/-+$/, "");
    return truncatedBase ? `${truncatedBase}-${bucketSuffix}` : bucketSuffix;
}

function createJournalFixture(): string {
    return [
        "Journal chunk recovery fixture: UTF-8, newlines, and backslashes.\n",
        ...Array.from(
            { length: 128 },
            (_, index) =>
                `record ${String(index).padStart(3, "0")}: prefix\\path café 日本語 \u001f middle-${index} \u001f suffix-${index} remains after the separator.\n`
        ),
        "Final suffix after every control separator remains present.\n",
    ].join("");
}

async function runScenario(encrypt: boolean): Promise<void> {
    const suffix = `${encrypt ? "enc1" : "enc0"}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const minioEndpoint = requireEnv("MINIO_ENDPOINT", "minioEndpoint").replace(/\/$/, "");
    const minioAccessKey = requireEnv("MINIO_ACCESS_KEY", "accessKey");
    const minioSecretKey = requireEnv("MINIO_SECRET_KEY", "secretKey");
    const minioBucket = createJournalRecoveryBucketName(requireEnv("MINIO_BUCKET_NAME", "bucketName"), suffix);
    const passphrase = "e2e-passphrase";
    const fileContent = createJournalFixture();
    const expectedBytes = Buffer.from(fileContent, "utf8");
    const targetPath = "e2e/journal-chunk-recovery.md";
    const keepDocker = process.env["LIVESYNC_DEBUG_KEEP_DOCKER"] === "1";

    await using workDir = await TempDir.create(`livesync-cli-journal-recovery-${suffix}`);
    const sourceDatabase = workDir.join("source-db");
    const receiverDatabase = workDir.join("receiver-db");
    const sourceVault = workDir.join("source-vault");
    const receiverVault = workDir.join("receiver-vault");
    const sourceSettings = workDir.join("source-settings.json");
    const receiverSettings = workDir.join("receiver-settings.json");
    const sourceFile = join(sourceVault, targetPath);
    const receiverFile = join(receiverVault, targetPath);
    await Promise.all([
        mkdir(sourceDatabase, { recursive: true }),
        mkdir(receiverDatabase, { recursive: true }),
        mkdir(sourceVault, { recursive: true }),
        mkdir(receiverVault, { recursive: true }),
    ]);
    await mkdir(dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, expectedBytes);

    try {
        await startMinio(minioEndpoint, minioAccessKey, minioSecretKey, minioBucket);
        await initSettingsFile(sourceSettings);
        await initSettingsFile(receiverSettings);
        await applyRemoteSyncSettings(sourceSettings, {
            remoteType: "MINIO",
            minioBucket,
            minioEndpoint,
            minioAccessKey,
            minioSecretKey,
            encrypt,
            passphrase,
            enableCompression: false,
        });
        await applyRemoteSyncSettings(receiverSettings, {
            remoteType: "MINIO",
            minioBucket,
            minioEndpoint,
            minioAccessKey,
            minioSecretKey,
            encrypt,
            passphrase,
            enableCompression: false,
        });

        await runCliOrFail(
            sourceDatabase,
            "--settings",
            sourceSettings,
            "--vault",
            sourceVault,
            "rebuild",
            "--force",
            "--write-settings"
        );
        await runCliOrFail(
            receiverDatabase,
            "--settings",
            receiverSettings,
            "--vault",
            receiverVault,
            "fetch",
            "--force",
            "--write-settings"
        );

        await assertFilesEqual(sourceFile, receiverFile, "Fetched Vault file does not match the rebuild source");
        const fetchedContent = sanitiseCatStdout(
            await runCliOrFail(receiverDatabase, "--settings", receiverSettings, "cat", targetPath)
        );
        assert.equal(fetchedContent, fileContent, "A fresh CLI process should read the exact fetched file content");

        const damagedContent = "Damaged receiver Vault copy; the remote still has the complete source.\n";
        await writeFile(receiverFile, damagedContent);
        await runCliOrFail(
            receiverDatabase,
            "--settings",
            receiverSettings,
            "--vault",
            receiverVault,
            "fetch",
            "--force",
            "--write-settings"
        );

        assert.equal(
            await readFile(receiverFile, "utf8"),
            damagedContent,
            "Fetch does not forcibly overwrite a newer local file"
        );
        const info: unknown = JSON.parse(
            await runCliOrFail(receiverDatabase, "--settings", receiverSettings, "info", targetPath)
        );
        assert.ok(info && typeof info === "object" && "revision" in info && "conflicts" in info);
        assert.ok(typeof info.revision === "string" && typeof info.conflicts === "string");
        assert.match(info.revision, /^1-[\da-f]+$/, "The fetched file should retain an independent root");
        assert.match(info.conflicts, /^1-[\da-f]+$/, "The differing local file should be preserved as a conflict");
        assert.notEqual(info.revision, info.conflicts);
        const retainedContents: string[] = [];
        for (const revision of [info.revision, info.conflicts]) {
            retainedContents.push(
                sanitiseCatStdout(
                    await runCliOrFail(
                        receiverDatabase,
                        "--settings",
                        receiverSettings,
                        "cat-rev",
                        targetPath,
                        revision
                    )
                )
            );
        }
        assert.deepEqual(
            retainedContents.sort(),
            [fileContent, damagedContent].sort(),
            "Fetch should retain both the intact remote and differing local contents without inferring their ancestry"
        );
        await rename(receiverFile, workDir.join("damaged-vault-backup.md"));
        await runCliOrFail(
            receiverDatabase,
            "--settings",
            receiverSettings,
            "--vault",
            receiverVault,
            "fetch",
            "--force",
            "--write-settings"
        );
        await assertFilesEqual(sourceFile, receiverFile, "Fetching into an empty Vault should restore the remote file");
        assert.equal(await readFile(workDir.join("damaged-vault-backup.md"), "utf8"), damagedContent);
        const restoredContent = sanitiseCatStdout(
            await runCliOrFail(receiverDatabase, "--settings", receiverSettings, "cat", targetPath)
        );
        assert.equal(restoredContent, fileContent, "A repeated fetch should retain the remote file content");
        assert.deepEqual(
            await readFile(sourceFile),
            expectedBytes,
            "The complete source Vault fixture should remain intact"
        );
    } finally {
        if (!keepDocker) {
            await stopMinio().catch(() => {});
        }
    }
}

test("journal recovery bucket name construction stays within S3 limits", () => {
    const ciBucket = createJournalRecoveryBucketName("livesync-test-bucket-ci", "enc0-1793522628122-62377");
    assert.ok(ciBucket.length <= 63, "The CI fixture must stay within the S3 bucket-name length limit");
    assert.match(ciBucket, /^[a-z0-9][a-z0-9-]*[a-z0-9]$/);

    const longBase = "a".repeat(63);
    const unencryptedBucket = createJournalRecoveryBucketName(longBase, "enc0-1793522628122-62377");
    const encryptedBucket = createJournalRecoveryBucketName(longBase, "enc1-1793522628122-62377");
    assert.ok(unencryptedBucket.length <= 63);
    assert.ok(encryptedBucket.length <= 63);
    assert.match(unencryptedBucket, /^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    assert.match(encryptedBucket, /^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    assert.notEqual(unencryptedBucket, encryptedBucket, "Encryption scenarios should have distinct buckets");
});

test("journal chunk recovery through MINIO", async (t) => {
    await t.test("without encryption", async () => runScenario(false));
    await t.test("with encryption", async () => runScenario(true));
});
