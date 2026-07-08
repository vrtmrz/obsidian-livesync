// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import { type LOG_LEVEL } from "@lib/common/types.ts";
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
import { Notice } from "@/deps.ts";
import { P2PLogCollector } from "@lib/replication/trystero/P2PLogCollector.ts";
import type { LiveSyncCore } from "@/main.ts";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";
export declare const MARK_DONE = "\u2009\u2009";
export declare class ModuleLog extends AbstractObsidianModule {
    statusBar?: HTMLElement;
    statusDiv?: HTMLElement;
    statusLine?: HTMLDivElement;
    logMessage?: HTMLDivElement;
    logHistory?: HTMLDivElement;
    messageArea?: HTMLDivElement;
    statusBarLabels: ReactiveValue<{
        message: string;
        status: string;
    }>;
    statusLog: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<string>;
    activeFileStatus: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<string>;
    notifies: {
        [key: string]: {
            notice: Notice;
            count: number;
        };
    };
    p2pLogCollector: P2PLogCollector;
    observeForLogs(): void;
    private _everyOnload;
    adjustStatusDivPosition(): void;
    getActiveFileStatus(): Promise<string>;
    setFileStatus(): Promise<void>;
    updateMessageArea(): Promise<void>;
    onActiveLeafChange(): void;
    nextFrameQueue: ReturnType<typeof compatGlobal.requestAnimationFrame> | undefined;
    logLines: {
        ttl: number;
        message: string;
    }[];
    applyStatusBarText(): void;
    private _allStartOnUnload;
    _everyOnloadStart(): Promise<boolean>;
    private _everyOnloadAfterLoadSettings;
    writeLogToTheFile(now: Date, vaultName: string, newMessage: string): void;
    __addLog(message: unknown, level?: LOG_LEVEL, key?: string): void;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
