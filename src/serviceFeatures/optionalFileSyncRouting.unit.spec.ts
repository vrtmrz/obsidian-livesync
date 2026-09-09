import { describe, expect, it } from "vitest";
import {
    MODE_AUTOMATIC,
    MODE_PAUSED,
    MODE_SELECTIVE,
    MODE_SHINY,
    type PluginSyncSettingEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

import { isCustomisationSyncDocumentLocallyOwned, routeOptionalFileSyncPath } from "./optionalFileSyncRouting.ts";

const PATH = ".obsidian/plugins/example/data.json";

function route(
    mode: PluginSyncSettingEntry["mode"] | undefined,
    overrides: Partial<Parameters<typeof routeOptionalFileSyncPath>[0]> = {}
) {
    const pluginSyncExtendedSetting: Record<string, PluginSyncSettingEntry> =
        mode === undefined
            ? {}
            : {
                  "PLUGIN_DATA/example": {
                      key: "PLUGIN_DATA/example",
                      mode,
                      files: [],
                  },
              };
    return routeOptionalFileSyncPath({
        path: PATH,
        configDir: ".obsidian",
        useV2: true,
        usePluginEtc: true,
        customisationEnabled: true,
        customisationReady: true,
        hiddenFileEnabled: true,
        hiddenFileReady: true,
        hiddenFileEligible: true,
        pluginSyncExtendedSetting,
        ...overrides,
    });
}

describe("optional-file local-path routing policy", () => {
    it.each([
        ["default Selective", undefined, "customisation", "customisation-selective"],
        ["persisted Selective", MODE_SELECTIVE, "customisation", "customisation-selective"],
        ["Flagged Selective", MODE_SHINY, "customisation", "customisation-flagged-selective"],
        ["Automatic", MODE_AUTOMATIC, "hidden-file", "hidden-file-automatic"],
        ["Ignore", MODE_PAUSED, "none", "customisation-paused"],
    ] as const)("assigns %s to one owner", (_label, mode, owner, reason) => {
        expect(route(mode)).toMatchObject({
            owner,
            reason,
            category: "PLUGIN_DATA",
            settingKey: "PLUGIN_DATA/example",
        });
    });

    it("uses the persisted setting key even when its file list is empty", () => {
        expect(route(MODE_AUTOMATIC)).toMatchObject({
            owner: "hidden-file",
            settingKey: "PLUGIN_DATA/example",
            mode: MODE_AUTOMATIC,
        });
    });

    it("does not apply Hidden File Sync filters to a Customisation Sync owner", () => {
        expect(route(MODE_SELECTIVE, { hiddenFileEligible: false })).toMatchObject({
            owner: "customisation",
            reason: "customisation-selective",
        });
    });

    it("applies readiness and Hidden File Sync eligibility after selecting the owner", () => {
        expect(route(MODE_SELECTIVE, { customisationReady: false })).toMatchObject({
            owner: "none",
            reason: "customisation-not-ready",
        });
        expect(route(MODE_AUTOMATIC, { hiddenFileReady: false })).toMatchObject({
            owner: "none",
            reason: "hidden-file-not-ready",
        });
        expect(route(MODE_AUTOMATIC, { hiddenFileEligible: false })).toMatchObject({
            owner: "none",
            reason: "hidden-file-filtered",
        });
    });

    it("does not fall back to Customisation Sync when Automatic mode has no Hidden File Sync owner", () => {
        expect(route(MODE_AUTOMATIC, { hiddenFileEnabled: false })).toMatchObject({
            owner: "none",
            reason: "hidden-file-disabled",
        });
    });

    it("routes recognised files to Hidden File Sync when Customisation Sync is disabled", () => {
        expect(route(undefined, { customisationEnabled: false })).toMatchObject({
            owner: "hidden-file",
            reason: "hidden-file-path",
        });
    });

    it("routes other eligible hidden paths only to Hidden File Sync", () => {
        expect(route(undefined, { path: ".obsidian/workspace" })).toMatchObject({
            owner: "hidden-file",
            reason: "hidden-file-path",
            category: "",
        });
        expect(route(undefined, { path: ".trash/workspace.json" })).toMatchObject({
            owner: "none",
            reason: "unsupported-path",
        });
        expect(route(undefined, { path: "notes/workspace.json" })).toMatchObject({
            owner: "none",
            reason: "unsupported-path",
        });
    });

    it("returns no owner when both optional-file features are disabled", () => {
        expect(
            route(undefined, {
                customisationEnabled: false,
                hiddenFileEnabled: false,
            })
        ).toMatchObject({ owner: "none", reason: "features-disabled" });
    });
});

describe("Customisation Sync scan-document ownership", () => {
    it.each([
        ["default Selective", undefined, true],
        ["persisted Selective", MODE_SELECTIVE, true],
        ["Flagged Selective", MODE_SHINY, true],
        ["Automatic", MODE_AUTOMATIC, false],
        ["Ignore", MODE_PAUSED, false],
    ] as const)("allows mutation for %s=%s", (_label, mode, expected) => {
        const pluginSyncExtendedSetting: Record<string, PluginSyncSettingEntry> =
            mode === undefined
                ? {}
                : {
                      "PLUGIN_DATA/example": {
                          key: "PLUGIN_DATA/example",
                          mode,
                          files: [],
                      },
                  };
        expect(
            isCustomisationSyncDocumentLocallyOwned({
                documentPath: "ix:device-a/PLUGIN_DATA/example.md" as never,
                customisationEnabled: true,
                pluginSyncExtendedSetting,
            })
        ).toBe(expected);
    });

    it("disallows scan mutation while Customisation Sync is disabled", () => {
        expect(
            isCustomisationSyncDocumentLocallyOwned({
                documentPath: "ix:device-a/PLUGIN_DATA/example.md" as never,
                customisationEnabled: false,
                pluginSyncExtendedSetting: {},
            })
        ).toBe(false);
    });
});
