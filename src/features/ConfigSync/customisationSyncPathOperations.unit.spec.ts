import { describe, expect, it } from "vitest";

import {
    createCustomisationSyncPathOperations,
    type CustomisationSyncPathOperationsDependencies,
} from "./customisationSyncPathOperations.ts";

type PathState = {
    configDir: string;
    useV2: boolean;
    usePluginEtc: boolean;
    deviceAndVaultName: string;
};

function createOperations(state: PathState) {
    const dependencies: CustomisationSyncPathOperationsDependencies = {
        getConfigDir: () => state.configDir,
        getUseV2: () => state.useV2,
        getUsePluginEtc: () => state.usePluginEtc,
        getDeviceAndVaultName: () => state.deviceAndVaultName,
    };
    return createCustomisationSyncPathOperations(dependencies);
}

describe("Customisation Sync path operations", () => {
    it("reads category and target settings through live getters", () => {
        const state: PathState = {
            configDir: ".obsidian",
            useV2: true,
            usePluginEtc: true,
            deviceAndVaultName: "device-a",
        };
        const operations = createOperations(state);
        const extraPluginFile = ".obsidian/plugins/example/settings.json";

        expect(operations.getFileCategory(extraPluginFile)).toBe("PLUGIN_ETC");
        expect(operations.isTargetPath(extraPluginFile)).toBe(true);

        state.useV2 = false;
        expect(operations.getFileCategory(extraPluginFile)).toBe("");
        expect(operations.isTargetPath(extraPluginFile)).toBe(false);

        state.useV2 = true;
        state.usePluginEtc = false;
        expect(operations.getFileCategory(extraPluginFile)).toBe("");

        state.configDir = ".config";
        expect(operations.isTargetPath(extraPluginFile)).toBe(false);
        expect(operations.isTargetPath(".config/plugins/example/settings.json")).toBe(false);
    });

    it("derives V1, V2, and device-prefix paths from the current term and settings", () => {
        const state: PathState = {
            configDir: ".obsidian",
            useV2: true,
            usePluginEtc: true,
            deviceAndVaultName: "device-a",
        };
        const operations = createOperations(state);
        const path = ".obsidian/plugins/example/main.js";

        expect(operations.filenameToUnifiedKey(path)).toBe("ix:device-a/PLUGIN_MAIN/example.md");
        expect(operations.filenameWithUnifiedKey(path)).toBe("ix:device-a/PLUGIN_MAIN/example%main.js");
        expect(operations.unifiedKeyPrefixOfTerminal()).toBe("ix:device-a/");

        state.deviceAndVaultName = "device-b";
        expect(operations.filenameToUnifiedKey(path)).toBe("ix:device-b/PLUGIN_MAIN/example.md");
        expect(operations.filenameWithUnifiedKey(path)).toBe("ix:device-b/PLUGIN_MAIN/example%main.js");
        expect(operations.unifiedKeyPrefixOfTerminal()).toBe("ix:device-b/");
    });

    it("keeps the existing override fallback semantics", () => {
        const state: PathState = {
            configDir: ".obsidian",
            useV2: true,
            usePluginEtc: true,
            deviceAndVaultName: "device-a",
        };
        const operations = createOperations(state);
        const path = ".obsidian/app.json";

        expect(operations.filenameToUnifiedKey(path, "device-b")).toBe("ix:device-b/CONFIG/app.json.md");
        expect(operations.filenameWithUnifiedKey(path, "device-b")).toBe("ix:device-b/CONFIG/app.json%app.json");
        expect(operations.unifiedKeyPrefixOfTerminal("device-b")).toBe("ix:device-b/");

        expect(operations.filenameToUnifiedKey(path, "")).toBe("ix:device-a/CONFIG/app.json.md");
        expect(operations.filenameWithUnifiedKey(path, "")).toBe("ix:device-a/CONFIG/app.json%app.json");
        expect(operations.unifiedKeyPrefixOfTerminal("")).toBe("ix:device-a/");
    });
});
