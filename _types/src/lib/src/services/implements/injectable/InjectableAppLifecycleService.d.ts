import { AppLifecycleService } from "@lib/services/base/AppLifecycleService";
import type { IAppLifecycleService } from "@lib/services/base/IService";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
export declare abstract class AppLifecycleServiceBase<T extends ServiceContext> extends AppLifecycleService<T> {
    askRestart: import("@lib/services/lib/HandlerUtils").HandlerFunction<(message?: string) => void, any>;
    scheduleRestart: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => void, any>;
    isReloadingScheduled: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => boolean, any>;
}
export declare abstract class InjectableAppLifecycleService<T extends ServiceContext = ServiceContext> extends AppLifecycleServiceBase<T> implements IAppLifecycleService {
    performRestart: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => void, any>;
}
