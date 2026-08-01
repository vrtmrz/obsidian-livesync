import { assert, assertEquals } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { assertFilesEqual, runCli, runCliOrFail, runCliWithInputOrFail, sanitiseCatStdout } from "./helpers/cli.ts";
import { applyRemoteSyncSettings, generateSetupUriFromSettings, initSettingsFile } from "./helpers/settings.ts";
import { listWebDAVObjectKeys, readWebDAVObjectText, startWebDAV, stopWebDAV } from "./helpers/docker.ts";

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

function webDAVConnectionURI(endpoint: string, prefix: string): string {
    const endpointUrl = new URL(endpoint);
    const proxyUrl = new URL(`https://${endpointUrl.host}${endpointUrl.pathname}`);
    const username = Deno.env.get("WEBDAV_USERNAME") ?? "";
    const password = Deno.env.get("WEBDAV_PASSWORD") ?? "";
    proxyUrl.username = username;
    proxyUrl.password = password;
    if (endpointUrl.protocol === "http:") proxyUrl.searchParams.set("insecure", "true");
    proxyUrl.searchParams.set("prefix", prefix);
    return `sls+webdav:${proxyUrl.toString().slice("https:".length)}`;
}

function setPackReadPolicy(connectionURI: string, policy: "range" | "whole-pack"): string {
    const url = new URL(connectionURI);
    url.searchParams.set("packReadPolicy", policy);
    return url.toString();
}

function selectAdaptiveJournal(connectionURI: string): string {
    const url = new URL(connectionURI);
    url.searchParams.set("journalFormat", "adaptive-v1");
    return url.toString();
}

function remoteIdFromListing(listing: string): string {
    const line = listing
        .split(/\r?\n/u)
        .find((candidate) => candidate.includes("\tWebDAV Remote\t") || candidate.includes("\tWebDAV "));
    const id = line?.split("\t", 1)[0];
    if (!id) throw new Error(`WebDAV remote profile was not listed:\n${listing}`);
    return id;
}

Deno.test("e2e: two CLI vaults synchronise through Adaptive Journal WebDAV", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const endpoint = (Deno.env.get("WEBDAV_ENDPOINT") ?? "http://127.0.0.1:8088/dav").replace(/\/+$/u, "");
    const prefix = `adaptive-cli-${suffix}/`;
    const collectionEndpoint = `${endpoint}/${prefix}`;
    const connectionURI = webDAVConnectionURI(endpoint, prefix);
    const adaptiveConnectionURI = selectAdaptiveJournal(connectionURI);
    const vaultPassphrase = "adaptive-journal-webdav-cli-e2ee";
    const setupPassphrase = "adaptive-journal-webdav-cli-setup";

    await using workDir = await TempDir.create("livesync-cli-adaptive-journal-webdav");
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

    const shouldStartDocker = Deno.env.get("LIVESYNC_START_DOCKER") !== "0";
    const keepDocker = Deno.env.get("LIVESYNC_DEBUG_KEEP_DOCKER") === "1";
    if (shouldStartDocker) await startWebDAV(endpoint);

    try {
        await initSettingsFile(settingsA);
        await applyRemoteSyncSettings(settingsA, {
            remoteType: "WEBDAV",
            webDAVConnectionURI: connectionURI,
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
            "WebDAV E2E",
            adaptiveConnectionURI
        );
        const remoteId = addedRemote.trim().split("\t", 1)[0];
        assert(remoteId, `remote-add did not return a profile ID:\n${addedRemote}`);
        const settingsAfterRemoteAdd = JSON.parse(await Deno.readTextFile(settingsA)) as {
            remoteConfigurations?: Record<string, unknown>;
            liveSync?: boolean;
        };
        assert(
            settingsAfterRemoteAdd.remoteConfigurations?.[remoteId],
            `remote-add did not persist profile ${remoteId}: ${Object.keys(settingsAfterRemoteAdd.remoteConfigurations ?? {}).join(", ")}`
        );
        assertEquals(settingsAfterRemoteAdd.liveSync, true, "remote-add changed the persisted synchronisation mode");
        await runCliOrFail(vaultA, "--settings", settingsA, "remote-activate", remoteId);

        const textPath = "adaptive/text.md";
        const binaryPath = "adaptive/data.bin";
        await runCliWithInputOrFail(`created-by-a-${suffix}\n`, vaultA, "--settings", settingsA, "put", textPath);
        await Deno.writeFile(binarySourceA, deterministicBytes(EXTERNAL_PACK_TEST_BYTES, 0x1a2b3c4d));
        await runCliOrFail(vaultA, "--settings", settingsA, "push", binarySourceA, binaryPath);
        await runCliOrFail(vaultA, "--settings", settingsA, "sync");

        const remoteListing = await runCliOrFail(vaultA, "--settings", settingsA, "remote-ls");
        assertEquals(remoteIdFromListing(remoteListing), remoteId);
        assert(
            remoteListing
                .split(/\r?\n/u)
                .some((line) => line.startsWith(`${remoteId}\t`) && line.includes("\tactive\t")),
            `Activated WebDAV profile was not listed as active:\n${remoteListing}`
        );
        const exportedConnection = (
            await runCliOrFail(vaultA, "--settings", settingsA, "remote-export", remoteId)
        ).trim();
        assert(exportedConnection.startsWith("sls+webdav://"));
        assert(exportedConnection.includes("journalFormat=adaptive-v1"));
        assert(!exportedConnection.includes("packReadPolicy="));

        const setupURI = await generateSetupUriFromSettings(settingsA, setupPassphrase, true, vaultPassphrase);
        await initSettingsFile(settingsB);
        await runCliWithInputOrFail(`${setupPassphrase}\n`, vaultB, "--settings", settingsB, "setup", setupURI);
        const settingsAfterSetup = JSON.parse(await Deno.readTextFile(settingsB)) as {
            encryptedPassphrase?: string;
        };
        assert(
            typeof settingsAfterSetup.encryptedPassphrase === "string" &&
                settingsAfterSetup.encryptedPassphrase.length > 0,
            "setup did not persist the encrypted Vault passphrase"
        );
        await runCliOrFail(
            vaultB,
            "--settings",
            settingsB,
            "remote-set",
            remoteId,
            setPackReadPolicy(exportedConnection, "range")
        );
        const rangeConnection = (await runCliOrFail(vaultB, "--settings", settingsB, "remote-export", remoteId)).trim();
        assert(rangeConnection.includes("packReadPolicy=range"));

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

        const objectKeys = await listWebDAVObjectKeys(collectionEndpoint);
        assert(objectKeys.includes("a1~manifest.json"), `Adaptive manifest is missing:\n${objectKeys.join("\n")}`);
        for (const objectPrefix of ["a1~writer~", "a1~pack~", "a1~commit~"]) {
            assert(
                objectKeys.some((key) => key.startsWith(objectPrefix)),
                `Adaptive object with prefix ${objectPrefix} is missing:\n${objectKeys.join("\n")}`
            );
        }
        const packKeys = objectKeys.filter((key) => key.startsWith("a1~pack~"));
        assert(packKeys.length >= 2, `Expected external Packs from both CLI writers:\n${objectKeys.join("\n")}`);
        for (const legacyPrefix of ["a1~index~", "a1~delta~", "a1~metadata~"]) {
            assert(
                !objectKeys.some((key) => key.startsWith(legacyPrefix)),
                `Legacy Adaptive object with prefix ${legacyPrefix} was written:\n${objectKeys.join("\n")}`
            );
        }
        const manifest = JSON.parse(await readWebDAVObjectText(collectionEndpoint, "a1~manifest.json")) as {
            objectLayout?: unknown;
        };
        assertEquals(manifest.objectLayout, "commit-bundle-v1");
        assert(
            !objectKeys.some((key) => key.startsWith("a1~probe~")),
            `Adaptive capability probe objects were not removed:\n${objectKeys.join("\n")}`
        );
        assert(
            !objectKeys.includes("_00000000-milestone.json"),
            `Legacy Journal milestone was written into the Adaptive repository:\n${objectKeys.join("\n")}`
        );
    } finally {
        if (shouldStartDocker && !keepDocker) {
            await stopWebDAV().catch(() => {});
        }
    }
});
