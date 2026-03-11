/**
 * Self-hosted LiveSync WebApp
 * Browser-based version of Self-hosted LiveSync plugin using FileSystem API
 */

import { BrowserServiceHub } from "../../lib/src/services/BrowserServices";
import { LiveSyncBaseCore } from "../../LiveSyncBaseCore";
import { ServiceContext } from "../../lib/src/services/base/ServiceBase";
import { initialiseServiceModulesFSAPI } from "./serviceModules/FSAPIServiceModules";
import type { ObsidianLiveSyncSettings } from "../../lib/src/common/types";
import type { BrowserAPIService } from "../../lib/src/services/implements/browser/BrowserAPIService";
import type { InjectableSettingService } from "../../lib/src/services/implements/injectable/InjectableSettingService";
// import { SetupManager } from "@/modules/features/SetupManager";
// import { ModuleObsidianSettingsAsMarkdown } from "@/modules/features/ModuleObsidianSettingAsMarkdown";
// import { ModuleSetupObsidian } from "@/modules/features/ModuleSetupObsidian";
// import { ModuleObsidianMenu } from "@/modules/essentialObsidian/ModuleObsidianMenu";

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
    private rootHandle: FileSystemDirectoryHandle | null = null;
    private core: LiveSyncBaseCore<ServiceContext, any> | null = null;
    private serviceHub: BrowserServiceHub<ServiceContext> | null = null;

    async initialize() {
        console.log("Self-hosted LiveSync WebApp");
        console.log("Initializing...");

        // Request directory access
        await this.requestDirectoryAccess();

        if (!this.rootHandle) {
            throw new Error("Failed to get directory access");
        }

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

        // Create LiveSync core
        this.core = new LiveSyncBaseCore(
            this.serviceHub,
            (core, serviceHub) => {
                return initialiseServiceModulesFSAPI(this.rootHandle!, core, serviceHub);
            },
            (core) => [
                // new ModuleObsidianEvents(this, core),
                // new ModuleObsidianSettingDialogue(this, core),
                // new ModuleObsidianMenu(core),
                // new ModuleSetupObsidian(core),
                // new ModuleObsidianSettingsAsMarkdown(core),
                // new ModuleLog(this, core),
                // new ModuleObsidianDocumentHistory(this, core),
                // new ModuleInteractiveConflictResolver(this, core),
                // new ModuleObsidianGlobalHistory(this, core),
                // new ModuleDev(this, core),
                // new ModuleReplicateTest(this, core),
                // new ModuleIntegratedTest(this, core),
                // new SetupManager(core),
            ],
            () => [],// No add-ons
            () => [],
        );

        // Start the core
        await this.start();
    }

    private async saveSettingsToFile(data: ObsidianLiveSyncSettings): Promise<void> {
        if (!this.rootHandle) return;

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
        if (!this.rootHandle) return null;

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

    private async requestDirectoryAccess() {
        try {
            // Check if we have a cached directory handle
            const cached = await this.loadCachedDirectoryHandle();
            if (cached) {
                // Verify permission (cast to any for compatibility)
                try {
                    const permission = await (cached as any).queryPermission({ mode: "readwrite" });
                    if (permission === "granted") {
                        this.rootHandle = cached;
                        console.log("[Directory] Using cached directory handle");
                        return;
                    }
                } catch (e) {
                    // queryPermission might not be supported, try to use anyway
                    console.log("[Directory] Could not verify permission, requesting new access");
                }
            }

            // Request new directory access
            console.log("[Directory] Requesting directory access...");
            this.rootHandle = await (window as any).showDirectoryPicker({
                mode: "readwrite",
                startIn: "documents",
            });

            // Save the handle for next time
            await this.saveCachedDirectoryHandle(this.rootHandle);
            console.log("[Directory] Directory access granted");
        } catch (error) {
            console.error("[Directory] Failed to get directory access:", error);
            throw error;
        }
    }

    private async saveCachedDirectoryHandle(handle: FileSystemDirectoryHandle) {
        try {
            // Use IndexedDB to store the directory handle
            const db = await this.openHandleDB();
            const transaction = db.transaction(["handles"], "readwrite");
            const store = transaction.objectStore("handles");
            await new Promise((resolve, reject) => {
                const request = store.put(handle, "rootHandle");
                request.onsuccess = resolve;
                request.onerror = reject;
            });
            db.close();
        } catch (error) {
            console.error("[Directory] Failed to cache handle:", error);
        }
    }

    private async loadCachedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
        try {
            const db = await this.openHandleDB();
            const transaction = db.transaction(["handles"], "readonly");
            const store = transaction.objectStore("handles");
            const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
                const request = store.get("rootHandle");
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = reject;
            });
            db.close();
            return handle;
        } catch (error) {
            console.error("[Directory] Failed to load cached handle:", error);
            return null;
        }
    }

    private async openHandleDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("livesync-webapp-handles", 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains("handles")) {
                    db.createObjectStore("handles");
                }
            };
        });
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

// Initialize on load
const app = new LiveSyncWebApp();

window.addEventListener("load", async () => {
    try {
        await app.initialize();
    } catch (error) {
        console.error("Failed to initialize:", error);
    }
});

// Handle page unload
window.addEventListener("beforeunload", () => {
    void app.shutdown();
});

// Export for debugging
(window as any).livesyncApp = app;
