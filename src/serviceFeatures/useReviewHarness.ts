import { NEW_VAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/settings";
import { LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import type { UseP2PReplicatorResult } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/UseP2PReplicatorResult";
import type ObsidianLiveSyncPlugin from "@/main";
import type { LiveSyncCore } from "@/main";
import type { WorkspaceLeaf } from "@/deps";
import {
    ReviewHarnessController,
    REVIEW_HARNESS_STATE_KEY,
    type ReviewHarnessRuntime,
} from "@/features/ReviewHarness/reviewHarnessController";
import { ReviewHarnessView, VIEW_TYPE_REVIEW_HARNESS } from "@/features/ReviewHarness/ReviewHarnessView";
import type { ReviewHarnessScenarioResult } from "@/features/ReviewHarness/reviewHarnessContract";
import {
    REVIEW_HARNESS_FIXTURE_ROOT,
    runReviewHarnessVaultRoundTrip,
} from "@/features/ReviewHarness/reviewHarnessVaultFixture";
import type { CompatibilityReviewController } from "./compatibilityReview";

async function runVaultRoundTrip(plugin: ObsidianLiveSyncPlugin): Promise<ReviewHarnessScenarioResult> {
    const vault = plugin.app.vault;
    return runReviewHarnessVaultRoundTrip({
        confirmFixtureAccess: async () =>
            (await plugin.core.services.UI.confirm.askYesNoDialog(
                "This scenario creates, reads, modifies, renames, and removes one owned fixture tree. Use a dedicated test Vault. Continue?",
                {
                    title: "Review Harness: Vault fixture access",
                    defaultOption: "No",
                }
            )) === "yes",
        fixtureRootExists: () => vault.getAbstractFileByPath(REVIEW_HARNESS_FIXTURE_ROOT) !== null,
        createFixtureRoot: async () => {
            await vault.createFolder(REVIEW_HARNESS_FIXTURE_ROOT);
        },
        createFile: (path, content) => vault.create(path, content),
        readFile: (file) => vault.read(file),
        modifyFile: (file, content) => vault.modify(file, content),
        renameFile: (file, path) => vault.rename(file, path),
        filePath: (file) => file.path,
        removeFixtureRoot: async () => {
            const fixtureRoot = vault.getAbstractFileByPath(REVIEW_HARNESS_FIXTURE_ROOT);
            if (fixtureRoot) await plugin.app.fileManager.trashFile(fixtureRoot);
        },
    });
}

export function useReviewHarness(
    core: LiveSyncCore,
    plugin: ObsidianLiveSyncPlugin,
    p2p: UseP2PReplicatorResult,
    compatibilityReview: CompatibilityReviewController
): ReviewHarnessController {
    const services = core.services;
    const runtime: ReviewHarnessRuntime = {
        now: () => new Date(),
        getSettings: () => services.setting.currentSettings(),
        getNewVaultSettings: () => NEW_VAULT_SETTINGS,
        getSettingsMigrationState: () => services.setting.getSettingsMigrationState(),
        isCompatibilityReviewInitialised: () => compatibilityReview.initialised,
        getCompatibilityPause: () => compatibilityReview.pendingPause,
        openCompatibilityReview: () => compatibilityReview.openReview(),
        getP2PComposition: () => ({
            first: p2p.replicator,
            second: p2p.replicator,
            expectedServices: services,
        }),
        runVaultRoundTrip: () => runVaultRoundTrip(plugin),
        readContinuation: () => services.setting.getSmallConfig(REVIEW_HARNESS_STATE_KEY),
        writeContinuation: (value) => services.setting.setSmallConfig(REVIEW_HARNESS_STATE_KEY, value),
        deleteContinuation: () => services.setting.deleteSmallConfig(REVIEW_HARNESS_STATE_KEY),
        restart: () => services.appLifecycle.performRestart(),
        reportError: (error) => services.API.addLog(error, LOG_LEVEL_NOTICE),
        copyText: async (value) => {
            if (!activeWindow.navigator.clipboard) throw new Error("Clipboard access is unavailable on this device.");
            await activeWindow.navigator.clipboard.writeText(value);
        },
        getEnvironment: () => ({
            pluginVersion: services.API.getPluginVersion(),
            obsidianVersion: services.API.getAppVersion(),
            platform: services.API.getPlatform(),
            userAgent: activeWindow.navigator.userAgent || "unavailable",
            viewport:
                typeof activeWindow.innerWidth === "number" && typeof activeWindow.innerHeight === "number"
                    ? `${activeWindow.innerWidth}x${activeWindow.innerHeight}`
                    : "unavailable",
        }),
    };
    const controller = new ReviewHarnessController(runtime);
    let continuationConsumed = false;
    let registered = false;
    let openAfterLayout = false;

    services.appLifecycle.onSettingLoaded.addHandler(() => {
        if (!continuationConsumed) {
            continuationConsumed = true;
            controller.consumeContinuation();
        }
        const snapshot = controller.snapshot();
        openAfterLayout = snapshot.resumedRequestId !== null || snapshot.continuationError !== null;
        if (!services.setting.currentSettings().enableDebugTools || registered) return Promise.resolve(true);

        registered = true;
        services.API.registerWindow(
            VIEW_TYPE_REVIEW_HARNESS,
            (leaf: WorkspaceLeaf) => new ReviewHarnessView(leaf, controller)
        );
        services.API.addCommand({
            id: "open-review-harness",
            name: "Open review harness",
            callback: () => {
                void services.API.showWindow(VIEW_TYPE_REVIEW_HARNESS);
            },
        });
        return Promise.resolve(true);
    });

    services.appLifecycle.onLayoutReady.addHandler(() => {
        if (openAfterLayout && services.setting.currentSettings().enableDebugTools) {
            void services.API.showWindow(VIEW_TYPE_REVIEW_HARNESS);
        }
        return Promise.resolve(true);
    });

    return controller;
}
