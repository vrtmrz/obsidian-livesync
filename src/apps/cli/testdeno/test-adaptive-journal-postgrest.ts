import { assert, assertEquals } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import {
    assertFilesEqual,
    redactCliSensitiveText,
    runCli,
    runCliOrFail,
    runCliWithInputOrFail,
    sanitiseCatStdout,
} from "./helpers/cli.ts";
import { applyRemoteSyncSettings, generateSetupUriFromSettings, initSettingsFile } from "./helpers/settings.ts";
import {
    type PostgRESTFixture,
    readPostgRESTAdaptiveRowCounts,
    startPostgREST,
    stopPostgREST,
} from "./helpers/docker.ts";

const BINARY_TEST_BYTES = 2 * 1024 * 1024;

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

function postgRESTConnectionURI(fixture: PostgRESTFixture): string {
    const endpointUrl = new URL(fixture.endpoint);
    const proxyUrl = new URL(`https://${endpointUrl.host}${endpointUrl.pathname}`);
    proxyUrl.username = fixture.vaultId;
    proxyUrl.password = fixture.vaultCredential;
    if (endpointUrl.protocol === "http:") proxyUrl.searchParams.set("insecure", "true");
    return `sls+postgrest:${proxyUrl.toString().slice("https:".length)}`;
}

function remoteIdFromListing(listing: string): string {
    const line = listing
        .split(/\r?\n/u)
        .find((candidate) => candidate.includes("\tPostgREST E2E\t") || candidate.includes("\tPostgREST "));
    const id = line?.split("\t", 1)[0];
    if (!id) throw new Error(`PostgREST remote profile was not listed:\n${listing}`);
    return id;
}

function externalFixture(endpoint: string): PostgRESTFixture {
    return {
        endpoint,
        vaultCredential:
            Deno.env.get("POSTGREST_VAULT_CREDENTIAL") ??
            Deno.env.get("postgrestVaultCredential") ??
            "adaptive-cli-vault-credential-0000000000001",
        vaultId: Deno.env.get("POSTGREST_VAULT_ID") ?? Deno.env.get("postgrestVaultId") ?? "adaptive-cli-vault-01",
    };
}

Deno.test("CLI tee output redacts a PostgREST Vault credential", () => {
    assertEquals(
        redactCliSensitiveText(
            "exported sls+postgrest://adaptive-cli-vault-01:adaptive-cli-vault-credential@example.test/rest/v1"
        ),
        "exported sls+postgrest://<redacted>@example.test/rest/v1"
    );
});

Deno.test("e2e: two CLI vaults synchronise through Adaptive Journal PostgREST", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const endpoint = (
        Deno.env.get("POSTGREST_ENDPOINT") ??
        Deno.env.get("postgrestEndpoint") ??
        "http://127.0.0.1:3001"
    ).replace(/\/+$/u, "");
    const vaultPassphrase = "adaptive-journal-postgrest-cli-e2ee";
    const setupPassphrase = "adaptive-journal-postgrest-cli-setup";
    const shouldStartDocker = Deno.env.get("LIVESYNC_START_DOCKER") !== "0";
    const keepDocker = Deno.env.get("LIVESYNC_DEBUG_KEEP_DOCKER") === "1";
    const fixture = shouldStartDocker ? await startPostgREST(endpoint) : externalFixture(endpoint);
    const connectionURI = postgRESTConnectionURI(fixture);

    await using workDir = await TempDir.create("livesync-cli-adaptive-journal-postgrest");
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

    try {
        await initSettingsFile(settingsA);
        await applyRemoteSyncSettings(settingsA, {
            remoteType: "POSTGREST",
            postgRESTConnectionURI: connectionURI,
            encrypt: true,
            passphrase: vaultPassphrase,
            enableCompression: false,
            journalFormat: "adaptive-v1",
            packReadPolicy: "whole-pack",
        });
        const addedRemote = await runCliOrFail(
            vaultA,
            "--settings",
            settingsA,
            "remote-add",
            "PostgREST E2E",
            connectionURI
        );
        const remoteId = addedRemote.trim().split("\t", 1)[0];
        assert(remoteId, `remote-add did not return a profile ID:\n${addedRemote}`);
        await runCliOrFail(vaultA, "--settings", settingsA, "remote-activate", remoteId);

        const textPath = "adaptive/text.md";
        const binaryPath = "adaptive/data.bin";
        await runCliWithInputOrFail(`created-by-a-${suffix}\n`, vaultA, "--settings", settingsA, "put", textPath);
        await Deno.writeFile(binarySourceA, deterministicBytes(BINARY_TEST_BYTES, 0x1a2b3c4d));
        await runCliOrFail(vaultA, "--settings", settingsA, "push", binarySourceA, binaryPath);
        await runCliOrFail(vaultA, "--settings", settingsA, "sync");

        const remoteListing = await runCliOrFail(vaultA, "--settings", settingsA, "remote-ls");
        assertEquals(remoteIdFromListing(remoteListing), remoteId);
        assert(
            remoteListing
                .split(/\r?\n/u)
                .some((line) => line.startsWith(`${remoteId}\t`) && line.includes("\tactive\t")),
            `Activated PostgREST profile was not listed as active:\n${remoteListing}`
        );
        const exportedConnection = (
            await runCliOrFail(vaultA, "--settings", settingsA, "remote-export", remoteId)
        ).trim();
        assert(exportedConnection.startsWith("sls+postgrest://"));
        assert(exportedConnection.includes("journalFormat=adaptive-v1"));
        assert(!exportedConnection.includes("packReadPolicy="));

        const setupURI = await generateSetupUriFromSettings(settingsA, setupPassphrase, true, vaultPassphrase);
        await initSettingsFile(settingsB);
        await runCliWithInputOrFail(`${setupPassphrase}\n`, vaultB, "--settings", settingsB, "setup", setupURI);
        const settingsAfterSetup = JSON.parse(await Deno.readTextFile(settingsB)) as {
            encryptedPassphrase?: string;
            postgrestActiveConnectionURI?: string;
        };
        assert(
            typeof settingsAfterSetup.encryptedPassphrase === "string" &&
                settingsAfterSetup.encryptedPassphrase.length > 0,
            "setup did not persist the encrypted Vault passphrase"
        );
        assertEquals(settingsAfterSetup.postgrestActiveConnectionURI, connectionURI);

        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        assertEquals(
            sanitiseCatStdout(await runCliOrFail(vaultB, "--settings", settingsB, "cat", textPath)).trimEnd(),
            `created-by-a-${suffix}`
        );
        await runCliOrFail(vaultB, "--settings", settingsB, "pull", binaryPath, binaryDestinationB);
        await assertFilesEqual(binarySourceA, binaryDestinationB, "Adaptive Journal PostgREST transfer differs");

        await runCliWithInputOrFail(`updated-by-b-${suffix}\n`, vaultB, "--settings", settingsB, "put", textPath);
        await Deno.writeFile(binarySourceB, deterministicBytes(BINARY_TEST_BYTES, 0x5e6f7788));
        await runCliOrFail(vaultB, "--settings", settingsB, "push", binarySourceB, binaryPath);
        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        await runCliOrFail(vaultA, "--settings", settingsA, "sync");
        assertEquals(
            sanitiseCatStdout(await runCliOrFail(vaultA, "--settings", settingsA, "cat", textPath)).trimEnd(),
            `updated-by-b-${suffix}`
        );
        await runCliOrFail(vaultA, "--settings", settingsA, "pull", binaryPath, binaryDestinationA);
        await assertFilesEqual(binarySourceB, binaryDestinationA, "Adaptive Journal PostgREST return transfer differs");

        await runCliOrFail(vaultA, "--settings", settingsA, "rm", binaryPath);
        await runCliOrFail(vaultA, "--settings", settingsA, "sync");
        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        const deleted = await runCli(vaultB, "--settings", settingsB, "cat", binaryPath);
        assert(deleted.code !== 0, `Deleted binary remained readable:\n${deleted.combined}`);

        const statusOutput = await runCliOrFail(vaultA, "--settings", settingsA, "remote-status", remoteId);
        const statusJsonStart = statusOutput.indexOf("{");
        assert(statusJsonStart >= 0, `PostgREST remote status did not contain JSON:\n${statusOutput}`);
        const status = JSON.parse(statusOutput.slice(statusJsonStart)) as { estimatedSize?: unknown };
        assert(
            typeof status.estimatedSize === "number" && status.estimatedSize > 0,
            `PostgREST remote status did not report a positive size: ${JSON.stringify(status)}`
        );

        if (shouldStartDocker) {
            const counts = await readPostgRESTAdaptiveRowCounts(fixture.vaultId);
            assertEquals(counts.manifests, 1);
            assert(counts.chunks > 0, `PostgREST did not persist Chunk rows: ${JSON.stringify(counts)}`);
            assert(counts.writers >= 2, `PostgREST did not preserve both Writer streams: ${JSON.stringify(counts)}`);
            assert(counts.commits >= 2, `PostgREST did not persist Commit Bundles: ${JSON.stringify(counts)}`);
        }
    } finally {
        if (shouldStartDocker && !keepDocker) {
            await stopPostgREST().catch(() => {});
        }
    }
});
