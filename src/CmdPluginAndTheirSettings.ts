import { normalizePath, type PluginManifest } from "./deps";
import type { DocumentID, EntryDoc, FilePathWithPrefix, LoadedEntry } from "./lib/src/types";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "./lib/src/types";
import { type PluginDataEntry, PERIODIC_PLUGIN_SWEEP, type PluginList, type DevicePluginList, PSCHeader, PSCHeaderEnd } from "./types";
import { getDocData, isDocContentSame } from "./lib/src/utils";
import { Logger } from "./lib/src/logger";
import { PouchDB } from "./lib/src/pouchdb-browser.js";
import { isPluginMetadata, PeriodicProcessor } from "./utils";
import { PluginDialogModal } from "./dialogs";
import { NewNotice } from "./lib/src/wrapper";
import { versionNumberString2Number } from "./lib/src/strbin";
import { runWithLock } from "./lib/src/lock";
import { LiveSyncCommands } from "./LiveSyncCommands";

export class PluginAndTheirSettings extends LiveSyncCommands {

    get deviceAndVaultName() {
        return this.plugin.deviceAndVaultName;
    }
    pluginDialog: PluginDialogModal = null;
    periodicPluginSweepProcessor = new PeriodicProcessor(this.plugin, async () => await this.sweepPlugin(false));

    showPluginSyncModal() {
        if (this.pluginDialog != null) {
            this.pluginDialog.open();
        } else {
            this.pluginDialog = new PluginDialogModal(this.app, this.plugin);
            this.pluginDialog.open();
        }
    }

    hidePluginSyncModal() {
        if (this.pluginDialog != null) {
            this.pluginDialog.close();
            this.pluginDialog = null;
        }
    }
    onload(): void | Promise<void> {
        this.plugin.addCommand({
            id: "livesync-plugin-dialog",
            name: "Show Plugins and their settings",
            callback: () => {
                this.showPluginSyncModal();
            },
        });
        this.showPluginSyncModal();
    }
    onunload() {
        this.hidePluginSyncModal();
        this.periodicPluginSweepProcessor?.disable();
    }
    parseReplicationResultItem(doc: PouchDB.Core.ExistingDocument<EntryDoc>) {
        if (isPluginMetadata(doc._id)) {
            if (this.settings.notifyPluginOrSettingUpdated) {
                this.triggerCheckPluginUpdate();
                return true;
            }
        }
        return false;
    }
    async beforeReplicate(showMessage: boolean) {
        if (this.settings.autoSweepPlugins) {
            await this.sweepPlugin(showMessage);
        }
    }
    async onResume() {
        if (this.plugin.suspended)
            return;
        if (this.settings.autoSweepPlugins) {
            await this.sweepPlugin(false);
        }
        this.periodicPluginSweepProcessor.enable(this.settings.autoSweepPluginsPeriodic && !this.settings.watchInternalFileChanges ? (PERIODIC_PLUGIN_SWEEP * 1000) : 0);
    }
    async onInitializeDatabase(showNotice: boolean) {
        if (this.settings.usePluginSync) {
            try {
                Logger("Scanning plugins...");
                await this.sweepPlugin(showNotice);
                Logger("Scanning plugins done");
            } catch (ex) {
                Logger("Scanning plugins  failed");
                Logger(ex, LOG_LEVEL_VERBOSE);
            }

        }
    }

    async realizeSettingSyncMode() {
        this.periodicPluginSweepProcessor?.disable();
        if (this.plugin.suspended)
            return;
        if (this.settings.autoSweepPlugins) {
            await this.sweepPlugin(false);
        }
        this.periodicPluginSweepProcessor.enable(this.settings.autoSweepPluginsPeriodic && !this.settings.watchInternalFileChanges ? (PERIODIC_PLUGIN_SWEEP * 1000) : 0);
    }

    triggerCheckPluginUpdate() {
        (async () => await this.checkPluginUpdate())();
    }


    async getPluginList(): Promise<{ plugins: PluginList; allPlugins: DevicePluginList; thisDevicePlugins: DevicePluginList; }> {
        const docList = await this.localDatabase.allDocsRaw<PluginDataEntry>({ startkey: PSCHeader, endkey: PSCHeaderEnd, include_docs: false });
        const oldDocs: PluginDataEntry[] = ((await Promise.all(docList.rows.map(async (e) => await this.localDatabase.getDBEntry(e.id as FilePathWithPrefix /* WARN!! THIS SHOULD BE WRAPPED */)))).filter((e) => e !== false) as LoadedEntry[]).map((e) => JSON.parse(getDocData(e.data)));
        const plugins: { [key: string]: PluginDataEntry[]; } = {};
        const allPlugins: { [key: string]: PluginDataEntry; } = {};
        const thisDevicePlugins: { [key: string]: PluginDataEntry; } = {};
        for (const v of oldDocs) {
            if (typeof plugins[v.deviceVaultName] === "undefined") {
                plugins[v.deviceVaultName] = [];
            }
            plugins[v.deviceVaultName].push(v);
            allPlugins[v._id] = v;
            if (v.deviceVaultName == this.deviceAndVaultName) {
                thisDevicePlugins[v.manifest.id] = v;
            }
        }
        return { plugins, allPlugins, thisDevicePlugins };
    }

    async checkPluginUpdate() {
        if (!this.plugin.settings.usePluginSync)
            return;
        await this.sweepPlugin(false);
        const { allPlugins, thisDevicePlugins } = await this.getPluginList();
        const arrPlugins = Object.values(allPlugins);
        let updateFound = false;
        for (const plugin of arrPlugins) {
            const ownPlugin = thisDevicePlugins[plugin.manifest.id];
            if (ownPlugin) {
                const remoteVersion = versionNumberString2Number(plugin.manifest.version);
                const ownVersion = versionNumberString2Number(ownPlugin.manifest.version);
                if (remoteVersion > ownVersion) {
                    updateFound = true;
                }
                if (((plugin.mtime / 1000) | 0) > ((ownPlugin.mtime / 1000) | 0) && (plugin.dataJson ?? "") != (ownPlugin.dataJson ?? "")) {
                    updateFound = true;
                }
            }
        }
        if (updateFound) {
            const fragment = createFragment((doc) => {
                doc.createEl("a", null, (a) => {
                    a.text = "There're some new plugins or their settings";
                    a.addEventListener("click", () => this.showPluginSyncModal());
                });
            });
            NewNotice(fragment, 10000);
        } else {
            Logger("Everything is up to date.", LOG_LEVEL_NOTICE);
        }
    }

    async sweepPlugin(showMessage = false, specificPluginPath = "") {
        if (!this.settings.usePluginSync)
            return;
        if (!this.localDatabase.isReady)
            return;
        // @ts-ignore
        const pl = this.app.plugins;
        const manifests: PluginManifest[] = Object.values(pl.manifests);
        let specificPlugin = "";
        if (specificPluginPath != "") {
            specificPlugin = manifests.find(e => e.dir.endsWith("/" + specificPluginPath))?.id ?? "";
        }
        await runWithLock("sweepplugin", true, async () => {
            const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
            if (!this.deviceAndVaultName) {
                Logger("You have to set your device name.", LOG_LEVEL_NOTICE);
                return;
            }
            Logger("Scanning plugins", logLevel);
            const oldDocs = await this.localDatabase.allDocsRaw<EntryDoc>({
                startkey: `ps:${this.deviceAndVaultName}-${specificPlugin}`,
                endkey: `ps:${this.deviceAndVaultName}-${specificPlugin}\u{10ffff}`,
                include_docs: true,
            });
            // Logger("OLD DOCS.", LOG_LEVEL_VERBOSE);
            // sweep current plugin.
            const procs = manifests.map(async (m) => {
                const pluginDataEntryID = `ps:${this.deviceAndVaultName}-${m.id}` as DocumentID;
                try {
                    if (specificPlugin && m.id != specificPlugin) {
                        return;
                    }
                    Logger(`Reading plugin:${m.name}(${m.id})`, LOG_LEVEL_VERBOSE);
                    const path = normalizePath(m.dir) + "/";
                    const adapter = this.app.vault.adapter;
                    const files = ["manifest.json", "main.js", "styles.css", "data.json"];
                    const pluginData: { [key: string]: string; } = {};
                    for (const file of files) {
                        const thePath = path + file;
                        if (await adapter.exists(thePath)) {
                            pluginData[file] = await adapter.read(thePath);
                        }
                    }
                    let mtime = 0;
                    if (await adapter.exists(path + "/data.json")) {
                        mtime = (await adapter.stat(path + "/data.json")).mtime;
                    }

                    const p: PluginDataEntry = {
                        _id: pluginDataEntryID,
                        dataJson: pluginData["data.json"],
                        deviceVaultName: this.deviceAndVaultName,
                        mainJs: pluginData["main.js"],
                        styleCss: pluginData["styles.css"],
                        manifest: m,
                        manifestJson: pluginData["manifest.json"],
                        mtime: mtime,
                        type: "plugin",
                    };
                    const d: LoadedEntry = {
                        _id: p._id,
                        path: p._id as string as FilePathWithPrefix,
                        data: JSON.stringify(p),
                        ctime: mtime,
                        mtime: mtime,
                        size: 0,
                        children: [],
                        datatype: "plain",
                        type: "plain"
                    };
                    Logger(`check diff:${m.name}(${m.id})`, LOG_LEVEL_VERBOSE);
                    await runWithLock("plugin-" + m.id, false, async () => {
                        const old = await this.localDatabase.getDBEntry(p._id as string as FilePathWithPrefix /* This also should be explained */, null, false, false);
                        if (old !== false) {
                            const oldData = { data: old.data, deleted: old._deleted };
                            const newData = { data: d.data, deleted: d._deleted };
                            if (isDocContentSame(oldData.data, newData.data) && oldData.deleted == newData.deleted) {
                                Logger(`Nothing changed:${m.name}`);
                                return;
                            }
                        }
                        await this.localDatabase.putDBEntry(d);
                        Logger(`Plugin saved:${m.name}`, logLevel);
                    });
                } catch (ex) {
                    Logger(`Plugin save failed:${m.name}`, LOG_LEVEL_NOTICE);
                } finally {
                    oldDocs.rows = oldDocs.rows.filter((e) => e.id != pluginDataEntryID);
                }
                //remove saved plugin data.
            }
            );

            await Promise.all(procs);

            const delDocs = oldDocs.rows.map((e) => {
                // e.doc._deleted = true;
                if (e.doc.type == "newnote" || e.doc.type == "plain") {
                    e.doc.deleted = true;
                    if (this.settings.deleteMetadataOfDeletedFiles) {
                        e.doc._deleted = true;
                    }
                } else {
                    e.doc._deleted = true;
                }
                return e.doc;
            });
            Logger(`Deleting old plugin:(${delDocs.length})`, LOG_LEVEL_VERBOSE);
            await this.localDatabase.bulkDocsRaw(delDocs);
            Logger(`Scan plugin done.`, logLevel);
        });
    }

    async applyPluginData(plugin: PluginDataEntry) {
        await runWithLock("plugin-" + plugin.manifest.id, false, async () => {
            const pluginTargetFolderPath = normalizePath(plugin.manifest.dir) + "/";
            const adapter = this.app.vault.adapter;
            // @ts-ignore
            const stat = this.app.plugins.enabledPlugins.has(plugin.manifest.id) == true;
            if (stat) {
                // @ts-ignore
                await this.app.plugins.unloadPlugin(plugin.manifest.id);
                Logger(`Unload plugin:${plugin.manifest.id}`, LOG_LEVEL_NOTICE);
            }
            if (plugin.dataJson)
                await adapter.write(pluginTargetFolderPath + "data.json", plugin.dataJson);
            Logger("wrote:" + pluginTargetFolderPath + "data.json", LOG_LEVEL_NOTICE);
            if (stat) {
                // @ts-ignore
                await this.app.plugins.loadPlugin(plugin.manifest.id);
                Logger(`Load plugin:${plugin.manifest.id}`, LOG_LEVEL_NOTICE);
            }
        });
    }

    async applyPlugin(plugin: PluginDataEntry) {
        await runWithLock("plugin-" + plugin.manifest.id, false, async () => {
            // @ts-ignore
            const stat = this.app.plugins.enabledPlugins.has(plugin.manifest.id) == true;
            if (stat) {
                // @ts-ignore
                await this.app.plugins.unloadPlugin(plugin.manifest.id);
                Logger(`Unload plugin:${plugin.manifest.id}`, LOG_LEVEL_NOTICE);
            }

            const pluginTargetFolderPath = normalizePath(plugin.manifest.dir) + "/";
            const adapter = this.app.vault.adapter;
            if ((await adapter.exists(pluginTargetFolderPath)) === false) {
                await adapter.mkdir(pluginTargetFolderPath);
            }
            await adapter.write(pluginTargetFolderPath + "main.js", plugin.mainJs);
            await adapter.write(pluginTargetFolderPath + "manifest.json", plugin.manifestJson);
            if (plugin.styleCss)
                await adapter.write(pluginTargetFolderPath + "styles.css", plugin.styleCss);
            if (stat) {
                // @ts-ignore
                await this.app.plugins.loadPlugin(plugin.manifest.id);
                Logger(`Load plugin:${plugin.manifest.id}`, LOG_LEVEL_NOTICE);
            }
        });
    }
}
