import { ServiceContext } from "./base/ServiceBase";
import { InjectableServiceHub } from "./implements/injectable/InjectableServiceHub";
import type { DatabaseService } from "./base/DatabaseService.ts";
type Constructor<T> = new (...args: any[]) => T; // eslint-disable-line @typescript-eslint/no-explicit-any
export declare class HeadlessServiceHub<T extends ServiceContext> extends InjectableServiceHub<T> {
    constructor(_context?: T, overrideServiceConstructor?: {
        database?: Constructor<DatabaseService<T>>;
    });
}
export {};
