import { type AnyEntry, type DocumentID, type EntryDoc, type EntryHasPath, type FilePath, type FilePathWithPrefix } from "../lib/src/common/types.ts";
import { PouchDB } from "../lib/src/pouchdb/pouchdb-browser.js";
import type ObsidianLiveSyncPlugin from "../main.ts";


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
    get vaultAccess() {
        return this.plugin.vaultAccess;
    }
    id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
        return this.plugin.id2path(id, entry, stripPrefix);
    }
    async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        return await this.plugin.path2id(filename, prefix);
    }
    getPath(entry: AnyEntry): FilePathWithPrefix {
        return this.plugin.getPath(entry);
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
