import type { AppLifecycleService, AppLifecycleServiceDependencies } from "@lib/services/base/AppLifecycleService";
import { ServiceContext } from "@lib/services/base/ServiceBase";
import * as nodePath from "node:path";
import { ConfigServiceBrowserCompat } from "@lib/services/implements/browser/ConfigServiceBrowserCompat";
import { SvelteDialogManagerBase, type ComponentHasResult } from "@lib/services/implements/base/SvelteDialog";
import { UIService } from "@lib/services/implements/base/UIService";
import { InjectableServiceHub } from "@lib/services/implements/injectable/InjectableServiceHub";
import { InjectableAppLifecycleService } from "@lib/services/implements/injectable/InjectableAppLifecycleService";
import { InjectableConflictService } from "@lib/services/implements/injectable/InjectableConflictService";
import { InjectableDatabaseEventService } from "@lib/services/implements/injectable/InjectableDatabaseEventService";
import { InjectableFileProcessingService } from "@lib/services/implements/injectable/InjectableFileProcessingService";
import { PathServiceCompat } from "@lib/services/implements/injectable/InjectablePathService";
import { InjectableRemoteService } from "@lib/services/implements/injectable/InjectableRemoteService";
import { InjectableReplicationService } from "@lib/services/implements/injectable/InjectableReplicationService";
import { InjectableReplicatorService } from "@lib/services/implements/injectable/InjectableReplicatorService";
import { InjectableTestService } from "@lib/services/implements/injectable/InjectableTestService";
import { InjectableTweakValueService } from "@lib/services/implements/injectable/InjectableTweakValueService";
import { InjectableVaultServiceCompat } from "@lib/services/implements/injectable/InjectableVaultService";
import { ControlService } from "@lib/services/base/ControlService";
import type { IControlService } from "@lib/services/base/IService";
import { HeadlessAPIService } from "@lib/services/implements/headless/HeadlessAPIService";
// import { HeadlessDatabaseService } from "@lib/services/implements/headless/HeadlessDatabaseService";
import type { ServiceInstances } from "@lib/services/ServiceHub";
import { NodeKeyValueDBService } from "./NodeKeyValueDBService";
import { NodeSettingService } from "./NodeSettingService";
import { DatabaseService } from "@lib/services/base/DatabaseService";
import type { ObsidianLiveSyncSettings } from "@/lib/src/common/types";

export class NodeServiceContext extends ServiceContext {
    vaultPath: string;
    constructor(vaultPath: string) {
        super();
        this.vaultPath = vaultPath;
    }
}

class NodeAppLifecycleService<T extends ServiceContext> extends InjectableAppLifecycleService<T> {
    constructor(context: T, dependencies: AppLifecycleServiceDependencies) {
        super(context, dependencies);
    }
}

class NodeSvelteDialogManager<T extends ServiceContext> extends SvelteDialogManagerBase<T> {
    openSvelteDialog<TValue, UInitial>(
        component: ComponentHasResult<TValue, UInitial>,
        initialData?: UInitial
    ): Promise<TValue | undefined> {
        throw new Error("Method not implemented.");
    }
}

type NodeUIServiceDependencies<T extends ServiceContext = ServiceContext> = {
    appLifecycle: AppLifecycleService<T>;
    config: ConfigServiceBrowserCompat<T>;
    replicator: InjectableReplicatorService<T>;
    APIService: HeadlessAPIService<T>;
    control: IControlService;
};
class NodeDatabaseService<T extends NodeServiceContext> extends DatabaseService<T> {
    protected override modifyDatabaseOptions(
        settings: ObsidianLiveSyncSettings,
        name: string,
        options: PouchDB.Configuration.DatabaseConfiguration
    ): { name: string; options: PouchDB.Configuration.DatabaseConfiguration } {
        const optionPass = {
            ...options,
            prefix: this.context.vaultPath + nodePath.sep,
        };
        const passSettings = { ...settings, useIndexedDBAdapter: false };
        return super.modifyDatabaseOptions(passSettings, name, optionPass);
    }
}
class NodeUIService<T extends ServiceContext> extends UIService<T> {
    override get dialogToCopy(): never {
        throw new Error("Method not implemented.");
    }

    constructor(context: T, dependencies: NodeUIServiceDependencies<T>) {
        const headlessConfirm = dependencies.APIService.confirm;
        const dialogManager = new NodeSvelteDialogManager<T>(context, {
            confirm: headlessConfirm,
            appLifecycle: dependencies.appLifecycle,
            config: dependencies.config,
            replicator: dependencies.replicator,
            control: dependencies.control,
        });

        super(context, {
            appLifecycle: dependencies.appLifecycle,
            dialogManager,
            APIService: dependencies.APIService,
        });
    }
}

export class NodeServiceHub<T extends NodeServiceContext> extends InjectableServiceHub<T> {
    constructor(basePath: string, context: T = new NodeServiceContext(basePath) as T) {
        const runtimeDir = nodePath.join(basePath, ".livesync", "runtime");
        const localStoragePath = nodePath.join(runtimeDir, "local-storage.json");
        const keyValueDBPath = nodePath.join(runtimeDir, "keyvalue-db.json");

        const API = new HeadlessAPIService<T>(context);
        const conflict = new InjectableConflictService(context);
        const fileProcessing = new InjectableFileProcessingService(context);

        const setting = new NodeSettingService(context, { APIService: API }, localStoragePath);

        const appLifecycle = new NodeAppLifecycleService<T>(context, {
            settingService: setting,
        });

        const remote = new InjectableRemoteService(context, {
            APIService: API,
            appLifecycle,
            setting,
        });

        const tweakValue = new InjectableTweakValueService(context);
        const vault = new InjectableVaultServiceCompat(context, {
            settingService: setting,
            APIService: API,
        });
        const test = new InjectableTestService(context);
        const databaseEvents = new InjectableDatabaseEventService(context);
        const path = new PathServiceCompat(context, {
            settingService: setting,
        });

        const database = new NodeDatabaseService<T>(context, {
            API: API,
            path,
            vault,
            setting,
        });

        const config = new ConfigServiceBrowserCompat<T>(context, {
            settingService: setting,
            APIService: API,
        });

        const replicator = new InjectableReplicatorService(context, {
            settingService: setting,
            appLifecycleService: appLifecycle,
            databaseEventService: databaseEvents,
        });

        const replication = new InjectableReplicationService(context, {
            APIService: API,
            appLifecycleService: appLifecycle,
            replicatorService: replicator,
            settingService: setting,
            fileProcessingService: fileProcessing,
            databaseService: database,
        });

        const keyValueDB = new NodeKeyValueDBService(
            context,
            {
                appLifecycle,
                databaseEvents,
                vault,
            },
            keyValueDBPath
        );

        const control = new ControlService(context, {
            appLifecycleService: appLifecycle,
            settingService: setting,
            databaseService: database,
            fileProcessingService: fileProcessing,
            APIService: API,
            replicatorService: replicator,
        });

        const ui = new NodeUIService<T>(context, {
            appLifecycle,
            config,
            replicator,
            APIService: API,
            control,
        });

        const serviceInstancesToInit: Required<ServiceInstances<T>> = {
            appLifecycle,
            conflict,
            database,
            databaseEvents,
            fileProcessing,
            replication,
            replicator,
            remote,
            setting,
            tweakValue,
            vault,
            test,
            ui,
            path,
            API,
            config,
            keyValueDB: keyValueDB as any,
            control,
        };

        super(context, serviceInstancesToInit as any);
    }
}
