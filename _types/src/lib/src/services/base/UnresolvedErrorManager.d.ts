// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type LOG_LEVEL } from "octagonal-wheels/common/logger";
import type { AppLifecycleService } from "./AppLifecycleService";
export declare class UnresolvedErrorManager {
    private _log;
    private appLifecycleService;
    private _occurredErrors;
    showError(msg: string, max_log_level?: LOG_LEVEL): void;
    clearError(msg: string): void;
    clearErrors(): void;
    countErrors(needle: string): number;
    private _reportUnresolvedMessages;
    constructor(appLifecycleService: AppLifecycleService);
}
