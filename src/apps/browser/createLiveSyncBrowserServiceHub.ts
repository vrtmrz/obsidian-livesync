import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { KeyValueDatabaseFactory } from "@vrtmrz/livesync-commonlib/compat/interfaces/KeyValueDatabase";
import { PouchDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/pouchdb-browser";
import { ConfigService } from "@vrtmrz/livesync-commonlib/compat/services/base/ConfigService";
import { ControlService } from "@vrtmrz/livesync-commonlib/compat/services/base/ControlService";
import { DatabaseService } from "@vrtmrz/livesync-commonlib/compat/services/base/DatabaseService";
import { KeyValueDBService } from "@vrtmrz/livesync-commonlib/compat/services/base/KeyValueDBService";
import type { ISettingService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { InjectableAppLifecycleService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableAppLifecycleService";
import { InjectableConflictService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableConflictService";
import { InjectableDatabaseEventService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableDatabaseEventService";
import { InjectableFileProcessingService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableFileProcessingService";
import { PathServiceCompat } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectablePathService";
import { InjectableRemoteService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableRemoteService";
import { InjectableReplicationService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableReplicationService";
import { InjectableReplicatorService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableReplicatorService";
import { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";
import { InjectableSettingService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableSettingService";
import { InjectableTestService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableTestService";
import { InjectableTweakValueService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableTweakValueService";
import { InjectableVaultServiceCompat } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableVaultService";

import { setLang, translateLiveSyncMessage } from "@/common/translation";
import { BrowserConfirm } from "./BrowserConfirm";
import { createBrowserKeyValueDatabaseFactory } from "./BrowserKeyValueDatabase";
import {
    LiveSyncBrowserAPIService,
    type LiveSyncBrowserAPIServiceOptions,
} from "./LiveSyncBrowserAPIService";
import { LiveSyncBrowserUIService } from "./LiveSyncBrowserUIService";

export interface LiveSyncBrowserSettingsPersistence {
    load(): Promise<ObsidianLiveSyncSettings | undefined>;
    save(settings: ObsidianLiveSyncSettings): Promise<void>;
}

export interface LiveSyncBrowserRestartPolicy {
    schedule(): void;
    perform?: () => void;
    ask?: (message?: string) => void;
    isScheduled?: () => boolean;
}

export interface LiveSyncBrowserServiceHubOptions<T extends ServiceContext> {
    context?: T;
    getSystemVaultName?: () => string;
    settings?: LiveSyncBrowserSettingsPersistence;
    restart?: LiveSyncBrowserRestartPolicy;
    openKeyValueDatabase?: KeyValueDatabaseFactory;
    API?: Omit<LiveSyncBrowserAPIServiceOptions, "confirm" | "getSystemVaultName">;
}

class LiveSyncBrowserAppLifecycleService<
    T extends ServiceContext,
> extends InjectableAppLifecycleService<T> {}

class LiveSyncBrowserDatabaseService<T extends ServiceContext> extends DatabaseService<T> {}

class LiveSyncBrowserKeyValueDBService<T extends ServiceContext> extends KeyValueDBService<T> {}

class LiveSyncBrowserConfigService<T extends ServiceContext> extends ConfigService<T> {
    constructor(
        context: T,
        private readonly setting: ISettingService
    ) {
        super(context);
    }

    getSmallConfig(key: string): string | null {
        return this.setting.getSmallConfig(key);
    }

    setSmallConfig(key: string, value: string): void {
        this.setting.setSmallConfig(key, value);
    }

    deleteSmallConfig(key: string): void {
        this.setting.deleteSmallConfig(key);
    }
}

/** LiveSync-owned service composition shared by WebApp and WebPeer. */
export class LiveSyncBrowserServiceHub<T extends ServiceContext> extends InjectableServiceHub<T> {
    constructor(options: LiveSyncBrowserServiceHubOptions<T>) {
        const context =
            options.context ??
            (new ServiceContext({
                translate: translateLiveSyncMessage,
            }) as T);
        const API = new LiveSyncBrowserAPIService(context, {
            ...options.API,
            confirm: new BrowserConfirm(context),
            getSystemVaultName: options.getSystemVaultName ?? (() => "livesync-browser"),
        });
        const conflict = new InjectableConflictService(context);
        const fileProcessing = new InjectableFileProcessingService(context);
        const setting = new InjectableSettingService(context, {
            APIService: API,
            onDisplayLanguageChanged: setLang,
        });
        const settingsPersistence = options.settings;
        setting.loadData.setHandler(
            settingsPersistence
                ? () => settingsPersistence.load()
                : () => Promise.resolve(undefined)
        );
        setting.saveData.setHandler(
            settingsPersistence
                ? (settings) => settingsPersistence.save(settings)
                : () => Promise.resolve()
        );

        const appLifecycle = new LiveSyncBrowserAppLifecycleService(context, {
            settingService: setting,
        });
        const restartPolicy = options.restart;
        const scheduleRestart = restartPolicy ? () => restartPolicy.schedule() : () => {};
        appLifecycle.scheduleRestart.setHandler(scheduleRestart);
        appLifecycle.performRestart.setHandler(
            restartPolicy?.perform ? () => restartPolicy.perform?.() : scheduleRestart
        );
        appLifecycle.askRestart.setHandler(
            restartPolicy?.ask ? (message) => restartPolicy.ask?.(message) : scheduleRestart
        );
        appLifecycle.isReloadingScheduled.setHandler(
            restartPolicy?.isScheduled ? () => restartPolicy.isScheduled?.() ?? false : () => false
        );

        const databaseEvents = new InjectableDatabaseEventService(context);
        const path = new PathServiceCompat(context, {
            settingService: setting,
        });
        const vault = new InjectableVaultServiceCompat(context, {
            settingService: setting,
            APIService: API,
        });
        const database = new LiveSyncBrowserDatabaseService(context, {
            pouchDB: PouchDB,
            path,
            vault,
            setting,
            API,
        });
        const config = new LiveSyncBrowserConfigService(context, setting);
        const replicator = new InjectableReplicatorService(context, {
            settingService: setting,
            appLifecycleService: appLifecycle,
            databaseEventService: databaseEvents,
        });
        const remote = new InjectableRemoteService(context, {
            pouchDB: PouchDB,
            APIService: API,
            appLifecycle,
            setting,
        });
        const replication = new InjectableReplicationService(context, {
            APIService: API,
            appLifecycleService: appLifecycle,
            replicatorService: replicator,
            settingService: setting,
            fileProcessingService: fileProcessing,
            databaseService: database,
        });
        const keyValueDB = new LiveSyncBrowserKeyValueDBService(context, {
            openKeyValueDatabase:
                options.openKeyValueDatabase ?? createBrowserKeyValueDatabaseFactory(),
            appLifecycle,
            databaseEvents,
            vault,
        });
        const control = new ControlService(context, {
            appLifecycleService: appLifecycle,
            databaseService: database,
            fileProcessingService: fileProcessing,
            settingService: setting,
            APIService: API,
            replicatorService: replicator,
        });
        const ui = new LiveSyncBrowserUIService(context, {
            API,
            appLifecycle,
            config,
            control,
            replicator,
        });

        super(context, {
            API,
            appLifecycle,
            conflict,
            config,
            control,
            database,
            databaseEvents,
            fileProcessing,
            keyValueDB,
            path,
            remote,
            replication,
            replicator,
            setting,
            test: new InjectableTestService(context),
            tweakValue: new InjectableTweakValueService(context),
            ui,
            vault,
        });
    }
}

export function createLiveSyncBrowserServiceHub<T extends ServiceContext>(
    options: LiveSyncBrowserServiceHubOptions<T> = {}
): LiveSyncBrowserServiceHub<T> {
    return new LiveSyncBrowserServiceHub(options);
}
