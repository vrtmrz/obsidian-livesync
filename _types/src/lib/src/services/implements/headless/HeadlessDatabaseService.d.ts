import { KeyValueDBService } from "../../base/KeyValueDBService";
import type { ServiceContext } from "../../base/ServiceBase";
import { DatabaseService } from "@lib/services/base/DatabaseService.ts";
export declare class HeadlessDatabaseService<T extends ServiceContext> extends DatabaseService<T> {
}
export declare class HeadlessKeyValueDBService<T extends ServiceContext> extends KeyValueDBService<T> {
}
