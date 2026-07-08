// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { ServiceContext } from "@lib/services/base/ServiceBase";
import { InjectableServiceHub } from "@lib/services/implements/injectable/InjectableServiceHub";
import type { DatabaseService } from "@lib/services/base/DatabaseService.ts";
import type { Constructor } from "@lib/common/utils.type";
export declare class HeadlessServiceHub<T extends ServiceContext> extends InjectableServiceHub<T> {
    constructor(_context?: T, overrideServiceConstructor?: {
        database?: Constructor<DatabaseService<T>>;
    });
}
