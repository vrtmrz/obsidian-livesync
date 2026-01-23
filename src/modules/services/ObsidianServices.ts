import { ServiceContext, type ServiceInstances } from "@/lib/src/services/ServiceHub.ts";
import {
    InjectableAPIService,
    InjectableAppLifecycleService,
    InjectableConflictService,
    InjectableDatabaseEventService,
    InjectableDatabaseService,
    InjectableFileProcessingService,
    InjectablePathService,
    InjectableRemoteService,
    InjectableReplicationService,
    InjectableReplicatorService,
    InjectableSettingService,
    InjectableTestService,
    InjectableTweakValueService,
    InjectableVaultService,
} from "../../lib/src/services/InjectableServices.ts";
import { InjectableServiceHub } from "../../lib/src/services/InjectableServices.ts";
import { ConfigServiceBrowserCompat } from "../../lib/src/services/Services.ts";
import type ObsidianLiveSyncPlugin from "../../main.ts";
import { ObsidianUIService } from "./ObsidianUIService.ts";
import type { App, Plugin } from "@/deps";

export class ObsidianServiceContext extends ServiceContext {
    app: App;
    plugin: Plugin;
    liveSyncPlugin: ObsidianLiveSyncPlugin;
    constructor(app: App, plugin: Plugin, liveSyncPlugin: ObsidianLiveSyncPlugin) {
        super();
        this.app = app;
        this.plugin = plugin;
        this.liveSyncPlugin = liveSyncPlugin;
    }
}

// All Services will be migrated to be based on Plain Services, not Injectable Services.
// This is a migration step.

export class ObsidianAPIService extends InjectableAPIService<ObsidianServiceContext> {
    getPlatform(): string {
        return "obsidian";
    }
}
export class ObsidianPathService extends InjectablePathService<ObsidianServiceContext> {}
export class ObsidianDatabaseService extends InjectableDatabaseService<ObsidianServiceContext> {}
export class ObsidianDatabaseEventService extends InjectableDatabaseEventService<ObsidianServiceContext> {}

// InjectableReplicatorService
export class ObsidianReplicatorService extends InjectableReplicatorService<ObsidianServiceContext> {}
// InjectableFileProcessingService
export class ObsidianFileProcessingService extends InjectableFileProcessingService<ObsidianServiceContext> {}
// InjectableReplicationService
export class ObsidianReplicationService extends InjectableReplicationService<ObsidianServiceContext> {}
// InjectableRemoteService
export class ObsidianRemoteService extends InjectableRemoteService<ObsidianServiceContext> {}
// InjectableConflictService
export class ObsidianConflictService extends InjectableConflictService<ObsidianServiceContext> {}
// InjectableAppLifecycleService
export class ObsidianAppLifecycleService extends InjectableAppLifecycleService<ObsidianServiceContext> {}
// InjectableSettingService
export class ObsidianSettingService extends InjectableSettingService<ObsidianServiceContext> {}
// InjectableTweakValueService
export class ObsidianTweakValueService extends InjectableTweakValueService<ObsidianServiceContext> {}
// InjectableVaultService
export class ObsidianVaultService extends InjectableVaultService<ObsidianServiceContext> {}
// InjectableTestService
export class ObsidianTestService extends InjectableTestService<ObsidianServiceContext> {}
export class ObsidianConfigService extends ConfigServiceBrowserCompat<ObsidianServiceContext> {}

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
        const vault = new ObsidianVaultService(context);
        const test = new ObsidianTestService(context);
        const databaseEvents = new ObsidianDatabaseEventService(context);
        const path = new ObsidianPathService(context);
        const ui = new ObsidianUIService(context);
        const config = new ObsidianConfigService(context, vault);
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
