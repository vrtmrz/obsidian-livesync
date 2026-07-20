import { VER } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { describe, expect, it, vi } from "vitest";

const { evalObsidianJson } = vi.hoisted(() => ({
    evalObsidianJson: vi.fn(),
}));

vi.mock("./cli.ts", () => ({ evalObsidianJson }));

import { assertE2eCompatibilityMarker, type CompatibilityMarkerState } from "./liveSyncWorkflow.ts";

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
