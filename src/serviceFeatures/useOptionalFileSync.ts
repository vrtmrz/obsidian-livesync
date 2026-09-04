import type { FilePath, FilePathWithPrefix, UXFileInfoStub } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import {
    isCustomisationSyncMetadata,
    isInternalMetadata,
    isPluginMetadata,
} from "@vrtmrz/livesync-commonlib/compat/common/typeUtils";

import {
    CustomisationSyncContext,
    type CustomisationSyncContextDependencies,
} from "@/features/ConfigSync/customisationSyncContext.ts";
import type {
    CustomisationSyncDialogView,
    CustomisationSyncTestingView,
} from "@/features/ConfigSync/customisationSyncView.ts";
import { HiddenFileSyncContext } from "@/features/HiddenFileSync/hiddenFileSyncContext.ts";
import type {
    HiddenFileSyncCommandView,
    HiddenFileSyncInitialisationView,
    HiddenFileSyncRepairView,
    HiddenFileSyncTestingView,
} from "@/features/HiddenFileSync/hiddenFileSyncViews.ts";
import type { LiveSyncCore } from "@/main.ts";
import {
    createCustomisationSyncObsidianDependencies,
    type CustomisationSyncObsidianPolicies,
} from "./customisationSyncObsidianAdapter.ts";
import {
    createHiddenFileSyncObsidianDependencies,
    type HiddenFileSyncObsidianPolicies,
} from "./hiddenFileSyncObsidianAdapter.ts";
import {
    isCustomisationSyncDocumentLocallyOwned,
    routeOptionalFileSyncPath,
    selectOptionalFileSyncOwner,
    type OptionalFileSyncOwnerSelectionInput,
} from "./optionalFileSyncRouting.ts";

export interface OptionalFileSyncFeature {
    readonly customisationSync: CustomisationSyncDialogView;
    readonly hiddenFileSyncCommands: HiddenFileSyncCommandView;
    readonly hiddenFileSyncInitialisation: HiddenFileSyncInitialisationView;
    readonly hiddenFileSyncRepair: HiddenFileSyncRepairView;
    /** @internal Focused operations for the repository's real-Obsidian contract tests. */
    readonly testing: {
        readonly customisationSync: CustomisationSyncTestingView;
        readonly hiddenFileSync: HiddenFileSyncTestingView;
    };
}

export type OptionalFileSyncDependencies = Pick<Partial<CustomisationSyncContextDependencies>, "getUIControl"> & {
    createCustomisationSync?: (policies: CustomisationSyncObsidianPolicies) => CustomisationSyncContext;
    createHiddenFileSync?: (policies: HiddenFileSyncObsidianPolicies) => HiddenFileSyncContext;
};

/**
 * Compose Customisation Sync and Hidden File Sync as one optional-file owner.
 *
 * The two runtimes intentionally remain separate because they have distinct
 * state and persistence rules. Their shared service handlers are registered
 * here rather than as a side effect of constructing two add-ons. A pure
 * policy selects one local writer before either runtime callback is invoked.
 */
export function useOptionalFileSync(
    host: LiveSyncCore,
    dependencies: OptionalFileSyncDependencies = {}
): OptionalFileSyncFeature {
    const createCustomisationSync =
        dependencies.createCustomisationSync ??
        ((policies: CustomisationSyncObsidianPolicies) =>
            new CustomisationSyncContext(createCustomisationSyncObsidianDependencies(host, policies)));
    const createHiddenFileSync =
        dependencies.createHiddenFileSync ??
        ((policies: HiddenFileSyncObsidianPolicies) =>
            new HiddenFileSyncContext(createHiddenFileSyncObsidianDependencies(host, policies)));

    const ownerSelectionInput = (path: FilePath): OptionalFileSyncOwnerSelectionInput => ({
        path,
        configDir: host.services.API.getSystemConfigDir(),
        useV2: host.settings.usePluginSyncV2,
        usePluginEtc: host.settings.usePluginEtc,
        customisationEnabled: host.settings.usePluginSync,
        hiddenFileEnabled: host.settings.syncInternalFiles,
        pluginSyncExtendedSetting: host.settings.pluginSyncExtendedSetting,
    });
    const ownsLocalFile = (owner: "customisation" | "hidden-file") => (path: FilePath) =>
        selectOptionalFileSyncOwner(ownerSelectionInput(path)).owner == owner;

    const customisationSync = createCustomisationSync({
        getUIControl: () => dependencies.getUIControl?.(),
        ownsLocalFile: ownsLocalFile("customisation"),
        ownsLocalDocument: (documentPath) =>
            isCustomisationSyncDocumentLocallyOwned({
                documentPath,
                customisationEnabled: host.settings.usePluginSync,
                pluginSyncExtendedSetting: host.settings.pluginSyncExtendedSetting,
            }),
    });
    const hiddenFileSync = createHiddenFileSync({
        ownsLocalFile: ownsLocalFile("hidden-file"),
    });
    const customisationHandlers = customisationSync.serviceHandlers;
    const hiddenFileHandlers = hiddenFileSync.serviceHandlers;
    const hiddenFileSyncRepair = hiddenFileSync.repair;
    const { services } = host;
    const disposers: (() => void)[] = [];

    const register = (dispose: () => void) => {
        disposers.push(dispose);
    };

    const normaliseLocalPath = (file: string | UXFileInfoStub) =>
        stripAllPrefixes((typeof file === "string" ? file : file.path) as FilePathWithPrefix);
    const routeLocalPath = async (path: FilePath) => {
        const selected = selectOptionalFileSyncOwner(ownerSelectionInput(path));
        const hiddenFileEligible =
            selected.owner == "hidden-file" ? await hiddenFileHandlers.isTargetFileEligible(path) : false;
        const ready = services.appLifecycle.isReady() && !services.appLifecycle.isSuspended();
        return routeOptionalFileSyncPath({
            ...ownerSelectionInput(path),
            customisationReady: ready,
            hiddenFileReady: ready,
            hiddenFileEligible,
        });
    };

    register(
        services.fileProcessing.processOptionalFileEvent.addHandler(async (path: FilePath) => {
            const localPath = normaliseLocalPath(path);
            const decision = await routeLocalPath(localPath);
            if (decision.owner == "customisation") {
                return await customisationHandlers.processOptionalFileEvent(localPath);
            }
            if (decision.owner == "hidden-file") {
                return await hiddenFileHandlers.processOptionalFileEvent(localPath);
            }
            return false;
        })
    );
    register(
        services.conflict.getOptionalConflictCheckMethod.addHandler((path: FilePathWithPrefix) => {
            if (isPluginMetadata(path) || isCustomisationSyncMetadata(path)) {
                return Promise.resolve("newer");
            }
            if (isInternalMetadata(path)) {
                return hiddenFileHandlers.queueConflict(path);
            }
            return Promise.resolve(false);
        })
    );

    register(services.replication.processVirtualDocument.addHandler(customisationHandlers.processVirtualDocument));
    register(
        services.replication.processOptionalSynchroniseResult.addHandler(hiddenFileHandlers.processOptionalSyncFiles)
    );
    register(services.appLifecycle.onSettingLoaded.addHandler(hiddenFileHandlers.onSettingLoaded));

    register(services.setting.onRealiseSetting.addHandler(customisationHandlers.onRealiseSetting));
    register(services.setting.onRealiseSetting.addHandler(hiddenFileHandlers.realiseSettingSyncMode));
    register(services.appLifecycle.onResuming.addHandler(customisationHandlers.onResuming));
    register(services.appLifecycle.onResuming.addHandler(hiddenFileHandlers.onResuming));
    register(services.replication.onBeforeReplicate.addHandler(customisationHandlers.onBeforeReplicate));
    register(services.replication.onBeforeReplicate.addHandler(hiddenFileHandlers.beforeReplicate));
    register(services.databaseEvents.onDatabaseInitialised.addHandler(customisationHandlers.onDatabaseInitialised));
    register(services.databaseEvents.onDatabaseInitialised.addHandler(hiddenFileHandlers.onDatabaseInitialised));
    register(services.setting.suspendExtraSync.addHandler(customisationHandlers.suspendExtraSync));
    register(services.setting.suspendExtraSync.addHandler(hiddenFileHandlers.suspendExtraSync));
    register(services.setting.enableOptionalFeature.addHandler(customisationHandlers.enableOptionalFeature));
    register(services.setting.enableOptionalFeature.addHandler(hiddenFileHandlers.configureOptionalSyncFeature));
    register(
        services.vault.isTargetFileInExtra.addHandler(
            async (file: string | UXFileInfoStub) => (await routeLocalPath(normaliseLocalPath(file))).owner != "none"
        )
    );

    register(
        services.appLifecycle.onUnload.addHandler(async () => {
            let succeeded = true;
            for (const dispose of disposers.splice(0)) {
                try {
                    dispose();
                } catch {
                    succeeded = false;
                }
            }
            for (const context of [customisationSync, hiddenFileSync]) {
                try {
                    await Promise.resolve(context.dispose());
                } catch {
                    succeeded = false;
                }
            }
            return succeeded;
        })
    );

    return Object.freeze({
        customisationSync,
        hiddenFileSyncCommands: hiddenFileSync,
        hiddenFileSyncInitialisation: hiddenFileSync,
        hiddenFileSyncRepair,
        testing: Object.freeze({
            customisationSync: customisationSync.testing,
            hiddenFileSync: hiddenFileSync.testing,
        }),
    });
}
