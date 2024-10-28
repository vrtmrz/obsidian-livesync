import { PeriodicProcessor } from "../../common/utils";
import { AbstractModule } from "../AbstractModule";
import type { ICoreModule } from "../ModuleTypes";

export class ModulePeriodicProcess extends AbstractModule implements ICoreModule {

    periodicSyncProcessor = new PeriodicProcessor(this.core, async () => await this.core.$$replicate());

    _disablePeriodic() {
        this.periodicSyncProcessor?.disable();
        return Promise.resolve(true);
    }
    _resumePeriodic() {
        this.periodicSyncProcessor.enable(this.settings.periodicReplication ? this.settings.periodicReplicationInterval * 1000 : 0);
        return Promise.resolve(true);
    }
    $allOnUnload() {
        return this._disablePeriodic();

    }
    $everyBeforeRealizeSetting(): Promise<boolean> {
        return this._disablePeriodic();

    }
    $everyBeforeSuspendProcess(): Promise<boolean> {
        return this._disablePeriodic();

    }
    $everyAfterResumeProcess(): Promise<boolean> {
        return this._resumePeriodic();
    }
    $everyAfterRealizeSetting(): Promise<boolean> {
        return this._resumePeriodic();
    }
}