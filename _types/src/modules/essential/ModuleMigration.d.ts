// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { AbstractModule } from "@/modules/AbstractModule.ts";
import type { LiveSyncCore } from "@/main.ts";
export declare class ModuleMigration extends AbstractModule {
    migrateUsingDoctor(skipRebuild?: boolean, activateReason?: string, forceRescan?: boolean): Promise<boolean>;
    migrateDisableBulkSend(): Promise<void>;
    initialMessage(): Promise<boolean>;
    askAgainForSetupURI(): Promise<boolean>;
    hasIncompleteDocs(force?: boolean): Promise<boolean>;
    hasCompromisedChunks(): Promise<boolean>;
    _everyOnFirstInitialize(): Promise<boolean>;
    _everyOnLayoutReady(): Promise<boolean>;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
