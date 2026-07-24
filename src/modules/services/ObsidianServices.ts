import { InjectableConflictService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableConflictService";
import { InjectableDatabaseEventService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableDatabaseEventService";
import { InjectableFileProcessingService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableFileProcessingService";
import { InjectableRemoteService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableRemoteService";
import { InjectableReplicationService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableReplicationService";
import { InjectableReplicatorService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableReplicatorService";
import { InjectableTestService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableTestService";
import { InjectableTweakValueService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableTweakValueService";
import { ConfigServiceBrowserCompat } from "@vrtmrz/livesync-commonlib/compat/services/implements/browser/ConfigServiceBrowserCompat";
import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext";
import { KeyValueDBService } from "@vrtmrz/livesync-commonlib/compat/services/base/KeyValueDBService";
import { ControlService } from "@vrtmrz/livesync-commonlib/compat/services/base/ControlService";

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
// InjectableTweakValueService
export class ObsidianTweakValueService extends InjectableTweakValueService<ObsidianServiceContext> {}
// InjectableTestService
export class ObsidianTestService extends InjectableTestService<ObsidianServiceContext> {}
export class ObsidianConfigService extends ConfigServiceBrowserCompat<ObsidianServiceContext> {}

export class ObsidianKeyValueDBService extends KeyValueDBService<ObsidianServiceContext> {}

export class ObsidianControlService extends ControlService<ObsidianServiceContext> {}
