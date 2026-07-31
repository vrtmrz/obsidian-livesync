import { assert, assertEquals } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { assertFilesEqual, runCli, runCliOrFail, runCliWithInputOrFail, sanitiseCatStdout } from "./helpers/cli.ts";
import { applyRemoteSyncSettings, initSettingsFile } from "./helpers/settings.ts";
import { listMinioObjectKeys, startMinio, stopMinio } from "./helpers/docker.ts";

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
    const binarySource = workDir.join("source.bin");
    const binaryDestination = workDir.join("destination.bin");
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
            journalFormat: "adaptive-v1",
            packReadPolicy: "range",
        });

        const textPath = "adaptive/text.md";
        const binaryPath = "adaptive/data.bin";
        await runCliWithInputOrFail(`created-by-a-${suffix}\n`, vaultA, "--settings", settingsA, "put", textPath);
        const binary = Uint8Array.from({ length: 8192 }, (_, index) => (index * 31 + 17) % 256);
        await Deno.writeFile(binarySource, binary);
        await runCliOrFail(vaultA, "--settings", settingsA, "push", binarySource, binaryPath);

        await runCliOrFail(vaultA, "--settings", settingsA, "sync");
        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        assertEquals(
            sanitiseCatStdout(await runCliOrFail(vaultB, "--settings", settingsB, "cat", textPath)).trimEnd(),
            `created-by-a-${suffix}`
        );
        await runCliOrFail(vaultB, "--settings", settingsB, "pull", binaryPath, binaryDestination);
        await assertFilesEqual(binarySource, binaryDestination, "Adaptive Journal binary transfer differs");

        await runCliWithInputOrFail(`updated-by-b-${suffix}\n`, vaultB, "--settings", settingsB, "put", textPath);
        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        await runCliOrFail(vaultA, "--settings", settingsA, "sync");
        assertEquals(
            sanitiseCatStdout(await runCliOrFail(vaultA, "--settings", settingsA, "cat", textPath)).trimEnd(),
            `updated-by-b-${suffix}`
        );

        await runCliOrFail(vaultA, "--settings", settingsA, "rm", binaryPath);
        await runCliOrFail(vaultA, "--settings", settingsA, "sync");
        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        const deleted = await runCli(vaultB, "--settings", settingsB, "cat", binaryPath);
        assert(deleted.code !== 0, `Deleted binary remained readable:\n${deleted.combined}`);

        const objectKeys = await listMinioObjectKeys(endpoint, accessKey, secretKey, bucket);
        assert(objectKeys.includes("a1~manifest.json"), `Adaptive manifest is missing:\n${objectKeys.join("\n")}`);
        for (const prefix of ["a1~writer~", "a1~pack~", "a1~index~", "a1~delta~", "a1~metadata~", "a1~commit~"]) {
            assert(
                objectKeys.some((key) => key.startsWith(prefix)),
                `Adaptive object with prefix ${prefix} is missing:\n${objectKeys.join("\n")}`
            );
        }
        assert(
            !objectKeys.some((key) => key.startsWith("a1~probe~")),
            `Adaptive capability probe objects were not removed:\n${objectKeys.join("\n")}`
        );
        assert(
            !objectKeys.includes("_00000000-milestone.json"),
            `Legacy Journal milestone was written into the Adaptive repository:\n${objectKeys.join("\n")}`
        );
    } finally {
        if (!keepDocker) {
            await stopMinio().catch(() => {});
        }
    }
});
