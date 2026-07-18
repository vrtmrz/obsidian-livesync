/**
 * Self-hosted LiveSync WebApp
 * Browser-based version of Self-hosted LiveSync plugin using FileSystem API
 */

import type { BrowserServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/BrowserServices";
import { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/compat/services/base/ServiceBase";
import { initialiseServiceModulesFSAPI, type FSAPIServiceModules } from "./serviceModules/FSAPIServiceModules";
import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type LOG_LEVEL,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { BrowserAPIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/browser/BrowserAPIService";
import type { InjectableSettingService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableSettingService";
import { useOfflineScanner } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
import { useRedFlagFeatures } from "@/serviceFeatures/redFlag";
import { useCheckRemoteSize } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/checkRemoteSize";
import { useSetupURIFeature } from "@/serviceFeatures/setupObsidian/setupUri";
import { useRemoteConfiguration } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/remoteConfig";
import { SetupManager } from "@/modules/features/SetupManager";
import { useSetupManagerHandlersFeature } from "@/serviceFeatures/setupObsidian/setupManagerHandlers";
import { useP2PReplicatorCommands } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/useP2PReplicatorCommands";
import { useP2PReplicatorFeature } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/useP2PReplicatorFeature";
import { compatGlobal, _activeDocument } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { createLiveSyncBrowserServiceHub } from "@/apps/browser/createLiveSyncBrowserServiceHub";

const SETTINGS_DIR = ".livesync";
const SETTINGS_FILE = "settings.json";

/**
 * Default settings for the webapp
 */
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
    // Disable features not needed in webapp
    usePluginSync: false,
    autoSweepPlugins: false,
    autoSweepPluginsPeriodic: false,
};

class LiveSyncWebApp {
    private rootHandle: FileSystemDirectoryHandle;
    private core: LiveSyncBaseCore<ServiceContext, never> | null = null;
    private serviceHub: BrowserServiceHub<ServiceContext> | null = null;
    private platformServiceModules: FSAPIServiceModules | null = null;

    constructor(rootHandle: FileSystemDirectoryHandle) {
        this.rootHandle = rootHandle;
    }

    private addLog(message: unknown, level: LOG_LEVEL = LOG_LEVEL_INFO, key?: string): void {
        this.serviceHub?.API.addLog(message, level, key);
    }

    async initialize() {
        // Create service context and hub
        this.serviceHub = createLiveSyncBrowserServiceHub<ServiceContext>();
        this.addLog("Self-hosted LiveSync WebApp", LOG_LEVEL_INFO, "initialise");
        this.addLog("Initialising...", LOG_LEVEL_VERBOSE, "initialise");
        this.addLog(`Vault directory: ${this.rootHandle.name}`, LOG_LEVEL_VERBOSE, "initialise");

        // Setup API service
        (this.serviceHub.API as BrowserAPIService<ServiceContext>).getSystemVaultName.setHandler(
            () => this.rootHandle?.name || "livesync-webapp"
        );

        // Setup settings handlers - save to .livesync folder
        const settingService = this.serviceHub.setting as InjectableSettingService<ServiceContext>;

        settingService.saveData.setHandler(async (data: ObsidianLiveSyncSettings) => {
            try {
                await this.saveSettingsToFile(data);
                this.addLog("Saved to .livesync/settings.json", LOG_LEVEL_VERBOSE, "settings");
            } catch (error) {
                this.addLog(`Failed to save settings: ${String(error)}`, LOG_LEVEL_NOTICE, "settings");
            }
        });

        settingService.loadData.setHandler(async (): Promise<ObsidianLiveSyncSettings | undefined> => {
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
        });

        // App lifecycle handlers
        this.serviceHub.appLifecycle.scheduleRestart.setHandler(() => {
            void (async () => {
                this.addLog("Restart requested", LOG_LEVEL_INFO, "app-lifecycle");
                await this.shutdown();
                await this.initialize();
                compatGlobal.setTimeout(() => {
                    compatGlobal.location.reload();
                }, 1000);
            })();
        });

        // Create LiveSync core
        this.core = new LiveSyncBaseCore<ServiceContext, never>(
            this.serviceHub,
            (core, serviceHub) => {
                const serviceModules = initialiseServiceModulesFSAPI(this.rootHandle, core, serviceHub);
                this.platformServiceModules = serviceModules;
                return serviceModules;
            },
            (core) => [
                // new ModuleObsidianEvents(this, core),
                // new ModuleObsidianSettingDialogue(this, core),
                // new ModuleObsidianMenu(core),
                // new ModuleObsidianSettingsAsMarkdown(core),
                // new ModuleLog(this, core),
                // new ModuleObsidianDocumentHistory(this, core),
                // new ModuleInteractiveConflictResolver(this, core),
                // new ModuleObsidianGlobalHistory(this, core),
                // new ModuleDev(this, core),
                // new ModuleReplicateTest(this, core),
                // new ModuleIntegratedTest(this, core),
                // new ModuleReplicatorP2P(core), // Register P2P replicator for CLI (useP2PReplicator is not used here)
                new SetupManager(core),
            ],
            () => [] as never[], // No add-ons
            (core) => {
                useOfflineScanner(core);
                useRedFlagFeatures(core);
                useCheckRemoteSize(core);
                useRemoteConfiguration(core);
                const replicator = useP2PReplicatorFeature(core);
                useP2PReplicatorCommands(core, replicator);
                const setupManager = core.getModule(SetupManager);
                useSetupManagerHandlersFeature(core, setupManager);
                useSetupURIFeature(core);
            }
        );

        // Start the core
        await this.start();
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
            return JSON.parse(text);
        } catch {
            // File doesn't exist yet
            return null;
        }
    }

    private async start() {
        if (!this.core) {
            throw new Error("Core not initialized");
        }

        try {
            this.addLog("Initialising LiveSync...", LOG_LEVEL_INFO, "start");

            const loadResult = await this.core.services.control.onLoad();
            if (!loadResult) {
                this.addLog("Failed to initialise LiveSync", LOG_LEVEL_NOTICE, "start");
                this.showError("Failed to initialize LiveSync");
                return;
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
            this.showError(`Failed to start: ${error}`);
        }
    }

    async shutdown() {
        if (this.core) {
            this.addLog("Shutting down...", LOG_LEVEL_INFO, "shutdown");

            // Stop file watching
            const storageEventManager = this.platformServiceModules?.storageEventManager;
            if (storageEventManager) {
                await storageEventManager.cleanup();
            }

            await this.core.services.control.onUnload();
            this.platformServiceModules = null;
            this.addLog("Shutdown complete", LOG_LEVEL_INFO, "shutdown");
        }
    }

    private showError(message: string) {
        const statusEl = _activeDocument.getElementById("status");
        if (statusEl) {
            statusEl.className = "error";
            statusEl.textContent = `Error: ${message}`;
        }
    }

    private showWarning(message: string) {
        const statusEl = _activeDocument.getElementById("status");
        if (statusEl) {
            statusEl.className = "warning";
            statusEl.textContent = `Warning: ${message}`;
        }
    }

    private showSuccess(message: string) {
        const statusEl = _activeDocument.getElementById("status");
        if (statusEl) {
            statusEl.className = "success";
            statusEl.textContent = message;
        }
    }
}

export { LiveSyncWebApp };
