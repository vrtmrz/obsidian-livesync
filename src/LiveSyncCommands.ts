import { EntryDoc } from "./lib/src/types";
import { PouchDB } from "./lib/src/pouchdb-browser.js";
import type ObsidianLiveSyncPlugin from "./main";


export abstract class LiveSyncCommands {
    plugin: ObsidianLiveSyncPlugin;
    get app() {
        return this.plugin.app;
    }
    get settings() {
        return this.plugin.settings;
    }
    get localDatabase() {
        return this.plugin.localDatabase;
    }
    constructor(plugin: ObsidianLiveSyncPlugin) {
        this.plugin = plugin;
    }
    abstract onunload(): void;
    abstract onload(): void | Promise<void>;
    abstract onInitializeDatabase(showNotice: boolean): void | Promise<void>;
    abstract beforeReplicate(showNotice: boolean): void | Promise<void>;
    abstract onResume(): void | Promise<void>;
    abstract parseReplicationResultItem(docs: PouchDB.Core.ExistingDocument<EntryDoc>): Promise<boolean> | boolean;
    abstract realizeSettingSyncMode(): Promise<void>;
}
