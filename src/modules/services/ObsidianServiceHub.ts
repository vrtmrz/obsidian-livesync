import { InjectableServiceHub } from "@lib/services/implements/injectable/InjectableServiceHub";
import { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
import type { ServiceInstances } from "@lib/services/ServiceHub";
import type ObsidianLiveSyncPlugin from "@/main";
import {
    ObsidianConflictService,
    ObsidianFileProcessingService,
    ObsidianReplicationService,
    ObsidianReplicatorService,
    ObsidianRemoteService,
    ObsidianTweakValueService,
    ObsidianTestService,
    ObsidianDatabaseEventService,
    ObsidianConfigService,
    ObsidianKeyValueDBService,
    ObsidianControlService,
} from "./ObsidianServices";
import { ObsidianSettingService } from "./ObsidianSettingService";
import { ObsidianDatabaseService } from "./ObsidianDatabaseService";
import { ObsidianAPIService } from "./ObsidianAPIService";
import { ObsidianAppLifecycleService } from "./ObsidianAppLifecycleService";
import { ObsidianPathService } from "./ObsidianPathService";
import { ObsidianVaultService } from "./ObsidianVaultService";
import { ObsidianUIService } from "./ObsidianUIService";

// InjectableServiceHub

export class ObsidianServiceHub extends InjectableServiceHub<ObsidianServiceContext> {
    constructor(plugin: ObsidianLiveSyncPlugin) {
        const context = new ObsidianServiceContext(plugin.app, plugin, plugin);

        const API = new ObsidianAPIService(context);
        const appLifecycle = new ObsidianAppLifecycleService(context);
        const conflict = new ObsidianConflictService(context);
        const fileProcessing = new ObsidianFileProcessingService(context);
        const replication = new ObsidianReplicationService(context);

        const remote = new ObsidianRemoteService(context);
        const tweakValue = new ObsidianTweakValueService(context);

        const setting = new ObsidianSettingService(context, {
            APIService: API,
        });
        const vault = new ObsidianVaultService(context, {
            settingService: setting,
            APIService: API,
        });
        const test = new ObsidianTestService(context);
        const databaseEvents = new ObsidianDatabaseEventService(context);
        const path = new ObsidianPathService(context, {
            settingService: setting,
        });
        const database = new ObsidianDatabaseService(context, {
            path: path,
            vault: vault,
            setting: setting,
        });
        const keyValueDB = new ObsidianKeyValueDBService(context, {
            appLifecycle: appLifecycle,
            databaseEvents: databaseEvents,
            vault: vault,
        });
        const config = new ObsidianConfigService(context, {
            settingService: setting,
            APIService: API,
        });
        const replicator = new ObsidianReplicatorService(context, {
            settingService: setting,
            appLifecycleService: appLifecycle,
            databaseEventService: databaseEvents,
        });
        const ui = new ObsidianUIService(context, {
            appLifecycle,
            config,
            replicator,
            APIService: API,
        });
        const control = new ObsidianControlService(context, {
            appLifecycleService: appLifecycle,
            databaseService: database,
            fileProcessingService: fileProcessing,
            settingService: setting,
            APIService: API,
        });

        // Using 'satisfies' to ensure all services are provided
        const serviceInstancesToInit = {
            appLifecycle: appLifecycle,
            conflict: conflict,
            database: database,
            databaseEvents: databaseEvents,
            fileProcessing: fileProcessing,
            replication: replication,
            replicator: replicator,
            remote: remote,
            setting: setting,
            tweakValue: tweakValue,
            vault: vault,
            test: test,
            ui: ui,
            path: path,
            API: API,
            config: config,
            keyValueDB: keyValueDB,
            control: control,
        } satisfies Required<ServiceInstances<ObsidianServiceContext>>;

        super(context, serviceInstancesToInit);
    }
}
