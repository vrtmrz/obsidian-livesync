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
import { reactiveSource } from "octagonal-wheels/dataobject/reactive";
import type { ReplicatorServiceDependencies } from "@vrtmrz/livesync-commonlib/compat/services/base/ReplicatorService";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";

type ActivityOptions = {
    label?: string;
};

type ObsidianReplicatorServiceDependencies = ReplicatorServiceDependencies & {
    isMobile: () => boolean;
};

type SleepPreferenceSettings = Pick<
    ObsidianLiveSyncSettings,
    "allowSleepDuringSynchronisation" | "allowSleepDuringSynchronisationOnDesktop"
>;

export function shouldAllowSleepDuringSynchronisation(settings: SleepPreferenceSettings, isMobile: boolean): boolean {
    return settings.allowSleepDuringSynchronisation || (!isMobile && settings.allowSleepDuringSynchronisationOnDesktop);
}

function withSleepPreference(dependencies: ObsidianReplicatorServiceDependencies): ReplicatorServiceDependencies {
    const activityRunner = dependencies.activityRunner;
    if (!activityRunner) return dependencies;
    return {
        ...dependencies,
        activityRunner: {
            async run<T>(task: () => T | PromiseLike<T>, options?: ActivityOptions): Promise<T> {
                const allowSleep = shouldAllowSleepDuringSynchronisation(
                    dependencies.settingService.currentSettings(),
                    dependencies.isMobile()
                );
                return allowSleep ? await task() : await activityRunner.run(task, options);
            },
        },
    };
}

export class ObsidianDatabaseEventService extends InjectableDatabaseEventService<ObsidianServiceContext> {}

// InjectableReplicatorService
export class ObsidianReplicatorService extends InjectableReplicatorService<ObsidianServiceContext> {
    readonly boundedLocalApplicationActivityCount = reactiveSource(0);

    constructor(context: ObsidianServiceContext, dependencies: ObsidianReplicatorServiceDependencies) {
        super(context, withSleepPreference(dependencies));
    }

    async runBoundedLocalApplicationActivity<T>(
        task: () => T | PromiseLike<T>,
        options?: ActivityOptions
    ): Promise<T> {
        this.boundedLocalApplicationActivityCount.value++;
        try {
            return this.dependencies.activityRunner
                ? await this.dependencies.activityRunner.run(task, options)
                : await task();
        } finally {
            this.boundedLocalApplicationActivityCount.value--;
        }
    }
}
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
