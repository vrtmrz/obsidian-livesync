import { describe, expect, it } from "vitest";
import {
    DEFAULT_SETTINGS,
    REMOTE_P2P,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    SettingService,
    type SettingServiceDependencies,
} from "@vrtmrz/livesync-commonlib/compat/services/base/SettingService";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/compat/services/base/ServiceBase";
import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import {
    hasManagedTurnSettings,
    omitManagedTurnProfilesFromMarkdown,
    preserveManagedTurnProfilesOnMarkdownImport,
    redactTurnSettingsForReport,
} from "./turnSettingsPrivacy";

class MemorySettingService extends SettingService {
    readonly items = new Map<string, string>();
    saved?: ObsidianLiveSyncSettings;
    protected setItem(key: string, value: string) {
        this.items.set(key, value);
    }
    protected getItem(key: string) {
        return this.items.get(key) ?? "";
    }
    protected deleteItem(key: string) {
        this.items.delete(key);
    }
    protected saveData(settings: ObsidianLiveSyncSettings) {
        this.saved = structuredClone(settings);
        return Promise.resolve();
    }
    protected loadData() {
        return Promise.resolve(this.saved);
    }
}

function configuredSettings() {
    return {
        ...DEFAULT_SETTINGS,
        P2P_managedType: "CF",
        P2P_managedId: "private-key-id",
        P2P_managedToken: "private-token",
        remoteConfigurations: {
            managed: {
                id: "managed",
                name: "Managed TURN",
                isEncrypted: false,
                uri: "sls+p2p://room?managedType=CF&managedId=private-key-id&token=private-token",
            },
        },
        activeConfigurationId: "central",
        P2P_ActiveRemoteConfigurationId: "managed",
    };
}

describe("managed TURN settings privacy", () => {
    it("preserves the active managed room through Markdown import, save, and reload", async () => {
        const current = {
            ...configuredSettings(),
            remoteType: REMOTE_P2P,
            activeConfigurationId: "managed",
            P2P_roomID: "local-room",
            P2P_relays: "wss://local-relay.example.test",
            P2P_passphrase: "local-passphrase",
        };
        const originalURI = ConnectionStringParser.serialize({ type: "p2p", settings: current });
        current.remoteConfigurations.managed.uri = originalURI;
        const service = new MemorySettingService(new ServiceContext(), {
            APIService: {
                getSystemVaultName: () => "test-vault",
                getAppID: () => "test-app",
                addLog: () => undefined,
                confirm: { askString: async () => "" },
            } as unknown as SettingServiceDependencies["APIService"],
        });
        service.settings = structuredClone(current);
        const incoming: Partial<ObsidianLiveSyncSettings> = {
            P2P_roomID: "imported-room",
            P2P_relays: "wss://imported-relay.example.test",
            P2P_passphrase: "imported-passphrase",
        };
        const merged = { ...structuredClone(DEFAULT_SETTINGS), ...incoming };
        preserveManagedTurnProfilesOnMarkdownImport(incoming, current, merged);
        await service.applyExternalSettings(merged, true);
        const saved = service.saved!.remoteConfigurations.managed;
        const uri = saved.isEncrypted ? await service.decryptConfigurationItem(saved.uri, "*") : saved.uri;
        expect(uri).toBe(originalURI);
        expect(service.settings.P2P_roomID).toBe("local-room");
        await service.loadSettings();
        expect(service.settings.P2P_roomID).toBe("local-room");
    });

    it("redacts provider fields and issued credentials, including unknown integrations", () => {
        const settings = configuredSettings();
        settings.P2P_managedType = "private-token";
        redactTurnSettingsForReport(settings);
        expect([settings.P2P_managedType, settings.P2P_managedId, settings.P2P_managedToken]).toEqual([
            "redacted",
            "redacted",
            "redacted",
        ]);
    });

    it("omits the whole managed profile group from Markdown, including inactive sources", () => {
        const settings = configuredSettings();
        settings.P2P_managedType = "";
        expect(hasManagedTurnSettings(settings)).toBe(true);
        omitManagedTurnProfilesFromMarkdown(settings);
        expect(JSON.stringify(settings)).not.toMatch(/private-token|private-key-id|sls\+p2p/);
        expect(settings).not.toHaveProperty("remoteConfigurations");
        expect(settings).not.toHaveProperty("activeConfigurationId");
        expect(settings).not.toHaveProperty("P2P_ActiveRemoteConfigurationId");
    });

    it("preserves existing profiles and both selections when Markdown omits the group", () => {
        const current = configuredSettings();
        const incoming = { ...DEFAULT_SETTINGS };
        delete (incoming as Partial<typeof incoming>).remoteConfigurations;
        delete (incoming as Partial<typeof incoming>).P2P_managedType;
        const merged = { ...DEFAULT_SETTINGS, ...incoming };
        preserveManagedTurnProfilesOnMarkdownImport(incoming, current, merged);
        expect(merged.remoteConfigurations).toEqual(current.remoteConfigurations);
        expect(merged.remoteConfigurations).not.toBe(current.remoteConfigurations);
        expect(merged.P2P_managedToken).toEqual(current.P2P_managedToken);
        expect(merged.activeConfigurationId).toBe("central");
        expect(merged.P2P_ActiveRemoteConfigurationId).toBe("managed");
    });

    it("retains the manual-only Markdown contract", () => {
        const settings = { ...DEFAULT_SETTINGS };
        const before = structuredClone(settings);
        omitManagedTurnProfilesFromMarkdown(settings);
        expect(settings).toEqual(before);
    });
});
