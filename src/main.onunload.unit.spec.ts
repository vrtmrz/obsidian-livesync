import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnedResource } from "octagonal-wheels/resource";
import { LOG_LEVEL_URGENT } from "octagonal-wheels/common/logger";
import { bindableFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/HandlerUtils";

const unusedStartupDependencies: readonly [string, readonly string[]][] = [
    ["@/serviceFeatures/useP2PSettingsPreparation", ["useP2PSettingsPreparation"]],
    ["@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions", ["setGetLanguage"]],
    ["./features/LiveSyncCommands.ts", ["LiveSyncCommands"]],
    ["./features/HiddenFileSync/CmdHiddenFileSync.ts", ["HiddenFileSync"]],
    ["./features/ConfigSync/CmdConfigSync.ts", ["ConfigSync"]],
    ["./modules/features/ModuleLog.ts", ["ModuleLog"]],
    ["./modules/essentialObsidian/ModuleObsidianEvents.ts", ["ModuleObsidianEvents"]],
    ["./modules/features/ModuleObsidianSettingTab.ts", ["ModuleObsidianSettingDialogue"]],
    ["./modules/features/ModuleObsidianDocumentHistory.ts", ["ModuleObsidianDocumentHistory"]],
    ["./modules/features/ModuleGlobalHistory.ts", ["ModuleObsidianGlobalHistory"]],
    ["./features/LocalDatabaseMainte/CmdLocalDatabaseMainte.ts", ["LocalDatabaseMaintenance"]],
    ["./modules/services/ObsidianServiceHub.ts", ["ObsidianServiceHub"]],
    ["@vrtmrz/livesync-commonlib/compat/serviceModules/Rebuilder", ["ServiceRebuilder"]],
    ["@/serviceModules/DatabaseFileAccess.ts", ["ServiceDatabaseFileAccess"]],
    ["@/serviceModules/ServiceFileAccessImpl.ts", ["ServiceFileAccessObsidian"]],
    ["@vrtmrz/livesync-commonlib/compat/managers/StorageProcessingManager", ["StorageAccessManager"]],
    ["./serviceModules/FileHandler.ts", ["ServiceFileHandler"]],
    ["./serviceModules/FileAccessObsidian.ts", ["FileAccessObsidian"]],
    ["./managers/StorageEventManagerObsidian.ts", ["StorageEventManagerObsidian"]],
    ["@vrtmrz/livesync-commonlib/compat/mock_and_interop/wrapper", ["setNoticeClass"]],
    ["./LiveSyncBaseCore.ts", ["LiveSyncBaseCore"]],
    ["./modules/features/ModuleObsidianSettingAsMarkdown.ts", ["ModuleObsidianSettingsAsMarkdown"]],
    ["./modules/features/SetupManager.ts", ["SetupManager"]],
    ["./serviceFeatures/onLayoutReady/enablei18n.ts", ["enableI18nFeature"]],
    ["@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner", ["useOfflineScanner"]],
    ["@vrtmrz/livesync-commonlib/compat/serviceFeatures/remoteConfig", ["useRemoteConfiguration"]],
    ["@vrtmrz/livesync-commonlib/compat/serviceFeatures/checkRemoteSize", ["useCheckRemoteSize"]],
    ["./serviceFeatures/redFlag.ts", ["useRedFlagFeatures"]],
    ["./serviceFeatures/setupObsidian/setupProtocol.ts", ["useSetupProtocolFeature"]],
    ["@/serviceFeatures/setupObsidian/qrCode", ["useSetupQRCodeFeature"]],
    ["@/serviceFeatures/setupObsidian/setupUri", ["useSetupURIFeature"]],
    [
        "./serviceFeatures/setupObsidian/setupManagerHandlers.ts",
        ["showOnboardingInvitation", "useSetupManagerHandlersFeature"],
    ],
    ["@vrtmrz/livesync-commonlib/p2p", ["useP2PReplicatorCommands", "useP2PReplicatorFeature"]],
    ["./serviceFeatures/useP2PReplicatorUI.ts", ["useP2PReplicatorUI"]],
    ["./serviceFeatures/useReviewHarness.ts", ["useReviewHarness"]],
    ["./features/P2PSync/P2PReplicator/P2PReplicationUI.ts", ["createOpenReplicationUI", "createOpenRebuildUI"]],
    ["./serviceFeatures/compatibilityReview.ts", ["useCompatibilityReview"]],
    ["./serviceFeatures/compatibilityReviewObsidian.ts", ["createObsidianCompatibilityReviewUi"]],
    ["./serviceModules/FileReflectionProvenance.ts", ["createFileReflectionProvenance"]],
    ["./serviceFeatures/interactiveConflictResolution", ["useInteractiveConflictResolutionFeature"]],
    ["./modules/features/InteractiveConflictResolving/ConflictResolveModal.ts", ["ConflictResolveModal"]],
    ["./serviceFeatures/obsidianReplicationRibbon.ts", ["useObsidianReplicationRibbonFeature"]],
    ["./serviceFeatures/syncGuard", ["useSyncGuardFeature"]],
    ["./serviceFeatures/syncGuard/SyncGuardOverlay", ["SyncGuardOverlay"]],
    ["./serviceFeatures/startupLifecycle", ["useStartupLifecycleFeature"]],
    ["./serviceFeatures/useJoinedDevices", ["useJoinedDevicesFeature"]],
    ["./serviceFeatures/useDatabaseDiagnostics", ["useDatabaseDiagnosticsFeature"]],
];

beforeEach(() => {
    vi.resetModules();
    vi.doMock("./deps", () => ({ Plugin: class {}, Notice: class {}, getLanguage: () => "en" }));
    for (const [specifier, names] of unusedStartupDependencies) {
        vi.doMock(specifier, () => Object.fromEntries(names.map((name) => [name, vi.fn()])));
    }
});

describe("Obsidian plug-in unload logging", () => {
    it.each(["complete", "fail"] as const)(
        "retains its log connection through shutdown and retires it afterwards: %s",
        async (outcome) => {
            const { default: LiveSyncPlugin } = await import("./main.ts");
            const events: string[] = [];
            const sink = vi.fn((message: unknown) => events.push(String(message)));
            const addLog = bindableFunction<(message: unknown, level?: number, key?: string) => void>("unload log");
            const unregister = addLog.setHandler(sink);
            const dispose = vi.fn(() => {
                unregister();
                events.push("disposed");
            });
            const logResource = createOwnedResource(sink, dispose);
            let finish!: () => void;
            let fail!: (reason: Error) => void;
            const shutdown = new Promise<void>((resolve, reject) => {
                finish = resolve;
                fail = reject;
            });
            const onUnload = vi.fn(() => shutdown);
            const core = {
                getModule: vi.fn(() => ({ logResource })),
                services: { API: { addLog }, control: { onUnload } },
            };

            expect(LiveSyncPlugin.prototype.onunload.call({ core } as never)).toBeUndefined();
            expect(onUnload).toHaveBeenCalledTimes(1);
            expect(dispose).not.toHaveBeenCalled();
            addLog("during shutdown");

            const failure = new Error("database close failed");
            if (outcome === "fail") {
                fail(failure);
            } else {
                finish();
            }
            await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));

            if (outcome === "fail") {
                const message = "Failed to unload Self-hosted LiveSync: " + String(failure);
                expect(sink).toHaveBeenCalledWith(message, LOG_LEVEL_URGENT, "shutdown");
                expect(events).toEqual(["during shutdown", message, "disposed"]);
            } else {
                expect(events).toEqual(["during shutdown", "disposed"]);
            }
            expect(() => addLog("after shutdown")).toThrow("not assigned");
        }
    );
});
