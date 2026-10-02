import { deepStrictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import {
    DEFAULT_SETTINGS,
    REMOTE_COUCHDB,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { deriveIdKey } from "@vrtmrz/livesync-commonlib/settings";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { assertEqual } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { waitForVisibleObsidianDialogue, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETTINGS_TIMEOUT_MS ?? 10000);
const sourcePassphrase = "e2e-markdown-source-settings-passphrase";
const receiverPassphrase = "e2e-markdown-receiver-settings-passphrase";
const diagnosticsDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
const ordinarySettings = {
    showVerboseLog: true,
    batchSaveMinimumDelay: 7,
    batchSaveMaximumDelay: 19,
};
const credentialKeys = [
    "couchDB_USER",
    "couchDB_PASSWORD",
    "couchDB_CustomHeaders",
    "jwtKey",
    "jwtKid",
    "jwtSub",
    "accessKey",
    "secretKey",
    "bucketCustomHeaders",
    "passphrase",
    "idDerivationKey",
    "P2P_passphrase",
] as const;
const connectionContextKeys = ["couchDB_URI", "couchDB_DBNAME", "endpoint", "bucket", "region"] as const;
const protectedConnectionKeys = [
    "couchDB_URI",
    "couchDB_USER",
    "couchDB_PASSWORD",
    "couchDB_DBNAME",
    "couchDB_CustomHeaders",
    "jwtKey",
    "jwtKid",
    "jwtSub",
    "accessKey",
    "secretKey",
    "bucket",
    "endpoint",
    "bucketCustomHeaders",
];

async function readCurrentSettings(cliBinary: string, session: ObsidianLiveSyncSession) {
    return await evalObsidianJson<ObsidianLiveSyncSettings>(
        cliBinary,
        "JSON.stringify(app.plugins.plugins['obsidian-livesync'].core.services.setting.currentSettings())",
        session.cliEnv
    );
}

async function readPersistedSettings(vaultPath: string): Promise<Record<string, unknown>> {
    return JSON.parse(
        await readFile(join(vaultPath, ".obsidian", "plugins", "obsidian-livesync", "data.json"), "utf8")
    );
}

async function waitFor<T>(description: string, read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 15000);
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            const value = await read();
            if (ready(value)) return value;
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${description}: ${String(lastError)}`);
}

function assertEmptyReceiver(settings: ObsidianLiveSyncSettings) {
    for (const key of [...credentialKeys, ...connectionContextKeys]) {
        assertEqual(settings[key], DEFAULT_SETTINGS[key], `The receiver already had ${key}.`);
    }
    assertEqual(settings.idDerivationVersion, 0, "The receiver already had an independent ID key.");
    deepStrictEqual(settings.remoteConfigurations, {}, "The receiver already had connection profiles.");
    assertEqual(settings.activeConfigurationId, "", "The receiver already had a selected connection.");
    assertEqual(settings.P2P_ActiveRemoteConfigurationId, "", "The receiver already had a selected P2P connection.");
    assertEqual(settings.settingSyncFile, "", "The receiver already had setting Markdown enabled.");
    assertEqual(settings.showVerboseLog, false, "The receiver already had the ordinary setting fixture.");
}

function assertImportedSettings(
    settings: ObsidianLiveSyncSettings,
    source: ObsidianLiveSyncSettings,
    includeCredentials: boolean,
    settingPath: string
) {
    for (const [key, value] of Object.entries(ordinarySettings)) {
        assertEqual(settings[key as keyof ObsidianLiveSyncSettings], value, `Imported ${key} differs.`);
    }
    assertEqual(settings.settingSyncFile, settingPath, "The imported Markdown path differs.");
    assertEqual(settings.writeCredentialsForSettingSync, includeCredentials, "The credential export flag differs.");
    assertEqual(settings.remoteType, REMOTE_COUCHDB, "The imported remote type differs.");
    assertEqual(settings.configPassphraseStore, "LOCALSTORAGE", "The settings protection mode differs.");
    for (const key of connectionContextKeys) {
        assertEqual(settings[key], source[key], `Imported connection context ${key} differs.`);
    }
    for (const key of credentialKeys) {
        assertEqual(
            settings[key],
            includeCredentials ? source[key] : DEFAULT_SETTINGS[key],
            `Imported credential ${key} differs.`
        );
    }
    assertEqual(settings.idDerivationVersion, includeCredentials ? 1 : 0, "The imported ID key version differs.");
    if (includeCredentials) {
        deepStrictEqual(
            settings.remoteConfigurations,
            source.remoteConfigurations,
            "The complete profile group differs."
        );
        assertEqual(settings.activeConfigurationId, source.activeConfigurationId, "The selected connection differs.");
        assertEqual(
            settings.P2P_ActiveRemoteConfigurationId,
            source.P2P_ActiveRemoteConfigurationId,
            "The selected P2P connection differs."
        );
    } else {
        // Legacy migration may create new credential-free profiles from the retained flat connection fields.
        for (const id of Object.keys(source.remoteConfigurations)) {
            assertEqual(id in settings.remoteConfigurations, false, "An omitted source profile was imported.");
            assertEqual(settings.activeConfigurationId === id, false, "An omitted source selection was imported.");
            assertEqual(
                settings.P2P_ActiveRemoteConfigurationId === id,
                false,
                "An omitted P2P selection was imported."
            );
        }
        for (const profile of Object.values(settings.remoteConfigurations)) {
            assertEqual(profile.isEncrypted, false, "A migrated runtime profile was not decrypted.");
            ConnectionStringParser.parse(profile.uri);
            const uri = decodeURIComponent(profile.uri);
            for (const key of credentialKeys) {
                assertEqual(uri.includes(source[key]), false, `An omitted ${key} appeared in a migrated profile.`);
            }
        }
    }
}

function assertProtectedPersistence(persisted: Record<string, unknown>, includeCredentials: boolean) {
    for (const key of protectedConnectionKeys) {
        assertEqual(persisted[key], "", `Imported plaintext ${key} was persisted.`);
    }
    if (typeof persisted.encryptedCouchDBConnection !== "string" || !persisted.encryptedCouchDBConnection) {
        throw new Error("The imported connection settings were not encrypted locally.");
    }
    if (includeCredentials) {
        for (const key of ["encryptedPassphrase", "encryptedIdDerivationKey"]) {
            if (typeof persisted[key] !== "string" || !persisted[key]) throw new Error(`${key} was not persisted.`);
        }
        assertEqual(persisted.passphrase, "", "The imported E2EE passphrase was persisted in plain text.");
        assertEqual(persisted.idDerivationKey, "", "The imported ID key was persisted in plain text.");
    }
    const profiles = persisted.remoteConfigurations as ObsidianLiveSyncSettings["remoteConfigurations"];
    for (const profile of Object.values(profiles)) {
        assertEqual(profile.isEncrypted, true, "An imported connection profile was persisted in plain text.");
    }
}

async function importThroughUI(
    cliBinary: string,
    session: ObsidianLiveSyncSession,
    settingPath: string,
    label: string
) {
    const opened = await evalObsidianJson<boolean>(
        cliBinary,
        [
            "(async()=>{",
            `const file=app.vault.getAbstractFileByPath(${JSON.stringify(settingPath)});`,
            "if(!file) throw new Error('The copied Markdown file is unavailable');",
            "await app.workspace.getLeaf(false).openFile(file,{state:{mode:'source'}});",
            "return JSON.stringify(app.commands.executeCommandById('obsidian-livesync:livesync-import-config'));",
            "})()",
        ].join(""),
        session.cliEnv
    );
    assertEqual(opened, true, "The real Markdown import command was unavailable.");
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const notice = page.locator(".notice").filter({ hasText: `Setting markdown ${settingPath}` });
        await notice
            .locator("a")
            .filter({ hasText: /^HERE$/u })
            .click({ timeout: uiTimeoutMs });
        const dialogue = await waitForVisibleObsidianDialogue(page, "Ready for apply the setting.", uiTimeoutMs);
        await dialogue.screenshot({ path: join(diagnosticsDirectory, `setting-markdown-${label}-import.png`) });
        await dialogue.getByRole("button", { name: "Apply settings", exact: true }).click({ timeout: uiTimeoutMs });
        await dialogue.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
}

async function main() {
    const startedAt = Date.now();
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    await mkdir(diagnosticsDirectory, { recursive: true });
    const sourceVault = await createTemporaryVault("livesync-markdown-source-");
    const receivers: Awaited<ReturnType<typeof createTemporaryVault>>[] = [];
    let session: ObsidianLiveSyncSession | undefined;
    const results: Record<string, unknown>[] = [];
    const sourceSettings: ObsidianLiveSyncSettings = {
        ...structuredClone(DEFAULT_SETTINGS),
        ...ordinarySettings,
        remoteType: REMOTE_COUCHDB,
        configPassphraseStore: "LOCALSTORAGE",
        couchDB_URI: "https://couchdb.synthetic.invalid",
        couchDB_DBNAME: "synthetic-vault",
        couchDB_USER: "synthetic-couch-user",
        couchDB_PASSWORD: "synthetic-couch-password",
        couchDB_CustomHeaders: "X-Synthetic-Couch: synthetic-couch-header",
        useJWT: true,
        jwtAlgorithm: "HS256",
        jwtKey: "synthetic-jwt-key",
        jwtKid: "synthetic-jwt-kid",
        jwtSub: "synthetic-jwt-sub",
        endpoint: "https://storage.synthetic.invalid",
        bucket: "synthetic-bucket",
        region: "auto",
        accessKey: "synthetic-access-key",
        secretKey: "synthetic-secret-key",
        bucketCustomHeaders: "X-Synthetic-Bucket: synthetic-bucket-header",
        encrypt: true,
        passphrase: "synthetic-vault-passphrase",
        idDerivationVersion: 1,
        idDerivationKey: await deriveIdKey("synthetic-markdown-roundtrip-independent-id-key"),
        P2P_roomID: "synthetic-peer-room",
        P2P_passphrase: "synthetic-peer-passphrase",
        P2P_relays: "wss://relay.synthetic.invalid",
        isConfigured: false,
        liveSync: false,
        syncOnSave: false,
        syncOnStart: false,
        periodicReplication: false,
        syncOnFileOpen: false,
        syncOnEditorSave: false,
        P2P_Enabled: false,
        P2P_AutoStart: false,
    };
    sourceSettings.remoteConfigurations = Object.fromEntries(
        [
            { id: "synthetic-couchdb", name: "Synthetic CouchDB", type: "couchdb" as const },
            { id: "synthetic-storage", name: "Synthetic Object Storage", type: "s3" as const },
            { id: "synthetic-peer", name: "Synthetic P2P", type: "p2p" as const },
        ].map(({ id, name, type }) => [
            id,
            { id, name, uri: ConnectionStringParser.serialize({ type, settings: sourceSettings }), isEncrypted: false },
        ])
    );
    sourceSettings.activeConfigurationId = "synthetic-couchdb";
    sourceSettings.P2P_ActiveRemoteConfigurationId = "synthetic-peer";

    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault: sourceVault,
            pluginData: { configPassphraseStore: "LOCALSTORAGE" },
            localStorageEntries: { "ls-setting-passphrase": sourcePassphrase },
        });
        const exports: { includeCredentials: boolean; settingPath: string; label: string; sha256: string }[] = [];
        for (const includeCredentials of [true, false]) {
            const label = includeCredentials ? "with-credentials" : "without-credentials";
            const settingPath = `LiveSync/settings-${label}.md`;
            const configured = {
                ...sourceSettings,
                settingSyncFile: settingPath,
                writeCredentialsForSettingSync: includeCredentials,
            };
            const exported = await evalObsidianJson<boolean>(
                cli.binary,
                "(async()=>{const core=app.plugins.plugins['obsidian-livesync'].core;" +
                    `await core.services.setting.applyExternalSettings(${JSON.stringify(configured)},false);` +
                    "return JSON.stringify(app.commands.executeCommandById('obsidian-livesync:livesync-export-config'));})()",
                session.cliEnv
            );
            assertEqual(exported, true, "The real Markdown export command was unavailable.");
            const content = await waitFor(
                "the real Markdown export",
                () => readFile(join(sourceVault.path, settingPath), "utf8"),
                (value) => value.includes(`writeCredentialsForSettingSync: ${includeCredentials}`)
            );
            const body = content.match(/````yaml:livesync-setting\n([\s\S]*?)````/)?.[1];
            if (!body) throw new Error("The real export did not contain a settings code block.");
            const parsed = parse(body) as Record<string, unknown>;
            for (const key of ["encryptedCouchDBConnection", "encryptedPassphrase", "encryptedIdDerivationKey"]) {
                assertEqual(key in parsed, false, `Local ciphertext ${key} appeared in Markdown.`);
            }
            for (const key of [
                ...credentialKeys,
                "remoteConfigurations",
                "activeConfigurationId",
                "P2P_ActiveRemoteConfigurationId",
            ]) {
                assertEqual(key in parsed, includeCredentials, `Export presence differs for ${key}.`);
            }
            for (const secret of [
                sourcePassphrase,
                receiverPassphrase,
                ...credentialKeys.map((key) => sourceSettings[key]),
            ]) {
                if (!includeCredentials || secret === sourcePassphrase || secret === receiverPassphrase) {
                    assertEqual(content.includes(secret), false, "An omitted secret appeared in the real export.");
                }
            }
            await copyFile(
                join(sourceVault.path, settingPath),
                join(diagnosticsDirectory, `setting-markdown-${label}.md`)
            );
            exports.push({
                includeCredentials,
                settingPath,
                label,
                sha256: createHash("sha256").update(content).digest("hex"),
            });
            console.log(`Generated actual Markdown ${label}.`);
        }
        await session.app.stop();
        session = undefined;

        for (const { includeCredentials, settingPath, label, sha256 } of exports) {
            const caseStartedAt = Date.now();
            const receiver = await createTemporaryVault(`livesync-markdown-${label}-receiver-`);
            receivers.push(receiver);
            await mkdir(join(receiver.path, "LiveSync"), { recursive: true });
            await copyFile(join(sourceVault.path, settingPath), join(receiver.path, settingPath));
            assertEqual(
                createHash("sha256")
                    .update(await readFile(join(receiver.path, settingPath), "utf8"))
                    .digest("hex"),
                sha256,
                "The receiving Markdown differs from the generated original."
            );
            session = await startObsidianLiveSyncSession({
                binary,
                cliBinary: cli.binary,
                vault: receiver,
                // This device-local protection key is independent of the empty plug-in settings and the source key.
                localStorageEntries: { "ls-setting-passphrase": receiverPassphrase },
            });
            assertEmptyReceiver(await readCurrentSettings(cli.binary, session));
            await importThroughUI(cli.binary, session, settingPath, label);
            const persisted = await waitFor(
                "the applied settings on disk",
                () => readPersistedSettings(receiver.path),
                (value) => value.showVerboseLog === true && value.settingSyncFile === settingPath
            );
            assertProtectedPersistence(persisted, includeCredentials);
            assertImportedSettings(
                await readCurrentSettings(cli.binary, session),
                sourceSettings,
                includeCredentials,
                settingPath
            );
            await session.app.stop();
            session = undefined;
            // Keep the actual Vault and profile; do not seed settings or localStorage on restart.
            session = await startObsidianLiveSyncSession({ binary, cliBinary: cli.binary, vault: receiver });
            assertImportedSettings(
                await readCurrentSettings(cli.binary, session),
                sourceSettings,
                includeCredentials,
                settingPath
            );
            assertProtectedPersistence(await readPersistedSettings(receiver.path), includeCredentials);
            await session.app.stop();
            session = undefined;
            results.push({
                includeCredentials,
                sha256,
                emptyReceiverVerified: true,
                uiImportVerified: true,
                encryptedPersistenceVerified: true,
                sameVaultRestartVerified: true,
                elapsedMs: Date.now() - caseStartedAt,
            });
            console.log(`Imported ${label} into empty settings, then verified encrypted persistence and restart.`);
        }
        const reportPath = join(diagnosticsDirectory, "setting-markdown-roundtrip.json");
        await writeFile(
            reportPath,
            JSON.stringify(
                {
                    pluginSHA256: createHash("sha256")
                        .update(await readFile("main.js", "utf8"))
                        .digest("hex"),
                    elapsedMs: Date.now() - startedAt,
                    results,
                },
                null,
                2
            ) + "\n"
        );
        console.log(`Markdown round-trip report: ${reportPath}`);
    } finally {
        if (session) await session.app.stop();
        for (const receiver of receivers) await receiver.dispose();
        await sourceVault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
