import { assert } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import {
    runCli,
    runCliOrFail,
    runCliWithInputOrFail,
    sanitiseCatStdout,
    assertFilesEqual,
    jsonStringField,
} from "./helpers/cli.ts";
import { applyRemoteSyncSettings, initSettingsFile } from "./helpers/settings.ts";
import { startCouchdb, startMinio, stopCouchdb, stopMinio } from "./helpers/docker.ts";
type RemoteType = "COUCHDB" | "MINIO";

function requireEnv(...keys: string[]): string {
    for (const key of keys) {
        const value = Deno.env.get(key)?.trim();
        if (value) return value;
    }
    throw new Error(`Required env var is missing: ${keys.join(" or ")}`);
}

export async function runScenario(remoteType: RemoteType, encrypt: boolean): Promise<void> {
    const dbSuffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const couchdbUri = remoteType === "COUCHDB" ? requireEnv("COUCHDB_URI", "hostname").replace(/\/$/, "") : "";
    const couchdbUser = remoteType === "COUCHDB" ? requireEnv("COUCHDB_USER", "username") : "";
    const couchdbPassword = remoteType === "COUCHDB" ? requireEnv("COUCHDB_PASSWORD", "password") : "";
    const dbPrefix = remoteType === "COUCHDB" ? requireEnv("COUCHDB_DBNAME", "dbname") : "";
    const dbname = remoteType === "COUCHDB" ? `${dbPrefix}-${dbSuffix}` : "";

    const minioEndpoint = remoteType === "MINIO" ? requireEnv("MINIO_ENDPOINT", "minioEndpoint").replace(/\/$/, "") : "";
    const minioAccessKey = remoteType === "MINIO" ? requireEnv("MINIO_ACCESS_KEY", "accessKey") : "";
    const minioSecretKey = remoteType === "MINIO" ? requireEnv("MINIO_SECRET_KEY", "secretKey") : "";
    const minioBucketBase = remoteType === "MINIO" ? requireEnv("MINIO_BUCKET_NAME", "bucketName") : "";
    const minioBucket = remoteType === "MINIO" ? `${minioBucketBase}-${dbSuffix}` : "";

    const passphrase = "e2e-passphrase";

    await using workDir = await TempDir.create(
        `livesync-cli-e2e-${remoteType.toLowerCase()}-${encrypt ? "enc1" : "enc0"}`
    );
    const vaultA = workDir.join("testvault_a");
    const vaultB = workDir.join("testvault_b");
    const settingsA = workDir.join("test-settings-a.json");
    const settingsB = workDir.join("test-settings-b.json");
    const pushSrc = workDir.join("push-source.txt");
    const pullDst = workDir.join("pull-destination.txt");
    const pushBinarySrc = workDir.join("push-source.bin");
    const pullBinaryDst = workDir.join("pull-destination.bin");
    await Deno.mkdir(vaultA, { recursive: true });
    await Deno.mkdir(vaultB, { recursive: true });

    const keepDocker = Deno.env.get("LIVESYNC_DEBUG_KEEP_DOCKER") === "1";
    if (remoteType === "COUCHDB") {
        await startCouchdb(couchdbUri, couchdbUser, couchdbPassword, dbname);
    } else {
        await startMinio(minioEndpoint, minioAccessKey, minioSecretKey, minioBucket);
    }

    try {
        await initSettingsFile(settingsA);
        await initSettingsFile(settingsB);
        await applyRemoteSyncSettings(settingsA, {
            remoteType,
            couchdbUri,
            couchdbUser,
            couchdbPassword,
            couchdbDbname: dbname,
            minioBucket,
            minioEndpoint,
            minioAccessKey,
            minioSecretKey,
            encrypt,
            passphrase,
        });
        await applyRemoteSyncSettings(settingsB, {
            remoteType,
            couchdbUri,
            couchdbUser,
            couchdbPassword,
            couchdbDbname: dbname,
            minioBucket,
            minioEndpoint,
            minioAccessKey,
            minioSecretKey,
            encrypt,
            passphrase,
        });

        const syncBoth = async () => {
            await runCliOrFail(vaultA, "--settings", settingsA, "sync");
            await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        };

        const targetAOnly = "e2e/a-only-info.md";
        const targetSync = "e2e/sync-info.md";
        const targetSyncTwiceFirst = "e2e/sync-twice-first.md";
        const targetSyncTwiceSecond = "e2e/sync-twice-second.md";
        const targetPush = "e2e/pushed-from-a.md";
        const targetPut = "e2e/put-from-a.md";
        const targetPushBinary = "e2e/pushed-from-a.bin";
        const targetConflict = "e2e/conflict.md";

        await runCliWithInputOrFail("alpha-from-a\n", vaultA, "--settings", settingsA, "put", targetAOnly);
        const infoAOnly = await runCliOrFail(vaultA, "--settings", settingsA, "info", targetAOnly);
        assert(infoAOnly.includes(`"path": "${targetAOnly}"`));

        await runCliWithInputOrFail("visible-after-sync\n", vaultA, "--settings", settingsA, "put", targetSync);
        await syncBoth();
        const infoBSync = await runCliOrFail(vaultB, "--settings", settingsB, "info", targetSync);
        assert(infoBSync.includes(`"path": "${targetSync}"`));

        await runCliWithInputOrFail(
            `first-sync-round-${dbSuffix}\n`,
            vaultA,
            "--settings",
            settingsA,
            "put",
            targetSyncTwiceFirst
        );
        await runCliOrFail(vaultA, "--settings", settingsA, "sync");
        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        const firstVisible = sanitiseCatStdout(
            await runCliOrFail(vaultB, "--settings", settingsB, "cat", targetSyncTwiceFirst)
        ).trimEnd();
        assert(firstVisible === `first-sync-round-${dbSuffix}`);

        await runCliWithInputOrFail(
            `second-sync-round-${dbSuffix}\n`,
            vaultA,
            "--settings",
            settingsA,
            "put",
            targetSyncTwiceSecond
        );
        await runCliOrFail(vaultA, "--settings", settingsA, "sync");
        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        const secondVisible = sanitiseCatStdout(
            await runCliOrFail(vaultB, "--settings", settingsB, "cat", targetSyncTwiceSecond)
        ).trimEnd();
        assert(secondVisible === `second-sync-round-${dbSuffix}`);

        await Deno.writeTextFile(pushSrc, `pushed-content-${dbSuffix}\n`);
        await runCliOrFail(vaultA, "--settings", settingsA, "push", pushSrc, targetPush);
        await runCliWithInputOrFail(`put-content-${dbSuffix}\n`, vaultA, "--settings", settingsA, "put", targetPut);
        await syncBoth();
        await runCliOrFail(vaultB, "--settings", settingsB, "pull", targetPush, pullDst);
        await assertFilesEqual(pushSrc, pullDst, "B pull result does not match pushed source");
        const catBPut = sanitiseCatStdout(
            await runCliOrFail(vaultB, "--settings", settingsB, "cat", targetPut)
        ).trimEnd();
        assert(catBPut === `put-content-${dbSuffix}`);

        const binary = new Uint8Array(4096);
        binary.fill(0x61);
        await Deno.writeFile(pushBinarySrc, binary);
        await runCliOrFail(vaultA, "--settings", settingsA, "push", pushBinarySrc, targetPushBinary);
        await syncBoth();
        await runCliOrFail(vaultB, "--settings", settingsB, "pull", targetPushBinary, pullBinaryDst);
        await assertFilesEqual(pushBinarySrc, pullBinaryDst, "B pull result does not match pushed binary source");

        await runCliOrFail(vaultA, "--settings", settingsA, "rm", targetPut);
        await syncBoth();
        const removed = await runCli(vaultB, "--settings", settingsB, "cat", targetPut);
        assert(removed.code !== 0, `B cat should fail after A removed the file\n${removed.combined}`);

        await runCliWithInputOrFail("conflict-base\n", vaultA, "--settings", settingsA, "put", targetConflict);
        await syncBoth();
        await runCliWithInputOrFail(
            `conflict-from-a-${dbSuffix}\n`,
            vaultA,
            "--settings",
            settingsA,
            "put",
            targetConflict
        );
        await runCliWithInputOrFail(
            `conflict-from-b-${dbSuffix}\n`,
            vaultB,
            "--settings",
            settingsB,
            "put",
            targetConflict
        );

        let infoAConflict = "";
        let infoBConflict = "";
        let conflictDetected = false;
        for (const side of ["a", "b", "a"] as const) {
            await runCliOrFail(
                side === "a" ? vaultA : vaultB,
                "--settings",
                side === "a" ? settingsA : settingsB,
                "sync"
            );
            infoAConflict = await runCliOrFail(vaultA, "--settings", settingsA, "info", targetConflict);
            infoBConflict = await runCliOrFail(vaultB, "--settings", settingsB, "info", targetConflict);
            if (
                jsonStringField(infoAConflict, "conflicts") !== "N/A" ||
                jsonStringField(infoBConflict, "conflicts") !== "N/A"
            ) {
                conflictDetected = true;
                break;
            }
        }
        assert(conflictDetected, `conflict was expected\nA: ${infoAConflict}\nB: ${infoBConflict}`);

        const lsAConflict =
            (await runCliOrFail(vaultA, "--settings", settingsA, "ls", targetConflict)).trim().split(/\r?\n/)[0] ?? "";
        const lsBConflict =
            (await runCliOrFail(vaultB, "--settings", settingsB, "ls", targetConflict)).trim().split(/\r?\n/)[0] ?? "";
        const revA = lsAConflict.split("\t")[3] ?? "";
        const revB = lsBConflict.split("\t")[3] ?? "";
        assert(
            revA.includes("*") || revB.includes("*"),
            `conflicted entry should be marked with '*'\nA: ${lsAConflict}\nB: ${lsBConflict}`
        );

        const keepRevision = jsonStringField(infoAConflict, "revision");
        assert(keepRevision.length > 0, `could not extract revision\n${infoAConflict}`);
        await runCliOrFail(vaultA, "--settings", settingsA, "resolve", targetConflict, keepRevision);

        let resolved = false;
        let infoAResolved = "";
        let infoBResolved = "";
        for (let i = 0; i < 6; i++) {
            await syncBoth();
            infoAResolved = await runCliOrFail(vaultA, "--settings", settingsA, "info", targetConflict);
            infoBResolved = await runCliOrFail(vaultB, "--settings", settingsB, "info", targetConflict);
            if (
                jsonStringField(infoAResolved, "conflicts") === "N/A" &&
                jsonStringField(infoBResolved, "conflicts") === "N/A"
            ) {
                resolved = true;
                break;
            }
            const retryRevision = jsonStringField(infoAResolved, "revision");
            if (retryRevision) {
                await runCli(vaultA, "--settings", settingsA, "resolve", targetConflict, retryRevision);
            }
        }
        assert(resolved, `conflicts should be resolved\nA: ${infoAResolved}\nB: ${infoBResolved}`);

        const lsAResolved =
            (await runCliOrFail(vaultA, "--settings", settingsA, "ls", targetConflict)).trim().split(/\r?\n/)[0] ?? "";
        const lsBResolved =
            (await runCliOrFail(vaultB, "--settings", settingsB, "ls", targetConflict)).trim().split(/\r?\n/)[0] ?? "";
        assert(!(lsAResolved.split("\t")[3] ?? "").includes("*"));
        assert(!(lsBResolved.split("\t")[3] ?? "").includes("*"));

        const catAResolved = sanitiseCatStdout(
            await runCliOrFail(vaultA, "--settings", settingsA, "cat", targetConflict)
        ).trimEnd();
        const catBResolved = sanitiseCatStdout(
            await runCliOrFail(vaultB, "--settings", settingsB, "cat", targetConflict)
        ).trimEnd();
        assert(catAResolved === catBResolved, `resolved content should match\nA: ${catAResolved}\nB: ${catBResolved}`);
    } finally {
        if (!keepDocker) {
            if (remoteType === "COUCHDB") {
                await stopCouchdb().catch(() => {});
            } else {
                await stopMinio().catch(() => {});
            }
        }
    }
}

Deno.test("e2e: two vaults over CouchDB without encryption", async () => {
    await runScenario("COUCHDB", false);
});

Deno.test("e2e: two vaults over CouchDB with encryption", async () => {
    await runScenario("COUCHDB", true);
});
