// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { PeriodicProcessor } from "@/common/PeriodicProcessor";
import type { LiveSyncCore } from "@/main";
import { AbstractModule } from "@/modules/AbstractModule";
export declare class ModulePeriodicProcess extends AbstractModule {
    periodicSyncProcessor: PeriodicProcessor;
    disablePeriodic(): Promise<boolean>;
    resumePeriodic(): Promise<boolean>;
    private _allOnUnload;
    private _everyBeforeRealizeSetting;
    private _everyBeforeSuspendProcess;
    private _everyAfterResumeProcess;
    private _everyAfterRealizeSetting;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
