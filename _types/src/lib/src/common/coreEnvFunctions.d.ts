// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { getLanguage as ObsidianGetLanguage } from "obsidian";
export declare function setGetLanguage(func: typeof ObsidianGetLanguage): void;
export declare function getLanguage(): string;
export declare const compatGlobal: typeof window;
export type CompatTimeoutHandle = ReturnType<typeof setTimeout> | number;
export type CompatIntervalHandle = ReturnType<typeof setInterval> | number;
/**
 * A wrapper around the global fetch function to ensure compatibility across different environments.
 * In Obsidian, they recommend using their own requestUrl for better performance and reliability.
 * However, at least for now, requestUrl cannot handle multiple concurrent requests, which causes
 * problems for synchronise lively. So we will use the global fetch for now.
 * If the situation changes in the future, change this function to use requestUrl.
 * @param {RequestInfo} input  The resource that you wish to fetch. Can be either a string or a Request object.
 * @param {RequestInit} [init] An options object containing any custom settings that you want to apply to the request.
 * @returns {Promise<Response>} A Promise that resolves to the Response to that request, whether it is successful or not.
 */
export declare const _fetch: {
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
} & typeof fetch;
export declare const _activeDocument: Document;
