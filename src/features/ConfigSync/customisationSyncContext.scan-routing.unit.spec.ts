import { describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: vi.fn((path: string) => path),
    parseYaml: vi.fn(),
    Platform: {},
}));
vi.mock("@/common/types.ts", () => ({
    ICXHeader: "ix:",
    PERIODIC_PLUGIN_SWEEP: 60,
}));
vi.mock("@/common/utils.ts", () => ({
    cancelTask: vi.fn(),
    EVEN: Symbol("even"),
    isCustomisationSyncMetadata: vi.fn(),
    isPluginMetadata: vi.fn(),
    scheduleTask: vi.fn(),
}));
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));

import { CustomisationSyncContext } from "./customisationSyncContext.ts";

describe("Customisation Sync scan delegation", () => {
    it("preserves the public scan argument and result through the focused owner", async () => {
        const scanAllConfigFiles = vi.fn(async (_showMessage: boolean) => undefined);
        const context = Object.create(CustomisationSyncContext.prototype) as CustomisationSyncContext;
        Object.assign(context, { scanOperations: { scanAllConfigFiles } });

        await expect(context.scanAllConfigFiles(true)).resolves.toBeUndefined();

        expect(scanAllConfigFiles).toHaveBeenCalledOnce();
        expect(scanAllConfigFiles).toHaveBeenCalledWith(true);
    });
});
