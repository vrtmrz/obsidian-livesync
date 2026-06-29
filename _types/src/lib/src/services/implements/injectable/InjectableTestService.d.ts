// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { TestService } from "@lib/services/base/TestService";
export declare class InjectableTestService<T extends ServiceContext> extends TestService<T> {
    addTestResult: import("@lib/services/lib/HandlerUtils").HandlerFunction<(name: string, key: string, result: boolean, summary?: string, message?: string) => void, unknown>;
}
