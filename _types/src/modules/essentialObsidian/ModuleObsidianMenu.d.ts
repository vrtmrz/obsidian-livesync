// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LiveSyncCore } from "@/main.ts";
import { AbstractModule } from "@/modules/AbstractModule.ts";
export declare class ModuleObsidianMenu extends AbstractModule {
    _everyOnloadStart(): Promise<boolean>;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
