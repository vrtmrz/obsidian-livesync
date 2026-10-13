import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { createE2eObsidianDeviceLocalState, waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { openLiveSyncSettings, waitForVisibleObsidianDialogue, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const coreExpression = "app.plugins.plugins['obsidian-livesync'].core";
const firstKey = "synthetic-first-configuration-key";
const secondKey = "synthetic-second-configuration-key";
const wrongSavedKey = "synthetic-wrong-saved-configuration-key";
const diagnosticsDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
const screenshots: string[] = [];
const saveFailureMessage =
    "Configuration encryption could not be saved. Verify the saved settings and device key before retrying.";
const secrets = {
    couchDB_URI: "https://synthetic.invalid",
    couchDB_PASSWORD: "synthetic-connection-password",
    passphrase: "%synthetic-e2ee-passphrase",
    idDerivationKey: "ab".repeat(32),
    profile: "sls+http://synthetic-user:synthetic-password@synthetic.invalid/?db=synthetic-database",
};

async function readSecrets(cli: string, session: ObsidianLiveSyncSession): Promise<typeof secrets> {
    return await evalObsidianJson(
        cli,
        `(()=>{
        const settings=${coreExpression}.services.setting.currentSettings();
        return JSON.stringify({couchDB_URI:settings.couchDB_URI,couchDB_PASSWORD:settings.couchDB_PASSWORD,
            passphrase:settings.passphrase,idDerivationKey:settings.idDerivationKey,
            profile:settings.remoteConfigurations.inactive.uri});
    })()`,
        session.cliEnv
    );
}

async function capture(locator: Locator, filename: string): Promise<void> {
    await mkdir(diagnosticsDirectory, { recursive: true });
    const path = join(diagnosticsDirectory, filename);
    await locator.screenshot({ path, animations: "disabled", caret: "hide" });
    screenshots.push(path);
}

async function assertPendingLoad(
    cli: string,
    env: NodeJS.ProcessEnv,
    expectedKey: string | null = null
): Promise<void> {
    const state = await evalObsidianJson(
        cli,
        `(()=>{
        const core=${coreExpression};
        return JSON.stringify({databaseReady:core.services.database.isDatabaseReady(),
            tabRegistered:core.modules.some(module=>!!module.settingTab),
            key:localStorage.getItem('ls-setting-passphrase')});
    })()`,
        env
    );
    assert.deepEqual(state, { databaseReady: false, tabRegistered: false, key: expectedKey });
}

async function applyCustomKey(session: ObsidianLiveSyncSession, key: string, changeMode: boolean): Promise<void> {
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        try {
            const navigator = await openLiveSyncSettings(page);
            const root = await navigator.openPage("Power users");
            if (changeMode) {
                await root
                    .locator(".setting-item")
                    .filter({ hasText: "Encrypting sensitive configuration items" })
                    .getByRole("combobox")
                    .selectOption("LOCALSTORAGE");
            }
            await root.locator('input[type="password"]:visible').fill(key);
            await capture(
                navigator.dialogue,
                changeMode ? "02-custom-before-apply.png" : "04-custom-key-only-edit.png"
            );
            await root.getByRole("button", { name: "Apply", exact: true }).click();
            await page.waitForFunction(`(()=>{
                const core=${coreExpression};
                const tab=core.modules.find(module=>module.settingTab)?.settingTab;
                return tab && !tab.isDirty('configPassphrase') && !tab.isDirty('configPassphraseStore') &&
                    core.settings.configPassphraseStore==='LOCALSTORAGE' &&
                    localStorage.getItem('ls-setting-passphrase')===${JSON.stringify(key)};
            })()`);
            await capture(navigator.dialogue, changeMode ? "03-custom-applied.png" : "05-custom-key-only-applied.png");
            await navigator.close();
        } catch (error) {
            await mkdir(diagnosticsDirectory, { recursive: true });
            await page.screenshot({
                path: join(diagnosticsDirectory, "configuration-apply.failure.png"),
                fullPage: true,
            });
            throw error;
        }
    });
}

async function assertDefaultSettings(
    session: ObsidianLiveSyncSession,
    screenshot = "01-default-after-restart.png"
): Promise<void> {
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        assert.equal(await page.locator('.modal-container input[type="password"]').count(), 0);
        const navigator = await openLiveSyncSettings(page);
        const root = await navigator.openPage("Power users");
        const store = root
            .locator(".setting-item")
            .filter({ hasText: "Encrypting sensitive configuration items" })
            .getByRole("combobox");
        assert.equal(await store.inputValue(), "");
        assert.equal(await root.locator('input[type="password"]:visible').isDisabled(), true);
        await capture(navigator.dialogue, screenshot);
        await navigator.close();
    });
}

async function assertRejectedEmptyKey(cli: string, session: ObsidianLiveSyncSession, dataPath: string): Promise<void> {
    const before = await readFile(dataPath, "utf8");
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const navigator = await openLiveSyncSettings(page);
        const root = await navigator.openPage("Power users");
        await root.locator('input[type="password"]:visible').fill("");
        await root.getByRole("button", { name: "Apply", exact: true }).click();
        let notice: Locator | undefined;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !notice) {
            for (const candidate of page.context().pages()) {
                const matching = candidate.locator(".notice").filter({ hasText: saveFailureMessage }).last();
                if (await matching.isVisible()) {
                    notice = matching;
                    break;
                }
            }
            if (!notice) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(notice, "The rejected Apply did not display its failure notice");
        await capture(notice, "06-apply-failure-notice.png");
        const state = await evalObsidianJson(
            cli,
            `(()=>{
            const core=${coreExpression};
            const tab=core.modules.find(module=>module.settingTab)?.settingTab;
            return JSON.stringify({key:localStorage.getItem('ls-setting-passphrase'),
                store:core.settings.configPassphraseStore,dirty:tab.isDirty('configPassphrase')});
        })()`,
            session.cliEnv
        );
        assert.deepEqual(state, { key: secondKey, store: "LOCALSTORAGE", dirty: true });
        assert.equal(await readFile(dataPath, "utf8"), before);
        await capture(navigator.dialogue, "07-apply-failure-edits-retained.png");
        await root.locator('input[type="password"]:visible').fill(secondKey);
        await navigator.close();
    });
}

async function submitKey(page: Page, title: string, key: string): Promise<void> {
    const dialogue = await waitForVisibleObsidianDialogue(page, title);
    await dialogue.locator('input[type="password"]').fill(key);
    await dialogue.getByRole("button", { name: "OK", exact: true }).click();
}

async function applyAskMode(session: ObsidianLiveSyncSession): Promise<void> {
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const navigator = await openLiveSyncSettings(page);
        const root = await navigator.openPage("Power users");
        await root
            .locator(".setting-item")
            .filter({ hasText: "Encrypting sensitive configuration items" })
            .getByRole("combobox")
            .selectOption("ASK_AT_LAUNCH");
        await root.getByRole("button", { name: "Apply", exact: true }).click();
        await submitKey(page, "Configuration passphrase", secondKey);
        await page.waitForFunction(`(()=>{
            const core=${coreExpression};
            const tab=core.modules.find(module=>module.settingTab)?.settingTab;
            return tab && !tab.isDirty('configPassphraseStore') && core.settings.configPassphraseStore==='ASK_AT_LAUNCH';
        })()`);
        await navigator.close();
    });
}

async function applyDefaultMode(
    session: ObsidianLiveSyncSession,
    screenshot = "12-ask-to-default-before-restart.png"
): Promise<void> {
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const navigator = await openLiveSyncSettings(page);
        const root = await navigator.openPage("Power users");
        await root
            .locator(".setting-item")
            .filter({ hasText: "Encrypting sensitive configuration items" })
            .getByRole("combobox")
            .selectOption("");
        await root.getByRole("button", { name: "Apply", exact: true }).click();
        await page.waitForFunction(`(()=>{
            const core=${coreExpression};
            const tab=core.modules.find(module=>module.settingTab)?.settingTab;
            return tab && !tab.isDirty('configPassphraseStore') && core.settings.configPassphraseStore==='';
        })()`);
        await capture(navigator.dialogue, screenshot);
        await navigator.close();
    });
}

async function assertSavedConfigurationKey(cli: string, env: NodeJS.ProcessEnv, expectedKey: string): Promise<void> {
    const key = await evalObsidianJson(cli, `JSON.stringify(localStorage.getItem('ls-setting-passphrase'))`, env);
    assert.equal(key, expectedKey);
}

async function assertLoadedLocalStorageConfiguration(
    cli: string,
    env: NodeJS.ProcessEnv,
    expectedKey: string
): Promise<void> {
    const state = await evalObsidianJson(
        cli,
        `(()=>{
        const core=${coreExpression};
        return JSON.stringify({databaseReady:core.services.database.isDatabaseReady(),
            tabRegistered:core.modules.some(module=>!!module.settingTab),
            store:core.settings.configPassphraseStore,
            key:localStorage.getItem('ls-setting-passphrase')});
    })()`,
        env
    );
    assert.deepEqual(state, {
        databaseReady: true,
        tabRegistered: true,
        store: "LOCALSTORAGE",
        key: expectedKey,
    });
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked: ${cli.checked.join(", ")}`);
    const cliBinary = cli.binary;
    const firstVault = await createTemporaryVault("obsidian-livesync-configuration-source-");
    let secondVault: Awaited<ReturnType<typeof createTemporaryVault>> | undefined;
    let retryVault: Awaited<ReturnType<typeof createTemporaryVault>> | undefined;
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault: firstVault,
            pluginData: {
                doctorProcessedVersion: "1.0.35",
                isConfigured: true,
                remoteType: "",
                usePowerUserMode: true,
                liveSync: false,
                periodicReplication: false,
                syncOnStart: false,
                syncOnSave: false,
                syncOnFileOpen: false,
                syncOnEditorSave: false,
                syncAfterMerge: false,
                displayLanguage: "",
                notifyThresholdOfRemoteStorageSize: -1,
            },
            localStorageEntries: createE2eObsidianDeviceLocalState(firstVault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await evalObsidianJson(
            cliBinary,
            `(async()=>{
            const core=${coreExpression};
            await core.services.setting.applyPartial({encrypt:true,idDerivationVersion:1,
                idDerivationKey:${JSON.stringify(secrets.idDerivationKey)},passphrase:${JSON.stringify(secrets.passphrase)},
                couchDB_URI:${JSON.stringify(secrets.couchDB_URI)},couchDB_DBNAME:'synthetic-database',
                couchDB_PASSWORD:${JSON.stringify(secrets.couchDB_PASSWORD)},activeConfigurationId:'',
                remoteConfigurations:{inactive:{id:'inactive',name:'Synthetic profile',
                    uri:${JSON.stringify(secrets.profile)},isEncrypted:false}}},true);
            return JSON.stringify(true);
        })()`,
            session.cliEnv
        );
        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault: firstVault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        await evalObsidianJson(
            cliBinary,
            `(async()=>{
            await ${coreExpression}.services.setting.saveSettingData();
            return JSON.stringify(true);
        })()`,
            session.cliEnv
        );
        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault: firstVault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        await assertDefaultSettings(session);
        console.log(
            "Configuration encryption: Default save and restart preserved all protected values without a key prompt."
        );
        await applyCustomKey(session, firstKey, true);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        console.log("Configuration encryption: mode and custom key applied through the settings interface.");
        await session.app.stop();
        session = undefined;

        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault: firstVault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        await applyCustomKey(session, secondKey, false);
        console.log("Configuration encryption: restart and custom-key-only Apply preserved all protected values.");
        const sourceDataPath = join(firstVault.path, ".obsidian/plugins/obsidian-livesync/data.json");
        const encryptedData = await readFile(sourceDataPath, "utf8");
        const saved = JSON.parse(encryptedData) as Record<string, unknown>;
        assert.equal(saved.configPassphraseStore, "LOCALSTORAGE");
        assert.equal(saved.idDerivationKey, "");
        assert.equal(saved.passphrase, "");
        assert.equal(saved.couchDB_PASSWORD, "");
        for (const value of Object.values(secrets)) assert.equal(encryptedData.includes(value), false);
        await assertRejectedEmptyKey(cliBinary, session, sourceDataPath);
        console.log(
            "Configuration encryption: rejected empty-key Apply displayed a notice and retained the device key, saved data, and pending edit."
        );
        await applyDefaultMode(session, "18-custom-to-default-before-restart.png");
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        await assertSavedConfigurationKey(cliBinary, session.cliEnv, secondKey);
        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault: firstVault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        await assertSavedConfigurationKey(cliBinary, session.cliEnv, secondKey);
        await assertDefaultSettings(session, "19-custom-to-default-after-restart.png");
        console.log(
            "Configuration encryption: changing the custom key mode to Default preserved protected values without a prompt and retained the device key after restart."
        );
        await session.app.stop();
        session = undefined;

        secondVault = await createTemporaryVault("obsidian-livesync-configuration-copy-");
        const copyDataPath = join(secondVault.path, ".obsidian/plugins/obsidian-livesync/data.json");
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault: secondVault,
            pluginData: saved,
            localStorageEntries: createE2eObsidianDeviceLocalState(secondVault.name),
            lifecycle: {
                afterPluginLoad: async ({ remoteDebuggingPort, cliEnv }) => {
                    await withObsidianPage(remoteDebuggingPort, async (page) => {
                        try {
                            const missingKey = await waitForVisibleObsidianDialogue(page, "Configuration passphrase");
                            const missingInput = missingKey.locator('input[type="password"]');
                            assert.equal(await missingInput.getAttribute("type"), "password");
                            await missingInput.fill("synthetic-wrong-key");
                            await capture(missingKey.locator(".modal"), "08-missing-custom-key.png");
                            await assertPendingLoad(cliBinary, cliEnv);
                            const beforeInput = await readFile(copyDataPath, "utf8");
                            await submitKey(page, "Configuration passphrase", "synthetic-wrong-key");
                            const retry = await waitForVisibleObsidianDialogue(
                                page,
                                "Configuration could not be decrypted"
                            );
                            await retry.locator('input[type="password"]').fill(secondKey);
                            await capture(retry.locator(".modal"), "09-wrong-key-retry.png");
                            await assertPendingLoad(cliBinary, cliEnv);
                            assert.equal(await readFile(copyDataPath, "utf8"), beforeInput);
                            await retry.getByRole("button", { name: "Cancel", exact: true }).click();
                            await retry.waitFor({ state: "hidden" });
                            await assertPendingLoad(cliBinary, cliEnv);
                            assert.equal(await readFile(copyDataPath, "utf8"), beforeInput);

                            await evalObsidianJson(
                                cliBinary,
                                `(async()=>{
                                await app.plugins.disablePlugin('obsidian-livesync');
                                await app.plugins.enablePlugin('obsidian-livesync');
                                return JSON.stringify(true);
                            })()`,
                                cliEnv
                            );
                            await submitKey(page, "Configuration passphrase", secondKey);
                        } catch (error) {
                            await mkdir(diagnosticsDirectory, { recursive: true });
                            await page.screenshot({
                                path: join(diagnosticsDirectory, "configuration-unlock.failure.png"),
                                fullPage: true,
                            });
                            throw error;
                        }
                    });
                },
            },
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const navigator = await openLiveSyncSettings(page);
            await navigator.openPage("Power users");
            await capture(navigator.dialogue, "10-unlocked-settings.png");
            await navigator.close();
        });
        await session.app.stop();
        session = undefined;

        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault: secondVault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        console.log(
            "Configuration encryption: Apply and custom-key-only Apply survive restart; copied settings unlock after wrong input, cancellation, and retry; the validated key survives another restart."
        );
        await applyAskMode(session);
        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault: secondVault,
            lifecycle: {
                afterPluginLoad: async ({ remoteDebuggingPort, cliEnv }) => {
                    await withObsidianPage(remoteDebuggingPort, async (page) => {
                        const dialogue = await waitForVisibleObsidianDialogue(page, "Configuration passphrase");
                        const input = dialogue.locator('input[type="password"]');
                        assert.equal(await input.getAttribute("type"), "password");
                        await input.fill(secondKey);
                        await assertPendingLoad(cliBinary, cliEnv, secondKey);
                        await capture(dialogue.locator(".modal"), "11-ask-at-launch-masked.png");
                        await dialogue.getByRole("button", { name: "OK", exact: true }).click();
                    });
                },
            },
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        await evalObsidianJson(
            cliBinary,
            `(async()=>{
            await ${coreExpression}.services.setting.saveSettingData();
            return JSON.stringify(true);
        })()`,
            session.cliEnv
        );
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        console.log(
            "Configuration encryption: ASK input was masked and the validated key was reused for an ordinary save in this launch."
        );

        await applyDefaultMode(session);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        await assertSavedConfigurationKey(cliBinary, session.cliEnv, secondKey);
        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault: secondVault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        await assertSavedConfigurationKey(cliBinary, session.cliEnv, secondKey);
        await assertDefaultSettings(session, "13-ask-to-default-after-restart.png");
        console.log(
            "Configuration encryption: changing ASK_AT_LAUNCH to Default through settings restored protected values without a prompt and retained the device key after restart."
        );
        await session.app.stop();
        session = undefined;

        retryVault = await createTemporaryVault("obsidian-livesync-configuration-wrong-saved-key-");
        const retryDataPath = join(retryVault.path, ".obsidian/plugins/obsidian-livesync/data.json");
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault: retryVault,
            pluginData: saved,
            localStorageEntries: {
                ...createE2eObsidianDeviceLocalState(retryVault.name),
                "ls-setting-passphrase": wrongSavedKey,
            },
            lifecycle: {
                afterPluginLoad: async ({ remoteDebuggingPort, cliEnv }) => {
                    await withObsidianPage(remoteDebuggingPort, async (page) => {
                        try {
                            const retry = await waitForVisibleObsidianDialogue(
                                page,
                                "Configuration could not be decrypted"
                            );
                            const input = retry.locator('input[type="password"]');
                            assert.equal(await input.getAttribute("type"), "password");
                            await assertPendingLoad(cliBinary, cliEnv, wrongSavedKey);
                            const beforeCancellation = await readFile(retryDataPath, "utf8");
                            await capture(retry.locator(".modal"), "14-saved-wrong-key-retry-prompt.png");
                            await retry.getByRole("button", { name: "Cancel", exact: true }).click();
                            await retry.waitFor({ state: "hidden" });
                            await assertPendingLoad(cliBinary, cliEnv, wrongSavedKey);
                            assert.equal(await readFile(retryDataPath, "utf8"), beforeCancellation);

                            await evalObsidianJson(
                                cliBinary,
                                `(async()=>{
                                await app.plugins.disablePlugin('obsidian-livesync');
                                await app.plugins.enablePlugin('obsidian-livesync');
                                return JSON.stringify(true);
                            })()`,
                                cliEnv
                            );
                            const retryAfterCancellation = await waitForVisibleObsidianDialogue(
                                page,
                                "Configuration could not be decrypted"
                            );
                            const retryInput = retryAfterCancellation.locator('input[type="password"]');
                            assert.equal(await retryInput.getAttribute("type"), "password");
                            await assertPendingLoad(cliBinary, cliEnv, wrongSavedKey);
                            await retryInput.fill(secondKey);
                            await capture(
                                retryAfterCancellation.locator(".modal"),
                                "15-saved-wrong-key-correct-retry.png"
                            );
                            await assertPendingLoad(cliBinary, cliEnv, wrongSavedKey);
                            await retryAfterCancellation.getByRole("button", { name: "OK", exact: true }).click();
                        } catch (error) {
                            await mkdir(diagnosticsDirectory, { recursive: true });
                            await page.screenshot({
                                path: join(diagnosticsDirectory, "configuration-saved-key-retry.failure.png"),
                                fullPage: true,
                            });
                            throw error;
                        }
                    });
                },
            },
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        await assertLoadedLocalStorageConfiguration(cliBinary, session.cliEnv, secondKey);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            assert.equal(await page.locator('.modal-container input[type="password"]').count(), 0);
            const navigator = await openLiveSyncSettings(page);
            await navigator.openPage("Power users");
            await capture(navigator.dialogue, "16-saved-wrong-key-unlocked-settings.png");
            await navigator.close();
        });
        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault: retryVault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        assert.deepEqual(await readSecrets(cliBinary, session), secrets);
        await assertLoadedLocalStorageConfiguration(cliBinary, session.cliEnv, secondKey);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            assert.equal(await page.locator('.modal-container input[type="password"]').count(), 0);
            const navigator = await openLiveSyncSettings(page);
            await navigator.openPage("Power users");
            await capture(navigator.dialogue, "17-validated-key-after-restart.png");
            await navigator.close();
        });
        console.log(
            "Configuration encryption: a saved wrong key remained intact after cancellation; the correct retry restored protected values, persisted the validated key, and survived another restart."
        );
        console.log(`Configuration encryption screenshots: ${JSON.stringify(screenshots)}`);
    } finally {
        if (session) await session.app.stop();
        await firstVault.dispose();
        if (secondVault) await secondVault.dispose();
        if (retryVault) await retryVault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
