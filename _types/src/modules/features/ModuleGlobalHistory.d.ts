// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: ef1bdf0
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
export declare class ModuleObsidianGlobalHistory extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean>;
    showGlobalHistory(): void;
    onBindFunction(core: typeof this.core, services: typeof core.services): void;
}
