import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    hasManagedTurnSettings,
    omitManagedTurnProfilesFromMarkdown,
    preserveManagedTurnProfilesOnMarkdownImport,
    redactTurnSourceForReport,
} from "./turnSettingsPrivacy";

function configuredSettings() {
    return {
        ...DEFAULT_SETTINGS,
        P2P_iceServerSource: {
            version: 1,
            id: "cloudflare",
            configuration: { turnKeyId: "private-key-id", apiToken: "private-token" },
        },
        remoteConfigurations: {
            managed: {
                id: "managed",
                name: "Managed TURN",
                isEncrypted: false,
                uri: "sls+p2p-v2://room?source=private-token",
            },
        },
        activeConfigurationId: "central",
        P2P_ActiveRemoteConfigurationId: "managed",
    };
}

describe("managed TURN settings privacy", () => {
    it("redacts all opaque source fields, including unknown integrations", () => {
        const settings = configuredSettings();
        settings.P2P_iceServerSource.id = "private-token";
        redactTurnSourceForReport(settings);
        expect(JSON.stringify(settings.P2P_iceServerSource)).not.toMatch(/private-token|private-key-id/);
        expect(settings.P2P_iceServerSource.configuration).toEqual({ redacted: true });
    });

    it("omits the whole managed profile group from Markdown, including inactive sources", () => {
        const settings = configuredSettings();
        settings.P2P_iceServerSource.id = "manual";
        expect(hasManagedTurnSettings(settings)).toBe(true);
        omitManagedTurnProfilesFromMarkdown(settings);
        expect(JSON.stringify(settings)).not.toMatch(/private-token|private-key-id|sls\+p2p-v2/);
        expect(settings).not.toHaveProperty("remoteConfigurations");
        expect(settings).not.toHaveProperty("activeConfigurationId");
        expect(settings).not.toHaveProperty("P2P_ActiveRemoteConfigurationId");
    });

    it("preserves existing profiles and both selections when Markdown omits the group", () => {
        const current = configuredSettings();
        const incoming = { ...DEFAULT_SETTINGS };
        delete (incoming as Partial<typeof incoming>).remoteConfigurations;
        delete (incoming as Partial<typeof incoming>).P2P_iceServerSource;
        const merged = { ...DEFAULT_SETTINGS, ...incoming };
        preserveManagedTurnProfilesOnMarkdownImport(incoming, current, merged);
        expect(merged.remoteConfigurations).toEqual(current.remoteConfigurations);
        expect(merged.remoteConfigurations).not.toBe(current.remoteConfigurations);
        expect(merged.P2P_iceServerSource).toEqual(current.P2P_iceServerSource);
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
