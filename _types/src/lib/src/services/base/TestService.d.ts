// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ITestService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
/**
 * The TestService provides methods for adding and handling test results.
 */
export declare abstract class TestService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements ITestService {
    /**
     * Run the test suite to verify the plug-in's functionality.
     * This is typically used for development and debugging purposes.
     * It may involve user interaction (means raising resolveByUserInteraction).
     */
    readonly test: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Run the multi-device test suite to verify the plug-in's functionality across multiple devices.
     * This is typically used for development and debugging purposes.
     * It may involve user interaction (means raising resolveByUserInteraction).
     */
    readonly testMultiDevice: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Add a test result to the test suite.
     * @param name The name of the test case.
     * @param key The key of the test result.
     * @param result The result of the test (true for success, false for failure).
     * @param summary A brief summary of the test result.
     * @param message A detailed message about the test result.
     */
    abstract addTestResult(name: string, key: string, result: boolean, summary?: string, message?: string): void;
}
