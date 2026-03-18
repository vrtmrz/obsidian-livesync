import { Notice, Plugin, type App, type PluginManifest } from "./deps";

import { LiveSyncCommands } from "./features/LiveSyncCommands.ts";
import { HiddenFileSync } from "./features/HiddenFileSync/CmdHiddenFileSync.ts";
import { ConfigSync } from "./features/ConfigSync/CmdConfigSync.ts";
import { ModuleDev } from "./modules/extras/ModuleDev.ts";

import { ModuleInteractiveConflictResolver } from "./modules/features/ModuleInteractiveConflictResolver.ts";
import { ModuleLog } from "./modules/features/ModuleLog.ts";
import { ModuleObsidianEvents } from "./modules/essentialObsidian/ModuleObsidianEvents.ts";
import { ModuleObsidianSettingDialogue } from "./modules/features/ModuleObsidianSettingTab.ts";
import { ModuleObsidianDocumentHistory } from "./modules/features/ModuleObsidianDocumentHistory.ts";
import { ModuleObsidianGlobalHistory } from "./modules/features/ModuleGlobalHistory.ts";
import { ModuleIntegratedTest } from "./modules/extras/ModuleIntegratedTest.ts";
import { ModuleReplicateTest } from "./modules/extras/ModuleReplicateTest.ts";
import { LocalDatabaseMaintenance } from "./features/LocalDatabaseMainte/CmdLocalDatabaseMainte.ts";
import type { InjectableServiceHub } from "@lib/services/implements/injectable/InjectableServiceHub.ts";
import { ObsidianServiceHub } from "./modules/services/ObsidianServiceHub.ts";
import { ServiceRebuilder } from "@lib/serviceModules/Rebuilder.ts";
import { ServiceDatabaseFileAccess } from "@/serviceModules/DatabaseFileAccess.ts";
import { ServiceFileAccessObsidian } from "@/serviceModules/ServiceFileAccessImpl.ts";
import { StorageAccessManager } from "@lib/managers/StorageProcessingManager.ts";
import { ServiceFileHandler } from "./serviceModules/FileHandler.ts";
import { FileAccessObsidian } from "./serviceModules/FileAccessObsidian.ts";
import { StorageEventManagerObsidian } from "./managers/StorageEventManagerObsidian.ts";
import type { ServiceModules } from "./types.ts";
import { setNoticeClass } from "@lib/mock_and_interop/wrapper.ts";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext.ts";
import { LiveSyncBaseCore } from "./LiveSyncBaseCore.ts";
import { ModuleObsidianMenu } from "./modules/essentialObsidian/ModuleObsidianMenu.ts";
import { ModuleObsidianSettingsAsMarkdown } from "./modules/features/ModuleObsidianSettingAsMarkdown.ts";
import { SetupManager } from "./modules/features/SetupManager.ts";
import { ModuleMigration } from "./modules/essential/ModuleMigration.ts";
import { enableI18nFeature } from "./serviceFeatures/onLayoutReady/enablei18n.ts";
import { useOfflineScanner } from "@lib/serviceFeatures/offlineScanner.ts";
import { useCheckRemoteSize } from "@lib/serviceFeatures/checkRemoteSize.ts";
import { useRedFlagFeatures } from "./serviceFeatures/redFlag.ts";
import { useSetupProtocolFeature } from "./serviceFeatures/setupObsidian/setupProtocol.ts";
import { useSetupQRCodeFeature } from "@lib/serviceFeatures/setupObsidian/qrCode";
import { useSetupURIFeature } from "@lib/serviceFeatures/setupObsidian/setupUri";
import { useSetupManagerHandlersFeature } from "./serviceFeatures/setupObsidian/setupManagerHandlers.ts";
import { useP2PReplicatorFeature } from "@lib/replication/trystero/useP2PReplicatorFeature.ts";
import { useP2PReplicatorCommands } from "@lib/replication/trystero/useP2PReplicatorCommands.ts";
import { useP2PReplicatorUI } from "./serviceFeatures/useP2PReplicatorUI.ts";
export type LiveSyncCore = LiveSyncBaseCore<ObsidianServiceContext, LiveSyncCommands>;
export default class ObsidianLiveSyncPlugin extends Plugin {
    core: LiveSyncCore;

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
            API: services.API,
            database: services.database,
            path: services.path,
            storageAccess: storageAccess,
            vault: services.vault,
        });

        const fileHandler = new ServiceFileHandler({
            API: services.API,
            databaseFileAccess: databaseFileAccess,
            conflict: services.conflict,
            setting: services.setting,
            fileProcessing: services.fileProcessing,
            vault: services.vault,
            path: services.path,
            replication: services.replication,
            storageAccess: storageAccess,
        });
        const rebuilder = new ServiceRebuilder({
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

        this.core = new LiveSyncBaseCore(
            serviceHub,
            (core, serviceHub) => {
                return this.initialiseServiceModules(core, serviceHub);
            },
            (core) => {
                const extraModules = [
                    new ModuleObsidianEvents(this, core),
                    new ModuleObsidianSettingDialogue(this, core),
                    new ModuleObsidianMenu(core),
                    new ModuleObsidianSettingsAsMarkdown(core),
                    new ModuleLog(this, core),
                    new ModuleObsidianDocumentHistory(this, core),
                    new ModuleInteractiveConflictResolver(this, core),
                    new ModuleObsidianGlobalHistory(this, core),
                    new ModuleDev(this, core),
                    new ModuleReplicateTest(this, core),
                    new ModuleIntegratedTest(this, core),
                    new SetupManager(core), // this should be moved to core?
                    new ModuleMigration(core),
                ];
                return extraModules;
            },
            (core) => {
                const addOns = [
                    new ConfigSync(this, core),
                    new HiddenFileSync(this, core),
                    new LocalDatabaseMaintenance(this, core),
                ];
                return addOns;
            },
            (core) => {
                //TODO Fix: useXXXX
                const featuresInitialiser = enableI18nFeature;
                const curriedFeature = () => featuresInitialiser(core);
                core.services.appLifecycle.onLayoutReady.addHandler(curriedFeature);
                const setupManager = core.getModule(SetupManager);
                useSetupProtocolFeature(core, setupManager);
                useSetupQRCodeFeature(core);
                useSetupURIFeature(core);
                useSetupManagerHandlersFeature(core, setupManager);
                useOfflineScanner(core);
                useRedFlagFeatures(core);
                useCheckRemoteSize(core);
                // p2pReplicatorResult = useP2PReplicator(core, [
                //     VIEW_TYPE_P2P,
                //     (leaf: any) => new P2PReplicatorPaneView(leaf, core, p2pReplicatorResult!),
                // ]);
                const replicator = useP2PReplicatorFeature(core);
                useP2PReplicatorCommands(core, replicator);
                useP2PReplicatorUI(core, core, replicator);
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
    override onunload() {
        return void this.core.services.control.onUnload();
    }
}
