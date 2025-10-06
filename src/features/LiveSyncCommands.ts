import { LOG_LEVEL_VERBOSE, Logger } from "octagonal-wheels/common/logger";
import { getPath } from "../common/utils.ts";
import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    type AnyEntry,
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type LOG_LEVEL,
} from "../lib/src/common/types.ts";
import type ObsidianLiveSyncPlugin from "../main.ts";
import { MARK_DONE } from "../modules/features/ModuleLog.ts";
import type { LiveSyncCore } from "../main.ts";
import { __$checkInstanceBinding } from "../lib/src/dev/checks.ts";

let noticeIndex = 0;
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
    get services() {
        return this.plugin.services;
    }

    // id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
    //     return this.plugin.$$id2path(id, entry, stripPrefix);
    // }
    async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        return await this.services.path.path2id(filename, prefix);
    }
    getPath(entry: AnyEntry): FilePathWithPrefix {
        return getPath(entry);
    }

    constructor(plugin: ObsidianLiveSyncPlugin) {
        this.plugin = plugin;
        this.onBindFunction(plugin, plugin.services);
        __$checkInstanceBinding(this);
    }
    abstract onunload(): void;
    abstract onload(): void | Promise<void>;

    _isMainReady() {
        return this.plugin.services.appLifecycle.isReady();
    }
    _isMainSuspended() {
        return this.services.appLifecycle.isSuspended();
    }
    _isDatabaseReady() {
        return this.services.database.isDatabaseReady();
    }

    _log = (msg: any, level: LOG_LEVEL = LOG_LEVEL_INFO, key?: string) => {
        if (typeof msg === "string" && level !== LOG_LEVEL_NOTICE) {
            msg = `[${this.constructor.name}]\u{200A} ${msg}`;
        }
        // console.log(msg);
        Logger(msg, level, key);
    };

    _verbose = (msg: any, key?: string) => {
        this._log(msg, LOG_LEVEL_VERBOSE, key);
    };

    _info = (msg: any, key?: string) => {
        this._log(msg, LOG_LEVEL_INFO, key);
    };

    _notice = (msg: any, key?: string) => {
        this._log(msg, LOG_LEVEL_NOTICE, key);
    };
    _progress = (prefix: string = "", level: LOG_LEVEL = LOG_LEVEL_NOTICE) => {
        const key = `keepalive-progress-${noticeIndex++}`;
        return {
            log: (msg: any) => {
                this._log(prefix + msg, level, key);
            },
            once: (msg: any) => {
                this._log(prefix + msg, level);
            },
            done: (msg: string = "Done") => {
                this._log(prefix + msg + MARK_DONE, level, key);
            },
        };
    };

    _debug = (msg: any, key?: string) => {
        this._log(msg, LOG_LEVEL_VERBOSE, key);
    };

    onBindFunction(core: LiveSyncCore, services: typeof core.services) {
        // Override if needed.
    }
}
