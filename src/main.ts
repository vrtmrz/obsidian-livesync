import { getLanguage, Notice, Plugin, type App, type PluginManifest } from "./deps";
import { setGetLanguage } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
setGetLanguage(getLanguage);
import { LiveSyncCommands } from "./features/LiveSyncCommands.ts";
// import { ModuleDev } from "./modules/extras/ModuleDev.ts";

import { ModuleInteractiveConflictResolver } from "./modules/features/ModuleInteractiveConflictResolver.ts";
import { ModuleLog } from "./modules/features/ModuleLog.ts";
import { ModuleObsidianEvents } from "./modules/essentialObsidian/ModuleObsidianEvents.ts";
import { ModuleObsidianSettingDialogue } from "./modules/features/ModuleObsidianSettingTab.ts";
import { ModuleObsidianDocumentHistory } from "./modules/features/ModuleObsidianDocumentHistory.ts";
import { ModuleObsidianGlobalHistory } from "./modules/features/ModuleGlobalHistory.ts";
import { LocalDatabaseMaintenance } from "./features/LocalDatabaseMainte/CmdLocalDatabaseMainte.ts";
import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";
import { ObsidianServiceHub } from "./modules/services/ObsidianServiceHub.ts";
import { ServiceRebuilder } from "@vrtmrz/livesync-commonlib/compat/serviceModules/Rebuilder";
import { ServiceDatabaseFileAccess } from "@/serviceModules/DatabaseFileAccess.ts";
import { ServiceFileAccessObsidian } from "@/serviceModules/ServiceFileAccessImpl.ts";
import { StorageAccessManager } from "@vrtmrz/livesync-commonlib/compat/managers/StorageProcessingManager";
import { ServiceFileHandler } from "./serviceModules/FileHandler.ts";
import { FileAccessObsidian } from "./serviceModules/FileAccessObsidian.ts";
import { StorageEventManagerObsidian } from "./managers/StorageEventManagerObsidian.ts";
import type { ServiceModules } from "./types.ts";
import { setNoticeClass } from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/wrapper";
import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext";
import { LiveSyncBaseCore } from "./LiveSyncBaseCore.ts";
import { ModuleObsidianMenu } from "./modules/essentialObsidian/ModuleObsidianMenu.ts";
import { ModuleObsidianSettingsAsMarkdown } from "./modules/features/ModuleObsidianSettingAsMarkdown.ts";
import { SetupManager } from "./modules/features/SetupManager.ts";
import { ModuleMigration } from "./modules/essential/ModuleMigration.ts";
import { enableI18nFeature } from "./serviceFeatures/onLayoutReady/enablei18n.ts";
import { useOfflineScanner } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
import { useRemoteConfiguration } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/remoteConfig";
import { useCheckRemoteSize } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/checkRemoteSize";
import { useRedFlagFeatures } from "./serviceFeatures/redFlag.ts";
import { useSetupProtocolFeature } from "./serviceFeatures/setupObsidian/setupProtocol.ts";
import { useSetupQRCodeFeature } from "@/serviceFeatures/setupObsidian/qrCode";
import { useSetupURIFeature } from "@/serviceFeatures/setupObsidian/setupUri";
import { useSetupManagerHandlersFeature } from "./serviceFeatures/setupObsidian/setupManagerHandlers.ts";
import { useP2PReplicatorCommands, useP2PReplicatorFeature } from "@vrtmrz/livesync-commonlib/p2p";
import { useP2PReplicatorUI } from "./serviceFeatures/useP2PReplicatorUI.ts";
import { useReviewHarness } from "./serviceFeatures/useReviewHarness.ts";
import { createOpenReplicationUI, createOpenRebuildUI } from "./features/P2PSync/P2PReplicator/P2PReplicationUI.ts";
import { useCompatibilityReview } from "./serviceFeatures/compatibilityReview.ts";
import { createObsidianCompatibilityReviewUi } from "./serviceFeatures/compatibilityReviewObsidian.ts";
import { createFileReflectionProvenance } from "./serviceModules/FileReflectionProvenance.ts";
import { useCustomisationSyncUI } from "./serviceFeatures/useCustomisationSyncUI.ts";
import { useOptionalFileSync, type OptionalFileSyncFeature } from "./serviceFeatures/useOptionalFileSync.ts";
import { useHiddenFileSyncCommands } from "./serviceFeatures/useHiddenFileSyncCommands.ts";
export type LiveSyncCore = LiveSyncBaseCore<ObsidianServiceContext, LiveSyncCommands>;
export default class ObsidianLiveSyncPlugin extends Plugin {
    core: LiveSyncCore;
    optionalFileSync?: OptionalFileSyncFeature;

    /**
     * Initialise service modules.
     */
    private initialiseServiceModules(
        core: LiveSyncBaseCore<ObsidianServiceContext, LiveSyncCommands>,
        services: InjectableServiceHub<ObsidianServiceContext>
    ): ServiceModules {
        const storageAccessManager = new StorageAccessManager();
        // If we want to implement to the other platform, implement ObsidianXXXXXService.
        const vaultAccess = new FileAccessObsidian(this.app, {
            storageAccessManager: storageAccessManager,
            vaultService: services.vault,
            settingService: services.setting,
            APIService: services.API,
            pathService: services.path,
        });
        const storageEventManager = new StorageEventManagerObsidian(this, core, {
            fileProcessing: services.fileProcessing,
            setting: services.setting,
            vaultService: services.vault,
            storageAccessManager: storageAccessManager,
            APIService: services.API,
        });
        const storageAccess = new ServiceFileAccessObsidian({
            API: services.API,
            setting: services.setting,
            fileProcessing: services.fileProcessing,
            vault: services.vault,
            appLifecycle: services.appLifecycle,
            storageEventManager: storageEventManager,
            storageAccessManager: storageAccessManager,
            vaultAccess: vaultAccess,
        });

        const databaseFileAccess = new ServiceDatabaseFileAccess({
            events: services.context.events,
            API: services.API,
            database: services.database,
            path: services.path,
            storageAccess: storageAccess,
            vault: services.vault,
        });

        const fileHandler = new ServiceFileHandler({
            events: services.context.events,
            API: services.API,
            databaseFileAccess: databaseFileAccess,
            conflict: services.conflict,
            setting: services.setting,
            fileProcessing: services.fileProcessing,
            vault: services.vault,
            path: services.path,
            replication: services.replication,
            storageAccess: storageAccess,
            fileReflectionProvenance: createFileReflectionProvenance(services.keyValueDB),
        });
        const rebuilder = new ServiceRebuilder({
            events: services.context.events,
            API: services.API,
            database: services.database,
            appLifecycle: services.appLifecycle,
            setting: services.setting,
            remote: services.remote,
            databaseEvents: services.databaseEvents,
            replication: services.replication,
            replicator: services.replicator,
            UI: services.UI,
            vault: services.vault,
            fileHandler: fileHandler,
            fileProcessing: services.fileProcessing,
            storageAccess: storageAccess,
            control: services.control,
        });
        return {
            rebuilder,
            fileHandler,
            databaseFileAccess,
            storageAccess,
        };
    }

    /**
     * @obsolete Use services.setting.saveSettingData instead. Save the settings to the disk. This is usually called after changing the settings in the code, to persist the changes.
     */
    async saveSettings() {
        await this.core.services.setting.saveSettingData();
    }

    constructor(app: App, manifest: PluginManifest) {
        super(app, manifest);
        // Maybe no more need to setNoticeClass, but for safety, set it in the constructor of the main plugin class.
        // TODO: remove this.
        setNoticeClass(Notice);

        const serviceHub = new ObsidianServiceHub(this);
        let waitForCompatibilityReview = (): Promise<void> => Promise.resolve();

        this.core = new LiveSyncBaseCore(
            serviceHub,
            (core, serviceHub) => {
                return this.initialiseServiceModules(core, serviceHub);
            },
            (core) => {
                const extraModules = [
                    new ModuleObsidianEvents(this, core),
                    new ModuleObsidianSettingDialogue(this, core, {
                        getHiddenFileSyncRepair: () => this.optionalFileSync?.hiddenFileSyncRepair,
                    }),
                    new ModuleObsidianMenu(core),
                    new ModuleObsidianSettingsAsMarkdown(core),
                    new ModuleLog(this, core),
                    new ModuleObsidianDocumentHistory(this, core),
                    new ModuleInteractiveConflictResolver(this, core),
                    new ModuleObsidianGlobalHistory(this, core),
                    // new ModuleDev(this, core),
                    new SetupManager(core), // this should be moved to core?
                    new ModuleMigration(core, () => waitForCompatibilityReview()),
                ];
                return extraModules;
            },
            (core) => {
                return [new LocalDatabaseMaintenance(core)];
            },
            (core) => {
                //TODO Fix: useXXXX
                const featuresInitialiser = enableI18nFeature;
                const curriedFeature = () => featuresInitialiser(core);
                core.services.appLifecycle.onLayoutReady.addHandler(curriedFeature);
                const setupManager = core.getModule(SetupManager);
                const createInteractiveP2PReplication = createOpenReplicationUI(this.app);
                const replicator = useP2PReplicatorFeature(
                    core,
                    (_compatibilityReplicator, p2p) => createInteractiveP2PReplication(p2p),
                    createOpenRebuildUI(this.app)
                );
                setupManager.registerP2PSetupConnectionProbe(replicator.connectionProbe);
                useP2PReplicatorCommands(core, replicator);
                useP2PReplicatorUI(core, core, replicator, createInteractiveP2PReplication(replicator));
                useRemoteConfiguration(core);

                useSetupProtocolFeature(core, setupManager);
                useSetupQRCodeFeature(core);
                useSetupURIFeature(core);
                useSetupManagerHandlersFeature(core, setupManager);
                useOfflineScanner(core);
                useRedFlagFeatures(core);
                useCheckRemoteSize(core);
                const compatibilityReview = useCompatibilityReview(
                    core,
                    createObsidianCompatibilityReviewUi(core.confirm)
                );
                waitForCompatibilityReview = () => compatibilityReview.openReview();
                useReviewHarness(core, this, compatibilityReview);

                let customisationSyncUI: ReturnType<typeof useCustomisationSyncUI> | undefined;
                const optionalFileSync = useOptionalFileSync(core, {
                    getUIControl: () => customisationSyncUI,
                });
                customisationSyncUI = useCustomisationSyncUI(
                    core,
                    this.app,
                    optionalFileSync.customisationSync,
                    optionalFileSync.hiddenFileSyncInitialisation
                );
                useHiddenFileSyncCommands(core, optionalFileSync.hiddenFileSyncCommands);
                this.optionalFileSync = optionalFileSync;
            }
        );
    }

    private async _startUp() {
        if (!(await this.core.services.control.onLoad())) return;
        const onReady = this.core.services.control.onReady.bind(this.core.services.control);
        this.app.workspace.onLayoutReady(onReady);
    }
    override onload() {
        void this._startUp();
    }
    override onunload(): void {
        return void this.core.services.control.onUnload();
    }
}
