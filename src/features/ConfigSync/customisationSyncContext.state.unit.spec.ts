import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: vi.fn((path: string) => path),
    parseYaml: vi.fn(),
    Platform: {},
}));
vi.mock("@/common/PeriodicProcessor.ts", () => ({
    PeriodicProcessor: class PeriodicProcessor {
        disable = vi.fn();
        enable = vi.fn();
    },
}));
vi.mock("octagonal-wheels/concurrency/processor", () => ({
    QueueProcessor: class QueueProcessor {
        clearQueue = vi.fn();
        enqueue = vi.fn();
        terminate = vi.fn();
        startPipeline() {
            return this;
        }
    },
}));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(),
}));
import { CustomisationSyncContext } from "./customisationSyncContext.ts";
import { createCustomisationSyncTestDependencies } from "./customisationSyncContext.unit.fixture.ts";

describe("CustomisationSyncContext state ownership", () => {
    it("does not share catalogue or presentation state between context instances", () => {
        const first = new CustomisationSyncContext(createCustomisationSyncTestDependencies());
        const second = new CustomisationSyncContext(createCustomisationSyncTestDependencies());

        expect(first.catalogue).not.toBe(second.catalogue);
        expect(first.enumerationActive).not.toBe(second.enumerationActive);
        expect(first.migrationProgress).not.toBe(second.migrationProgress);
        expect(first.manifests).not.toBe(second.manifests);
        expect(get(first.manifests)).not.toBe(get(second.manifests));
    });
});
