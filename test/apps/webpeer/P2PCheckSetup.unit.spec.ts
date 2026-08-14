import { decodeSettingsFromSetupURI } from "@vrtmrz/livesync-commonlib/compat/API/processSetting.js";
import { DEFAULT_SETTINGS, REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/types.js";
import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString.js";
import { describe, expect, it } from "vitest";

import {
    P2P_CHECK_APP_ID,
    generateP2PCheckSetup,
    resolveLocalP2PCheckRelayOverride,
} from "@/apps/webpeer/src/P2PCheckSetup";

describe("P2P connection-check setup", () => {
    it.each(["desktop", "mobile"] as const)(
        "creates an isolated, disposable %s Setup URI and diagnostic browser peer",
        async (target) => {
            const generated = await generateP2PCheckSetup(target);
            const decoded = await decodeSettingsFromSetupURI(generated.setupURI, generated.setupPassphrase);

            expect(decoded).not.toBe(false);
            if (decoded === false) {
                throw new Error("The generated Setup URI could not be decoded");
            }
            const effective = { ...DEFAULT_SETTINGS, ...decoded };

            expect(generated.target).toBe(target);
            expect(generated.setupPassphrase).toMatch(/^[a-z2-9]{4}(?:-[a-z2-9]{4}){3}$/);
            expect(generated.setupURI).toMatch(/^obsidian:\/\/setuplivesync\?settings=/);
            expect(effective).toEqual(
                expect.objectContaining({
                    remoteType: REMOTE_P2P,
                    isConfigured: true,
                    encrypt: true,
                    usePathObfuscation: true,
                    P2P_Enabled: true,
                    P2P_AppID: P2P_CHECK_APP_ID,
                    P2P_roomID: generated.groupId,
                    P2P_AutoStart: true,
                    P2P_AutoBroadcast: false,
                })
            );
            expect(decoded.P2P_DevicePeerName).toBeUndefined();
            expect(decoded.P2P_useDiagRTC).toBeUndefined();
            expect(effective.passphrase).toHaveLength(32);
            expect(effective.P2P_passphrase).toHaveLength(32);
            expect(effective.passphrase).not.toBe(effective.P2P_passphrase);
            expect(effective.P2P_AutoAccepting).toBe(DEFAULT_SETTINGS.P2P_AutoAccepting);
            expect(effective.P2P_AutoSyncPeers).toBe("");
            expect(effective.P2P_AutoWatchPeers).toBe("");
            expect(effective.P2P_SyncOnReplication).toBe("");

            const remoteConfigurations = Object.values(decoded.remoteConfigurations ?? {});
            expect(remoteConfigurations).toHaveLength(1);
            expect(decoded.activeConfigurationId).toBe(remoteConfigurations[0].id);
            expect(decoded.P2P_ActiveRemoteConfigurationId).toBe(remoteConfigurations[0].id);
            const deviceRemote = ConnectionStringParser.parse(remoteConfigurations[0].uri);
            expect(deviceRemote).toEqual(
                expect.objectContaining({
                    type: "p2p",
                    settings: expect.objectContaining({
                        P2P_AutoStart: true,
                        P2P_AutoBroadcast: false,
                    }),
                })
            );
            expect("P2P_useDiagRTC" in deviceRemote.settings).toBe(false);

            expect(generated.browserSettings).toEqual(
                expect.objectContaining({
                    remoteType: REMOTE_P2P,
                    P2P_Enabled: true,
                    P2P_AppID: P2P_CHECK_APP_ID,
                    P2P_roomID: effective.P2P_roomID,
                    P2P_passphrase: effective.P2P_passphrase,
                    passphrase: effective.passphrase,
                    P2P_AutoStart: false,
                    P2P_AutoBroadcast: false,
                    P2P_useDiagRTC: true,
                })
            );
            expect(generated.browserDeviceName).toMatch(/^p2p-check-browser-(?:desktop|mobile)-/);
            const browserConfigurations = Object.values(generated.browserSettings.remoteConfigurations ?? {});
            expect(browserConfigurations).toHaveLength(1);
            const browserRemote = ConnectionStringParser.parse(browserConfigurations[0].uri);
            expect(browserRemote).toEqual(
                expect.objectContaining({
                    type: "p2p",
                    settings: expect.objectContaining({
                        P2P_AutoStart: false,
                        P2P_AutoBroadcast: false,
                    }),
                })
            );
            expect("P2P_useDiagRTC" in browserRemote.settings).toBe(false);
        }
    );

    it("creates independent rooms and secrets for separate checks", async () => {
        const first = await generateP2PCheckSetup("desktop");
        const second = await generateP2PCheckSetup("desktop");

        expect(second.groupId).not.toBe(first.groupId);
        expect(second.setupPassphrase).not.toBe(first.setupPassphrase);
        expect(second.browserSettings.P2P_passphrase).not.toBe(first.browserSettings.P2P_passphrase);
        expect(second.browserSettings.passphrase).not.toBe(first.browserSettings.passphrase);
    });

    it("uses the same explicitly selected relay for the Setup URI and browser peer", async () => {
        const relay = "ws://127.0.0.1:4010/";
        const generated = await generateP2PCheckSetup("desktop", { relay });
        const decoded = await decodeSettingsFromSetupURI(generated.setupURI, generated.setupPassphrase);

        expect(decoded).not.toBe(false);
        if (decoded === false) {
            throw new Error("The generated Setup URI could not be decoded");
        }
        expect(generated.relay).toBe(relay);
        expect(decoded.P2P_relays).toBe(relay);
        expect(generated.browserSettings.P2P_relays).toBe(relay);
    });

    it("accepts a relay query override only from a loopback-served check page", () => {
        const search = "?relay=ws%3A%2F%2F127.0.0.1%3A4010%2F";

        expect(resolveLocalP2PCheckRelayOverride({ hostname: "127.0.0.1", search })).toBe("ws://127.0.0.1:4010/");
        expect(resolveLocalP2PCheckRelayOverride({ hostname: "localhost", search })).toBe("ws://127.0.0.1:4010/");
        expect(resolveLocalP2PCheckRelayOverride({ hostname: "example.com", search })).toBeUndefined();
        expect(
            resolveLocalP2PCheckRelayOverride({ hostname: "127.0.0.1", search: "?relay=https%3A%2F%2Fexample.com" })
        ).toBeUndefined();
    });
});
