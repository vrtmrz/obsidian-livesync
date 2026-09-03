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
import type { CustomisationSyncDialogView } from "@/features/ConfigSync/customisationSyncView.ts";
import { HiddenFileSyncContext } from "@/features/HiddenFileSync/hiddenFileSyncContext.ts";
import type {
    HiddenFileSyncCommandView,
    HiddenFileSyncInitialisationView,
    HiddenFileSyncRepairView,
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
    /** @internal Direct runtime access for the repository's real-Obsidian contract tests. */
    readonly testing: {
        readonly customisationSync: CustomisationSyncContext;
        readonly hiddenFileSync: HiddenFileSyncContext;
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
            selected.owner == "hidden-file" ? await hiddenFileSync.isTargetFileEligible(path) : false;
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
                return await customisationSync._anyProcessOptionalFileEvent(localPath);
            }
            if (decision.owner == "hidden-file") {
                return await hiddenFileSync._anyProcessOptionalFileEvent(localPath);
            }
            return false;
        })
    );
    register(
        services.conflict.getOptionalConflictCheckMethod.addHandler(async (path: FilePathWithPrefix) => {
            if (isPluginMetadata(path) || isCustomisationSyncMetadata(path)) {
                return await customisationSync._anyGetOptionalConflictCheckMethod(path);
            }
            if (isInternalMetadata(path)) {
                return await hiddenFileSync._anyGetOptionalConflictCheckMethod(path);
            }
            return false;
        })
    );

    register(
        services.replication.processVirtualDocument.addHandler(
            customisationSync._anyModuleParsedReplicationResultItem.bind(customisationSync)
        )
    );
    register(
        services.replication.processOptionalSynchroniseResult.addHandler(
            hiddenFileSync._anyProcessOptionalSyncFiles.bind(hiddenFileSync)
        )
    );
    register(
        services.appLifecycle.onSettingLoaded.addHandler(
            hiddenFileSync._everyOnloadAfterLoadSettings.bind(hiddenFileSync)
        )
    );

    register(
        services.setting.onRealiseSetting.addHandler(
            customisationSync._everyRealizeSettingSyncMode.bind(customisationSync)
        )
    );
    register(
        services.setting.onRealiseSetting.addHandler(hiddenFileSync._everyRealizeSettingSyncMode.bind(hiddenFileSync))
    );
    register(
        services.appLifecycle.onResuming.addHandler(customisationSync._everyOnResumeProcess.bind(customisationSync))
    );
    register(services.appLifecycle.onResuming.addHandler(hiddenFileSync._everyOnResumeProcess.bind(hiddenFileSync)));
    register(
        services.replication.onBeforeReplicate.addHandler(
            customisationSync._everyBeforeReplicate.bind(customisationSync)
        )
    );
    register(
        services.replication.onBeforeReplicate.addHandler(hiddenFileSync._everyBeforeReplicate.bind(hiddenFileSync))
    );
    register(
        services.databaseEvents.onDatabaseInitialised.addHandler(
            customisationSync._everyOnDatabaseInitialized.bind(customisationSync)
        )
    );
    register(
        services.databaseEvents.onDatabaseInitialised.addHandler(
            hiddenFileSync._everyOnDatabaseInitialized.bind(hiddenFileSync)
        )
    );
    register(
        services.setting.suspendExtraSync.addHandler(customisationSync._allSuspendExtraSync.bind(customisationSync))
    );
    register(services.setting.suspendExtraSync.addHandler(hiddenFileSync._allSuspendExtraSync.bind(hiddenFileSync)));
    register(
        services.setting.enableOptionalFeature.addHandler(
            customisationSync._allConfigureOptionalSyncFeature.bind(customisationSync)
        )
    );
    register(
        services.setting.enableOptionalFeature.addHandler(
            hiddenFileSync._allConfigureOptionalSyncFeature.bind(hiddenFileSync)
        )
    );
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
        hiddenFileSyncRepair: hiddenFileSync,
        testing: Object.freeze({ customisationSync, hiddenFileSync }),
    });
}
