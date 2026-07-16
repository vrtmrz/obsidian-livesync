// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 96033e1
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { KeyValueDBService } from "@lib/services/base/KeyValueDBService";
import { DatabaseService } from "@lib/services/base/DatabaseService.ts";
export declare class BrowserDatabaseService<T extends ServiceContext> extends DatabaseService<T> {
}
export declare class BrowserKeyValueDBService<T extends ServiceContext> extends KeyValueDBService<T> {
}
