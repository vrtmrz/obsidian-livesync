import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { EVENT_FILE_RENAMED, EVENT_LEAF_ACTIVE_CHANGED, eventHub } from "../../common/events.js";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { type TFile } from "../../deps.ts";
import { fireAndForget } from "octagonal-wheels/promises";
import { type FilePathWithPrefix } from "../../lib/src/common/types.ts";
import { reactive, reactiveSource } from "octagonal-wheels/dataobject/reactive";
import {
    collectingChunks,
    pluginScanningCount,
    hiddenFilesEventCount,
    hiddenFilesProcessingCount,
} from "../../lib/src/mock_and_interop/stores.ts";
import type { LiveSyncCore } from "../../main.ts";

export class ModuleObsidianEvents extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean> {
        // this.registerEvent(this.app.workspace.on("editor-change", ));
        this.plugin.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => {
                eventHub.emitEvent(EVENT_FILE_RENAMED, {
                    newPath: file.path as FilePathWithPrefix,
                    old: oldPath as FilePathWithPrefix,
                });
            })
        );
        this.plugin.registerEvent(
            this.app.workspace.on("active-leaf-change", () => eventHub.emitEvent(EVENT_LEAF_ACTIVE_CHANGED))
        );
        return Promise.resolve(true);
    }

    private _performRestart(): void {
        this.__performAppReload();
    }

    __performAppReload() {
        //@ts-ignore
        this.app.commands.executeCommandById("app:reload");
    }

    initialCallback: any;

    swapSaveCommand() {
        this._log("Modifying callback of the save command", LOG_LEVEL_VERBOSE);
        const saveCommandDefinition = (this.app as any).commands?.commands?.["editor:save-file"];
        const save = saveCommandDefinition?.callback;
        if (typeof save === "function") {
            this.initialCallback = save;
            saveCommandDefinition.callback = () => {
                scheduleTask("syncOnEditorSave", 250, () => {
                    if (this.services.appLifecycle.hasUnloaded()) {
                        this._log("Unload and remove the handler.", LOG_LEVEL_VERBOSE);
                        saveCommandDefinition.callback = this.initialCallback;
                        this.initialCallback = undefined;
                    } else {
                        if (this.settings.syncOnEditorSave) {
                            this._log("Sync on Editor Save.", LOG_LEVEL_VERBOSE);
                            fireAndForget(() => this.services.replication.replicateByEvent());
                        }
                    }
                });
                save();
            };
        }
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const _this = this;
        //@ts-ignore
        if (!window.CodeMirrorAdapter) {
            this._log("CodeMirrorAdapter is not available");
            return;
        }
        //@ts-ignore
        window.CodeMirrorAdapter.commands.save = () => {
            //@ts-ignore
            _this.app.commands.executeCommandById("editor:save-file");
            // _this.app.performCommand('editor:save-file');
        };
    }

    registerWatchEvents() {
        this.setHasFocus = this.setHasFocus.bind(this);
        this.watchWindowVisibility = this.watchWindowVisibility.bind(this);
        this.watchWorkspaceOpen = this.watchWorkspaceOpen.bind(this);
        this.watchOnline = this.watchOnline.bind(this);
        this.plugin.registerEvent(this.app.workspace.on("file-open", this.watchWorkspaceOpen));
        this.plugin.registerDomEvent(document, "visibilitychange", this.watchWindowVisibility);
        this.plugin.registerDomEvent(window, "focus", () => this.setHasFocus(true));
        this.plugin.registerDomEvent(window, "blur", () => this.setHasFocus(false));
        this.plugin.registerDomEvent(window, "online", this.watchOnline);
        this.plugin.registerDomEvent(window, "offline", this.watchOnline);
    }

    hasFocus = true;
    isLastHidden = false;

    setHasFocus(hasFocus: boolean) {
        this.hasFocus = hasFocus;
        this.watchWindowVisibility();
    }

    watchWindowVisibility() {
        scheduleTask("watch-window-visibility", 100, () => fireAndForget(() => this.watchWindowVisibilityAsync()));
    }

    watchOnline() {
        scheduleTask("watch-online", 500, () => fireAndForget(() => this.watchOnlineAsync()));
    }
    async watchOnlineAsync() {
        // If some files were failed to retrieve, scan files again.
        // TODO:FIXME AT V0.17.31, this logic has been disabled.
        if (navigator.onLine && this.localDatabase.needScanning) {
            this.localDatabase.needScanning = false;
            await this.services.vault.scanVault();
        }
    }

    async watchWindowVisibilityAsync() {
        if (this.settings.suspendFileWatching) return;
        if (!this.settings.isConfigured) return;
        if (!this.services.appLifecycle.isReady()) return;

        if (this.isLastHidden && !this.hasFocus) {
            // NO OP while non-focused after made hidden;
            return;
        }

        const isHidden = document.hidden;
        if (this.isLastHidden === isHidden) {
            return;
        }
        this.isLastHidden = isHidden;

        await this.services.fileProcessing.commitPendingFileEvents();

        if (isHidden) {
            await this.services.appLifecycle.onSuspending();
        } else {
            // suspend all temporary.
            if (this.services.appLifecycle.isSuspended()) return;
            if (!this.hasFocus) return;
            await this.services.appLifecycle.onResuming();
            await this.services.appLifecycle.onResumed();
        }
    }
    watchWorkspaceOpen(file: TFile | null) {
        if (this.settings.suspendFileWatching) return;
        if (!this.settings.isConfigured) return;
        if (!this.services.appLifecycle.isReady()) return;
        if (!file) return;
        scheduleTask("watch-workspace-open", 500, () => fireAndForget(() => this.watchWorkspaceOpenAsync(file)));
    }

    async watchWorkspaceOpenAsync(file: TFile) {
        if (this.settings.suspendFileWatching) return;
        if (!this.settings.isConfigured) return;
        if (!this.services.appLifecycle.isReady()) return;
        await this.services.fileProcessing.commitPendingFileEvents();
        if (file == null) {
            return;
        }
        if (this.settings.syncOnFileOpen && !this.services.appLifecycle.isSuspended()) {
            await this.services.replication.replicateByEvent();
        }
        await this.services.conflict.queueCheckForIfOpen(file.path as FilePathWithPrefix);
    }

    _everyOnLayoutReady(): Promise<boolean> {
        this.swapSaveCommand();
        this.registerWatchEvents();
        return Promise.resolve(true);
    }

    private _askReload(message?: string) {
        if (this.services.appLifecycle.isReloadingScheduled()) {
            this._log(`Reloading is already scheduled`, LOG_LEVEL_VERBOSE);
            return;
        }
        scheduleTask("configReload", 250, async () => {
            const RESTART_NOW = "Yes, restart immediately";
            const RESTART_AFTER_STABLE = "Yes, schedule a restart after stabilisation";
            const RETRY_LATER = "No, Leave it to me";
            const ret = await this.core.confirm.askSelectStringDialogue(
                message || "Do you want to restart and reload Obsidian now?",
                [RESTART_AFTER_STABLE, RESTART_NOW, RETRY_LATER],
                { defaultAction: RETRY_LATER }
            );
            if (ret == RESTART_NOW) {
                this.__performAppReload();
            } else if (ret == RESTART_AFTER_STABLE) {
                this.services.appLifecycle.scheduleRestart();
            }
        });
    }
    private _scheduleAppReload() {
        if (!this.core._totalProcessingCount) {
            const __tick = reactiveSource(0);
            this.core._totalProcessingCount = reactive(() => {
                const dbCount = this.core.databaseQueueCount.value;
                const replicationCount = this.core.replicationResultCount.value;
                const storageApplyingCount = this.core.storageApplyingCount.value;
                const chunkCount = collectingChunks.value;
                const pluginScanCount = pluginScanningCount.value;
                const hiddenFilesCount = hiddenFilesEventCount.value + hiddenFilesProcessingCount.value;
                const conflictProcessCount = this.core.conflictProcessQueueCount.value;
                const e = this.core.pendingFileEventCount.value;
                const proc = this.core.processingFileEventCount.value;
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const __ = __tick.value;
                return (
                    dbCount +
                    replicationCount +
                    storageApplyingCount +
                    chunkCount +
                    pluginScanCount +
                    hiddenFilesCount +
                    conflictProcessCount +
                    e +
                    proc
                );
            });
            this.plugin.registerInterval(
                setInterval(() => {
                    __tick.value++;
                }, 1000) as unknown as number
            );

            let stableCheck = 3;
            this.core._totalProcessingCount.onChanged((e) => {
                if (e.value == 0) {
                    if (stableCheck-- <= 0) {
                        this.__performAppReload();
                    }
                    this._log(
                        `Obsidian will be restarted soon! (Within ${stableCheck} seconds)`,
                        LOG_LEVEL_NOTICE,
                        "restart-notice"
                    );
                } else {
                    stableCheck = 3;
                }
            });
        }
    }
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.handleLayoutReady(this._everyOnLayoutReady.bind(this));
        services.appLifecycle.handleOnInitialise(this._everyOnloadStart.bind(this));
        services.appLifecycle.handlePerformRestart(this._performRestart.bind(this));
        services.appLifecycle.handleAskRestart(this._askReload.bind(this));
        services.appLifecycle.handleScheduleRestart(this._scheduleAppReload.bind(this));
    }
}
