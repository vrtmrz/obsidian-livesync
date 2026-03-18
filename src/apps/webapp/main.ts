/**
 * Self-hosted LiveSync WebApp
 * Browser-based version of Self-hosted LiveSync plugin using FileSystem API
 */

import { BrowserServiceHub } from "@lib/services/BrowserServices";
import { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { ServiceContext } from "@lib/services/base/ServiceBase";
import { initialiseServiceModulesFSAPI } from "./serviceModules/FSAPIServiceModules";
import type { ObsidianLiveSyncSettings } from "@lib/common/types";
import type { BrowserAPIService } from "@lib/services/implements/browser/BrowserAPIService";
import type { InjectableSettingService } from "@lib/services/implements/injectable/InjectableSettingService";
import { useOfflineScanner } from "@lib/serviceFeatures/offlineScanner";
import { useRedFlagFeatures } from "@/serviceFeatures/redFlag";
import { useCheckRemoteSize } from "@lib/serviceFeatures/checkRemoteSize";
import { useSetupURIFeature } from "@lib/serviceFeatures/setupObsidian/setupUri";
import { SetupManager } from "@/modules/features/SetupManager";
import { useSetupManagerHandlersFeature } from "@/serviceFeatures/setupObsidian/setupManagerHandlers";
import { useP2PReplicatorCommands } from "@/lib/src/replication/trystero/useP2PReplicatorCommands";
import { useP2PReplicatorFeature } from "@/lib/src/replication/trystero/useP2PReplicatorFeature";

const SETTINGS_DIR = ".livesync";
const SETTINGS_FILE = "settings.json";
const DB_NAME = "livesync-webapp";

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
    private core: LiveSyncBaseCore<ServiceContext, any> | null = null;
    private serviceHub: BrowserServiceHub<ServiceContext> | null = null;

    constructor(rootHandle: FileSystemDirectoryHandle) {
        this.rootHandle = rootHandle;
    }

    async initialize() {
        console.log("Self-hosted LiveSync WebApp");
        console.log("Initializing...");

        console.log(`Vault directory: ${this.rootHandle.name}`);

        // Create service context and hub
        const context = new ServiceContext();
        this.serviceHub = new BrowserServiceHub<ServiceContext>();

        // Setup API service
        (this.serviceHub.API as BrowserAPIService<ServiceContext>).getSystemVaultName.setHandler(
            () => this.rootHandle?.name || "livesync-webapp"
        );

        // Setup settings handlers - save to .livesync folder
        const settingService = this.serviceHub.setting as InjectableSettingService<ServiceContext>;

        settingService.saveData.setHandler(async (data: ObsidianLiveSyncSettings) => {
            try {
                await this.saveSettingsToFile(data);
                console.log("[Settings] Saved to .livesync/settings.json");
            } catch (error) {
                console.error("[Settings] Failed to save:", error);
            }
        });

        settingService.loadData.setHandler(async (): Promise<ObsidianLiveSyncSettings | undefined> => {
            try {
                const data = await this.loadSettingsFromFile();
                if (data) {
                    console.log("[Settings] Loaded from .livesync/settings.json");
                    return { ...DEFAULT_SETTINGS, ...data } as ObsidianLiveSyncSettings;
                }
            } catch (error) {
                console.log("[Settings] Failed to load, using defaults");
            }
            return DEFAULT_SETTINGS as ObsidianLiveSyncSettings;
        });

        // App lifecycle handlers
        this.serviceHub.appLifecycle.scheduleRestart.setHandler(async () => {
            console.log("[AppLifecycle] Restart requested");
            await this.shutdown();
            await this.initialize();
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        });

        // Create LiveSync core
        this.core = new LiveSyncBaseCore(
            this.serviceHub,
            (core, serviceHub) => {
                return initialiseServiceModulesFSAPI(this.rootHandle, core, serviceHub);
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
            () => [], // No add-ons
            (core) => {
                useOfflineScanner(core);
                useRedFlagFeatures(core);
                useCheckRemoteSize(core);
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
        try {
            // Create .livesync directory if it doesn't exist
            const livesyncDir = await this.rootHandle.getDirectoryHandle(SETTINGS_DIR, { create: true });

            // Create/overwrite settings.json
            const fileHandle = await livesyncDir.getFileHandle(SETTINGS_FILE, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(data, null, 2));
            await writable.close();
        } catch (error) {
            console.error("[Settings] Error saving to file:", error);
            throw error;
        }
    }

    private async loadSettingsFromFile(): Promise<Partial<ObsidianLiveSyncSettings> | null> {
        try {
            const livesyncDir = await this.rootHandle.getDirectoryHandle(SETTINGS_DIR);
            const fileHandle = await livesyncDir.getFileHandle(SETTINGS_FILE);
            const file = await fileHandle.getFile();
            const text = await file.text();
            return JSON.parse(text);
        } catch (error) {
            // File doesn't exist yet
            return null;
        }
    }

    private async start() {
        if (!this.core) {
            throw new Error("Core not initialized");
        }

        try {
            console.log("[Starting] Initializing LiveSync...");

            const loadResult = await this.core.services.control.onLoad();
            if (!loadResult) {
                console.error("[Error] Failed to initialize LiveSync");
                this.showError("Failed to initialize LiveSync");
                return;
            }

            await this.core.services.control.onReady();

            console.log("[Ready] LiveSync is running");

            // Check if configured
            const settings = this.core.services.setting.currentSettings();
            if (!settings.isConfigured) {
                console.warn("[Warning] LiveSync is not configured yet");
                this.showWarning("Please configure CouchDB connection in settings");
            } else {
                console.log("[Info] LiveSync is configured and ready");
                console.log(`[Info] Database: ${settings.couchDB_URI}/${settings.couchDB_DBNAME}`);
                this.showSuccess("LiveSync is ready!");
            }

            // Scan the directory to populate file cache
            const fileAccess = (this.core as any)._serviceModules?.storageAccess?.vaultAccess;
            if (fileAccess?.fsapiAdapter) {
                console.log("[Scanning] Scanning vault directory...");
                await fileAccess.fsapiAdapter.scanDirectory();
                const files = await fileAccess.fsapiAdapter.getFiles();
                console.log(`[Scanning] Found ${files.length} files`);
            }
        } catch (error) {
            console.error("[Error] Failed to start:", error);
            this.showError(`Failed to start: ${error}`);
        }
    }

    async shutdown() {
        if (this.core) {
            console.log("[Shutdown] Shutting down...");

            // Stop file watching
            const storageEventManager = (this.core as any)._serviceModules?.storageAccess?.storageEventManager;
            if (storageEventManager?.cleanup) {
                await storageEventManager.cleanup();
            }

            await this.core.services.control.onUnload();
            console.log("[Shutdown] Complete");
        }
    }

    private showError(message: string) {
        const statusEl = document.getElementById("status");
        if (statusEl) {
            statusEl.className = "error";
            statusEl.textContent = `Error: ${message}`;
        }
    }

    private showWarning(message: string) {
        const statusEl = document.getElementById("status");
        if (statusEl) {
            statusEl.className = "warning";
            statusEl.textContent = `Warning: ${message}`;
        }
    }

    private showSuccess(message: string) {
        const statusEl = document.getElementById("status");
        if (statusEl) {
            statusEl.className = "success";
            statusEl.textContent = message;
        }
    }
}

export { LiveSyncWebApp };
