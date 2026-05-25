/**
 * tests/sample.spec.ts
 *
 * Example e2e test that opens a vault with pre-seeded settings.
 */
import {
    getMainWindow,
    waitForVaultReady,
    enablePluginInObsidian,
    isPluginEnabledInObsidian,
} from "../helpers/obsidian";
import type { ObsidianLiveSyncSettings } from "@lib/common/types";
import { PartialMessages } from "@lib/common/messages/def";
import { locateModalByTitle, withSeededVault } from "test_e2e/helpers/helpers";
import { test, expect } from "test_e2e/helpers/wrapper";
const def = PartialMessages.def;

test("show Welcome when isConfigured is false", async () => {
    await withSeededVault(
        {
            appJson: {
                promptDelete: false,
            },
            communityPlugins: [],
            pluginData: {
                "obsidian-livesync": {
                    deviceAndVaultName: "e2e-configured-device",
                    isConfigured: true,
                    notifyThresholdOfRemoteStorageSize: 10000,
                } satisfies Partial<ObsidianLiveSyncSettings>,
            },
        },
        async ({ app }) => {
            const page = await getMainWindow(app);

            await waitForVaultReady(page);
            await expect(enablePluginInObsidian(page, "obsidian-livesync")).resolves.not.toThrow();
            expect(isPluginEnabledInObsidian(page, "obsidian-livesync")).toBeTruthy();
            const welcome = locateModalByTitle(page, def["moduleMigration.titleWelcome"]);
            await expect(welcome).toBeHidden({ timeout: 1_000 });
        }
    );
});

test("does not show Welcome when isConfigured is true", async () => {
    await withSeededVault(
        {
            appJson: {
                promptDelete: false,
            },
            communityPlugins: [],
            pluginData: {
                "obsidian-livesync": {
                    deviceAndVaultName: "e2e-configured-device",
                    isConfigured: true,
                    notifyThresholdOfRemoteStorageSize: 10000,
                } satisfies Partial<ObsidianLiveSyncSettings>,
            },
        },
        async ({ app }) => {
            const page = await getMainWindow(app);
            await waitForVaultReady(page);
            await expect(enablePluginInObsidian(page, "obsidian-livesync")).resolves.not.toThrow();
            expect(isPluginEnabledInObsidian(page, "obsidian-livesync")).toBeTruthy();
            const welcome = locateModalByTitle(page, def["moduleMigration.titleWelcome"]);
            await expect(welcome).toBeHidden({ timeout: 1_000 });
        }
    );
});
