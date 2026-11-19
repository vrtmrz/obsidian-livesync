import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { DOCID_SYNC_PARAMETERS, E2EEAlgorithms } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { decrypt as decryptHKDF, encrypt as encryptHKDF } from "octagonal-wheels/encryption/hkdf";
import { runCli, runCliOrFail } from "./helpers/cli.ts";
import { runProcess } from "./helpers/process.ts";
import { applyRemoteSyncSettings, initSettingsFile } from "./helpers/settings.ts";
import { TempDir } from "./helpers/temp.ts";

const passphrase = "issue-1365-synthetic-passphrase";
const reportedDocumentId = "h:0123456789abcdef0123456789abcdef";
const sourceContent = "# Current writer control\nThis note must survive every Fetch.\n";
const inlineContent = "# Synthetic inline note\nEncrypted content: café.\n";
const inlinePath = "notes/synthetic-inline.md";

async function docker(...args: string[]): Promise<string> {
    const result = await runProcess("docker", { args });
    assert.equal(result.code, 0, new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim();
}

async function startFixture() {
    const container = `livesync-issue1365-${randomUUID()}`;
    const headers = {
        Authorization: `Basic ${Buffer.from("admin:issue-1365-fixture-password").toString("base64")}`,
        "Content-Type": "application/json",
    };
    await docker(
        "run",
        "--rm",
        "--detach",
        "--name",
        container,
        "--publish",
        "127.0.0.1::5984",
        "--env",
        "COUCHDB_USER=admin",
        "--env",
        "COUCHDB_PASSWORD=issue-1365-fixture-password",
        "--env",
        "COUCHDB_SINGLE_NODE=y",
        "couchdb:3.5.3"
    );
    try {
        const port = await docker("port", container, "5984/tcp");
        const match = /^127\.0\.0\.1:(\d+)$/.exec(port);
        assert(match, `Expected a loopback-only CouchDB port, received ${port}`);
        const uri = `http://127.0.0.1:${match[1]}`;
        let ready = false;
        for (let attempt = 0; attempt < 120; attempt++) {
            try {
                ready = (await fetch(`${uri}/_up`, { headers, signal: AbortSignal.timeout(1000) })).ok;
            } catch {
                // The isolated server may not yet have opened its listening port.
            }
            if (ready) break;
            await delay(250);
        }
        assert(ready, "The isolated CouchDB fixture did not become ready");
        const setup = await fetch(`${uri}/_cluster_setup`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                action: "enable_single_node",
                username: "admin",
                password: "issue-1365-fixture-password",
                bind_address: "0.0.0.0",
                port: 5984,
                singlenode: true,
            }),
        });
        assert(setup.ok, `Could not initialise the isolated CouchDB: HTTP ${setup.status}: ${await setup.text()}`);
        const databaseUrl = `${uri}/issue-1365`;
        const created = await fetch(`${databaseUrl}?n=1&q=1`, { method: "PUT", headers });
        assert(created.ok, `Could not create the isolated database: HTTP ${created.status}`);
        return {
            uri,
            databaseUrl,
            headers,
            async [Symbol.asyncDispose]() {
                await docker("rm", "--force", container);
            },
        };
    } catch (error) {
        await docker("rm", "--force", container);
        throw error;
    }
}

test("fetch explains how to recover from an unsupported encrypted format", { timeout: 180_000 }, async (t) => {
    // The CLI helper captures these switches at import time; do not let them mask the regression.
    assert.notEqual(process.env.LIVESYNC_CLI_DEBUG, "1", "Run this test without LIVESYNC_CLI_DEBUG=1");
    assert.notEqual(process.env.LIVESYNC_CLI_VERBOSE, "1", "Run this test without LIVESYNC_CLI_VERBOSE=1");
    await using fixture = await startFixture();
    await using directory = await TempDir.create("livesync-issue1365");
    const sourceDatabase = directory.join("source-database");
    const receiverDatabase = directory.join("receiver-database");
    const sourceVault = directory.join("source-vault");
    const receiverVault = directory.join("receiver-vault");
    const sourceSettings = directory.join("source-settings.json");
    const receiverSettings = directory.join("receiver-settings.json");
    const notePath = "control.md";
    const markerPath = join(receiverDatabase, ".livesync", "reconstruction.json");
    await Promise.all([sourceDatabase, receiverDatabase, sourceVault, receiverVault].map((path) => mkdir(path)));
    await writeFile(join(sourceVault, notePath), sourceContent);
    for (const settingsFile of [sourceSettings, receiverSettings]) {
        await initSettingsFile(settingsFile);
        await applyRemoteSyncSettings(settingsFile, {
            remoteType: "COUCHDB",
            couchdbUri: fixture.uri,
            couchdbUser: "admin",
            couchdbPassword: "issue-1365-fixture-password",
            couchdbDbname: "issue-1365",
            encrypt: true,
            passphrase,
            usePathObfuscation: true,
        });
        const settings = JSON.parse(await readFile(settingsFile, "utf8"));
        Object.assign(settings, {
            E2EEAlgorithm: E2EEAlgorithms.V2,
            readChunksOnline: false,
            acceptUnencryptedContent: false,
        });
        await writeFile(settingsFile, JSON.stringify(settings, null, 2));
    }
    const sourceArgs = [sourceDatabase, "--vault", sourceVault, "--settings", sourceSettings];
    const receiverArgs = [receiverDatabase, "--vault", receiverVault, "--settings", receiverSettings];
    await runCliOrFail(...sourceArgs, "rebuild", "--force", "--write-settings");
    await runCliOrFail(...receiverArgs, "fetch", "--force", "--write-settings");
    assert.equal(await readFile(join(receiverVault, notePath), "utf8"), sourceContent);

    const parameters = await fetch(`${fixture.databaseUrl}/${DOCID_SYNC_PARAMETERS}`, { headers: fixture.headers });
    assert(parameters.ok, `Could not read the fixture Security Seed: HTTP ${parameters.status}`);
    const { pbkdf2salt } = (await parameters.json()) as { pbkdf2salt: string };
    assert.equal(typeof pbkdf2salt, "string");
    const salt = new Uint8Array(Buffer.from(pbkdf2salt, "base64"));
    // The reporter's writer is unknown. Construct only the reported shape, with real ciphertext.
    const document = {
        _id: reportedDocumentId,
        type: "plain",
        e_: true,
        path: await encryptHKDF(inlinePath, passphrase, salt),
        data: await encryptHKDF(inlineContent, passphrase, salt),
        size: Buffer.byteLength(inlineContent),
        ctime: 1_700_000_000_000,
        mtime: 1_700_000_000_000,
        eden: {},
    };
    assert.equal(await decryptHKDF(document.data, passphrase, salt), inlineContent);
    assert.equal(await decryptHKDF(document.path, passphrase, salt), inlinePath);
    t.diagnostic("Healthy encrypted Fetch and ciphertext controls passed.");
    const documentUrl = `${fixture.databaseUrl}/${encodeURIComponent(reportedDocumentId)}`;
    const inserted = await fetch(documentUrl, {
        method: "PUT",
        headers: fixture.headers,
        body: JSON.stringify(document),
    });
    assert(inserted.ok, `Could not insert the synthetic document: HTTP ${inserted.status}`);
    const { rev } = (await inserted.json()) as { rev: string };
    assert.match(rev, /^1-/);

    const failure = await runCli(...receiverArgs, "fetch", "--force", "--write-settings");
    assert.equal(failure.code, 1, "Fetch must report failure");
    assert.equal(await readFile(join(receiverVault, notePath), "utf8"), sourceContent);
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    assert.equal(marker.command, "fetch");
    assert.equal(marker.phase, "running");
    const retained = await fetch(documentUrl, { headers: fixture.headers });
    assert(retained.ok, "Failed Fetch must retain the remote source");
    assert.deepEqual(await retained.json(), { ...document, _rev: rev });
    await assert.rejects(readFile(join(receiverVault, inlinePath)), { code: "ENOENT" });
    t.diagnostic("Failed Fetch retained Vault bytes, the remote revision, and the running reconstruction record.");

    // Model an independently verified source Vault containing all the required files.
    await mkdir(join(sourceVault, "notes"));
    await writeFile(join(sourceVault, inlinePath), inlineContent);
    await runCliOrFail(...sourceArgs, "rebuild", "--force", "--write-settings");
    const replaced = await fetch(documentUrl, { headers: fixture.headers });
    assert.equal(replaced.status, 404, "Rebuild must replace the unsupported remote document");
    await runCliOrFail(...receiverArgs, "fetch", "--force", "--write-settings");
    for (const vault of [sourceVault, receiverVault]) {
        assert.equal(await readFile(join(vault, notePath), "utf8"), sourceContent);
        assert.equal(await readFile(join(vault, inlinePath), "utf8"), inlineContent);
    }
    await assert.rejects(readFile(markerPath), { code: "ENOENT" });
    const recoveredSettings = JSON.parse(await readFile(receiverSettings, "utf8"));
    assert.equal(recoveredSettings.encrypt, true);
    assert.equal(recoveredSettings.acceptUnencryptedContent, false);
    t.diagnostic("Rebuild from the separate Vault restored Fetch and transferred both files with E2EE enforced.");

    assert.match(failure.stderr, /unsupported E2EE format/i);
    assert.match(failure.stderr, /another device whose Vault contains all the files and changes/i);
    assert.match(failure.stderr, /rebuild the remote database/i);
    assert.match(failure.stderr, /run 'fetch --force' again on this device/i);
});
