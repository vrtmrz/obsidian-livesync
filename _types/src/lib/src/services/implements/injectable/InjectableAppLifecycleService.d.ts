// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { AppLifecycleService } from "@lib/services/base/AppLifecycleService";
import type { IAppLifecycleService } from "@lib/services/base/IService";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
export declare abstract class AppLifecycleServiceBase<T extends ServiceContext> extends AppLifecycleService<T> {
    askRestart: import("@lib/services/lib/HandlerUtils").HandlerFunction<(message?: string) => void, unknown>;
    scheduleRestart: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => void, unknown>;
    isReloadingScheduled: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => boolean, unknown>;
}
export declare abstract class InjectableAppLifecycleService<T extends ServiceContext = ServiceContext> extends AppLifecycleServiceBase<T> implements IAppLifecycleService {
    performRestart: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => void, unknown>;
}
