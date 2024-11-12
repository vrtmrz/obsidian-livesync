import { Logger } from "octagonal-wheels/common/logger";
import { getPath } from "../common/utils.ts";
import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    type AnyEntry,
    type DocumentID,
    type EntryHasPath,
    type FilePath,
    type FilePathWithPrefix,
    type LOG_LEVEL,
} from "../lib/src/common/types.ts";
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

    id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
        return this.plugin.$$id2path(id, entry, stripPrefix);
    }
    async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        return await this.plugin.$$path2id(filename, prefix);
    }
    getPath(entry: AnyEntry): FilePathWithPrefix {
        return getPath(entry);
    }

    constructor(plugin: ObsidianLiveSyncPlugin) {
        this.plugin = plugin;
    }
    abstract onunload(): void;
    abstract onload(): void | Promise<void>;

    _isMainReady() {
        return this.plugin.$$isReady();
    }
    _isMainSuspended() {
        return this.plugin.$$isSuspended();
    }
    _isDatabaseReady() {
        return this.plugin.$$isDatabaseReady();
    }

    _log = (msg: any, level: LOG_LEVEL = LOG_LEVEL_INFO, key?: string) => {
        if (typeof msg === "string" && level !== LOG_LEVEL_NOTICE) {
            msg = `[${this.constructor.name}]\u{200A} ${msg}`;
        }
        // console.log(msg);
        Logger(msg, level, key);
    };
}
