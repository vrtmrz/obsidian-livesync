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

describe("CustomisationSyncContext composition", () => {
    it("does not share catalogue or presentation state between context instances", () => {
        const first = new CustomisationSyncContext(createCustomisationSyncTestDependencies());
        const second = new CustomisationSyncContext(createCustomisationSyncTestDependencies());

        expect(first.catalogue).not.toBe(second.catalogue);
        expect(first.enumerationActive).not.toBe(second.enumerationActive);
        expect(first.migrationProgress).not.toBe(second.migrationProgress);
        expect(first.manifests).not.toBe(second.manifests);
        expect(get(first.manifests)).not.toBe(get(second.manifests));
    });

    it("exposes frozen semantic service and testing views without writable state", () => {
        const context = new CustomisationSyncContext(createCustomisationSyncTestDependencies());

        expect(Object.isFrozen(context.serviceHandlers)).toBe(true);
        expect(Object.keys(context.serviceHandlers).sort()).toEqual(
            [
                "enableOptionalFeature",
                "onBeforeReplicate",
                "onDatabaseInitialised",
                "onRealiseSetting",
                "onResuming",
                "processOptionalFileEvent",
                "processVirtualDocument",
                "suspendExtraSync",
            ].sort()
        );

        expect(Object.isFrozen(context.testing)).toBe(true);
        expect(Object.keys(context.testing).sort()).toEqual(
            [
                "applyDataV2",
                "configDir",
                "createPluginDataExFileV2",
                "createPluginDataFromV2",
                "deleteConfigOnDatabase",
                "scanAllConfigFiles",
                "scanInternalFiles",
                "storeCustomizationFiles",
            ].sort()
        );
        expect("catalogue" in context.testing).toBe(false);
        expect("enumerationActive" in context.testing).toBe(false);
        expect("manifests" in context.testing).toBe(false);

        context.dispose();
    });
});
