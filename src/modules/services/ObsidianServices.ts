import { InjectableConflictService } from "@lib/services/implements/injectable/InjectableConflictService";
import { InjectableDatabaseEventService } from "@lib/services/implements/injectable/InjectableDatabaseEventService";
import { InjectableFileProcessingService } from "@lib/services/implements/injectable/InjectableFileProcessingService";
import { InjectableRemoteService } from "@lib/services/implements/injectable/InjectableRemoteService";
import { InjectableReplicationService } from "@lib/services/implements/injectable/InjectableReplicationService";
import { InjectableReplicatorService } from "@lib/services/implements/injectable/InjectableReplicatorService";
import { InjectableSettingService } from "@lib/services/implements/injectable/InjectableSettingService";
import { InjectableTestService } from "@lib/services/implements/injectable/InjectableTestService";
import { InjectableTweakValueService } from "@lib/services/implements/injectable/InjectableTweakValueService";
import { ConfigServiceBrowserCompat } from "@lib/services/implements/browser/ConfigServiceBrowserCompat";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext.ts";
import { KeyValueDBService } from "@/lib/src/services/base/KeyValueDBService";

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
// InjectableSettingService
export class ObsidianSettingService extends InjectableSettingService<ObsidianServiceContext> {}
// InjectableTweakValueService
export class ObsidianTweakValueService extends InjectableTweakValueService<ObsidianServiceContext> {}
// InjectableTestService
export class ObsidianTestService extends InjectableTestService<ObsidianServiceContext> {}
export class ObsidianConfigService extends ConfigServiceBrowserCompat<ObsidianServiceContext> {}

export class ObsidianKeyValueDBService extends KeyValueDBService<ObsidianServiceContext> {}
