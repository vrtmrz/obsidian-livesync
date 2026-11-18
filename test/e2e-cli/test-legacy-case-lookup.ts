import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, readFile, readdir, rename, rm, utimes, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { TempDir } from "./helpers/temp.ts";
import { runCli, runCliOrFail } from "./helpers/cli.ts";
import { applyRemoteSyncSettings, initSettingsFile } from "./helpers/settings.ts";
import { createCouchdbDatabase, startCouchdb, stopCouchdb } from "./helpers/docker.ts";

async function applyLegacyCaseLookupSettings(settingsFile: string): Promise<void> {
    const settings = JSON.parse(await readFile(settingsFile, "utf8")) as Record<string, unknown>;
    settings.pathNormalizationVersion = 0;
    settings.handleFilenameCaseSensitive = false;
    await writeFile(settingsFile, JSON.stringify(settings, null, 2));

    const savedSettings = JSON.parse(await readFile(settingsFile, "utf8")) as Record<string, unknown>;
    assert.equal(savedSettings.pathNormalizationVersion, 0);
    assert.equal(savedSettings.handleFilenameCaseSensitive, false);
}

test("CLI legacy case-insensitive lookup over CouchDB", async (t) => {
    await using workDir = await TempDir.create("livesync-cli-legacy-case-lookup");

    const couchdbUri = (process.env["COUCHDB_URI"] ?? process.env["hostname"] ?? "http://127.0.0.1:5989/").replace(
        /\/$/,
        ""
    );
    const couchdbUser = process.env["COUCHDB_USER"] ?? process.env["username"] ?? "admin";
    const couchdbPassword = process.env["COUCHDB_PASSWORD"] ?? process.env["password"] ?? "testpassword";
    const couchdbDbPrefix = process.env["COUCHDB_DBNAME"] ?? process.env["dbname"] ?? "livesync-test";
    const couchdbDbname = `${couchdbDbPrefix}-${randomUUID().replace(/-/g, "")}`;
    const shouldStartDocker = process.env["LIVESYNC_START_DOCKER"] !== "0";
    const keepDocker = process.env["LIVESYNC_DEBUG_KEEP_DOCKER"] === "1";
    let ownsExternalDatabase = false;

    const sourceDatabase = workDir.join("source-database");
    const targetDatabase = workDir.join("target-database");
    const targetVault = workDir.join("target-vault");
    const sourceSettings = workDir.join("source-settings.json");
    const targetSettings = workDir.join("target-settings.json");
    const remotePath = "CaseFolder/CaseFile.md";
    const initialBytes = Buffer.from("remote-only initial content\n", "utf8");
    const updatedBytes = Buffer.from("remote-only updated content\n", "utf8");

    await Promise.all([
        mkdir(sourceDatabase, { recursive: true }),
        mkdir(targetDatabase, { recursive: true }),
        mkdir(targetVault, { recursive: true }),
    ]);
    await Promise.all([initSettingsFile(sourceSettings), initSettingsFile(targetSettings)]);
    for (const settingsFile of [sourceSettings, targetSettings]) {
        await applyRemoteSyncSettings(settingsFile, {
            remoteType: "COUCHDB",
            couchdbUri,
            couchdbUser,
            couchdbPassword,
            couchdbDbname,
        });
        await applyLegacyCaseLookupSettings(settingsFile);
    }

    const syncSource = () => runCliOrFail(sourceDatabase, "--settings", sourceSettings, "sync");
    const syncTarget = () => runCliOrFail(targetDatabase, "--settings", targetSettings, "sync");
    const mirrorTarget = (vault = targetVault) =>
        runCliOrFail(targetDatabase, "--settings", targetSettings, "mirror", vault);

    try {
        if (shouldStartDocker) {
            await startCouchdb(couchdbUri, couchdbUser, couchdbPassword, couchdbDbname);
        } else {
            await createCouchdbDatabase(couchdbUri, couchdbUser, couchdbPassword, couchdbDbname);
            ownsExternalDatabase = true;
        }

        const initialSource = workDir.join("initial-source.md");
        await writeFile(initialSource, initialBytes);
        await runCliOrFail(sourceDatabase, "--settings", sourceSettings, "push", initialSource, remotePath);
        await syncSource();
        await syncTarget();

        assert.deepEqual(await readdir(targetVault), [], "The remote-only file must be absent before mirror");
        await mirrorTarget();

        const originalDirectory = workDir.join("target-vault", "CaseFolder");
        const originalFile = workDir.join("target-vault", "CaseFolder", "CaseFile.md");
        assert.deepEqual(await readdir(targetVault), ["CaseFolder"]);
        assert.deepEqual(await readdir(originalDirectory), ["CaseFile.md"]);
        assert.deepEqual(await readFile(originalFile), initialBytes);

        const actualDirectory = workDir.join("target-vault", "casefolder");
        const actualFile = workDir.join("target-vault", "casefolder", "casefile.md");
        const directoryRename = workDir.join("target-vault", ".case-folder-renaming");
        const fileRename = workDir.join("target-vault", "casefolder", ".case-file-renaming.md");
        await rename(originalDirectory, directoryRename);
        await rename(directoryRename, actualDirectory);
        await rename(workDir.join("target-vault", "casefolder", "CaseFile.md"), fileRename);
        await rename(fileRename, actualFile);
        assert.deepEqual(await readdir(targetVault), ["casefolder"]);
        assert.deepEqual(await readdir(actualDirectory), ["casefile.md"]);

        // Make the existing Vault file older than the incoming database revision.
        await utimes(actualFile, new Date(0), new Date(0));
        const updatedSource = workDir.join("updated-source.md");
        await writeFile(updatedSource, updatedBytes);
        await runCliOrFail(sourceDatabase, "--settings", sourceSettings, "push", updatedSource, remotePath);
        await syncSource();
        await syncTarget();

        // Parent-directory case changes are deliberately unsupported, even when lookup finds the file.
        const refusedParentChange = await runCli(targetDatabase, "--settings", targetSettings, "mirror", targetVault);
        assert.notEqual(refusedParentChange.code, 0);
        assert.match(
            refusedParentChange.combined,
            /Refusing to apply a filename case change across differently cased parent directories/
        );
        assert.deepEqual(await readdir(targetVault), ["casefolder"]);
        assert.deepEqual(await readdir(actualDirectory), ["casefile.md"]);
        assert.deepEqual(await readFile(actualFile), initialBytes, "Refusal must retain the existing Vault bytes");
        const retainedDatabaseFile = workDir.join("retained-database.md");
        await runCliOrFail(targetDatabase, "--settings", targetSettings, "pull", remotePath, retainedDatabaseFile);
        assert.deepEqual(await readFile(retainedDatabaseFile), updatedBytes);

        // Restore the supported parent spelling, leaving only a file-name case difference.
        await rename(actualDirectory, directoryRename);
        await rename(directoryRename, originalDirectory);
        await mirrorTarget();
        assert.deepEqual(await readdir(targetVault), ["CaseFolder"], "Update must not create a directory alias");
        assert.deepEqual(await readdir(originalDirectory), ["CaseFile.md"], "Update must retain one canonical file");
        assert.deepEqual(await readFile(originalFile), updatedBytes);

        // The local file is already absent when the remote deletion arrives.
        await rm(originalFile);
        await runCliOrFail(sourceDatabase, "--settings", sourceSettings, "rm", remotePath);
        await syncSource();
        await syncTarget();
        const deletedRemote = await runCli(targetDatabase, "--settings", targetSettings, "cat", remotePath);
        assert.notEqual(deletedRemote.code, 0, "The target database must receive the remote deletion");
        await mirrorTarget();
        assert.deepEqual(await readdir(targetVault), ["CaseFolder"]);
        assert.deepEqual(await readdir(originalDirectory), [], "A remote deletion must not recreate an absent file");

        await t.test("rejects case-colliding physical files without changing their bytes", async (collisionTest) => {
            const collisionVault = workDir.join("collision-vault");
            const upperFile = workDir.join("collision-vault", "Collision.md");
            const lowerFile = workDir.join("collision-vault", "collision.md");
            const upperBytes = Buffer.from("upper-case file bytes\n", "utf8");
            const lowerBytes = Buffer.from("lower-case file bytes\n", "utf8");
            await mkdir(collisionVault);
            await writeFile(upperFile, upperBytes);
            await writeFile(lowerFile, lowerBytes);

            const collisionNames = await readdir(collisionVault);
            if (!collisionNames.includes("Collision.md") || !collisionNames.includes("collision.md")) {
                collisionTest.skip("This filesystem cannot represent case-colliding files separately");
                return;
            }

            const collisionResult = await runCli(
                "-d",
                targetDatabase,
                "--settings",
                targetSettings,
                "mirror",
                collisionVault
            );
            assert.match(
                collisionResult.combined,
                /File path identity collision:.*"Collision\.md".*"collision\.md"/,
                "The existing collision policy must identify both physical files"
            );
            for (const collisionPath of ["Collision.md", "collision.md"]) {
                const stored = await runCli(targetDatabase, "--settings", targetSettings, "cat", collisionPath);
                assert.notEqual(stored.code, 0, "A rejected collision must not be stored as an ordinary note");
            }
            assert.deepEqual((await readdir(collisionVault)).sort(), ["Collision.md", "collision.md"].sort());
            assert.deepEqual(await readFile(upperFile), upperBytes);
            assert.deepEqual(await readFile(lowerFile), lowerBytes);
        });

        for (const settingsFile of [sourceSettings, targetSettings]) {
            const savedSettings = JSON.parse(await readFile(settingsFile, "utf8")) as Record<string, unknown>;
            assert.equal(savedSettings.pathNormalizationVersion, 0, "CLI operations must retain Legacy identity");
            assert.equal(savedSettings.handleFilenameCaseSensitive, false);
        }
    } finally {
        if (shouldStartDocker && !keepDocker) {
            await stopCouchdb().catch(() => {});
        } else if (ownsExternalDatabase && !keepDocker) {
            const response = await fetch(`${couchdbUri}/${couchdbDbname}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Basic ${Buffer.from(`${couchdbUser}:${couchdbPassword}`).toString("base64")}`,
                },
            });
            await response.body?.cancel();
            assert(response.ok, "The test database must be removed from the external fixture");
        }
    }
});
