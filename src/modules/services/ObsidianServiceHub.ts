import { InjectableServiceHub } from "@/lib/src/services/implements/injectable/InjectableServiceHub";
import { ObsidianServiceContext } from "@/lib/src/services/implements/obsidian/ObsidianServiceContext";
import type { ServiceInstances } from "@/lib/src/services/ServiceHub";
import type ObsidianLiveSyncPlugin from "@/main";
import {
    ObsidianAPIService,
    ObsidianAppLifecycleService,
    ObsidianConflictService,
    ObsidianDatabaseService,
    ObsidianFileProcessingService,
    ObsidianReplicationService,
    ObsidianReplicatorService,
    ObsidianRemoteService,
    ObsidianSettingService,
    ObsidianTweakValueService,
    ObsidianTestService,
    ObsidianDatabaseEventService,
    ObsidianPathService,
    ObsidianConfigService,
} from "./ObsidianServices";
import { ObsidianVaultService } from "./ObsidianVaultService";
import { ObsidianUIService } from "./ObsidianUIService";

// InjectableServiceHub

export class ObsidianServiceHub extends InjectableServiceHub<ObsidianServiceContext> {
    constructor(plugin: ObsidianLiveSyncPlugin) {
        const context = new ObsidianServiceContext(plugin.app, plugin, plugin);

        const API = new ObsidianAPIService(context);
        const appLifecycle = new ObsidianAppLifecycleService(context);
        const conflict = new ObsidianConflictService(context);
        const database = new ObsidianDatabaseService(context);
        const fileProcessing = new ObsidianFileProcessingService(context);
        const replication = new ObsidianReplicationService(context);
        const replicator = new ObsidianReplicatorService(context);
        const remote = new ObsidianRemoteService(context);
        const setting = new ObsidianSettingService(context);
        const tweakValue = new ObsidianTweakValueService(context);
        const vault = new ObsidianVaultService(context, {
            settingService: setting,
        });
        const test = new ObsidianTestService(context);
        const databaseEvents = new ObsidianDatabaseEventService(context);
        const path = new ObsidianPathService(context);
        const config = new ObsidianConfigService(context, vault);
        const ui = new ObsidianUIService(context, {
            appLifecycle,
            config,
            replicator,
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
        } satisfies Required<ServiceInstances<ObsidianServiceContext>>;

        super(context, serviceInstancesToInit);
    }
}
