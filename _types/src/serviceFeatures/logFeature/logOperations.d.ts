// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type LOG_LEVEL } from "@lib/common/types.ts";
import type { LogFeatureHost } from "./types.ts";
import type { LogFeatureState } from "./state.ts";
export declare const MARK_DONE = "\u2009\u2009";
export declare function addLog(state: LogFeatureState, log: string): void;
export declare function addDisplayLog(state: LogFeatureState, log: string): void;
export declare function redactLog(log: string): string;
export declare function writeLogToTheFile(host: LogFeatureHost, now: Date, vaultName: string, newMessage: string): void;
export declare function processAddLog(host: LogFeatureHost, state: LogFeatureState, message: unknown, level?: LOG_LEVEL, key?: string): void;
export declare function adjustStatusDivPosition(host: LogFeatureHost, state: LogFeatureState): void;
export declare function getActiveFileStatus(host: LogFeatureHost): Promise<string>;
export declare function setFileStatus(host: LogFeatureHost, state: LogFeatureState): Promise<void>;
export declare function updateMessageArea(host: LogFeatureHost, state: LogFeatureState): Promise<void>;
export declare function onActiveLeafChange(host: LogFeatureHost, state: LogFeatureState): void;
export declare function applyStatusBarText(host: LogFeatureHost, state: LogFeatureState): void;
export declare function observeForLogs(host: LogFeatureHost, state: LogFeatureState): void;
