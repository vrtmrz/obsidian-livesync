import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const uiSources = [
    ["PluginDialogModal", readFileSync(new URL("./PluginDialogModal.ts", import.meta.url), "utf8")],
    ["PluginPane", readFileSync(new URL("./PluginPane.svelte", import.meta.url), "utf8")],
    ["PluginCombo", readFileSync(new URL("./PluginCombo.svelte", import.meta.url), "utf8")],
    [
        "PaneCustomisationSync",
        readFileSync(
            new URL("../../modules/features/SettingDialogue/PaneCustomisationSync.ts", import.meta.url),
            "utf8"
        ),
    ],
    [
        "PaneHatch",
        readFileSync(new URL("../../modules/features/SettingDialogue/PaneHatch.ts", import.meta.url), "utf8"),
    ],
] as const;
const customisationSyncSource = readFileSync(new URL("./customisationSyncContext.ts", import.meta.url), "utf8");
const settingTabSource = readFileSync(
    new URL("../../modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts", import.meta.url),
    "utf8"
);
const settingModuleSource = readFileSync(
    new URL("../../modules/features/ModuleObsidianSettingTab.ts", import.meta.url),
    "utf8"
);

describe("optional-file synchronisation UI dependency boundary", () => {
    it.each(uiSources)("keeps %s independent from concrete add-ons and the application core", (_name, source) => {
        expect(source).not.toMatch(/from ["'][^"']*Cmd(?:Config|HiddenFile)Sync(?:\.ts)?["']/);
        expect(source).not.toMatch(/from ["'][^"']*main(?:\.ts)?["']/);
        expect(source).not.toContain("getAddOn(");
        expect(source).not.toContain("getAddOn<");
    });

    it("keeps the Customisation Sync runtime independent from its Obsidian dialogue", () => {
        expect(customisationSyncSource).not.toMatch(/from ["'][^"']*PluginDialogModal(?:\.ts)?["']/);
    });

    it("keeps the settings presentation out of the runtime cycle and off the compatibility lookup", () => {
        expect(settingTabSource).not.toMatch(/^import(?!\s+type\b)[^;]*from ["'][^"']*main(?:\.ts)?["'];/mu);
        expect(settingModuleSource).not.toContain("getAddOn(");
        expect(settingModuleSource).not.toContain("getAddOn<");
    });
});
