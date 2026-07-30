/** Browser runtime for Self-hosted LiveSync over the File System Access API. */

import { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { ServiceContext, type LiveSyncEventHub } from "@vrtmrz/livesync-commonlib/context";
import { initialiseServiceModulesFSAPI, type FSAPIServiceModules } from "./serviceModules/FSAPIServiceModules";
import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type LOG_LEVEL,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    collectFilesOnStorage,
    updateToDatabase,
    useOfflineScanner,
} from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
import { useRedFlagFeatures } from "@/serviceFeatures/redFlag";
import { useCheckRemoteSize } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/checkRemoteSize";
import { useRemoteConfiguration } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/remoteConfig";
import { useP2PReplicatorFeature } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/useP2PReplicatorFeature";
import type { UseP2PReplicatorResult } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/UseP2PReplicatorResult";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import {
    createLiveSyncBrowserServiceHub,
    type LiveSyncBrowserServiceHub,
    type LiveSyncBrowserServiceHubOptions,
} from "@/apps/browser/createLiveSyncBrowserServiceHub";
import type { P2PReplicatorPaneHost } from "@/features/P2PSync/P2PReplicator/P2PReplicatorPaneHost";

const SETTINGS_DIR = ".livesync";
const SETTINGS_FILE = "settings.json";

const DEFAULT_SETTINGS: Partial<ObsidianLiveSyncSettings> = {
    liveSync: false,
    syncOnSave: true,
    syncOnStart: false,
    savingDelay: 200,
    lessInformationInLog: false,
    gcDelay: 0,
    periodicReplication: false,
    periodicReplicationInterval: 60,
    isConfigured: false,
    // CouchDB settings - user needs to configure these
    couchDB_URI: "",
    couchDB_USER: "",
    couchDB_PASSWORD: "",
    couchDB_DBNAME: "",
    // Disable features which are not available in the WebApp.
    usePluginSync: false,
    autoSweepPlugins: false,
    autoSweepPluginsPeriodic: false,
};

export type WebAppRuntimeStatusKind = "info" | "warning" | "error" | "success";

export interface WebAppRuntimeOptions {
    reportStatus?: (kind: WebAppRuntimeStatusKind, message: string) => void;
    scheduleReload?: (delayMilliseconds: number) => void;
}

export class WebAppRuntime {
    private readonly rootHandle: FileSystemDirectoryHandle;
    private readonly reportStatus: NonNullable<WebAppRuntimeOptions["reportStatus"]>;
    private readonly scheduleReload: NonNullable<WebAppRuntimeOptions["scheduleReload"]>;
    private core: LiveSyncBaseCore<ServiceContext, never> | null = null;
    private serviceHub: LiveSyncBrowserServiceHub<ServiceContext> | null = null;
    private platformServiceModules: FSAPIServiceModules | null = null;
    private p2p: UseP2PReplicatorResult | null = null;
    private paneHost: P2PReplicatorPaneHost | null = null;
    private restartScheduled = false;

    constructor(rootHandle: FileSystemDirectoryHandle, options: WebAppRuntimeOptions = {}) {
        this.rootHandle = rootHandle;
        this.reportStatus = options.reportStatus ?? (() => {});
        this.scheduleReload =
            options.scheduleReload ??
            ((delayMilliseconds) => {
                compatGlobal.setTimeout(() => {
                    compatGlobal.location.reload();
                }, delayMilliseconds);
            });
    }

    private addLog(message: unknown, level: LOG_LEVEL = LOG_LEVEL_INFO, key?: string): void {
        this.serviceHub?.API.addLog(message, level, key);
    }

    private createServiceOptions(): LiveSyncBrowserServiceHubOptions<ServiceContext> {
        return {
            getSystemVaultName: () => this.rootHandle.name || "livesync-webapp",
            settings: {
                save: async (data) => {
                    try {
                        await this.saveSettingsToFile(data);
                        this.addLog("Saved to .livesync/settings.json", LOG_LEVEL_VERBOSE, "settings");
                    } catch (error) {
                        this.addLog(`Failed to save settings: ${String(error)}`, LOG_LEVEL_NOTICE, "settings");
                    }
                },
                load: async () => {
                    try {
                        const data = await this.loadSettingsFromFile();
                        if (data) {
                            this.addLog("Loaded from .livesync/settings.json", LOG_LEVEL_VERBOSE, "settings");
                            return { ...DEFAULT_SETTINGS, ...data } as ObsidianLiveSyncSettings;
                        }
                    } catch {
                        this.addLog("Failed to load settings; using defaults", LOG_LEVEL_NOTICE, "settings");
                    }
                    return DEFAULT_SETTINGS as ObsidianLiveSyncSettings;
                },
            },
            restart: {
                schedule: () => this.scheduleRestart(),
                perform: () => this.scheduleRestart(),
                ask: () => this.scheduleRestart(),
                isScheduled: () => this.restartScheduled,
            },
        };
    }

    private scheduleRestart(): void {
        if (this.restartScheduled) {
            return;
        }
        this.restartScheduled = true;
        void (async () => {
            this.addLog("Restart requested", LOG_LEVEL_INFO, "app-lifecycle");
            await this.shutdown();
            this.scheduleReload(1000);
        })();
    }

    get events(): LiveSyncEventHub {
        if (!this.serviceHub) {
            throw new Error("The WebApp service hub is not initialised");
        }
        return this.serviceHub.context.events;
    }

    get p2pPaneHost(): P2PReplicatorPaneHost {
        if (!this.paneHost) {
            throw new Error("The WebApp P2P pane host is not initialised");
        }
        return this.paneHost;
    }

    async scanLocalFiles(): Promise<boolean> {
        const core = this.core;
        const fileAccess = this.platformServiceModules?.vaultAccess;
        if (!core || !fileAccess) {
            throw new Error("The WebApp core is not initialised");
        }

        fileAccess.fsapiAdapter.clearCache();
        await fileAccess.fsapiAdapter.scanDirectory();

        const log = (message: unknown, level: LOG_LEVEL = LOG_LEVEL_INFO, key?: string): void => {
            this.addLog(message, level, key);
        };
        const settings = core.services.setting.currentSettings();
        const { storageFileNameMap, storageFileNames } = await collectFilesOnStorage(core, settings, log);

        let succeeded = true;
        for (const path of storageFileNames) {
            try {
                await updateToDatabase(core, log, LOG_LEVEL_INFO, storageFileNameMap[path]);
            } catch (error) {
                succeeded = false;
                this.addLog(`Failed to import ${path}: ${String(error)}`, LOG_LEVEL_NOTICE, "scan");
            }
        }
        return succeeded;
    }

    async start(): Promise<void> {
        if (this.core) {
            throw new Error("The WebApp runtime has already been started");
        }

        // Create service context and hub
        this.serviceHub = createLiveSyncBrowserServiceHub<ServiceContext>(this.createServiceOptions());
        this.addLog("Self-hosted LiveSync WebApp", LOG_LEVEL_INFO, "initialise");
        this.addLog("Initialising...", LOG_LEVEL_VERBOSE, "initialise");
        this.addLog(`Vault directory: ${this.rootHandle.name}`, LOG_LEVEL_VERBOSE, "initialise");

        // Create LiveSync core
        this.core = new LiveSyncBaseCore<ServiceContext, never>(
            this.serviceHub,
            (core, serviceHub) => {
                const serviceModules = initialiseServiceModulesFSAPI(this.rootHandle, core, serviceHub);
                this.platformServiceModules = serviceModules;
                return serviceModules;
            },
            () => [],
            () => [] as never[], // No add-ons
            (core) => {
                useOfflineScanner(core);
                useRedFlagFeatures(core);
                useCheckRemoteSize(core);
                useRemoteConfiguration(core);
                this.p2p = useP2PReplicatorFeature(core);
                this.paneHost = {
                    services: core.services,
                    p2p: this.p2p,
                };
            }
        );

        try {
            await this.startCore();
        } catch (error) {
            try {
                await this.shutdown();
            } catch (shutdownError) {
                this.addLog(`Failed to clean up after start failure: ${String(shutdownError)}`, LOG_LEVEL_NOTICE);
            }
            throw error;
        }
    }

    private async saveSettingsToFile(data: ObsidianLiveSyncSettings): Promise<void> {
        // Create .livesync directory if it does not exist
        const livesyncDir = await this.rootHandle.getDirectoryHandle(SETTINGS_DIR, { create: true });

        // Create/overwrite settings.json
        const fileHandle = await livesyncDir.getFileHandle(SETTINGS_FILE, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
    }

    private async loadSettingsFromFile(): Promise<Partial<ObsidianLiveSyncSettings> | null> {
        try {
            const livesyncDir = await this.rootHandle.getDirectoryHandle(SETTINGS_DIR);
            const fileHandle = await livesyncDir.getFileHandle(SETTINGS_FILE);
            const file = await fileHandle.getFile();
            const text = await file.text();
            const parsed: unknown = JSON.parse(text);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                throw new Error("The WebApp settings file does not contain an object");
            }
            return parsed;
        } catch {
            // The file does not exist yet.
            return null;
        }
    }

    private async startCore(): Promise<void> {
        if (!this.core) {
            throw new Error("Core not initialised");
        }

        try {
            this.addLog("Initialising LiveSync...", LOG_LEVEL_INFO, "start");

            const loadResult = await this.core.services.control.onLoad();
            if (!loadResult) {
                this.addLog("Failed to initialise LiveSync", LOG_LEVEL_NOTICE, "start");
                throw new Error("Failed to initialise LiveSync");
            }

            await this.core.services.control.onReady();

            this.addLog("LiveSync is running", LOG_LEVEL_INFO, "ready");

            // Check if configured
            const settings = this.core.services.setting.currentSettings();
            if (!settings.isConfigured) {
                this.addLog("LiveSync is not configured yet", LOG_LEVEL_NOTICE, "configuration");
                this.showWarning("Please configure CouchDB connection in settings");
            } else {
                this.addLog("LiveSync is configured and ready", LOG_LEVEL_INFO, "configuration");
                this.addLog(`Database: ${settings.couchDB_DBNAME}`, LOG_LEVEL_VERBOSE, "configuration");
                this.showSuccess("LiveSync is ready!");
            }

            // Scan the directory to populate file cache
            const fileAccess = this.platformServiceModules?.vaultAccess;
            if (fileAccess) {
                this.addLog("Scanning vault directory...", LOG_LEVEL_VERBOSE, "scan");
                await fileAccess.fsapiAdapter.scanDirectory();
                const files = await fileAccess.fsapiAdapter.getFiles();
                this.addLog(`Found ${files.length} files`, LOG_LEVEL_VERBOSE, "scan");
            }
        } catch (error) {
            this.addLog(`Failed to start: ${String(error)}`, LOG_LEVEL_NOTICE, "start");
            this.showError(`Failed to start: ${String(error)}`);
            throw error;
        }
    }

    async shutdown(): Promise<void> {
        const core = this.core;
        if (!core) {
            return;
        }
        this.core = null;
        this.paneHost = null;
        this.addLog("Shutting down...", LOG_LEVEL_INFO, "shutdown");

        const storageEventManager = this.platformServiceModules?.storageEventManager;
        this.platformServiceModules = null;
        try {
            if (storageEventManager) {
                await storageEventManager.cleanup();
            }
        } finally {
            await core.services.control.onUnload();
            this.p2p = null;
            this.addLog("Shutdown complete", LOG_LEVEL_INFO, "shutdown");
            this.serviceHub = null;
        }
    }

    private showError(message: string): void {
        this.reportStatus("error", `Error: ${message}`);
    }

    private showWarning(message: string): void {
        this.reportStatus("warning", `Warning: ${message}`);
    }

    private showSuccess(message: string): void {
        this.reportStatus("success", message);
    }
}
