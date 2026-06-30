// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
import type { TFile } from "@/deps.ts";
import { type ReactiveSource } from "octagonal-wheels/dataobject/reactive";
import type { LiveSyncCore } from "@/main.ts";
export declare class ModuleObsidianEvents extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean>;
    __performAppReload(): void;
    initialCallback: (() => void) | undefined;
    swapSaveCommand(): void;
    registerWatchEvents(): void;
    hasFocus: boolean;
    isLastHidden: boolean;
    setHasFocus(hasFocus: boolean): void;
    watchWindowVisibility(): void;
    watchOnline(): void;
    watchOnlineAsync(): Promise<void>;
    watchWindowVisibilityAsync(): Promise<void>;
    watchWorkspaceOpen(file: TFile | null): void;
    watchWorkspaceOpenAsync(file: TFile): Promise<void>;
    _everyOnLayoutReady(): Promise<boolean>;
    private _askReload;
    _totalProcessingCount?: ReactiveSource<number>;
    private _scheduleAppReload;
    _isReloadingScheduled(): boolean;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
