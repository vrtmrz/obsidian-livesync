import { describe, expect, it, vi } from "vitest";

import { configureHiddenFileSyncMode } from "./configureHiddenFileSyncMode.ts";

describe("configureHiddenFileSyncMode", () => {
    it.each([
        ["FETCH", "pullForce"],
        ["OVERWRITE", "pushForce"],
        ["MERGE", "safe"],
    ] as const)("enables hidden file sync before initialising %s", async (mode, direction) => {
        const calls: string[] = [];

        const result = await configureHiddenFileSyncMode(mode, {
            disable: vi.fn(async () => {
                calls.push("disable");
            }),
            enable: vi.fn(async () => {
                calls.push("enable");
            }),
            initialise: vi.fn(async (actualDirection) => {
                calls.push(`init:${actualDirection}`);
            }),
        });

        expect(result).toBe("enabled");
        expect(calls).toEqual(["enable", `init:${direction}`]);
    });

    it.each(["DISABLE", "DISABLE_HIDDEN"] as const)("disables hidden file sync immediately for %s", async (mode) => {
        const calls: string[] = [];

        const result = await configureHiddenFileSyncMode(mode, {
            disable: vi.fn(async () => {
                calls.push("disable");
            }),
            enable: vi.fn(async () => {
                calls.push("enable");
            }),
            initialise: vi.fn(async (direction) => {
                calls.push(`init:${direction}`);
            }),
        });

        expect(result).toBe("disabled");
        expect(calls).toEqual(["disable"]);
    });
});
