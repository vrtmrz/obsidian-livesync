// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: ef1bdf0
import type { LiveSyncCore } from "@/main";
import { AbstractModule } from "@/modules/AbstractModule";
export declare class ModuleBasicMenu extends AbstractModule {
    _everyOnloadStart(): Promise<boolean>;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
