// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { createInstanceLogFunction } from "@lib/services/lib/logUtils";
import type { APIService } from "./APIService";
import type { DatabaseService } from "./DatabaseService";
import type { IControlService, IFileProcessingService, IReplicatorService, ISettingService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
import { type PromiseWithResolvers } from "octagonal-wheels/promises";
import type { AppLifecycleService } from "./AppLifecycleService";
export interface ControlServiceDependencies {
    appLifecycleService: AppLifecycleService;
    replicatorService: IReplicatorService;
    settingService: ISettingService;
    databaseService: DatabaseService;
    fileProcessingService: IFileProcessingService;
    APIService: APIService;
}
/**
 * The ControlService provides methods for controlling the overall behaviour of the plugin, such as applying settings or handling lifecycle events.
 */
export declare class ControlService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IControlService {
    protected services: ControlServiceDependencies;
    protected _log: ReturnType<typeof createInstanceLogFunction>;
    protected _unloaded: boolean;
    protected _activated: PromiseWithResolvers<boolean>;
    /**
     * Check if the plug-in has been unloaded.
     */
    hasUnloaded(): boolean;
    constructor(context: T, dependencies: ControlServiceDependencies);
    get activated(): Promise<boolean>;
    private onActivated;
    /**
     * Apply current settings to reflect the changes immediately.
     * @returns
     */
    applySettings(): Promise<void>;
    private _onLiveSyncUnload;
    /**
     * Called when the plugin is loaded. It will trigger the app lifecycle event onLoad.
     * Main process should be called in onReady.
     * @returns
     */
    onLoad(): Promise<boolean>;
    /**
     * Main entry point of the plugin. It will trigger the app lifecycle event onReady.
     * Usually it should be called on `app.workspace.onLayoutReady`
     * @returns
     */
    onReady(): Promise<boolean>;
    /**
     * On unload event of the plugin. It will trigger the app lifecycle event onUnload.
     * @returns
     */
    onUnload(): Promise<void>;
}
