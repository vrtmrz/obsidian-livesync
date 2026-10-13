import { describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import {
    DEFAULT_SETTINGS,
    REMOTE_MINIO,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import { CLOUDFLARE_TURN_TYPE } from "@/integrations/cloudflare/settings";
import { ModuleObsidianSettingsAsMarkdown } from "./ModuleObsidianSettingAsMarkdown";

vi.mock("@/deps", async () => {
    const yaml = await import("yaml");
    return { parseYaml: yaml.parse, stringifyYaml: yaml.stringify };
});

function createHarness(includeCredentials = false, existingFile = false) {
    const settings: ObsidianLiveSyncSettings = {
        ...structuredClone(DEFAULT_SETTINGS),
        remoteType: REMOTE_MINIO,
        remoteConfigurations: {},
        activeConfigurationId: "",
        settingSyncFile: "LiveSync/synthetic-settings.md",
        writeCredentialsForSettingSync: includeCredentials,
        accessKey: "synthetic-export-access-key",
        secretKey: "synthetic-export-secret-key",
        couchDB_PASSWORD: "synthetic-export-couch-password",
        encryptedCouchDBConnection: "synthetic-encrypted-connection",
    };
    const files = new Map<string, string>();
    if (existingFile) {
        files.set(
            settings.settingSyncFile,
            "Synthetic note\n````yaml:livesync-setting\n" + stringify(settings) + "\n````\n"
        );
    }
    const storageAccess = {
        isExists: vi.fn(async (path: string) => files.has(path)),
        ensureDir: vi.fn(async () => true),
        readFileText: vi.fn(async (path: string) => files.get(path) ?? ""),
        writeFileAuto: vi.fn(async (path: string, data: string) => {
            files.set(path, data);
            return true;
        }),
    };
    const module = Object.assign(Object.create(ModuleObsidianSettingsAsMarkdown.prototype), {
        core: { settings, storageAccess },
        _log: vi.fn(),
    }) as ModuleObsidianSettingsAsMarkdown;
    return { module, settings, files, storageAccess };
}

describe("ModuleObsidianSettingsAsMarkdown", () => {
    it.each([false, true])(
        "respects the sharing option for new and existing files (existing: %s)",
        async (existingFile) => {
            const { module, settings, files, storageAccess } = createHarness(false, existingFile);
            settings.P2P_managedType = CLOUDFLARE_TURN_TYPE;
            await module.saveSettingToMarkdown(settings.settingSyncFile);
            const content = files.get(settings.settingSyncFile)!;
            expect(storageAccess.writeFileAuto).toHaveBeenCalled();
            const written = parse(module.extractSettingFromWholeText(content).body);
            expect(written).not.toHaveProperty("couchDB_PASSWORD");
            expect(content).not.toContain(settings.encryptedCouchDBConnection);
            expect(Object.keys(written).filter((key) => ["accessKey", "secretKey"].includes(key))).toEqual([]);
            expect(content).not.toContain(settings.accessKey);
            expect(content).not.toContain(settings.secretKey);
            expect(module._log).toHaveBeenCalledWith(
                "When credential export is disabled, connection profiles are omitted. To share them, export the settings manually from the settings screen.",
                expect.any(Number)
            );
        }
    );

    it("exports complete connection settings when sharing is enabled", async () => {
        const { module, settings, files } = createHarness(true);
        settings.couchDB_USER = "synthetic-export-couch-user";
        settings.passphrase = "synthetic-export-passphrase";
        settings.idDerivationKey = "synthetic-export-id-key";
        settings.jwtKey = "synthetic-export-jwt-key";
        settings.jwtKid = "synthetic-export-jwt-kid";
        settings.jwtSub = "synthetic-export-jwt-subject";
        settings.couchDB_CustomHeaders = "X-Couch-Export: synthetic-couch-header";
        settings.bucketCustomHeaders = "X-Bucket-Export: synthetic-bucket-header";
        settings.P2P_passphrase = "synthetic-export-p2p-passphrase";
        settings.P2P_managedType = CLOUDFLARE_TURN_TYPE;
        settings.P2P_managedId = "synthetic-managed-turn-key-id";
        settings.P2P_managedToken = "synthetic-managed-turn-token";
        const activeUri = ConnectionStringParser.serialize({
            type: "s3",
            settings: { ...settings, endpoint: "https://active.synthetic.invalid" },
        });
        const inactiveUri = ConnectionStringParser.serialize({
            type: "s3",
            settings: {
                ...settings,
                endpoint: "https://inactive.synthetic.invalid",
                accessKey: "synthetic-inactive-access-key",
                secretKey: "synthetic-inactive-secret-key",
            },
        });
        const managedTurnUri = ConnectionStringParser.serialize({
            type: "p2p",
            settings: {
                ...settings,
                P2P_roomID: "synthetic-managed-turn-room",
                P2P_relays: "wss://relay.synthetic.invalid",
            },
        });
        settings.activeConfigurationId = "object-storage-active";
        settings.P2P_ActiveRemoteConfigurationId = "p2p-managed";
        settings.remoteConfigurations = {
            "object-storage-active": {
                id: "object-storage-active",
                name: "Synthetic active profile",
                uri: activeUri,
                isEncrypted: false,
            },
            "object-storage-inactive": {
                id: "object-storage-inactive",
                name: "Synthetic inactive profile",
                uri: inactiveUri,
                isEncrypted: false,
            },
            "p2p-managed": {
                id: "p2p-managed",
                name: "Synthetic managed P2P profile",
                uri: managedTurnUri,
                isEncrypted: false,
            },
        };
        const originalSettings = structuredClone(settings);
        await module.saveSettingToMarkdown(settings.settingSyncFile);
        const content = files.get(settings.settingSyncFile)!;
        const written = parse(module.extractSettingFromWholeText(content).body);
        expect(written.accessKey).toBe(settings.accessKey);
        expect(written.secretKey).toBe(settings.secretKey);
        expect(written.couchDB_USER).toBe(settings.couchDB_USER);
        expect(written.couchDB_PASSWORD).toBe(settings.couchDB_PASSWORD);
        expect(written.passphrase).toBe(settings.passphrase);
        expect(written.idDerivationKey).toBe(settings.idDerivationKey);
        expect(written.jwtKey).toBe(settings.jwtKey);
        expect(written.jwtKid).toBe(settings.jwtKid);
        expect(written.jwtSub).toBe(settings.jwtSub);
        expect(written.couchDB_CustomHeaders).toBe(settings.couchDB_CustomHeaders);
        expect(written.bucketCustomHeaders).toBe(settings.bucketCustomHeaders);
        expect(written.P2P_passphrase).toBe(settings.P2P_passphrase);
        expect(written.remoteConfigurations).toEqual(settings.remoteConfigurations);
        expect(written.activeConfigurationId).toBe(settings.activeConfigurationId);
        expect(written.P2P_ActiveRemoteConfigurationId).toBe(settings.P2P_ActiveRemoteConfigurationId);
        expect(written).not.toHaveProperty("P2P_managedType");
        expect(written).not.toHaveProperty("P2P_managedId");
        expect(written).not.toHaveProperty("P2P_managedToken");
        expect(content).toContain(
            "When credential export is disabled, connection profiles are omitted. To share them, export the settings manually from the settings screen."
        );
        expect(content).not.toContain(settings.encryptedCouchDBConnection);
        expect(settings).toEqual(originalSettings);
        expect(module._log).not.toHaveBeenCalledWith(
            expect.stringContaining("When credential export is disabled"),
            expect.any(Number)
        );
    });

    it("applies the sharing option to active and inactive profiles", async () => {
        const { module, settings, files } = createHarness(false);
        const activeUri = ConnectionStringParser.serialize({
            type: "s3",
            settings: { ...settings, endpoint: "https://active.synthetic.invalid" },
        });
        const inactiveUri = ConnectionStringParser.serialize({
            type: "s3",
            settings: {
                ...settings,
                endpoint: "https://inactive.synthetic.invalid",
                accessKey: "synthetic-inactive-access-key",
                secretKey: "synthetic-inactive-secret-key",
            },
        });
        const secrets = [
            settings.accessKey,
            settings.secretKey,
            "synthetic-inactive-access-key",
            "synthetic-inactive-secret-key",
        ];
        settings.accessKey = "";
        settings.secretKey = "";
        settings.activeConfigurationId = "active";
        settings.remoteConfigurations = {
            active: { id: "active", name: "Synthetic active profile", uri: activeUri, isEncrypted: false },
            inactive: { id: "inactive", name: "Synthetic inactive profile", uri: inactiveUri, isEncrypted: false },
        };
        settings.P2P_ActiveRemoteConfigurationId = "p2p-active";
        await module.saveSettingToMarkdown(settings.settingSyncFile);
        const content = files.get(settings.settingSyncFile)!;
        const written = parse(module.extractSettingFromWholeText(content).body);
        expect(written).not.toHaveProperty("remoteConfigurations");
        expect(written).not.toHaveProperty("activeConfigurationId");
        expect(written).not.toHaveProperty("P2P_ActiveRemoteConfigurationId");
        expect(secrets.filter((value) => content.includes(value))).toEqual([]);
    });

    it("retains local connections when importing ordinary settings", async () => {
        const filename = "LiveSync/synthetic-settings.md";
        const activeUri = ConnectionStringParser.serialize({
            type: "s3",
            settings: {
                ...DEFAULT_SETTINGS,
                endpoint: "https://active.synthetic.invalid",
                accessKey: "synthetic-profile-access-key",
                secretKey: "synthetic-profile-secret-key",
            },
        });
        const inactiveUri = ConnectionStringParser.serialize({
            type: "s3",
            settings: {
                ...DEFAULT_SETTINGS,
                endpoint: "https://inactive.synthetic.invalid",
                accessKey: "synthetic-inactive-access-key",
                secretKey: "synthetic-inactive-secret-key",
            },
        });
        const currentSettings: ObsidianLiveSyncSettings = {
            ...structuredClone(DEFAULT_SETTINGS),
            remoteType: REMOTE_MINIO,
            settingSyncFile: filename,
            writeCredentialsForSettingSync: false,
            accessKey: "synthetic-local-access-key",
            secretKey: "synthetic-local-secret-key",
            couchDB_USER: "synthetic-local-user",
            couchDB_PASSWORD: "synthetic-local-password",
            couchDB_CustomHeaders: "X-Couch-Local: synthetic-couch-header",
            bucketCustomHeaders: "X-Bucket-Local: synthetic-bucket-header",
            jwtKey: "synthetic-local-jwt-key",
            jwtKid: "synthetic-local-kid",
            jwtSub: "synthetic-local-subject",
            passphrase: "synthetic-local-passphrase",
            idDerivationVersion: 1,
            idDerivationKey: "ab".repeat(32),
            activeConfigurationId: "object-storage-active",
            P2P_ActiveRemoteConfigurationId: "p2p-active",
            P2P_AutoStart: false,
            remoteConfigurations: {
                "object-storage-active": {
                    id: "object-storage-active",
                    name: "Synthetic active profile",
                    uri: activeUri,
                    isEncrypted: false,
                },
                "object-storage-inactive": {
                    id: "object-storage-inactive",
                    name: "Synthetic inactive profile",
                    uri: inactiveUri,
                    isEncrypted: false,
                },
            },
        };
        const markdownSettings = {
            settingSyncFile: filename,
            writeCredentialsForSettingSync: false,
            P2P_AutoStart: true,
        };
        const document = "Synthetic note\n````yaml:livesync-setting\n" + stringify(markdownSettings) + "\n````\n";
        const files = new Map([[filename, document]]);
        const storageAccess = {
            isExists: vi.fn(async (path: string) => files.has(path)),
            readFileText: vi.fn(async (path: string) => files.get(path) ?? ""),
        };
        let openApplyDialogue: ((anchor: HTMLAnchorElement) => void) | undefined;
        let applySettings: (() => void) | undefined;
        const askSelectStringDialogue = vi.fn(async () => "Apply settings");
        const applyExternalSettings = vi.fn(async (_settings: ObsidianLiveSyncSettings) => undefined);
        const module = Object.assign(Object.create(ModuleObsidianSettingsAsMarkdown.prototype), {
            core: {
                settings: currentSettings,
                storageAccess,
                confirm: {
                    askInPopup: vi.fn((_key: string, _text: string, callback: (anchor: HTMLAnchorElement) => void) => {
                        openApplyDialogue = callback;
                    }),
                    askSelectStringDialogue,
                },
                rebuilder: { scheduleRebuild: vi.fn(), scheduleFetch: vi.fn() },
                _services: {
                    setting: {
                        applyExternalSettings,
                        clearUsedPassphrase: vi.fn(),
                    },
                    appLifecycle: { performRestart: vi.fn() },
                },
            },
            _log: vi.fn(),
        }) as ModuleObsidianSettingsAsMarkdown;

        await module.checkAndApplySettingFromMarkdown(filename, false);
        expect(openApplyDialogue).toBeDefined();
        openApplyDialogue?.({
            set text(_value: string) {},
            addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
                applySettings = listener as () => void;
            },
        } as HTMLAnchorElement);
        applySettings?.();
        await vi.waitFor(() => expect(applyExternalSettings).toHaveBeenCalledOnce());

        const appliedSettings = applyExternalSettings.mock.calls[0]![0];
        expect(appliedSettings.P2P_AutoStart).toBe(true);
        expect(appliedSettings.accessKey).toBe(currentSettings.accessKey);
        expect(appliedSettings.secretKey).toBe(currentSettings.secretKey);
        expect(appliedSettings.couchDB_USER).toBe(currentSettings.couchDB_USER);
        expect(appliedSettings.couchDB_PASSWORD).toBe(currentSettings.couchDB_PASSWORD);
        expect(appliedSettings.couchDB_CustomHeaders).toBe(currentSettings.couchDB_CustomHeaders);
        expect(appliedSettings.bucketCustomHeaders).toBe(currentSettings.bucketCustomHeaders);
        expect(appliedSettings.jwtKey).toBe(currentSettings.jwtKey);
        expect(appliedSettings.jwtKid).toBe(currentSettings.jwtKid);
        expect(appliedSettings.jwtSub).toBe(currentSettings.jwtSub);
        expect(appliedSettings.remoteConfigurations).toEqual(currentSettings.remoteConfigurations);
        expect(appliedSettings.activeConfigurationId).toBe(currentSettings.activeConfigurationId);
        expect(appliedSettings.P2P_ActiveRemoteConfigurationId).toBe(currentSettings.P2P_ActiveRemoteConfigurationId);
        expect(appliedSettings.idDerivationVersion).toBe(currentSettings.idDerivationVersion);
        expect(appliedSettings.idDerivationKey).toBe(currentSettings.idDerivationKey);
    });
});
