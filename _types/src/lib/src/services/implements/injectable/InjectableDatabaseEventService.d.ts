// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 96033e1
import { DatabaseEventService } from "@lib/services/base/DatabaseEventService";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
export declare class InjectableDatabaseEventService<T extends ServiceContext> extends DatabaseEventService<T> {
}
