import { InjectableVaultServiceCompat } from "./implements/injectable/InjectableVaultService";
import { ServiceContext } from "./base/ServiceBase";
import { InjectableServiceHub } from "./implements/injectable/InjectableServiceHub";
export declare class BrowserServiceHub<T extends ServiceContext> extends InjectableServiceHub<T> {
    get vault(): InjectableVaultServiceCompat<T>;
    constructor();
}
