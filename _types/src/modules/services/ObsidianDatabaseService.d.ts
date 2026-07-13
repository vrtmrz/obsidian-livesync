// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: ef1bdf0
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
import { DatabaseService, type DatabaseServiceDependencies } from "@lib/services/base/DatabaseService.ts";
export declare class ObsidianDatabaseService<T extends ObsidianServiceContext> extends DatabaseService<T> {
    private __onOpenDatabase;
    constructor(context: T, dependencies: DatabaseServiceDependencies);
}
