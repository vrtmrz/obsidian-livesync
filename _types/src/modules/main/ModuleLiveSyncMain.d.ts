// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { AbstractModule } from "@/modules/AbstractModule.ts";
import type { InjectableServiceHub } from "@lib/services/implements/injectable/InjectableServiceHub.ts";
import type { LiveSyncCore } from "@/main.ts";
export declare class ModuleLiveSyncMain extends AbstractModule {
    _onLiveSyncReady(): Promise<boolean>;
    _wireUpEvents(): Promise<boolean>;
    _onLiveSyncLoad(): Promise<boolean>;
    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void;
}
