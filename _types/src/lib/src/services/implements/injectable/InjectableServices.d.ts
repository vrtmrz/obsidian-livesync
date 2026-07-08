// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ServiceInstances } from "@lib/services/ServiceHub.ts";
import type { UIService } from "@lib/services/implements/base/UIService.ts";
import type { ConfigService } from "@lib/services/base/ConfigService.ts";
import type { ServiceContext } from "@lib/services/base/ServiceBase.ts";
import type { InjectableAPIService } from "./InjectableAPIService";
import type { InjectableDatabaseEventService } from "./InjectableDatabaseEventService";
import type { InjectableReplicatorService } from "./InjectableReplicatorService";
import type { InjectableFileProcessingService } from "./InjectableFileProcessingService";
import type { InjectableReplicationService } from "./InjectableReplicationService";
import type { InjectableRemoteService } from "./InjectableRemoteService";
import type { InjectableConflictService } from "./InjectableConflictService";
import type { AppLifecycleServiceBase } from "./InjectableAppLifecycleService";
import type { InjectableTweakValueService } from "./InjectableTweakValueService";
import type { InjectableVaultService } from "./InjectableVaultService";
import type { InjectableTestService } from "./InjectableTestService";
import type { PathService } from "@lib/services/base/PathService";
import type { DatabaseService } from "@lib/services/base/DatabaseService.ts";
import type { SettingService } from "@lib/services/base/SettingService";
export type InjectableServiceInstances<T extends ServiceContext> = ServiceInstances<T> & {
    API?: InjectableAPIService<T>;
    path?: PathService<T>;
    database?: DatabaseService<T>;
    databaseEvents?: InjectableDatabaseEventService<T>;
    replicator?: InjectableReplicatorService<T>;
    fileProcessing?: InjectableFileProcessingService<T>;
    replication?: InjectableReplicationService<T>;
    remote?: InjectableRemoteService<T>;
    conflict?: InjectableConflictService<T>;
    appLifecycle?: AppLifecycleServiceBase<T>;
    setting?: SettingService<T>;
    tweakValue?: InjectableTweakValueService<T>;
    vault?: InjectableVaultService<T>;
    test?: InjectableTestService<T>;
    ui?: UIService<T>;
    config?: ConfigService<T>;
};
