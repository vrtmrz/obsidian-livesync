// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { DevFeatureHost } from "./types.ts";
import type { DevFeatureState } from "./state.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
/**
 * Commits a log entry for missing translation keys inside local settings directory.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 * @param key - The missing translation key.
 */
export declare function onMissingTranslation(host: DevFeatureHost, log: LogFunction, key: string): Promise<void>;
/**
 * Automatically creates a conflicted revision for testing conflict resolution.
 *
 * @param host - The service feature host context.
 */
export declare function createConflict(host: DevFeatureHost): Promise<void>;
/**
 * Appends a test result to the Svelte writable store.
 *
 * @param state - The active feature state.
 * @param name - The test name or category.
 * @param key - The unique test identifier.
 * @param result - True if passed, false if failed.
 * @param summary - Optional summary message.
 * @param message - Optional detailed stacktrace or assertion info.
 */
export declare function addTestResult(state: DevFeatureState, name: string, key: string, result: boolean, summary?: string, message?: string): void;
