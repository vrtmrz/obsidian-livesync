import type { ServiceContext } from "../../base/ServiceBase";
import { KeyValueDBService } from "../../base/KeyValueDBService";
import { DatabaseService } from "@lib/services/base/DatabaseService.ts";
export declare class BrowserDatabaseService<T extends ServiceContext> extends DatabaseService<T> {
}
export declare class BrowserKeyValueDBService<T extends ServiceContext> extends KeyValueDBService<T> {
}
