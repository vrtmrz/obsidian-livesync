import { assert, assertEquals } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { assertFilesEqual, runCli, runCliOrFail, runCliWithInputOrFail, sanitiseCatStdout } from "./helpers/cli.ts";
import { applyRemoteSyncSettings, initSettingsFile } from "./helpers/settings.ts";
import { startMinio, stopMinio } from "./helpers/docker.ts";

const EXTERNAL_PACK_TEST_BYTES = 9 * 1024 * 1024;

function deterministicBytes(length: number, seed: number): Uint8Array {
    const bytes = new Uint8Array(length);
    let state = seed;
    for (let index = 0; index < bytes.byteLength; index += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        bytes[index] = state & 0xff;
    }
    return bytes;
}

function requireEnv(...keys: string[]): string {
    for (const key of keys) {
        const value = Deno.env.get(key)?.trim();
        if (value) return value;
    }
    throw new Error(`Required environment variable is missing: ${keys.join(" or ")}`);
}

Deno.test("e2e: two CLI vaults synchronise through Adaptive Journal S3", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const endpoint = requireEnv("MINIO_ENDPOINT", "minioEndpoint").replace(/\/$/u, "");
    const accessKey = requireEnv("MINIO_ACCESS_KEY", "accessKey");
    const secretKey = requireEnv("MINIO_SECRET_KEY", "secretKey");
    const bucket = `${requireEnv("MINIO_BUCKET_NAME", "bucketName")}-${suffix}`;
    const passphrase = "adaptive-journal-cli-e2e-passphrase";

    await using workDir = await TempDir.create("livesync-cli-adaptive-journal-s3");
    const vaultA = workDir.join("vault-a");
    const vaultB = workDir.join("vault-b");
    const settingsA = workDir.join("settings-a.json");
    const settingsB = workDir.join("settings-b.json");
    const binarySourceA = workDir.join("source-a.bin");
    const binarySourceB = workDir.join("source-b.bin");
    const binaryDestinationA = workDir.join("destination-a.bin");
    const binaryDestinationB = workDir.join("destination-b.bin");
    await Deno.mkdir(vaultA, { recursive: true });
    await Deno.mkdir(vaultB, { recursive: true });

    const keepDocker = Deno.env.get("LIVESYNC_DEBUG_KEEP_DOCKER") === "1";
    await startMinio(endpoint, accessKey, secretKey, bucket);

    try {
        await initSettingsFile(settingsA);
        await initSettingsFile(settingsB);
        await applyRemoteSyncSettings(settingsA, {
            remoteType: "MINIO",
            minioBucket: bucket,
            minioEndpoint: endpoint,
            minioAccessKey: accessKey,
            minioSecretKey: secretKey,
            encrypt: true,
            passphrase,
            enableCompression: false,
            journalFormat: "adaptive-v1",
            packReadPolicy: "whole-pack",
        });
        await applyRemoteSyncSettings(settingsB, {
            remoteType: "MINIO",
            minioBucket: bucket,
            minioEndpoint: endpoint,
            minioAccessKey: accessKey,
            minioSecretKey: secretKey,
            encrypt: true,
            passphrase,
            enableCompression: false,
            journalFormat: "adaptive-v1",
            packReadPolicy: "range",
        });

        const textPath = "adaptive/text.md";
        const binaryPath = "adaptive/data.bin";
        await runCliWithInputOrFail(`created-by-a-${suffix}\n`, vaultA, "--settings", settingsA, "put", textPath);
        await Deno.writeFile(binarySourceA, deterministicBytes(EXTERNAL_PACK_TEST_BYTES, 0x1a2b3c4d));
        await runCliOrFail(vaultA, "--settings", settingsA, "push", binarySourceA, binaryPath);

        await runCliOrFail(vaultA, "--settings", settingsA, "sync");
        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        assertEquals(
            sanitiseCatStdout(await runCliOrFail(vaultB, "--settings", settingsB, "cat", textPath)).trimEnd(),
            `created-by-a-${suffix}`
        );
        await runCliOrFail(vaultB, "--settings", settingsB, "pull", binaryPath, binaryDestinationB);
        await assertFilesEqual(binarySourceA, binaryDestinationB, "Adaptive Journal Range transfer differs");

        await runCliWithInputOrFail(`updated-by-b-${suffix}\n`, vaultB, "--settings", settingsB, "put", textPath);
        await Deno.writeFile(binarySourceB, deterministicBytes(EXTERNAL_PACK_TEST_BYTES, 0x5e6f7788));
        await runCliOrFail(vaultB, "--settings", settingsB, "push", binarySourceB, binaryPath);
        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        await runCliOrFail(vaultA, "--settings", settingsA, "sync");
        assertEquals(
            sanitiseCatStdout(await runCliOrFail(vaultA, "--settings", settingsA, "cat", textPath)).trimEnd(),
            `updated-by-b-${suffix}`
        );
        await runCliOrFail(vaultA, "--settings", settingsA, "pull", binaryPath, binaryDestinationA);
        await assertFilesEqual(binarySourceB, binaryDestinationA, "Adaptive Journal whole-Pack transfer differs");

        await runCliOrFail(vaultA, "--settings", settingsA, "rm", binaryPath);
        await runCliOrFail(vaultA, "--settings", settingsA, "sync");
        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        const deleted = await runCli(vaultB, "--settings", settingsB, "cat", binaryPath);
        assert(deleted.code !== 0, `Deleted binary remained readable:\n${deleted.combined}`);
    } finally {
        if (!keepDocker) {
            await stopMinio().catch(() => {});
        }
    }
});
