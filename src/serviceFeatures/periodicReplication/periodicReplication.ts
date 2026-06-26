import { PeriodicProcessor } from "@/common/PeriodicProcessor";
import { type NecessaryObsidianFeature } from "@/types";

export type PeriodicReplicationHost = NecessaryObsidianFeature<
    "appLifecycle" | "setting" | "replication" | "control" | "API"
>;

export const disablePeriodicHandler = (processor: PeriodicProcessor | undefined) => {
    processor?.disable();
    return Promise.resolve(true);
};

export const resumePeriodicHandler = (host: PeriodicReplicationHost, processor: PeriodicProcessor) => {
    const settings = host.services.setting.settings;
    processor.enable(settings.periodicReplication ? settings.periodicReplicationInterval * 1000 : 0);
    return Promise.resolve(true);
};

export function usePeriodicReplication(host: PeriodicReplicationHost) {
    const { services } = host;

    const periodicSyncProcessor = new PeriodicProcessor(host, async () => await services.replication.replicate());

    const disablePeriodic = disablePeriodicHandler.bind(null, periodicSyncProcessor);
    const resumePeriodic = resumePeriodicHandler.bind(null, host, periodicSyncProcessor);

    services.appLifecycle.onUnload.addHandler(disablePeriodic);
    services.setting.onBeforeRealiseSetting.addHandler(disablePeriodic);
    services.setting.onSettingRealised.addHandler(resumePeriodic);
    services.appLifecycle.onSuspending.addHandler(disablePeriodic);
    services.appLifecycle.onResumed.addHandler(resumePeriodic);

    return {
        disablePeriodic,
        resumePeriodic,
    };
}
