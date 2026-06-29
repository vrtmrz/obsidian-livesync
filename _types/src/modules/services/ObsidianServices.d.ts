// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { InjectableConflictService } from "@lib/services/implements/injectable/InjectableConflictService";
import { InjectableDatabaseEventService } from "@lib/services/implements/injectable/InjectableDatabaseEventService";
import { InjectableFileProcessingService } from "@lib/services/implements/injectable/InjectableFileProcessingService";
import { InjectableRemoteService } from "@lib/services/implements/injectable/InjectableRemoteService";
import { InjectableReplicationService } from "@lib/services/implements/injectable/InjectableReplicationService";
import { InjectableReplicatorService } from "@lib/services/implements/injectable/InjectableReplicatorService";
import { InjectableTestService } from "@lib/services/implements/injectable/InjectableTestService";
import { InjectableTweakValueService } from "@lib/services/implements/injectable/InjectableTweakValueService";
import { ConfigServiceBrowserCompat } from "@lib/services/implements/browser/ConfigServiceBrowserCompat";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext.ts";
import { KeyValueDBService } from "@lib/services/base/KeyValueDBService";
import { ControlService } from "@lib/services/base/ControlService";
export declare class ObsidianDatabaseEventService extends InjectableDatabaseEventService<ObsidianServiceContext> {
}
export declare class ObsidianReplicatorService extends InjectableReplicatorService<ObsidianServiceContext> {
}
export declare class ObsidianFileProcessingService extends InjectableFileProcessingService<ObsidianServiceContext> {
}
export declare class ObsidianReplicationService extends InjectableReplicationService<ObsidianServiceContext> {
}
export declare class ObsidianRemoteService extends InjectableRemoteService<ObsidianServiceContext> {
}
export declare class ObsidianConflictService extends InjectableConflictService<ObsidianServiceContext> {
}
export declare class ObsidianTweakValueService extends InjectableTweakValueService<ObsidianServiceContext> {
}
export declare class ObsidianTestService extends InjectableTestService<ObsidianServiceContext> {
}
export declare class ObsidianConfigService extends ConfigServiceBrowserCompat<ObsidianServiceContext> {
}
export declare class ObsidianKeyValueDBService extends KeyValueDBService<ObsidianServiceContext> {
}
export declare class ObsidianControlService extends ControlService<ObsidianServiceContext> {
}
