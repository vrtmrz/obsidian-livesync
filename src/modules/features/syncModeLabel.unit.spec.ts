import { beforeEach, describe, expect, it } from "vitest";
import {
    DEFAULT_SETTINGS,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    REMOTE_P2P,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { setLang } from "@/common/translation";
import { projectSyncModeLabel } from "./syncModeLabel.ts";

function settings(overrides: Partial<ObsidianLiveSyncSettings> = {}): ObsidianLiveSyncSettings {
    return {
        ...DEFAULT_SETTINGS,
        isConfigured: true,
        remoteType: REMOTE_COUCHDB,
        liveSync: false,
        periodicReplication: false,
        syncOnSave: false,
        syncOnEditorSave: false,
        syncOnStart: false,
        syncOnFileOpen: false,
        syncAfterMerge: false,
        ...overrides,
    };
}

describe("configured synchronisation mode", () => {
    beforeEach(() => setLang("def"));

    it("identifies manual-only operation when all automatic triggers are disabled", () => {
        expect(projectSyncModeLabel(settings())).toEqual({
            key: "sync-mode",
            text: "🛎",
            title: "Manual synchronisation only. Automatic synchronisation is disabled.",
        });
    });

    it("shows the configured LiveSync mode even when file reflection is suspended", () => {
        expect(projectSyncModeLabel(settings({ liveSync: true, suspendFileWatching: true }))).toMatchObject({
            text: "🔗",
            title: "Configured automatic synchronisation: LiveSync.",
        });
    });

    it("distinguishes periodic-only settings from periodic and event settings", () => {
        expect(projectSyncModeLabel(settings({ periodicReplication: true }))).toMatchObject({
            text: "⏰",
            title: "Configured automatic synchronisation: Periodic.",
        });
        expect(projectSyncModeLabel(settings({ periodicReplication: true, syncOnFileOpen: true }))).toMatchObject({
            text: "⏰ ✨",
            title: "Configured automatic synchronisation: Periodic, On events.",
        });
    });

    it.each(["syncOnSave", "syncOnEditorSave", "syncOnStart", "syncOnFileOpen", "syncAfterMerge"] as const)(
        "counts %s as automatic event synchronisation",
        (key) => {
            expect(projectSyncModeLabel(settings({ [key]: true }))).toMatchObject({
                text: "✨",
                title: "Configured automatic synchronisation: On events.",
            });
        }
    );

    it("groups configured triggers without changing the settings", () => {
        const configured = Object.freeze(settings({ liveSync: true, periodicReplication: true, syncOnSave: true }));
        expect(projectSyncModeLabel(configured)?.text).toBe("🔗 ⏰ ✨");
        expect(configured).toMatchObject({ liveSync: true, periodicReplication: true, syncOnSave: true });
    });

    it("supports Object Storage without treating P2P-specific scheduling as manual-only", () => {
        expect(projectSyncModeLabel(settings({ remoteType: REMOTE_MINIO, periodicReplication: true }))?.text).toBe(
            "⏰"
        );
        expect(projectSyncModeLabel(settings({ remoteType: REMOTE_P2P, P2P_Enabled: true }))).toBeUndefined();
        expect(projectSyncModeLabel(settings({ isConfigured: false }))).toBeUndefined();
    });
});
