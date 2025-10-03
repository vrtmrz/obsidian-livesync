import { PeriodicProcessor } from "../../common/utils";
import type { LiveSyncCore } from "../../main";
import { AbstractModule } from "../AbstractModule";

export class ModulePeriodicProcess extends AbstractModule {
    periodicSyncProcessor = new PeriodicProcessor(this.core, async () => await this.services.replication.replicate());

    _disablePeriodic() {
        this.periodicSyncProcessor?.disable();
        return Promise.resolve(true);
    }
    _resumePeriodic() {
        this.periodicSyncProcessor.enable(
            this.settings.periodicReplication ? this.settings.periodicReplicationInterval * 1000 : 0
        );
        return Promise.resolve(true);
    }
    private _allOnUnload() {
        return this._disablePeriodic();
    }
    _everyBeforeRealizeSetting(): Promise<boolean> {
        return this._disablePeriodic();
    }
    _everyBeforeSuspendProcess(): Promise<boolean> {
        return this._disablePeriodic();
    }
    _everyAfterResumeProcess(): Promise<boolean> {
        return this._resumePeriodic();
    }
    _everyAfterRealizeSetting(): Promise<boolean> {
        return this._resumePeriodic();
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.handleOnUnload(this._allOnUnload.bind(this));
        services.setting.handleBeforeRealiseSetting(this._everyBeforeRealizeSetting.bind(this));
        services.setting.handleSettingRealised(this._everyAfterRealizeSetting.bind(this));
        services.appLifecycle.handleOnSuspending(this._everyBeforeSuspendProcess.bind(this));
        services.appLifecycle.handleOnResumed(this._everyAfterResumeProcess.bind(this));
    }
}
