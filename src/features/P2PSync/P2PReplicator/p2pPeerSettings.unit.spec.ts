import { describe, expect, it } from "vitest";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.type";
import {
    hasExactP2PPeer,
    toggleExactP2PPeer,
    togglePersistedP2PPeer,
} from "./p2pPeerSettings";

describe("persisted P2P peer controls", () => {
    it("adds and removes only the selected peer without disturbing advanced patterns", () => {
        const original = "~^phone-,desktop";

        const added = toggleExactP2PPeer(original, "phone-main");
        expect(added).toBe("~^phone-,desktop,phone-main");
        expect(hasExactP2PPeer(added, "phone-main")).toBe(true);

        const removed = toggleExactP2PPeer(added, "phone-main");
        expect(removed).toBe(original);
    });

    it.each([
        "P2P_AutoSyncPeers",
        "P2P_AutoWatchPeers",
        "P2P_SyncOnReplication",
    ] as const)("updates %s through the same profile-backed setting boundary", (setting) => {
        const settings = {
            P2P_AutoSyncPeers: "",
            P2P_AutoWatchPeers: "",
            P2P_SyncOnReplication: "",
        } as ObsidianLiveSyncSettings;

        expect(togglePersistedP2PPeer(settings, setting, "peer-a")).toEqual({
            [setting]: "peer-a",
        });
    });
});
