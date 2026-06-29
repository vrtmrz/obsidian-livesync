// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type LOG_LEVEL } from "octagonal-wheels/common/logger";
import type { IAPIService } from "@lib/services/base/IService";
export declare const MARK_LOG_SEPARATOR = "\u200A";
export declare const MARK_LOG_NETWORK_ERROR = "\u200B";
/**
 * Creates a log function that prefixes messages with the service name and uses the provided APIService's addLog method if available.
 * If APIService is not provided, it falls back to using the global Logger function.
 * @param serviceName The name of the service to prefix log messages with.
 * @param APIService An optional APIService instance to use for logging.
 * @returns A log function that can be used to log messages with the specified service name and APIService.
 */
export declare function createInstanceLogFunction(serviceName: string, APIService?: IAPIService): (msg: unknown, level?: LOG_LEVEL, key?: string) => void;
export type LogFunction = ReturnType<typeof createInstanceLogFunction>;
