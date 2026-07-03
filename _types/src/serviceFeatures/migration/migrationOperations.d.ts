// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { MigrationHost } from "./types.ts";
export declare function migrateUsingDoctor(host: MigrationHost, skipRebuild?: boolean, activateReason?: string, forceRescan?: boolean): Promise<boolean>;
export declare function migrateDisableBulkSend(host: MigrationHost, log: LogFunction): Promise<void>;
export declare function initialMigrationMessage(): Promise<boolean>;
export declare function askAgainForSetupURI(host: MigrationHost): Promise<boolean>;
export declare function hasIncompleteDocs(host: MigrationHost, log: LogFunction, force?: boolean): Promise<boolean>;
export declare function hasCompromisedChunks(host: MigrationHost, log: LogFunction): Promise<boolean>;
export declare function runFirstInitialiseMigration(host: MigrationHost, log: LogFunction): Promise<boolean>;
export declare function bindMigrationRequestEvents(host: MigrationHost, log: LogFunction): Promise<boolean>;
