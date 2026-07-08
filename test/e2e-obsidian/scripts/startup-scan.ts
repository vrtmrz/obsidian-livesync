import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    waitForCouchDbDocs,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    configureCouchDb,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";

const notePath = "E2E/startup-scan.md";
const noteContent = [
    "# Startup scan",
    "",
    "This note was written while Obsidian was stopped.",
    "The test verifies that the next real Obsidian boot scans it into the local database.",
    `Created at: ${new Date().toISOString()}`,
    "",
].join("\n");

async function writeVaultFile(vaultPath: string, path: string, content: string): Promise<void> {
    const fullPath = join(vaultPath, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "startup-scan");
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);

        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault: ${vault.path}`);
        console.log(`Temporary CouchDB database: ${dbName}`);

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        const configured = await configureCouchDb(cli.binary, session.cliEnv, {
            uri: couchDb.uri,
            username: couchDb.username,
            password: couchDb.password,
            dbName,
        });
        assertEqual(configured.isConfigured, true, "Self-hosted LiveSync was not configured.");
        await prepareRemote(cli.binary, session.cliEnv);
        await session.app.stop();
        session = undefined;

        await writeVaultFile(vault.path, notePath, noteContent);

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);

        const localEntry = await waitForLocalDatabaseEntry(cli.binary, session.cliEnv, notePath);
        await pushLocalChanges(cli.binary, session.cliEnv);

        const remoteDocs = await waitForCouchDbDocs(couchDb, dbName, (docs) => {
            const ids = new Set(docs.map((doc) => doc._id));
            return ids.has(localEntry.id) && localEntry.children.every((childId) => ids.has(childId));
        });
        const remoteMetadata = remoteDocs.find((doc) => doc._id === localEntry.id);
        assertEqual(remoteMetadata?.path, localEntry.path, "Startup-scanned remote metadata path did not match.");

        console.log(`Startup scan uploaded metadata ${localEntry.id} and ${localEntry.children.length} chunk(s).`);
    } finally {
        if (session) {
            await session.app.stop();
        }
        await vault.dispose();
        if (process.env.E2E_OBSIDIAN_KEEP_COUCHDB !== "true") {
            await deleteCouchDbDatabase(couchDb, dbName).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
