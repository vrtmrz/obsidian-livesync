import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DoctorRegulation } from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchAllCouchDbDocs,
    fetchCouchDbDatabaseInfo,
    fetchCouchDbDocument,
    fetchCouchDbLocalDocs,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    putCouchDbDocument,
    type CouchDbConfig,
} from "../runner/couchdb.ts";
import { requireObsidianBinary, requireObsidianCli } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";
const fixturePath = "Diagnostic/remote-秘密.md";
const fixtureContent = "Diagnostic remote fixture contents must stay outside reports.\n";
const passphrase = "diagnostic-remote-fixture-passphrase";
const timeout = 20000;

interface IntegrityReport {
    status: string;
    scope: { remote: "included" | "excluded" };
    coverage: { local: { status: string }; remote: { status: string; contentReads: number } };
    observations: {
        source: string;
        identity: string;
        path: string;
        revision?: string;
        metadata?: { recordedSize?: number; chunkReferences: number; uniqueChunkReferences: number };
        vault: { status: string; size?: number; contentSizeDifference?: number; mtimeDifferenceMs?: number };
        content: { status: string; chunksRead: number; size?: number; recordedSizeDifference?: number };
        comparisons: { relation: string }[];
    }[];
    errors: unknown[];
}

async function localState(cli: string, session: ObsidianLiveSyncSession) {
    const state = await evalObsidianJson<unknown>(
        cli,
        "(async()=>{const core=app.plugins.plugins['obsidian-livesync'].core;const files=await Promise.all(app.vault.getFiles().map(async file=>[file.path,await app.vault.read(file)]));files.sort((a,b)=>a[0].localeCompare(b[0]));return JSON.stringify({sequence:(await core.localDatabase.localDatabase.info()).update_seq,settings:core.services.setting.currentSettings(),files});})()",
        session.cliEnv
    );
    return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

async function remoteState(config: CouchDbConfig, name: string) {
    const [info, documents, localDocuments] = await Promise.all([
        fetchCouchDbDatabaseInfo(config, name),
        fetchAllCouchDbDocs(config, name),
        fetchCouchDbLocalDocs(config, name),
    ]);
    // Hash the snapshot so a failed assertion cannot print Security Seed data.
    return createHash("sha256")
        .update(JSON.stringify([info.update_seq, documents, localDocuments]))
        .digest("hex");
}

async function observeRequests(cli: string, session: ObsidianLiveSyncSession) {
    await evalObsidianJson(
        cli,
        `(() => {
            const api=app.plugins.plugins['obsidian-livesync'].core.services.API;
            const state={calls:[],restore:undefined};
            const originals={};
            for(const name of ['webCompatFetch','nativeFetch']) {
                originals[name]=api[name];
                api[name]=function(request,options) {
                    state.calls.push({transport:name,method:options?.method??(typeof request==='string'?'GET':request.method)});
                    return originals[name].call(this,request,options);
                };
            }
            state.restore=()=>{for(const name of Object.keys(originals)) api[name]=originals[name];};
            globalThis.diagnosticRequests=state;
            return JSON.stringify(true);
        })()`,
        session.cliEnv
    );
}

async function finishRequests(cli: string, session: ObsidianLiveSyncSession) {
    return await evalObsidianJson<{ transport: string; method: string }[]>(
        cli,
        "(()=>{const state=globalThis.diagnosticRequests;if(!state)return JSON.stringify([]);state.restore();delete globalThis.diagnosticRequests;return JSON.stringify(state.calls);})()",
        session.cliEnv
    );
}

async function runCase(config: CouchDbConfig, encrypted: boolean) {
    const binary = requireObsidianBinary();
    const cli = requireObsidianCli();
    const name = makeUniqueDatabaseName(config.dbPrefix, "diagnostic");
    const vault = await createTemporaryVault("obsidian-livesync-remote-diagnostic-");
    let session: ObsidianLiveSyncSession | undefined;
    let created = false;
    try {
        await createCouchDbDatabase(config, name);
        created = true;
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli,
            vault,
            artifactRoot: process.env.E2E_OBSIDIAN_ARTIFACT_ROOT?.trim() || undefined,
            pluginData: createE2eCouchDbPluginData(
                { ...config, dbName: name },
                {
                    doctorProcessedVersion: DoctorRegulation.version,
                    useAdvancedMode: true,
                    encrypt: encrypted,
                    passphrase: encrypted ? passphrase : "",
                    usePathObfuscation: encrypted,
                    encryptInternalMetadata: encrypted,
                    E2EEAlgorithm: "v2",
                    useRequestAPI: true,
                    periodicReplication: false,
                    syncAfterMerge: false,
                    syncOnEditorSave: false,
                    syncOnFileOpen: false,
                    notifyThresholdOfRemoteStorageSize: -1,
                }
            ),
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cli, session.cliEnv);
        await prepareRemote(cli, session.cliEnv);
        await evalObsidianJson(
            cli,
            `(async()=>{await app.vault.createFolder('Diagnostic');await app.vault.create(${JSON.stringify(fixturePath)},${JSON.stringify(fixtureContent)});return JSON.stringify(true);})()`,
            session.cliEnv
        );
        const entry = await waitForLocalDatabaseEntry(cli, session.cliEnv, fixturePath);
        await pushLocalChanges(cli, session.cliEnv);
        const original = await fetchCouchDbDocument(config, name, entry.id);
        assert.ok(entry.children.length > 0);
        if (encrypted) assert.ok(!JSON.stringify(original).includes(fixturePath));
        const shadowId = await evalObsidianJson<string>(
            cli,
            "(async()=>JSON.stringify(await app.plugins.plugins['obsidian-livesync'].core.services.path.path2id('Diagnostic/different-identity.md')))()",
            session.cliEnv
        );
        const shadow = { ...original, _id: shadowId };
        delete shadow._rev;
        await putCouchDbDocument(config, name, shadow);

        for (const native of [false, true]) {
            await evalObsidianJson(
                cli,
                `(async()=>{await app.plugins.plugins['obsidian-livesync'].core.services.setting.applyPartial({useRequestAPI:${native}});return JSON.stringify(true);})()`,
                session.cliEnv
            );
            const localBefore = await localState(cli, session);
            const remoteBefore = await remoteState(config, name);
            await observeRequests(cli, session);
            let calls: { transport: string; method: string }[] = [];
            try {
                await withObsidianPage(session.remoteDebuggingPort, async (page) => {
                    await page.setViewportSize({ width: 800, height: 600 });
                    const opened = await page.evaluate(
                        "app.commands.executeCommandById('obsidian-livesync:inspect-database-integrity')"
                    );
                    assert.equal(opened, true);
                    const dialogue = page.locator(".database-diagnostic");
                    await dialogue.waitFor({ state: "visible", timeout });
                    const remoteChoice = dialogue.getByRole("checkbox", {
                        name: "Include remote database",
                        exact: true,
                    });
                    assert.equal(await remoteChoice.isChecked(), true, "Remote inspection must be selected by default");
                    const modal = page.locator(".modal-container").filter({ has: dialogue }).locator(".modal");
                    const layout = await modal.evaluate((element) => {
                        const modalBounds = element.getBoundingClientRect();
                        const choice = element.querySelector<HTMLElement>(".diagnostic-remote-choice");
                        if (!choice)
                            return { contained: false, outerScroll: element.scrollHeight - element.clientHeight };
                        const choiceBounds = choice.getBoundingClientRect();
                        return {
                            contained:
                                choiceBounds.top >= modalBounds.top - 1 &&
                                choiceBounds.bottom <= modalBounds.bottom + 1,
                            outerScroll: Math.max(0, element.scrollHeight - element.clientHeight),
                        };
                    });
                    assert.equal(layout.contained, true, "The remote option must remain inside the desktop modal");
                    assert.ok(
                        layout.outerScroll <= 1,
                        `The choice modal must not need outer scrolling; got ${layout.outerScroll}px`
                    );
                    await remoteChoice.uncheck();
                    assert.equal(await remoteChoice.isChecked(), false);
                    await dialogue.getByRole("button", { name: "Begin inspection", exact: true }).click();
                    await page.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
                    await dialogue.getByRole("radio", { name: "JSON", exact: true }).check();
                    const report = JSON.parse(await dialogue.locator("textarea").inputValue()) as IntegrityReport;
                    assert.equal(report.status, "complete");
                    assert.equal(report.scope.remote, "excluded");
                    assert.equal(report.coverage.local.status, "complete");
                    assert.equal(report.coverage.remote.status, "not-checked");
                    assert.deepEqual(report.errors, []);
                    assert.equal(
                        report.observations.some((row) => row.source === "remote"),
                        false
                    );
                    const localObservations = report.observations.filter((row) => row.source === "local");
                    assert.ok(localObservations.length > 0);
                    assert.ok(localObservations.every((row) => row.identity === "consistent"));
                    assert.ok(
                        localObservations.every(
                            (row) => row.content.status === "not-checked" && row.vault.status === "not-checked"
                        ),
                        "Only the remote has a discrepancy in this fixture; excluding it leaves no suspect content group"
                    );
                    await dialogue.getByRole("button", { name: "Close", exact: true }).click();
                    await dialogue.waitFor({ state: "hidden", timeout });
                });
            } finally {
                calls = await finishRequests(cli, session);
            }
            assert.equal(calls.length, 0, "Excluding the remote database must make no HTTP requests");

            await observeRequests(cli, session);
            try {
                await withObsidianPage(session.remoteDebuggingPort, async (page) => {
                    await page.setViewportSize({ width: 800, height: 600 });
                    for (const names of ["pseudonym", "original"]) {
                        const opened = await page.evaluate(
                            "app.commands.executeCommandById('obsidian-livesync:inspect-database-integrity')"
                        );
                        assert.equal(opened, true);
                        const dialogue = page.locator(".database-diagnostic");
                        await dialogue.waitFor({ state: "visible", timeout });
                        const remoteChoice = dialogue.getByRole("checkbox", {
                            name: "Include remote database",
                            exact: true,
                        });
                        assert.equal(
                            await remoteChoice.isChecked(),
                            true,
                            "Each run must include the remote database by default"
                        );
                        const nameOptions = dialogue.getByRole("group", { name: "Names in this report", exact: true });
                        assert.equal(await nameOptions.getByRole("radio").count(), 2);
                        const nameLabel = names === "pseudonym" ? "Pseudonyms (recommended)" : "Original names";
                        await nameOptions.getByRole("radio", { name: nameLabel, exact: true }).check();
                        assert.equal(await nameOptions.getByRole("radio", { checked: true }).count(), 1);
                        await dialogue.getByRole("button", { name: "Begin inspection", exact: true }).click();
                        await page.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
                        const formats = dialogue.getByRole("group", { name: "Report format", exact: true });
                        assert.equal(await formats.getByRole("radio").count(), 2);
                        for (const name of ["MARKDOWN", "JSON"])
                            assert.equal(await formats.getByRole("radio", { name, exact: true }).isVisible(), true);
                        await formats.getByRole("radio", { name: "JSON", exact: true }).check();
                        const text = await dialogue.locator("textarea").inputValue();
                        const report = JSON.parse(text) as IntegrityReport;
                        assert.equal(report.status, "complete");
                        assert.equal(report.scope.remote, "included");
                        assert.equal(report.coverage.local.status, "complete");
                        assert.equal(report.coverage.remote.status, "complete");
                        assert.ok(report.coverage.remote.contentReads > 0);
                        assert.deepEqual(report.errors, []);
                        const suspect = report.observations.find(
                            (row) => row.source === "remote" && row.identity === "document-id-mismatch"
                        );
                        assert.ok(suspect);
                        assert.equal(suspect.content.status, "available");
                        assert.ok(suspect.content.chunksRead > 0);
                        const byteLength = Buffer.byteLength(fixtureContent);
                        assert.equal(
                            suspect.metadata?.recordedSize,
                            byteLength,
                            "Metadata properties must be decoded before reporting"
                        );
                        assert.equal(suspect.metadata?.chunkReferences, entry.children.length);
                        assert.equal(suspect.content.size, byteLength);
                        assert.equal(suspect.content.recordedSizeDifference, 0);
                        assert.equal(suspect.vault.size, byteLength);
                        assert.equal(suspect.vault.contentSizeDifference, 0);
                        assert.ok(Number.isFinite(suspect.vault.mtimeDifferenceMs));
                        if (names === "pseudonym") {
                            assert.match(suspect.path, /^[A-Za-z0-9_-]{8}\$[0-9a-f]{32}$/);
                            assert.match(suspect.revision ?? "", /^1-psu[0-9a-f]{32}$/);
                        }
                        assert.ok(suspect.comparisons.some((comparison) => comparison.relation === "equal"));
                        await formats.getByRole("radio", { name: "MARKDOWN", exact: true }).check();
                        assert.equal(await formats.getByRole("radio", { checked: true }).count(), 1);
                        const markdown = await dialogue.locator("textarea").inputValue();
                        for (const reportText of [text, markdown]) {
                            for (const secret of [fixtureContent.trim(), passphrase, config.password, config.uri]) {
                                assert.ok(
                                    !reportText.includes(secret),
                                    "A report exposed fixture contents or credentials"
                                );
                            }
                            if (names === "pseudonym") {
                                for (const privateName of [fixturePath, entry.id, shadowId, ...entry.children]) {
                                    assert.ok(
                                        !reportText.includes(privateName),
                                        "A pseudonym report exposed a raw identifier"
                                    );
                                }
                            } else assert.ok(reportText.includes(fixturePath));
                        }
                        await dialogue.getByRole("button", { name: "Close", exact: true }).click();
                        await dialogue.waitFor({ state: "hidden", timeout });
                    }
                });
            } finally {
                calls = await finishRequests(cli, session);
            }
            assert.ok(calls.some((call) => call.transport === (native ? "nativeFetch" : "webCompatFetch")));
            assert.ok(
                calls.every((call) => call.method === "GET"),
                "Diagnostic requests must be read-only"
            );
            assert.equal(
                await localState(cli, session),
                localBefore,
                "Diagnostics changed the local database, settings, or Vault"
            );
            assert.equal(
                await remoteState(config, name),
                remoteBefore,
                "Diagnostics changed remote documents or Security Seed"
            );
        }
        console.log(
            JSON.stringify({
                encrypted,
                transports: ["webCompatFetch", "nativeFetch"],
                names: ["pseudonym", "original"],
                readOnly: true,
            })
        );
    } finally {
        try {
            if (session) await session.app.stop();
        } finally {
            try {
                await vault.dispose();
            } finally {
                if (created) await deleteCouchDbDatabase(config, name);
            }
        }
    }
}

async function main() {
    const config = await loadCouchDbConfig();
    await assertCouchDbReachable(config);
    for (const encrypted of [false, true]) await runCase(config, encrypted);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
