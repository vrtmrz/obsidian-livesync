import { PeriodicProcessor } from "../../common/utils";
import type { LiveSyncCore } from "../../main";
import { AbstractModule } from "../AbstractModule";

export class ModulePeriodicProcess extends AbstractModule {
    periodicSyncProcessor = new PeriodicProcessor(this.core, async () => await this.services.replication.replicate());

    disablePeriodic() {
        this.periodicSyncProcessor?.disable();
        return Promise.resolve(true);
    }
    resumePeriodic() {
        this.periodicSyncProcessor.enable(
            this.settings.periodicReplication ? this.settings.periodicReplicationInterval * 1000 : 0
        );
        return Promise.resolve(true);
    }
    private _allOnUnload() {
        return this.disablePeriodic();
    }
    private _everyBeforeRealizeSetting(): Promise<boolean> {
        return this.disablePeriodic();
    }
    private _everyBeforeSuspendProcess(): Promise<boolean> {
        return this.disablePeriodic();
    }
    private _everyAfterResumeProcess(): Promise<boolean> {
        return this.resumePeriodic();
    }
    private _everyAfterRealizeSetting(): Promise<boolean> {
        return this.resumePeriodic();
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onUnload.addHandler(this._allOnUnload.bind(this));
        services.setting.onBeforeRealiseSetting.addHandler(this._everyBeforeRealizeSetting.bind(this));
        services.setting.onSettingRealised.addHandler(this._everyAfterRealizeSetting.bind(this));
        services.appLifecycle.onSuspending.addHandler(this._everyBeforeSuspendProcess.bind(this));
        services.appLifecycle.onResumed.addHandler(this._everyAfterResumeProcess.bind(this));
    }
}
