import { fireAndForget } from "octagonal-wheels/promises";
import { addIcon, type Editor, type MarkdownFileInfo, type MarkdownView } from "../../deps.ts";
import { LOG_LEVEL_NOTICE, type FilePathWithPrefix } from "../../lib/src/common/types.ts";
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { $msg } from "src/lib/src/common/i18n.ts";
import type { LiveSyncCore } from "../../main.ts";

export class ModuleObsidianMenu extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean> {
        // UI
        addIcon(
            "replicate",
            `<g transform="matrix(1.15 0 0 1.15 -8.31 -9.52)" fill="currentColor" fill-rule="evenodd">
            <path d="m85 22.2c-0.799-4.74-4.99-8.37-9.88-8.37-0.499 0-1.1 0.101-1.6 0.101-2.4-3.03-6.09-4.94-10.3-4.94-6.09 0-11.2 4.14-12.8 9.79-5.59 1.11-9.78 6.05-9.78 12 0 6.76 5.39 12.2 12 12.2h29.9c5.79 0 10.1-4.74 10.1-10.6 0-4.84-3.29-8.88-7.68-10.2zm-2.99 14.7h-29.5c-2.3-0.202-4.29-1.51-5.29-3.53-0.899-2.12-0.699-4.54 0.698-6.46 1.2-1.61 2.99-2.52 4.89-2.52 0.299 0 0.698 0 0.998 0.101l1.8 0.303v-2.02c0-3.63 2.4-6.76 5.89-7.57 0.599-0.101 1.2-0.202 1.8-0.202 2.89 0 5.49 1.62 6.79 4.24l0.598 1.21 1.3-0.504c0.599-0.202 1.3-0.303 2-0.303 1.3 0 2.5 0.404 3.59 1.11 1.6 1.21 2.6 3.13 2.6 5.15v1.61h2c2.6 0 4.69 2.12 4.69 4.74-0.099 2.52-2.2 4.64-4.79 4.64z"/>
            <path d="m53.2 49.2h-41.6c-1.8 0-3.2 1.4-3.2 3.2v28.6c0 1.8 1.4 3.2 3.2 3.2h15.8v4h-7v6h24v-6h-7v-4h15.8c1.8 0 3.2-1.4 3.2-3.2v-28.6c0-1.8-1.4-3.2-3.2-3.2zm-2.8 29h-36v-23h36z"/>
            <path d="m73 49.2c1.02 1.29 1.53 2.97 1.53 4.56 0 2.97-1.74 5.65-4.39 7.04v-4.06l-7.46 7.33 7.46 7.14v-4.06c7.66-1.98 12.2-9.61 10-17-0.102-0.297-0.205-0.595-0.307-0.892z"/>
            <path d="m24.1 43c-0.817-0.991-1.53-2.97-1.53-4.56 0-2.97 1.74-5.65 4.39-7.04v4.06l7.46-7.33-7.46-7.14v4.06c-7.66 1.98-12.2 9.61-10 17 0.102 0.297 0.205 0.595 0.307 0.892z"/>
           </g>`
        );

        this.addRibbonIcon("replicate", $msg("moduleObsidianMenu.replicate"), async () => {
            await this.services.replication.replicate(true);
        }).addClass("livesync-ribbon-replicate");

        this.addCommand({
            id: "livesync-replicate",
            name: "Replicate now",
            callback: async () => {
                await this.services.replication.replicate();
            },
        });
        this.addCommand({
            id: "livesync-dump",
            name: "Dump information of this doc ",
            callback: () => {
                const file = this.services.vault.getActiveFilePath();
                if (!file) return;
                fireAndForget(() => this.localDatabase.getDBEntry(file, {}, true, false));
            },
        });
        this.addCommand({
            id: "livesync-checkdoc-conflicted",
            name: "Resolve if conflicted.",
            editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
                const file = view.file;
                if (!file) return;
                void this.services.conflict.queueCheckForIfOpen(file.path as FilePathWithPrefix);
            },
        });

        this.addCommand({
            id: "livesync-toggle",
            name: "Toggle LiveSync",
            callback: async () => {
                if (this.settings.liveSync) {
                    this.settings.liveSync = false;
                    this._log("LiveSync Disabled.", LOG_LEVEL_NOTICE);
                } else {
                    this.settings.liveSync = true;
                    this._log("LiveSync Enabled.", LOG_LEVEL_NOTICE);
                }
                await this.services.setting.realiseSetting();
                await this.services.setting.saveSettingData();
            },
        });
        this.addCommand({
            id: "livesync-suspendall",
            name: "Toggle All Sync.",
            callback: async () => {
                if (this.services.appLifecycle.isSuspended()) {
                    this.services.appLifecycle.setSuspended(false);
                    this._log("Self-hosted LiveSync resumed", LOG_LEVEL_NOTICE);
                } else {
                    this.services.appLifecycle.setSuspended(true);
                    this._log("Self-hosted LiveSync suspended", LOG_LEVEL_NOTICE);
                }
                await this.services.setting.realiseSetting();
                await this.services.setting.saveSettingData();
            },
        });

        this.addCommand({
            id: "livesync-scan-files",
            name: "Scan storage and database again",
            callback: async () => {
                await this.services.vault.scanVault(true);
            },
        });

        this.addCommand({
            id: "livesync-runbatch",
            name: "Run pended batch processes",
            callback: async () => {
                await this.services.fileProcessing.commitPendingFileEvents();
            },
        });

        // TODO, Replicator is possibly one of features. It should be moved to features.
        this.addCommand({
            id: "livesync-abortsync",
            name: "Abort synchronization immediately",
            callback: () => {
                this.core.replicator.terminateSync();
            },
        });
        return Promise.resolve(true);
    }
    private __onWorkspaceReady() {
        void this.services.appLifecycle.onReady();
    }
    private _everyOnload(): Promise<boolean> {
        this.app.workspace.onLayoutReady(this.__onWorkspaceReady.bind(this));
        return Promise.resolve(true);
    }

    private async _showView(viewType: string) {
        const leaves = this.app.workspace.getLeavesOfType(viewType);
        if (leaves.length == 0) {
            await this.app.workspace.getLeaf(true).setViewState({
                type: viewType,
                active: true,
            });
        } else {
            await leaves[0].setViewState({
                type: viewType,
                active: true,
            });
        }
        if (leaves.length > 0) {
            await this.app.workspace.revealLeaf(leaves[0]);
        }
    }
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.handleOnInitialise(this._everyOnloadStart.bind(this));
        services.appLifecycle.handleOnLoaded(this._everyOnload.bind(this));
        services.API.handleShowWindow(this._showView.bind(this));
    }
}
