// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: f20eb19
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
export declare class ModuleObsidianGlobalHistory extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean>;
    showGlobalHistory(): void;
    onBindFunction(core: typeof this.core, services: typeof core.services): void;
}
