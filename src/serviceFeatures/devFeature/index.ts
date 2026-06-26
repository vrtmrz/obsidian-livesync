import { createObsidianServiceFeature } from "@/types.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils.ts";
import { __onMissingTranslation } from "@lib/common/i18n.ts";
import { delay } from "octagonal-wheels/promises";
import { TestPaneView, VIEW_TYPE_TEST } from "@/modules/extras/devUtil/TestPaneView.ts";
import type { WorkspaceLeaf } from "@/deps.ts";
import type { DevFeatureServices, DevFeatureModules } from "./types.ts";
import { createInitialState } from "./state.ts";
import { onMissingTranslation, createConflict, addTestResult, dumpDocument } from "./devOperations.ts";

/**
 * A service feature hook that initialises dev/testing utilities.
 * Handles missing translation captures, test panels, and debugging commands.
 */
export const useDevFeature = createObsidianServiceFeature<
    DevFeatureServices,
    DevFeatureModules,
    "app" | "liveSyncPlugin"
>((host) => {
    const log = createInstanceLogFunction("DevFeature", host.services.API);
    const state = createInitialState();

    const everyOnloadStart = (): Promise<boolean> => {
        __onMissingTranslation((key) => {
            void onMissingTranslation(host, log, key);
        });

        host.services.API.addCommand({
            id: "livesync-dump",
            name: "Dump information of this doc ",
            callback: () => {
                const file = host.services.vault.getActiveFilePath();
                dumpDocument(host, file);
            },
        });

        return Promise.resolve(true);
    };

    const everyOnloadAfterLoadSettings = (): Promise<boolean> => {
        const settings = host.services.setting.settings;
        if (!settings.enableDebugTools) return Promise.resolve(true);

        const plugin = host.context.liveSyncPlugin;
        // TestPaneView expects a matching ModuleDev layout with testResults.
        // state matches this shape exactly.
        host.services.API.registerWindow(VIEW_TYPE_TEST, (leaf: WorkspaceLeaf) => {
            return new TestPaneView(leaf, plugin, state);
        });

        host.services.API.addCommand({
            id: "view-test",
            name: "Open Test dialogue",
            callback: () => {
                void host.services.API.showWindow(VIEW_TYPE_TEST);
            },
        });
        return Promise.resolve(true);
    };

    const everyOnLayoutReady = async (): Promise<boolean> => {
        const settings = host.services.setting.settings;
        if (!settings.enableDebugTools) return Promise.resolve(true);

        host.services.API.addCommand({
            id: "test-create-conflict",
            name: "Create conflict",
            callback: async () => {
                await createConflict(host);
            },
        });
        await delay(1);
        return true;
    };

    const everyModuleTest = (): Promise<boolean> => {
        const settings = host.services.setting.settings;
        if (!settings.enableDebugTools) return Promise.resolve(true);
        return Promise.resolve(true);
    };

    // Bind event handlers
    host.services.appLifecycle.onLayoutReady.addHandler(everyOnLayoutReady);
    host.services.appLifecycle.onInitialise.addHandler(everyOnloadStart);
    host.services.appLifecycle.onSettingLoaded.addHandler(everyOnloadAfterLoadSettings);
    host.services.test.test.addHandler(everyModuleTest);
    (host.services.test.addTestResult as any).setHandler(
        (name: any, key: any, result: any, summary: any, message: any) => {
            addTestResult(state, name, key, result, summary, message);
        }
    );
});
