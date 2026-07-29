import { LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    type AnyEntry,
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type ObsidianLiveSyncPlugin from "@/main.ts";
import { MARK_DONE } from "@/modules/features/ModuleLog.ts";
import type { LiveSyncCore } from "@/main.ts";
// import { __$checkInstanceBinding } from "@vrtmrz/livesync-commonlib/compat/dev/checks";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";

let noticeIndex = 0;
export abstract class LiveSyncCommands {
    /**
     * @deprecated This class is deprecated. Please use core
     */
    plugin: ObsidianLiveSyncPlugin;
    core: LiveSyncCore;
    get app() {
        return this.plugin.app;
    }
    get settings() {
        return this.core.settings;
    }
    get localDatabase() {
        return this.core.localDatabase;
    }
    get services() {
        return this.core.services;
    }

    // id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
    //     return this.plugin.$$id2path(id, entry, stripPrefix);
    // }
    async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        return await this.services.path.path2id(filename, prefix);
    }

    getPath(entry: AnyEntry): FilePathWithPrefix {
        return this.services.path.getPath(entry);
    }

    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore) {
        this.plugin = plugin;
        this.core = core;
        this.onBindFunction(this.core, this.core.services);
        this._log = createInstanceLogFunction(this.constructor.name, this.services.API);
        // __$checkInstanceBinding(this);
    }
    abstract onunload(): void;
    abstract onload(): void | Promise<void>;

    _isMainReady() {
        return this.services.appLifecycle.isReady();
    }
    _isMainSuspended() {
        return this.services.appLifecycle.isSuspended();
    }
    _isDatabaseReady() {
        return this.services.database.isDatabaseReady();
    }

    _log: ReturnType<typeof createInstanceLogFunction>;

    _verbose = (msg: unknown, key?: string) => {
        this._log(msg, LOG_LEVEL_VERBOSE, key);
    };

    _info = (msg: unknown, key?: string) => {
        this._log(msg, LOG_LEVEL_INFO, key);
    };

    _notice = (msg: unknown, key?: string) => {
        this._log(msg, LOG_LEVEL_NOTICE, key);
    };
    _progress = (prefix: string = "", level: LOG_LEVEL = LOG_LEVEL_NOTICE) => {
        const key = `keepalive-progress-${noticeIndex++}`;
        return {
            log: (msg: string) => {
                this._log(prefix + msg, level, key);
            },
            once: (msg: string) => {
                this._log(prefix + msg, level);
            },
            done: (msg: string = "Done") => {
                this._log(prefix + msg + MARK_DONE, level, key);
            },
        };
    };

    _debug = (msg: unknown, key?: string) => {
        this._log(msg, LOG_LEVEL_VERBOSE, key);
    };

    onBindFunction(core: LiveSyncCore, services: typeof core.services) {
        // Override if needed.
    }
}
