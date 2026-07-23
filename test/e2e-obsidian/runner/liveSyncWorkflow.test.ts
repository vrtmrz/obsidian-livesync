import { VER } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { describe, expect, it, vi } from "vitest";

const { evalObsidianJson } = vi.hoisted(() => ({
    evalObsidianJson: vi.fn(),
}));

vi.mock("./cli.ts", () => ({ evalObsidianJson }));

import {
    assertE2eCompatibilityMarker,
    createE2eCouchDbPluginData,
    type CompatibilityMarkerState,
} from "./liveSyncWorkflow.ts";

describe("compatibility marker persistence", () => {
    it("waits for an accepted review to reach device-local storage", async () => {
        const pending: CompatibilityMarkerState = {
            vaultName: "fixture",
            additionalSuffix: "-",
            expectedStorageKey: "fixture--database-compatibility-version",
            rawStorageValue: null,
            serviceValue: "",
            versionUpFlash: "",
        };
        const persisted: CompatibilityMarkerState = {
            ...pending,
            rawStorageValue: `${VER}`,
            serviceValue: `${VER}`,
        };
        evalObsidianJson.mockResolvedValueOnce(pending).mockResolvedValueOnce(persisted);

        await expect(
            assertE2eCompatibilityMarker("obsidian-cli", {}, { timeoutMs: 100, intervalMs: 0 })
        ).resolves.toEqual(persisted);
        expect(evalObsidianJson).toHaveBeenCalledTimes(2);
    });
});

describe("configured CouchDB fixture", () => {
    it("uses a current remote profile for ordinary configured fixtures", () => {
        const pluginData = createE2eCouchDbPluginData({
            uri: "https://couch.example",
            username: "alice",
            password: "secret",
            dbName: "notes",
        });
        const remoteConfigurations = pluginData.remoteConfigurations as
            | Record<string, { id: string; uri: string }>
            | undefined;

        expect(remoteConfigurations).toBeDefined();
        expect(Object.keys(remoteConfigurations ?? {})).toHaveLength(1);
        expect(pluginData.activeConfigurationId).toBe(Object.keys(remoteConfigurations ?? {})[0]);
    });
});
