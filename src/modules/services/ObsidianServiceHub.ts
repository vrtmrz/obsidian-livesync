import { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub.js";
import { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext.js";
import type { ServiceInstances } from "@vrtmrz/livesync-commonlib/compat/services/ServiceHub.js";
import type ObsidianLiveSyncPlugin from "@/main.js";
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
} from "./ObsidianServices.js";
import { ObsidianSettingService } from "./ObsidianSettingService.js";
import { ObsidianDatabaseService } from "./ObsidianDatabaseService.js";
import { ObsidianAPIService } from "./ObsidianAPIService.js";
import { ObsidianAppLifecycleService } from "./ObsidianAppLifecycleService.js";
import { ObsidianPathService } from "./ObsidianPathService.js";
import { ObsidianVaultService } from "./ObsidianVaultService.js";
import { ObsidianUIService } from "./ObsidianUIService.js";
import { createScreenWakeLockManager } from "octagonal-wheels/browser/wakeLock";
import { PouchDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/pouchdb-browser.js";
import { OpenKeyValueDatabase } from "@/common/KeyValueDB.js";
import { ObsidianNoticeGroupManager } from "./ObsidianNoticeGroups.js";
import { setLang } from "@/common/translation.js";

// InjectableServiceHub

export class ObsidianServiceHub extends InjectableServiceHub<ObsidianServiceContext> {
    constructor(plugin: ObsidianLiveSyncPlugin) {
        const noticeGroups = new ObsidianNoticeGroupManager();
        const context = new ObsidianServiceContext(plugin.app, plugin, plugin, noticeGroups);

        const API = new ObsidianAPIService(context);
        const conflict = new ObsidianConflictService(context);
        const fileProcessing = new ObsidianFileProcessingService(context);

        const tweakValue = new ObsidianTweakValueService(context);

        const setting = new ObsidianSettingService(context, {
            APIService: API,
            onDisplayLanguageChanged: setLang,
        });
        const appLifecycle = new ObsidianAppLifecycleService(context, {
            settingService: setting,
        });
        const remote = new ObsidianRemoteService(context, {
            pouchDB: PouchDB,
            APIService: API,
            appLifecycle: appLifecycle,
            setting: setting,
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
        const screenWakeLock = createScreenWakeLockManager();
        appLifecycle.onUnload.addHandler(async () => {
            await screenWakeLock.dispose();
            noticeGroups.dispose();
            return true;
        });
        const database = new ObsidianDatabaseService(context, {
            pouchDB: PouchDB,
            path: path,
            vault: vault,
            setting: setting,
            API: API,
        });
        const keyValueDB = new ObsidianKeyValueDBService(context, {
            openKeyValueDatabase: OpenKeyValueDatabase,
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
            activityRunner: screenWakeLock,
            isMobile: () => API.isMobile(),
        });
        const replication = new ObsidianReplicationService(context, {
            APIService: API,
            appLifecycleService: appLifecycle,
            replicatorService: replicator,
            settingService: setting,
            fileProcessingService: fileProcessing,
            databaseService: database,
        });

        const control = new ObsidianControlService(context, {
            appLifecycleService: appLifecycle,
            databaseService: database,
            fileProcessingService: fileProcessing,
            settingService: setting,
            APIService: API,
            replicatorService: replicator,
        });
        const ui = new ObsidianUIService(context, {
            appLifecycle,
            config,
            replicator,
            APIService: API,
            control: control,
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
