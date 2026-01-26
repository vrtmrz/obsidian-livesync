import { InjectableAPIService } from "@lib/services/implements/injectable/InjectableAPIService";
import { InjectableAppLifecycleService } from "@lib/services/implements/injectable/InjectableAppLifecycleService";
import { InjectableConflictService } from "@lib/services/implements/injectable/InjectableConflictService";
import { InjectableDatabaseEventService } from "@lib/services/implements/injectable/InjectableDatabaseEventService";
import { InjectableDatabaseService } from "@lib/services/implements/injectable/InjectableDatabaseService";
import { InjectableFileProcessingService } from "@lib/services/implements/injectable/InjectableFileProcessingService";
import { InjectablePathService } from "@lib/services/implements/injectable/InjectablePathService";
import { InjectableRemoteService } from "@lib/services/implements/injectable/InjectableRemoteService";
import { InjectableReplicationService } from "@lib/services/implements/injectable/InjectableReplicationService";
import { InjectableReplicatorService } from "@lib/services/implements/injectable/InjectableReplicatorService";
import { InjectableSettingService } from "@lib/services/implements/injectable/InjectableSettingService";
import { InjectableTestService } from "@lib/services/implements/injectable/InjectableTestService";
import { InjectableTweakValueService } from "@lib/services/implements/injectable/InjectableTweakValueService";
import { InjectableVaultService } from "@lib/services/implements/injectable/InjectableVaultService";
import { ConfigServiceBrowserCompat } from "@lib/services/implements/browser/ConfigServiceBrowserCompat";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext.ts";
import { Platform } from "@/deps";
import type { SimpleStore } from "@/lib/src/common/utils";
import type { IDatabaseService } from "@/lib/src/services/base/IService";
import { handlers } from "@/lib/src/services/lib/HandlerUtils";

// All Services will be migrated to be based on Plain Services, not Injectable Services.
// This is a migration step.

export class ObsidianAPIService extends InjectableAPIService<ObsidianServiceContext> {
    getPlatform(): string {
        if (Platform.isAndroidApp) {
            return "android-app";
        } else if (Platform.isIosApp) {
            return "ios";
        } else if (Platform.isMacOS) {
            return "macos";
        } else if (Platform.isMobileApp) {
            return "mobile-app";
        } else if (Platform.isMobile) {
            return "mobile";
        } else if (Platform.isSafari) {
            return "safari";
        } else if (Platform.isDesktop) {
            return "desktop";
        } else if (Platform.isDesktopApp) {
            return "desktop-app";
        } else {
            return "unknown-obsidian";
        }
    }
}
export class ObsidianPathService extends InjectablePathService<ObsidianServiceContext> {}
export class ObsidianDatabaseService extends InjectableDatabaseService<ObsidianServiceContext> {
    openSimpleStore = handlers<IDatabaseService>().binder("openSimpleStore") as (<T>(
        kind: string
    ) => SimpleStore<T>) & { setHandler: (handler: IDatabaseService["openSimpleStore"], override?: boolean) => void };
}
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
