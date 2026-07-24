import { describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    addIcon: vi.fn(),
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: vi.fn((path: string) => path),
    Notice: class Notice {},
    parseYaml: vi.fn(),
    Platform: {},
}));
vi.mock("./PluginDialogModal.ts", () => ({
    PluginDialogModal: class PluginDialogModal {},
}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {},
}));
vi.mock("@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts", () => ({
    ConflictResolveModal: class ConflictResolveModal {},
}));
vi.mock("@/features/LiveSyncCommands.ts", () => ({
    LiveSyncCommands: class LiveSyncCommands {
        core!: { services: unknown };
        get services() {
            return this.core.services;
        }
    },
}));
vi.mock("@/common/types.ts", () => ({
    ICXHeader: "ix:",
    PERIODIC_PLUGIN_SWEEP: 60,
}));
vi.mock("@/common/utils.ts", () => ({
    EVEN: Symbol("even"),
    disposeMemoObject: vi.fn(),
    isCustomisationSyncMetadata: vi.fn(),
    isPluginMetadata: vi.fn(),
    memoIfNotExist: vi.fn(),
    memoObject: vi.fn(),
    retrieveMemoObject: vi.fn(),
    scheduleTask: vi.fn(),
}));
vi.mock("@/common/PeriodicProcessor.ts", () => ({
    PeriodicProcessor: class PeriodicProcessor {},
}));
vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG: "open-plugin-sync",
    eventHub: {
        onEvent: vi.fn(),
    },
}));
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(),
}));

import { ConfigSync } from "./CmdConfigSync";

describe("ConfigSync commands", () => {
    it("shows the Customisation Sync command only whilst the feature is enabled", () => {
        const commands: Array<{
            id: string;
            checkCallback?: (checking: boolean) => boolean | void;
        }> = [];
        const settings = {
            usePluginSync: false,
        };
        const showPluginSyncModal = vi.fn();
        const configSync = Object.create(ConfigSync.prototype) as ConfigSync;
        Object.assign(configSync, {
            core: {
                settings,
                services: {
                    API: {
                        addCommand: vi.fn((command) => commands.push(command)),
                    },
                },
            },
            addRibbonIcon: vi.fn(() => ({
                addClass: vi.fn(),
            })),
            showPluginSyncModal,
        });

        configSync.onload();

        const command = commands.find(({ id }) => id === "livesync-plugin-dialog-ex");
        expect(command?.checkCallback?.(true)).toBe(false);

        settings.usePluginSync = true;
        expect(command?.checkCallback?.(true)).toBe(true);
        expect(command?.checkCallback?.(false)).toBe(true);
        expect(showPluginSyncModal).toHaveBeenCalledOnce();
    });
});
