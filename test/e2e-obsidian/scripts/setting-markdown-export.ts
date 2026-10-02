import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { REMOTE_MINIO } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { deriveIdKey } from "@vrtmrz/livesync-commonlib/settings";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { assertEqual } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";

const settingPath = "LiveSync/settings-export.md";
const localSettingsPassphrase = "e2e-local-settings-passphrase-fixture";
const objectStorageCredentialValues = {
    accessKey: "e2e-object-storage-access-key-fixture",
    secretKey: "e2e-object-storage-secret-key-fixture",
    jwtKey: "e2e-jwt-key-fixture",
    jwtKid: "e2e-jwt-kid-fixture",
    jwtSub: "e2e-jwt-sub-fixture",
    couchDB_CustomHeaders: "X-E2E-CouchDB: synthetic-header-fixture",
    bucketCustomHeaders: "X-E2E-Bucket: synthetic-header-fixture",
};

async function waitForFileContaining(
    vaultPath: string,
    path: string,
    predicates: ((content: string) => boolean)[],
    timeoutMs = Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 10000)
): Promise<string> {
    const fullPath = join(vaultPath, path);
    const deadline = Date.now() + timeoutMs;
    let lastContent = "";
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            lastContent = await readFile(fullPath, "utf-8");
            if (predicates.every((predicate) => predicate(lastContent))) {
                return lastContent;
            }
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for setting Markdown: ${fullPath}\nLast error: ${String(lastError)}`);
}

async function configureSettingMarkdown(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    idDerivationKey: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.setting.applyExternalSettings({",
            `settingSyncFile:${JSON.stringify(settingPath)},`,
            "writeCredentialsForSettingSync:false,",
            "couchDB_USER:'e2e-user',",
            "couchDB_PASSWORD:'e2e-password',",
            "passphrase:'e2e-passphrase',",
            "idDerivationVersion:1,",
            `idDerivationKey:${JSON.stringify(idDerivationKey)},`,
            "showVerboseLog:true,",
            "},true);",
            "await core.services.setting.saveSettingData();",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function configureObjectStorageSettingMarkdown(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    const settings = {
        settingSyncFile: settingPath,
        writeCredentialsForSettingSync: false,
        configPassphraseStore: "LOCALSTORAGE",
        remoteType: REMOTE_MINIO,
        couchDB_URI: "",
        couchDB_USER: "",
        couchDB_PASSWORD: "",
        couchDB_DBNAME: "",
        remoteConfigurations: {},
        activeConfigurationId: "",
        ...objectStorageCredentialValues,
        useJWT: true,
        liveSync: false,
        syncOnSave: false,
        syncOnStart: false,
        periodicReplication: false,
        syncOnFileOpen: false,
        syncOnEditorSave: false,
        P2P_Enabled: false,
        P2P_AutoStart: false,
    };
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `await core.services.setting.applyExternalSettings(${JSON.stringify(settings)},true);`,
            "await core.services.setting.saveSettingData();",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    const vault = await createTemporaryVault();
    const idDerivationKey = await deriveIdKey("setting-markdown-export-independent-id-key-fixture");
    let session: ObsidianLiveSyncSession | undefined;
    let objectStorageVault: Awaited<ReturnType<typeof createTemporaryVault>> | undefined;
    try {
        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault: ${vault.path}`);

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        // The export is available while an unconfigured Vault remains outside
        // application readiness; the session helper has already loaded the plug-in.
        await configureSettingMarkdown(cli.binary, session.cliEnv, idDerivationKey);
        const content = await waitForFileContaining(vault.path, settingPath, [
            (value) => value.includes("````yaml:livesync-setting"),
            (value) => value.includes(`settingSyncFile: ${settingPath}`),
            (value) => value.includes("showVerboseLog: true"),
        ]);

        const persisted = JSON.parse(
            await readFile(join(vault.path, ".obsidian", "plugins", "obsidian-livesync", "data.json"), "utf-8")
        ) as {
            idDerivationVersion?: unknown;
            idDerivationKey?: unknown;
            encryptedIdDerivationKey?: unknown;
        };
        assertEqual(persisted.idDerivationVersion, 1, "The independent ID key fixture was not persisted.");
        assertEqual(persisted.idDerivationKey, "", "The independent ID key was stored in plain text locally.");
        const encryptedIdDerivationKey = persisted.encryptedIdDerivationKey;
        if (typeof encryptedIdDerivationKey !== "string" || encryptedIdDerivationKey.length === 0) {
            throw new Error("The independent ID key fixture was not saved in encrypted local settings.");
        }

        assertEqual(
            content.includes("couchDB_PASSWORD: e2e-password"),
            false,
            "Credential leaked into setting Markdown."
        );
        assertEqual(content.includes("passphrase: e2e-passphrase"), false, "Passphrase leaked into setting Markdown.");
        assertEqual(content.includes(idDerivationKey), false, "Plaintext ID key leaked into setting Markdown.");
        assertEqual(
            content.includes(encryptedIdDerivationKey),
            false,
            "Encrypted ID key leaked into setting Markdown."
        );

        console.log(`Generated setting Markdown without credentials: ${settingPath}`);

        await session.app.stop();
        session = undefined;
        objectStorageVault = await createTemporaryVault();
        console.log(`Temporary Object Storage vault: ${objectStorageVault.path}`);
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault: objectStorageVault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: { configPassphraseStore: "LOCALSTORAGE" },
            localStorageEntries: { "ls-setting-passphrase": localSettingsPassphrase },
        });
        await configureObjectStorageSettingMarkdown(cli.binary, session.cliEnv);
        const objectStorageContent = await waitForFileContaining(objectStorageVault.path, settingPath, [
            (value) => value.includes("````yaml:livesync-setting"),
            (value) => value.includes(`settingSyncFile: ${settingPath}`),
            (value) => value.includes("remoteType: MINIO"),
        ]);

        const objectStorageDataPath = join(
            objectStorageVault.path,
            ".obsidian",
            "plugins",
            "obsidian-livesync",
            "data.json"
        );
        const persistedObjectStorage = JSON.parse(await readFile(objectStorageDataPath, "utf-8")) as Record<
            string,
            unknown
        >;
        assertEqual(
            persistedObjectStorage.configPassphraseStore,
            "LOCALSTORAGE",
            "The Object Storage credential protection setting was not persisted."
        );
        const clearedProtectedSettings = {
            couchDB_URI: "",
            couchDB_USER: "",
            couchDB_PASSWORD: "",
            couchDB_DBNAME: "",
            accessKey: "",
            secretKey: "",
            jwtKey: "",
            jwtKid: "",
            jwtSub: "",
            couchDB_CustomHeaders: "",
            bucketCustomHeaders: "",
        };
        for (const [key, value] of Object.entries(clearedProtectedSettings)) {
            assertEqual(persistedObjectStorage[key], value, `Plaintext ${key} was not cleared from data.json.`);
        }
        const encryptedObjectStorageCredentials = persistedObjectStorage.encryptedCouchDBConnection;
        if (typeof encryptedObjectStorageCredentials !== "string" || encryptedObjectStorageCredentials.length === 0) {
            throw new Error("Object Storage credentials were not saved in encrypted local settings.");
        }
        const markdownSecrets = [localSettingsPassphrase, ...Object.values(objectStorageCredentialValues)];
        for (const secret of markdownSecrets) {
            assertEqual(objectStorageContent.includes(secret), false, "A protected setting leaked into Markdown.");
        }
        assertEqual(
            objectStorageContent.includes(encryptedObjectStorageCredentials),
            false,
            "Encrypted Object Storage credentials leaked into setting Markdown."
        );
        for (const [key, value] of Object.entries(persistedObjectStorage)) {
            if (key.startsWith("encrypted") && typeof value === "string" && value !== "") {
                assertEqual(
                    objectStorageContent.includes(value),
                    false,
                    `Encrypted ${key} leaked into setting Markdown.`
                );
            }
        }

        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({ binary, cliBinary: cli.binary, vault: objectStorageVault });
        const restoredObjectStorage = await evalObsidianJson<Record<string, unknown>>(
            cli.binary,
            [
                "(()=>{",
                "const settings=app.plugins.plugins['obsidian-livesync'].core.settings;",
                "return JSON.stringify({",
                "remoteType:settings.remoteType,",
                "couchDB_URI:settings.couchDB_URI,",
                "couchDB_USER:settings.couchDB_USER,",
                "couchDB_PASSWORD:settings.couchDB_PASSWORD,",
                "couchDB_DBNAME:settings.couchDB_DBNAME,",
                "accessKey:settings.accessKey,",
                "secretKey:settings.secretKey,",
                "jwtKey:settings.jwtKey,",
                "jwtKid:settings.jwtKid,",
                "jwtSub:settings.jwtSub,",
                "couchDB_CustomHeaders:settings.couchDB_CustomHeaders,",
                "bucketCustomHeaders:settings.bucketCustomHeaders,",
                "configPassphraseStore:settings.configPassphraseStore,",
                "useJWT:settings.useJWT,",
                "liveSync:settings.liveSync,",
                "syncOnSave:settings.syncOnSave,",
                "syncOnStart:settings.syncOnStart,",
                "periodicReplication:settings.periodicReplication,",
                "syncOnFileOpen:settings.syncOnFileOpen,",
                "syncOnEditorSave:settings.syncOnEditorSave,",
                "P2P_Enabled:settings.P2P_Enabled,",
                "P2P_AutoStart:settings.P2P_AutoStart",
                "});",
                "})()",
            ].join(""),
            session.cliEnv
        );
        assertEqual(restoredObjectStorage.remoteType, REMOTE_MINIO, "The Object Storage remote type was not restored.");
        for (const [key, value] of Object.entries({
            couchDB_URI: "",
            couchDB_USER: "",
            couchDB_PASSWORD: "",
            couchDB_DBNAME: "",
            liveSync: false,
            syncOnSave: false,
            syncOnStart: false,
            periodicReplication: false,
            syncOnFileOpen: false,
            syncOnEditorSave: false,
            configPassphraseStore: "LOCALSTORAGE",
            useJWT: true,
            P2P_Enabled: false,
            P2P_AutoStart: false,
            ...objectStorageCredentialValues,
        })) {
            assertEqual(restoredObjectStorage[key], value, `Object Storage ${key} was not restored after restart.`);
        }

        console.log(
            "Persisted protected Object Storage settings, then restored them after restarting the same Object Storage Vault."
        );
    } finally {
        if (session) {
            await session.app.stop();
        }
        if (objectStorageVault) {
            await objectStorageVault.dispose();
        }
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
