import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("Optional File Sync ownership boundary", () => {
    it("keeps the concrete runtimes behind the composition feature", () => {
        const mainSource = read("../main.ts");
        const featureSource = read("./useOptionalFileSync.ts");
        const customisationAdapterSource = read("./customisationSyncObsidianAdapter.ts");
        const hiddenFileAdapterSource = read("./hiddenFileSyncObsidianAdapter.ts");
        const customisationSource = read("../features/ConfigSync/customisationSyncContext.ts");
        const hiddenSource = read("../features/HiddenFileSync/hiddenFileSyncContext.ts");

        expect(mainSource).not.toContain("new CustomisationSyncContext");
        expect(mainSource).not.toContain("new HiddenFileSyncContext");
        expect(mainSource).not.toContain("optionalFileSync.testing");
        expect(featureSource).toContain("new CustomisationSyncContext");
        expect(featureSource).toContain("new HiddenFileSyncContext");
        expect(featureSource).toContain("customisationSync.serviceHandlers");
        expect(featureSource).toContain("hiddenFileSync.serviceHandlers");
        expect(featureSource).toContain("customisationSync.testing");
        expect(featureSource).toContain("hiddenFileSync.testing");
        expect(customisationSource).not.toContain("onBindFunction(");
        expect(hiddenSource).not.toContain("onBindFunction(");
        expect(customisationSource).not.toMatch(/\b_(?:any|every|all)[A-Z]/);
        expect(hiddenSource).not.toMatch(/\b_(?:any|every|all)[A-Z]/);
        expect(customisationSource).not.toContain("LiveSyncCommands");
        expect(hiddenSource).not.toContain("LiveSyncCommands");
        expect(customisationSource).not.toContain("extends LiveSyncContext");
        expect(customisationSource).not.toMatch(/from ["'][^"']*LiveSyncContext(?:\.ts)?["']/);
        expect(customisationSource).not.toMatch(/from ["'][^"']*main(?:\.ts)?["']/);
        expect(customisationSource).not.toMatch(/\bthis\.(?:app|core|services)\b/);
        expect(customisationSource).not.toContain("JsonResolveModal");
        expect(customisationSource).not.toContain("ConflictResolveModal");
        expect(customisationSource).not.toContain("getObsidianCommunityPluginManager");
        expect(customisationSource).not.toContain("pluginScanningCount");
        expect(featureSource).toContain("createCustomisationSyncObsidianDependencies");
        expect(customisationAdapterSource).toContain("JsonResolveModal");
        expect(customisationAdapterSource).toContain("ConflictResolveModal");
        expect(hiddenSource).not.toContain("extends LiveSyncContext");
        expect(hiddenSource).not.toMatch(/from ["'][^"']*LiveSyncContext(?:\.ts)?["']/);
        expect(hiddenSource).not.toMatch(/from ["'][^"']*main(?:\.ts)?["']/);
        expect(hiddenSource).not.toMatch(/\bthis\.(?:app|core|services)\b/);
        expect(hiddenSource).not.toContain("JsonResolveModal");
        expect(hiddenSource).not.toContain("getObsidianCommunityPluginManager");
        expect(hiddenSource).not.toContain("hiddenFilesEventCount");
        expect(hiddenSource).not.toContain("hiddenFilesProcessingCount");
        expect(featureSource).toContain("createHiddenFileSyncObsidianDependencies");
        expect(hiddenFileAdapterSource).toContain("JsonResolveModal");
        expect(hiddenFileAdapterSource).toContain("getObsidianCommunityPluginManager");
        expect(hiddenFileAdapterSource).toContain("hiddenFilesEventCount");
        expect(hiddenFileAdapterSource).toContain("hiddenFilesProcessingCount");
    });

    it("removes constructor-name add-on lookup from the core", () => {
        const coreSource = read("../LiveSyncBaseCore.ts");

        expect(coreSource).not.toContain("getAddOn");
        expect(coreSource).not.toContain("addon.constructor.name");
    });

    it("keeps real-Obsidian tests on the explicit feature test surface", () => {
        const customisationE2e = read("../../test/e2e-obsidian/scripts/customisation-sync.ts");
        const hiddenE2e = read("../../test/e2e-obsidian/scripts/hidden-file-snippet-sync.ts");
        const setupE2e = read("../../test/e2e-obsidian/scripts/setup-uri-workflow.ts");

        for (const source of [customisationE2e, hiddenE2e, setupE2e]) {
            expect(source).not.toContain("getAddOn(");
        }
        expect(customisationE2e).toContain("optionalFileSync.testing.customisationSync");
        expect(hiddenE2e).toContain("optionalFileSync.testing.hiddenFileSync");
        expect(setupE2e).toContain("optionalFileSync.testing.hiddenFileSync");
    });
});
