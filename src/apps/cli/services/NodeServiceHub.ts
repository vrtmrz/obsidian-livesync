import type { AppLifecycleServiceDependencies } from "@vrtmrz/livesync-commonlib/compat/services/base/AppLifecycleService";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import type {
    ComponentHasResult,
    SvelteDialogManager,
} from "@vrtmrz/livesync-commonlib/compat/services/implements/base/SvelteDialog";
import { UIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/base/UIService";
import { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";
import { InjectableAppLifecycleService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableAppLifecycleService";
import { InjectableConflictService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableConflictService";
import { InjectableDatabaseEventService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableDatabaseEventService";
import { InjectableFileProcessingService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableFileProcessingService";
import { InjectableSettingService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableSettingService";
import { PathServiceCompat } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectablePathService";
import { InjectableRemoteService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableRemoteService";
import { InjectableReplicationService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableReplicationService";
import { InjectableReplicatorService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableReplicatorService";
import { InjectableTestService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableTestService";
import { InjectableTweakValueService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableTweakValueService";
import { InjectableVaultServiceCompat } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableVaultService";
import { ControlService } from "@vrtmrz/livesync-commonlib/compat/services/base/ControlService";
import { HeadlessAPIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/headless/HeadlessAPIService";
import { NodeKeyValueDBService } from "./NodeKeyValueDBService";
import { createNodeLocalStorage } from "./NodeLocalStorage";
import { DatabaseService } from "@vrtmrz/livesync-commonlib/compat/services/base/DatabaseService";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { fs, path as nodePath } from "@vrtmrz/livesync-commonlib/node";
import type { KeyValueDBService } from "@vrtmrz/livesync-commonlib/compat/services/base/KeyValueDBService";
import { PouchDB } from "@/apps/cli/lib/pouchdb-node";
import { NodeServiceContext } from "./NodeServiceContext";
import { setLang } from "@/common/translation";
import { runtimeDatabaseDirectory, runtimeScopeDirectory } from "@/apps/cli/runtimeState";
import { createDeletableValueStore } from "@vrtmrz/value-store";
import type { SettingServiceDependencies } from "@vrtmrz/livesync-commonlib/compat/services/base/SettingService";

export { NodeServiceContext } from "./NodeServiceContext";

class NodeAppLifecycleService<T extends ServiceContext> extends InjectableAppLifecycleService<T> {
    constructor(context: T, dependencies: AppLifecycleServiceDependencies) {
        super(context, dependencies);
    }
}

class NodeDialogManager<T extends ServiceContext> implements SvelteDialogManager<T> {
    open<TValue, UInitial>(
        _component: ComponentHasResult<TValue, UInitial>,
        _initialData?: UInitial
    ): Promise<TValue | undefined> {
        return Promise.reject(new Error("Interactive dialogues are not available in the CLI."));
    }

    openWithExplicitCancel<TValue, UInitial>(
        _component: ComponentHasResult<TValue, UInitial>,
        _initialData?: UInitial
    ): Promise<TValue> {
        return Promise.reject(new Error("Interactive dialogues are not available in the CLI."));
    }
}

type NodeUIServiceDependencies<T extends ServiceContext = ServiceContext> = {
    APIService: HeadlessAPIService<T>;
};
class NodeDatabaseService<T extends NodeServiceContext> extends DatabaseService<T> {
    protected override modifyDatabaseOptions(
        settings: ObsidianLiveSyncSettings,
        name: string,
        options: PouchDB.Configuration.DatabaseConfiguration
    ): { name: string; options: PouchDB.Configuration.DatabaseConfiguration } {
        const optionPass = {
            ...options,
            prefix: this.context.databasePath + nodePath.sep,
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
        const dialogManager = new NodeDialogManager<T>();

        super(context, {
            dialogManager,
            APIService: dependencies.APIService,
        });
    }
}

class NodeSettingService<T extends NodeServiceContext> extends InjectableSettingService<T> {
    declare readonly config: InjectableSettingService<T>["config"];

    constructor(context: T, dependencies: SettingServiceDependencies) {
        super(context, dependencies);
        const databaseConfig = this.config;
        const vaultScope = nodePath.basename(runtimeScopeDirectory(context.databasePath, "", context.runtimeVaultPath));
        this.config = createDeletableValueStore({
            get: (key) => databaseConfig.getValue(`${key}-${vaultScope}`),
            set: (key, value) => databaseConfig.setValue(`${key}-${vaultScope}`, value),
            delete: (key) => databaseConfig.delete(`${key}-${vaultScope}`),
        });
    }
}

export class NodeServiceHub<T extends NodeServiceContext> extends InjectableServiceHub<T> {
    constructor(basePath: string, context: T) {
        const runtimeDir = nodePath.join(basePath, ".livesync", "runtime");
        const localStoragePath = nodePath.join(runtimeDir, "local-storage.json");

        const API = new HeadlessAPIService<T>(context);
        const conflict = new InjectableConflictService(context);
        const fileProcessing = new InjectableFileProcessingService(context);

        const setting = new NodeSettingService<T>(context, {
            APIService: API,
            onDisplayLanguageChanged: setLang,
            deviceValues: createNodeLocalStorage(localStoragePath),
        });

        const appLifecycle = new NodeAppLifecycleService<T>(context, {
            settingService: setting,
        });

        const remote = new InjectableRemoteService(context, {
            pouchDB: PouchDB,
            APIService: API,
            appLifecycle,
            setting,
        });

        const tweakValue = new InjectableTweakValueService(context);
        const vault = new InjectableVaultServiceCompat(context, {
            settingService: setting,
            APIService: API,
        });
        const scopeDirectory = () => runtimeScopeDirectory(basePath, vault.getVaultName(), context.runtimeVaultPath);
        const test = new InjectableTestService(context);
        const databaseEvents = new InjectableDatabaseEventService(context);
        databaseEvents.onResetDatabase.addHandler(async () => {
            fs.rmSync(runtimeDatabaseDirectory(basePath, vault.getVaultName()), { force: true, recursive: true });
            return true;
        });
        const path = new PathServiceCompat(context, {
            settingService: setting,
        });

        const database = new NodeDatabaseService<T>(context, {
            pouchDB: PouchDB,
            API: API,
            path,
            vault,
            setting,
        });

        const config = setting.config;

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
            () => nodePath.join(scopeDirectory(), "keyvalue-db.json")
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
            APIService: API,
        });

        const serviceInstancesToInit = {
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
            keyValueDB: keyValueDB as unknown as KeyValueDBService<T>,
            control,
        };
        super(context, serviceInstancesToInit);
    }
}
