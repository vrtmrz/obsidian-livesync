import { describe, expect, it, vi } from "vitest";

vi.mock("@/common/translation", () => ({
    $msg: (key: string) => key,
    translateLiveSyncMessage: (key: string) => key,
}));
vi.mock("./PaneChangeLog.ts", () => ({ paneChangeLog: vi.fn() }));
vi.mock("./PaneQuickSetup.ts", () => ({ paneQuickSetup: vi.fn() }));
vi.mock("./PaneHelp.ts", () => ({ paneHelp: vi.fn() }));
vi.mock("./PaneGeneral.ts", () => ({ paneGeneral: vi.fn() }));
vi.mock("./PaneRemoteConfig.ts", () => ({ paneRemoteConfig: vi.fn() }));
vi.mock("./PaneSelector.ts", () => ({ paneSelector: vi.fn() }));
vi.mock("./PaneSyncSettings.ts", () => ({ paneSyncSettings: vi.fn() }));
vi.mock("./PaneCustomisationSync.ts", () => ({ paneCustomisationSync: vi.fn() }));
vi.mock("./PaneHatch.ts", () => ({ paneHatch: vi.fn() }));
vi.mock("./PaneAdvanced.ts", () => ({ paneAdvanced: vi.fn() }));
vi.mock("./PanePowerUsers.ts", () => ({ panePowerUsers: vi.fn() }));
vi.mock("./PanePatches.ts", () => ({ panePatches: vi.fn() }));
vi.mock("./PaneMaintenance.ts", () => ({ paneMaintenance: vi.fn() }));

import { createAdvancedSettingDefinitionGroups, createSettingsPageCatalogue } from "./SettingsPageCatalogue.ts";

describe("settings page catalogue", () => {
    it("registers every existing page once and keeps only Advanced native", () => {
        const catalogue = createSettingsPageCatalogue();

        expect(catalogue.map(({ id }) => id)).toEqual([
            "change-log",
            "quick-setup",
            "general",
            "remote-configuration",
            "synchronisation",
            "selector",
            "customisation-sync",
            "hatch",
            "advanced",
            "power-users",
            "patches",
            "maintenance",
            "help",
        ]);
        expect(new Set(catalogue.map(({ id }) => id)).size).toBe(catalogue.length);
        expect(new Set(catalogue.map(({ name }) => name())).size).toBe(catalogue.length);
        expect(catalogue.filter(({ content }) => content === "native").map(({ id }) => id)).toEqual(["advanced"]);
        expect(catalogue.filter(({ content }) => content === "custom")).toHaveLength(12);
        expect(catalogue.find(({ id }) => id === "quick-setup")?.name()).toBe(
            "obsidianLiveSyncSettingTab.titleQuickSetup"
        );
        expect(catalogue.find(({ id }) => id === "help")?.name()).toBe(
            "obsidianLiveSyncSettingTab.titleHelpAndTroubleshooting"
        );
    });

    it("registers each Advanced control key exactly once", () => {
        const groups = createAdvancedSettingDefinitionGroups({ isCouchDB: () => true });
        const keys = groups.flatMap(({ items = [] }) =>
            items.flatMap((item) => ("control" in item && item.control ? [item.control.key] : []))
        );

        expect(keys).toEqual([
            "hashCacheMaxCount",
            "chunkSplitterVersion",
            "customChunkSize",
            "readChunksOnline",
            "useOnlyLocalChunk",
            "concurrencyOfReadChunksOnline",
            "minimumIntervalOfReadChunksOnline",
            "autoAcceptCompatibleTweak",
            "enableCompression",
        ]);
        expect(new Set(keys).size).toBe(keys.length);
    });
});
