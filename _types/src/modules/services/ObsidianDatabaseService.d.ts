// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
import { DatabaseService, type DatabaseServiceDependencies } from "@lib/services/base/DatabaseService.ts";
export declare class ObsidianDatabaseService<T extends ObsidianServiceContext> extends DatabaseService<T> {
    private __onOpenDatabase;
    constructor(context: T, dependencies: DatabaseServiceDependencies);
}
