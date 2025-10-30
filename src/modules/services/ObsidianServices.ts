import {
    InjectableAPIService,
    InjectableAppLifecycleService,
    InjectableConflictService,
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
// All Services will be migrated to be based on Plain Services, not Injectable Services.
// This is a migration step.

export class ObsidianAPIService extends InjectableAPIService {
    getPlatform(): string {
        return "obsidian";
    }
}
export class ObsidianPathService extends InjectablePathService {}
export class ObsidianDatabaseService extends InjectableDatabaseService {}

// InjectableReplicatorService
export class ObsidianReplicatorService extends InjectableReplicatorService {}
// InjectableFileProcessingService
export class ObsidianFileProcessingService extends InjectableFileProcessingService {}
// InjectableReplicationService
export class ObsidianReplicationService extends InjectableReplicationService {}
// InjectableRemoteService
export class ObsidianRemoteService extends InjectableRemoteService {}
// InjectableConflictService
export class ObsidianConflictService extends InjectableConflictService {}
// InjectableAppLifecycleService
export class ObsidianAppLifecycleService extends InjectableAppLifecycleService {}
// InjectableSettingService
export class ObsidianSettingService extends InjectableSettingService {}
// InjectableTweakValueService
export class ObsidianTweakValueService extends InjectableTweakValueService {}
// InjectableVaultService
export class ObsidianVaultService extends InjectableVaultService {}
// InjectableTestService
export class ObsidianTestService extends InjectableTestService {}

export class ObsidianConfigService extends ConfigServiceBrowserCompat {}

// InjectableServiceHub

export class ObsidianServiceHub extends InjectableServiceHub {
    protected _api: ObsidianAPIService = new ObsidianAPIService(this._serviceBackend, this._throughHole);
    protected _path: ObsidianPathService = new ObsidianPathService(this._serviceBackend, this._throughHole);
    protected _database: ObsidianDatabaseService = new ObsidianDatabaseService(this._serviceBackend, this._throughHole);
    protected _replicator: ObsidianReplicatorService = new ObsidianReplicatorService(
        this._serviceBackend,
        this._throughHole
    );
    protected _fileProcessing: ObsidianFileProcessingService = new ObsidianFileProcessingService(
        this._serviceBackend,
        this._throughHole
    );
    protected _replication: ObsidianReplicationService = new ObsidianReplicationService(
        this._serviceBackend,
        this._throughHole
    );
    protected _remote: ObsidianRemoteService = new ObsidianRemoteService(this._serviceBackend, this._throughHole);
    protected _conflict: ObsidianConflictService = new ObsidianConflictService(this._serviceBackend, this._throughHole);
    protected _appLifecycle: ObsidianAppLifecycleService = new ObsidianAppLifecycleService(
        this._serviceBackend,
        this._throughHole
    );
    protected _setting: ObsidianSettingService = new ObsidianSettingService(this._serviceBackend, this._throughHole);
    protected _tweakValue: ObsidianTweakValueService = new ObsidianTweakValueService(
        this._serviceBackend,
        this._throughHole
    );
    protected _vault: ObsidianVaultService = new ObsidianVaultService(this._serviceBackend, this._throughHole);
    protected _test: ObsidianTestService = new ObsidianTestService(this._serviceBackend, this._throughHole);

    private _plugin: ObsidianLiveSyncPlugin;
    constructor(plugin: ObsidianLiveSyncPlugin) {
        const config = new ObsidianConfigService();
        super({
            ui: new ObsidianUIService(plugin),
            config: config,
        });
        this._plugin = plugin;
    }
}
